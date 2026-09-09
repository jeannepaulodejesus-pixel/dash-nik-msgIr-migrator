const assert = require('node:assert/strict');
const test = require('node:test');

const DatasetSheets = require('../src/config/DatasetSheets.js');
const ErrorCodes = require('../src/monitoring/ErrorCodes.js');
const Pipeline = require('../src/ingestion/IngestionPipelineController.js');
const Cxp13Runtime = require('../src/ingestion/Cxp13Runtime.js');
const RunService = require('../src/ingestion/RunService.js');
const BackupRepository = require('../src/repository/BackupRepository.js');
const RawDataRepository = require('../src/repository/RawDataRepository.js');
const RollbackService = require('../src/services/RollbackService.js');
const CommitService = require('../src/services/CommitService.js');
const SheetValueCodec = require('../src/services/SheetValueCodec.js');
const WorkChunks = require('../src/ingestion/WorkChunks.js');
const StagingRepository = require('../src/repository/StagingRepository.js');
const Telemetry = require('../src/ingestion/Cxp13IngestionTelemetry.js');
const { normalizedPayload } = require('./helpers/cxp06-staging-fakes.cjs');
const { FakeSpreadsheet, FakeUser } = require('./helpers/cxp06-transaction-fakes.cjs');

global.ErrorCodes = ErrorCodes;

function triggerApp() {
  let nextTrigger = 0;
  const triggers = [];
  return {
    triggers,
    scriptApp: {
      deleteTrigger(trigger) {
        const index = triggers.indexOf(trigger);
        if (index >= 0) triggers.splice(index, 1);
      },
      getProjectTriggers: () => triggers.slice(),
      newTrigger(handler) {
        return {
          timeBased() { return this; },
          after() { return this; },
          create() {
            const id = `t-${++nextTrigger}`;
            const trigger = { getHandlerFunction: () => handler, getUniqueId: () => id };
            triggers.push(trigger);
            return trigger;
          },
        };
      },
    },
  };
}

function propertyStore() {
  const values = new Map();
  return {
    getProperty: (key) => values.get(key) || null,
    setProperty: (key, value) => values.set(key, String(value)),
    values,
  };
}

function operationsWith(overrides = {}) {
  const names = [
    'validateFile', 'parse', 'validateSchema', 'checkDuplicate',
    'stage', 'validateStage', 'commit', 'recalculate', 'healthCheck',
  ];
  return Object.fromEntries(names.map((name) => [name, overrides[name] || (() => `${name}-result`)]));
}

function preparedCheckpoint() {
  const repository = { persist() {}, persistOnce() {} };
  return RunService.prepare({
    inputRowCounts: {},
    outputRowCounts: {},
    schemaVersion: '1.0.0',
    sourceActor: 'domain-user',
    sourceFileId: 'inbox:token',
    sourceFileName: 'cxp13-inbox-bundle',
    targetWorkbookId: 'target',
  }, operationsWith(), {
    clock: { now: () => new Date('2026-09-08T13:00:00.000Z') },
    flush() {},
    repository,
    uuid: () => 'run-audit-loop',
  }).checkpoint;
}

function protectionServices(owner) {
  return {
    session: { getEffectiveUser: () => owner },
    spreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
  };
}

function matrixFor(payload) {
  return SheetValueCodec.encodePayload(payload);
}

test('preparation failures retain an auditable checkpoint before staging', () => {
  const repository = {
    persisted: null,
    persistOnce(runRecords, errorRecords) {
      this.persisted = { runRecords, errorRecords };
    },
  };
  const checkpoint = {
    data: {},
    request: {
      inputRowCounts: {},
      outputRowCounts: {},
      schemaVersion: '1.0.0',
      sourceActor: 'domain-user',
      sourceFileId: 'inbox:token',
      sourceFileName: 'cxp13-inbox-bundle',
      targetWorkbookId: 'target',
    },
    runId: 'run-preparation-failure',
    startedAtUtc: '2026-09-08T13:00:00.000Z',
    stateHistory: [
      { atUtc: '2026-09-08T13:00:00.000Z', state: 'RECEIVED' },
      { atUtc: '2026-09-08T13:00:00.000Z', state: 'VALIDATING_FILE' },
    ],
    version: 1,
  };
  const error = ErrorCodes.create('SOURCE_INBOX_BUNDLE_INCOMPLETE');
  assert.throws(
    () => RunService.recordFailure(checkpoint, error, {
      clock: { now: () => new Date('2026-09-08T13:00:01.000Z') },
      repository,
    }),
    (thrown) => thrown.runRecord && thrown.runRecord.status === 'FAILED_SOURCE',
  );
  assert.equal(repository.persisted.runRecords[0].runId, 'run-preparation-failure');
  assert.equal(repository.persisted.errorRecords[0].failureState, 'FAILED_SOURCE');
});

test('cooperative admission stays open at 194999ms and closes at 195000ms', () => {
  assert.equal(Pipeline.canStartAnotherStep(194999, 60000), true);
  assert.equal(Pipeline.canStartAnotherStep(195000, 60000), false);
  assert.equal(Pipeline.INVOCATION_BUDGET_MS, 270000);
  assert.equal(WorkChunks.DEFAULT_CHUNK_ROWS, 5000);
  assert.equal(WorkChunks.MAX_CHUNK_CELLS, 200000);
});

test('hard evidence boundary remains 269999 pass and 270000 fail', () => {
  assert.equal(269999 < Pipeline.INVOCATION_BUDGET_MS, true);
  assert.equal(270000 >= Pipeline.INVOCATION_BUDGET_MS, true);
});

test('five-file work units stay fixed by the 200000-cell and 5000-row bounds', () => {
  assert.equal(WorkChunks.adaptiveRows(1000, 19999), 2000);
  assert.equal(WorkChunks.adaptiveRows(1000, 20000), 1000);
  assert.equal(WorkChunks.adaptiveRows(1000, 75000), 1000);
  assert.equal(WorkChunks.adaptiveRows(1000, 75001), 500);
  assert.equal(WorkChunks.adaptiveRows(500, 100000), 500);
  assert.equal(WorkChunks.adaptiveRows(4000, 1), 4000);
  assert.equal(WorkChunks.adaptiveRows(1000, 45000, 27), 5000);
  assert.equal(WorkChunks.adaptiveRows(1000, 10000, 27), 5000);
  assert.equal(WorkChunks.adaptiveRows(500, 90000, 100), 2000);
  assert.equal(WorkChunks.adaptiveRows(5000, 1, 801), 249);
  assert.equal(249 * 801 <= WorkChunks.MAX_CHUNK_CELLS, true);
  assert.equal(WorkChunks.adaptiveRows(5000, 1, 5), 5000);
  assert.deepEqual(WorkChunks.windowFor(5001, 4001, 4000), {
    complete: true,
    nextStartRow: 5002,
    rowCount: 1001,
    startRow: 4001,
    totalRows: 5001,
  });
});

