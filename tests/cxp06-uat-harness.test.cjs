const assert = require('node:assert/strict');
const test = require('node:test');

const Cxp06FaultInjector = require('../src/uat/Cxp06FaultInjector.js');
const Cxp06UatEvidence = require('../src/uat/Cxp06UatEvidence.js');
const Cxp06UatHarness = require('../src/uat/Cxp06UatHarness.js');
const Cxp06UatEntrypoints = require('../src/main/Cxp06UatEntrypoints.js');
const ErrorCodes = require('../src/monitoring/ErrorCodes.js');

function properties(values) {
  return {
    getProperty(name) {
      return Object.hasOwn(values, name) ? values[name] : null;
    },
  };
}

function mutableProperties(initialValues) {
  const values = new Map(Object.entries(initialValues));
  return {
    getProperty(name) {
      return values.has(name) ? values.get(name) : null;
    },
    setProperty(name, value) {
      values.set(name, String(value));
      return this;
    },
  };
}

function triggerService() {
  const events = [];
  const triggers = [];
  let nextId = 1;
  return {
    deleteTrigger(trigger) {
      const index = triggers.indexOf(trigger);
      if (index >= 0) {
        triggers.splice(index, 1);
        events.push(['delete', trigger.delayMs]);
      }
    },
    events,
    getProjectTriggers: () => triggers.slice(),
    newTrigger(handler) {
      const draft = { delayMs: null, handler };
      const builder = {
        after(delayMs) {
          draft.delayMs = delayMs;
          return builder;
        },
        create() {
          const uniqueId = `trigger-${nextId++}`;
          const trigger = {
            delayMs: draft.delayMs,
            getHandlerFunction: () => draft.handler,
            getUniqueId: () => uniqueId,
          };
          triggers.push(trigger);
          events.push(['create', draft.delayMs]);
          return trigger;
        },
        timeBased() {
          return builder;
        },
      };
      return builder;
    },
    triggers,
  };
}

function safeProperties(overrides = {}) {
  return properties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
    CXP_DEV_CONTROL_SPREADSHEET_ID: 'control-id',
    CXP_DEV_TARGET_SPREADSHEET_ID: 'target-id',
    CXP_UAT_HANDLED_FILE_ID: 'handled-id',
    CXP_UAT_OFFERED_FILE_ID: 'offered-id',
    CXP_UAT_AHT_FILE_ID: 'aht-id',
    CXP_UAT_AUXES_FILE_ID: 'auxes-id',
    CXP_UAT_STAFF_FILE_ID: 'staff-id',
    ...overrides,
  });
}

// Defect caught: a destructive UAT preparation or scenario can execute in PROD.
test('PROD is blocked and every UAT action requires the enable flag', () => {
  assert.throws(
    () => Cxp06UatHarness.requireSafetyGate(properties({
      CXP_ENV: 'PROD',
      CXP_UAT_ENABLED: 'true',
    })),
    /not available in PROD/,
  );
  assert.throws(
    () => Cxp06UatHarness.requireSafetyGate(properties({
      CXP_ENV: 'DEV',
      CXP_UAT_ENABLED: 'false',
    })),
    /CXP_UAT_ENABLED=true/,
  );
  assert.throws(
    () => Cxp06UatHarness.requireSafetyGate(properties({
      CXP_ENV: 'UNKNOWN',
      CXP_UAT_ENABLED: 'true',
    })),
    /requires DEV or UAT environment/,
  );
  assert.equal(Cxp06UatHarness.requireSafetyGate(safeProperties()).environment, 'DEV');
});

// Defect caught: the harness skips or duplicates a production operation callback.
test('composeOperations returns exactly the four input and five commit callbacks', () => {
  const calls = [];
  const input = Object.fromEntries(
    ['validateFile', 'parse', 'validateSchema', 'checkDuplicate'].map((name) => [
      name,
      () => calls.push(name),
    ]),
  );
  const commit = Object.fromEntries(
    ['stage', 'validateStage', 'commit', 'recalculate', 'healthCheck'].map((name) => [
      name,
      () => calls.push(name),
    ]),
  );
  const operations = Cxp06UatHarness.composeOperations(input, commit);
  assert.deepEqual(Object.keys(operations), [
    'validateFile',
    'parse',
    'validateSchema',
    'checkDuplicate',
    'stage',
    'validateStage',
    'commit',
    'recalculate',
    'healthCheck',
  ]);
  Object.values(operations).forEach((operation) => operation());
  assert.deepEqual(calls, Object.keys(operations));
});

// Defect caught: UAT invokes callbacks itself or uses a second orchestration path.
test('execute delegates the composed operations exactly once to RunService.execute', () => {
  const observed = [];
  const result = Cxp06UatHarness.execute({ scenario: 'PEAK_SUCCESS' }, {
    commitService: {
      createOperations() {
        return Object.fromEntries(
          ['stage', 'validateStage', 'commit', 'recalculate', 'healthCheck'].map((name) => [
            name,
            () => {},
          ]),
        );
      },
    },
    inputAdapter: {
      createOperations() {
        return Object.fromEntries(
          ['validateFile', 'parse', 'validateSchema', 'checkDuplicate'].map((name) => [
            name,
            () => {},
          ]),
        );
      },
    },
    runService: {
      execute(request, operations, services) {
        observed.push({ operations, request, services });
        return { runRecord: { runId: 'run-uat', status: 'SUCCESS' } };
      },
    },
    runServices: { marker: 'production-services' },
    request: { marker: 'production-request' },
  });
  assert.equal(observed.length, 1);
  assert.equal(Object.keys(observed[0].operations).length, 9);
  assert.equal(observed[0].request.marker, 'production-request');
  assert.equal(observed[0].services.marker, 'production-services');
  assert.equal(result.runRecord.status, 'SUCCESS');
});

// Defect caught: hosted CXP-06 starts commit in the exhausted preparation invocation instead of a fresh process.
test('hosted CXP-06 checkpoints preparation and completes commit through fresh continuations', () => {
  let Cxp06UatContinuation;
  try {
    Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  assert.equal(typeof Cxp06UatContinuation?.start, 'function');
  assert.equal(typeof Cxp06UatContinuation?.continueConfigured, 'function');

  const propertiesStore = mutableProperties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
  });
  const scriptApp = triggerService();
  const calls = [];
  const executor = {
    backup(state) {
      calls.push([
        'backup',
        state.checkpoint.runId,
        scriptApp.triggers.map((item) => item.delayMs),
      ]);
      return { complete: true, createdDatasetName: 'Staff' };
    },
    commit(state) {
      calls.push([
        'commit',
        state.checkpoint.runId,
        scriptApp.triggers.map((item) => item.delayMs),
      ]);
      return { runRecord: { runId: state.checkpoint.runId, status: 'SUCCESS' } };
    },
    prepare(scenario) {
      calls.push(['prepare', scenario, scriptApp.triggers.map((item) => item.delayMs)]);
      return {
        checkpoint: {
          data: { fingerprint: 'sha256:bounded', sourceFiles: [] },
          request: { targetWorkbookId: 'target-id' },
          runId: 'run-cxp06-continuation',
          startedAtUtc: '2026-08-25T10:20:49.000Z',
          stateHistory: [{ atUtc: '2026-08-25T10:22:41.000Z', state: 'VALIDATING_STAGE' }],
          version: 1,
        },
      };
    },
  };
  const services = {
    clock: { now: () => new Date('2026-08-25T10:22:42.000Z') },
    executor,
    properties: propertiesStore,
    scriptApp,
  };

  const first = Cxp06UatContinuation.start('CASE1_PEAK_SUCCESS', services);

  assert.equal(first.status, 'BACKUP_PENDING');
  assert.equal(first.continuationScheduled, true);
  assert.deepEqual(calls[0], ['prepare', 'CASE1_PEAK_SUCCESS', [420000]]);
  assert.equal(scriptApp.triggers.length, 1);
  assert.equal(scriptApp.triggers[0].delayMs, 1000);

  const repeated = Cxp06UatContinuation.start('CASE1_PEAK_SUCCESS', services);
  assert.equal(repeated.status, 'BACKUP_PENDING');
  assert.equal(calls.length, 1);
  assert.throws(
    () => Cxp06UatContinuation.start('CASE3_MID_COMMIT_FAILURE', services),
    /another scenario/,
  );

  const second = Cxp06UatContinuation.continueConfigured(services);

  assert.equal(second.status, 'COMMIT_PENDING');
  assert.equal(second.continuationScheduled, true);
  const third = Cxp06UatContinuation.continueConfigured(services);
  assert.equal(third.status, 'COMPLETE');
  assert.equal(third.continuationScheduled, false);
  assert.deepEqual(calls.slice(1), [
    ['backup', 'run-cxp06-continuation', [420000]],
    ['commit', 'run-cxp06-continuation', [420000]],
  ]);
  assert.equal(scriptApp.triggers.length, 0);
});

