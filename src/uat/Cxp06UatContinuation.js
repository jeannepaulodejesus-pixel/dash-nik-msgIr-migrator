var Cxp06UatContinuation = (function () {
  'use strict';

  var CONTINUATION_DELAY_MS = 1000;
  var SELF_RESUME_DELAY_MS = 60000;
  var CONTINUATION_HANDLER = 'continueCxp06UatPipeline';
  var STATE_KEY = 'CXP06_UAT_PIPELINE_STATE';
  var STATE_VERSION = 1;
  var SAFETY_CONTINUATION_DELAY_MS = 420000;
  var ACTIVE_PHASE_SETTLE_AGE_MS = 375000;
  var INVOCATION_BUDGET_MS = 270000;
  var DEFAULT_STEP_RESERVE_MS = 60000;
  var HANDOFF_MARGIN_MS = 15000;
  var CONTENTION_BACKOFF_MS = 90000;
  var CONTENTION_ERROR_CODE = 'INGESTION_LOCK_TIMEOUT';

  function resolveHarness() {
    if (typeof Cxp06UatHarness !== 'undefined') {
      return Cxp06UatHarness;
    }
    return require('./Cxp06UatHarness.js');
  }

  function resolveRunService() {
    if (typeof RunService !== 'undefined') {
      return RunService;
    }
    return require('../ingestion/RunService.js');
  }

  function resolveDatasetSheets() {
    if (typeof DatasetSheets !== 'undefined') {
      return DatasetSheets;
    }
    return require('../config/DatasetSheets.js');
  }

  function resolveServices(services) {
    var supplied = services || {};
    var properties = supplied.properties;
    if (!properties && typeof PropertiesService !== 'undefined') {
      properties = PropertiesService.getScriptProperties();
    }
    var scriptApp = supplied.scriptApp;
    if (!scriptApp && typeof ScriptApp !== 'undefined') {
      scriptApp = ScriptApp;
    }
    var logger = supplied.logger;
    if (!logger && typeof PropertiesService !== 'undefined' &&
        typeof console !== 'undefined' && typeof console.log === 'function') {
      logger = console;
    }
    if (!properties || typeof properties.getProperty !== 'function' ||
        typeof properties.setProperty !== 'function') {
      throw new Error('Script Properties are required for CXP-06 continuation.');
    }
    if (!scriptApp || typeof scriptApp.getProjectTriggers !== 'function' ||
        typeof scriptApp.deleteTrigger !== 'function' ||
        typeof scriptApp.newTrigger !== 'function') {
      throw new Error('ScriptApp trigger management is required for CXP-06 continuation.');
    }
    return Object.assign({}, supplied, {
      clock: supplied.clock || { now: function () { return new Date(); } },
      logger: logger,
      properties: properties,
      scriptApp: scriptApp,
    });
  }

  function nowIso(dependencies) {
    var value = dependencies.clock.now();
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error('The CXP-06 continuation clock is invalid.');
    }
    return date.toISOString();
  }

  function requireSafety(properties) {
    var environment = properties.getProperty('CXP_ENV');
    var enabled = properties.getProperty('CXP_UAT_ENABLED');
    if (environment === 'PROD') {
      throw new Error('UAT continuation is not available in PROD environment.');
    }
    if (environment !== 'DEV' && environment !== 'UAT') {
      throw new Error('UAT continuation requires DEV or UAT environment.');
    }
    if (enabled !== 'true' && enabled !== true) {
      throw new Error('UAT continuation requires CXP_UAT_ENABLED=true.');
    }
    return environment;
  }

  function loadState(properties) {
    var raw = properties.getProperty(STATE_KEY);
    if (!raw) {
      return null;
    }
    var state;
    try {
      state = JSON.parse(raw);
    } catch (error) {
      throw new Error('The persisted CXP-06 continuation state is invalid.');
    }
    if (!state || state.version !== STATE_VERSION) {
      throw new Error('The persisted CXP-06 continuation state is unsupported.');
    }
    return state;
  }

  function saveState(properties, state) {
    properties.setProperty(STATE_KEY, JSON.stringify(state));
  }

  function removeTriggers(scriptApp) {
    scriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger && typeof trigger.getHandlerFunction === 'function' &&
          trigger.getHandlerFunction() === CONTINUATION_HANDLER) {
        scriptApp.deleteTrigger(trigger);
      }
    });
  }

  function hasContinuationTrigger(scriptApp) {
    return scriptApp.getProjectTriggers().some(function (trigger) {
      return typeof trigger.getHandlerFunction === 'function' &&
        trigger.getHandlerFunction() === CONTINUATION_HANDLER;
    });
  }

  function schedule(scriptApp, delayMs) {
    return scriptApp.newTrigger(CONTINUATION_HANDLER)
      .timeBased()
      .after(delayMs)
      .create();
  }

  function sameTrigger(left, right) {
    if (left === right) {
      return true;
    }
    if (!left || !right || typeof left.getUniqueId !== 'function' ||
        typeof right.getUniqueId !== 'function') {
      return false;
    }
    return left.getUniqueId() === right.getUniqueId();
  }

  function replaceContinuationTrigger(scriptApp, delayMs) {
    var successor = schedule(scriptApp, delayMs);
    scriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger && typeof trigger.getHandlerFunction === 'function' &&
          trigger.getHandlerFunction() === CONTINUATION_HANDLER &&
          !sameTrigger(trigger, successor)) {
        scriptApp.deleteTrigger(trigger);
      }
    });
    return successor;
  }

  function ensureContinuationTrigger(scriptApp, delayMs) {
    if (!hasContinuationTrigger(scriptApp)) {
      schedule(scriptApp, delayMs);
    }
    return true;
  }

  function publicResult(state, continuationScheduled) {
    return Object.freeze({
      continuationScheduled: continuationScheduled === true,
      environment: state.environment,
      heartbeatAtUtc: state.heartbeatAtUtc || null,
      lastCompletedBackupDataset: state.lastCompletedBackupDataset || null,
      lastCompletedCommitDataset: state.lastCompletedCommitDataset || null,
      lastErrorCode: state.lastErrorCode || null,
      lastErrorDetails: state.lastErrorDetails || null,
      runId: state.checkpoint ? state.checkpoint.runId : null,
      scenario: state.scenario,
      status: state.status,
      updatedAtUtc: state.updatedAtUtc,
    });
  }

  function logWorkerStep(dependencies, event) {
    if (!dependencies.logger || typeof dependencies.logger.log !== 'function') {
      return;
    }
    dependencies.logger.log('CXP06_WORKER_STEP ' + JSON.stringify({
      datasetName: event.datasetName || null,
      decision: event.decision,
      durationMs: event.durationMs,
      elapsedMs: event.elapsedMs,
      nextDatasetIndex: Number.isInteger(event.nextDatasetIndex)
        ? event.nextDatasetIndex
        : null,
      phase: event.phase,
    }));
  }

  function boundedErrorDetails(error) {
    var source = error && error.details && typeof error.details === 'object'
      ? error.details
      : {};
    var result = {};
    [
      'backupRunId',
      'boundary',
      'datasetName',
      'originalErrorCode',
      'reason',
      'rollbackStatus',
      'timeoutMs',
    ].forEach(function (field) {
      var value = source[field];
      if (typeof value === 'string' || typeof value === 'number' ||
          typeof value === 'boolean') {
        result[field] = value;
      }
    });
    return Object.freeze(result);
  }

  function deferIfPhaseMayStillBeRunning(state, dependencies) {
    if (state.status !== 'PREPARING' && state.status !== 'BACKING_UP' &&
        state.status !== 'COMMITTING') {
      return null;
    }
    var phaseStartedAtMs = Date.parse(state.updatedAtUtc);
    var currentValue = dependencies.clock.now();
    var currentDate = currentValue instanceof Date ? currentValue : new Date(currentValue);
    if (Number.isNaN(phaseStartedAtMs) || Number.isNaN(currentDate.getTime())) {
      return null;
    }
    var remainingMs = ACTIVE_PHASE_SETTLE_AGE_MS - (currentDate.getTime() - phaseStartedAtMs);
    if (remainingMs <= 0) {
      return null;
    }
    replaceContinuationTrigger(
      dependencies.scriptApp,
      Math.max(CONTINUATION_DELAY_MS, remainingMs),
    );
    return publicResult(state, true);
  }

  function productionExecutor(dependencies) {
    var harness = resolveHarness();
    var runService = resolveRunService();

    function hostedDependencies() {
      return harness.createHostedDependencies(
        dependencies.properties,
        harness.hostedRuntimeServices(),
      );
    }

    function runHarness(scenario, adapter) {
      var hosted = hostedDependencies();
      var result = harness.execute(
        { scenario: scenario },
        Object.assign({}, hosted, { runService: adapter }),
      );
      if (result && result.error) {
        throw result.error;
      }
      return result;
    }

    return Object.freeze({
      backup: function (state) {
        var output;
        var adapter = {
          execute: function (request, operations) {
            if (request.targetWorkbookId !== state.checkpoint.request.targetWorkbookId) {
              throw new Error('The CXP-06 continuation target workbook changed.');
            }
            if (typeof operations.resumeBackup !== 'function' ||
                typeof operations.backupStep !== 'function') {
              throw new Error('CXP-06 incremental backup operations are unavailable.');
            }
            var context = {
              operationResults: {},
              request: state.checkpoint.request,
              runId: state.checkpoint.runId,
              startedAtUtc: state.checkpoint.startedAtUtc,
            };
            operations.resumeBackup(context, state.checkpoint.data || {});
            output = operations.backupStep(context);
            return {
              operationResults: { backupStep: output },
              runRecord: { runId: context.runId, status: 'PREPARED' },
            };
          },
        };
        runHarness(state.scenario, adapter);
        return output;
      },
      commit: function (state) {
        var output;
        var checkpointData = state.checkpoint.data || {};
        var commitProgress = checkpointData.commitProgress;
        if (!commitProgress || commitProgress.complete !== true) {
          var stepAdapter = {
            execute: function (request, operations) {
              if (request.targetWorkbookId !== state.checkpoint.request.targetWorkbookId) {
                throw new Error('The CXP-06 continuation target workbook changed.');
              }
              if (typeof operations.resumeDataset !== 'function' ||
                  typeof operations.commitDatasetStep !== 'function') {
                throw new Error('CXP-06 resumable commit operations are unavailable.');
              }
              var context = {
                operationResults: {},
                request: state.checkpoint.request,
                runId: state.checkpoint.runId,
                startedAtUtc: state.checkpoint.startedAtUtc,
              };
              var datasetNames = Array.isArray(checkpointData.datasetNames)
                ? checkpointData.datasetNames
                : resolveDatasetSheets().listBindings().map(function (binding) {
                  return binding.datasetName;
                });
              var datasetName = datasetNames[(commitProgress || {
                nextDatasetIndex: 0,
              }).nextDatasetIndex];
              operations.resumeDataset(context, checkpointData, datasetName);
              output = {
                commitProgress: operations.commitDatasetStep(
                  context,
                  commitProgress || {
                    complete: false,
                    lastCompletedDatasetName: null,
                    nextDatasetIndex: 0,
                  },
                ),
              };
              return {
                operationResults: { commitStep: output.commitProgress },
                runRecord: { runId: context.runId, status: 'PREPARED' },
              };
            },
          };
          runHarness(state.scenario, stepAdapter);
          return output;
        }
        var adapter = {
          execute: function (request, operations, runServices) {
            if (request.targetWorkbookId !== state.checkpoint.request.targetWorkbookId) {
              throw new Error('The CXP-06 continuation target workbook changed.');
            }
            output = runService.resume(state.checkpoint, operations, runServices);
            return output;
          },
        };
        runHarness(state.scenario, adapter);
        return output;
      },
      prepare: function (scenario) {
        var prepared;
        var adapter = {
          execute: function (request, operations, runServices) {
            prepared = runService.prepare(
              request,
              operations,
              Object.assign({}, runServices, {
                createCheckpoint: function (context) {
                  var duplicate = context.operationResults.checkDuplicate;
                  return Object.freeze({
                    datasetNames: context.operationResults.validateSchema.payloads.map(
                      function (payload) { return payload.datasetName; },
                    ),
                    fingerprint: duplicate.fingerprint,
                    sourceFiles: duplicate.sourceFiles,
                  });
                },
              }),
            );
            return {
              operationResults: prepared.operationResults,
              runRecord: {
                runId: prepared.checkpoint.runId,
                status: 'PREPARED',
              },
            };
          },
        };
        runHarness(scenario, adapter);
        return prepared;
      },
    });
  }

  function executorFor(dependencies) {
    return dependencies.executor || productionExecutor(dependencies);
  }

  function markFailed(state, error, dependencies) {
    removeTriggers(dependencies.scriptApp);
    state.status = 'FAILED';
    state.lastErrorCode = error && typeof error.code === 'string'
      ? error.code
      : 'UNKNOWN_ERROR';
    state.lastErrorDetails = boundedErrorDetails(error);
    state.updatedAtUtc = nowIso(dependencies);
    saveState(dependencies.properties, state);
    throw error;
  }

  function isLockContention(error) {
    return Boolean(error) && error.code === CONTENTION_ERROR_CODE;
  }

  // Another invocation owns the production-write lock, so the run is still valid
  // and must keep its schedule instead of terminating mid-replacement.
  function rescheduleAfterContention(state, error, dependencies, pendingStatus) {
    state.status = pendingStatus;
    state.lastErrorCode = error.code;
    state.lastErrorDetails = boundedErrorDetails(error);
    state.updatedAtUtc = nowIso(dependencies);
    saveState(dependencies.properties, state);
    replaceContinuationTrigger(dependencies.scriptApp, CONTENTION_BACKOFF_MS);
    return publicResult(state, true);
  }

  function prepareState(state, dependencies) {
    var executor = executorFor(dependencies);
    replaceContinuationTrigger(dependencies.scriptApp, SAFETY_CONTINUATION_DELAY_MS);
    state.status = 'PREPARING';
    state.updatedAtUtc = nowIso(dependencies);
    saveState(dependencies.properties, state);
    try {
      var prepared = executor.prepare(state.scenario);
      if (!prepared || !prepared.checkpoint) {
        throw new Error('CXP-06 preparation did not produce a checkpoint.');
      }
      state.checkpoint = prepared.checkpoint;
      state.lastErrorCode = null;
      state.lastErrorDetails = null;
      state.status = 'BACKUP_PENDING';
      state.updatedAtUtc = nowIso(dependencies);
      saveState(dependencies.properties, state);
      replaceContinuationTrigger(dependencies.scriptApp, CONTINUATION_DELAY_MS);
      return publicResult(state, true);
    } catch (error) {
      return markFailed(state, error, dependencies);
    }
  }

  function backupState(state, dependencies) {
    var executor = executorFor(dependencies);
    var phaseStartedAtMs = new Date(dependencies.clock.now()).getTime();
    replaceContinuationTrigger(dependencies.scriptApp, SAFETY_CONTINUATION_DELAY_MS);
    state.status = 'BACKING_UP';
    state.updatedAtUtc = nowIso(dependencies);
    saveState(dependencies.properties, state);
    try {
      var estimatedStepMs = Number.isFinite(state.maxBackupStepMs) && state.maxBackupStepMs > 0
        ? state.maxBackupStepMs
        : 0;
      var packedDatasets = Object.create(null);
      while (true) {
        var stepStartedAtMs = new Date(dependencies.clock.now()).getTime();
        var result = executor.backup(state);
        if (!result || typeof result.complete !== 'boolean') {
          throw new Error('CXP-06 incremental backup did not return progress.');
        }
        var stepEndedAtMs = new Date(dependencies.clock.now()).getTime();
        estimatedStepMs = Math.max(estimatedStepMs, stepEndedAtMs - stepStartedAtMs);
        state.maxBackupStepMs = estimatedStepMs;
        state.lastCompletedBackupDataset = result.createdDatasetName ||
          state.lastCompletedBackupDataset || null;
        state.heartbeatAtUtc = nowIso(dependencies);
        saveState(dependencies.properties, state);

        if (result.complete) {
          logWorkerStep(dependencies, {
            datasetName: result.createdDatasetName,
            decision: 'PHASE_COMPLETE',
            durationMs: stepEndedAtMs - stepStartedAtMs,
            elapsedMs: stepEndedAtMs - phaseStartedAtMs,
            nextDatasetIndex: null,
            phase: 'BACKUP',
          });
          state.checkpoint.data.backupRunId = state.checkpoint.runId;
          state.status = 'COMMIT_PENDING';
          state.updatedAtUtc = nowIso(dependencies);
          saveState(dependencies.properties, state);
          replaceContinuationTrigger(dependencies.scriptApp, CONTINUATION_DELAY_MS);
          return publicResult(state, true);
        }

        var datasetName = result.createdDatasetName;
        var invocationElapsedMs = new Date(dependencies.clock.now()).getTime() - phaseStartedAtMs;
        var reservedStepMs = Math.max(DEFAULT_STEP_RESERVE_MS, estimatedStepMs);
        if (!datasetName || stepEndedAtMs <= stepStartedAtMs || packedDatasets[datasetName] ||
            invocationElapsedMs + reservedStepMs + HANDOFF_MARGIN_MS >= INVOCATION_BUDGET_MS) {
          logWorkerStep(dependencies, {
            datasetName: datasetName,
            decision: 'HANDOFF',
            durationMs: stepEndedAtMs - stepStartedAtMs,
            elapsedMs: invocationElapsedMs,
            nextDatasetIndex: null,
            phase: 'BACKUP',
          });
          state.status = 'BACKUP_PENDING';
          state.updatedAtUtc = nowIso(dependencies);
          saveState(dependencies.properties, state);
          replaceContinuationTrigger(dependencies.scriptApp, CONTINUATION_DELAY_MS);
          return publicResult(state, true);
        }
        logWorkerStep(dependencies, {
          datasetName: datasetName,
          decision: 'PACK_NEXT',
          durationMs: stepEndedAtMs - stepStartedAtMs,
          elapsedMs: invocationElapsedMs,
          nextDatasetIndex: null,
          phase: 'BACKUP',
        });
        packedDatasets[datasetName] = true;
      }
    } catch (error) {
      if (isLockContention(error)) {
        return rescheduleAfterContention(state, error, dependencies, 'BACKUP_PENDING');
      }
      return markFailed(state, error, dependencies);
    }
  }

  function commitState(state, dependencies) {
    var executor = executorFor(dependencies);
    var phaseStartedAtMs = new Date(dependencies.clock.now()).getTime();
    replaceContinuationTrigger(dependencies.scriptApp, SAFETY_CONTINUATION_DELAY_MS);
    state.status = 'COMMITTING';
    state.updatedAtUtc = nowIso(dependencies);
    saveState(dependencies.properties, state);
    // Peak raw replacement already consumes most of the 4:45 Apps Script
    // budget, so each invocation commits at most one dataset and then
    // schedules the next run instead of packing a second write.
    try {
      var estimatedStepMs = Number.isFinite(state.maxCommitStepMs) && state.maxCommitStepMs > 0
        ? state.maxCommitStepMs
        : 0;
      while (true) {
        var previousIndex = state.checkpoint.data.commitProgress
          ? state.checkpoint.data.commitProgress.nextDatasetIndex
          : 0;
        var stepStartedAtMs = new Date(dependencies.clock.now()).getTime();
        var result = executor.commit(state);
        if (result && result.runRecord && result.runRecord.status === 'SUCCESS') {
          removeTriggers(dependencies.scriptApp);
          state.lastErrorCode = null;
          state.lastErrorDetails = null;
          state.status = 'COMPLETE';
          state.updatedAtUtc = nowIso(dependencies);
          saveState(dependencies.properties, state);
          return publicResult(state, false);
        }
        var progress = result && result.commitProgress;
        if (!progress || typeof progress.complete !== 'boolean' ||
            !Number.isInteger(progress.nextDatasetIndex) ||
            progress.nextDatasetIndex <= previousIndex ||
            typeof progress.lastCompletedDatasetName !== 'string' ||
            !progress.lastCompletedDatasetName) {
          throw new Error('CXP-06 continuation did not return valid commit progress.');
        }
        var stepEndedAtMs = new Date(dependencies.clock.now()).getTime();
        estimatedStepMs = Math.max(estimatedStepMs, stepEndedAtMs - stepStartedAtMs);
        state.checkpoint.data.commitProgress = {
          complete: progress.complete,
          lastCompletedDatasetName: progress.lastCompletedDatasetName,
          nextDatasetIndex: progress.nextDatasetIndex,
        };
        state.lastCompletedCommitDataset = progress.lastCompletedDatasetName;
        state.maxCommitStepMs = estimatedStepMs;
        state.heartbeatAtUtc = nowIso(dependencies);
        // Progress is durable, but the phase anchor in updatedAtUtc must not move:
        // it bounds how long another invocation treats this worker as alive.
        saveState(dependencies.properties, state);

        function scheduleCommitContinuation(complete) {
          state.status = 'COMMIT_PENDING';
          state.updatedAtUtc = nowIso(dependencies);
          saveState(dependencies.properties, state);
          replaceContinuationTrigger(
            dependencies.scriptApp,
            complete ? CONTINUATION_DELAY_MS : SELF_RESUME_DELAY_MS,
          );
          return publicResult(state, true);
        }

        if (progress.complete) {
          logWorkerStep(dependencies, {
            datasetName: progress.lastCompletedDatasetName,
            decision: 'PHASE_COMPLETE',
            durationMs: stepEndedAtMs - stepStartedAtMs,
            elapsedMs: stepEndedAtMs - phaseStartedAtMs,
            nextDatasetIndex: progress.nextDatasetIndex,
            phase: 'COMMIT',
          });
          return scheduleCommitContinuation(true);
        }
        var invocationElapsedMs = new Date(dependencies.clock.now()).getTime() - phaseStartedAtMs;
        var reservedStepMs = Math.max(DEFAULT_STEP_RESERVE_MS, estimatedStepMs);
        if (invocationElapsedMs + reservedStepMs + HANDOFF_MARGIN_MS < INVOCATION_BUDGET_MS) {
          logWorkerStep(dependencies, {
            datasetName: progress.lastCompletedDatasetName,
            decision: 'PACK_NEXT',
            durationMs: stepEndedAtMs - stepStartedAtMs,
            elapsedMs: invocationElapsedMs,
            nextDatasetIndex: progress.nextDatasetIndex,
            phase: 'COMMIT',
          });
          continue;
        }
        logWorkerStep(dependencies, {
          datasetName: progress.lastCompletedDatasetName,
          decision: 'HANDOFF',
          durationMs: stepEndedAtMs - stepStartedAtMs,
          elapsedMs: invocationElapsedMs,
          nextDatasetIndex: progress.nextDatasetIndex,
          phase: 'COMMIT',
        });
        return scheduleCommitContinuation(false);
      }
    } catch (error) {
      if (isLockContention(error)) {
        return rescheduleAfterContention(state, error, dependencies, 'COMMIT_PENDING');
      }
      return markFailed(state, error, dependencies);
    }
  }

  function start(scenario, services) {
    var dependencies = resolveServices(services);
    var environment = requireSafety(dependencies.properties);
    var state = loadState(dependencies.properties);
    if (state && state.environment !== environment) {
      throw new Error('The active CXP-06 continuation belongs to another environment.');
    }
    if (state && state.status !== 'COMPLETE' && state.scenario !== scenario) {
      throw new Error('The active CXP-06 continuation belongs to another scenario.');
    }
    if (state && (state.status === 'PREPARING' ||
        state.status === 'BACKUP_PENDING' || state.status === 'BACKING_UP' ||
        state.status === 'COMMIT_PENDING' || state.status === 'COMMITTING')) {
      return publicResult(
        state,
        ensureContinuationTrigger(dependencies.scriptApp, SELF_RESUME_DELAY_MS),
      );
    }
    if (state && state.status === 'FAILED' && state.checkpoint &&
        state.lastErrorCode !== 'MIGRATION_STAGE_VALIDATION_FAILED') {
      if (state.lastErrorCode === 'MIGRATION_ROLLBACK_FAILED') {
        if (state.checkpoint.data) {
          delete state.checkpoint.data.commitProgress;
        }
        state.lastCompletedCommitDataset = null;
      }
      if (state.lastErrorDetails && state.lastErrorDetails.rollbackStatus === 'VERIFIED') {
        if (state.checkpoint.data) {
          delete state.checkpoint.data.backupRunId;
          delete state.checkpoint.data.commitProgress;
        }
        state.lastCompletedCommitDataset = null;
      } else if (state.lastErrorCode === 'MIGRATION_BACKUP_FAILED' && state.checkpoint.data) {
        delete state.checkpoint.data.backupRunId;
      }
      state.lastErrorCode = null;
      state.lastErrorDetails = null;
      if (state.checkpoint.data && state.checkpoint.data.backupRunId) {
        return commitState(state, dependencies);
      }
      return backupState(state, dependencies);
    }
    state = {
      checkpoint: null,
      environment: environment,
      lastErrorCode: null,
      lastErrorDetails: null,
      scenario: scenario,
      startedAtUtc: nowIso(dependencies),
      status: 'PREPARING',
      updatedAtUtc: nowIso(dependencies),
      version: STATE_VERSION,
    };
    saveState(dependencies.properties, state);
    return prepareState(state, dependencies);
  }

  function continueConfigured(services) {
    var dependencies = resolveServices(services);
    var environment = requireSafety(dependencies.properties);
    var state = loadState(dependencies.properties);
    if (!state) {
      return Object.freeze({
        continuationScheduled: false,
        environment: environment,
        lastCompletedBackupDataset: null,
        lastCompletedCommitDataset: null,
        lastErrorCode: null,
        lastErrorDetails: null,
        runId: null,
        scenario: null,
        status: 'IDLE',
        updatedAtUtc: null,
      });
    }
    if (state.environment !== environment) {
      throw new Error('The active CXP-06 continuation belongs to another environment.');
    }
    if (state.status === 'COMPLETE' || state.status === 'FAILED') {
      removeTriggers(dependencies.scriptApp);
      return publicResult(state, false);
    }
    var deferred = deferIfPhaseMayStillBeRunning(state, dependencies);
    if (deferred) {
      return deferred;
    }
    if (state.status === 'BACKUP_PENDING' || state.status === 'BACKING_UP' ||
        (state.status === 'COMMITTING' && state.checkpoint &&
          (!state.checkpoint.data || !state.checkpoint.data.backupRunId))) {
      return backupState(state, dependencies);
    }
    if (state.checkpoint) {
      return commitState(state, dependencies);
    }
    return prepareState(state, dependencies);
  }

  function getStatus(services) {
    var dependencies = resolveServices(services);
    var environment = requireSafety(dependencies.properties);
    var state = loadState(dependencies.properties);
    if (!state) {
      return Object.freeze({
        continuationScheduled: false,
        environment: environment,
        lastCompletedBackupDataset: null,
        lastCompletedCommitDataset: null,
        lastErrorCode: null,
        lastErrorDetails: null,
        runId: null,
        scenario: null,
        status: 'IDLE',
        updatedAtUtc: null,
      });
    }
    return publicResult(state, hasContinuationTrigger(dependencies.scriptApp));
  }

  return Object.freeze({
    CONTINUATION_HANDLER: CONTINUATION_HANDLER,
    STATE_KEY: STATE_KEY,
    continueConfigured: continueConfigured,
    getStatus: getStatus,
    start: start,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp06UatContinuation;
}