test('progress units include the encoded header row and do not advance during clear', () => {
  const properties = propertyStore();
  const { scriptApp } = triggerApp();
  const stateKey = 'PROGRESS_HEADER_STATE';
  const checkpoint = {
    data: {
      datasetNames: ['Handled'],
      rowCounts: { Handled: 5000 },
      prepareCursor: { chunkRows: 5000, datasetIndex: 0, datasetName: 'Handled', nextRow: 1, phase: 'clear' },
    },
    runId: 'run-progress-header',
  };
  const base = {
    checkpoint,
    generation: 1,
    startedAtUtc: '2026-09-09T00:00:00.000Z',
    status: 'PREPARING',
    updatedAtUtc: '2026-09-09T00:00:01.000Z',
    version: Pipeline.STATE_VERSION,
  };
  properties.setProperty(stateKey, JSON.stringify(base));
  const controller = Pipeline.create({ handler: 'progressHeader', stateKey, executorFactory: () => ({}) });
  const deps = { clock: { now: () => new Date('2026-09-09T00:00:02.000Z') }, properties, scriptApp };
  const beforeWrite = controller.getStatus(deps);
  assert.equal(beforeWrite.totalUnits, 2);
  assert.equal(beforeWrite.completedUnits, 0);
  assert.equal(beforeWrite.percentComplete, 0);

  checkpoint.data.prepareCursor.phase = 'write';
  const afterClear = controller.getStatus(deps);
  assert.equal(afterClear.completedUnits, 0);

  checkpoint.data.prepareCursor.phase = 'verify';
  checkpoint.data.prepareCursor.nextRow = 5001;
  properties.setProperty(stateKey, JSON.stringify(Object.assign({}, base, { checkpoint })));
  const afterFirstUnit = controller.getStatus(deps);
  assert.equal(afterFirstUnit.totalUnits, 2);
  assert.equal(afterFirstUnit.completedUnits, 1);
  assert.equal(afterFirstUnit.percentComplete, 50);
});

test('staging writes without a destination pre-read and verifies after the write', () => {
  const payload = normalizedPayload('Handled', 1);
  const intended = matrixFor(payload);
  let stored = [['old']];
  let reads = 0;
  let writes = 0;
  const range = {
    getValues() { reads += 1; return stored.map((row) => row.slice()); },
    setValues(values) { writes += 1; stored = values.map((row) => row.slice()); },
  };
  const sheet = {
    getDataRange() { return { clearContent() { stored = [['']]; } }; },
    getRange() { return range; },
  };
  const repository = StagingRepository.create({ getSheetByName: () => sheet });
  const cleared = repository.writePayloadChunk(payload, { chunkRows: 5000, nextRow: 1, phase: 'clear' });
  const written = repository.writePayloadChunk(payload, cleared.cursor);
  assert.equal(writes, 1);
  assert.equal(reads, 0);
  assert.equal(written.cursor.phase, 'verify');
  const verified = repository.writePayloadChunk(payload, written.cursor);
  assert.equal(reads, 1);
  assert.equal(verified.datasetComplete, true);
  assert.deepEqual(stored, intended);
});

test('native staged transfer clears, copies, flushes, verifies, and removes stale trailing rows', () => {
  const owner = new FakeUser('owner@example.test');
  const payload = normalizedPayload('Handled', 3);
  const matrix = matrixFor(payload);
  const stale = matrix.concat([matrix[1].slice(), matrix[1].slice()]);
  const spreadsheet = new FakeSpreadsheet([owner]);
  const binding = DatasetSheets.getByDatasetName('Handled');
  spreadsheet.addSheet(binding.stagingSheetName, matrix);
  spreadsheet.addSheet(binding.rawSheetName, stale);
  let flushCount = 0;
  const repository = RawDataRepository.create(spreadsheet, {
    flush() { flushCount += 1; },
  });

  const cleared = repository.replaceStagedChunk('Handled', null, payload.rowCount);
  assert.equal(cleared.cursor.phase, 'copy');
  assert.deepEqual(spreadsheet.getSheetByName(binding.rawSheetName).values, [['']]);

  const copied = repository.replaceStagedChunk('Handled', cleared.cursor, payload.rowCount);
  assert.equal(copied.cursor.phase, 'verify');
  assert.equal(flushCount, 1);
  assert.deepEqual(
    spreadsheet.events.filter(([name]) => name === 'rangeCopyTo').map((event) => event.slice(0, 3)),
    [['rangeCopyTo', binding.stagingSheetName, binding.rawSheetName]],
  );

  const completed = repository.replaceStagedChunk('Handled', copied.cursor, payload.rowCount);
  assert.equal(completed.datasetComplete, true);
  assert.deepEqual(
    spreadsheet.getSheetByName(binding.rawSheetName).getDataRange().getValues(),
    matrix,
  );
});

test('health inspection uses bounded formula sentinels instead of a full formula matrix read', () => {
  const owner = new FakeUser('owner@example.test');
  const payload = normalizedPayload('Handled', 3);
  const spreadsheet = new FakeSpreadsheet([owner]);
  const binding = DatasetSheets.getByDatasetName('Handled');
  spreadsheet.addSheet(binding.rawSheetName, matrixFor(payload));
  const rawSheet = spreadsheet.getSheetByName(binding.rawSheetName);
  const originalDataRange = rawSheet.getDataRange.bind(rawSheet);
  let fullFormulaReads = 0;
  rawSheet.getDataRange = function () {
    const range = originalDataRange();
    const originalGetFormulas = range.getFormulas.bind(range);
    range.getFormulas = function () {
      fullFormulaReads += 1;
      return originalGetFormulas();
    };
    return range;
  };
  const repository = RawDataRepository.create(spreadsheet);
  assert.deepEqual(repository.inspectOne('Handled', payload.rowCount), {
    columnCount: payload.headers.length,
    datasetName: 'Handled',
    rowCount: payload.rowCount,
  });
  assert.equal(fullFormulaReads, 0);

  rawSheet.formulas[rawSheet.formulas.length - 1][0] = '=1+1';
  assert.throws(
    () => repository.inspectOne('Handled', payload.rowCount),
    (error) => error && error.code === 'CALCULATION_HEALTH_CHECK_FAILED',
  );
});

test('invocation telemetry buffers counters and subphases until one terminal merge', () => {
  const values = new Map();
  let writes = 0;
  const properties = {
    getProperty: (key) => values.get(key) || null,
    setProperty(key, value) { writes += 1; values.set(key, String(value)); },
  };
  Telemetry.reset(properties, { runToken: 'run-buffered' });
  writes = 0;
  Telemetry.beginInvocation(properties, '2026-09-09T00:00:00.000Z', 0);
  Telemetry.increment(properties, 'drive');
  Telemetry.increment(properties, 'drive');
  Telemetry.noteChunk(properties);
  Telemetry.noteSubphase(properties, 'convert', 1234);
  assert.equal(writes, 1, 'only the durable invocation-start marker is persisted during work');
  Telemetry.endInvocation(properties, '2026-09-09T00:00:02.000Z', 2000);
  assert.equal(writes, 2, 'handoff merges buffered telemetry once');
  const snapshot = Telemetry.snapshot(properties);
  assert.equal(snapshot.serviceCallCounts.drive, 2);
  assert.equal(snapshot.subphaseDurations.convert, 1234);
  assert.equal(snapshot.invocations.length, 1);
});

test('recordFailure audit success is RECORDED with one RUN_LOG row, one ERROR_LOG row, zero triggers, and no commit replay', () => {
  const properties = propertyStore();
  const { scriptApp, triggers } = triggerApp();
  const checkpoint = preparedCheckpoint();
  const persistCalls = [];
  let commitCalls = 0;
  let backupCalls = 0;
  const controller = Pipeline.create({
    handler: 'continueCxp13Ingestion',
    stateKey: 'CXP13_INGESTION_PIPELINE_STATE_V1',
    executorFactory: () => ({
      auditFailure(state, error) {
        RunService.recordFailure(state.checkpoint, error, {
          clock: { now: () => new Date('2026-09-08T13:10:00.000Z') },
          repository: {
            persistOnce(runRecords, errorRecords) {
              persistCalls.push({ errorRecords, runRecords });
            },
          },
        });
      },
      backup() {
        backupCalls += 1;
        throw ErrorCodes.create('MIGRATION_BACKUP_FAILED', {
          details: { datasetName: 'Offered', operation: 'copy_raw_chunk', reason: 'copy_raw_chunk_failed' },
        });
      },
      commit() { commitCalls += 1; return { commitProgress: { complete: true, lastCompletedDatasetName: 'Staff', nextDatasetIndex: 5 } }; },
      prepare: () => ({ checkpoint }),
    }),
  });
  const deps = { clock: { now: () => new Date('2026-09-08T13:00:00.000Z') }, properties, scriptApp };
  controller.start({ environment: 'UAT' }, deps);
  controller.continueRun(deps);
  assert.throws(() => controller.continueRun(deps), (error) => error?.code === 'MIGRATION_BACKUP_FAILED');
  const status = controller.getStatus(deps);
  assert.equal(status.status, 'FAILED');
  assert.equal(status.failureAuditStatus, 'RECORDED');
  assert.equal(status.auditActionRequired, false);
  assert.equal(status.lastAuditErrorCode, null);
  assert.equal(triggers.length, 0);
  assert.equal(persistCalls.length, 1);
  assert.equal(persistCalls[0].runRecords.length, 1);
  assert.equal(persistCalls[0].errorRecords.length, 1);
  assert.equal(backupCalls, 1);
  assert.equal(controller.continueRun(deps).status, 'FAILED');
  assert.equal(persistCalls.length, 1);
  assert.equal(commitCalls, 0);
  assert.equal(backupCalls, 1);
  assert.equal(triggers.length, 0);
});

