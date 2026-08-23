const assert = require('node:assert/strict');
const test = require('node:test');

const CommitService = require('../src/services/CommitService.js');
const DatasetSheets = require('../src/config/DatasetSheets.js');
const RunService = require('../src/ingestion/RunService.js');
const {
  allNormalizedPayloads,
} = require('./helpers/cxp06-staging-fakes.cjs');
const {
  FakeSpreadsheet,
  FakeUser,
} = require('./helpers/cxp06-transaction-fakes.cjs');

function matrixForPayload(payload) {
  return [payload.headers.slice()].concat(
    payload.records.map((record) =>
      payload.headers.map((header) => (record[header] === null ? '' : record[header])),
    ),
  );
}

function oldPayload(payload) {
  return {
    ...payload,
    records: payload.records.map((record) =>
      Object.fromEntries(Object.entries(record).map(([key, value]) => {
        if (typeof value === 'number') {
          return [key, value + 100];
        }
        if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(value)) {
          return [key, `${value}-old`];
        }
        return [key, value];
      })),
    ),
  };
}

class Lock {
  constructor(events) {
    this.events = events;
    this.held = false;
  }

  hasLock() {
    return this.held;
  }

  releaseLock() {
    this.events.push(['releaseLock']);
    this.held = false;
  }

  tryLock(timeoutMs) {
    this.events.push(['tryLock', timeoutMs]);
    this.held = true;
    return true;
  }
}

class AuditRepository {
  constructor() {
    this.calls = [];
  }

  persist(runRecords, errorRecords) {
    this.calls.push({ errorRecords, runRecords });
  }
}

class Ledger {
  constructor(events, options, fingerprint) {
    this.events = events;
    this.options = options;
    this.records = options.duplicateRace ? [{
      fingerprint,
      result: 'SUCCESS',
      runId: 'prior-run',
    }] : [];
  }

  append(records) {
    records.forEach((record) => {
      this.events.push(['ledgerAppend', record.result, record.runId]);
      this.records.push(record);
    });
  }

  findSuccessfulByFingerprint(fingerprint) {
    this.events.push(['ledgerFingerprint', fingerprint]);
    return [...this.records].reverse().find(
      (record) => record.result === 'SUCCESS' && record.fingerprint === fingerprint,
    ) || null;
  }

  findSuccessfulByRunId(runId) {
    this.events.push(['ledgerRun', runId]);
    if (this.options.runIdConfirmationFailure && runId === 'run-cxp06') {
      throw Object.assign(new Error('synthetic ledger read failure'), {
        code: 'INGESTION_FILE_LEDGER_READ_FAILED',
      });
    }
    return [...this.records].reverse().find(
      (record) => record.result === 'SUCCESS' && record.runId === runId,
    ) || null;
  }
}

function request(payloads) {
  return {
    inputRowCounts: Object.fromEntries(
      payloads.map((payload) => [payload.datasetName, payload.rowCount]),
    ),
    outputRowCounts: {},
    schemaVersion: '1.0.0',
    sourceActor: 'synthetic-rta@example.test',
    sourceFileId: 'synthetic-file-id',
    sourceFileName: 'synthetic-source.xlsx',
    targetWorkbookId: 'synthetic-target-id',
  };
}

function harness(options = {}) {
  const owner = new FakeUser('owner@example.test');
  const payloads = allNormalizedPayloads();
  const oldPayloads = payloads.map(oldPayload);
  const target = new FakeSpreadsheet([owner]);
  DatasetSheets.listBindings().forEach((binding) => {
    target.addSheet(binding.stagingSheetName, [['stale']]);
    const payload = oldPayloads.find(
      (candidate) => candidate.datasetName === binding.datasetName,
    );
    target.addSheet(binding.rawSheetName, matrixForPayload(payload));
  });
  const originalRaw = DatasetSheets.listBindings().map((binding) =>
    target.getSheetByName(binding.rawSheetName).values.map((row) => row.slice()),
  );
  const fingerprint = 'sha256:cxp06-failure';
  const ledger = new Ledger(target.events, options, fingerprint);
  const audit = new AuditRepository();
  const lock = new Lock(target.events);
  let time = Date.parse('2026-08-23T00:00:00.000Z');
  const clock = { now: () => new Date(time += 1000) };
  let healthMutated = false;
  const flush = () => {
    target.events.push(['flush']);
    if (
      options.healthMismatch &&
      !healthMutated &&
      target.events.filter(
        ([name, sheetName]) => name === 'setValues' && sheetName?.startsWith('_RAW_'),
      ).length >= 5
    ) {
      healthMutated = true;
      target.getSheetByName('_RAW_HANDLED').values[1][0] = 'health-mismatch';
    }
  };

  if (options.midCommitFailure || options.rollbackFailure) {
    let firstFailure = true;
    Object.defineProperty(target, 'failWriteSheet', {
      configurable: true,
      get() {
        const handledWasWritten = target.events.some(
          ([name, sheetName]) => name === 'setValues' && sheetName === '_RAW_HANDLED',
        );
        if (handledWasWritten && (firstFailure || options.rollbackFailure)) {
          firstFailure = false;
          return '_RAW_OFFERED';
        }
        return null;
      },
    });
  }

  if (options.cleanupFailure) {
    target.deleteSheet = () => {
      throw new Error('synthetic cleanup failure');
    };
  }

  let runPayloads = payloads;
  if (options.invalidStage) {
    runPayloads = payloads.map((payload, index) => {
      if (index !== 0) {
        return payload;
      }
      const textHeader = payload.headers.find(
        (header) => typeof payload.records[0][header] === 'string',
      );
      return {
        ...payload,
        records: [{ ...payload.records[0], [textHeader]: '=1+1' }],
      };
    });
  }

  const sourceFiles = [{ fileId: 'source-id', fileName: 'source.xlsx' }];
  const front = {
    validateFile: () => ({ fingerprint, sourceFiles }),
    parse: () => ({ packagingKind: 'multi_sheet_workbook' }),
    validateSchema: () => ({ payloads: runPayloads }),
    checkDuplicate: () => ({ fingerprint, payloads: runPayloads, sourceFiles }),
  };
  const commit = CommitService.createOperations({
    clock,
    flush,
    ledgerRepository: ledger,
    session: { getEffectiveUser: () => owner },
    spreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
    targetSpreadsheet: target,
  });
  const operations = Object.assign(front, commit);

  function execute() {
    return RunService.execute(request(runPayloads), operations, {
      clock,
      flush,
      lockService: { getScriptLock: () => lock },
      lockTimeoutMs: 5000,
      repository: audit,
      uuid: () => 'run-cxp06',
    });
  }

  function rawValues() {
    return DatasetSheets.listBindings().map((binding) =>
      target.getSheetByName(binding.rawSheetName).values.map((row) => row.slice()),
    );
  }

  return { audit, execute, ledger, originalRaw, rawValues, target };
}

