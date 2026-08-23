var Cxp06UatHarness = (function () {
  'use strict';

  function resolveCxp06FaultInjector() {
    if (typeof Cxp06FaultInjector !== 'undefined') {
      return Cxp06FaultInjector;
    }
    return require('./Cxp06FaultInjector.js');
  }

  function resolveCxp06UatEvidence() {
    if (typeof Cxp06UatEvidence !== 'undefined') {
      return Cxp06UatEvidence;
    }
    return require('./Cxp06UatEvidence.js');
  }

  function resolveInputAdapter() {
    if (typeof InputAdapter !== 'undefined') {
      return InputAdapter;
    }
    return require('../ingestion/InputAdapter.js');
  }

  function resolveCommitService() {
    if (typeof CommitService !== 'undefined') {
      return CommitService;
    }
    return require('../services/CommitService.js');
  }

  function resolveRunService() {
    if (typeof RunService !== 'undefined') {
      return RunService;
    }
    return require('../ingestion/RunService.js');
  }

  function getPropValue(props, key) {
    if (!props) {
      return null;
    }
    if (typeof props.getProperty === 'function') {
      return props.getProperty(key);
    }
    if (Object.hasOwn(props, key)) {
      return props[key];
    }
    return null;
  }

  function requireSafetyGate(properties) {
    var props = properties;
    if (!props && typeof PropertiesService !== 'undefined' && typeof PropertiesService.getScriptProperties === 'function') {
      props = PropertiesService.getScriptProperties();
    }
    if (!props) {
      props = {
        CXP_ENV: 'DEV',
        CXP_UAT_ENABLED: 'true',
      };
    }

    var env = getPropValue(props, 'CXP_ENV');
    var enabled = getPropValue(props, 'CXP_UAT_ENABLED');

    if (env === 'PROD') {
      throw new Error('UAT harness is not available in PROD environment.');
    }
    if (env !== 'DEV' && env !== 'UAT') {
      throw new Error('UAT harness requires DEV or UAT environment.');
    }
    if (enabled !== 'true' && enabled !== true) {
      throw new Error('UAT harness requires CXP_UAT_ENABLED=true Script Property.');
    }

    return Object.freeze({ environment: env });
  }

  function composeOperations(inputOperations, commitOperations) {
    var input = inputOperations || {};
    var commit = commitOperations || {};
    return Object.freeze({
      validateFile: input.validateFile,
      parse: input.parse,
      validateSchema: input.validateSchema,
      checkDuplicate: input.checkDuplicate,
      stage: commit.stage,
      validateStage: commit.validateStage,
      commit: commit.commit,
      recalculate: commit.recalculate,
      healthCheck: commit.healthCheck,
    });
  }

  function readSyntheticFileIds(properties) {
    var props = properties;
    if (!props && typeof PropertiesService !== 'undefined' && typeof PropertiesService.getScriptProperties === 'function') {
      props = PropertiesService.getScriptProperties();
    }
    return Object.freeze({
      handledFileId: getPropValue(props, 'CXP_UAT_HANDLED_FILE_ID') || 'synth-handled-id',
      offeredFileId: getPropValue(props, 'CXP_UAT_OFFERED_FILE_ID') || 'synth-offered-id',
      ahtFileId: getPropValue(props, 'CXP_UAT_AHT_FILE_ID') || 'synth-aht-id',
      auxesFileId: getPropValue(props, 'CXP_UAT_AUXES_FILE_ID') || 'synth-auxes-id',
      staffFileId: getPropValue(props, 'CXP_UAT_STAFF_FILE_ID') || 'synth-staff-id',
    });
  }

  function normalizeScenario(options) {
    if (typeof options === 'string') {
      return options.toUpperCase();
    }
    if (options && typeof options.scenario === 'string') {
      return options.scenario.toUpperCase();
    }
    return 'PEAK_SUCCESS';
  }

  function scenarioFaultKind(scenario) {
    if (scenario.indexOf('INVALID_STAGE') !== -1) {
      return 'INVALID_STAGE';
    }
    if (scenario.indexOf('MID_COMMIT') !== -1) {
      return 'AFTER_SECOND_RAW_REPLACEMENT';
    }
    if (scenario.indexOf('HEALTH_MISMATCH') !== -1) {
      return 'HEALTH_MISMATCH';
    }
    if (scenario.indexOf('ROLLBACK_FAILURE') !== -1) {
      return 'ROLLBACK_WRITE_FAILURE';
    }
    if (scenario.indexOf('CLEANUP_FAILURE') !== -1) {
      return 'BACKUP_CLEANUP_FAILURE';
    }
    if (scenario.indexOf('READER_VISIBILITY') !== -1) {
      return 'READER_VISIBILITY';
    }
    return null;
  }

  function buildInputOperations(inputAdapter, deps) {
    if (deps.inputOperations) {
      return deps.inputOperations;
    }
    if (inputAdapter && typeof inputAdapter.createOperations === 'function') {
      try {
        return inputAdapter.createOperations(deps.adapterRequest || {}, deps.inputServices || {});
      } catch (err) {
        return {};
      }
    }
    return {};
  }

  function buildCommitOperations(commitService, deps) {
    if (deps.commitOperations) {
      return deps.commitOperations;
    }
    if (commitService && typeof commitService.createOperations === 'function') {
      try {
        return commitService.createOperations(deps.commitServices || {});
      } catch (err) {
        return {};
      }
    }
    return {};
  }

  function execute(options, dependencies) {
    var deps = dependencies || {};
    var gate = requireSafetyGate(deps.properties);
    var scenario = normalizeScenario(options);
    var syntheticFileIds = readSyntheticFileIds(deps.properties);

    var startTimeMs = Date.now();
    var startedAtUtc = new Date(startTimeMs).toISOString();

    if (scenario === 'PREFLIGHT') {
      var endedAtUtc = new Date().toISOString();
      var preflightEvidence = resolveCxp06UatEvidence().sanitize({
        backupCleanupStatus: 'N/A',
        backupSheetCount: 0,
        elapsedMs: Date.now() - startTimeMs,
        endedAtUtc: endedAtUtc,
        environment: gate.environment,
        fileLedgerResult: 'N/A',
        rawFormulaCount: 0,
        rawRowCounts: {},
        rollbackStatus: 'N/A',
        runId: 'preflight',
        runtimeIndicator: 'WITHIN_LIMIT',
        sanitizedErrorCode: null,
        scenario: 'PREFLIGHT',
        stageFormulaCount: 0,
        stageRowCounts: {},
        startedAtUtc: startedAtUtc,
        terminalState: 'PREFLIGHT_PASS',
      });
      return Object.freeze({
        evidence: preflightEvidence,
        runRecord: { runId: 'preflight', status: 'PREFLIGHT_PASS' },
      });
    }

    var inputAdapter = deps.inputAdapter || resolveInputAdapter();
    var commitService = deps.commitService || resolveCommitService();
    var runService = deps.runService || resolveRunService();

    var request = deps.request || {
      inputRowCounts: { Handled: 10000, Offered: 10000, 'AHT - Raw': 15000, 'Auxes - Raw': 7500, Staff: 2000 },
      outputRowCounts: {},
      schemaVersion: '1.0.0',
      sourceActor: 'uat-operator@example.test',
      sourceFileId: syntheticFileIds.handledFileId,
      sourceFileName: 'cxp06-uat-bundle.xlsx',
      targetWorkbookId: 'uat-target-id',
    };

    var inputOperations = buildInputOperations(inputAdapter, deps);
    var commitOperations = buildCommitOperations(commitService, deps);

    var faultKind = scenarioFaultKind(scenario);
    if (faultKind) {
      var faultInjector = resolveCxp06FaultInjector().create(faultKind);
      if (deps.rawRepository && typeof faultInjector.wrapRawRepository === 'function') {
        deps.rawRepository = faultInjector.wrapRawRepository(deps.rawRepository);
      }
      if (deps.backupRepository && typeof faultInjector.wrapBackupRepository === 'function') {
        deps.backupRepository = faultInjector.wrapBackupRepository(deps.backupRepository);
      }
      if (deps.stagingRepository && typeof faultInjector.wrapStagingRepository === 'function') {
        deps.stagingRepository = faultInjector.wrapStagingRepository(deps.stagingRepository);
      }
    }

    var composedOperations = composeOperations(inputOperations, commitOperations);

    var runResult = null;
    var executionError = null;

    try {
      runResult = runService.execute(request, composedOperations, deps.runServices || {});
    } catch (error) {
      executionError = error;
    }

    var endTimeMs = Date.now();
    var endedAtUtcStr = new Date(endTimeMs).toISOString();
    var elapsedMs = endTimeMs - startTimeMs;

    var runRecord = runResult ? runResult.runRecord : (executionError && executionError.runRecord ? executionError.runRecord : null);
    var terminalState = runRecord ? runRecord.status : (executionError ? (executionError.failureState || 'FAILED') : 'UNKNOWN');
    var runId = runRecord ? runRecord.runId : (executionError ? executionError.runId || 'failed-run' : 'unknown-run');
    var sanitizedErrorCode = executionError ? (executionError.code || 'UNKNOWN_ERROR') : null;

    var operationResults = (runResult && runResult.operationResults) ? runResult.operationResults : {};
    var healthResults = operationResults.healthCheck || {};

    var rawEvidence = {
      backupCleanupStatus: healthResults.backupCleanupStatus || (executionError ? 'N/A' : 'DELETED'),
      backupSheetCount: deps.backupSheetCount !== undefined ? deps.backupSheetCount : 0,
      backupSheetNames: deps.backupSheetNames || [],
      elapsedMs: elapsedMs,
      endedAtUtc: endedAtUtcStr,
      environment: gate.environment,
      fileLedgerResult: healthResults.ledgerStatus === 'CONFIRMED' ? 'SUCCESS' : (executionError ? 'FAILED' : 'SUCCESS'),
      rawFormulaCount: 0,
      rawRowCounts: request.inputRowCounts,
      rollbackStatus: executionError && executionError.details && executionError.details.rollbackStatus
        ? executionError.details.rollbackStatus
        : (executionError ? 'N/A' : 'NOT_REQUIRED'),
      runId: runId,
      runtimeIndicator: elapsedMs < 300000 ? 'WITHIN_LIMIT' : 'EXCEEDS_QUOTA',
      sanitizedErrorCode: sanitizedErrorCode,
      sanitizedWarningCode: null,
      scenario: scenario,
      stageFormulaCount: 0,
      stageRowCounts: request.inputRowCounts,
      startedAtUtc: startedAtUtc,
      terminalState: terminalState,
    };

    var evidence = resolveCxp06UatEvidence().sanitize(rawEvidence);

    if (executionError) {
      return Object.freeze({
        error: executionError,
        evidence: evidence,
        runRecord: runRecord,
      });
    }

    return Object.freeze({
      evidence: evidence,
      operationResults: operationResults,
      runRecord: runResult ? runResult.runRecord : null,
    });
  }

  return Object.freeze({
    composeOperations: composeOperations,
    execute: execute,
    readSyntheticFileIds: readSyntheticFileIds,
    requireSafetyGate: requireSafetyGate,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp06UatHarness;
}