test('controller invokes audit for a preparation failure with no persisted checkpoint yet', () => {
  const properties = propertyStore();
  const { scriptApp } = triggerApp();
  let auditCalls = 0;
  const controller = Pipeline.create({
    handler: 'continuePreparationFailure',
    stateKey: 'PREPARATION_FAILURE_STATE',
    executorFactory: () => ({
      hasFailureCheckpoint: () => true,
      prepare() { throw ErrorCodes.create('SOURCE_INBOX_BUNDLE_INCOMPLETE'); },
      auditFailure(state) {
        auditCalls += 1;
        state.checkpoint = {
          data: {}, request: {}, runId: 'run-preparation-audit',
          startedAtUtc: '2026-09-09T00:00:00.000Z',
        };
      },
    }),
  });
  const deps = { clock: { now: () => new Date('2026-09-09T00:00:00.000Z') }, properties, scriptApp };
  controller.start({ environment: 'UAT' }, deps);
  assert.throws(() => controller.continueRun(deps), { code: 'SOURCE_INBOX_BUNDLE_INCOMPLETE' });
  assert.equal(auditCalls, 1);
  assert.equal(JSON.parse(properties.getProperty('PREPARATION_FAILURE_STATE')).failureAuditStatus, 'RECORDED');
});

// CXP-14 reliability regression: an error before the worker can construct any
// auditable metadata must never be represented as a successfully recorded audit.
test('preflight failure without an auditable checkpoint remains AUDIT_PENDING', () => {
  const properties = propertyStore();
  const { scriptApp, triggers } = triggerApp();
  let auditCalls = 0;
  const controller = Pipeline.create({
    handler: 'continueUnauditablePreflight',
    stateKey: 'UNAUDITABLE_PREFLIGHT_STATE',
    executorFactory: () => ({
      hasFailureCheckpoint: () => false,
      prepare() { throw ErrorCodes.create('LIFECYCLE_TARGET_UNAVAILABLE'); },
      auditFailure() { auditCalls += 1; },
    }),
  });
  const deps = {
    clock: { now: () => new Date('2026-09-09T00:00:00.000Z') },
    properties,
    scriptApp,
  };

  controller.start({ environment: 'UAT' }, deps);
  assert.throws(
    () => controller.continueRun(deps),
    (error) => error?.code === 'LIFECYCLE_TARGET_UNAVAILABLE',
  );

  const failed = controller.getStatus(deps);
  assert.equal(auditCalls, 0);
  assert.equal(failed.failureAuditStatus, 'PENDING');
  assert.equal(failed.auditActionRequired, true);
  assert.equal(failed.lastAuditErrorCode, 'INGESTION_INVALID_RUN_METADATA');
  assert.equal(triggers.length, 0);
});

// CXP-14 reliability regression: a one-shot continuation that loses the outer
// controller lock must install one replacement instead of stranding the run.
test('outer controller lock contention creates exactly one 90000 ms successor', () => {
  const properties = propertyStore();
  const delays = [];
  const triggers = [];
  let triggerSequence = 0;
  const scriptApp = {
    deleteTrigger(trigger) {
      const index = triggers.indexOf(trigger);
      if (index >= 0) triggers.splice(index, 1);
    },
    getProjectTriggers: () => triggers.slice(),
    newTrigger(handler) {
      let delayMs = null;
      return {
        timeBased() { return this; },
        after(value) { delayMs = value; return this; },
        create() {
          delays.push(delayMs);
          const id = `contention-${++triggerSequence}`;
          const trigger = {
            getHandlerFunction: () => handler,
            getUniqueId: () => id,
          };
          triggers.push(trigger);
          return trigger;
        },
      };
    },
  };
  let lockAttempt = 0;
  const lockService = {
    getScriptLock() {
      return {
        releaseLock() {},
        tryLock() {
          lockAttempt += 1;
          return lockAttempt === 1;
        },
      };
    },
  };
  const controller = Pipeline.create({
    handler: 'continueContendedRun',
    stateKey: 'CONTENDED_RUN_STATE',
    executorFactory: () => ({ prepare() { throw new Error('must not execute while contended'); } }),
  });
  const deps = {
    clock: { now: () => new Date('2026-09-09T00:00:00.000Z') },
    lockService,
    properties,
    scriptApp,
  };

  controller.start({ environment: 'UAT', runId: 'run-contention' }, deps);
  assert.deepEqual(delays, [1000]);
  const result = controller.continueRun(deps);

  assert.equal(result.status, 'QUEUED');
  assert.equal(result.runId, 'run-contention');
  assert.equal(result.continuationScheduled, true);
  assert.deepEqual(delays, [1000, 90000]);
  assert.equal(triggers.length, 1);
});

test('genuine audit-write failure stays AUDIT_PENDING with zero triggers until retryCxp13FailureAudit', () => {
  const properties = propertyStore();
  const { scriptApp, triggers } = triggerApp();
  const checkpoint = preparedCheckpoint();
  let auditCalls = 0;
  let commitCalls = 0;
  const controller = Pipeline.create({
    handler: 'continueCxp13Ingestion',
    stateKey: 'AUDIT_PENDING_STATE',
    executorFactory: () => ({
      auditFailure() {
        auditCalls += 1;
        throw ErrorCodes.create('REPORTING_LOG_WRITE_FAILED', { details: { reason: 'control_sheet_unavailable' } });
      },
      backup() {
        throw ErrorCodes.create('MIGRATION_COMMIT_FAILED', {
          details: { originalErrorCode: 'MIGRATION_BACKUP_FAILED', rollbackStatus: 'VERIFIED' },
        });
      },
      commit() { commitCalls += 1; },
      prepare: () => ({ checkpoint }),
    }),
  });
  const deps = { clock: { now: () => new Date('2026-09-08T13:00:00.000Z') }, properties, scriptApp };
  controller.start({ environment: 'UAT' }, deps);
  controller.continueRun(deps);
  assert.throws(() => controller.continueRun(deps), (error) => error?.code === 'MIGRATION_COMMIT_FAILED');
  const pending = controller.getStatus(deps);
  assert.equal(pending.failureAuditStatus, 'PENDING');
  assert.equal(pending.auditActionRequired, true);
  assert.equal(pending.lastAuditErrorCode, 'REPORTING_LOG_WRITE_FAILED');
  assert.equal(triggers.length, 0);
  assert.equal(auditCalls, 1);
  const stray = controller.continueRun(deps);
  assert.equal(stray.failureAuditStatus, 'PENDING');
  assert.equal(auditCalls, 1);
  assert.equal(commitCalls, 0);
  assert.equal(triggers.length, 0);
  const retried = controller.retryFailureAudit(deps);
  assert.equal(retried.failureAuditStatus, 'PENDING');
  assert.equal(auditCalls, 2);
  assert.equal(triggers.length, 0);
  const recovered = Pipeline.create({
    handler: 'continueCxp13Ingestion',
    stateKey: 'AUDIT_PENDING_STATE',
    executorFactory: () => ({
      auditFailure() { auditCalls += 1; },
    }),
  }).retryFailureAudit(deps);
  assert.equal(recovered.failureAuditStatus, 'RECORDED');
  assert.equal(recovered.auditActionRequired, false);
  assert.equal(triggers.length, 0);
});