// Defect caught: firing the 4:30 safety trigger immediately re-enters a phase
// that can still be running under Apps Script's six-minute execution window.
test('hosted CXP-06 defers an in-progress phase until the timed-out invocation has settled', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  const phaseStartedAtMs = Date.parse('2026-08-25T12:00:00.000Z');
  let nowMs = phaseStartedAtMs + 270000;
  const propertiesStore = mutableProperties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
    CXP06_UAT_PIPELINE_STATE: JSON.stringify({
      checkpoint: {
        data: { backupRunId: 'run-settle' },
        request: { targetWorkbookId: 'target-id' },
        runId: 'run-settle',
        startedAtUtc: '2026-08-25T12:00:00.000Z',
        stateHistory: [],
        version: 1,
      },
      environment: 'DEV',
      lastErrorCode: null,
      scenario: 'CASE1_PEAK_SUCCESS',
      startedAtUtc: '2026-08-25T12:00:00.000Z',
      status: 'COMMITTING',
      updatedAtUtc: '2026-08-25T12:00:00.000Z',
      version: 1,
    }),
  });
  const scriptApp = triggerService();
  let commitCalls = 0;
  const services = {
    clock: { now: () => new Date(nowMs) },
    executor: {
      commit() {
        commitCalls += 1;
        return { runRecord: { runId: 'run-settle', status: 'SUCCESS' } };
      },
    },
    properties: propertiesStore,
    scriptApp,
  };

  const deferred = Cxp06UatContinuation.continueConfigured(services);

  assert.equal(deferred.status, 'COMMITTING');
  assert.equal(deferred.continuationScheduled, true);
  assert.equal(commitCalls, 0);
  assert.equal(scriptApp.triggers.length, 1);
  assert.equal(scriptApp.triggers[0].delayMs, 105000);

  nowMs = phaseStartedAtMs + 375000;
  const resumed = Cxp06UatContinuation.continueConfigured(services);

  assert.equal(resumed.status, 'COMPLETE');
  assert.equal(commitCalls, 1);
  assert.equal(scriptApp.triggers.length, 0);
});

// Defect caught: hosted final commit packs every remaining dataset into one
// invocation, so a later peak-sized write consumes the six-minute Apps Script
// limit after earlier faster datasets have already finished.
test('hosted CXP-06 commits one dataset per invocation and self-resumes after 4:45-budget writes', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  let nowMs = Date.parse('2026-08-25T14:00:00.000Z');
  const propertiesStore = mutableProperties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
    CXP06_UAT_PIPELINE_STATE: JSON.stringify({
      checkpoint: {
        data: { backupRunId: 'run-self-resume' },
        request: { targetWorkbookId: 'target-id' },
        runId: 'run-self-resume',
        startedAtUtc: '2026-08-25T14:00:00.000Z',
        stateHistory: [],
        version: 1,
      },
      environment: 'DEV',
      lastErrorCode: null,
      scenario: 'CASE1_PEAK_SUCCESS',
      startedAtUtc: '2026-08-25T14:00:00.000Z',
      status: 'COMMIT_PENDING',
      updatedAtUtc: '2026-08-25T14:00:00.000Z',
      version: 1,
    }),
  });
  const scriptApp = triggerService();
  const datasets = ['Handled', 'Offered', 'AHT - Raw', 'Auxes - Raw', 'Staff'];
  let commitCalls = 0;
  const services = {
    clock: { now: () => new Date(nowMs) },
    executor: {
      commit(state) {
        commitCalls += 1;
        const previous = state.checkpoint.data.commitProgress?.nextDatasetIndex || 0;
        const next = previous + 1;
        nowMs += 140000;
        return {
          commitProgress: {
            complete: next === datasets.length,
            lastCompletedDatasetName: datasets[next - 1],
            nextDatasetIndex: next,
          },
        };
      },
    },
    properties: propertiesStore,
    scriptApp,
  };

  const yielded = Cxp06UatContinuation.continueConfigured(services);
  const persisted = JSON.parse(propertiesStore.getProperty('CXP06_UAT_PIPELINE_STATE'));

  assert.equal(yielded.status, 'COMMIT_PENDING');
  assert.equal(yielded.continuationScheduled, true);
  assert.equal(yielded.lastCompletedCommitDataset, 'Handled');
  assert.equal(commitCalls, 1);
  assert.deepEqual(persisted.checkpoint.data.commitProgress, {
    complete: false,
    lastCompletedDatasetName: 'Handled',
    nextDatasetIndex: 1,
  });
  assert.equal(scriptApp.triggers.length, 1);
  assert.equal(scriptApp.triggers[0].delayMs, 60000);
});

// Defect caught: the hosted production executor reconstructs every staged
// dataset and uses the compatibility commitStep instead of the cursor dataset.
test('hosted CXP-06 production executor uses dataset-scoped commit before final resume', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  const originalHarness = global.Cxp06UatHarness;
  const originalRunService = global.RunService;
  let nowMs = Date.parse('2026-08-25T15:00:00.000Z');
  let finalResumeCalls = 0;
  let stepCalls = 0;
  const resumedDatasets = [];
  try {
    global.RunService = {
      resume() {
        finalResumeCalls += 1;
        return { runRecord: { runId: 'run-production-step', status: 'SUCCESS' } };
      },
    };
    global.Cxp06UatHarness = {
      createHostedDependencies() {
        return {};
      },
      hostedRuntimeServices() {
        return {};
      },
      execute(options, dependencies) {
        return dependencies.runService.execute(
          { targetWorkbookId: 'target-id' },
          {
            commitDatasetStep(context, progress) {
              stepCalls += 1;
              nowMs += 300000;
              return {
                complete: false,
                lastCompletedDatasetName: 'Handled',
                nextDatasetIndex: progress.nextDatasetIndex + 1,
              };
            },
            resumeDataset(context, checkpointData, datasetName) {
              resumedDatasets.push(datasetName);
            },
          },
          {},
        );
      },
    };
    const propertiesStore = mutableProperties({
      CXP_ENV: 'DEV',
      CXP_UAT_ENABLED: 'true',
      CXP06_UAT_PIPELINE_STATE: JSON.stringify({
        checkpoint: {
          data: { backupRunId: 'run-production-step' },
          request: { targetWorkbookId: 'target-id' },
          runId: 'run-production-step',
          startedAtUtc: '2026-08-25T15:00:00.000Z',
          stateHistory: [],
          version: 1,
        },
        environment: 'DEV',
        lastErrorCode: null,
        scenario: 'CASE1_PEAK_SUCCESS',
        startedAtUtc: '2026-08-25T15:00:00.000Z',
        status: 'COMMIT_PENDING',
        updatedAtUtc: '2026-08-25T15:00:00.000Z',
        version: 1,
      }),
    });
    const scriptApp = triggerService();

    const result = Cxp06UatContinuation.continueConfigured({
      clock: { now: () => new Date(nowMs) },
      properties: propertiesStore,
      scriptApp,
    });

    assert.equal(result.status, 'COMMIT_PENDING');
    assert.equal(result.lastCompletedCommitDataset, 'Handled');
    assert.equal(stepCalls, 1);
    assert.deepEqual(resumedDatasets, ['Handled']);
    assert.equal(finalResumeCalls, 0);
    assert.equal(scriptApp.triggers[0].delayMs, 60000);
  } finally {
    if (originalHarness === undefined) delete global.Cxp06UatHarness;
    else global.Cxp06UatHarness = originalHarness;
    if (originalRunService === undefined) delete global.RunService;
    else global.RunService = originalRunService;
  }
});

// Defect caught: the production continuation executor never bridges a dataset-worker failure into RunService terminal auditing.
test('hosted CXP-06 production executor records a worker failure through RunService', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  const originalHarness = global.Cxp06UatHarness;
  const originalRunService = global.RunService;
  const persisted = [];
  const recorded = [];
  const operationalFailure = ErrorCodes.create('MIGRATION_COMMIT_FAILED', {
    details: { rollbackStatus: 'VERIFIED' },
  });
  const repository = {
    persistOnce(runRecords, errorRecords) {
      persisted.push({ errorRecords, runRecords });
    },
  };
  const hosted = { runServices: { repository } };
  try {
    global.RunService = {
      recordFailure(checkpoint, error, services) {
        recorded.push({ checkpoint, code: error.code, services });
        error.runRecord = { runId: checkpoint.runId, status: 'FAILED_MIGRATION_CALCULATION' };
        error.errorRecord = { errorCode: error.code, runId: checkpoint.runId };
        services.repository.persistOnce([error.runRecord], [error.errorRecord]);
        throw error;
      },
      resume() {
        throw new Error('Final resume must not run after the worker failure.');
      },
    };
    global.Cxp06UatHarness = {
      createHostedDependencies() {
        return hosted;
      },
      hostedRuntimeServices() {
        return {};
      },
      execute(_options, dependencies) {
        try {
          return dependencies.runService.execute(
            { targetWorkbookId: 'target-id' },
            {
              commitDatasetStep() {
                throw operationalFailure;
              },
              resumeDataset() {},
            },
            hosted.runServices,
          );
        } catch (error) {
          return { error };
        }
      },
    };
    const propertiesStore = mutableProperties({
      CXP_ENV: 'DEV',
      CXP_UAT_ENABLED: 'true',
      CXP06_UAT_PIPELINE_STATE: JSON.stringify({
        checkpoint: {
          data: {
            backupRunId: 'run-production-audit',
            datasetNames: ['Handled'],
          },
          request: { targetWorkbookId: 'target-id' },
          runId: 'run-production-audit',
          startedAtUtc: '2026-08-27T03:00:00.000Z',
          stateHistory: [{ atUtc: '2026-08-27T03:00:00.000Z', state: 'VALIDATING_STAGE' }],
          version: 1,
        },
        environment: 'DEV',
        lastErrorCode: null,
        scenario: 'CASE3_MID_COMMIT_FAILURE',
        startedAtUtc: '2026-08-27T03:00:00.000Z',
        status: 'COMMIT_PENDING',
        updatedAtUtc: '2026-08-27T03:00:00.000Z',
        version: 1,
      }),
    });
    const scriptApp = triggerService();

    assert.throws(
      () => Cxp06UatContinuation.continueConfigured({
        clock: { now: () => new Date('2026-08-27T03:01:00.000Z') },
        properties: propertiesStore,
        scriptApp,
      }),
      { code: 'MIGRATION_COMMIT_FAILED' },
    );
    const status = Cxp06UatContinuation.getStatus({
      properties: propertiesStore,
      scriptApp,
    });

    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].checkpoint.runId, 'run-production-audit');
    assert.strictEqual(recorded[0].services.repository, repository);
    assert.equal(persisted.length, 1);
    assert.equal(status.failureAuditStatus, 'RECORDED');
    assert.equal(status.continuationScheduled, false);
  } finally {
    if (originalHarness === undefined) delete global.Cxp06UatHarness;
    else global.Cxp06UatHarness = originalHarness;
    if (originalRunService === undefined) delete global.RunService;
    else global.RunService = originalRunService;
  }
});

