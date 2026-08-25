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
test('commit service runs its pre-reconciliation hook inside the existing lock', () => {
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
  const rawCalls = [];
  let decoratedBackupRepository;
  let lock;
  const commitOperations = CommitService.createOperations({
    beforeReconcile(context) {
      target.events.push(['beforeReconcile', lock?.held]);
      assert.equal(context.backupRepository, decoratedBackupRepository);
      assert.equal(context.ledgerRepository, ledger);
      assert.equal(context.targetSpreadsheet, target);
      assert.equal(Object.isFrozen(context), true);
    },
    clock,
    decorateBackupRepository(repository) {
      target.events.push(['decorateBackupRepository']);
      decoratedBackupRepository = Object.assign({}, repository, {
        discoverGroups() {
          target.events.push(['discoverGroups']);
          return repository.discoverGroups();
        },
      });
      return decoratedBackupRepository;
    },
    decorateRawRepository(repository) {
      target.events.push(['decorateRawRepository']);
      return Object.assign({}, repository, {
        preflight() {
          rawCalls.push(['preflight']);
          return repository.preflight();
        },
        replaceAll(payloads, options) {
          rawCalls.push(['replaceAll', options]);
          return repository.replaceAll(payloads, options);
        },
      });
    },
    decorateStagingRepository(repository) {
      target.events.push(['decorateStagingRepository']);
      return repository;
    },
    flush,
    ledgerRepository: ledger,
    session: { getEffectiveUser: () => owner },
    spreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
    targetSpreadsheet: target,
  });
  assert.deepEqual(Object.keys(commitOperations), [
    'backupStep',
    'commitDatasetStep',
    'commitStep',
    'stage',
    'validateStage',
    'commit',
    'recalculate',
    'healthCheck',
    'resume',
    'resumeBackup',
    'resumeDataset',
  ]);
  assert.deepEqual(target.events.slice(-3), [
    ['decorateStagingRepository'],
    ['decorateRawRepository'],
    ['decorateBackupRepository'],
  ]);

  lock = new FakeScriptLock(target.events);
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
  assert.deepEqual(rawCalls, [
    ['preflight'],
    ['replaceAll', { preflightVerified: true }],
  ]);
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
  assert.deepEqual(target.events[indexOf('beforeReconcile')], ['beforeReconcile', true]);
  assert.ok(indexOf('beforeReconcile') > indexOf('tryLock'));
  assert.ok(indexOf('beforeReconcile') < indexOf('discoverGroups'));
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

// Defect caught: a fresh continuation loses the in-memory transaction and cannot enter commit.
test('commit service resumes a validated staged transaction without reparsing source files', () => {
  const CommitService = loadModule('../src/services/CommitService.js');
  const owner = new FakeUser('owner@example.test');
  const payloads = allNormalizedPayloads();
  const target = targetSpreadsheet(payloads, owner);
  const ledger = new TransactionLedger(target.events);
  const clock = tickingClock();
  const flush = () => target.events.push(['flush']);
  const serviceOptions = {
    clock,
    flush,
    ledgerRepository: ledger,
    session: { getEffectiveUser: () => owner },
    spreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
    targetSpreadsheet: target,
  };
  const firstOperations = CommitService.createOperations(serviceOptions);
  const preparationOperations = Object.assign(
    frontOperations(payloads, target.events),
    firstOperations,
  );
  const auditRepository = new FakeAuditRepository();
  const runServices = {
    clock,
    createCheckpoint(context) {
      const duplicate = context.operationResults.checkDuplicate;
      return {
        fingerprint: duplicate.fingerprint,
        sourceFiles: duplicate.sourceFiles,
      };
    },
    flush,
    lockService: { getScriptLock: () => new FakeScriptLock(target.events) },
    repository: auditRepository,
    uuid: () => 'run-cxp06-resumed',
  };
  const prepared = RunService.prepare(
    requestFor(payloads),
    preparationOperations,
    runServices,
  );

  const resumedCommitOperations = CommitService.createOperations(serviceOptions);
  assert.equal(typeof resumedCommitOperations.resume, 'function');
  const resumedOperations = Object.assign(
    frontOperations(payloads, target.events),
    resumedCommitOperations,
  );
  const result = RunService.resume(
    prepared.checkpoint,
    resumedOperations,
    runServices,
  );

  assert.equal(result.runRecord.status, 'SUCCESS');
  assert.equal(
    target.events.filter(([name, sheet]) =>
      name === 'setValues' && sheet.startsWith('_STG_'),
    ).length,
    5,
  );
  assert.equal(
    target.events.filter(([name, sheet]) =>
      name === 'setValues' && sheet.startsWith('_RAW_'),
    ).length,
    5,
  );
});

// Defect caught: every hosted backup and commit cursor reconstructs all five
// staged datasets before performing one dataset-scoped durable operation.
test('hosted transaction resume skips staging for backup and loads only the commit cursor dataset', () => {
  const CommitService = loadModule('../src/services/CommitService.js');
  const owner = new FakeUser('owner@example.test');
  const payloads = allNormalizedPayloads();
  const target = targetSpreadsheet(payloads, owner);
  const ahtPayload = payloads.find((payload) => payload.datasetName === 'AHT - Raw');
  const ahtValueIndex = ahtPayload.headers.indexOf('Handle Time');
  target.getSheetByName('_RAW_AHT').values[1][ahtValueIndex] = 999.99;
  const ledger = new TransactionLedger(target.events);
  const clock = tickingClock();
  const flush = () => target.events.push(['flush']);
  const lockService = { getScriptLock: () => new FakeScriptLock(target.events) };
  const baseOptions = {
    clock,
    flush,
    ledgerRepository: ledger,
    lockService,
    session: { getEffectiveUser: () => owner },
    spreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
    targetSpreadsheet: target,
  };
  const preparationOperations = CommitService.createOperations(baseOptions);
  const prepared = RunService.prepare(
    requestFor(payloads),
    Object.assign(frontOperations(payloads, target.events), preparationOperations),
    {
      clock,
      createCheckpoint(context) {
        const duplicate = context.operationResults.checkDuplicate;
        return {
          datasetNames: DatasetSheets.listBindings().map((binding) => binding.datasetName),
          fingerprint: duplicate.fingerprint,
          sourceFiles: duplicate.sourceFiles,
        };
      },
      flush,
      lockService,
      repository: new FakeAuditRepository(),
      uuid: () => 'run-cxp06-dataset-resume',
    },
  );
  const context = {
    operationResults: {},
    request: prepared.checkpoint.request,
    runId: prepared.checkpoint.runId,
    startedAtUtc: prepared.checkpoint.startedAtUtc,
  };
  const stagingCalls = [];
  const serviceOptions = {
    ...baseOptions,
    decorateStagingRepository(repository) {
      return Object.assign({}, repository, {
        readCheckpoint(...args) {
          stagingCalls.push(['all']);
          return repository.readCheckpoint(...args);
        },
        readDatasetCheckpoint(...args) {
          stagingCalls.push(['one', args[1]]);
          return repository.readDatasetCheckpoint(...args);
        },
      });
    },
  };

  for (let index = 0; index < 5; index += 1) {
    const operations = CommitService.createOperations(serviceOptions);
    assert.equal(typeof operations.resumeBackup, 'function');
    operations.resumeBackup(context, prepared.checkpoint.data);
    operations.backupStep(context);
  }
  assert.deepEqual(stagingCalls, []);

  prepared.checkpoint.data.backupRunId = prepared.checkpoint.runId;
  const operations = CommitService.createOperations(serviceOptions);
  assert.equal(typeof operations.resumeDataset, 'function');
  assert.equal(typeof operations.commitDatasetStep, 'function');
  operations.resumeDataset(context, prepared.checkpoint.data, 'AHT - Raw');
  assert.deepEqual(stagingCalls, [['one', 'AHT - Raw']]);
  const eventStart = target.events.length;
  const progress = operations.commitDatasetStep(context, {
    complete: false,
    lastCompletedDatasetName: 'Offered',
    nextDatasetIndex: 2,
  });

  assert.deepEqual(progress, {
    complete: false,
    lastCompletedDatasetName: 'AHT - Raw',
    nextDatasetIndex: 3,
  });
  assert.deepEqual(
    target.events.slice(eventStart)
      .filter(([name]) => name === 'setValues')
      .map((event) => event[1]),
    ['_RAW_AHT'],
  );
  assert.ok(target.events.slice(eventStart).some(([name]) => name === 'flush'));
});

// Defect caught: the hosted continuation still creates all five full-sheet
// backups inside commit, so the isolated commit invocation reaches six minutes.
test('commit service checkpoints one backup per fresh operation instance before final commit', () => {
  const CommitService = loadModule('../src/services/CommitService.js');
  const owner = new FakeUser('owner@example.test');
  const payloads = allNormalizedPayloads();
  const target = targetSpreadsheet(payloads, owner);
  const ledger = new TransactionLedger(target.events);
  const clock = tickingClock();
  const flush = () => target.events.push(['flush']);
  const lockService = { getScriptLock: () => new FakeScriptLock(target.events) };
  const serviceOptions = {
    clock,
    flush,
    ledgerRepository: ledger,
    lockService,
    session: { getEffectiveUser: () => owner },
    spreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
    targetSpreadsheet: target,
  };
  const auditRepository = new FakeAuditRepository();
  const runServices = {
    clock,
    createCheckpoint(context) {
      const duplicate = context.operationResults.checkDuplicate;
      return { fingerprint: duplicate.fingerprint, sourceFiles: duplicate.sourceFiles };
    },
    flush,
    lockService,
    repository: auditRepository,
    uuid: () => 'run-cxp06-incremental',
  };
  const prepared = RunService.prepare(
    requestFor(payloads),
    Object.assign(frontOperations(payloads, target.events), CommitService.createOperations(serviceOptions)),
    runServices,
  );
  const context = {
    operationResults: {},
    request: prepared.checkpoint.request,
    runId: prepared.checkpoint.runId,
    startedAtUtc: prepared.checkpoint.startedAtUtc,
  };

  for (let index = 0; index < 5; index += 1) {
    const operations = CommitService.createOperations(serviceOptions);
    operations.resume(context, prepared.checkpoint.data);
    assert.equal(typeof operations.backupStep, 'function');
    const result = operations.backupStep(context);
    assert.equal(result.complete, index === 4);
    assert.equal(target.events.filter(([name]) => name === 'copyTo').length, index + 1);
  }

  prepared.checkpoint.data.backupRunId = prepared.checkpoint.runId;
  const finalOperations = Object.assign(
    frontOperations(payloads, target.events),
    CommitService.createOperations(serviceOptions),
  );
  const result = RunService.resume(prepared.checkpoint, finalOperations, runServices);

  assert.equal(result.runRecord.status, 'SUCCESS');
  assert.equal(target.events.filter(([name]) => name === 'copyTo').length, 5);
});

// Defect caught: the hosted commit cursor is persisted by the controller, but
// CommitService still replaces all five raw datasets again in one final call.
test('commit service replaces one raw dataset per cursor step and finalizes without replay', () => {
  const CommitService = loadModule('../src/services/CommitService.js');
  const owner = new FakeUser('owner@example.test');
  const payloads = allNormalizedPayloads();
  const target = new FakeSpreadsheet([owner]);
  DatasetSheets.listBindings().forEach((binding) => {
    target.addSheet(binding.stagingSheetName, [['stale']]);
    target.addSheet(binding.rawSheetName, [[`old-${binding.datasetName}`]]);
  });
  const ledger = new TransactionLedger(target.events);
  const clock = tickingClock();
  const flush = () => target.events.push(['flush']);
  const lockService = { getScriptLock: () => new FakeScriptLock(target.events) };
  const serviceOptions = {
    clock,
    flush,
    ledgerRepository: ledger,
    lockService,
    session: { getEffectiveUser: () => owner },
    spreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
    targetSpreadsheet: target,
  };
  const auditRepository = new FakeAuditRepository();
  const runServices = {
    clock,
    createCheckpoint(context) {
      const duplicate = context.operationResults.checkDuplicate;
      return { fingerprint: duplicate.fingerprint, sourceFiles: duplicate.sourceFiles };
    },
    flush,
    lockService,
    repository: auditRepository,
    uuid: () => 'run-cxp06-commit-cursor',
  };
  const prepared = RunService.prepare(
    requestFor(payloads),
    Object.assign(
      frontOperations(payloads, target.events),
      CommitService.createOperations(serviceOptions),
    ),
    runServices,
  );
  const context = {
    operationResults: {},
    request: prepared.checkpoint.request,
    runId: prepared.checkpoint.runId,
    startedAtUtc: prepared.checkpoint.startedAtUtc,
  };

  for (let index = 0; index < 5; index += 1) {
    const operations = CommitService.createOperations(serviceOptions);
    operations.resume(context, prepared.checkpoint.data);
    operations.backupStep(context);
  }
  prepared.checkpoint.data.backupRunId = prepared.checkpoint.runId;
  target.events.length = 0;

  let progress = {
    complete: false,
    lastCompletedDatasetName: null,
    nextDatasetIndex: 0,
  };
  const datasetNames = DatasetSheets.listBindings().map((binding) => binding.datasetName);
  datasetNames.forEach((datasetName, index) => {
    const operations = CommitService.createOperations(serviceOptions);
    operations.resume(context, Object.assign({}, prepared.checkpoint.data, {
      commitProgress: progress,
    }));
    assert.equal(typeof operations.commitStep, 'function');
    progress = operations.commitStep(context, progress);
    assert.deepEqual(progress, {
      complete: index === datasetNames.length - 1,
      lastCompletedDatasetName: datasetName,
      nextDatasetIndex: index + 1,
    });
    assert.equal(
      target.events.filter(([name, sheet]) =>
        name === 'setValues' && sheet.startsWith('_RAW_'),
      ).length,
      index + 1,
    );
  });
  assert.equal(ledger.records.length, 0);

  prepared.checkpoint.data.commitProgress = progress;
  const result = RunService.resume(
    prepared.checkpoint,
    Object.assign(
      frontOperations(payloads, target.events),
      CommitService.createOperations(serviceOptions),
    ),
    runServices,
  );

  assert.equal(result.runRecord.status, 'SUCCESS');
  assert.equal(
    target.events.filter(([name, sheet]) =>
      name === 'setValues' && sheet.startsWith('_RAW_'),
    ).length,
    5,
  );
  assert.equal(ledger.records.filter((record) => record.result === 'SUCCESS').length, 1);
});

// Defect caught: commitStep re-verifies every backup against current raw after
// Handled has already been replaced, so a different previous-cycle Handled
// snapshot fails the second dataset with MIGRATION_BACKUP_FAILED.
test('commitStep verifies only unreplaced datasets after a distinct previous-cycle raw snapshot', () => {
  const CommitService = loadModule('../src/services/CommitService.js');
  const owner = new FakeUser('owner@example.test');
  const payloads = allNormalizedPayloads();
  const target = new FakeSpreadsheet([owner]);
  DatasetSheets.listBindings().forEach((binding) => {
    target.addSheet(binding.stagingSheetName, [['stale']]);
    target.addSheet(binding.rawSheetName, [[`old-${binding.datasetName}`]]);
  });
  const ledger = new TransactionLedger(target.events);
  const clock = tickingClock();
  const flush = () => target.events.push(['flush']);
  const lockService = { getScriptLock: () => new FakeScriptLock(target.events) };
  const serviceOptions = {
    clock,
    flush,
    ledgerRepository: ledger,
    lockService,
    session: { getEffectiveUser: () => owner },
    spreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
    targetSpreadsheet: target,
  };
  const auditRepository = new FakeAuditRepository();
  const runServices = {
    clock,
    createCheckpoint(context) {
      const duplicate = context.operationResults.checkDuplicate;
      return { fingerprint: duplicate.fingerprint, sourceFiles: duplicate.sourceFiles };
    },
    flush,
    lockService,
    repository: auditRepository,
    uuid: () => 'run-distinct-raw',
  };
  const prepared = RunService.prepare(
    requestFor(payloads),
    Object.assign(
      frontOperations(payloads, target.events),
      CommitService.createOperations(serviceOptions),
    ),
    runServices,
  );
  const context = {
    operationResults: {},
    request: prepared.checkpoint.request,
    runId: prepared.checkpoint.runId,
    startedAtUtc: prepared.checkpoint.startedAtUtc,
  };

  for (let index = 0; index < 5; index += 1) {
    const operations = CommitService.createOperations(serviceOptions);
    operations.resume(context, prepared.checkpoint.data);
    operations.backupStep(context);
  }
  prepared.checkpoint.data.backupRunId = prepared.checkpoint.runId;
  const handledBackup = target.getSheetByName(
    `_CXP06_BAK_HANDLED_${prepared.checkpoint.runId}`,
  );
  assert.deepEqual(handledBackup.getDataRange().getValues(), [['old-Handled']]);

  let progress = {
    complete: false,
    lastCompletedDatasetName: null,
    nextDatasetIndex: 0,
  };
  DatasetSheets.listBindings().forEach((binding, index) => {
    const operations = CommitService.createOperations(serviceOptions);
    operations.resume(context, Object.assign({}, prepared.checkpoint.data, {
      commitProgress: progress,
    }));
    progress = operations.commitStep(context, progress);
    assert.equal(progress.lastCompletedDatasetName, binding.datasetName);
    assert.equal(progress.nextDatasetIndex, index + 1);
  });
  assert.equal(progress.complete, true);
  assert.deepEqual(
    target.getSheetByName('_RAW_HANDLED').getDataRange().getValues()[0],
    payloads.find((payload) => payload.datasetName === 'Handled').headers,
  );
  assert.deepEqual(handledBackup.getDataRange().getValues(), [['old-Handled']]);

  prepared.checkpoint.data.commitProgress = progress;
  const result = RunService.resume(
    prepared.checkpoint,
    Object.assign(
      frontOperations(payloads, target.events),
      CommitService.createOperations(serviceOptions),
    ),
    runServices,
  );
  assert.equal(result.runRecord.status, 'SUCCESS');
});

// Defect caught: a hard timeout after replaceOne persists the new raw sheet but
// not the cursor, so the next commitStep still verifies that dataset against
// its pre-run backup and rolls back a successful write.
test('commitStep adopts a dataset whose raw already matches the staged payload', () => {
  const CommitService = loadModule('../src/services/CommitService.js');
  const owner = new FakeUser('owner@example.test');
  const payloads = allNormalizedPayloads();
  const target = new FakeSpreadsheet([owner]);
  DatasetSheets.listBindings().forEach((binding) => {
    target.addSheet(binding.stagingSheetName, [['stale']]);
    target.addSheet(binding.rawSheetName, [[`old-${binding.datasetName}`]]);
  });
  const ledger = new TransactionLedger(target.events);
  const clock = tickingClock();
  const flush = () => target.events.push(['flush']);
  const lockService = { getScriptLock: () => new FakeScriptLock(target.events) };
  const serviceOptions = {
    clock,
    flush,
    ledgerRepository: ledger,
    lockService,
    session: { getEffectiveUser: () => owner },
    spreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
    targetSpreadsheet: target,
  };
  const runServices = {
    clock,
    createCheckpoint(context) {
      const duplicate = context.operationResults.checkDuplicate;
      return { fingerprint: duplicate.fingerprint, sourceFiles: duplicate.sourceFiles };
    },
    flush,
    lockService,
    repository: new FakeAuditRepository(),
    uuid: () => 'run-adopt-written',
  };
  const prepared = RunService.prepare(
    requestFor(payloads),
    Object.assign(
      frontOperations(payloads, target.events),
      CommitService.createOperations(serviceOptions),
    ),
    runServices,
  );
  const context = {
    operationResults: {},
    request: prepared.checkpoint.request,
    runId: prepared.checkpoint.runId,
    startedAtUtc: prepared.checkpoint.startedAtUtc,
  };
  for (let index = 0; index < 5; index += 1) {
    const operations = CommitService.createOperations(serviceOptions);
    operations.resume(context, prepared.checkpoint.data);
    operations.backupStep(context);
  }
  prepared.checkpoint.data.backupRunId = prepared.checkpoint.runId;

  const offeredPayload = payloads.find((payload) => payload.datasetName === 'Offered');
  const offeredMatrix = [offeredPayload.headers.slice()].concat(
    offeredPayload.records.map((record) =>
      offeredPayload.headers.map((header) => (record[header] === null ? '' : record[header])),
    ),
  );
  const offeredSheet = target.getSheetByName('_RAW_OFFERED');
  offeredSheet.getDataRange().clearContent();
  offeredSheet.getRange(1, 1, offeredMatrix.length, offeredMatrix[0].length)
    .setValues(offeredMatrix);
  target.events.length = 0;

  const operations = CommitService.createOperations(serviceOptions);
  operations.resume(context, Object.assign({}, prepared.checkpoint.data, {
    commitProgress: {
      complete: false,
      lastCompletedDatasetName: 'Handled',
      nextDatasetIndex: 1,
    },
  }));
  const progress = operations.commitStep(context, {
    complete: false,
    lastCompletedDatasetName: 'Handled',
    nextDatasetIndex: 1,
  });

  assert.deepEqual(progress, {
    complete: false,
    lastCompletedDatasetName: 'Offered',
    nextDatasetIndex: 2,
  });
  assert.equal(
    target.events.filter(([name, sheet]) => name === 'setValues' && sheet === '_RAW_OFFERED').length,
    0,
  );
  assert.ok(target.getSheetByName(`_CXP06_BAK_OFFERED_${prepared.checkpoint.runId}`));
});

// Defect caught: a new checkpoint cannot begin incremental backup when an
// incomplete journal from an older timed-out run remains in the workbook.
test('incremental backup reconciles a foreign incomplete journal before creating its own', () => {
  const CommitService = loadModule('../src/services/CommitService.js');
  const StagingRepository = loadModule('../src/repository/StagingRepository.js');
  const owner = new FakeUser('owner@example.test');
  const payloads = allNormalizedPayloads();
  const target = targetSpreadsheet(payloads, owner);
  target.getSheetByName('_RAW_HANDLED')
    .copyTo(target)
    .setName('_CXP06_BAK_HANDLED_old-run')
    .hideSheet();
  const ledger = new TransactionLedger(target.events);
  StagingRepository.create(target).writeAll(payloads);
  const clock = tickingClock();
  const flush = () => target.events.push(['flush']);
  const lockService = { getScriptLock: () => new FakeScriptLock(target.events) };
  const operations = CommitService.createOperations({
    clock,
    flush,
    ledgerRepository: ledger,
    lockService,
    session: { getEffectiveUser: () => owner },
    spreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
    targetSpreadsheet: target,
  });
  const context = {
    operationResults: {},
    request: requestFor(payloads),
    runId: 'run-after-timeout',
    startedAtUtc: '2026-08-25T13:32:03.000Z',
  };

  operations.resume(context, { fingerprint: 'sha256:bundle', sourceFiles: [] });
  const result = operations.backupStep(context);

  assert.equal(result.createdDatasetName, 'Handled');
  assert.equal(target.getSheetByName('_CXP06_BAK_HANDLED_old-run'), null);
  assert.ok(target.getSheetByName('_CXP06_BAK_HANDLED_run-after-timeout'));
});