test('stray executions after FAILED/RECORDED or COMPLETE strip matching triggers and skip work', () => {
  const properties = propertyStore();
  const { scriptApp, triggers } = triggerApp();
  let prepareCalls = 0;
  let backupCalls = 0;
  let commitCalls = 0;
  let rollbackCalls = 0;
  let auditCalls = 0;
  const controller = Pipeline.create({
    handler: 'continueCxp13Ingestion',
    stateKey: 'STRAY_STATE',
    executorFactory: () => ({
      auditFailure() { auditCalls += 1; },
      backup() { backupCalls += 1; return { complete: true, createdDatasetName: 'Staff' }; },
      commit() {
        commitCalls += 1;
        return { runRecord: { endedAtUtc: '2026-09-08T13:20:00.000Z', status: 'SUCCESS' } };
      },
      prepare() {
        prepareCalls += 1;
        return { checkpoint: { data: {}, request: {}, runId: 'run-complete', startedAtUtc: '2026-09-08T13:00:00.000Z' } };
      },
      rollback() { rollbackCalls += 1; return { complete: true, rollbackStatus: 'VERIFIED' }; },
    }),
  });
  const deps = { clock: { now: () => new Date('2026-09-08T13:00:00.000Z') }, properties, scriptApp };
  controller.start({ environment: 'UAT' }, deps);
  controller.continueRun(deps);
  controller.continueRun(deps);
  assert.equal(controller.continueRun(deps).status, 'COMPLETE');
  scriptApp.newTrigger('continueCxp13Ingestion').timeBased().after(1000).create();
  assert.equal(triggers.length, 1);
  const completeCounts = { prepareCalls, backupCalls, commitCalls, rollbackCalls, auditCalls };
  assert.equal(controller.continueRun(deps).status, 'COMPLETE');
  assert.equal(triggers.length, 0);
  assert.deepEqual({ prepareCalls, backupCalls, commitCalls, rollbackCalls, auditCalls }, completeCounts);

  properties.setProperty('STRAY_STATE', JSON.stringify({
    checkpoint: { data: {}, request: {}, runId: 'run-failed', startedAtUtc: '2026-09-08T13:00:00.000Z' },
    failureAuditStatus: 'RECORDED',
    generation: 4,
    status: 'FAILED',
    version: 2,
  }));
  scriptApp.newTrigger('continueCxp13Ingestion').timeBased().after(1000).create();
  assert.equal(controller.continueRun(deps).status, 'FAILED');
  assert.equal(triggers.length, 0);
  assert.deepEqual({ prepareCalls, backupCalls, commitCalls, rollbackCalls, auditCalls }, completeCounts);
});

test('watchdog settles below 375000ms and adopts at the 375000ms threshold', () => {
  const properties = propertyStore();
  const { scriptApp, triggers } = triggerApp();
  let commitCalls = 0;
  const controller = Pipeline.create({
    handler: 'continueCxp13Ingestion',
    stateKey: 'WATCHDOG_STATE',
    executorFactory: () => ({
      commit() {
        commitCalls += 1;
        return { commitProgress: { complete: true, lastCompletedDatasetName: 'Staff', nextDatasetIndex: 5 } };
      },
    }),
  });
  const started = Date.parse('2026-09-08T13:00:00.000Z');
  properties.setProperty('WATCHDOG_STATE', JSON.stringify({
    checkpoint: {
      data: { commitProgress: { complete: false, lastCompletedDatasetName: null, nextDatasetIndex: 0 } },
      request: {},
      runId: 'run-watchdog',
      startedAtUtc: '2026-09-08T13:00:00.000Z',
    },
    generation: 1,
    phaseStartedAtUtc: '2026-09-08T13:00:00.000Z',
    status: 'COMMITTING',
    version: 2,
  }));
  const below = { clock: { now: () => new Date(started + 374999) }, properties, scriptApp };
  const settled = controller.continueRun(below);
  assert.equal(settled.status, 'COMMITTING');
  assert.equal(settled.continuationScheduled, true);
  assert.equal(commitCalls, 0);
  assert.equal(triggers.length, 1);
  const adopted = controller.continueRun({ clock: { now: () => new Date(started + 375000) }, properties, scriptApp });
  assert.equal(commitCalls, 1);
  assert.equal(adopted.status, 'COMMIT_PENDING');
  assert.equal(JSON.parse(properties.getProperty('WATCHDOG_STATE')).generation > 1, true);
});

test('stale worker A cannot recreate a trigger after worker B claims a newer generation', () => {
  const properties = propertyStore();
  const { scriptApp, triggers } = triggerApp();
  let backupCalls = 0;
  const controller = Pipeline.create({
    handler: 'continueCxp13Ingestion',
    stateKey: 'FENCE_STATE',
    executorFactory: () => ({
      backup() {
        backupCalls += 1;
        const latest = JSON.parse(properties.getProperty('FENCE_STATE'));
        latest.generation = (latest.generation || 1) + 1;
        properties.setProperty('FENCE_STATE', JSON.stringify(latest));
        return { complete: true, createdDatasetName: 'Handled' };
      },
      prepare: () => ({ checkpoint: { data: {}, request: {}, runId: 'run-fence', startedAtUtc: '2026-09-08T13:00:00.000Z' } }),
    }),
  });
  const deps = { clock: { now: () => new Date('2026-09-08T13:00:00.000Z') }, properties, scriptApp };
  controller.start({ environment: 'UAT' }, deps);
  controller.continueRun(deps);
  const claimedGeneration = JSON.parse(properties.getProperty('FENCE_STATE')).generation;
  const afterA = controller.continueRun(deps);
  const persisted = JSON.parse(properties.getProperty('FENCE_STATE'));
  assert.equal(backupCalls, 1);
  assert.equal(persisted.generation > claimedGeneration, true);
  assert.equal(persisted.status, 'BACKING_UP');
  assert.notEqual(afterA.status, 'COMMIT_PENDING');
  assert.equal(triggers.length, 1);
});

test('a stale worker failure cannot overwrite a newer generation or delete its trigger', () => {
  const properties = propertyStore();
  const { scriptApp, triggers } = triggerApp();
  let auditCalls = 0;
  const controller = Pipeline.create({
    handler: 'continueCxp13Ingestion',
    stateKey: 'STALE_FAILURE_STATE',
    executorFactory: () => ({
      auditFailure() { auditCalls += 1; },
      backup() {
        const successor = JSON.parse(properties.getProperty('STALE_FAILURE_STATE'));
        successor.generation += 1;
        successor.status = 'BACKUP_PENDING';
        properties.setProperty('STALE_FAILURE_STATE', JSON.stringify(successor));
        throw ErrorCodes.create('MIGRATION_BACKUP_FAILED', {
          details: { datasetName: 'Handled', operation: 'verify_backup_dataset' },
        });
      },
      prepare: () => ({ checkpoint: {
        data: {}, request: {}, runId: 'run-stale-failure',
        startedAtUtc: '2026-09-08T13:00:00.000Z',
      } }),
    }),
  });
  const deps = { clock: { now: () => new Date('2026-09-08T13:00:00.000Z') }, properties, scriptApp };
  controller.start({ environment: 'UAT' }, deps);
  controller.continueRun(deps);
  const result = controller.continueRun(deps);
  const persisted = JSON.parse(properties.getProperty('STALE_FAILURE_STATE'));
  assert.equal(result.status, 'BACKUP_PENDING');
  assert.equal(persisted.status, 'BACKUP_PENDING');
  assert.equal(persisted.lastErrorCode, null);
  assert.equal(auditCalls, 0);
  assert.equal(triggers.length, 1);
});

