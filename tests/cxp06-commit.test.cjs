const assert = require('node:assert/strict');
const test = require('node:test');

const DatasetSheets = require('../src/config/DatasetSheets.js');
const InputAdapter = require('../src/ingestion/InputAdapter.js');
const RunService = require('../src/ingestion/RunService.js');
const {
  allNormalizedPayloads,
} = require('./helpers/cxp06-staging-fakes.cjs');
const {
  FakeSpreadsheet,
  FakeUser,
} = require('./helpers/cxp06-transaction-fakes.cjs');

function loadModule(relativePath) {
  try {
    return require(relativePath);
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      return undefined;
    }
    throw error;
  }
}

function matrixForPayload(payload) {
  return [payload.headers.slice()].concat(
    payload.records.map((record) =>
      payload.headers.map((header) => (record[header] === null ? '' : record[header])),
    ),
  );
}

function targetSpreadsheet(payloads, owner) {
  const spreadsheet = new FakeSpreadsheet([owner]);
  DatasetSheets.listBindings().forEach((binding) => {
    spreadsheet.addSheet(binding.stagingSheetName, [['stale']]);
    const payload = payloads.find((candidate) => candidate.datasetName === binding.datasetName);
    spreadsheet.addSheet(binding.rawSheetName, matrixForPayload(payload));
  });
  return spreadsheet;
}

class FakeScriptLock {
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

class FakeAuditRepository {
  constructor() {
    this.calls = [];
  }

  persist(runRecords, errorRecords) {
    this.calls.push({ errorRecords, runRecords });
  }
}

class TransactionLedger {
  constructor(events) {
    this.events = events;
    this.records = [];
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
    return [...this.records].reverse().find(
      (record) => record.result === 'SUCCESS' && record.runId === runId,
    ) || null;
  }
}

function tickingClock() {
  let time = Date.parse('2026-08-23T00:00:00.000Z');
  return {
    now() {
      const value = new Date(time);
      time += 1000;
      return value;
    },
  };
}

function requestFor(payloads) {
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

function frontOperations(payloads, events) {
  const fingerprint = 'sha256:cxp06-happy';
  const sourceFiles = [{ fileId: 'source-id', fileName: 'source.xlsx' }];
  return {
    validateFile() {
      events.push(['phase', 'validateFile']);
      return { fingerprint, sourceFiles };
    },
    parse() {
      events.push(['phase', 'parse']);
      return { packagingKind: 'multi_sheet_workbook' };
    },
    validateSchema() {
      events.push(['phase', 'validateSchema']);
      return { payloads };
    },
    checkDuplicate() {
      events.push(['phase', 'checkDuplicate']);
      return { fingerprint, payloads, sourceFiles };
    },
  };
}

// Defect caught: CXP-06 bypasses CXP-04's lock boundary or records success before health verification.
test('commit service composes a five-dataset two-phase happy path inside the existing lock', () => {
  const CommitService = loadModule('../src/services/CommitService.js');
  assert.equal(typeof CommitService?.createOperations, 'function');
  assert.deepEqual(Object.keys(InputAdapter.createOperations({}, {})), [
    'validateFile',
    'parse',
    'validateSchema',
    'checkDuplicate',
  ]);

  const owner = new FakeUser('owner@example.test');
  const payloads = allNormalizedPayloads();
  const target = targetSpreadsheet(payloads, owner);
  const ledger = new TransactionLedger(target.events);
  const clock = tickingClock();
  const flush = () => target.events.push(['flush']);
  const commitOperations = CommitService.createOperations({
    clock,
    flush,
    ledgerRepository: ledger,
    session: { getEffectiveUser: () => owner },
    spreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
    targetSpreadsheet: target,
  });
  assert.deepEqual(Object.keys(commitOperations), [
    'stage',
    'validateStage',
    'commit',
    'recalculate',
    'healthCheck',
  ]);

  const lock = new FakeScriptLock(target.events);
  const auditRepository = new FakeAuditRepository();
  const operations = Object.assign(
    frontOperations(payloads, target.events),
    commitOperations,
  );
  const result = RunService.execute(requestFor(payloads), operations, {
    clock,
    flush,
    lockService: { getScriptLock: () => lock },
    lockTimeoutMs: 5000,
    repository: auditRepository,
    uuid: () => 'run-cxp06',
  });

  assert.equal(result.runRecord.status, 'SUCCESS');
  assert.equal(ledger.records.filter((record) => record.result === 'SUCCESS').length, 1);
  assert.equal(result.operationResults.commit.datasetCount, 5);
  assert.deepEqual(result.operationResults.healthCheck, {
    backupCleanupStatus: 'DELETED',
    datasetCount: 5,
    ledgerStatus: 'CONFIRMED',
  });

  const stageWrites = target.events.filter(
    ([name, sheetName]) => name === 'setValues' && sheetName.startsWith('_STG_'),
  );
  const rawWrites = target.events.filter(
    ([name, sheetName]) => name === 'setValues' && sheetName.startsWith('_RAW_'),
  );
  const copies = target.events.filter(([name]) => name === 'copyTo');
  assert.equal(stageWrites.length, 5);
  assert.equal(rawWrites.length, 5);
  assert.equal(copies.length, 5);

  const indexOf = (name) => target.events.findIndex((event) => event[0] === name);
  const lastIndexOf = (name) => target.events.findLastIndex((event) => event[0] === name);
  assert.ok(lastIndexOf('setValues') > indexOf('tryLock'));
  assert.ok(indexOf('ledgerFingerprint') > indexOf('tryLock'));
  assert.ok(lastIndexOf('copyTo') < target.events.findIndex(
    ([name, sheetName]) => name === 'clearContent' && sheetName.startsWith('_RAW_'),
  ));
  assert.ok(indexOf('flush') < indexOf('ledgerAppend'));
  assert.ok(indexOf('ledgerAppend') < lastIndexOf('ledgerRun'));
  assert.ok(lastIndexOf('ledgerRun') < indexOf('deleteSheet'));
  assert.ok(lastIndexOf('deleteSheet') < indexOf('releaseLock'));
  assert.equal(auditRepository.calls.length, 1);
  assert.equal(JSON.stringify(result.operationResults.commit).includes('Case:'), false);
  assert.equal(JSON.stringify(result.operationResults.healthCheck).includes('Case:'), false);
});
