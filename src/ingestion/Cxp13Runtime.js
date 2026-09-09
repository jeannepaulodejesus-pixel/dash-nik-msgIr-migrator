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

  function stateMachineModule() { return moduleFor(typeof RunStateMachine === 'undefined' ? undefined : RunStateMachine, './RunStateMachine.js'); }
  function compose(input, commit) {
    return Object.freeze({
      backupChunk: commit.backupChunk,
      backupStep: commit.backupStep,
      checkDuplicate: input.checkDuplicate,
      commit: commit.commit,
      commitChunk: commit.commitChunk,
      commitDatasetStep: commit.commitDatasetStep,
      cleanupAfterSuccess: commit.cleanupAfterSuccess,
      healthCheck: commit.healthCheck,
      healthDatasetStep: commit.healthDatasetStep,
      healthFinalize: commit.healthFinalize,
      parse: input.parse,
      prepareSingleDataset: input.prepareSingleDataset,
      recalculate: commit.recalculate,
      resume: commit.resume,
      resumeBackup: commit.resumeBackup,
      resumeDataset: commit.resumeDataset,
      rollbackChunk: commit.rollbackChunk,
      stage: commit.stage,
      stageChunk: commit.stageChunk,
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
  function telemetryModule() {
    if (typeof Cxp13IngestionTelemetry !== 'undefined') return Cxp13IngestionTelemetry;
    if (typeof require === 'function') {
      try { return require('./Cxp13IngestionTelemetry.js'); } catch (_error) { return null; }
    }
    return null;
  }
  function withTelemetry(properties, apply) {
    var module = telemetryModule();
    if (!module || !properties) return;
    apply(module, properties);
  }
  function increment(properties, kind) {
    withTelemetry(properties, function (telemetry, props) { telemetry.increment(props, kind); });
  }
  function wrapMethod(target, methodName, kind, properties) {
    if (!target || typeof target[methodName] !== 'function') return target;
    var original = target[methodName].bind(target);
    var facade = Object.assign({}, target);
    facade[methodName] = function () {
      increment(properties, kind);
      return original.apply(null, arguments);
    };
    return facade;
  }
  function wrapLockService(lockService, properties) {
    if (!lockService || typeof lockService.getScriptLock !== 'function') return lockService;
    var originalGet = lockService.getScriptLock.bind(lockService);
    return Object.assign({}, lockService, {
      getScriptLock: function () {
        var lock = originalGet();
        if (!lock) return lock;
        var tryLock = lock.tryLock ? lock.tryLock.bind(lock) : null;
        var waitLock = lock.waitLock ? lock.waitLock.bind(lock) : null;
        return {
          releaseLock: lock.releaseLock ? lock.releaseLock.bind(lock) : undefined,
          tryLock: function (ms) {
            increment(properties, 'lock');
            return tryLock ? tryLock(ms) : false;
          },
          waitLock: waitLock,
        };
      },
    });
  }
  function instrumentServices(services) {
    var properties = services && services.properties;
    if (!properties) return services;
    var wrapped = Object.assign({}, services);
    wrapped.spreadsheetApp = wrapMethod(services.spreadsheetApp, 'openById', 'spreadsheet', properties);
    if (wrapped.spreadsheetApp && services.spreadsheetApp && typeof services.spreadsheetApp.flush === 'function') {
      wrapped.spreadsheetApp = wrapMethod(wrapped.spreadsheetApp, 'flush', 'flush', properties);
    }
    wrapped.driveApp = wrapMethod(services.driveApp, 'getFileById', 'drive', properties);
    wrapped.lockService = wrapLockService(services.lockService, properties);
    var originalFlush = services.flush;
    wrapped.flush = function () {
      increment(properties, 'flush');
      if (typeof originalFlush === 'function') return originalFlush();
      if (services.spreadsheetApp && typeof services.spreadsheetApp.flush === 'function') return services.spreadsheetApp.flush();
      return undefined;
    };
    return wrapped;
  }
  function hostedServices(overrides) {
    var supplied = overrides || {};
    return instrumentServices(Object.assign({}, supplied, {
      clock: supplied.clock || { now: function () { return new Date(); } },
      driveApi: supplied.driveApi || (typeof Drive === 'undefined' ? null : Drive),
      driveApp: supplied.driveApp || (typeof DriveApp === 'undefined' ? null : DriveApp),
      lockService: supplied.lockService || (typeof LockService === 'undefined' ? null : LockService),
      properties: supplied.properties || (typeof PropertiesService === 'undefined' ? null : PropertiesService.getScriptProperties()),
      scriptApp: supplied.scriptApp || (typeof ScriptApp === 'undefined' ? null : ScriptApp),
      session: supplied.session || (typeof Session === 'undefined' ? null : Session),
      spreadsheetApp: supplied.spreadsheetApp || (typeof SpreadsheetApp === 'undefined' ? null : SpreadsheetApp),
      utilities: supplied.utilities || (typeof Utilities === 'undefined' ? null : Utilities),
    }));
  }
  function requireContext(state, services) {
    var config = configModule().load(services.properties);
    if (!config.targetSpreadsheetId || !config.controlSpreadsheetId || !config.driveInboxFolderId) throw errorModule().create('SOURCE_INBOX_NOT_CONFIGURED');
    var control;
    try {
      control = services.spreadsheetApp.openById(config.controlSpreadsheetId);
    } catch (error) {
      throw errorModule().create('LIFECYCLE_CONTROL_UNAVAILABLE', {
        cause: error,
        details: { reason: 'control_workbook_open_failed' },
      });
    }
    var active = weekModule().create(control).findActive();
    if (!active || active.targetSpreadsheetId !== config.targetSpreadsheetId || state.targetWorkbookId !== config.targetSpreadsheetId) {
      throw errorModule().create('LIFECYCLE_ACTIVE_TARGET_MISMATCH');
    }
    // Fail before any Drive source scan. A missing or inaccessible target is
    // an environment error and must not consume the source acquisition budget.
    var target;
    try {
      target = services.spreadsheetApp.openById(config.targetSpreadsheetId);
    } catch (error) {
      throw errorModule().create('LIFECYCLE_TARGET_UNAVAILABLE', {
        cause: error,
        details: { reason: 'target_workbook_open_failed' },
      });
    }
    var singleDataset = state.packagingKind === 'single_dataset';
    // The five-file path validates the selected file identity while reading
    // each source in InputAdapter.validateFile, then rechecks only the current
    // source on resumed preparation. Combined-workbook compatibility retains
    // the predecessor all-source selection check.
    if (!singleDataset && !selectedFilesUnchanged(state.selection, services.driveApp)) {
      throw errorModule().create('INGESTION_SELECTION_CHANGED');
    }
    var ledger = ledgerModule().create(control);
    var repository = runRepoModule().create(control);
    var sources = state.selection.sources.map(function (source) {
      var result = {
        fileId: source.id,
        name: source.name,
        updatedAtUtc: source.updatedAtUtc,
      };
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
      observeSubphase: function (key, durationMs) {
        withTelemetry(services.properties, function (telemetry, props) {
          if (typeof telemetry.noteSubphase === 'function') telemetry.noteSubphase(props, key, durationMs);
        });
      },
    });
    var commitOperations = commitModule().createOperations({
      clock: services.clock, flush: flush, ledgerRepository: ledger, lockService: services.lockService,
      observeSubphase: function (key, durationMs) {
        withTelemetry(services.properties, function (telemetry, props) {
          if (typeof telemetry.noteSubphase === 'function') telemetry.noteSubphase(props, key, durationMs);
        });
      },
      session: services.session, spreadsheetApp: services.spreadsheetApp, targetSpreadsheet: target,
    });
    return Object.freeze({
      operations: compose(inputOperations, commitOperations),
      request: Object.freeze({
        inputRowCounts: Object.freeze({}), outputRowCounts: Object.freeze({}), schemaVersion: '1.0.0',
        packagingKind: state.packagingKind,
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
    var cachedRuntime = null;
    var cachedPreparation = null;
    var cachedPayloads = Object.create(null);
    var resumedBackup = false;
    var resumedDatasetName = null;
    var failureCheckpoint = null;
    function context() {
      if (!cachedRuntime) {
        cachedRuntime = dependencies && typeof dependencies.runtimeFactory === 'function'
          ? dependencies.runtimeFactory(state, services)
          : requireContext(state, services);
      }
      return cachedRuntime;
    }
    function isoNow() {
      var value = services.clock && typeof services.clock.now === 'function' ? services.clock.now() : new Date();
      return (value instanceof Date ? value : new Date(value)).toISOString();
    }
    function clockMs() {
      var value = services.clock && typeof services.clock.now === 'function' ? services.clock.now() : new Date();
      return (value instanceof Date ? value : new Date(value)).getTime();
    }
    function timedSubphase(key, operation) {
      var started = clockMs();
      try {
        return operation();
      } finally {
        withTelemetry(services.properties, function (telemetry, props) {
          if (typeof telemetry.noteSubphase === 'function') telemetry.noteSubphase(props, key, Math.max(0, clockMs() - started));
        });
      }
    }
    function runContextFrom(checkpoint) {
      return {
        operationResults: {},
        pendingFailure: state.pendingFailure || null,
        request: checkpoint.request,
        runId: checkpoint.runId,
        startedAtUtc: checkpoint.startedAtUtc,
      };
    }
    function datasetNamesFrom(data) {
      if (data && Array.isArray(data.datasetNames) && data.datasetNames.length) return data.datasetNames;
      return datasetModule().listBindings().map(function (binding) { return binding.datasetName; });
    }
    function finalCheckpointWithRowCounts(checkpoint) {
      var data = checkpoint && checkpoint.data || {};
      var source = data.rowCounts;
      if (!source || typeof source !== 'object' || Array.isArray(source)) return checkpoint;
      var names = datasetNamesFrom(data);
      var counts = {};
      for (var index = 0; index < names.length; index += 1) {
        var name = names[index];
        if (!Object.prototype.hasOwnProperty.call(source, name) || !Number.isInteger(source[name]) || source[name] < 0) {
          return checkpoint;
        }
        counts[name] = source[name];
      }
      var inputCounts = Object.freeze(Object.assign({}, counts));
      var outputCounts = Object.freeze(Object.assign({}, counts));
      var request = Object.freeze(Object.assign({}, checkpoint.request, {
        inputRowCounts: inputCounts,
        outputRowCounts: outputCounts,
      }));
      return Object.freeze(Object.assign({}, checkpoint, { request: request }));
    }
    function preparationCheckpoint(context, machine, data) {
      return Object.freeze({
        data: data || {},
        request: Object.freeze(Object.assign({}, context.request)),
        runId: context.runId,
        startedAtUtc: context.startedAtUtc,
        stateHistory: machine.history(),
        version: 1,
      });
    }
    function minimalCheckpointRequest(existing) {
      if (existing && existing.request) return existing.request;
      return Object.freeze({
        inputRowCounts: Object.freeze({}),
        outputRowCounts: Object.freeze({}),
        packagingKind: state.packagingKind,
        schemaVersion: '1.0.0',
        sourceActor: 'domain-user',
        sourceFileId: 'inbox:' + String(state.batchToken || ''),
        sourceFileName: 'cxp13-inbox-bundle',
        targetWorkbookId: state.targetWorkbookId,
      });
    }
    return Object.freeze({
      hasFailureCheckpoint: function () { return Boolean(failureCheckpoint); },
      auditFailure: function (current, error) {
        var checkpoint = current && current.checkpoint || failureCheckpoint;
        if (!checkpoint) {
          throw errorModule().create('INGESTION_INVALID_RUN_METADATA', {
            details: { field: 'failureCheckpoint' },
          });
        }
        // Attach metadata before opening the control workbook. If control
        // access is the failure being audited, the controller must persist
        // this checkpoint so an operator retry can complete after recovery.
        if (current && !current.checkpoint) current.checkpoint = checkpoint;
        var config = configModule().load(services.properties);
        var control = services.spreadsheetApp.openById(config.controlSpreadsheetId);
        withTelemetry(services.properties, function (telemetry, props) {
          if (error && error.details && error.details.rollbackStatus && error.details.rollbackStatus !== 'VERIFIED') {
            telemetry.noteLastKnownGood(props, false);
          }
        });
        runService.recordFailure(checkpoint, error, {
          clock: services.clock,
          repository: runRepoModule().create(control),
        });
      },
      prepare: function (current) {
        var existing = current.checkpoint;
        var machineModule = stateMachineModule();
        var machine = existing && Array.isArray(existing.stateHistory)
          ? machineModule.restore(services.clock, existing.stateHistory)
          : machineModule.create(services.clock);
        var ctx = {
          operationResults: {},
          request: minimalCheckpointRequest(existing),
          runId: existing ? existing.runId : state.runId,
          startedAtUtc: existing ? existing.startedAtUtc : isoNow(),
        };
        if (!existing) {
          machine.transition('VALIDATING_FILE');
        }
        failureCheckpoint = existing || preparationCheckpoint(ctx, machine);
        var runtime = context();
        ctx.request = runtime.request;
        if (!existing) failureCheckpoint = preparationCheckpoint(ctx, machine);
        var data = existing && existing.data || {};
        var cursor = data.prepareCursor || { datasetIndex: 0, nextRow: 1, phase: 'clear' };
        var datasetNames = datasetNamesFrom(data);
        var singleDataset = state.packagingKind === 'single_dataset';
        var resumedSingleDataset = Boolean(existing && singleDataset &&
          typeof data.fingerprint === 'string' && Array.isArray(data.sourceFiles));
        if (!cachedPreparation && singleDataset && !existing) {
          // Acquire and fingerprint the complete five-file bundle once. The
          // duplicate ledger lookup intentionally precedes XLSX conversion;
          // the current dataset is parsed only after this cheap rejection gate.
          var initialValidateFile = timedSubphase('acquire', function () {
            return runtime.operations.validateFile(ctx);
          });
          // Preserve the metadata-only preparation evidence before the cheap
          // duplicate gate. If the gate rejects the bundle, the failure
          // checkpoint still identifies the acquired bundle without storing
          // source rows or converted payloads.
          failureCheckpoint = preparationCheckpoint(ctx, machine, {
            datasetNames: datasetNames.slice(),
            fingerprint: initialValidateFile.fingerprint,
            sourceFiles: initialValidateFile.sourceFiles,
          });
          var initialCheckedDuplicate = runtime.operations.checkDuplicate(ctx);
          data = Object.assign({}, data, {
            fingerprint: initialCheckedDuplicate.fingerprint,
            sourceFiles: initialCheckedDuplicate.sourceFiles,
          });
          cachedPreparation = Object.freeze({
            checkDuplicate: initialCheckedDuplicate,
            parse: Object.freeze({ packagingKind: state.packagingKind }),
            validateFile: initialValidateFile,
          });
        } else if (!cachedPreparation && !resumedSingleDataset) {
          var validateFile = timedSubphase('acquire', function () { return runtime.operations.validateFile(ctx); });
          if (!existing) machine.transition('PARSING');
          failureCheckpoint = preparationCheckpoint(ctx, machine, existing && existing.data);
          var parsed = timedSubphase('convert', function () { return runtime.operations.parse(ctx); });
          if (!existing) machine.transition('VALIDATING_SCHEMA');
          failureCheckpoint = preparationCheckpoint(ctx, machine, existing && existing.data);
          var validatedSchema = timedSubphase('schema', function () { return runtime.operations.validateSchema(ctx); });
          if (!existing) machine.transition('CHECKING_DUPLICATE');
          failureCheckpoint = preparationCheckpoint(ctx, machine, existing && existing.data);
          var checkedDuplicate = runtime.operations.checkDuplicate(ctx);
          cachedPreparation = Object.freeze({
            checkDuplicate: checkedDuplicate,
            parse: parsed,
            validateFile: validateFile,
            validateSchema: validatedSchema,
          });
          validatedSchema.payloads.forEach(function (payload) {
            cachedPayloads[payload.datasetName] = payload;
          });
          datasetNames = validatedSchema.payloads.map(function (payload) { return payload.datasetName; });
        } else if (!cachedPreparation) {
          cachedPreparation = Object.freeze({
            checkDuplicate: Object.freeze({
              fingerprint: data.fingerprint,
              sourceFiles: Object.freeze(data.sourceFiles.slice()),
            }),
            parse: Object.freeze({ packagingKind: state.packagingKind }),
            validateFile: Object.freeze({
              fingerprint: data.fingerprint,
              sourceFiles: Object.freeze(data.sourceFiles.slice()),
            }),
          });
        }
        var datasetIndex = Number.isInteger(cursor.datasetIndex) ? cursor.datasetIndex : 0;
        var currentDatasetName = datasetNames[datasetIndex] || null;
        if (singleDataset && currentDatasetName && !cachedPayloads[currentDatasetName]) {
          if (!existing) {
            machine.transition('PARSING');
            failureCheckpoint = preparationCheckpoint(ctx, machine, data);
          }
          var resumedPayload = runtime.operations.prepareSingleDataset(ctx, data, currentDatasetName).payload;
          cachedPayloads[currentDatasetName] = resumedPayload;
          if (!existing) {
            machine.transition('VALIDATING_SCHEMA');
            // The duplicate check was completed before conversion. Record the
            // established audit phase without replaying its ledger lookup.
            machine.transition('CHECKING_DUPLICATE');
          }
        }
        var payloads = singleDataset
          ? (currentDatasetName && cachedPayloads[currentDatasetName] ? [cachedPayloads[currentDatasetName]] : [])
          : cachedPreparation.validateSchema.payloads;
        ctx.operationResults.validateFile = cachedPreparation.validateFile;
        ctx.operationResults.parse = cachedPreparation.parse;
        ctx.operationResults.validateSchema = Object.freeze({
          datasetNames: Object.freeze(datasetNames.slice()),
          payloads: Object.freeze(payloads.slice()),
        });
        ctx.operationResults.checkDuplicate = cachedPreparation.checkDuplicate;
        var duplicate = ctx.operationResults.checkDuplicate;
        if (!existing) {
          machine.transition('STAGING');
          machine.transition('VALIDATING_STAGE');
          // Keep the metadata-only preparation checkpoint available if the
          // first staging write fails; source rows and converted payloads are
          // intentionally excluded from the audit checkpoint.
          failureCheckpoint = preparationCheckpoint(ctx, machine, Object.assign({}, data, {
            datasetNames: datasetNames.slice(),
            fingerprint: duplicate.fingerprint,
            sourceFiles: duplicate.sourceFiles,
          }));
        }
        var staged = runtime.operations.stageChunk(ctx, cursor);
        var counts = Object.assign({}, data.rowCounts || {});
        payloads.forEach(function (payload) {
          counts[payload.datasetName] = payload.records ? payload.records.length : (Number.isInteger(payload.rowCount) ? payload.rowCount : 0);
        });
        withTelemetry(services.properties, function (telemetry, props) {
          telemetry.noteDigest(props, duplicate.fingerprint);
          telemetry.noteRowCounts(props, counts);
        });
        return Object.freeze({
          checkpoint: Object.freeze({
            data: {
              datasetNames: datasetNames.slice(),
              fingerprint: duplicate.fingerprint,
              prepareCursor: staged.complete ? null : staged.prepareCursor,
              rowCounts: counts,
              sourceFiles: duplicate.sourceFiles,
            },
            request: Object.freeze(Object.assign({}, runtime.request, { inputRowCounts: Object.freeze(Object.assign({}, counts)) })),
            runId: ctx.runId,
            startedAtUtc: ctx.startedAtUtc,
            stateHistory: machine.history(),
            version: 1,
          }),
          complete: staged.complete === true,
          workUnitDurationMs: staged.workUnitDurationMs,
        });
      },
      backup: function (current) {
        var runtime = context();
        var checkpoint = current.checkpoint;
        var runContext = runContextFrom(checkpoint);
        if (!resumedBackup) {
          runtime.operations.resumeBackup(runContext, checkpoint.data || {});
          resumedBackup = true;
        }
        return runtime.operations.backupChunk(runContext, (checkpoint.data || {}).backupCursor || null);
      },
      commit: function (current) {
        var runtime = context();
        var checkpoint = current.checkpoint;
        var data = checkpoint.data || {};
        var progress = data.commitProgress;
        if (!progress || progress.complete !== true) {
          var names = datasetNamesFrom(data);
          var index = progress ? progress.nextDatasetIndex : 0;
          var runContext = runContextFrom(checkpoint);
          if (resumedDatasetName !== names[index]) {
            runtime.operations.resumeDataset(runContext, data, names[index]);
            resumedDatasetName = names[index];
          }
          var incoming = progress || { complete: false, lastCompletedDatasetName: null, nextDatasetIndex: 0 };
          var stepped = runtime.operations.commitChunk(runContext, incoming);
          if (stepped && stepped.rowCounts) {
            withTelemetry(services.properties, function (telemetry, props) { telemetry.noteRowCounts(props, stepped.rowCounts); });
          }
          var commitProgress = Object.assign({}, stepped);
          delete commitProgress.workUnitDurationMs;
          return Object.freeze({
            commitProgress: Object.freeze(commitProgress),
            workUnitDurationMs: stepped && stepped.workUnitDurationMs,
          });
        }
        return Object.freeze({ commitProgress: progress });
      },
      health: function (current) {
        var runtime = context();
        var checkpoint = current.checkpoint;
        var data = checkpoint.data || {};
        var names = datasetNamesFrom(data);
        var cursor = data.healthCursor || { nextDatasetIndex: 0 };
        var runContext = runContextFrom(checkpoint);
        if (!Number.isInteger(cursor.nextDatasetIndex) || cursor.nextDatasetIndex < names.length) {
          if (!resumedBackup) {
            runtime.operations.resumeBackup(runContext, data);
            resumedBackup = true;
          }
          return runtime.operations.healthDatasetStep(runContext, cursor, data.rowCounts || {});
        }
        var ops = Object.assign({}, runtime.operations, {
          commit: function () { return Object.freeze({ alreadyCommitted: true }); },
          cleanupAfterSuccess: function (ctx) { return runtime.operations.cleanupAfterSuccess(ctx); },
          healthCheck: function (ctx) { return runtime.operations.healthFinalize(ctx); },
          resume: function (ctx, checkpointData) { return runtime.operations.resumeBackup(ctx, checkpointData); },
        });
        var resumed = runService.resume(finalCheckpointWithRowCounts(checkpoint), ops, runtime.runServices);
        if (resumed && resumed.runRecord && resumed.runRecord.inputRowCounts) {
          withTelemetry(services.properties, function (telemetry, props) {
            telemetry.noteRowCounts(props, resumed.runRecord.inputRowCounts);
          });
        }
        return resumed;
      },
      rollback: function (current) {
        var runtime = context();
        var checkpoint = current.checkpoint;
        if (!resumedBackup) {
          runtime.operations.resumeBackup(runContextFrom(checkpoint), checkpoint.data || {});
          resumedBackup = true;
        }
        return runtime.operations.rollbackChunk(runContextFrom(checkpoint), (checkpoint.data || {}).rollbackCursor || null);
      },
    });
  }
  return Object.freeze({ compose: compose, executorFactory: executorFactory, hostedServices: hostedServices, sameSelection: sameSelection, selectedFilesUnchanged: selectedFilesUnchanged });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Cxp13Runtime;