test('completed dataset progress clears the stale raw cursor before the next dataset is authoritative', () => {
  const properties = propertyStore();
  const { scriptApp } = triggerApp();
  properties.setProperty('AUTHORITATIVE_CURSOR_STATE', JSON.stringify({
    checkpoint: {
      data: {
        commitCursor: { chunkRows: 1000, nextRow: 5001, phase: 'verify' },
        commitProgress: {
          commitCursor: { chunkRows: 1000, nextRow: 5001, phase: 'verify' },
          complete: false,
          lastCompletedDatasetName: null,
          nextDatasetIndex: 0,
        },
      },
      request: {},
      runId: 'run-authoritative-cursor',
      startedAtUtc: '2026-09-08T13:00:00.000Z',
    },
    generation: 1,
    status: 'COMMIT_PENDING',
    version: 2,
  }));
  const controller = Pipeline.create({
    handler: 'continueCxp13Ingestion',
    stateKey: 'AUTHORITATIVE_CURSOR_STATE',
    executorFactory: () => ({
      commit: () => ({ commitProgress: {
        complete: true,
        lastCompletedDatasetName: 'Staff',
        nextDatasetIndex: 5,
      } }),
    }),
  });
  controller.continueRun({
    clock: { now: () => new Date('2026-09-08T13:00:00.000Z') },
    properties,
    scriptApp,
  });
  const persisted = JSON.parse(properties.getProperty('AUTHORITATIVE_CURSOR_STATE'));
  assert.equal(persisted.checkpoint.data.commitCursor, undefined);
  assert.equal(persisted.checkpoint.data.commitProgress.complete, true);
  assert.equal(persisted.checkpoint.data.commitProgress.nextDatasetIndex, 5);
});

test('backup copy and verify chunks resume idempotently without skipping rows', () => {
  const owner = new FakeUser('owner@example.test');
  const payload = normalizedPayload('Handled', 2500);
  const spreadsheet = new FakeSpreadsheet([owner]);
  DatasetSheets.listBindings().forEach((binding) => {
    const rows = binding.datasetName === 'Handled' ? matrixFor(payload) : matrixFor(normalizedPayload(binding.datasetName, 1));
    spreadsheet.addSheet(binding.rawSheetName, rows);
  });
  let copies = 0;
  const backup = BackupRepository.create(spreadsheet, {
    ...protectionServices(owner),
    observer: {
      afterCopy() {
        copies += 1;
        if (copies === 1) throw new Error('interrupt after backup-copy');
      },
    },
  });
  assert.throws(
    () => backup.copyDatasetChunk('run-chunk', 'Handled', { chunkRows: 1000, nextRow: 1, phase: 'copy' }),
    (error) => error?.code === 'MIGRATION_BACKUP_FAILED' && error.details.causeMessage === 'interrupt after backup-copy',
  );
  const resumedCopy = backup.copyDatasetChunk('run-chunk', 'Handled', { chunkRows: 1000, nextRow: 1, phase: 'copy' });
  assert.equal(resumedCopy.backupCursor.phase, 'verify');
  assert.equal(resumedCopy.datasetComplete, false);
  const verified = backup.copyDatasetChunk('run-chunk', 'Handled', resumedCopy.backupCursor);
  assert.equal(verified.backupCursor.phase, 'copy');
  assert.equal(verified.backupCursor.nextRow, 1001);
  let cursor = verified.backupCursor;
  let guard = 0;
  while (!cursor || cursor.phase !== 'complete') {
    guard += 1;
    assert.equal(guard < 20, true);
    const result = backup.copyDatasetChunk('run-chunk', 'Handled', cursor);
    if (result.datasetComplete) {
      assert.equal(spreadsheet.getSheetByName('_CXP06_BAK_HANDLED_run-chunk').values.length, matrixFor(payload).length);
      assert.equal(SheetValueCodec.matricesEqual(
        spreadsheet.getSheetByName('_CXP06_BAK_HANDLED_run-chunk').values,
        matrixFor(payload),
      ), true);
      return;
    }
    cursor = result.backupCursor;
  }
});

test('raw clear write and verify chunks restore last-known-good through rollback windows', () => {
  const owner = new FakeUser('owner@example.test');
  const original = normalizedPayload('Handled', 2500);
  const incoming = normalizedPayload('Handled', 2500);
  incoming.records = incoming.records.map((record, index) => Object.assign({}, record, {
    [incoming.headers[1]]: `${record[incoming.headers[1]]}-new-${index}`,
  }));
  const spreadsheet = new FakeSpreadsheet([owner]);
  DatasetSheets.listBindings().forEach((binding) => {
    const payload = binding.datasetName === 'Handled' ? original : normalizedPayload(binding.datasetName, 1);
    spreadsheet.addSheet(binding.rawSheetName, matrixFor(payload));
  });
  const backup = BackupRepository.create(spreadsheet, protectionServices(owner));
  let cursor = { nextRow: 1, phase: 'copy' };
  for (;;) {
    const result = backup.copyDatasetChunk('run-rollback', 'Handled', cursor);
    if (result.datasetComplete) break;
    cursor = result.backupCursor;
  }
  DatasetSheets.listBindings().slice(1).forEach((binding) => {
    backup.copyDatasetChunk('run-rollback', binding.datasetName, { nextRow: 1, phase: 'copy' });
    backup.copyDatasetChunk('run-rollback', binding.datasetName, { nextRow: 1, phase: 'verify' });
  });
  const group = backup.discoverGroups()[0];
  let cleared = false;
  let wrote = false;
  let verified = false;
  const raw = RawDataRepository.create(spreadsheet, {
    observer: {
      afterRawClear() { if (!cleared) { cleared = true; throw new Error('interrupt after raw-clear'); } },
      afterRawWrite() { if (!wrote) { wrote = true; throw new Error('interrupt after raw-write'); } },
      afterRawVerify() { if (!verified) { verified = true; throw new Error('interrupt after raw-verify'); } },
    },
  });
  assert.throws(
    () => raw.replacePayloadChunk(incoming, { nextRow: 1, phase: 'clear' }, { preflightVerified: true }),
    (error) => error?.code === 'MIGRATION_COMMIT_FAILED' && error.details.causeMessage === 'interrupt after raw-clear',
  );
  const afterClear = raw.replacePayloadChunk(incoming, { chunkRows: 1000, nextRow: 1, phase: 'clear' }, { preflightVerified: true });
  assert.equal(afterClear.cursor.phase, 'write');
  assert.throws(
    () => raw.replacePayloadChunk(incoming, afterClear.cursor, { preflightVerified: true }),
    (error) => error?.code === 'MIGRATION_COMMIT_FAILED' && error.details.causeMessage === 'interrupt after raw-write',
  );
  const afterWrite = raw.replacePayloadChunk(incoming, afterClear.cursor, { preflightVerified: true });
  assert.equal(afterWrite.cursor.phase, 'verify');
  assert.throws(
    () => raw.replacePayloadChunk(incoming, afterWrite.cursor, { preflightVerified: true }),
    (error) => error?.code === 'MIGRATION_COMMIT_FAILED' && error.details.causeMessage === 'interrupt after raw-verify',
  );
  const afterVerify = raw.replacePayloadChunk(incoming, afterWrite.cursor, { preflightVerified: true });
  assert.equal(afterVerify.cursor.phase, 'write');
  let writeCursor = afterVerify.cursor;
  while (!writeCursor || writeCursor.phase !== 'complete') {
    const result = raw.replacePayloadChunk(incoming, writeCursor, { preflightVerified: true });
    if (result.datasetComplete) break;
    writeCursor = result.cursor;
  }
  assert.equal(SheetValueCodec.matricesEqual(raw.readOne('Handled').values, matrixFor(incoming)), true);

  let restored = false;
  const rollback = RollbackService.create({
    backupRepository: backup,
    flush() {},
    ledgerRepository: { findSuccessfulByRunId() { return null; } },
    rawRepository: RawDataRepository.create(spreadsheet, {
      observer: {
        afterRestoreWrite() {
          if (!restored) {
            restored = true;
            throw new Error('interrupt after rollback chunk');
          }
        },
      },
    }),
  });
  assert.throws(
    () => rollback.rollbackStep(group, { datasetIndex: 0, nextRow: 1, phase: 'restore' }),
    (error) => error?.code === 'MIGRATION_ROLLBACK_FAILED' && error.details.causeMessage === 'interrupt after rollback chunk',
  );
  let rollbackCursor = { datasetIndex: 0, nextRow: 1, phase: 'restore' };
  let complete = false;
  for (let i = 0; i < 40; i += 1) {
    const result = rollback.rollbackStep(group, rollbackCursor);
    if (result.complete) {
      complete = true;
      assert.equal(result.rollbackStatus, 'VERIFIED');
      break;
    }
    rollbackCursor = result.rollbackCursor;
  }
  assert.equal(complete, true);
  assert.equal(SheetValueCodec.matricesEqual(
    RawDataRepository.create(spreadsheet).readOne('Handled').values,
    matrixFor(original),
  ), true);
});