// Defect caught: a resume-time staged row-count failure preserves a stale
// checkpoint, so every manual retry revalidates the same unusable staging data.
test('hosted CXP-06 re-prepares after a resume-time stage validation failure', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  const propertiesStore = mutableProperties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
  });
  const scriptApp = triggerService();
  let prepareCalls = 0;
  const services = {
    clock: { now: () => new Date('2026-08-25T12:20:40.000Z') },
    executor: {
      backup() {
        return { complete: true, createdDatasetName: 'Staff' };
      },
      commit() {
        const error = new Error('Staged data validation failed.');
        error.code = 'MIGRATION_STAGE_VALIDATION_FAILED';
        throw error;
      },
      prepare() {
        prepareCalls += 1;
        return {
          checkpoint: {
            data: { fingerprint: 'sha256:fresh', sourceFiles: [] },
            request: { targetWorkbookId: 'target-id' },
            runId: `run-${prepareCalls}`,
            startedAtUtc: '2026-08-25T12:20:40.000Z',
            stateHistory: [{ atUtc: '2026-08-25T12:20:40.000Z', state: 'VALIDATING_STAGE' }],
            version: 1,
          },
        };
      },
    },
    properties: propertiesStore,
    scriptApp,
  };

  Cxp06UatContinuation.start('CASE1_PEAK_SUCCESS', services);
  Cxp06UatContinuation.continueConfigured(services);
  assert.throws(
    () => Cxp06UatContinuation.continueConfigured(services),
    { code: 'MIGRATION_STAGE_VALIDATION_FAILED' },
  );

  const retry = Cxp06UatContinuation.start('CASE1_PEAK_SUCCESS', services);

  assert.equal(retry.status, 'BACKUP_PENDING');
  assert.equal(retry.runId, 'run-2');
  assert.equal(prepareCalls, 2);
});

// Defect caught: the backup controller yields after every short sheet copy,
// paying another trigger delay even when the remaining copies fit safely.
test('hosted CXP-06 packs short durable backup steps before commit', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  let nowMs = Date.parse('2026-08-25T12:49:30.000Z');
  const propertiesStore = mutableProperties({ CXP_ENV: 'DEV', CXP_UAT_ENABLED: 'true' });
  const scriptApp = triggerService();
  const calls = [];
  const workerLogs = [];
  let backupCount = 0;
  const services = {
    clock: { now: () => new Date(nowMs) },
    executor: {
      backup(state) {
        backupCount += 1;
        calls.push(['backup', backupCount, state.status]);
        nowMs += 40000;
        return { complete: backupCount === 5, createdDatasetName: `dataset-${backupCount}` };
      },
      commit(state) {
        calls.push(['commit', state.checkpoint.data.backupRunId]);
        return { runRecord: { runId: state.checkpoint.runId, status: 'SUCCESS' } };
      },
      prepare() {
        calls.push(['prepare']);
        return {
          checkpoint: {
            data: { fingerprint: 'sha256:incremental', sourceFiles: [] },
            request: { targetWorkbookId: 'target-id' },
            runId: 'run-incremental-hosted',
            startedAtUtc: '2026-08-25T12:49:30.000Z',
            stateHistory: [{ atUtc: '2026-08-25T12:49:30.000Z', state: 'VALIDATING_STAGE' }],
            version: 1,
          },
        };
      },
    },
    logger: { log(message) { workerLogs.push(message); } },
    properties: propertiesStore,
    scriptApp,
  };

  assert.equal(Cxp06UatContinuation.start('CASE1_PEAK_SUCCESS', services).status, 'BACKUP_PENDING');
  const ready = Cxp06UatContinuation.continueConfigured(services);
  assert.equal(ready.status, 'COMMIT_PENDING');
  assert.equal(ready.continuationScheduled, true);
  assert.equal(calls.filter(([name]) => name === 'backup').length, 5);
  const persisted = JSON.parse(propertiesStore.getProperty('CXP06_UAT_PIPELINE_STATE'));
  assert.equal(persisted.maxBackupStepMs, 40000);
  assert.deepEqual(
    workerLogs.map((message) => {
      const event = JSON.parse(message.slice('CXP06_WORKER_STEP '.length));
      return [event.phase, event.datasetName, event.decision];
    }),
    [
      ['BACKUP', 'dataset-1', 'PACK_NEXT'],
      ['BACKUP', 'dataset-2', 'PACK_NEXT'],
      ['BACKUP', 'dataset-3', 'PACK_NEXT'],
      ['BACKUP', 'dataset-4', 'PACK_NEXT'],
      ['BACKUP', 'dataset-5', 'PHASE_COMPLETE'],
    ],
  );

  const complete = Cxp06UatContinuation.continueConfigured(services);
  assert.equal(complete.status, 'COMPLETE');
  assert.deepEqual(calls.at(-1), ['commit', 'run-incremental-hosted']);
});

// Defect caught: a normal backup-step failure leaves a checkpoint, and manual
// retry jumps to final commit before the backup group is complete.
test('hosted CXP-06 retries backup discovery after a backup-step failure', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  const propertiesStore = mutableProperties({ CXP_ENV: 'DEV', CXP_UAT_ENABLED: 'true' });
  const scriptApp = triggerService();
  let backupCalls = 0;
  let commitCalls = 0;
  const services = {
    clock: { now: () => new Date('2026-08-25T13:00:00.000Z') },
    executor: {
      backup() {
        backupCalls += 1;
        if (backupCalls === 1) {
          const error = new Error('Synthetic backup interruption.');
          error.code = 'MIGRATION_BACKUP_FAILED';
          throw error;
        }
        return { complete: false, createdDatasetName: 'Handled' };
      },
      commit() {
        commitCalls += 1;
      },
      prepare() {
        return {
          checkpoint: {
            data: { fingerprint: 'sha256:backup-retry', sourceFiles: [] },
            request: { targetWorkbookId: 'target-id' },
            runId: 'run-backup-retry',
            startedAtUtc: '2026-08-25T13:00:00.000Z',
            stateHistory: [{ atUtc: '2026-08-25T13:00:00.000Z', state: 'VALIDATING_STAGE' }],
            version: 1,
          },
        };
      },
    },
    properties: propertiesStore,
    scriptApp,
  };

  Cxp06UatContinuation.start('CASE1_PEAK_SUCCESS', services);
  assert.throws(
    () => Cxp06UatContinuation.continueConfigured(services),
    { code: 'MIGRATION_BACKUP_FAILED' },
  );

  const retry = Cxp06UatContinuation.start('CASE1_PEAK_SUCCESS', services);
  assert.equal(retry.status, 'BACKUP_PENDING');
  assert.equal(backupCalls, 2);
  assert.equal(commitCalls, 0);
});

// Defect caught: the public status endpoint hardcodes continuationScheduled to
// false and hides bounded per-dataset progress while a backup trigger exists.
test('hosted CXP-06 status reports the actual trigger and last completed backup dataset', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  const propertiesStore = mutableProperties({ CXP_ENV: 'DEV', CXP_UAT_ENABLED: 'true' });
  const scriptApp = triggerService();
  const services = {
    clock: { now: () => new Date('2026-08-25T13:24:41.000Z') },
    executor: {
      backup() {
        return { complete: false, createdDatasetName: 'Handled' };
      },
      prepare() {
        return {
          checkpoint: {
            data: { fingerprint: 'sha256:status', sourceFiles: [] },
            request: { targetWorkbookId: 'target-id' },
            runId: 'run-status',
            startedAtUtc: '2026-08-25T13:24:41.000Z',
            stateHistory: [{ atUtc: '2026-08-25T13:24:41.000Z', state: 'VALIDATING_STAGE' }],
            version: 1,
          },
        };
      },
    },
    properties: propertiesStore,
    scriptApp,
  };

  Cxp06UatContinuation.start('CASE1_PEAK_SUCCESS', services);
  assert.equal(Cxp06UatContinuation.getStatus(services).continuationScheduled, true);

  Cxp06UatContinuation.continueConfigured(services);
  const status = Cxp06UatContinuation.getStatus(services);
  assert.equal(status.continuationScheduled, true);
  assert.equal(status.lastCompletedBackupDataset, 'Handled');
});

// Defect caught: successful cleanup debt is returned by CommitService but disappears from continuation state and status.
test('hosted CXP-06 persists backupCleanupStatus from final health results', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  const propertiesStore = mutableProperties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
    CXP06_UAT_PIPELINE_STATE: JSON.stringify({
      checkpoint: {
        data: {
          backupRunId: 'run-cleanup-debt',
          commitProgress: {
            complete: true,
            lastCompletedDatasetName: 'Staff',
            nextDatasetIndex: 5,
          },
        },
        request: { targetWorkbookId: 'target-id' },
        runId: 'run-cleanup-debt',
        startedAtUtc: '2026-08-27T04:00:00.000Z',
        stateHistory: [{ atUtc: '2026-08-27T04:00:00.000Z', state: 'VALIDATING_STAGE' }],
        version: 1,
      },
      environment: 'DEV',
      lastCompletedBackupDataset: 'Staff',
      lastCompletedCommitDataset: 'Staff',
      lastErrorCode: null,
      scenario: 'CASE5_CLEANUP_FAILURE',
      startedAtUtc: '2026-08-27T04:00:00.000Z',
      status: 'COMMIT_PENDING',
      updatedAtUtc: '2026-08-27T04:00:00.000Z',
      version: 1,
    }),
  });
  const scriptApp = triggerService();
  const services = {
    clock: { now: () => new Date('2026-08-27T04:01:00.000Z') },
    executor: {
      commit() {
        return {
          operationResults: {
            healthCheck: { backupCleanupStatus: 'PENDING' },
          },
          runRecord: { runId: 'run-cleanup-debt', status: 'SUCCESS' },
        };
      },
    },
    properties: propertiesStore,
    scriptApp,
  };

  const completed = Cxp06UatContinuation.continueConfigured(services);
  const saved = Cxp06UatContinuation.getStatus(services);

  assert.equal(completed.status, 'COMPLETE');
  assert.equal(completed.backupCleanupStatus, 'PENDING');
  assert.equal(saved.backupCleanupStatus, 'PENDING');
  assert.equal(saved.continuationScheduled, false);
});

