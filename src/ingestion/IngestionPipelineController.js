var IngestionPipelineController = (function () {
  'use strict';
  var INVOCATION_BUDGET_MS = 270000;
  var DEFAULT_STEP_RESERVE_MS = 60000;
  var HANDOFF_MARGIN_MS = 15000;
  var CONTINUATION_DELAY_MS = 1000;
  var SELF_RESUME_DELAY_MS = 60000;
  var SAFETY_DELAY_MS = 420000;
  var ACTIVE_SETTLE_MS = 375000;
  var CONTENTION_BACKOFF_MS = 90000;
  var ACTIVE = Object.freeze(['QUEUED', 'PREPARING', 'BACKUP_PENDING', 'BACKING_UP', 'COMMIT_PENDING', 'COMMITTING']);

  function nowMs(deps) { return new Date(deps.clock.now()).getTime(); }
  function nowIso(deps) { return new Date(nowMs(deps)).toISOString(); }
  function load(properties, key) {
    var raw = properties.getProperty(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_error) { throw new Error('Persisted ingestion pipeline state is invalid.'); }
  }
  function save(properties, key, state) { properties.setProperty(key, JSON.stringify(state)); }
  function matchingTriggers(scriptApp, handler) {
    return scriptApp.getProjectTriggers().filter(function (trigger) {
      return trigger && typeof trigger.getHandlerFunction === 'function' && trigger.getHandlerFunction() === handler;
    });
  }
  function removeTriggers(scriptApp, handler) { matchingTriggers(scriptApp, handler).forEach(function (trigger) { scriptApp.deleteTrigger(trigger); }); }
  function replaceTrigger(scriptApp, handler, delay) {
    var successor = scriptApp.newTrigger(handler).timeBased().after(delay).create();
    matchingTriggers(scriptApp, handler).forEach(function (trigger) {
      var same = trigger === successor || (trigger.getUniqueId && successor.getUniqueId && trigger.getUniqueId() === successor.getUniqueId());
      if (!same) scriptApp.deleteTrigger(trigger);
    });
    return successor;
  }
  function ensureTrigger(scriptApp, handler, delay) {
    if (!matchingTriggers(scriptApp, handler).length) replaceTrigger(scriptApp, handler, delay);
    return true;
  }
  function canStartAnotherStep(elapsedMs, measuredStepMs) {
    return elapsedMs + Math.max(DEFAULT_STEP_RESERVE_MS, measuredStepMs || 0) + HANDOFF_MARGIN_MS < INVOCATION_BUDGET_MS;
  }
  function boundedDetails(error) {
    var source = error && error.details && typeof error.details === 'object' ? error.details : {};
    var allowed = ['boundary', 'datasetName', 'duplicateColumns', 'expectedSourceCount', 'missingColumns', 'missingDatasets', 'missingDatasetSheets', 'presentDatasets', 'reason', 'rollbackStatus', 'sheetName', 'unexpectedColumns'];
    var result = {};
    allowed.forEach(function (key) { if (source[key] !== undefined) result[key] = source[key]; });
    return result;
  }
  function publicResult(state, scheduled) {
    return Object.freeze({
      batchToken: state.batchToken || null,
      continuationScheduled: scheduled === true,
      datasetNames: Object.freeze((state.datasetNames || []).slice()),
      endedAtUtc: state.endedAtUtc || null,
      environment: state.environment,
      lastErrorCode: state.lastErrorCode || null,
      lastErrorDetails: Object.freeze(Object.assign({}, state.lastErrorDetails || {})),
      packagingKind: state.packagingKind || null,
      runId: state.checkpoint ? state.checkpoint.runId : state.runId || null,
      startedAtUtc: state.startedAtUtc || null,
      status: state.status,
      updatedAtUtc: state.updatedAtUtc || null,
    });
  }
  function resolveDeps(supplied) {
    var deps = supplied || {};
    if (!deps.properties && typeof PropertiesService !== 'undefined') deps.properties = PropertiesService.getScriptProperties();
    if (!deps.scriptApp && typeof ScriptApp !== 'undefined') deps.scriptApp = ScriptApp;
    if (!deps.clock) deps.clock = { now: function () { return new Date(); } };
    if (!deps.properties || !deps.scriptApp) throw new Error('Pipeline properties and trigger services are required.');
    return deps;
  }
  function create(options) {
    var opts = options || {};
    if (!opts.stateKey || !opts.handler || typeof opts.executorFactory !== 'function') throw new Error('Pipeline controller configuration is incomplete.');
    function executor(state, deps) { return opts.executorFactory(state, deps); }
    function recordFailure(state, error, deps) {
      state.status = 'FAILED';
      state.endedAtUtc = nowIso(deps);
      state.lastErrorCode = error && error.code ? error.code : 'INGESTION_OPERATION_FAILED';
      state.lastErrorDetails = boundedDetails(error);
      state.updatedAtUtc = state.endedAtUtc;
      save(deps.properties, opts.stateKey, state);
      try {
        var worker = executor(state, deps);
        if (worker.auditFailure && state.checkpoint) worker.auditFailure(state, error);
        state.failureAuditStatus = 'RECORDED';
        removeTriggers(deps.scriptApp, opts.handler);
      } catch (auditError) {
        state.failureAuditStatus = 'PENDING';
        state.lastAuditErrorCode = auditError && auditError.code ? auditError.code : 'REPORTING_LOG_WRITE_FAILED';
        replaceTrigger(deps.scriptApp, opts.handler, SELF_RESUME_DELAY_MS);
      }
      save(deps.properties, opts.stateKey, state);
      throw error;
    }
    function prepare(state, deps) {
      state.status = 'PREPARING';
      state.phaseStartedAtUtc = nowIso(deps);
      state.updatedAtUtc = state.phaseStartedAtUtc;
      save(deps.properties, opts.stateKey, state);
      replaceTrigger(deps.scriptApp, opts.handler, SAFETY_DELAY_MS);
      try {
        var prepared = executor(state, deps).prepare(state);
        if (!prepared || !prepared.checkpoint) throw new Error('Pipeline preparation did not produce a checkpoint.');
        state.checkpoint = prepared.checkpoint;
        state.runId = prepared.checkpoint.runId;
        state.status = 'BACKUP_PENDING';
        state.updatedAtUtc = nowIso(deps);
        save(deps.properties, opts.stateKey, state);
        replaceTrigger(deps.scriptApp, opts.handler, CONTINUATION_DELAY_MS);
        return publicResult(state, true);
      } catch (error) { return recordFailure(state, error, deps); }
    }
    function backup(state, deps) {
      var started = nowMs(deps);
      var measured = state.maxBackupStepMs || 0;
      var packed = Object.create(null);
      state.status = 'BACKING_UP'; state.phaseStartedAtUtc = nowIso(deps); state.updatedAtUtc = state.phaseStartedAtUtc;
      save(deps.properties, opts.stateKey, state); replaceTrigger(deps.scriptApp, opts.handler, SAFETY_DELAY_MS);
      try {
        while (true) {
          var stepStart = nowMs(deps);
          var result = executor(state, deps).backup(state);
          var stepEnd = nowMs(deps);
          measured = Math.max(measured, stepEnd - stepStart);
          state.maxBackupStepMs = measured;
          state.lastCompletedBackupDataset = result && result.createdDatasetName || state.lastCompletedBackupDataset || null;
          state.updatedAtUtc = nowIso(deps);
          save(deps.properties, opts.stateKey, state);
          if (!result || typeof result.complete !== 'boolean') throw new Error('Backup worker returned invalid progress.');
          if (result.complete) {
            state.checkpoint.data.backupRunId = state.checkpoint.runId;
            state.status = 'COMMIT_PENDING'; state.updatedAtUtc = nowIso(deps);
            save(deps.properties, opts.stateKey, state); replaceTrigger(deps.scriptApp, opts.handler, CONTINUATION_DELAY_MS);
            return publicResult(state, true);
          }
          var name = result.createdDatasetName;
          if (!name || packed[name] || !canStartAnotherStep(nowMs(deps) - started, measured)) {
            state.status = 'BACKUP_PENDING'; state.updatedAtUtc = nowIso(deps);
            save(deps.properties, opts.stateKey, state); replaceTrigger(deps.scriptApp, opts.handler, CONTINUATION_DELAY_MS);
            return publicResult(state, true);
          }
          packed[name] = true;
        }
      } catch (error) {
        if (error && error.code === 'INGESTION_LOCK_TIMEOUT') {
          state.status = 'BACKUP_PENDING'; state.updatedAtUtc = nowIso(deps); save(deps.properties, opts.stateKey, state);
          replaceTrigger(deps.scriptApp, opts.handler, CONTENTION_BACKOFF_MS); return publicResult(state, true);
        }
        return recordFailure(state, error, deps);
      }
    }
    function commit(state, deps) {
      var started = nowMs(deps);
      state.status = 'COMMITTING'; state.phaseStartedAtUtc = nowIso(deps); state.updatedAtUtc = state.phaseStartedAtUtc;
      save(deps.properties, opts.stateKey, state); replaceTrigger(deps.scriptApp, opts.handler, SAFETY_DELAY_MS);
      try {
        var result = executor(state, deps).commit(state);
        if (result && result.runRecord && result.runRecord.status === 'SUCCESS') {
          state.status = 'COMPLETE'; state.endedAtUtc = result.runRecord.endedAtUtc || nowIso(deps); state.updatedAtUtc = nowIso(deps);
          save(deps.properties, opts.stateKey, state); removeTriggers(deps.scriptApp, opts.handler); return publicResult(state, false);
        }
        var progress = result && result.commitProgress;
        if (!progress || !Number.isInteger(progress.nextDatasetIndex) || !progress.lastCompletedDatasetName) throw new Error('Commit worker returned invalid progress.');
        state.checkpoint.data.commitProgress = progress;
        state.lastCompletedCommitDataset = progress.lastCompletedDatasetName;
        state.maxCommitStepMs = Math.max(state.maxCommitStepMs || 0, nowMs(deps) - started);
        state.status = 'COMMIT_PENDING'; state.updatedAtUtc = nowIso(deps);
        save(deps.properties, opts.stateKey, state); replaceTrigger(deps.scriptApp, opts.handler, progress.complete ? CONTINUATION_DELAY_MS : SELF_RESUME_DELAY_MS);
        return publicResult(state, true);
      } catch (error) {
        if (error && error.code === 'INGESTION_LOCK_TIMEOUT') {
          state.status = 'COMMIT_PENDING'; state.updatedAtUtc = nowIso(deps); save(deps.properties, opts.stateKey, state);
          replaceTrigger(deps.scriptApp, opts.handler, CONTENTION_BACKOFF_MS); return publicResult(state, true);
        }
        return recordFailure(state, error, deps);
      }
    }
    function continueRun(services) {
      var deps = resolveDeps(services);
      var state = load(deps.properties, opts.stateKey);
      if (!state) return Object.freeze({ continuationScheduled: false, runId: null, status: 'IDLE' });
      if (state.version !== 1) throw new Error('Persisted ingestion pipeline state is unsupported.');
      if (state.status === 'FAILED' && state.failureAuditStatus === 'PENDING' && state.checkpoint) {
        var retryError = new Error('Retrying terminal ingestion failure audit.');
        retryError.code = state.lastErrorCode || 'INGESTION_OPERATION_FAILED';
        retryError.details = state.lastErrorDetails || {};
        try {
          executor(state, deps).auditFailure(state, retryError);
          state.failureAuditStatus = 'RECORDED'; state.lastAuditErrorCode = null; state.updatedAtUtc = nowIso(deps);
          save(deps.properties, opts.stateKey, state); removeTriggers(deps.scriptApp, opts.handler); return publicResult(state, false);
        } catch (auditError) {
          state.lastAuditErrorCode = auditError && auditError.code ? auditError.code : 'REPORTING_LOG_WRITE_FAILED';
          state.updatedAtUtc = nowIso(deps); save(deps.properties, opts.stateKey, state);
          replaceTrigger(deps.scriptApp, opts.handler, SELF_RESUME_DELAY_MS); return publicResult(state, true);
        }
      }
      if (state.status === 'COMPLETE' || state.status === 'FAILED') { removeTriggers(deps.scriptApp, opts.handler); return publicResult(state, false); }
      if ((state.status === 'BACKING_UP' || state.status === 'COMMITTING' || state.status === 'PREPARING') && state.phaseStartedAtUtc) {
        var age = nowMs(deps) - new Date(state.phaseStartedAtUtc).getTime();
        if (age >= 0 && age < ACTIVE_SETTLE_MS) { replaceTrigger(deps.scriptApp, opts.handler, Math.max(CONTINUATION_DELAY_MS, ACTIVE_SETTLE_MS - age)); return publicResult(state, true); }
      }
      if (state.status === 'QUEUED' || !state.checkpoint) return prepare(state, deps);
      if (state.status === 'BACKUP_PENDING' || state.status === 'BACKING_UP') return backup(state, deps);
      return commit(state, deps);
    }
    function start(seed, services) {
      var deps = resolveDeps(services);
      var lock = deps.lockService && deps.lockService.getScriptLock ? deps.lockService.getScriptLock() : null;
      if (lock && (!lock.tryLock || lock.tryLock(5000) !== true)) {
        var lockError = new Error('Another ingestion run is active.'); lockError.code = 'INGESTION_RUN_ALREADY_ACTIVE'; throw lockError;
      }
      try {
        var current = load(deps.properties, opts.stateKey);
        if (current && (ACTIVE.indexOf(current.status) !== -1 || current.failureAuditStatus === 'PENDING')) {
          var activeError = new Error('Another ingestion run is active.'); activeError.code = 'INGESTION_RUN_ALREADY_ACTIVE'; throw activeError;
        }
        var timestamp = nowIso(deps);
        var state = Object.assign({}, seed || {}, { checkpoint: null, endedAtUtc: null, lastErrorCode: null, lastErrorDetails: {}, runId: seed && seed.runId || null, startedAtUtc: timestamp, status: 'QUEUED', updatedAtUtc: timestamp, version: 1 });
        save(deps.properties, opts.stateKey, state);
        replaceTrigger(deps.scriptApp, opts.handler, CONTINUATION_DELAY_MS);
        return publicResult(state, true);
      } finally {
        if (lock && lock.releaseLock) lock.releaseLock();
      }
    }
    function getStatus(services) {
      var deps = resolveDeps(services); var state = load(deps.properties, opts.stateKey);
      return state ? publicResult(state, matchingTriggers(deps.scriptApp, opts.handler).length > 0) : Object.freeze({ continuationScheduled: false, runId: null, status: 'IDLE' });
    }
    return Object.freeze({ continueRun: continueRun, getStatus: getStatus, start: start });
  }
  return Object.freeze({ ACTIVE_STATES: ACTIVE, DEFAULT_STEP_RESERVE_MS: DEFAULT_STEP_RESERVE_MS, HANDOFF_MARGIN_MS: HANDOFF_MARGIN_MS, INVOCATION_BUDGET_MS: INVOCATION_BUDGET_MS, canStartAnotherStep: canStartAnotherStep, create: create });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = IngestionPipelineController;