// Hosted Sheets can return typed Date objects and numbers after writing the
// normalized ISO/text contract. Verification must compare by dataset schema,
// while still rejecting a genuinely changed persisted value.
test('raw chunk verification accepts Sheets coercion and fails closed on a genuine value change', () => {
  const owner = new FakeUser('owner@example.test');
  const payload = normalizedPayload('Handled', 1);
  payload.records[0]['Service Level Met'] = '1';
  payload.records[0]['End Time'] = null;
  const dateColumns = new Set([
    payload.headers.indexOf('Start Time') + 1,
    payload.headers.indexOf('Request Time') + 1,
    payload.headers.indexOf('Created Date') + 1,
  ]);
  const numericTextColumn = payload.headers.indexOf('Service Level Met') + 1;
  let corruptStartTime = false;
  const spreadsheet = new FakeSpreadsheet([owner], {
    readTransform(value, cell) {
      if (cell.sheetName !== '_RAW_HANDLED' || cell.row === 1) return value;
      if (dateColumns.has(cell.column) && typeof value === 'string' && value !== '') {
        const instant = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
        if (corruptStartTime && cell.column === payload.headers.indexOf('Start Time') + 1) {
          return new Date(instant.getTime() + 1000);
        }
        return instant;
      }
      if (cell.column === numericTextColumn && value === '1') return 1;
      return value;
    },
  });
  DatasetSheets.listBindings().forEach((binding) => {
    spreadsheet.addSheet(binding.rawSheetName, [['old']]);
  });
  const raw = RawDataRepository.create(spreadsheet);
  const cleared = raw.replacePayloadChunk(payload, null, { preflightVerified: true });
  const written = raw.replacePayloadChunk(payload, cleared.cursor, { preflightVerified: true });
  const verified = raw.replacePayloadChunk(payload, written.cursor, { preflightVerified: true });
  assert.equal(verified.datasetComplete, true);

  corruptStartTime = true;
  assert.throws(
    () => raw.replacePayloadChunk(payload, written.cursor, { preflightVerified: true }),
    (error) => error?.code === 'MIGRATION_COMMIT_FAILED' &&
      error.details.datasetName === 'Handled' &&
      error.details.operation === 'verify_raw_chunk' &&
      error.details.reason === 'raw_write_verify_failed',
  );
});

// Expected peak Handled has 5,000 records plus one header. The last one-row
// window must be durably verified and the cursor must advance beyond row 5,001.
test('raw chunking covers the 5,001-row Handled matrix without gaps or replay', () => {
  const owner = new FakeUser('owner@example.test');
  const payload = normalizedPayload('Handled', 5000);
  const spreadsheet = new FakeSpreadsheet([owner]);
  DatasetSheets.listBindings().forEach((binding) => {
    spreadsheet.addSheet(binding.rawSheetName, [['old']]);
  });
  const writeStarts = [];
  const verifyStarts = [];
  const raw = RawDataRepository.create(spreadsheet, {
    observer: {
      afterRawWrite(event) { writeStarts.push(event.startRow); },
      afterRawVerify(event) { verifyStarts.push(event.startRow); },
    },
  });
  let cursor = raw.replacePayloadChunk(payload, null, { preflightVerified: true }).cursor;
  let result;
  for (let guard = 0; guard < 20; guard += 1) {
    result = raw.replacePayloadChunk(payload, cursor, { preflightVerified: true });
    cursor = result.cursor;
    if (result.datasetComplete) break;
  }
  assert.equal(result.datasetComplete, true);
  assert.equal(cursor.phase, 'complete');
  assert.equal(cursor.nextRow, 5002);
  assert.deepEqual(writeStarts, [1, 5001]);
  assert.deepEqual(verifyStarts, writeStarts);
  assert.equal(spreadsheet.getSheetByName('_RAW_HANDLED').values.length, 5001);
  assert.equal(SheetValueCodec.matricesEqual(
    spreadsheet.getSheetByName('_RAW_HANDLED').values,
    matrixFor(payload),
  ), true);
});

test('date-time verification canonicalizes equivalent ISO offsets and Date readback', () => {
  const column = { name: 'Start Time', type: 'date_time' };
  assert.equal(SheetValueCodec.valuesEqualForColumn(
    column,
    '2026-09-09T08:00:00+08:00',
    new Date('2026-09-09T00:00:00.000Z'),
  ), true);
  assert.equal(SheetValueCodec.valuesEqualForColumn(
    column,
    '2026-09-09T08:00:01+08:00',
    new Date('2026-09-09T00:00:00.000Z'),
  ), false);
});

test('chunk rollback removes target rows beyond the last-known-good backup bounds', () => {
  const owner = new FakeUser('owner@example.test');
  const original = normalizedPayload('Handled', 1);
  const spreadsheet = new FakeSpreadsheet([owner]);
  DatasetSheets.listBindings().forEach((binding) => {
    const payload = binding.datasetName === 'Handled' ? original : normalizedPayload(binding.datasetName, 1);
    spreadsheet.addSheet(binding.rawSheetName, matrixFor(payload));
  });
  const backup = BackupRepository.create(spreadsheet, protectionServices(owner));
  let backupCursor = { nextRow: 1, phase: 'copy' };
  for (;;) {
    const result = backup.copyDatasetChunk('run-trailing', 'Handled', backupCursor);
    if (result.datasetComplete) break;
    backupCursor = result.backupCursor;
  }
  const group = backup.discoverGroups()[0];
  const rawSheet = spreadsheet.getSheetByName('_RAW_HANDLED');
  for (let index = 0; index < 2001; index += 1) {
    rawSheet.values.push(original.headers.map(() => `surplus-${index}`));
    rawSheet.formulas.push(original.headers.map(() => '=1'));
  }
  const raw = RawDataRepository.create(spreadsheet);
  let flushedSinceMutation = false;
  const rollback = RollbackService.create({
    backupRepository: backup,
    flush() { flushedSinceMutation = true; },
    ledgerRepository: { findSuccessfulByRunId() { return null; } },
    rawRepository: Object.assign({}, raw, {
      restoreDatasetChunk(...args) {
        const input = args[2];
        if (input && (input.phase === 'verify' || input.phase === 'trim_verify')) {
          assert.equal(flushedSinceMutation, true);
        }
        flushedSinceMutation = false;
        return raw.restoreDatasetChunk(...args);
      },
    }),
  });
  let cursor = { chunkRows: 1000, datasetIndex: 0, datasetName: 'Handled', nextRow: 1, phase: 'restore' };
  const trimHeights = [];
  for (;;) {
    if (cursor.phase === 'trim') cursor = { ...cursor, chunkRows: 5000 };
    const result = rollback.rollbackStep(group, cursor, { code: 'MIGRATION_COMMIT_FAILED' });
    if (cursor.phase === 'trim') {
      assert.equal(result.rollbackCursor.phase, 'trim_verify');
      assert.equal(result.rollbackCursor.tailEndRow, 2003);
      assert.equal(result.rollbackCursor.columnCount, original.headers.length);
    }
    if (cursor.phase === 'trim_verify') {
      const height = cursor.trimNextRow - cursor.nextRow;
      trimHeights.push(height);
      assert.equal(height * original.headers.length <= 50000, true);
    }
    cursor = result.rollbackCursor;
    if (cursor.datasetIndex === 1) break;
  }
  assert.deepEqual(trimHeights, [1851, 150]);
  assert.equal(SheetValueCodec.matricesEqual(rawSheet.values.slice(0, 2), matrixFor(original)), true);
  assert.equal(rawSheet.values.slice(2).every((row) => row.every((value) => value === '')), true);
  assert.equal(rawSheet.formulas.slice(2).every((row) => row.every((value) => value === '')), true);
});