// Defect caught: a nonterminal checkpoint deletes its safety trigger before
// creating the successor, so an abrupt stop can strand BACKUP_PENDING forever.
test('hosted CXP-06 creates the successor before deleting the prior safety trigger', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  const propertiesStore = mutableProperties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
    CXP06_UAT_PIPELINE_STATE: JSON.stringify({
      checkpoint: {
        data: { fingerprint: 'sha256:trigger-order', sourceFiles: [] },
        request: { targetWorkbookId: 'target-id' },
        runId: 'run-trigger-order',
        startedAtUtc: '2026-08-25T16:00:00.000Z',
        stateHistory: [],
        version: 1,
      },
      environment: 'DEV',
      lastErrorCode: null,
      scenario: 'CASE1_PEAK_SUCCESS',
      startedAtUtc: '2026-08-25T16:00:00.000Z',
      status: 'BACKUP_PENDING',
      updatedAtUtc: '2026-08-25T16:00:00.000Z',
      version: 1,
    }),
  });
  const scriptApp = triggerService();
  const services = {
    clock: { now: () => new Date('2026-08-25T16:00:10.000Z') },
    executor: {
      backup() {
        scriptApp.events.length = 0;
        return { complete: false, createdDatasetName: 'Handled' };
      },
    },
    properties: propertiesStore,
    scriptApp,
  };

  const result = Cxp06UatContinuation.continueConfigured(services);

  assert.equal(result.status, 'BACKUP_PENDING');
  assert.deepEqual(scriptApp.events, [
    ['create', 1000],
    ['delete', 420000],
  ]);
  assert.equal(scriptApp.triggers.length, 1);
  assert.equal(scriptApp.triggers[0].delayMs, 1000);
});

// Contract: consuming each one-time trigger must leave one successor at every
// nonterminal checkpoint until the complete logical pipeline removes it.
test('hosted CXP-06 perpetuates one-time continuations until the whole pipeline completes', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  let nowMs = Date.parse('2026-08-25T17:00:00.000Z');
  let backupCalls = 0;
  let commitCalls = 0;
  const propertiesStore = mutableProperties({ CXP_ENV: 'DEV', CXP_UAT_ENABLED: 'true' });
  const scriptApp = triggerService();
  const services = {
    clock: { now: () => new Date(nowMs) },
    executor: {
      backup() {
        backupCalls += 1;
        return {
          complete: backupCalls === 5,
          createdDatasetName: `backup-${backupCalls}`,
        };
      },
      commit(state) {
        commitCalls += 1;
        const progress = state.checkpoint.data.commitProgress;
        if (progress?.complete) {
          return { runRecord: { runId: state.checkpoint.runId, status: 'SUCCESS' } };
        }
        const nextDatasetIndex = (progress?.nextDatasetIndex || 0) + 1;
        nowMs += 280000;
        return {
          commitProgress: {
            complete: nextDatasetIndex === 5,
            lastCompletedDatasetName: `commit-${nextDatasetIndex}`,
            nextDatasetIndex,
          },
        };
      },
      prepare() {
        return {
          checkpoint: {
            data: { fingerprint: 'sha256:perpetual', sourceFiles: [] },
            request: { targetWorkbookId: 'target-id' },
            runId: 'run-perpetual',
            startedAtUtc: '2026-08-25T17:00:00.000Z',
            stateHistory: [],
            version: 1,
          },
        };
      },
    },
    properties: propertiesStore,
    scriptApp,
  };

  let result = Cxp06UatContinuation.start('CASE1_PEAK_SUCCESS', services);
  let continuationExecutions = 0;
  while (result.status !== 'COMPLETE' && continuationExecutions < 20) {
    assert.equal(result.continuationScheduled, true);
    assert.equal(scriptApp.triggers.length, 1);
    scriptApp.deleteTrigger(scriptApp.triggers[0]);
    assert.equal(scriptApp.triggers.length, 0);
    result = Cxp06UatContinuation.continueConfigured(services);
    continuationExecutions += 1;
  }

  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.continuationScheduled, false);
  assert.equal(scriptApp.triggers.length, 0);
  assert.equal(backupCalls, 5);
  assert.equal(commitCalls, 6);
  assert.equal(continuationExecutions, 11);
});

// Defect caught: rerunning the main scenario against BACKUP_PENDING reports a
// continuation but does not recreate the missing trigger that stranded it.
test('hosted CXP-06 main entrypoint repairs a nonterminal state with no trigger', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  const propertiesStore = mutableProperties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
    CXP06_UAT_PIPELINE_STATE: JSON.stringify({
      checkpoint: {
        data: { fingerprint: 'sha256:stranded', sourceFiles: [] },
        request: { targetWorkbookId: 'target-id' },
        runId: 'run-stranded',
        startedAtUtc: '2026-08-25T18:00:00.000Z',
        stateHistory: [],
        version: 1,
      },
      environment: 'DEV',
      lastCompletedBackupDataset: 'Handled',
      lastErrorCode: null,
      scenario: 'CASE1_PEAK_SUCCESS',
      startedAtUtc: '2026-08-25T18:00:00.000Z',
      status: 'BACKUP_PENDING',
      updatedAtUtc: '2026-08-25T18:04:00.000Z',
      version: 1,
    }),
  });
  const scriptApp = triggerService();

  const repaired = Cxp06UatContinuation.start('CASE1_PEAK_SUCCESS', {
    clock: { now: () => new Date('2026-08-25T18:10:00.000Z') },
    executor: {},
    properties: propertiesStore,
    scriptApp,
  });

  assert.equal(repaired.status, 'BACKUP_PENDING');
  assert.equal(repaired.continuationScheduled, true);
  assert.equal(scriptApp.triggers.length, 1);
  assert.equal(scriptApp.triggers[0].delayMs, 60000);
});

// Defect caught: the continuation collapses rollback failure diagnostics to a
// single code, hiding the bounded original error and rollback reason.
test('hosted CXP-06 failed status retains bounded rollback diagnostics', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  const propertiesStore = mutableProperties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
    CXP06_UAT_PIPELINE_STATE: JSON.stringify({
      checkpoint: {
        data: { backupRunId: 'run-rollback-details' },
        request: { targetWorkbookId: 'target-id' },
        runId: 'run-rollback-details',
        startedAtUtc: '2026-08-25T19:00:00.000Z',
        stateHistory: [],
        version: 1,
      },
      environment: 'DEV',
      lastErrorCode: null,
      scenario: 'CASE1_PEAK_SUCCESS',
      startedAtUtc: '2026-08-25T19:00:00.000Z',
      status: 'COMMIT_PENDING',
      updatedAtUtc: '2026-08-25T19:00:00.000Z',
      version: 1,
    }),
  });
  const scriptApp = triggerService();
  const error = new Error('Rollback failed.');
  error.code = 'MIGRATION_ROLLBACK_FAILED';
  error.details = {
    backupRunId: 'run-rollback-details',
    originalErrorCode: 'MIGRATION_COMMIT_FAILED',
    rollbackStatus: 'FAILED',
    secretCellValue: 'do-not-persist',
  };
  const services = {
    clock: { now: () => new Date('2026-08-25T19:01:00.000Z') },
    executor: { commit: () => { throw error; } },
    properties: propertiesStore,
    scriptApp,
  };

  assert.throws(
    () => Cxp06UatContinuation.continueConfigured(services),
    { code: 'MIGRATION_ROLLBACK_FAILED' },
  );
  const status = Cxp06UatContinuation.getStatus(services);

  assert.deepEqual(status.lastErrorDetails, {
    backupRunId: 'run-rollback-details',
    originalErrorCode: 'MIGRATION_COMMIT_FAILED',
    rollbackStatus: 'FAILED',
  });
  assert.equal(JSON.stringify(status).includes('do-not-persist'), false);
});

// Defect caught: a direct hosted worker failure updates Script Properties but never writes its terminal audit rows.
test('hosted CXP-06 records a successful failure audit before removing its trigger', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  const propertiesStore = mutableProperties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
    CXP06_UAT_PIPELINE_STATE: JSON.stringify({
      checkpoint: {
        data: { backupRunId: 'run-audited-failure' },
        request: { targetWorkbookId: 'target-id' },
        runId: 'run-audited-failure',
        startedAtUtc: '2026-08-27T01:00:00.000Z',
        stateHistory: [{ atUtc: '2026-08-27T01:00:00.000Z', state: 'VALIDATING_STAGE' }],
        version: 1,
      },
      environment: 'DEV',
      lastErrorCode: null,
      scenario: 'CASE3_MID_COMMIT_FAILURE',
      startedAtUtc: '2026-08-27T01:00:00.000Z',
      status: 'COMMIT_PENDING',
      updatedAtUtc: '2026-08-27T01:00:00.000Z',
      version: 1,
    }),
  });
  const scriptApp = triggerService();
  scriptApp.newTrigger('continueCxp06UatPipeline').timeBased().after(60000).create();
  const failure = ErrorCodes.create('MIGRATION_COMMIT_FAILED', {
    details: { rollbackStatus: 'VERIFIED' },
  });
  const auditCalls = [];
  const services = {
    clock: { now: () => new Date('2026-08-27T01:01:00.000Z') },
    executor: {
      auditFailure(state, error) {
        auditCalls.push({ code: error.code, runId: state.checkpoint.runId, status: state.status });
      },
      commit() {
        throw failure;
      },
    },
    properties: propertiesStore,
    scriptApp,
  };

  assert.throws(
    () => Cxp06UatContinuation.continueConfigured(services),
    { code: 'MIGRATION_COMMIT_FAILED' },
  );
  const status = Cxp06UatContinuation.getStatus(services);

  assert.deepEqual(auditCalls, [{
    code: 'MIGRATION_COMMIT_FAILED',
    runId: 'run-audited-failure',
    status: 'FAILED',
  }]);
  assert.equal(status.failureAuditStatus, 'RECORDED');
  assert.equal(status.lastAuditErrorCode, null);
  assert.equal(status.lastErrorCode, 'MIGRATION_COMMIT_FAILED');
  assert.equal(status.continuationScheduled, false);
  assert.equal(scriptApp.triggers.length, 0);
});

