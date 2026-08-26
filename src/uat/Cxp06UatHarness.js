var Cxp06UatHarness = (function () {
  'use strict';

  function resolveCxp06FaultInjector() {
    if (typeof Cxp06FaultInjector !== 'undefined') {
      return Cxp06FaultInjector;
    }
    return require('./Cxp06FaultInjector.js');
  }

  function resolveCxp06BackupTopologySeeder() {
    if (typeof Cxp06BackupTopologySeeder !== 'undefined') {
      return Cxp06BackupTopologySeeder;
    }
    return require('./Cxp06BackupTopologySeeder.js');
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

  function resolveFileLedgerRepository() {
    if (typeof FileLedgerRepository !== 'undefined') {
      return FileLedgerRepository;
    }
    return require('../repository/FileLedgerRepository.js');
  }

  function resolveRunRepository() {
    if (typeof RunRepository !== 'undefined') {
      return RunRepository;
    }
    return require('../repository/RunRepository.js');
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
    var operations = {
      validateFile: input.validateFile,
      parse: input.parse,
      validateSchema: input.validateSchema,
      checkDuplicate: input.checkDuplicate,
      stage: commit.stage,
      validateStage: commit.validateStage,
      commit: commit.commit,
      recalculate: commit.recalculate,
      healthCheck: commit.healthCheck,
    };
    if (typeof commit.resume === 'function') {
      operations.resume = commit.resume;
    }
    if (typeof commit.resumeBackup === 'function') {
      operations.resumeBackup = commit.resumeBackup;
    }
    if (typeof commit.resumeDataset === 'function') {
      operations.resumeDataset = commit.resumeDataset;
    }
    if (typeof commit.backupStep === 'function') {
      operations.backupStep = commit.backupStep;
    }
    if (typeof commit.commitStep === 'function') {
      operations.commitStep = commit.commitStep;
    }
    if (typeof commit.commitDatasetStep === 'function') {
      operations.commitDatasetStep = commit.commitDatasetStep;
    }
    return Object.freeze(operations);
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

  function requiredProperty(properties, key) {
    var value = getPropValue(properties, key);
    var normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
      throw new Error(key + ' is required for hosted UAT execution.');
    }
    return normalized;
  }

  function createHostedDependencies(properties, services, modules) {
    var gate = requireSafetyGate(properties);
    var runtime = services || {};
    var resolvedModules = modules || {};
    var spreadsheetApp = runtime.spreadsheetApp;
    if (!spreadsheetApp || typeof spreadsheetApp.openById !== 'function') {
      throw new Error('SpreadsheetApp.openById is required for hosted UAT execution.');
    }

    var targetSpreadsheetId = requiredProperty(
      properties,
      'CXP_' + gate.environment + '_TARGET_SPREADSHEET_ID',
    );
    var controlSpreadsheetId = requiredProperty(
      properties,
      'CXP_' + gate.environment + '_CONTROL_SPREADSHEET_ID',
    );
    if (targetSpreadsheetId === controlSpreadsheetId) {
      throw new Error('Target and control spreadsheet IDs must be distinct.');
    }

    var sourceDefinitions = [
      ['Handled', 'handledFileId'],
      ['Offered', 'offeredFileId'],
      ['AHT - Raw', 'ahtFileId'],
      ['Auxes - Raw', 'auxesFileId'],
      ['Staff', 'staffFileId'],
    ];
    var sources = sourceDefinitions.map(function (definition) {
      return Object.freeze({
        datasetName: definition[0],
        fileId: requiredProperty(properties, {
          handledFileId: 'CXP_UAT_HANDLED_FILE_ID',
          offeredFileId: 'CXP_UAT_OFFERED_FILE_ID',
          ahtFileId: 'CXP_UAT_AHT_FILE_ID',
          auxesFileId: 'CXP_UAT_AUXES_FILE_ID',
          staffFileId: 'CXP_UAT_STAFF_FILE_ID',
        }[definition[1]]),
      });
    });

    var targetSpreadsheet = spreadsheetApp.openById(targetSpreadsheetId);
    var controlSpreadsheet = spreadsheetApp.openById(controlSpreadsheetId);
    var ledgerRepository = (resolvedModules.fileLedgerRepository || resolveFileLedgerRepository())
      .create(controlSpreadsheet);
    var runRepository = (resolvedModules.runRepository || resolveRunRepository())
      .create(controlSpreadsheet);
    var flush = typeof runtime.flush === 'function'
      ? runtime.flush
      : function () { spreadsheetApp.flush(); };
    var activeUser = runtime.session && typeof runtime.session.getActiveUser === 'function'
      ? runtime.session.getActiveUser()
      : null;
    var sourceActor = activeUser && typeof activeUser.getEmail === 'function'
      ? activeUser.getEmail()
      : 'uat-operator';
    var inputRowCounts = {
      Handled: 10000,
      Offered: 10000,
      'AHT - Raw': 15000,
      'Auxes - Raw': 7500,
      Staff: 2000,
    };

    return Object.freeze({
      adapterRequest: Object.freeze({
        packagingKind: 'single_dataset',
        runMetadata: Object.freeze({ schemaVersion: '1.0.0' }),
        sources: Object.freeze(sources),
      }),
      commitServices: Object.freeze({
        flush: flush,
        ledgerRepository: ledgerRepository,
        lockService: runtime.lockService,
        session: runtime.session,
        spreadsheetApp: spreadsheetApp,
        targetSpreadsheet: targetSpreadsheet,
      }),
      inputServices: Object.freeze({
        driveApi: runtime.driveApi,
        driveApp: runtime.driveApp,
        ledgerRepository: ledgerRepository,
        spreadsheetApp: spreadsheetApp,
        utilities: runtime.utilities,
      }),
      properties: properties,
      request: Object.freeze({
        inputRowCounts: Object.freeze(inputRowCounts),
        outputRowCounts: Object.freeze({}),
        schemaVersion: '1.0.0',
        sourceActor: sourceActor,
        sourceFileId: sources[0].fileId,
        sourceFileName: 'cxp06-uat-five-file-bundle',
        targetWorkbookId: targetSpreadsheetId,
      }),
      runServices: Object.freeze({
        flush: flush,
        lockService: runtime.lockService,
        repository: runRepository,
        telemetry: runtime.telemetry,
      }),
      topologyServices: Object.freeze({
        now: function () { return new Date(); },
        uniqueToken: function () {
          if (!runtime.utilities || typeof runtime.utilities.getUuid !== 'function') {
            throw new Error('Utilities.getUuid is required for controlled topology seeding.');
          }
          return runtime.utilities.getUuid().replace(/[^A-Za-z0-9_-]/g, '');
        },
      }),
    });
  }

  function hasHostedRuntime() {
    return typeof PropertiesService !== 'undefined' &&
      typeof SpreadsheetApp !== 'undefined';
  }

  function hostedRuntimeServices() {
    var telemetryStartedAtMs = Date.now();
    return {
      driveApi: typeof Drive !== 'undefined' ? Drive : null,
      driveApp: typeof DriveApp !== 'undefined' ? DriveApp : null,
      lockService: typeof LockService !== 'undefined' ? LockService : null,
      session: typeof Session !== 'undefined' ? Session : null,
      spreadsheetApp: SpreadsheetApp,
      telemetry: function (event) {
        if (typeof console !== 'undefined' && typeof console.log === 'function') {
          console.log('CXP_UAT_PHASE ' + JSON.stringify(Object.assign({}, event, {
            elapsedMs: Date.now() - telemetryStartedAtMs,
          })));
        }
      },
      utilities: typeof Utilities !== 'undefined' ? Utilities : null,
    };
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

  function requireExecutableScenario(scenario) {
    var executableScenarios = [
      'PREFLIGHT',
      'PEAK_SUCCESS',
      'CASE1_PEAK_SUCCESS',
      'CASE2_INVALID_STAGE',
      'CASE3_MID_COMMIT_FAILURE',
      'CASE4_HEALTH_MISMATCH',
      'CASE4_ROLLBACK_FAILURE',
      'CASE5_INCOMPLETE_BACKUP',
      'CASE5_COMPLETE_UNSUCCESSFUL_BACKUP',
      'CASE5_SUCCESSFUL_LEFTOVER_BACKUP',
      'CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS',
      'CASE5_CLEANUP_FAILURE',
      'READER_VISIBILITY',
    ];
    if (executableScenarios.indexOf(scenario) === -1) {
      throw new Error('Unknown UAT scenario: ' + scenario + '.');
    }
  }

  function isTopologyScenario(scenario) {
    return [
      'CASE5_INCOMPLETE_BACKUP',
      'CASE5_COMPLETE_UNSUCCESSFUL_BACKUP',
      'CASE5_SUCCESSFUL_LEFTOVER_BACKUP',
      'CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS',
    ].indexOf(scenario) !== -1;
  }

  function buildInputOperations(inputAdapter, deps) {
    if (deps.inputOperations) {
      return deps.inputOperations;
    }
    if (inputAdapter && typeof inputAdapter.createOperations === 'function') {
      return inputAdapter.createOperations(deps.adapterRequest || {}, deps.inputServices || {});
    }
    return {};
  }

  function buildCommitOperations(commitService, deps) {
    if (deps.commitOperations) {
      return deps.commitOperations;
    }
    if (commitService && typeof commitService.createOperations === 'function') {
      return commitService.createOperations(deps.commitServices || {});
    }
    return {};
  }

  function execute(options, dependencies) {
    var scenario = normalizeScenario(options);
    requireExecutableScenario(scenario);
    var deps = dependencies || {};
    if (!dependencies && hasHostedRuntime()) {
      var hostedProperties = PropertiesService.getScriptProperties();
      deps = createHostedDependencies(hostedProperties, hostedRuntimeServices());
    }
    var gate = requireSafetyGate(deps.properties);
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

    var faultKind = scenarioFaultKind(scenario);
    if (faultKind) {
      var faultInjector = resolveCxp06FaultInjector().create(faultKind);
      deps = Object.assign({}, deps, {
        commitServices: Object.assign({}, deps.commitServices || {}, {
          decorateBackupRepository: faultInjector.wrapBackupRepository,
          decorateRawRepository: faultInjector.wrapRawRepository,
          decorateStagingRepository: faultInjector.wrapStagingRepository,
          rawObserver: faultInjector.rawObserver,
        }),
      });
    }

    if (isTopologyScenario(scenario)) {
      var topologySeeder = deps.topologySeeder || resolveCxp06BackupTopologySeeder();
      var topologyServices = deps.topologyServices || {};
      var topologySeeded = false;
      var topologySeedResult = null;
      deps = Object.assign({}, deps, {
        commitServices: Object.assign({}, deps.commitServices || {}, {
          beforeReconcile: function (context) {
            if (topologySeeded) {
              return topologySeedResult;
            }
            topologySeeded = true;
            topologySeedResult = topologySeeder.create({
              backupRepository: context.backupRepository,
              ledgerRepository: context.ledgerRepository,
              now: topologyServices.now,
              targetSpreadsheet: context.targetSpreadsheet,
              uniqueToken: topologyServices.uniqueToken,
            }).seed(scenario);
            return topologySeedResult;
          },
        }),
      });
    }

    var inputOperations = buildInputOperations(inputAdapter, deps);
    var commitOperations = buildCommitOperations(commitService, deps);

    var composedOperations = composeOperations(inputOperations, commitOperations);
    if (faultInjector && typeof faultInjector.wrapOperations === 'function') {
      composedOperations = faultInjector.wrapOperations(composedOperations);
    }

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
      backupSheetCount: deps.backupSheetCount !== undefined
        ? deps.backupSheetCount
        : (topologySeedResult ? topologySeedResult.sheetNames.length : 0),
      backupSheetNames: deps.backupSheetNames ||
        (topologySeedResult ? topologySeedResult.sheetNames : []),
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
    createHostedDependencies: createHostedDependencies,
    execute: execute,
    hostedRuntimeServices: hostedRuntimeServices,
    readSyntheticFileIds: readSyntheticFileIds,
    requireSafetyGate: requireSafetyGate,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp06UatHarness;
}