test('CommitService holds ScriptLock across chunk rollback mutations', () => {
  const owner = new FakeUser('owner@example.test');
  const spreadsheet = new FakeSpreadsheet([owner]);
  DatasetSheets.listBindings().forEach((binding) => {
    spreadsheet.addSheet(binding.stagingSheetName, [['unused']]);
    spreadsheet.addSheet(binding.rawSheetName, matrixFor(normalizedPayload(binding.datasetName, 1)));
  });
  const backups = BackupRepository.create(spreadsheet, protectionServices(owner));
  DatasetSheets.listBindings().forEach((binding) => {
    let cursor = { nextRow: 1, phase: 'copy' };
    for (;;) {
      const result = backups.copyDatasetChunk('run-locked-rollback', binding.datasetName, cursor);
      if (result.datasetComplete) break;
      cursor = result.backupCursor;
    }
  });
  let held = false;
  let observedHeld = false;
  const lock = {
    releaseLock() { held = false; },
    tryLock() { held = true; return true; },
  };
  const operations = CommitService.createOperations({
    clock: { now: () => new Date('2026-09-09T00:00:00.000Z') },
    decorateRawRepository(repository) {
      return Object.assign({}, repository, {
        restoreDatasetChunk(...args) {
          observedHeld = held;
          return repository.restoreDatasetChunk(...args);
        },
      });
    },
    flush() {},
    ledgerRepository: {
      append() {},
      findSuccessfulByFingerprint() { return null; },
      findSuccessfulByRunId() { return null; },
    },
    lockService: { getScriptLock: () => lock },
    session: { getEffectiveUser: () => owner },
    spreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
    targetSpreadsheet: spreadsheet,
  });
  const context = {
    operationResults: {},
    pendingFailure: { code: 'MIGRATION_COMMIT_FAILED', details: {} },
    request: { schemaVersion: '1.0.0' },
    runId: 'run-locked-rollback',
    startedAtUtc: '2026-09-09T00:00:00.000Z',
  };
  const checkpointData = {
    backupRunId: context.runId,
    datasetNames: DatasetSheets.listBindings().map((binding) => binding.datasetName),
    fingerprint: 'sha256:locked-rollback',
    sourceFiles: [],
  };
  operations.resumeBackup(context, checkpointData);
  spreadsheet.getSheetByName('_RAW_HANDLED').values[1][0] = 'changed';
  operations.rollbackChunk(context, { datasetIndex: 0, datasetName: 'Handled', nextRow: 1, phase: 'restore' });
  assert.equal(observedHeld, true);
  assert.equal(held, false);
});

test('CXP13 preparation parses and acquires input only once per executor invocation', () => {
  const calls = { checkDuplicate: 0, parse: 0, runtime: 0, validateFile: 0, validateSchema: 0 };
  let stageCalls = 0;
  const payload = normalizedPayload('Handled', 1500);
  const runtime = {
    operations: {
      checkDuplicate() { calls.checkDuplicate += 1; return { fingerprint: 'sha256:once', sourceFiles: [] }; },
      parse() { calls.parse += 1; return { packagingKind: 'five_file_bundle' }; },
      stageChunk() {
        stageCalls += 1;
        return stageCalls === 1
          ? { complete: false, prepareCursor: { chunkRows: 1000, columnCount: payload.headers.length, datasetIndex: 0, datasetName: 'Handled', nextRow: 1001, phase: 'write' } }
          : { complete: true, prepareCursor: null };
      },
      validateFile() { calls.validateFile += 1; return { accepted: true }; },
      validateSchema() { calls.validateSchema += 1; return { payloads: [payload] }; },
      validateStage() { return { datasetCount: 1 }; },
    },
    request: {
      inputRowCounts: {}, outputRowCounts: {}, schemaVersion: '1.0.0', sourceActor: 'domain-user',
      sourceFileId: 'inbox:test', sourceFileName: 'cxp13-inbox-bundle', targetWorkbookId: 'target',
    },
    runServices: { flush() {}, generateRunId: () => 'run-prepare-once' },
  };
  const state = { runId: 'run-prepare-once' };
  const executor = Cxp13Runtime.executorFactory(state, {
    clock: { now: () => new Date('2026-09-09T00:00:00.000Z') },
    runtimeFactory() { calls.runtime += 1; return runtime; },
  });
  const first = executor.prepare(state);
  state.checkpoint = first.checkpoint;
  const second = executor.prepare(state);
  assert.equal(second.complete, true);
  assert.deepEqual(calls, { checkDuplicate: 1, parse: 1, runtime: 1, validateFile: 1, validateSchema: 1 });
  assert.equal(stageCalls, 2);
});

test('CXP13 resumed five-file preparation reacquires only the current dataset', () => {
  const base = preparedCheckpoint();
  const datasetNames = DatasetSheets.listBindings().map((binding) => binding.datasetName);
  const checkpoint = Object.freeze(Object.assign({}, base, {
    data: Object.freeze({
      datasetNames,
      fingerprint: 'sha256:resume-current-only',
      prepareCursor: Object.freeze({ datasetIndex: 1, datasetName: 'Offered', nextRow: 1, phase: 'clear' }),
      rowCounts: Object.freeze({ Handled: 5000 }),
      sourceFiles: Object.freeze(datasetNames.map((datasetName) => Object.freeze({
        contentFingerprint: `sha256:${datasetName}`,
        datasetName,
        fileId: `file-${datasetName}`,
        format: 'xlsx',
        lastUpdatedUtc: '2026-09-09T00:00:00.000Z',
        sizeBytes: 100,
      }))),
    }),
  }));
  const requested = [];
  const offered = normalizedPayload('Offered', 3);
  const runtime = {
    operations: {
      checkDuplicate() { throw new Error('full duplicate validation must not replay'); },
      parse() { throw new Error('the complete bundle must not be parsed again'); },
      prepareSingleDataset(context, checkpointData, datasetName) {
        requested.push(datasetName);
        assert.equal(checkpointData.fingerprint, 'sha256:resume-current-only');
        return { payload: offered };
      },
      stageChunk(context) {
        assert.deepEqual(context.operationResults.validateSchema.datasetNames, datasetNames);
        assert.deepEqual(context.operationResults.validateSchema.payloads.map((payload) => payload.datasetName), ['Offered']);
        return { complete: false, prepareCursor: { datasetIndex: 2, datasetName: 'AHT - Raw', nextRow: 1, phase: 'clear' } };
      },
      validateFile() { throw new Error('the complete bundle must not be reacquired'); },
      validateSchema() { throw new Error('the complete bundle schema must not be revalidated'); },
    },
    request: base.request,
    runServices: { flush() {}, generateRunId: () => checkpoint.runId },
  };
  const state = { checkpoint, packagingKind: 'single_dataset', runId: checkpoint.runId };
  const executor = Cxp13Runtime.executorFactory(state, {
    clock: { now: () => new Date('2026-09-09T00:00:00.000Z') },
    runtimeFactory: () => runtime,
  });

  const result = executor.prepare(state);

  assert.deepEqual(requested, ['Offered']);
  assert.deepEqual(result.checkpoint.data.rowCounts, { Handled: 5000, Offered: 3 });
});