// Defect caught: a reporting outage deletes the only trigger or replays production writes instead of retrying only the audit.
test('hosted CXP-06 retries a pending failure audit without replaying commit work', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  const propertiesStore = mutableProperties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
    CXP06_UAT_PIPELINE_STATE: JSON.stringify({
      checkpoint: {
        data: { backupRunId: 'run-audit-retry' },
        request: { targetWorkbookId: 'target-id' },
        runId: 'run-audit-retry',
        startedAtUtc: '2026-08-27T02:00:00.000Z',
        stateHistory: [{ atUtc: '2026-08-27T02:00:00.000Z', state: 'VALIDATING_STAGE' }],
        version: 1,
      },
      environment: 'DEV',
      lastErrorCode: null,
      scenario: 'CASE3_MID_COMMIT_FAILURE',
      startedAtUtc: '2026-08-27T02:00:00.000Z',
      status: 'COMMIT_PENDING',
      updatedAtUtc: '2026-08-27T02:00:00.000Z',
      version: 1,
    }),
  });
  const scriptApp = triggerService();
  let auditCalls = 0;
  let commitCalls = 0;
  const operationalFailure = ErrorCodes.create('MIGRATION_COMMIT_FAILED', {
    details: { rollbackStatus: 'VERIFIED' },
  });
  const services = {
    clock: { now: () => new Date('2026-08-27T02:01:00.000Z') },
    executor: {
      auditFailure(_state, error) {
        auditCalls += 1;
        assert.equal(error.code, 'MIGRATION_COMMIT_FAILED');
        if (auditCalls === 1) {
          throw ErrorCodes.create('REPORTING_LOG_WRITE_FAILED');
        }
      },
      backup() {
        throw new Error('Backup must not replay during an audit retry.');
      },
      commit() {
        commitCalls += 1;
        throw operationalFailure;
      },
    },
    properties: propertiesStore,
    scriptApp,
  };

  assert.throws(
    () => Cxp06UatContinuation.continueConfigured(services),
    { code: 'MIGRATION_COMMIT_FAILED' },
  );
  const pending = Cxp06UatContinuation.getStatus(services);
  assert.equal(pending.failureAuditStatus, 'PENDING');
  assert.equal(pending.lastAuditErrorCode, 'REPORTING_LOG_WRITE_FAILED');
  assert.equal(pending.lastErrorCode, 'MIGRATION_COMMIT_FAILED');
  assert.equal(pending.continuationScheduled, true);
  assert.equal(scriptApp.triggers.length, 1);

  const recorded = Cxp06UatContinuation.continueConfigured(services);
  assert.equal(recorded.status, 'FAILED');
  assert.equal(recorded.failureAuditStatus, 'RECORDED');
  assert.equal(recorded.lastAuditErrorCode, null);
  assert.equal(recorded.continuationScheduled, false);
  assert.equal(auditCalls, 2);
  assert.equal(commitCalls, 1);
  assert.equal(scriptApp.triggers.length, 0);
});

// Defect caught: retrying MIGRATION_ROLLBACK_FAILED resumes after Handled even
// though the failed rollback may already have restored it to pre-run data.
test('hosted CXP-06 restarts the raw commit cursor after rollback failure', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  let nowMs = Date.parse('2026-08-25T20:00:00.000Z');
  const propertiesStore = mutableProperties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
    CXP06_UAT_PIPELINE_STATE: JSON.stringify({
      checkpoint: {
        data: {
          backupRunId: 'run-restart-cursor',
          commitProgress: {
            complete: false,
            lastCompletedDatasetName: 'Handled',
            nextDatasetIndex: 1,
          },
        },
        request: { targetWorkbookId: 'target-id' },
        runId: 'run-restart-cursor',
        startedAtUtc: '2026-08-25T20:00:00.000Z',
        stateHistory: [],
        version: 1,
      },
      environment: 'DEV',
      lastCompletedCommitDataset: 'Handled',
      lastErrorCode: 'MIGRATION_ROLLBACK_FAILED',
      scenario: 'CASE1_PEAK_SUCCESS',
      startedAtUtc: '2026-08-25T20:00:00.000Z',
      status: 'FAILED',
      updatedAtUtc: '2026-08-25T20:05:00.000Z',
      version: 1,
    }),
  });
  const scriptApp = triggerService();
  let observedProgress;
  const result = Cxp06UatContinuation.start('CASE1_PEAK_SUCCESS', {
    clock: { now: () => new Date(nowMs) },
    executor: {
      commit(state) {
        observedProgress = state.checkpoint.data.commitProgress;
        nowMs += 280000;
        return {
          commitProgress: {
            complete: false,
            lastCompletedDatasetName: 'Handled',
            nextDatasetIndex: 1,
          },
        };
      },
    },
    properties: propertiesStore,
    scriptApp,
  });

  assert.equal(observedProgress, undefined);
  assert.equal(result.status, 'COMMIT_PENDING');
  assert.equal(result.lastCompletedCommitDataset, 'Handled');
  assert.equal(scriptApp.triggers.length, 1);
});

// Defect caught: a verified rollback deletes the backup group, but FAILED retry
// still has backupRunId so it jumps to commit instead of recreating backups.
test('hosted CXP-06 recreates backups after a verified commit rollback', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  const propertiesStore = mutableProperties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
    CXP06_UAT_PIPELINE_STATE: JSON.stringify({
      checkpoint: {
        data: {
          backupRunId: '0b30e5c9-fa06-4e46-af37-41723d718ef3',
          commitProgress: {
            complete: false,
            lastCompletedDatasetName: 'Handled',
            nextDatasetIndex: 1,
          },
          fingerprint: 'sha256:verified-rollback',
          sourceFiles: [],
        },
        request: { targetWorkbookId: 'target-id' },
        runId: '0b30e5c9-fa06-4e46-af37-41723d718ef3',
        startedAtUtc: '2026-08-25T17:25:49.000Z',
        stateHistory: [],
        version: 1,
      },
      environment: 'DEV',
      lastCompletedBackupDataset: 'Staff',
      lastCompletedCommitDataset: 'Handled',
      lastErrorCode: 'MIGRATION_COMMIT_FAILED',
      lastErrorDetails: {
        backupRunId: '0b30e5c9-fa06-4e46-af37-41723d718ef3',
        originalErrorCode: 'MIGRATION_BACKUP_FAILED',
        rollbackStatus: 'VERIFIED',
      },
      scenario: 'CASE1_PEAK_SUCCESS',
      startedAtUtc: '2026-08-25T17:20:00.000Z',
      status: 'FAILED',
      updatedAtUtc: '2026-08-25T17:29:16.000Z',
      version: 1,
    }),
  });
  const scriptApp = triggerService();
  const calls = [];
  const result = Cxp06UatContinuation.start('CASE1_PEAK_SUCCESS', {
    clock: { now: () => new Date('2026-08-25T17:32:00.000Z') },
    executor: {
      backup() {
        calls.push('backup');
        return { complete: false, createdDatasetName: 'Handled' };
      },
      commit() {
        calls.push('commit');
        throw new Error('commit must not resume against deleted backups');
      },
    },
    properties: propertiesStore,
    scriptApp,
  });
  const persisted = JSON.parse(propertiesStore.getProperty('CXP06_UAT_PIPELINE_STATE'));

  assert.deepEqual(calls, ['backup']);
  assert.equal(result.status, 'BACKUP_PENDING');
  assert.equal(persisted.checkpoint.data.backupRunId, undefined);
  assert.equal(persisted.checkpoint.data.commitProgress, undefined);
  assert.equal(result.lastCompletedCommitDataset, null);
});

// Defect caught: the phase watchdog is armed inside Apps Script's own six-minute
// execution window, so it fires while the invocation it guards is still healthy.
test('hosted CXP-06 arms every phase watchdog beyond the six-minute execution limit', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  const propertiesStore = mutableProperties({ CXP_ENV: 'DEV', CXP_UAT_ENABLED: 'true' });
  const scriptApp = triggerService();
  const armed = [];
  const services = {
    clock: { now: () => new Date('2026-08-25T22:00:00.000Z') },
    executor: {
      backup() {
        armed.push(scriptApp.triggers.map((item) => item.delayMs));
        return { complete: true, createdDatasetName: 'Staff' };
      },
      commit(state) {
        armed.push(scriptApp.triggers.map((item) => item.delayMs));
        return { runRecord: { runId: state.checkpoint.runId, status: 'SUCCESS' } };
      },
      prepare() {
        armed.push(scriptApp.triggers.map((item) => item.delayMs));
        return {
          checkpoint: {
            data: { fingerprint: 'sha256:watchdog', sourceFiles: [] },
            request: { targetWorkbookId: 'target-id' },
            runId: 'run-watchdog-margin',
            startedAtUtc: '2026-08-25T22:00:00.000Z',
            stateHistory: [],
            version: 1,
          },
        };
      },
    },
    properties: propertiesStore,
    scriptApp,
  };

  Cxp06UatContinuation.start('CASE1_PEAK_SUCCESS', services);
  Cxp06UatContinuation.continueConfigured(services);
  Cxp06UatContinuation.continueConfigured(services);

  assert.equal(armed.length, 3);
  armed.forEach((delays) => {
    assert.equal(delays.length, 1);
    assert.ok(
      delays[0] > 360000,
      `a ${delays[0]}ms watchdog can fire while its own invocation is still running`,
    );
  });
});

