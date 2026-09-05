var Cxp13Runtime = (function () {
  'use strict';

  function moduleFor(globalValue, path) { return globalValue !== undefined ? globalValue : require(path); }
  function configModule() { return moduleFor(typeof Config === 'undefined' ? undefined : Config, '../config/Config.js'); }
  function inboxModule() { return moduleFor(typeof InboxBundleRepository === 'undefined' ? undefined : InboxBundleRepository, '../repository/InboxBundleRepository.js'); }
  function weekModule() { return moduleFor(typeof WeekRegistryRepository === 'undefined' ? undefined : WeekRegistryRepository, '../repository/WeekRegistryRepository.js'); }
  function ledgerModule() { return moduleFor(typeof FileLedgerRepository === 'undefined' ? undefined : FileLedgerRepository, '../repository/FileLedgerRepository.js'); }
  function runRepoModule() { return moduleFor(typeof RunRepository === 'undefined' ? undefined : RunRepository, '../repository/RunRepository.js'); }
  function inputModule() { return moduleFor(typeof InputAdapter === 'undefined' ? undefined : InputAdapter, './InputAdapter.js'); }
  function commitModule() { return moduleFor(typeof CommitService === 'undefined' ? undefined : CommitService, '../services/CommitService.js'); }
  function runModule() { return moduleFor(typeof RunService === 'undefined' ? undefined : RunService, './RunService.js'); }
  function datasetModule() { return moduleFor(typeof DatasetSheets === 'undefined' ? undefined : DatasetSheets, '../config/DatasetSheets.js'); }
  function errorModule() { return moduleFor(typeof ErrorCodes === 'undefined' ? undefined : ErrorCodes, '../monitoring/ErrorCodes.js'); }

  function compose(input, commit) {
    return Object.freeze({
      backupStep: commit.backupStep,
      checkDuplicate: input.checkDuplicate,
      commit: commit.commit,
      commitDatasetStep: commit.commitDatasetStep,
      healthCheck: commit.healthCheck,
      parse: input.parse,
      recalculate: commit.recalculate,
      resume: commit.resume,
      resumeBackup: commit.resumeBackup,
      resumeDataset: commit.resumeDataset,
      stage: commit.stage,
      validateFile: input.validateFile,
      validateSchema: input.validateSchema,
      validateStage: commit.validateStage,
    });
  }
  function sameSelection(expected, actual) {
    if (!actual || expected.batchToken !== actual.batchToken || expected.packagingKind !== actual.packagingKind || expected.sources.length !== actual.sources.length) return false;
    return expected.sources.every(function (source, index) {
      var other = actual.sources[index];
      return source.id === other.id && source.name === other.name && source.updatedAtUtc === other.updatedAtUtc && (source.datasetName || null) === (other.datasetName || null);
    });
  }
  function selectedFilesUnchanged(expected, driveApp) {
    try {
      return expected.sources.every(function (source) {
        var file = driveApp.getFileById(source.id);
        return String(file.getName()) === source.name && file.getLastUpdated().toISOString() === source.updatedAtUtc;
      });
    } catch (_error) {
      return false;
    }
  }
  function hostedServices(overrides) {
    var supplied = overrides || {};
    return Object.assign({}, supplied, {
      clock: supplied.clock || { now: function () { return new Date(); } },
      driveApi: supplied.driveApi || (typeof Drive === 'undefined' ? null : Drive),
      driveApp: supplied.driveApp || (typeof DriveApp === 'undefined' ? null : DriveApp),
      lockService: supplied.lockService || (typeof LockService === 'undefined' ? null : LockService),
      properties: supplied.properties || (typeof PropertiesService === 'undefined' ? null : PropertiesService.getScriptProperties()),
      scriptApp: supplied.scriptApp || (typeof ScriptApp === 'undefined' ? null : ScriptApp),
      session: supplied.session || (typeof Session === 'undefined' ? null : Session),
      spreadsheetApp: supplied.spreadsheetApp || (typeof SpreadsheetApp === 'undefined' ? null : SpreadsheetApp),
      utilities: supplied.utilities || (typeof Utilities === 'undefined' ? null : Utilities),
    });
  }
  function requireContext(state, services) {
    var config = configModule().load(services.properties);
    if (!config.targetSpreadsheetId || !config.controlSpreadsheetId || !config.driveInboxFolderId) throw errorModule().create('SOURCE_INBOX_NOT_CONFIGURED');
    var control = services.spreadsheetApp.openById(config.controlSpreadsheetId);
    var active = weekModule().create(control).findActive();
    if (!active || active.targetSpreadsheetId !== config.targetSpreadsheetId || state.targetWorkbookId !== config.targetSpreadsheetId) {
      throw errorModule().create('LIFECYCLE_ACTIVE_TARGET_MISMATCH');
    }
    if (!selectedFilesUnchanged(state.selection, services.driveApp)) throw errorModule().create('INGESTION_SELECTION_CHANGED');
    var target = services.spreadsheetApp.openById(config.targetSpreadsheetId);
    var ledger = ledgerModule().create(control);
    var repository = runRepoModule().create(control);
    var sources = state.selection.sources.map(function (source) {
      var result = { fileId: source.id };
      if (source.datasetName) result.datasetName = source.datasetName;
      return Object.freeze(result);
    });
    var adapterRequest = Object.freeze({
      packagingKind: state.packagingKind,
      runMetadata: Object.freeze({ schemaVersion: '1.0.0' }),
      sources: Object.freeze(sources),
    });
    var flush = services.flush || function () { services.spreadsheetApp.flush(); };
    var inputOperations = inputModule().createOperations(adapterRequest, {
      clock: services.clock, driveApi: services.driveApi, driveApp: services.driveApp,
      ledgerRepository: ledger, spreadsheetApp: services.spreadsheetApp, utilities: services.utilities,
    });
    var commitOperations = commitModule().createOperations({
      clock: services.clock, flush: flush, ledgerRepository: ledger, lockService: services.lockService,
      session: services.session, spreadsheetApp: services.spreadsheetApp, targetSpreadsheet: target,
    });
    return Object.freeze({
      operations: compose(inputOperations, commitOperations),
      request: Object.freeze({
        inputRowCounts: Object.freeze({}), outputRowCounts: Object.freeze({}), schemaVersion: '1.0.0',
        sourceActor: 'domain-user', sourceFileId: 'inbox:' + state.batchToken,
        sourceFileName: 'cxp13-inbox-bundle', targetWorkbookId: config.targetSpreadsheetId,
      }),
      runServices: Object.freeze({
        clock: services.clock,
        flush: flush,
        generateRunId: function () { return state.runId; },
        lockService: services.lockService,
        repository: repository,
      }),
    });
  }
  function executorFactory(state, dependencies) {
    var services = hostedServices(dependencies);
    var runService = runModule();
    function context() { return requireContext(state, services); }
    return Object.freeze({
      auditFailure: function (current, error) {
        var config = configModule().load(services.properties);
        var control = services.spreadsheetApp.openById(config.controlSpreadsheetId);
        runService.recordFailure(current.checkpoint, error, {
          clock: services.clock,
          repository: runRepoModule().create(control),
        });
      },
      prepare: function () {
        var runtime = context();
        return runService.prepare(runtime.request, runtime.operations, Object.assign({}, runtime.runServices, {
          createCheckpoint: function (runContext) {
            var duplicate = runContext.operationResults.checkDuplicate;
            return Object.freeze({
              datasetNames: runContext.operationResults.validateSchema.payloads.map(function (payload) { return payload.datasetName; }),
              fingerprint: duplicate.fingerprint,
              sourceFiles: duplicate.sourceFiles,
            });
          },
        }));
      },
      backup: function (current) {
        var runtime = context(); var output; var checkpoint = current.checkpoint;
        runtime.operations.resumeBackup({ operationResults: {}, request: checkpoint.request, runId: checkpoint.runId, startedAtUtc: checkpoint.startedAtUtc }, checkpoint.data || {});
        output = runtime.operations.backupStep({ operationResults: {}, request: checkpoint.request, runId: checkpoint.runId, startedAtUtc: checkpoint.startedAtUtc });
        return output;
      },
      commit: function (current) {
        var runtime = context(); var checkpoint = current.checkpoint; var data = checkpoint.data || {}; var progress = data.commitProgress;
        if (!progress || progress.complete !== true) {
          var names = data.datasetNames || datasetModule().listBindings().map(function (binding) { return binding.datasetName; });
          var index = progress ? progress.nextDatasetIndex : 0;
          var runContext = { operationResults: {}, request: checkpoint.request, runId: checkpoint.runId, startedAtUtc: checkpoint.startedAtUtc };
          runtime.operations.resumeDataset(runContext, data, names[index]);
          return Object.freeze({ commitProgress: runtime.operations.commitDatasetStep(runContext, progress || { complete: false, lastCompletedDatasetName: null, nextDatasetIndex: 0 }) });
        }
        return runService.resume(checkpoint, runtime.operations, runtime.runServices);
      },
    });
  }
  return Object.freeze({ compose: compose, executorFactory: executorFactory, hostedServices: hostedServices, sameSelection: sameSelection, selectedFilesUnchanged: selectedFilesUnchanged });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Cxp13Runtime;