// Defect caught: a formula-producing stage reaches the production lock or changes raw data.
test('invalid stage failure leaves raw unchanged and never enters the production lock', () => {
  const run = harness({ invalidStage: true });
  assert.throws(
    () => run.execute(),
    (error) => error?.code === 'MIGRATION_STAGE_VALIDATION_FAILED',
  );
  assert.deepEqual(run.rawValues(), run.originalRaw);
  assert.equal(run.target.events.some(([name]) => name === 'tryLock'), false);
  assert.equal(run.target.events.some(([name]) => name === 'copyTo'), false);
});

// Defect caught: a partial raw replacement or failed health check leaves mixed active datasets.
test('mid-commit and health failures rollback all five raw datasets before lock release', () => {
  for (const options of [{ midCommitFailure: true }, { healthMismatch: true }]) {
    const run = harness(options);
    assert.throws(
      () => run.execute(),
      (error) =>
        ['MIGRATION_COMMIT_FAILED', 'CALCULATION_HEALTH_CHECK_FAILED'].includes(error?.code) &&
        error.details.rollbackStatus === 'VERIFIED',
    );
    assert.deepEqual(run.rawValues(), run.originalRaw);
    const deleteIndex = run.target.events.findLastIndex(([name]) => name === 'deleteSheet');
    const releaseIndex = run.target.events.findIndex(([name]) => name === 'releaseLock');
    assert.ok(deleteIndex >= 0 && deleteIndex < releaseIndex);
  }
});

// Defect caught: rollback write failure is reported as the original commit error and deletes recovery evidence.
test('rollback failure is distinct, safe, and retains the complete backup group', () => {
  const run = harness({ rollbackFailure: true });
  assert.throws(
    () => run.execute(),
    (error) =>
      error?.code === 'MIGRATION_ROLLBACK_FAILED' &&
      error.details.rollbackStatus === 'FAILED' &&
      !JSON.stringify(error.details).includes('synthetic'),
  );
  assert.equal(
    run.target.getSheets().filter((sheet) => sheet.getName().startsWith('_CXP06_BAK_')).length,
    5,
  );
});

// Defect caught: a duplicate that appears after pre-lock validation still creates backups or changes raw.
test('in-lock duplicate race exits before backup or raw mutation', () => {
  const run = harness({ duplicateRace: true });
  assert.throws(
    () => run.execute(),
    (error) => error?.code === 'SOURCE_DUPLICATE_SUBMISSION',
  );
  assert.deepEqual(run.rawValues(), run.originalRaw);
  assert.equal(run.target.events.some(([name]) => name === 'copyTo'), false);
  assert.equal(run.ledger.records.some((record) => record.result === 'DUPLICATE'), true);
});

// Defect caught: one failed confirmation path rolls back after SUCCESS was persisted and poisons retry.
test('alternate ledger confirmation preserves committed raw and duplicate-safe retry behavior', () => {
  const fallback = harness({ runIdConfirmationFailure: true });
  const first = fallback.execute();
  assert.equal(first.runRecord.status, 'SUCCESS');
  assert.equal(first.operationResults.healthCheck.ledgerStatus, 'CONFIRMED');
  assert.notDeepEqual(fallback.rawValues(), fallback.originalRaw);
  assert.equal(
    fallback.ledger.records.filter((record) => record.result === 'SUCCESS').length,
    1,
  );

  assert.throws(
    () => fallback.execute(),
    (error) => error?.code === 'SOURCE_DUPLICATE_SUBMISSION',
  );
  assert.notDeepEqual(fallback.rawValues(), fallback.originalRaw);
});

// Defect caught: post-success cleanup debt rolls healthy raw back.
test('cleanup debt preserves confirmed healthy raw', () => {
  const cleanup = harness({ cleanupFailure: true });
  const result = cleanup.execute();
  assert.equal(result.runRecord.status, 'SUCCESS');
  assert.equal(result.operationResults.healthCheck.backupCleanupStatus, 'PENDING');
  assert.notDeepEqual(cleanup.rawValues(), cleanup.originalRaw);
  assert.equal(
    cleanup.target.getSheets().filter((sheet) => sheet.getName().startsWith('_CXP06_BAK_')).length,
    5,
  );
});