// Defect caught: the commit loop publishes COMMIT_PENDING between datasets, so a
// watchdog firing mid-loop re-enters commit and competes for the production lock.
test('hosted CXP-06 defers a watchdog invocation that fires during an active commit loop', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  const phaseStartedAtMs = Date.parse('2026-08-25T21:00:00.000Z');
  let nowMs = phaseStartedAtMs;
  const propertiesStore = mutableProperties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
    CXP06_UAT_PIPELINE_STATE: JSON.stringify({
      checkpoint: {
        data: { backupRunId: 'run-watchdog-race' },
        request: { targetWorkbookId: 'target-id' },
        runId: 'run-watchdog-race',
        startedAtUtc: '2026-08-25T21:00:00.000Z',
        stateHistory: [],
        version: 1,
      },
      environment: 'DEV',
      lastErrorCode: null,
      scenario: 'CASE1_PEAK_SUCCESS',
      startedAtUtc: '2026-08-25T21:00:00.000Z',
      status: 'COMMIT_PENDING',
      updatedAtUtc: '2026-08-25T21:00:00.000Z',
      version: 1,
    }),
  });
  const scriptApp = triggerService();
  const datasets = ['Handled', 'Offered', 'AHT - Raw', 'Auxes - Raw', 'Staff'];
  const enteredIndexes = [];
  let watchdogStarted = false;
  let watchdog;
  const services = {
    clock: { now: () => new Date(nowMs) },
    executor: {
      commit(state) {
        const previous = state.checkpoint.data.commitProgress
          ? state.checkpoint.data.commitProgress.nextDatasetIndex
          : 0;
        enteredIndexes.push(previous);
        if (previous === 0 && !watchdogStarted) {
          watchdogStarted = true;
          watchdog = Cxp06UatContinuation.continueConfigured(services);
        }
        nowMs += 100000;
        const next = previous + 1;
        return {
          commitProgress: {
            complete: next === datasets.length,
            lastCompletedDatasetName: datasets[next - 1],
            nextDatasetIndex: next,
          },
        };
      },
    },
    properties: propertiesStore,
    scriptApp,
  };

  Cxp06UatContinuation.continueConfigured(services);

  assert.equal(watchdog.status, 'COMMITTING');
  assert.equal(watchdog.continuationScheduled, true);
  assert.equal(watchdog.lastErrorCode, null);
  assert.deepEqual(enteredIndexes, [0, 1]);
});

// Defect caught: a retryable lock-contention timeout is recorded as a terminal
// failure and deletes the continuation trigger, stranding raw mid-replacement.
test('hosted CXP-06 reschedules a lock-contention timeout instead of failing the run', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  const propertiesStore = mutableProperties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
    CXP06_UAT_PIPELINE_STATE: JSON.stringify({
      checkpoint: {
        data: {
          backupRunId: 'run-contention',
          commitProgress: {
            complete: false,
            lastCompletedDatasetName: 'Handled',
            nextDatasetIndex: 1,
          },
        },
        request: { targetWorkbookId: 'target-id' },
        runId: 'run-contention',
        startedAtUtc: '2026-08-25T16:05:00.000Z',
        stateHistory: [],
        version: 1,
      },
      environment: 'DEV',
      lastCompletedCommitDataset: 'Handled',
      lastErrorCode: null,
      scenario: 'CASE1_PEAK_SUCCESS',
      startedAtUtc: '2026-08-25T16:05:00.000Z',
      status: 'COMMIT_PENDING',
      updatedAtUtc: '2026-08-25T16:05:00.000Z',
      version: 1,
    }),
  });
  const scriptApp = triggerService();
  const services = {
    clock: { now: () => new Date('2026-08-25T16:12:23.000Z') },
    executor: {
      commit() {
        throw ErrorCodes.create('INGESTION_LOCK_TIMEOUT', {
          details: { timeoutMs: 30000 },
        });
      },
    },
    properties: propertiesStore,
    scriptApp,
  };

  const result = Cxp06UatContinuation.continueConfigured(services);
  const persisted = JSON.parse(propertiesStore.getProperty('CXP06_UAT_PIPELINE_STATE'));

  assert.equal(result.status, 'COMMIT_PENDING');
  assert.equal(result.lastErrorCode, 'INGESTION_LOCK_TIMEOUT');
  assert.deepEqual(result.lastErrorDetails, { timeoutMs: 30000 });
  assert.equal(result.continuationScheduled, true);
  assert.equal(result.lastCompletedCommitDataset, 'Handled');
  assert.equal(persisted.status, 'COMMIT_PENDING');
  assert.deepEqual(persisted.checkpoint.data.commitProgress, {
    complete: false,
    lastCompletedDatasetName: 'Handled',
    nextDatasetIndex: 1,
  });
  assert.equal(scriptApp.triggers.length, 1);
});

// Defect caught: the hosted controller always yields after one dataset, adding
// trigger wait even when another measured step safely fits in the invocation.
test('hosted CXP-06 packs safe steps and yields before the next measured step crosses its budget', () => {
  const Cxp06UatContinuation = require('../src/uat/Cxp06UatContinuation.js');
  let nowMs = Date.parse('2026-08-25T23:00:00.000Z');
  const propertiesStore = mutableProperties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
    CXP06_UAT_PIPELINE_STATE: JSON.stringify({
      checkpoint: {
        data: { backupRunId: 'run-reserve' },
        request: { targetWorkbookId: 'target-id' },
        runId: 'run-reserve',
        startedAtUtc: '2026-08-25T23:00:00.000Z',
        stateHistory: [],
        version: 1,
      },
      environment: 'DEV',
      lastErrorCode: null,
      scenario: 'CASE1_PEAK_SUCCESS',
      startedAtUtc: '2026-08-25T23:00:00.000Z',
      status: 'COMMIT_PENDING',
      updatedAtUtc: '2026-08-25T23:00:00.000Z',
      version: 1,
    }),
  });
  const scriptApp = triggerService();
  const datasets = ['Handled', 'Offered', 'AHT - Raw', 'Auxes - Raw', 'Staff'];
  let commitCalls = 0;
  const workerLogs = [];
  const services = {
    clock: { now: () => new Date(nowMs) },
    executor: {
      commit(state) {
        commitCalls += 1;
        const previous = state.checkpoint.data.commitProgress
          ? state.checkpoint.data.commitProgress.nextDatasetIndex
          : 0;
        nowMs += 100000;
        const next = previous + 1;
        return {
          commitProgress: {
            complete: next === datasets.length,
            lastCompletedDatasetName: datasets[next - 1],
            nextDatasetIndex: next,
          },
        };
      },
    },
    logger: { log(message) { workerLogs.push(message); } },
    properties: propertiesStore,
    scriptApp,
  };

  const yielded = Cxp06UatContinuation.continueConfigured(services);

  assert.equal(commitCalls, 2);
  assert.equal(yielded.status, 'COMMIT_PENDING');
  assert.equal(yielded.lastCompletedCommitDataset, 'Offered');
  assert.equal(yielded.continuationScheduled, true);
  assert.equal(scriptApp.triggers.length, 1);
  assert.equal(scriptApp.triggers[0].delayMs, 60000);
  const persisted = JSON.parse(propertiesStore.getProperty('CXP06_UAT_PIPELINE_STATE'));
  assert.equal(persisted.maxCommitStepMs, 100000);
  assert.equal(persisted.checkpoint.data.commitProgress.nextDatasetIndex, 2);
  assert.equal(workerLogs.length, 2);
  assert.deepEqual(
    workerLogs.map((message) => {
      assert.equal(message.startsWith('CXP06_WORKER_STEP '), true);
      assert.equal(message.includes('records'), false);
      assert.equal(message.includes('values'), false);
      const event = JSON.parse(message.slice('CXP06_WORKER_STEP '.length));
      return [event.datasetName, event.decision, event.durationMs, event.elapsedMs];
    }),
    [
      ['Handled', 'PACK_NEXT', 100000, 100000],
      ['Offered', 'HANDOFF', 100000, 200000],
    ],
  );
});

// Defect caught: scenario faults are attached after CommitService construction,
// so CASE2 executes the ordinary stage path and is recorded as SUCCESS.
test('CASE2 wires invalid-stage corruption into the repository used by commit operations', () => {
  const baseStaging = {
    readAll: () => [{ formulas: [['']], values: [['Header'], ['value']] }],
    writeAll: () => ({ datasetCount: 5 }),
  };
  let stagingRepository = baseStaging;

  const result = Cxp06UatHarness.execute({ scenario: 'CASE2_INVALID_STAGE' }, {
    commitService: {
      createOperations(services) {
        stagingRepository = services.decorateStagingRepository(baseStaging);
        return {
          stage: () => stagingRepository.writeAll([]),
          validateStage() {
            const staged = stagingRepository.readAll();
            if (staged[0].formulas[0][0]) {
              const error = new Error('controlled invalid stage');
              error.code = 'MIGRATION_STAGE_VALIDATION_FAILED';
              error.failureState = 'FAILED_MIGRATION_CALCULATION';
              throw error;
            }
          },
          commit() {},
          recalculate() {},
          healthCheck() {},
        };
      },
    },
    inputOperations: {
      validateFile() {},
      parse() {},
      validateSchema() {},
      checkDuplicate() {},
    },
    runService: {
      execute(request, operations) {
        operations.stage({ operationResults: {} });
        operations.validateStage({ operationResults: {} });
        return { runRecord: { runId: 'false-success', status: 'SUCCESS' } };
      },
    },
  });

  assert.equal(result.error.code, 'MIGRATION_STAGE_VALIDATION_FAILED');
  assert.equal(result.evidence.terminalState, 'FAILED_MIGRATION_CALCULATION');
});

