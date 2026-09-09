var RtaIntakeService = (function () {
  'use strict';
  var STATE_KEY = 'CXP13_INGESTION_PIPELINE_STATE_V1';
  var HANDLER = 'continueCxp13Ingestion';
  var PUBLIC_STATUSES = Object.freeze(['IDLE','READY','QUEUED','PROCESSING','SUCCESS','DUPLICATE','VALIDATION_FAILED','PROCESSING_ERROR']);
  var IN_FLIGHT = Object.freeze([
    'QUEUED', 'PREPARING', 'BACKUP_PENDING', 'BACKING_UP',
    'COMMIT_PENDING', 'COMMITTING', 'HEALTH_PENDING', 'HEALTH_CHECKING',
    'ROLLBACK_PENDING', 'ROLLING_BACK',
  ]);

  function resolve(globalName, path) {
    if (typeof globalThis !== 'undefined' && globalThis[globalName]) return globalThis[globalName];
    return require(path);
  }
  function configuration(services) { return resolve('Config', '../config/Config.js').load(services.properties); }
  function authorize(services, config) {
    var allowed = String(config.rtaAllowedDomain || '').trim().toLowerCase();
    var user = services.session && services.session.getActiveUser ? services.session.getActiveUser() : null;
    var email = user && user.getEmail ? String(user.getEmail() || '').trim().toLowerCase() : '';
    var domain = email.indexOf('@') > 0 ? email.slice(email.lastIndexOf('@') + 1) : '';
    if (!allowed || !domain || domain !== allowed) throw resolve('ErrorCodes', '../monitoring/ErrorCodes.js').create('INGESTION_UNAUTHORIZED_ACTOR');
    return true;
  }
  function runtimeServices(overrides) { return resolve('Cxp13Runtime', '../ingestion/Cxp13Runtime.js').hostedServices(overrides); }
  function controller() {
    return resolve('IngestionPipelineController', '../ingestion/IngestionPipelineController.js').create({
      executorFactory: resolve('Cxp13Runtime', '../ingestion/Cxp13Runtime.js').executorFactory,
      handler: HANDLER,
      stateKey: STATE_KEY,
    });
  }
  function controlContext(services, config) {
    var errors = resolve('ErrorCodes', '../monitoring/ErrorCodes.js');
    var control;
    var target;
    try {
      control = services.spreadsheetApp.openById(config.controlSpreadsheetId);
    } catch (error) {
      throw errors.create('LIFECYCLE_CONTROL_UNAVAILABLE', {
        cause: error,
        details: { reason: 'control_workbook_open_failed' },
      });
    }
    try {
      target = services.spreadsheetApp.openById(config.targetSpreadsheetId);
    } catch (error) {
      throw errors.create('LIFECYCLE_TARGET_UNAVAILABLE', {
        cause: error,
        details: { reason: 'target_workbook_open_failed' },
      });
    }
    var health = resolve('HealthCheck', './HealthCheck.js').evaluate({
      clock: services.clock, controlSpreadsheet: control, properties: services.properties, targetSpreadsheet: target,
    }, { configuration: config });
    return Object.freeze({
      control: control,
      health: health,
      statusRepository: resolve('RunStatusRepository', '../repository/RunStatusRepository.js').create(control),
    });
  }
  function publicError(code, details) {
    if (!code) return null;
    var safe = {};
    [
      'backupRunId','chunkStartRow','columnIndex','columnName','comparisonReason',
      'datasetName','duplicateColumns','intendedValueType','missingColumns',
      'missingDatasets','missingDatasetSheets','operation','originalErrorCode',
      'persistedValueType','presentDatasets','reason','rollbackStatus','rowOffset',
      'schemaType','sheetName','unexpectedColumns',
    ].forEach(function (key) {
      if (details && details[key] !== undefined) safe[key] = details[key];
    });
    return Object.freeze({ code: code, details: Object.freeze(safe) });
  }
  function isValidation(code) {
    return /^(SOURCE_|SCHEMA_|DATASET_)/.test(code || '') || code === 'MIGRATION_STAGE_VALIDATION_FAILED';
  }
  function mapTerminal(record) {
    if (record.status === 'SUCCESS') return 'SUCCESS';
    if (record.errorCode === 'SOURCE_DUPLICATE_SUBMISSION') return 'DUPLICATE';
    return isValidation(record.errorCode) ? 'VALIDATION_FAILED' : 'PROCESSING_ERROR';
  }
  function publicStatus(pipeline, ctx, record) {
    var terminal = record ? mapTerminal(record) : null;
    var status = terminal || (pipeline.status === 'IDLE' || pipeline.status === 'READY'
      ? pipeline.status
      : (pipeline.status === 'QUEUED' ? 'QUEUED' : (pipeline.status === 'COMPLETE' ? 'SUCCESS' : (pipeline.status === 'FAILED' ? (isValidation(pipeline.lastErrorCode) ? 'VALIDATION_FAILED' : 'PROCESSING_ERROR') : 'PROCESSING'))));
    var latestSuccess = ctx.statusRepository.latestSuccess();
    var code = record ? record.errorCode : pipeline.lastErrorCode;
    var details = record && record.error ? record.error.details : pipeline.lastErrorDetails;
    var elapsedMs = Number.isFinite(pipeline.elapsedMs) ? pipeline.elapsedMs : null;
    if (elapsedMs === null && pipeline.startedAtUtc) {
      var elapsedEnd = (record && record.endedAtUtc) || pipeline.endedAtUtc || new Date().toISOString();
      var calculated = Date.parse(elapsedEnd) - Date.parse(pipeline.startedAtUtc);
      if (Number.isFinite(calculated) && calculated >= 0) elapsedMs = calculated;
    }
    var recoveryStatus = pipeline.recoveryStatus || null;
    var recordCounts = record && record.rowCounts && Object.keys(record.rowCounts).length ? record.rowCounts : null;
    var checkpointCounts = pipeline.rowCounts && (!record || String(record.runId) === String(pipeline.runId)) ? pipeline.rowCounts : null;
    var mappedCounts = resolve('Cxp13IngestionTelemetry', '../ingestion/Cxp13IngestionTelemetry.js').mapRowCounts(recordCounts || checkpointCounts);
    if (!mappedCounts.total) mappedCounts = null;
    if (!recoveryStatus && (pipeline.status === 'ROLLBACK_PENDING' || pipeline.status === 'ROLLING_BACK')) {
      recoveryStatus = 'ROLLING_BACK';
    } else if (!recoveryStatus && details && details.rollbackStatus) {
      recoveryStatus = details.rollbackStatus;
    }
    return Object.freeze({
      activeDataAtUtc: latestSuccess ? latestSuccess.endedAtUtc : null,
      activeWeekKey: ctx.health.activeWeekKey,
      auditActionRequired: pipeline.auditActionRequired === true,
      batchToken: pipeline.batchToken || null,
      continuationScheduled: pipeline.continuationScheduled === true,
      datasetNames: Object.freeze((pipeline.datasetNames || []).slice()),
      endedAtUtc: record ? record.endedAtUtc : pipeline.endedAtUtc || null,
      error: publicError(code, details),
      failureAuditStatus: pipeline.failureAuditStatus || null,
      health: Object.freeze({ codes: Object.freeze(ctx.health.codes.slice()), healthy: ctx.health.healthy }),
      completedRows: Number.isInteger(pipeline.completedRows) ? pipeline.completedRows : null,
      completedUnits: Number.isInteger(pipeline.completedUnits) ? pipeline.completedUnits : null,
      datasetName: pipeline.datasetName || null,
      elapsedMs: elapsedMs,
      estimatedRemainingMs: Number.isFinite(pipeline.estimatedRemainingMs) ? pipeline.estimatedRemainingMs : null,
      lastAuditErrorCode: pipeline.lastAuditErrorCode || null,
      lastVerifiedChunk: pipeline.lastVerifiedChunk || null,
      packagingKind: pipeline.packagingKind || null,
      percentComplete: Number.isFinite(pipeline.percentComplete) ? pipeline.percentComplete : null,
      phase: pipeline.phase || pipeline.status || null,
      recoveryStatus: recoveryStatus,
      rowCounts: mappedCounts ? Object.freeze(Object.assign({}, mappedCounts)) : null,
      runId: pipeline.runId || null,
      schedulerLagMs: Number.isFinite(pipeline.schedulerLagMs) ? pipeline.schedulerLagMs : null,
      sourceBundleDigest: pipeline.sourceBundleDigest || null,
      startedAtUtc: record ? record.startedAtUtc : pipeline.startedAtUtc || null,
      status: status,
      totalRows: Number.isInteger(pipeline.totalRows) ? pipeline.totalRows : null,
      totalUnits: Number.isInteger(pipeline.totalUnits) ? pipeline.totalUnits : null,
      updatedAtUtc: pipeline.updatedAtUtc || null,
    });
  }
  function getIntakeStatus(overrides) {
    var services = runtimeServices(overrides); var config = configuration(services); authorize(services, config);
    var ctx = controlContext(services, config); var pipeline = controller().getStatus(services);
    var latest = resolve('InboxBundleRepository', '../repository/InboxBundleRepository.js').create(services.driveApp, config.driveInboxFolderId).getLatest();
    if (pipeline.runId && (!latest.candidate || latest.candidate.batchToken === pipeline.batchToken || IN_FLIGHT.indexOf(pipeline.status) !== -1)) {
      return publicStatus(pipeline, ctx, ctx.statusRepository.findRun(pipeline.runId));
    }
    if (!latest.candidate) return publicStatus(pipeline, ctx, null);
    return publicStatus(Object.assign({}, pipeline, {
      batchToken: latest.candidate.batchToken, datasetNames: latest.candidate.datasetNames,
      packagingKind: latest.candidate.packagingKind, status: 'READY',
    }), ctx, null);
  }
  function startLatest(expectedBatchToken, overrides) {
    var services = runtimeServices(overrides); var config = configuration(services); authorize(services, config);
    var ctx = controlContext(services, config);
    if (!ctx.health.registryPropertyAligned) throw resolve('ErrorCodes', '../monitoring/ErrorCodes.js').create('LIFECYCLE_ACTIVE_TARGET_MISMATCH');
    var latest = resolve('InboxBundleRepository', '../repository/InboxBundleRepository.js').create(services.driveApp, config.driveInboxFolderId).getLatest().candidate;
    if (!latest || latest.batchToken !== expectedBatchToken) throw resolve('ErrorCodes', '../monitoring/ErrorCodes.js').create('INGESTION_SELECTION_CHANGED');
    var runId = 'cxp13-' + String(services.utilities.getUuid()).replace(/[^A-Za-z0-9_-]/g, '');
    var pipeline = controller().start({
      batchToken: latest.batchToken, datasetNames: latest.datasetNames, environment: config.environment,
      packagingKind: latest.packagingKind, runId: runId, selection: latest, targetWorkbookId: config.targetSpreadsheetId,
    }, services);
    return publicStatus(pipeline, ctx, null);
  }
  function getRunStatus(runId, overrides) {
    var services = runtimeServices(overrides); var config = configuration(services); authorize(services, config);
    var ctx = controlContext(services, config); var pipeline = controller().getStatus(services);
    if (runId && pipeline.runId && runId !== pipeline.runId) {
      var historical = ctx.statusRepository.findRun(runId);
      if (!historical) return Object.freeze({ runId: runId, status: 'IDLE' });
      pipeline = { batchToken: null, continuationScheduled: false, datasetNames: [], packagingKind: null, runId: runId, status: historical.status };
      return publicStatus(pipeline, ctx, historical);
    }
    return publicStatus(pipeline, ctx, pipeline.runId ? ctx.statusRepository.findRun(pipeline.runId) : null);
  }
  function continueRun(overrides) { return controller().continueRun(runtimeServices(overrides)); }
  function retryFailureAudit(overrides) { return controller().retryFailureAudit(runtimeServices(overrides)); }
  return Object.freeze({ HANDLER: HANDLER, PUBLIC_STATUSES: PUBLIC_STATUSES, STATE_KEY: STATE_KEY, authorize: authorize, continueRun: continueRun, getIntakeStatus: getIntakeStatus, getRunStatus: getRunStatus, mapTerminal: mapTerminal, retryFailureAudit: retryFailureAudit, startLatest: startLatest });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RtaIntakeService;