test('CXP13 preparation exposes a failure checkpoint before the first validation completes', () => {
  const runtime = {
    operations: {
      validateFile() { throw ErrorCodes.create('SOURCE_INBOX_BUNDLE_INCOMPLETE'); },
    },
    request: {
      inputRowCounts: {}, outputRowCounts: {}, schemaVersion: '1.0.0', sourceActor: 'domain-user',
      sourceFileId: 'inbox:test', sourceFileName: 'cxp13-inbox-bundle', targetWorkbookId: 'target',
    },
    runServices: { generateRunId: () => 'run-preparation-checkpoint' },
  };
  const executor = Cxp13Runtime.executorFactory({ runId: 'run-preparation-checkpoint' }, {
    clock: { now: () => new Date('2026-09-09T00:00:00.000Z') },
    runtimeFactory: () => runtime,
  });
  assert.throws(() => executor.prepare({ checkpoint: null }), { code: 'SOURCE_INBOX_BUNDLE_INCOMPLETE' });
  assert.equal(executor.hasFailureCheckpoint(), true);
});

test('CXP13 preparation establishes an auditable checkpoint before runtime workbook preflight', () => {
  const executor = Cxp13Runtime.executorFactory({
    batchToken: '20260909T000000Z',
    packagingKind: 'single_dataset',
    runId: 'run-context-preflight',
    targetWorkbookId: 'target-id',
  }, {
    clock: { now: () => new Date('2026-09-09T00:00:00.000Z') },
    runtimeFactory() {
      throw ErrorCodes.create('LIFECYCLE_TARGET_UNAVAILABLE');
    },
  });

  assert.throws(
    () => executor.prepare({ checkpoint: null }),
    (error) => error?.code === 'LIFECYCLE_TARGET_UNAVAILABLE',
  );
  assert.equal(executor.hasFailureCheckpoint(), true);
});

test('control-workbook audit failure attaches the minimal checkpoint for manual retry', () => {
  const properties = propertyStore();
  properties.setProperty('CXP_ENV', 'UAT');
  properties.setProperty('CXP_UAT_CONTROL_SPREADSHEET_ID', 'control-id');
  properties.setProperty('CXP_UAT_TARGET_SPREADSHEET_ID', 'target-id');
  const state = {
    batchToken: '20260909T000000Z',
    checkpoint: null,
    packagingKind: 'single_dataset',
    runId: 'run-control-preflight',
    targetWorkbookId: 'target-id',
  };
  const executor = Cxp13Runtime.executorFactory(state, {
    clock: { now: () => new Date('2026-09-09T00:00:00.000Z') },
    properties,
    runtimeFactory() {
      throw ErrorCodes.create('LIFECYCLE_CONTROL_UNAVAILABLE');
    },
    spreadsheetApp: {
      openById() { throw new Error('control unavailable'); },
    },
  });

  assert.throws(
    () => executor.prepare(state),
    (error) => error?.code === 'LIFECYCLE_CONTROL_UNAVAILABLE',
  );
  assert.throws(() => executor.auditFailure(state, ErrorCodes.create('LIFECYCLE_CONTROL_UNAVAILABLE')));
  assert.equal(state.checkpoint?.runId, 'run-control-preflight');
  assert.equal(state.checkpoint?.stateHistory.at(-1)?.state, 'VALIDATING_FILE');
});

test('CXP13 final success persists authoritative checkpoint row counts', () => {
  const persisted = [];
  const rowCounts = {
    Handled: 5000,
    Offered: 5000,
    'AHT - Raw': 7000,
    'Auxes - Raw': 3000,
    Staff: 300,
  };
  const base = preparedCheckpoint();
  const checkpoint = Object.freeze(Object.assign({}, base, {
    data: Object.freeze({
      datasetNames: Object.keys(rowCounts),
      healthCursor: Object.freeze({ nextDatasetIndex: 5 }),
      rowCounts: Object.freeze(rowCounts),
    }),
  }));
  const operations = Object.assign(operationsWith(), {
    healthDatasetStep() { throw new Error('health dataset step must already be complete'); },
    healthFinalize() { return { status: 'HEALTHY' }; },
    resumeBackup() {},
  });
  const lock = {
    releaseLock() {},
    tryLock() { return true; },
  };
  const runtime = {
    operations,
    request: base.request,
    runServices: {
      clock: { now: () => new Date('2026-09-09T00:00:00.000Z') },
      flush() {},
      lockService: { getScriptLock: () => lock },
      repository: { persist(runRecords) { persisted.push(...runRecords); } },
    },
  };
  const executor = Cxp13Runtime.executorFactory({ runId: checkpoint.runId }, {
    clock: runtime.runServices.clock,
    runtimeFactory: () => runtime,
  });

  const result = executor.health({ checkpoint });

  assert.equal(result.runRecord.status, 'SUCCESS');
  assert.deepEqual(result.runRecord.inputRowCounts, rowCounts);
  assert.deepEqual(result.runRecord.outputRowCounts, rowCounts);
  assert.deepEqual(persisted[0].inputRowCounts, rowCounts);
  assert.deepEqual(persisted[0].outputRowCounts, rowCounts);
  assert.deepEqual(base.request.inputRowCounts, {});
  assert.deepEqual(base.request.outputRowCounts, {});
});

// CXP-14 recovery regression: protected backup cleanup is a post-audit action.
// A failed terminal RUN_LOG write must leave that recovery callback untouched.
test('terminal SUCCESS audit is durable before backup cleanup and audit failure retains recovery', () => {
  function terminalOperations(events) {
    return Object.assign(operationsWith(), {
      cleanupAfterSuccess() {
        events.push('backup-delete');
        return { backupCleanupStatus: 'DELETED' };
      },
      resume() { events.push('resume-backup'); },
    });
  }
  function runServices(events, persist) {
    return {
      clock: { now: () => new Date('2026-09-09T00:10:00.000Z') },
      flush() {},
      lockService: {
        getScriptLock: () => ({ releaseLock() {}, tryLock: () => true }),
      },
      repository: { persist },
    };
  }

  const failedEvents = [];
  assert.throws(
    () => RunService.resume(
      preparedCheckpoint(),
      terminalOperations(failedEvents),
      runServices(failedEvents, (runRecords) => {
        failedEvents.push(`audit-${runRecords[0].status}`);
        throw ErrorCodes.create('REPORTING_LOG_WRITE_FAILED');
      }),
    ),
  );
  assert.equal(failedEvents.includes('backup-delete'), false);
  assert.equal(failedEvents.includes('audit-SUCCESS'), true);

  const successEvents = [];
  const succeeded = RunService.resume(
    preparedCheckpoint(),
    terminalOperations(successEvents),
    runServices(successEvents, (runRecords) => {
      successEvents.push(`audit-${runRecords[0].status}`);
    }),
  );
  assert.equal(succeeded.runRecord.status, 'SUCCESS');
  assert.ok(successEvents.indexOf('audit-SUCCESS') < successEvents.indexOf('backup-delete'));
  assert.equal(succeeded.operationResults.healthCheck.backupCleanupStatus, 'DELETED');
});