// Defect caught: Case 05 labels are executable but never install the controlled
// topology seed at the locked pre-reconciliation seam.
test('CASE5 topology scenarios install one controlled pre-reconciliation seed', () => {
  for (const scenario of [
    'CASE5_INCOMPLETE_BACKUP',
    'CASE5_COMPLETE_UNSUCCESSFUL_BACKUP',
    'CASE5_SUCCESSFUL_LEFTOVER_BACKUP',
    'CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS',
  ]) {
    const events = [];
    const backupRepository = { marker: 'backup' };
    const ledgerRepository = { marker: 'ledger' };
    const targetSpreadsheet = { marker: 'target' };
    const result = Cxp06UatHarness.execute({ scenario }, {
      commitService: {
        createOperations(services) {
          return {
            stage() {},
            validateStage() {},
            commit() {
              const context = Object.freeze({
                backupRepository,
                ledgerRepository,
                targetSpreadsheet,
              });
              services.beforeReconcile(context);
              services.beforeReconcile(context);
            },
            recalculate() {},
            healthCheck() {},
          };
        },
      },
      inputOperations: {
        validateFile() {},
        parse() {},
        validateSchema() {},
        checkDuplicate() {},
      },
      properties: safeProperties(),
      runService: {
        execute(request, operations) {
          operations.commit();
          return { runRecord: { runId: 'topology-run', status: 'SUCCESS' } };
        },
      },
      topologySeeder: {
        create(services) {
          events.push(['create', services]);
          return {
            seed(seedScenario) {
              events.push(['seed', seedScenario]);
              return {
                groupCount: 1,
                scenario: seedScenario,
                sheetNames: ['_CXP06_BAK_HANDLED_safe-seed'],
              };
            },
          };
        },
      },
      topologyServices: {
        now: () => new Date('2026-08-24T12:00:00.000Z'),
        uniqueToken: () => 'controlled-token',
      },
    });

    assert.equal(result.runRecord.status, 'SUCCESS');
    assert.equal(result.evidence.backupSheetCount, 1);
    assert.deepEqual(result.evidence.backupSheetNames, [
      '_CXP06_BAK_HANDLED_safe-seed',
    ]);
    assert.equal(events.filter(([name]) => name === 'create').length, 1, scenario);
    assert.deepEqual(events.filter(([name]) => name === 'seed'), [['seed', scenario]]);
    assert.equal(events[0][1].backupRepository, backupRepository);
    assert.equal(events[0][1].ledgerRepository, ledgerRepository);
    assert.equal(events[0][1].targetSpreadsheet, targetSpreadsheet);
    assert.equal(typeof events[0][1].now, 'function');
    assert.equal(typeof events[0][1].uniqueToken, 'function');
  }

  assert.throws(
    () => Cxp06UatHarness.execute({ scenario: 'CASE2_INVALID_STAG' }, {
      properties: safeProperties(),
    }),
    /Unknown UAT scenario/,
  );
});

// Defect caught: a seed refusal is swallowed or replaced by an ordinary
// successful run and its bounded setup evidence is omitted.
test('topology setup failures remain authoritative and sanitized', () => {
  let createCalls = 0;
  assert.throws(
    () => Cxp06UatHarness.execute({ scenario: 'CASE5_INCOMPLETE_BACKUP' }, {
      properties: safeProperties({ CXP_UAT_ENABLED: 'false' }),
      topologySeeder: {
        create() {
          createCalls += 1;
          return { seed() {} };
        },
      },
    }),
    /CXP_UAT_ENABLED=true/,
  );
  assert.equal(createCalls, 0);

  const result = Cxp06UatHarness.execute({ scenario: 'CASE5_INCOMPLETE_BACKUP' }, {
    commitService: {
      createOperations(services) {
        return {
          stage() {},
          validateStage() {},
          commit() {
            services.beforeReconcile({
              backupRepository: {},
              ledgerRepository: {},
              targetSpreadsheet: {},
            });
          },
          recalculate() {},
          healthCheck() {},
        };
      },
    },
    inputOperations: {
      validateFile() {}, parse() {}, validateSchema() {}, checkDuplicate() {},
    },
    properties: safeProperties(),
    runService: {
      execute(request, operations) {
        operations.commit();
        return { runRecord: { runId: 'false-success', status: 'SUCCESS' } };
      },
    },
    topologySeeder: {
      create() {
        return {
          seed() {
            throw ErrorCodes.create('UAT_BACKUP_TOPOLOGY_SEED_FAILED', {
              details: { reason: 'existing_backup_topology' },
            });
          },
        };
      },
    },
    topologyServices: { now: () => new Date(), uniqueToken: () => 'safe' },
  });

  assert.equal(result.error.code, 'UAT_BACKUP_TOPOLOGY_SEED_FAILED');
  assert.equal(result.evidence.sanitizedErrorCode, 'UAT_BACKUP_TOPOLOGY_SEED_FAILED');
  assert.equal(JSON.stringify(result.evidence).includes('existing_backup_topology'), false);
});

// Defect caught: production and non-topology UAT scenarios construct a seeder
// even though they must not create backup topology.
test('non-topology scenarios never construct the controlled topology seeder', () => {
  let createCalls = 0;
  const result = Cxp06UatHarness.execute({ scenario: 'CASE1_PEAK_SUCCESS' }, {
    commitOperations: {
      stage() {}, validateStage() {}, commit() {}, recalculate() {}, healthCheck() {},
    },
    inputOperations: {
      validateFile() {}, parse() {}, validateSchema() {}, checkDuplicate() {},
    },
    properties: safeProperties(),
    runService: {
      execute() {
        return { runRecord: { runId: 'ordinary-run', status: 'SUCCESS' } };
      },
    },
    topologySeeder: {
      create() {
        createCalls += 1;
        return { seed() {} };
      },
    },
  });

  assert.equal(result.runRecord.status, 'SUCCESS');
  assert.equal(createCalls, 0);
});

// Defect caught: missing workbook services are swallowed, allowing Apps Script to
// report a completed UAT execution even though no target-workbook operation ran.
test('execute fails visibly when production operation construction fails', () => {
  let orchestrationCalls = 0;

  assert.throws(
    () => Cxp06UatHarness.execute({ scenario: 'PEAK_SUCCESS' }, {
      inputOperations: {
        validateFile() {},
        parse() {},
        validateSchema() {},
        checkDuplicate() {},
      },
      runService: {
        execute() {
          orchestrationCalls += 1;
          return { runRecord: { runId: 'false-success', status: 'SUCCESS' } };
        },
      },
    }),
    (error) => error && error.code === 'INGESTION_INVALID_OPERATIONS',
  );
  assert.equal(orchestrationCalls, 0);
});

// Defect caught: parameterless hosted runs never open the configured target and
// control workbooks, so production adapters have nothing to write to.
test('hosted dependencies bind configured workbooks to input, commit, and run services', () => {
  const openedIds = [];
  const spreadsheets = {
    'control-id': { role: 'control' },
    'target-id': { role: 'target' },
  };
  const ledgerRepository = { role: 'ledger' };
  const runRepository = { role: 'runs' };
  const flush = () => {};

  const dependencies = Cxp06UatHarness.createHostedDependencies(
    safeProperties(),
    {
      driveApi: { role: 'drive-api' },
      driveApp: { role: 'drive-app' },
      flush,
      lockService: { role: 'lock' },
      session: { getActiveUser: () => ({ getEmail: () => 'uat@example.test' }) },
      spreadsheetApp: {
        openById(id) {
          openedIds.push(id);
          return spreadsheets[id];
        },
      },
      utilities: { role: 'utilities' },
    },
    {
      fileLedgerRepository: { create: () => ledgerRepository },
      runRepository: { create: () => runRepository },
    },
  );

  assert.deepEqual(openedIds, ['target-id', 'control-id']);
  assert.equal(dependencies.commitServices.targetSpreadsheet, spreadsheets['target-id']);
  assert.equal(dependencies.commitServices.ledgerRepository, ledgerRepository);
  assert.equal(dependencies.inputServices.ledgerRepository, ledgerRepository);
  assert.equal(dependencies.runServices.repository, runRepository);
  assert.equal(dependencies.request.targetWorkbookId, 'target-id');
  assert.equal(dependencies.adapterRequest.sources.length, 5);
  assert.equal(dependencies.adapterRequest.sources[0].fileId, 'handled-id');
  assert.equal(dependencies.adapterRequest.sources[4].datasetName, 'Staff');
});

function rawRepository() {
  const state = {
    reads: [{ datasetName: 'Handled', formulas: [['']], values: [['old']] }],
  };
  return {
    state,
    repository: {
      preflight: () => ({ datasetCount: 5 }),
      readAll: () => state.reads,
      replaceAll: () => ({ datasetCount: 5 }),
      replaceOne: () => ({ datasetName: 'Handled', rowCount: 1 }),
      restoreAll: () => ({ datasetCount: 5 }),
    },
  };
}

