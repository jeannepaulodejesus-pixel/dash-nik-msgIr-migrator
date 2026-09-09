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
  var STATE_VERSION = 2;
  var ACTIVE = Object.freeze([
    'QUEUED', 'PREPARING', 'BACKUP_PENDING', 'BACKING_UP',
    'COMMIT_PENDING', 'COMMITTING', 'HEALTH_PENDING', 'HEALTH_CHECKING',
    'ROLLBACK_PENDING', 'ROLLING_BACK',
  ]);
  var LIVE_PHASES = Object.freeze(['PREPARING', 'BACKING_UP', 'COMMITTING', 'HEALTH_CHECKING', 'ROLLING_BACK']);

  function resolveChunks() {
    if (typeof WorkChunks !== 'undefined') return WorkChunks;
    if (typeof require === 'function') return require('./WorkChunks.js');
    return { DEFAULT_CHUNK_ROWS: 1000 };
  }
  function telemetryModule() {
    if (typeof Cxp13IngestionTelemetry !== 'undefined') return Cxp13IngestionTelemetry;
    if (typeof require === 'function') {
      try { return require('./Cxp13IngestionTelemetry.js'); } catch (_error) { return null; }
    }
    return null;
  }
  function withTelemetry(deps, apply) {
    var module = telemetryModule();
    if (!module || !deps || !deps.properties) return;
    apply(module, deps.properties);
  }
  function nowMs(deps) {
    var value = deps && deps.clock && typeof deps.clock.now === 'function' ? deps.clock.now() : new Date();
    var date = value instanceof Date ? value : new Date(value);
    return date.getTime();
  }
  function nowIso(deps) { return new Date(nowMs(deps)).toISOString(); }
  function load(properties, key) {
    var raw = properties.getProperty(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_error) { throw new Error('Persisted ingestion pipeline state is invalid.'); }
  }
  function migrate(state) {
    if (!state) return null;
    if (state.version === 1) {
      state.version = STATE_VERSION;
      if (!Number.isInteger(state.generation) || state.generation < 1) state.generation = 1;
    }
    if (state.version !== STATE_VERSION) throw new Error('Persisted ingestion pipeline state is unsupported.');
    if (!Number.isInteger(state.generation) || state.generation < 1) state.generation = 1;
    return state;
  }
  function save(properties, key, state) {
    properties.setProperty(key, JSON.stringify(state));
    withTelemetry({ properties: properties }, function (telemetry, props) {
      telemetry.increment(props, 'properties');
    });
  }
  function matchingTriggers(scriptApp, handler) {
    return scriptApp.getProjectTriggers().filter(function (trigger) {
      return trigger && typeof trigger.getHandlerFunction === 'function' && trigger.getHandlerFunction() === handler;
    });
  }
  function removeTriggers(scriptApp, handler) {
    matchingTriggers(scriptApp, handler).forEach(function (trigger) { scriptApp.deleteTrigger(trigger); });
  }
  function replaceTrigger(scriptApp, handler, delay) {
    var successor = scriptApp.newTrigger(handler).timeBased().after(delay).create();
    matchingTriggers(scriptApp, handler).forEach(function (trigger) {
      var same = trigger === successor || (trigger.getUniqueId && successor.getUniqueId && trigger.getUniqueId() === successor.getUniqueId());
      if (!same) scriptApp.deleteTrigger(trigger);
    });
    return successor;
  }
  function canStartAnotherStep(elapsedMs, measuredStepMs) {
    return elapsedMs + Math.max(DEFAULT_STEP_RESERVE_MS, measuredStepMs || 0) + HANDOFF_MARGIN_MS < INVOCATION_BUDGET_MS;
  }
  function auditCompleted(error) {
    return Boolean(error && error.runRecord && error.errorRecord);
  }
  function boundedDetails(error) {
    var source = error && error.details && typeof error.details === 'object' ? error.details : {};
    var allowed = [
      'backupRunId', 'boundary', 'causeMessage', 'datasetName', 'duplicateColumns',
      'chunkStartRow', 'columnIndex', 'columnName', 'comparisonReason',
      'expectedSourceCount', 'missingColumns', 'missingDatasets', 'missingDatasetSheets',
      'intendedValueType', 'persistedValueType', 'schemaType', 'rowOffset',
      'operation', 'originalErrorCode', 'presentDatasets', 'reason', 'rollbackStatus',
      'sheetName', 'unexpectedColumns',
    ];
    var result = {};
    allowed.forEach(function (key) { if (source[key] !== undefined) result[key] = source[key]; });
    return result;
  }
  function phaseName(status) {
    if (status === 'QUEUED' || status === 'PREPARING') return 'PREPARATION';
    if (status === 'BACKUP_PENDING' || status === 'BACKING_UP') return 'BACKUP';
    if (status === 'COMMIT_PENDING' || status === 'COMMITTING') return 'COMMIT';
    if (status === 'HEALTH_PENDING' || status === 'HEALTH_CHECKING') return 'HEALTH_READBACK';
    if (status === 'ROLLBACK_PENDING' || status === 'ROLLING_BACK') return 'ROLLBACK';
    return status;
  }
  function currentCursor(state) {
    var data = state.checkpoint && state.checkpoint.data || {};
    if (state.status === 'PREPARING' || state.status === 'QUEUED') return data.prepareCursor || null;
    if (state.status === 'BACKUP_PENDING' || state.status === 'BACKING_UP') return data.backupCursor || null;
    if (state.status === 'COMMIT_PENDING' || state.status === 'COMMITTING') return data.commitProgress && data.commitProgress.commitCursor || null;
    if (state.status === 'HEALTH_PENDING' || state.status === 'HEALTH_CHECKING') return data.healthCursor || null;
    if (state.status === 'ROLLBACK_PENDING' || state.status === 'ROLLING_BACK') return data.rollbackCursor || null;
    return null;
  }
  function progressDetails(state) {
    var data = state.checkpoint && state.checkpoint.data || {};
    var names = Array.isArray(data.datasetNames) ? data.datasetNames : (state.datasetNames || []);
    var cursor = currentCursor(state) || {};
    var index = Number.isInteger(cursor.datasetIndex) ? cursor.datasetIndex :
      (Number.isInteger(cursor.nextDatasetIndex) ? cursor.nextDatasetIndex :
        (data.commitProgress && Number.isInteger(data.commitProgress.nextDatasetIndex) ? data.commitProgress.nextDatasetIndex : 0));
    var datasetName = cursor.datasetName || names[index] || state.lastCompletedCommitDataset || state.lastCompletedBackupDataset || null;
    var rowCounts = data.rowCounts && typeof data.rowCounts === 'object' ? data.rowCounts : {};
    var hasRowCounts = names.length > 0 && names.every(function (name) { return Number.isInteger(rowCounts[name]); });
    var totalRows = hasRowCounts ? names.reduce(function (sum, name) { return sum + rowCounts[name]; }, 0) : null;
    var chunkRows = Number.isInteger(cursor.chunkRows) && cursor.chunkRows > 0 ? cursor.chunkRows : resolveChunks().DEFAULT_CHUNK_ROWS;
    var precedingRows = hasRowCounts ? names.slice(0, Math.min(index, names.length)).reduce(function (sum, name) { return sum + rowCounts[name]; }, 0) : null;
    var currentTotal = datasetName && Number.isInteger(rowCounts[datasetName]) ? rowCounts[datasetName] : 0;
    var currentRows = Math.max(0, Math.min(currentTotal, (Number.isInteger(cursor.nextRow) ? cursor.nextRow : 1) - 2));
    var completedRows = hasRowCounts ? precedingRows + currentRows : null;
    function matrixUnits(rowCount) {
      // Repository windows include the header row in the encoded matrix.
      return Math.ceil((rowCount + 1) / chunkRows);
    }
    var totalUnits = hasRowCounts ? names.reduce(function (sum, name) { return sum + matrixUnits(rowCounts[name]); }, 0) : names.length;
    var currentUnitActive = ['write', 'verify', 'copy', 'restore', 'trim_verify'].indexOf(cursor.phase) !== -1 &&
      Number.isInteger(cursor.nextRow) && cursor.nextRow > 1;
    var completedUnits = hasRowCounts ? names.slice(0, Math.min(index, names.length)).reduce(function (sum, name) {
      return sum + matrixUnits(rowCounts[name]);
    }, 0) + (currentUnitActive ? Math.ceil((currentRows + 1) / chunkRows) : 0) : Math.min(index, names.length);
    if (state.status === 'HEALTH_PENDING' || state.status === 'HEALTH_CHECKING') {
      completedRows = null;
      totalRows = null;
      completedUnits = Math.min(index, names.length);
      totalUnits = names.length;
    }
    if (state.status === 'COMPLETE') {
      completedRows = totalRows;
      completedUnits = totalUnits;
    }
    var percentComplete = totalUnits > 0 ? Math.max(0, Math.min(100, Math.floor(completedUnits * 100 / totalUnits))) : (state.status === 'COMPLETE' ? 100 : 0);
    var started = state.startedAtUtc ? new Date(state.startedAtUtc).getTime() : NaN;
    var updated = state.updatedAtUtc ? new Date(state.updatedAtUtc).getTime() : NaN;
    var elapsed = Number.isFinite(started) && Number.isFinite(updated) ? Math.max(0, updated - started) : null;
    var phase = phaseName(state.status);
    var measured = phase === 'PREPARATION' ? state.maxPrepareStepMs : phase === 'BACKUP' ? state.maxBackupStepMs :
      phase === 'COMMIT' ? state.maxCommitStepMs : phase === 'HEALTH_READBACK' ? state.maxHealthStepMs : null;
    return {
      completedRows: completedRows,
      completedUnits: completedUnits,
      datasetName: datasetName,
      elapsedMs: elapsed,
      estimatedRemainingMs: Number.isFinite(measured) && totalUnits > completedUnits ? (totalUnits - completedUnits) * measured : null,
      lastVerifiedChunk: state.lastVerifiedChunk || null,
      percentComplete: percentComplete,
      phase: phase,
      recoveryStatus: phase === 'ROLLBACK' ? 'IN_PROGRESS' : (state.lastErrorDetails && state.lastErrorDetails.rollbackStatus || 'NONE'),
      schedulerLagMs: Number.isFinite(state.schedulerLagMs) ? state.schedulerLagMs : null,
      totalRows: totalRows,
      totalUnits: totalUnits,
    };
  }
  function publicResult(state, scheduled) {
    var auditStatus = state.failureAuditStatus || null;
    var progress = progressDetails(state);
    var checkpointData = state.checkpoint && state.checkpoint.data || {};
    var checkpointDigest = typeof checkpointData.fingerprint === 'string' && /^(?:sha256:)?[a-fA-F0-9]{64}$/.test(checkpointData.fingerprint)
      ? checkpointData.fingerprint
      : null;
    return Object.freeze({
      auditActionRequired: state.status === 'FAILED' && auditStatus === 'PENDING',
      batchToken: state.batchToken || null,
      continuationScheduled: scheduled === true,
      completedRows: progress.completedRows,
      completedUnits: progress.completedUnits,
      datasetName: progress.datasetName,
      datasetNames: Object.freeze(((state.datasetNames || (state.checkpoint && state.checkpoint.data && state.checkpoint.data.datasetNames)) || []).slice()),
      endedAtUtc: state.endedAtUtc || null,
      environment: state.environment,
      estimatedRemainingMs: progress.estimatedRemainingMs,
      elapsedMs: progress.elapsedMs,
      failureAuditStatus: auditStatus,
      generation: Number.isInteger(state.generation) ? state.generation : null,
      lastAuditErrorCode: state.lastAuditErrorCode || null,
      lastErrorCode: state.lastErrorCode || null,
      lastErrorDetails: Object.freeze(Object.assign({}, state.lastErrorDetails || {})),
      lastVerifiedChunk: progress.lastVerifiedChunk ? Object.freeze(Object.assign({}, progress.lastVerifiedChunk)) : null,
      packagingKind: state.packagingKind || null,
      percentComplete: progress.percentComplete,
      phase: progress.phase,
      recoveryStatus: progress.recoveryStatus,
      rowCounts: checkpointData.rowCounts && typeof checkpointData.rowCounts === 'object'
        ? Object.freeze(Object.assign({}, checkpointData.rowCounts))
        : null,
      runId: state.checkpoint ? state.checkpoint.runId : state.runId || null,
      startedAtUtc: state.startedAtUtc || null,
      status: state.status,
      sourceBundleDigest: checkpointDigest,
      schedulerLagMs: progress.schedulerLagMs,
      totalRows: progress.totalRows,
      totalUnits: progress.totalUnits,
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
    var activeProperties = null;
    var invocationWorker = null;
    if (!opts.stateKey || !opts.handler || typeof opts.executorFactory !== 'function') throw new Error('Pipeline controller configuration is incomplete.');
    function executor(state, deps) {
      if (!invocationWorker) invocationWorker = opts.executorFactory(state, deps);
      return invocationWorker;
    }
    function queuedTrigger(scriptApp, handler, delay) {
      replaceTrigger(scriptApp, handler, delay);
      withTelemetry({ properties: activeProperties }, function (telemetry, props) {
        telemetry.increment(props, 'trigger');
      });
    }
    function bindDeps(supplied) {
      var deps = resolveDeps(supplied);
      activeProperties = deps.properties;
      return deps;
    }
    function observePhase(state, deps) {
      withTelemetry(deps, function (telemetry, props) {
        telemetry.notePhase(props, state.status, nowIso(deps));
      });
    }
    function observeChunk(deps) {
      withTelemetry(deps, function (telemetry, props) { telemetry.noteChunk(props); });
    }
    function observeContention(deps) {
      withTelemetry(deps, function (telemetry, props) { telemetry.noteContention(props); });
    }
    function currentGeneration(deps) {
      var latest = migrate(load(deps.properties, opts.stateKey));
      return latest && Number.isInteger(latest.generation) ? latest.generation : null;
    }
    function saveCurrent(state, deps, claimed) {
      if (claimed != null && currentGeneration(deps) !== claimed) return false;
      save(deps.properties, opts.stateKey, state);
      return true;
    }
    function scheduleCurrent(state, deps, claimed, delay) {
      state.continuationDueAtUtc = new Date(nowMs(deps) + delay).toISOString();
      if (!saveCurrent(state, deps, claimed)) return false;
      queuedTrigger(deps.scriptApp, opts.handler, delay);
      return true;
    }
    function adaptCursor(cursor, durationMs) {
      var chunks = resolveChunks();
      if (!cursor || typeof chunks.adaptiveRows !== 'function') return cursor;
      var currentRows = Number.isInteger(cursor.chunkRows) ? cursor.chunkRows : chunks.DEFAULT_CHUNK_ROWS;
      return Object.freeze(Object.assign({}, cursor, { chunkRows: chunks.adaptiveRows(currentRows, durationMs, cursor.columnCount) }));
    }
    function noteVerifiedChunk(state, cursor, fallbackDatasetName) {
      if (!cursor || ['verify', 'write', 'copy', 'restore', 'trim_verify'].indexOf(cursor.phase) === -1 || !Number.isInteger(cursor.nextRow)) return;
      state.lastVerifiedChunk = {
        chunkStartRow: cursor.nextRow,
        datasetName: cursor.datasetName || fallbackDatasetName || null,
        rowCount: cursor.phase === 'trim_verify' && Number.isInteger(cursor.trimNextRow)
          ? cursor.trimNextRow - cursor.nextRow
          : (Number.isInteger(cursor.chunkRows) ? cursor.chunkRows : resolveChunks().DEFAULT_CHUNK_ROWS),
      };
    }
    function finishTerminal(state, deps, claimed) {
      if (!saveCurrent(state, deps, claimed)) return publicResult(state, matchingTriggers(deps.scriptApp, opts.handler).length > 0);
      removeTriggers(deps.scriptApp, opts.handler);
      return publicResult(state, false);
    }
    function staleIdle(state, deps) {
      return publicResult(state, matchingTriggers(deps.scriptApp, opts.handler).length > 0);
    }
    function wrapFailure(error) {
      if (!error || typeof error !== 'object') return error;
      var details = boundedDetails(error);
      if (error.details && typeof error.details === 'object') {
        ['originalErrorCode', 'reason', 'operation', 'datasetName', 'backupRunId', 'rollbackStatus'].forEach(function (key) {
          if (error.details[key] !== undefined && details[key] === undefined) details[key] = error.details[key];
        });
      }
      error.details = details;
      return error;
    }
    function recordFailure(state, error, deps, claimed) {
      var wrapped = wrapFailure(error);
      if (claimed != null && currentGeneration(deps) !== claimed) {
        var successor = migrate(load(deps.properties, opts.stateKey));
        return successor ? publicResult(successor, matchingTriggers(deps.scriptApp, opts.handler).length > 0) : staleIdle(state, deps);
      }
      state.status = 'FAILED';
      state.endedAtUtc = nowIso(deps);
      state.lastErrorCode = wrapped && wrapped.code ? wrapped.code : 'INGESTION_OPERATION_FAILED';
      state.lastErrorDetails = boundedDetails(wrapped);
      state.updatedAtUtc = state.endedAtUtc;
      if (!saveCurrent(state, deps, claimed)) return staleIdle(state, deps);
      try {
        var worker = executor(state, deps);
        var canAudit = Boolean(worker.auditFailure && (state.checkpoint ||
          (typeof worker.hasFailureCheckpoint === 'function' && worker.hasFailureCheckpoint())));
        if (canAudit) {
          worker.auditFailure(state, wrapped);
          state.failureAuditStatus = 'RECORDED';
          state.lastAuditErrorCode = null;
        } else {
          state.failureAuditStatus = 'PENDING';
          state.lastAuditErrorCode = 'INGESTION_INVALID_RUN_METADATA';
        }
      } catch (auditError) {
        if (auditCompleted(auditError) || auditCompleted(wrapped)) {
          state.failureAuditStatus = 'RECORDED';
          state.lastAuditErrorCode = null;
        } else {
          state.failureAuditStatus = 'PENDING';
          state.lastAuditErrorCode = auditError && auditError.code ? auditError.code : 'REPORTING_LOG_WRITE_FAILED';
        }
      }
      state.generation = (Number.isInteger(state.generation) ? state.generation : 1) + 1;
      save(deps.properties, opts.stateKey, state);
      removeTriggers(deps.scriptApp, opts.handler);
      throw wrapped;
    }
    function beginRollback(state, error, deps, claimed) {
      var worker = executor(state, deps);
      if (!worker.rollback) return recordFailure(state, error, deps, claimed);
      state.status = 'ROLLBACK_PENDING';
      state.pendingFailure = {
        code: error && error.code ? error.code : 'MIGRATION_COMMIT_FAILED',
        details: boundedDetails(error),
      };
      state.updatedAtUtc = nowIso(deps);
      if (!scheduleCurrent(state, deps, claimed, CONTINUATION_DELAY_MS)) return staleIdle(state, deps);
      return publicResult(state, true);
    }
    function prepare(state, deps, claimed) {
      state.status = 'PREPARING';
      state.phaseStartedAtUtc = nowIso(deps);
      state.updatedAtUtc = state.phaseStartedAtUtc;
      if (!scheduleCurrent(state, deps, claimed, SAFETY_DELAY_MS)) return staleIdle(state, deps);
      var started = nowMs(deps);
      var measured = state.maxPrepareStepMs || 0;
      try {
        var worker = executor(state, deps);
        while (true) {
          var stepStart = nowMs(deps);
          var prepared = worker.prepare(state);
          var stepDuration = nowMs(deps) - stepStart;
          var preparationWorkDuration = prepared && Number.isFinite(prepared.workUnitDurationMs)
            ? prepared.workUnitDurationMs
            : stepDuration;
          measured = Math.max(measured, preparationWorkDuration);
          state.maxPrepareStepMs = measured;
          if (!prepared || !prepared.checkpoint) throw new Error('Pipeline preparation did not produce a checkpoint.');
          state.checkpoint = prepared.checkpoint;
          if (state.checkpoint.data && state.checkpoint.data.prepareCursor) {
            state.checkpoint.data.prepareCursor = adaptCursor(state.checkpoint.data.prepareCursor, preparationWorkDuration);
          }
          state.runId = prepared.checkpoint.runId;
          state.updatedAtUtc = nowIso(deps);
          var complete = prepared.complete !== false;
          if (complete) {
            state.status = 'BACKUP_PENDING';
            if (!scheduleCurrent(state, deps, claimed, CONTINUATION_DELAY_MS)) return staleIdle(state, deps);
            return publicResult(state, true);
          }
          if (!saveCurrent(state, deps, claimed)) return staleIdle(state, deps);
          if (!canStartAnotherStep(nowMs(deps) - started, measured)) {
            state.status = 'QUEUED';
            if (!scheduleCurrent(state, deps, claimed, CONTINUATION_DELAY_MS)) return staleIdle(state, deps);
            return publicResult(state, true);
          }
          observeChunk(deps);
        }
      } catch (error) { return recordFailure(state, error, deps, claimed); }
    }
    function backup(state, deps, claimed) {
      var started = nowMs(deps);
      var measured = state.maxBackupStepMs || 0;
      var packed = Object.create(null);
      state.status = 'BACKING_UP'; state.phaseStartedAtUtc = nowIso(deps); state.updatedAtUtc = state.phaseStartedAtUtc;
      if (!scheduleCurrent(state, deps, claimed, SAFETY_DELAY_MS)) return staleIdle(state, deps);
      try {
        var worker = executor(state, deps);
        while (true) {
          var inputCursor = state.checkpoint && state.checkpoint.data && state.checkpoint.data.backupCursor || null;
          var stepStart = nowMs(deps);
          var result = worker.backup(state);
          var stepEnd = nowMs(deps);
          noteVerifiedChunk(state, inputCursor, result && result.createdDatasetName);
          measured = Math.max(measured, stepEnd - stepStart);
          state.maxBackupStepMs = measured;
          state.lastCompletedBackupDataset = result && result.createdDatasetName || state.lastCompletedBackupDataset || null;
          if (result && result.backupCursor && state.checkpoint && state.checkpoint.data) {
            state.checkpoint.data.backupCursor = adaptCursor(result.backupCursor, stepEnd - stepStart);
          }
          state.updatedAtUtc = nowIso(deps);
          if (!saveCurrent(state, deps, claimed)) return staleIdle(state, deps);
          if (!result || typeof result.complete !== 'boolean') throw new Error('Backup worker returned invalid progress.');
          if (result.complete) {
            state.checkpoint.data.backupRunId = state.checkpoint.runId;
            state.status = 'COMMIT_PENDING'; state.updatedAtUtc = nowIso(deps);
            if (!scheduleCurrent(state, deps, claimed, CONTINUATION_DELAY_MS)) return staleIdle(state, deps);
            return publicResult(state, true);
          }
          var name = result.createdDatasetName || (result.backupCursor && result.backupCursor.datasetName);
          if (name && packed[name] && !result.backupCursor) {
            state.status = 'BACKUP_PENDING'; state.updatedAtUtc = nowIso(deps);
            if (!scheduleCurrent(state, deps, claimed, CONTINUATION_DELAY_MS)) return staleIdle(state, deps);
            return publicResult(state, true);
          }
          if (!canStartAnotherStep(nowMs(deps) - started, measured)) {
            state.status = 'BACKUP_PENDING'; state.updatedAtUtc = nowIso(deps);
            if (!scheduleCurrent(state, deps, claimed, CONTINUATION_DELAY_MS)) return staleIdle(state, deps);
            return publicResult(state, true);
          }
          if (name) packed[name] = true;
          observeChunk(deps);
        }
      } catch (error) {
        if (error && error.code === 'INGESTION_LOCK_TIMEOUT') {
          observeContention(deps);
          state.status = 'BACKUP_PENDING'; state.updatedAtUtc = nowIso(deps);
          if (!scheduleCurrent(state, deps, claimed, CONTENTION_BACKOFF_MS)) return staleIdle(state, deps);
          return publicResult(state, true);
        }
        return recordFailure(state, error, deps, claimed);
      }
    }
    function commit(state, deps, claimed) {
      var started = nowMs(deps);
      state.status = 'COMMITTING'; state.phaseStartedAtUtc = nowIso(deps); state.updatedAtUtc = state.phaseStartedAtUtc;
      if (!scheduleCurrent(state, deps, claimed, SAFETY_DELAY_MS)) return staleIdle(state, deps);
      try {
        var worker = executor(state, deps);
        while (true) {
          var inputCursor = state.checkpoint && state.checkpoint.data && state.checkpoint.data.commitProgress && state.checkpoint.data.commitProgress.commitCursor || null;
          var stepStart = nowMs(deps);
          var result = worker.commit(state);
          var elapsed = nowMs(deps) - stepStart;
          var commitWorkDuration = result && Number.isFinite(result.workUnitDurationMs)
            ? result.workUnitDurationMs
            : elapsed;
          noteVerifiedChunk(state, inputCursor, result && result.commitProgress && result.commitProgress.lastCompletedDatasetName);
          if (result && result.runRecord && result.runRecord.status === 'SUCCESS') {
            state.status = 'COMPLETE'; state.endedAtUtc = result.runRecord.endedAtUtc || nowIso(deps); state.updatedAtUtc = nowIso(deps);
            return finishTerminal(state, deps, claimed);
          }
          var progress = result && result.commitProgress;
          if (!progress || !Number.isInteger(progress.nextDatasetIndex) || !progress.lastCompletedDatasetName) {
            throw new Error('Commit worker returned invalid progress.');
          }
          if (progress.commitCursor) {
            progress = Object.freeze(Object.assign({}, progress, { commitCursor: adaptCursor(progress.commitCursor, commitWorkDuration) }));
          }
          state.checkpoint.data.commitProgress = progress;
          delete state.checkpoint.data.commitCursor;
          state.lastCompletedCommitDataset = progress.lastCompletedDatasetName;
          state.maxCommitStepMs = Math.max(state.maxCommitStepMs || 0, commitWorkDuration);
          state.updatedAtUtc = nowIso(deps);
          if (progress.complete) {
            state.status = worker.health ? 'HEALTH_PENDING' : 'COMMIT_PENDING';
            if (!scheduleCurrent(state, deps, claimed, CONTINUATION_DELAY_MS)) return staleIdle(state, deps);
            return publicResult(state, true);
          }
          if (!saveCurrent(state, deps, claimed)) return staleIdle(state, deps);
          if (!canStartAnotherStep(nowMs(deps) - started, state.maxCommitStepMs)) {
            state.status = 'COMMIT_PENDING';
            if (!scheduleCurrent(state, deps, claimed, CONTINUATION_DELAY_MS)) return staleIdle(state, deps);
            return publicResult(state, true);
          }
          observeChunk(deps);
        }
      } catch (error) {
        if (error && error.code === 'INGESTION_LOCK_TIMEOUT') {
          observeContention(deps);
          state.status = 'COMMIT_PENDING'; state.updatedAtUtc = nowIso(deps);
          if (!scheduleCurrent(state, deps, claimed, CONTENTION_BACKOFF_MS)) return staleIdle(state, deps);
          return publicResult(state, true);
        }
        return beginRollback(state, error, deps, claimed);
      }
    }
    function health(state, deps, claimed) {
      var started = nowMs(deps);
      state.status = 'HEALTH_CHECKING'; state.phaseStartedAtUtc = nowIso(deps); state.updatedAtUtc = state.phaseStartedAtUtc;
      if (!scheduleCurrent(state, deps, claimed, SAFETY_DELAY_MS)) return staleIdle(state, deps);
      try {
        var worker = executor(state, deps);
        while (true) {
          var stepStart = nowMs(deps);
          var result = worker.health(state);
          state.maxHealthStepMs = Math.max(state.maxHealthStepMs || 0, nowMs(deps) - stepStart);
          if (result && result.runRecord && result.runRecord.status === 'SUCCESS') {
            state.status = 'COMPLETE'; state.endedAtUtc = result.runRecord.endedAtUtc || nowIso(deps); state.updatedAtUtc = nowIso(deps);
            return finishTerminal(state, deps, claimed);
          }
          if (result && result.healthCursor && state.checkpoint && state.checkpoint.data) {
            state.checkpoint.data.healthCursor = result.healthCursor;
          }
          state.updatedAtUtc = nowIso(deps);
          if (result && result.complete === true && result.runRecord) {
            state.status = 'COMPLETE'; state.endedAtUtc = result.runRecord.endedAtUtc || nowIso(deps); state.updatedAtUtc = nowIso(deps);
            return finishTerminal(state, deps, claimed);
          }
          if (!saveCurrent(state, deps, claimed)) return staleIdle(state, deps);
          if (!result || result.complete === true) {
            throw new Error('Health worker returned invalid progress.');
          }
          if (!canStartAnotherStep(nowMs(deps) - started, state.maxHealthStepMs)) {
            state.status = 'HEALTH_PENDING';
            if (!scheduleCurrent(state, deps, claimed, CONTINUATION_DELAY_MS)) return staleIdle(state, deps);
            return publicResult(state, true);
          }
          observeChunk(deps);
        }
      } catch (error) {
        return beginRollback(state, error, deps, claimed);
      }
    }
    function rollback(state, deps, claimed) {
      var started = nowMs(deps);
      state.status = 'ROLLING_BACK'; state.phaseStartedAtUtc = nowIso(deps); state.updatedAtUtc = state.phaseStartedAtUtc;
      if (!scheduleCurrent(state, deps, claimed, SAFETY_DELAY_MS)) return staleIdle(state, deps);
      try {
        var worker = executor(state, deps);
        while (true) {
          var inputCursor = state.checkpoint && state.checkpoint.data && state.checkpoint.data.rollbackCursor || null;
          var stepStart = nowMs(deps);
          var result = worker.rollback(state);
          var stepDuration = nowMs(deps) - stepStart;
          noteVerifiedChunk(state, inputCursor, result && result.datasetName);
          if (result && result.rollbackCursor && state.checkpoint && state.checkpoint.data) {
            state.checkpoint.data.rollbackCursor = adaptCursor(result.rollbackCursor, stepDuration);
          }
          state.updatedAtUtc = nowIso(deps);
          if (!saveCurrent(state, deps, claimed)) return staleIdle(state, deps);
          if (result && result.complete === true) {
            var pending = state.pendingFailure || {};
            var terminal = new Error('Ingestion rolled back after a commit failure.');
            terminal.code = pending.code || 'MIGRATION_COMMIT_FAILED';
            terminal.details = Object.assign({}, pending.details || {}, {
              rollbackStatus: result.rollbackStatus || (pending.details && pending.details.rollbackStatus) || 'VERIFIED',
            });
            return recordFailure(state, terminal, deps, claimed);
          }
          if (!canStartAnotherStep(nowMs(deps) - started, stepDuration)) {
            state.status = 'ROLLBACK_PENDING';
            if (!scheduleCurrent(state, deps, claimed, CONTINUATION_DELAY_MS)) return staleIdle(state, deps);
            return publicResult(state, true);
          }
          observeChunk(deps);
        }
      } catch (error) { return recordFailure(state, error, deps, claimed); }
    }
    function withLock(deps, fn) {
      var lock = deps.lockService && deps.lockService.getScriptLock ? deps.lockService.getScriptLock() : null;
      if (lock && lock.tryLock && lock.tryLock(5000) !== true) {
        var lockError = new Error('Another ingestion run is active.');
        lockError.code = 'INGESTION_LOCK_TIMEOUT';
        throw lockError;
      }
      try { return fn(); } finally { if (lock && lock.releaseLock) lock.releaseLock(); }
    }
    function claim(state, deps) {
      state.generation = (Number.isInteger(state.generation) ? state.generation : 0) + 1;
      state.updatedAtUtc = nowIso(deps);
      save(deps.properties, opts.stateKey, state);
      return state.generation;
    }
    function continueRun(services) {
      var deps = bindDeps(services);
      invocationWorker = null;
      withTelemetry(deps, function (telemetry, props) {
        telemetry.beginInvocation(props, nowIso(deps), nowMs(deps));
        telemetry.noteContinuation(props);
      });
      try {
        var claimed = null;
        var state = null;
        try {
          state = withLock(deps, function () {
            var loaded = migrate(load(deps.properties, opts.stateKey));
            if (!loaded) return null;
            observePhase(loaded, deps);
            if (loaded.status === 'COMPLETE' || (loaded.status === 'FAILED' && loaded.failureAuditStatus === 'RECORDED')) {
              removeTriggers(deps.scriptApp, opts.handler);
              loaded._idle = true;
              return loaded;
            }
            if (loaded.status === 'FAILED' && loaded.failureAuditStatus === 'PENDING') {
              removeTriggers(deps.scriptApp, opts.handler);
              loaded._auditPending = true;
              return loaded;
            }
            if (loaded.status === 'FAILED') {
              removeTriggers(deps.scriptApp, opts.handler);
              loaded._idle = true;
              return loaded;
            }
            if (LIVE_PHASES.indexOf(loaded.status) !== -1 && loaded.phaseStartedAtUtc) {
              var age = nowMs(deps) - new Date(loaded.phaseStartedAtUtc).getTime();
              if (age >= 0 && age < ACTIVE_SETTLE_MS) {
                queuedTrigger(deps.scriptApp, opts.handler, Math.max(CONTINUATION_DELAY_MS, ACTIVE_SETTLE_MS - age));
                loaded._settling = true;
                return loaded;
              }
              if (age >= ACTIVE_SETTLE_MS) {
                withTelemetry(deps, function (telemetry, props) {
                  if (typeof telemetry.noteWatchdog === 'function') telemetry.noteWatchdog(props);
                });
              }
            }
            if (loaded.continuationDueAtUtc) {
              var dueAtMs = new Date(loaded.continuationDueAtUtc).getTime();
              loaded.schedulerLagMs = Number.isFinite(dueAtMs) ? Math.max(0, nowMs(deps) - dueAtMs) : null;
            }
            claimed = claim(loaded, deps);
            return loaded;
          });
        } catch (lockError) {
          if (lockError && lockError.code === 'INGESTION_LOCK_TIMEOUT') {
            observeContention(deps);
            // The fired one-shot trigger is no longer a successor. Replace
            // any matching trigger with exactly one contention-backoff run
            // before reporting that continuation is scheduled.
            replaceTrigger(deps.scriptApp, opts.handler, CONTENTION_BACKOFF_MS);
            var waiting = migrate(load(deps.properties, opts.stateKey));
            return waiting
              ? publicResult(waiting, true)
              : Object.freeze({ continuationScheduled: true, runId: null, status: 'QUEUED' });
          }
          throw lockError;
        }
        if (!state) return Object.freeze({ continuationScheduled: false, runId: null, status: 'IDLE' });
        if (state._idle || state._auditPending || state._settling) return publicResult(state, state._settling === true);
        if (state.status === 'QUEUED' || !state.checkpoint) return prepare(state, deps, claimed);
        if (state.status === 'BACKUP_PENDING' || state.status === 'BACKING_UP') return backup(state, deps, claimed);
        if (state.status === 'HEALTH_PENDING' || state.status === 'HEALTH_CHECKING') {
          if (executor(state, deps).health) return health(state, deps, claimed);
          return commit(state, deps, claimed);
        }
        if (state.status === 'ROLLBACK_PENDING' || state.status === 'ROLLING_BACK') {
          if (executor(state, deps).rollback) return rollback(state, deps, claimed);
          return recordFailure(state, { code: 'MIGRATION_COMMIT_FAILED', details: state.lastErrorDetails }, deps, claimed);
        }
        return commit(state, deps, claimed);
      } finally {
        invocationWorker = null;
        withTelemetry(deps, function (telemetry, props) {
          telemetry.endInvocation(props, nowIso(deps), nowMs(deps));
        });
      }
    }
    function retryFailureAudit(services) {
      var deps = bindDeps(services);
      invocationWorker = null;
      return withLock(deps, function () {
        var state = migrate(load(deps.properties, opts.stateKey));
        if (!state || state.status !== 'FAILED' || state.failureAuditStatus !== 'PENDING') {
          return state ? publicResult(state, matchingTriggers(deps.scriptApp, opts.handler).length > 0) : Object.freeze({
            auditActionRequired: false, continuationScheduled: false, failureAuditStatus: null, runId: null, status: 'IDLE',
          });
        }
        var claimed = claim(state, deps);
        var retryError = new Error('Retrying terminal ingestion failure audit.');
        retryError.code = state.lastErrorCode || 'INGESTION_OPERATION_FAILED';
        retryError.details = state.lastErrorDetails || {};
        try {
          executor(state, deps).auditFailure(state, retryError);
          state.failureAuditStatus = 'RECORDED';
          state.lastAuditErrorCode = null;
        } catch (auditError) {
          if (auditCompleted(auditError) || auditCompleted(retryError)) {
            state.failureAuditStatus = 'RECORDED';
            state.lastAuditErrorCode = null;
          } else {
            state.failureAuditStatus = 'PENDING';
            state.lastAuditErrorCode = auditError && auditError.code ? auditError.code : 'REPORTING_LOG_WRITE_FAILED';
          }
        }
        state.updatedAtUtc = nowIso(deps);
        save(deps.properties, opts.stateKey, state);
        removeTriggers(deps.scriptApp, opts.handler);
        return publicResult(state, false);
      });
    }
    function start(seed, services) {
      var deps = bindDeps(services);
      invocationWorker = null;
      return withLock(deps, function () {
        var current = migrate(load(deps.properties, opts.stateKey));
        if (current && (ACTIVE.indexOf(current.status) !== -1 || current.failureAuditStatus === 'PENDING')) {
          var activeError = new Error('Another ingestion run is active.');
          activeError.code = 'INGESTION_RUN_ALREADY_ACTIVE';
          throw activeError;
        }
        var timestamp = nowIso(deps);
        var state = Object.assign({}, seed || {}, {
          checkpoint: null, endedAtUtc: null, failureAuditStatus: null, generation: 1,
          lastAuditErrorCode: null, lastErrorCode: null, lastErrorDetails: {},
          runId: seed && seed.runId || null, startedAtUtc: timestamp, status: 'QUEUED',
          updatedAtUtc: timestamp, version: STATE_VERSION,
        });
        withTelemetry(deps, function (telemetry, props) {
          telemetry.reset(props, {
            packagingKind: state.packagingKind || null,
            runToken: state.runId || state.batchToken || null,
            sourceBundleDigest: state.sourceBundleDigest || null,
          });
        });
        state.continuationDueAtUtc = new Date(nowMs(deps) + CONTINUATION_DELAY_MS).toISOString();
        save(deps.properties, opts.stateKey, state);
        queuedTrigger(deps.scriptApp, opts.handler, CONTINUATION_DELAY_MS);
        return publicResult(state, true);
      });
    }
    function getStatus(services) {
      var deps = bindDeps(services);
      var state = migrate(load(deps.properties, opts.stateKey));
      return state ? publicResult(state, matchingTriggers(deps.scriptApp, opts.handler).length > 0) : Object.freeze({
        auditActionRequired: false, continuationScheduled: false, failureAuditStatus: null, generation: null,
        lastAuditErrorCode: null, runId: null, status: 'IDLE',
      });
    }
    return Object.freeze({
      continueRun: continueRun,
      getStatus: getStatus,
      retryFailureAudit: retryFailureAudit,
      start: start,
    });
  }
  return Object.freeze({
    ACTIVE_SETTLE_MS: ACTIVE_SETTLE_MS,
    ACTIVE_STATES: ACTIVE,
    DEFAULT_CHUNK_ROWS: resolveChunks().DEFAULT_CHUNK_ROWS,
    DEFAULT_STEP_RESERVE_MS: DEFAULT_STEP_RESERVE_MS,
    HANDOFF_MARGIN_MS: HANDOFF_MARGIN_MS,
    INVOCATION_BUDGET_MS: INVOCATION_BUDGET_MS,
    STATE_VERSION: STATE_VERSION,
    canStartAnotherStep: canStartAnotherStep,
    create: create,
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = IngestionPipelineController;