// Defect caught: a fault fires before its documented production seam.
// Defect caught: a health mismatch armed during replacement disappears when final health runs in a fresh trigger invocation.
test('phase-scoped health mismatch corrupts one health read without depending on replacement state', () => {
  const base = rawRepository();
  const injector = Cxp06FaultInjector.create('HEALTH_MISMATCH');
  const decoratedRaw = injector.wrapRawRepository(base.repository);
  decoratedRaw.replaceAll([]);
  assert.deepEqual(decoratedRaw.readAll(), base.state.reads);

  const operations = injector.wrapOperations({
    healthCheck() {
      return decoratedRaw.readAll();
    },
  });

  assert.notDeepEqual(operations.healthCheck(), base.state.reads);
  assert.deepEqual(decoratedRaw.readAll(), base.state.reads);
});

// Defect caught: the harness creates a phase decorator but never applies it to the operations delegated to RunService.
test('CASE04 harness execution applies the phase-scoped health mismatch', () => {
  const base = rawRepository();
  const result = Cxp06UatHarness.execute({ scenario: 'CASE4_HEALTH_MISMATCH' }, {
    commitService: {
      createOperations(services) {
        const decoratedRaw = services.decorateRawRepository(base.repository);
        return {
          commit() {},
          healthCheck() {
            if (decoratedRaw.readAll()[0].values[0][0] !== 'old') {
              throw ErrorCodes.create('CALCULATION_HEALTH_CHECK_FAILED', {
                details: { rollbackStatus: 'VERIFIED' },
              });
            }
          },
          recalculate() {},
          stage() {},
          validateStage() {},
        };
      },
    },
    inputOperations: {
      checkDuplicate() {},
      parse() {},
      validateFile() {},
      validateSchema() {},
    },
    properties: safeProperties(),
    runService: {
      execute(_request, operations) {
        operations.healthCheck();
        return { runRecord: { runId: 'case04-false-success', status: 'SUCCESS' } };
      },
    },
  });

  assert.equal(result.error.code, 'CALCULATION_HEALTH_CHECK_FAILED');
  assert.equal(result.error.details.rollbackStatus, 'VERIFIED');
  assert.equal(result.runRecord, null);
});

test('faults fire only at their intended raw, health, rollback, and cleanup seams', () => {
  const mid = Cxp06FaultInjector.create('AFTER_SECOND_RAW_REPLACEMENT');
  assert.doesNotThrow(() => mid.rawObserver.afterReplacement({ index: 0 }));
  assert.throws(
    () => mid.rawObserver.afterReplacement({ index: 1 }),
    /UAT_AFTER_SECOND_RAW_REPLACEMENT/,
  );

  const write = Cxp06FaultInjector.create('ROLLBACK_WRITE_FAILURE');
  assert.doesNotThrow(
    () => write.rawObserver.afterRestoreWrite({ index: 0 }),
  );
  assert.throws(
    () => write.rawObserver.afterReplacement({ index: 1 }),
    /UAT_ROLLBACK_TRIGGER/,
  );
  assert.throws(
    () => write.rawObserver.afterRestoreWrite({ index: 0 }),
    /UAT_ROLLBACK_WRITE_FAILURE/,
  );

  const verifyBase = rawRepository();
  const verifyInjector = Cxp06FaultInjector.create('ROLLBACK_VERIFY_FAILURE');
  const verify = verifyInjector.wrapRawRepository(verifyBase.repository);
  assert.throws(
    () => verifyInjector.rawObserver.afterReplacement({ index: 1 }),
    /UAT_ROLLBACK_TRIGGER/,
  );
  verify.restoreAll([]);
  assert.notDeepEqual(verify.readAll(), verifyBase.state.reads);

  let cleanupCalls = 0;
  const cleanup = Cxp06FaultInjector.create('BACKUP_CLEANUP_FAILURE')
    .wrapBackupRepository({
      createGroup: () => ({}),
      deleteGroup: () => { cleanupCalls += 1; },
      discoverGroups: () => [],
      readGroup: () => [],
    });
  assert.throws(() => cleanup.deleteGroup({}), /UAT_BACKUP_CLEANUP_FAILURE/);
  assert.equal(cleanupCalls, 0);
});

// Defect caught: evidence leaks cell contents, keys, emails, filenames, or formulas.
test('evidence applies a strict sanitized metadata allowlist', () => {
  const evidence = Cxp06UatEvidence.sanitize({
    backupCleanupStatus: 'PENDING',
    backupSheetCount: 5,
    elapsedMs: 1234,
    endedAtUtc: '2026-08-24T00:00:02.000Z',
    environment: 'DEV',
    fileLedgerResult: 'SUCCESS',
    formulaText: '=SECRET()',
    rawFormulaCount: 0,
    rawRowCounts: { Handled: 10000 },
    rollbackStatus: 'VERIFIED',
    rows: [['secret@example.test']],
    runId: 'run-uat',
    scenario: 'PEAK_SUCCESS',
    sourceFileName: 'private.xlsx',
    stageFormulaCount: 0,
    stageRowCounts: { Handled: 10000 },
    startedAtUtc: '2026-08-24T00:00:00.000Z',
    terminalState: 'SUCCESS',
    runtimeIndicator: 'WITHIN_LIMIT',
  });
  assert.deepEqual(Object.keys(evidence), Cxp06UatEvidence.ALLOWED_FIELDS);
  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes('secret@example.test'), false);
  assert.equal(serialized.includes('private.xlsx'), false);
  assert.equal(serialized.includes('SECRET'), false);
});

// Defect caught: Entrypoints fail to expose parameterless entrypoints or allow PROD execution.
test('every entrypoint is parameterless and delegates to Cxp06UatHarness with safety checks', () => {
  const entrypoints = [
    'cxp06UatPreflight',
    'cxp06UatCase1PeakSuccess',
    'cxp06UatCase2InvalidStage',
    'cxp06UatCase3MidCommitFailure',
    'cxp06UatCase4HealthMismatch',
    'cxp06UatCase4RollbackFailure',
    'cxp06UatCase5IncompleteBackup',
    'cxp06UatCase5CompleteUnsuccessfulBackup',
    'cxp06UatCase5SuccessfulLeftoverBackup',
    'cxp06UatCase5TwoCompleteUnsuccessfulBackups',
    'cxp06UatCase5CleanupFailure',
    'cxp06UatReaderVisibility',
    'continueCxp06UatPipeline',
    'getCxp06UatPipelineStatus',
  ];

  entrypoints.forEach((name) => {
    assert.equal(typeof Cxp06UatEntrypoints[name], 'function');
    assert.equal(Cxp06UatEntrypoints[name].length, 0);
  });

  const preflight = Cxp06UatEntrypoints.cxp06UatPreflight();
  assert.equal(preflight.runRecord.status, 'PREFLIGHT_PASS');
  assert.equal(preflight.evidence.scenario, 'PREFLIGHT');
  assert.equal(preflight.evidence.environment, 'DEV');
});

// Defect caught: hosted start and continuation entrypoints return after a few
// seconds without emitting their status object to the Apps Script execution log.
test('hosted pipeline entrypoints log every returned start and continuation status', () => {
  const modulePath = require.resolve('../src/main/Cxp06UatEntrypoints.js');
  const originalContinuation = global.Cxp06UatContinuation;
  const originalPropertiesService = global.PropertiesService;
  const originalScriptApp = global.ScriptApp;
  const originalSpreadsheetApp = global.SpreadsheetApp;
  const originalConsole = global.console;
  const logs = [];
  const status = {
    continuationScheduled: true,
    environment: 'DEV',
    scenario: 'CASE1_PEAK_SUCCESS',
    status: 'BACKUP_PENDING',
  };
  try {
    global.Cxp06UatContinuation = {
      continueConfigured: () => status,
      start: () => status,
    };
    global.PropertiesService = {};
    global.ScriptApp = {};
    global.SpreadsheetApp = {};
    global.console = { log: (message) => logs.push(message) };
    delete require.cache[modulePath];
    const hostedEntrypoints = require(modulePath);

    assert.equal(hostedEntrypoints.cxp06UatCase1PeakSuccess(), status);
    assert.equal(hostedEntrypoints.continueCxp06UatPipeline(), status);
    const failedStatus = {
      continuationScheduled: false,
      environment: 'DEV',
      lastErrorCode: 'MIGRATION_ROLLBACK_FAILED',
      status: 'FAILED',
    };
    const failure = new Error('Synthetic continuation failure.');
    failure.code = 'MIGRATION_ROLLBACK_FAILED';
    global.Cxp06UatContinuation.continueConfigured = () => { throw failure; };
    global.Cxp06UatContinuation.getStatus = () => failedStatus;
    assert.throws(
      () => hostedEntrypoints.continueCxp06UatPipeline(),
      { code: 'MIGRATION_ROLLBACK_FAILED' },
    );
  } finally {
    delete require.cache[modulePath];
    if (originalContinuation === undefined) delete global.Cxp06UatContinuation;
    else global.Cxp06UatContinuation = originalContinuation;
    if (originalPropertiesService === undefined) delete global.PropertiesService;
    else global.PropertiesService = originalPropertiesService;
    if (originalScriptApp === undefined) delete global.ScriptApp;
    else global.ScriptApp = originalScriptApp;
    if (originalSpreadsheetApp === undefined) delete global.SpreadsheetApp;
    else global.SpreadsheetApp = originalSpreadsheetApp;
    global.console = originalConsole;
  }

  assert.deepEqual(logs, [
    'CXP06_PIPELINE_START {"continuationScheduled":true,"environment":"DEV","scenario":"CASE1_PEAK_SUCCESS","status":"BACKUP_PENDING"}',
    'CXP06_PIPELINE_CONTINUE {"continuationScheduled":true,"environment":"DEV","scenario":"CASE1_PEAK_SUCCESS","status":"BACKUP_PENDING"}',
    'CXP06_PIPELINE_CONTINUE_FAILED {"continuationScheduled":false,"environment":"DEV","lastErrorCode":"MIGRATION_ROLLBACK_FAILED","status":"FAILED"}',
  ]);
});
