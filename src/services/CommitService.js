var CommitService = (function () {
  'use strict';

  var DEFAULT_LOCK_TIMEOUT_MS = 30000;

  function resolveBackupRepository() {
    if (typeof BackupRepository !== 'undefined') {
      return BackupRepository;
    }
    return require('../repository/BackupRepository.js');
  }

  function resolveDuplicateService() {
    if (typeof DuplicateService !== 'undefined') {
      return DuplicateService;
    }
    return require('./DuplicateService.js');
  }

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function resolveRawDataRepository() {
    if (typeof RawDataRepository !== 'undefined') {
      return RawDataRepository;
    }
    return require('../repository/RawDataRepository.js');
  }

  function resolveRollbackService() {
    if (typeof RollbackService !== 'undefined') {
      return RollbackService;
    }
    return require('./RollbackService.js');
  }

  function resolveStageValidator() {
    if (typeof StageValidator !== 'undefined') {
      return StageValidator;
    }
    return require('../validation/StageValidator.js');
  }

  function resolveStagingRepository() {
    if (typeof StagingRepository !== 'undefined') {
      return StagingRepository;
    }
    return require('../repository/StagingRepository.js');
  }

  function resolveDatasetSheets() {
    if (typeof DatasetSheets !== 'undefined') {
      return DatasetSheets;
    }
    return require('../config/DatasetSheets.js');
  }

  function resolveScriptLock() {
    if (typeof ScriptLock !== 'undefined') {
      return ScriptLock;
    }
    return require('./ScriptLock.js');
  }

  function nowIso(clock) {
    var value = clock && typeof clock.now === 'function' ? clock.now() : new Date();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }

  function nowMs(clock) {
    var value = clock && typeof clock.now === 'function' ? clock.now() : new Date();
    return (value instanceof Date ? value : new Date(value)).getTime();
  }

  function requireServices(services) {
    if (
      !services ||
      !services.targetSpreadsheet ||
      !services.ledgerRepository ||
      typeof services.ledgerRepository.findSuccessfulByFingerprint !== 'function' ||
      typeof services.ledgerRepository.findSuccessfulByRunId !== 'function' ||
      typeof services.ledgerRepository.append !== 'function' ||
      typeof services.flush !== 'function'
    ) {
      throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
        details: { boundary: 'CommitService.createOperations' },
      });
    }
    return services;
  }

  function createOperations(services) {
    var dependencies = requireServices(services);
    var stagingRepository = resolveStagingRepository().create(
      dependencies.targetSpreadsheet,
    );
    if (typeof dependencies.decorateStagingRepository === 'function') {
      stagingRepository = dependencies.decorateStagingRepository(stagingRepository);
    }
    var rawRepository = resolveRawDataRepository().create(
      dependencies.targetSpreadsheet,
      { flush: dependencies.flush, observer: dependencies.rawObserver },
    );
    if (typeof dependencies.decorateRawRepository === 'function') {
      rawRepository = dependencies.decorateRawRepository(rawRepository);
    }
    var backupRepository = resolveBackupRepository().create(
      dependencies.targetSpreadsheet,
      {
        observer: dependencies.backupObserver,
        flush: dependencies.flush,
        session: dependencies.session,
        spreadsheetApp: dependencies.spreadsheetApp,
      },
    );
    if (typeof dependencies.decorateBackupRepository === 'function') {
      backupRepository = dependencies.decorateBackupRepository(backupRepository);
    }
    var rollbackService = resolveRollbackService().create({
      backupRepository: backupRepository,
      flush: dependencies.flush,
      ledgerRepository: dependencies.ledgerRepository,
      rawRepository: rawRepository,
    });
    var transaction = {
      commitProgress: null,
      currentPayload: null,
      currentDatasetName: null,
      datasetNames: null,
      expectedRowCounts: null,
      fingerprint: null,
      group: null,
      payloads: null,
      sourceFiles: null,
    };

    function observed(key, operation) {
      var started = nowMs(dependencies.clock);
      try {
        return operation();
      } finally {
        if (typeof dependencies.observeSubphase === 'function') {
          dependencies.observeSubphase(key, Math.max(0, nowMs(dependencies.clock) - started));
        }
      }
    }

    function requireTransaction() {
      if (
        !Array.isArray(transaction.payloads) ||
        typeof transaction.fingerprint !== 'string' ||
        !Array.isArray(transaction.sourceFiles)
      ) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.transactionState' },
        });
      }
    }

    function duplicateInput(context) {
      return {
        checkedAtUtc: nowIso(dependencies.clock),
        datasetNames: Array.isArray(transaction.datasetNames)
          ? transaction.datasetNames.slice()
          : transaction.payloads.map(function (payload) { return payload.datasetName; }),
        fingerprint: transaction.fingerprint,
        runId: context.runId,
        schemaVersion: context.request.schemaVersion,
        sourceFiles: transaction.sourceFiles,
      };
    }

    function cleanupFailedBackup(runId) {
      try {
        backupRepository.discoverGroups().filter(function (group) {
          return group.runId === runId;
        }).forEach(function (group) {
          backupRepository.deleteGroup(group);
        });
      } catch (cleanupError) {
        // A later locked run will reconcile any cleanup debt.
      }
    }

    function isCurrentSuccess(record, context) {
      return Boolean(
        record &&
        record.result === 'SUCCESS' &&
        record.fingerprint === transaction.fingerprint &&
        record.runId === context.runId
      );
    }

    function confirmSuccess(context) {
      var runLookupError = null;
      try {
        if (isCurrentSuccess(
          dependencies.ledgerRepository.findSuccessfulByRunId(context.runId),
          context,
        )) {
          return true;
        }
      } catch (error) {
        runLookupError = error;
      }

      try {
        if (isCurrentSuccess(
          dependencies.ledgerRepository.findSuccessfulByFingerprint(
            transaction.fingerprint,
          ),
          context,
        )) {
          return true;
        }
      } catch (error) {
        throw runLookupError || error;
      }

      if (runLookupError) {
        throw runLookupError;
      }
      return false;
    }

    function failAfterRollback(error, fallbackCode) {
      if (!transaction.group) {
        throw resolveErrorCodes().normalize(error, fallbackCode);
      }
      var group = transaction.group;
      var causeDetails = error && error.details && typeof error.details === 'object' ? error.details : {};
      var rollbackResult = rollbackService.rollback(group, error);
      transaction.group = null;
      throw resolveErrorCodes().create(fallbackCode, {
        cause: error,
        details: {
          backupRunId: group.runId,
          datasetName: causeDetails.datasetName || null,
          operation: causeDetails.operation || null,
          originalErrorCode: error && typeof error.code === 'string' ? error.code : null,
          reason: causeDetails.reason || null,
          rollbackStatus: rollbackResult.rollbackStatus,
        },
      });
    }

    function stage(context) {
      var validated = context.operationResults.validateSchema;
      var duplicate = context.operationResults.checkDuplicate;
      if (
        !validated ||
        !Array.isArray(validated.payloads) ||
        !duplicate ||
        typeof duplicate.fingerprint !== 'string' ||
        !Array.isArray(duplicate.sourceFiles)
      ) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.stage' },
        });
      }
      transaction.payloads = validated.payloads.slice();
      transaction.datasetNames = transaction.payloads.map(function (payload) {
        return payload.datasetName;
      });
      transaction.fingerprint = duplicate.fingerprint;
      transaction.sourceFiles = duplicate.sourceFiles.slice();
      return stagingRepository.writeAll(transaction.payloads);
    }

    function validateStage() {
      requireTransaction();
      return resolveStageValidator().validate(
        transaction.payloads,
        stagingRepository.readAll(),
      );
    }

    function resume(context, checkpointData) {
      if (
        !context || !context.request ||
        !checkpointData ||
        typeof checkpointData.fingerprint !== 'string' ||
        !checkpointData.fingerprint ||
        !Array.isArray(checkpointData.sourceFiles)
      ) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.resume' },
        });
      }
      var restored = stagingRepository.readCheckpoint({
        runId: context.runId,
        schemaVersion: context.request.schemaVersion,
      });
      var validated = resolveStageValidator().validate(
        restored.payloads,
        restored.snapshots,
      );
      transaction.payloads = restored.payloads.slice();
      transaction.datasetNames = transaction.payloads.map(function (payload) {
        return payload.datasetName;
      });
      transaction.fingerprint = checkpointData.fingerprint;
      transaction.sourceFiles = checkpointData.sourceFiles.slice();
      transaction.expectedRowCounts = checkpointData.rowCounts && typeof checkpointData.rowCounts === 'object'
        ? Object.assign({}, checkpointData.rowCounts)
        : {};
      transaction.commitProgress = checkpointData.commitProgress || null;
      if (checkpointData.backupRunId) {
        var preparedGroup = backupRepository.discoverGroups().filter(function (group) {
          return group.runId === checkpointData.backupRunId;
        })[0];
        if (!preparedGroup || !preparedGroup.complete || preparedGroup.runId !== context.runId) {
          throw resolveErrorCodes().create('MIGRATION_BACKUP_FAILED', {
            details: { reason: 'prepared_backup_group_unavailable' },
          });
        }
        transaction.group = preparedGroup;
      }
      return Object.freeze({
        datasetCount: validated.datasetCount,
        rowCounts: validated.rowCounts,
      });
    }

    function registeredDatasetNames(checkpointData) {
      var expected = resolveDatasetSheets().listBindings().map(function (binding) {
        return binding.datasetName;
      });
      if (checkpointData.datasetNames === undefined) {
        return expected;
      }
      if (!Array.isArray(checkpointData.datasetNames) ||
          checkpointData.datasetNames.length !== expected.length ||
          checkpointData.datasetNames.some(function (datasetName, index) {
            return datasetName !== expected[index];
          })) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.datasetNames' },
        });
      }
      return checkpointData.datasetNames.slice();
    }

    function restoreHostedMetadata(context, checkpointData) {
      if (
        !context || !context.request ||
        !checkpointData ||
        typeof checkpointData.fingerprint !== 'string' ||
        !checkpointData.fingerprint ||
        !Array.isArray(checkpointData.sourceFiles)
      ) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.resumeHosted' },
        });
      }
      transaction.datasetNames = registeredDatasetNames(checkpointData);
      transaction.payloads = transaction.datasetNames.map(function (datasetName) {
        return Object.freeze({ datasetName: datasetName });
      });
      transaction.fingerprint = checkpointData.fingerprint;
      transaction.sourceFiles = checkpointData.sourceFiles.slice();
      transaction.expectedRowCounts = checkpointData.rowCounts && typeof checkpointData.rowCounts === 'object'
        ? Object.assign({}, checkpointData.rowCounts)
        : {};
      transaction.commitProgress = checkpointData.commitProgress || null;
      if (checkpointData.backupRunId) {
        var preparedGroup = backupRepository.discoverGroups().filter(function (group) {
          return group.runId === checkpointData.backupRunId;
        })[0];
        if (!preparedGroup || !preparedGroup.complete || preparedGroup.runId !== context.runId) {
          throw resolveErrorCodes().create('MIGRATION_BACKUP_FAILED', {
            details: { reason: 'prepared_backup_group_unavailable' },
          });
        }
        transaction.group = preparedGroup;
      }
      return transaction.datasetNames;
    }

    function resumeBackup(context, checkpointData) {
      var datasetNames = restoreHostedMetadata(context, checkpointData);
      return Object.freeze({ datasetCount: datasetNames.length });
    }

    function resumeDataset(context, checkpointData, datasetName) {
      var datasetNames = restoreHostedMetadata(context, checkpointData);
      if (datasetNames.indexOf(datasetName) === -1) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.resumeDataset' },
        });
      }
      var rowCount = transaction.expectedRowCounts && transaction.expectedRowCounts[datasetName];
      var nativeFastPath = context.request && context.request.packagingKind === 'single_dataset';
      if (nativeFastPath && (!Number.isInteger(rowCount) || rowCount < 0)) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.resumeDataset.rowCounts' },
        });
      }
      if (!nativeFastPath) {
        var restored = stagingRepository.readDatasetCheckpoint({
          runId: context.runId,
          schemaVersion: context.request.schemaVersion,
        }, datasetName);
        var validated = resolveStageValidator().validateDatasetCheckpoint(
          restored.payload,
          restored.snapshot,
        );
        transaction.currentPayload = restored.payload;
        transaction.payloads = [restored.payload];
        transaction.currentDatasetName = datasetName;
        return Object.freeze({
          datasetName: validated.datasetName,
          rowCount: validated.rowCount,
        });
      }
      transaction.currentDatasetName = datasetName;
      transaction.currentPayload = null;
      return Object.freeze({
        datasetName: datasetName,
        rowCount: rowCount,
      });
    }

    function hydrateCurrentPayload(context, datasetName) {
      if (transaction.currentPayload && transaction.currentPayload.datasetName === datasetName) {
        return transaction.currentPayload;
      }
      var restored = stagingRepository.readDatasetCheckpoint({
        runId: context.runId,
        schemaVersion: context.request.schemaVersion,
      }, datasetName);
      var validated = resolveStageValidator().validateDatasetCheckpoint(
        restored.payload,
        restored.snapshot,
      );
      transaction.currentPayload = restored.payload;
      transaction.currentDatasetName = datasetName;
      transaction.payloads = [restored.payload];
      return Object.freeze({
        datasetName: validated.datasetName,
        rowCount: validated.rowCount,
      });
    }

    function backupStep(context) {
      requireTransaction();
      return resolveScriptLock().withLock(
        dependencies.lockService,
        dependencies.lockTimeoutMs === undefined
          ? DEFAULT_LOCK_TIMEOUT_MS
          : dependencies.lockTimeoutMs,
        dependencies.flush,
        function () {
          var groups = backupRepository.discoverGroups();
          var ownGroup = groups.filter(function (group) {
            return group.runId === context.runId;
          })[0] || null;
          var foreignGroups = groups.filter(function (group) {
            return group.runId !== context.runId;
          });
          if (!ownGroup) {
            if (typeof dependencies.beforeReconcile === 'function') {
              dependencies.beforeReconcile(Object.freeze({
                backupRepository: backupRepository,
                ledgerRepository: dependencies.ledgerRepository,
                targetSpreadsheet: dependencies.targetSpreadsheet,
              }));
            }
            rollbackService.reconcile();
          } else if (foreignGroups.length > 0) {
            throw resolveErrorCodes().create('MIGRATION_RECOVERY_FAILED', {
              details: { reason: 'foreign_backup_group_during_incremental_backup' },
            });
          }
          resolveDuplicateService().check(
            duplicateInput(context),
            dependencies.ledgerRepository,
          );
          var result = backupRepository.createGroupStep(context.runId);
          return Object.freeze({
            complete: result.complete,
            createdDatasetName: result.createdDatasetName,
            datasetCount: Object.keys(result.group.sheetsByDataset).length,
          });
        },
      );
    }

    function commit(context) {
      requireTransaction();
      if (transaction.commitProgress && transaction.commitProgress.complete === true) {
        try {
          if (!transaction.group) {
            throw resolveErrorCodes().create('MIGRATION_BACKUP_FAILED', {
              details: { reason: 'prepared_backup_group_unavailable' },
            });
          }
          backupRepository.verifyGroup(transaction.group, {
            compareDatasetNames: [],
          });
          resolveDuplicateService().check(
            duplicateInput(context),
            dependencies.ledgerRepository,
          );
          rawRepository.preflight();
          var completedRowCounts = {};
          transaction.payloads.forEach(function (payload) {
            completedRowCounts[payload.datasetName] = payload.rowCount;
          });
          return Object.freeze({
            backupRunId: transaction.group.runId,
            datasetCount: transaction.payloads.length,
            recoveryGroupsProcessed: 0,
            rowCounts: Object.freeze(completedRowCounts),
          });
        } catch (completedError) {
          failAfterRollback(completedError, 'MIGRATION_COMMIT_FAILED');
        }
      }
      var recovery = { groupsProcessed: 0 };
      if (transaction.group) {
        backupRepository.verifyGroup(transaction.group);
      } else {
        if (typeof dependencies.beforeReconcile === 'function') {
          dependencies.beforeReconcile(Object.freeze({
            backupRepository: backupRepository,
            ledgerRepository: dependencies.ledgerRepository,
            targetSpreadsheet: dependencies.targetSpreadsheet,
          }));
        }
        recovery = rollbackService.reconcile();
      }
      resolveDuplicateService().check(
        duplicateInput(context),
        dependencies.ledgerRepository,
      );
      rawRepository.preflight();
      try {
        if (!transaction.group) {
          transaction.group = backupRepository.createGroup(context.runId);
        }
        var result = rawRepository.replaceAll(
          transaction.payloads,
          { preflightVerified: true },
        );
        return Object.freeze({
          backupRunId: transaction.group.runId,
          datasetCount: result.datasetCount,
          recoveryGroupsProcessed: recovery.groupsProcessed,
          rowCounts: result.rowCounts,
        });
      } catch (error) {
        if (!transaction.group) {
          cleanupFailedBackup(context.runId);
        }
        failAfterRollback(error, 'MIGRATION_COMMIT_FAILED');
      }
    }

    function recordSuccessOnce(context) {
      if (!confirmSuccess(context)) {
        resolveDuplicateService().recordSuccessful(
          duplicateInput(context),
          dependencies.ledgerRepository,
        );
      }
      if (!confirmSuccess(context)) {
        throw new Error('The successful ledger record could not be confirmed.');
      }
    }

    function commitStep(context, progress) {
      requireTransaction();
      var nextDatasetIndex = progress && progress.nextDatasetIndex;
      if (!Number.isInteger(nextDatasetIndex) || nextDatasetIndex < 0 ||
          nextDatasetIndex >= transaction.payloads.length ||
          progress.complete === true) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.commitStep' },
        });
      }
      if (!transaction.group) {
        throw resolveErrorCodes().create('MIGRATION_BACKUP_FAILED', {
          details: { reason: 'prepared_backup_group_unavailable' },
        });
      }
      return resolveScriptLock().withLock(
        dependencies.lockService,
        dependencies.lockTimeoutMs === undefined
          ? DEFAULT_LOCK_TIMEOUT_MS
          : dependencies.lockTimeoutMs,
        dependencies.flush,
        function () {
          try {
            var rawSnapshots = rawRepository.readAll();
            var snapshotByName = Object.create(null);
            rawSnapshots.forEach(function (snapshot) {
              snapshotByName[snapshot.datasetName] = snapshot;
            });
            var remaining = transaction.payloads.slice(nextDatasetIndex);
            var unreplacedNames = remaining.filter(function (payload) {
              return !resolveStageValidator().snapshotMatchesPayload(
                snapshotByName[payload.datasetName],
                payload,
              );
            }).map(function (payload) {
              return payload.datasetName;
            });
            backupRepository.verifyGroup(transaction.group, {
              compareDatasetNames: unreplacedNames,
            });
            resolveDuplicateService().check(
              duplicateInput(context),
              dependencies.ledgerRepository,
            );
            rawRepository.preflight();
            var nextPayload = transaction.payloads[nextDatasetIndex];
            if (resolveStageValidator().snapshotMatchesPayload(
              snapshotByName[nextPayload.datasetName],
              nextPayload,
            )) {
              var skippedIndex = nextDatasetIndex + 1;
              return Object.freeze({
                complete: skippedIndex === transaction.payloads.length,
                lastCompletedDatasetName: nextPayload.datasetName,
                nextDatasetIndex: skippedIndex,
              });
            }
            var replaced = rawRepository.replaceOne(
              transaction.payloads,
              nextDatasetIndex,
              { preflightVerified: true },
            );
            var followingIndex = nextDatasetIndex + 1;
            return Object.freeze({
              complete: followingIndex === transaction.payloads.length,
              lastCompletedDatasetName: replaced.datasetName,
              nextDatasetIndex: followingIndex,
            });
          } catch (error) {
            failAfterRollback(error, 'MIGRATION_COMMIT_FAILED');
          }
        },
      );
    }

    function commitDatasetStep(context, progress) {
      requireTransaction();
      var nextDatasetIndex = progress && progress.nextDatasetIndex;
      var datasetName = transaction.datasetNames && transaction.datasetNames[nextDatasetIndex];
      if (!Number.isInteger(nextDatasetIndex) || nextDatasetIndex < 0 ||
          progress.complete === true || !datasetName) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.commitDatasetStep' },
        });
      }
      hydrateCurrentPayload(context, datasetName);
      if (!transaction.currentPayload || transaction.currentPayload.datasetName !== datasetName) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.commitDatasetStep.payload' },
        });
      }
      if (!transaction.group) {
        throw resolveErrorCodes().create('MIGRATION_BACKUP_FAILED', {
          details: { reason: 'prepared_backup_group_unavailable' },
        });
      }
      return resolveScriptLock().withLock(
        dependencies.lockService,
        dependencies.lockTimeoutMs === undefined
          ? DEFAULT_LOCK_TIMEOUT_MS
          : dependencies.lockTimeoutMs,
        dependencies.flush,
        function () {
          try {
            var rawSnapshot = rawRepository.readOne(datasetName);
            if (!resolveStageValidator().snapshotMatchesPayload(
              rawSnapshot,
              transaction.currentPayload,
            )) {
              backupRepository.verifyDataset(transaction.group, datasetName);
              resolveDuplicateService().check(
                duplicateInput(context),
                dependencies.ledgerRepository,
              );
              rawRepository.preflightOne(datasetName);
              rawRepository.replacePayload(
                transaction.currentPayload,
                { preflightVerified: true },
              );
              dependencies.flush();
              resolveStageValidator().validateDatasetCheckpoint(
                transaction.currentPayload,
                rawRepository.readOne(datasetName),
              );
            }
            var followingIndex = nextDatasetIndex + 1;
            return Object.freeze({
              complete: followingIndex === transaction.datasetNames.length,
              lastCompletedDatasetName: datasetName,
              nextDatasetIndex: followingIndex,
            });
          } catch (error) {
            failAfterRollback(error, 'MIGRATION_COMMIT_FAILED');
          }
        },
      );
    }

    function recalculate() {
      requireTransaction();
      try {
        dependencies.flush();
        return Object.freeze({ flushed: true });
      } catch (error) {
        failAfterRollback(error, 'CALCULATION_RECALCULATION_FAILED');
      }
    }

    function healthCheck(context) {
      requireTransaction();
      try {
        var health = resolveStageValidator().validate(
          transaction.payloads,
          rawRepository.readAll(),
        );
        resolveDuplicateService().recordSuccessful(
          duplicateInput(context),
          dependencies.ledgerRepository,
        );
        if (!confirmSuccess(context)) {
          throw new Error('The successful ledger record could not be confirmed.');
        }

        var cleanupStatus = 'DELETED';
        try {
          backupRepository.deleteGroup(transaction.group);
          transaction.group = null;
        } catch (cleanupError) {
          cleanupStatus = 'PENDING';
        }
        return Object.freeze({
          backupCleanupStatus: cleanupStatus,
          datasetCount: health.datasetCount,
          ledgerStatus: 'CONFIRMED',
        });
      } catch (error) {
        failAfterRollback(error, 'CALCULATION_HEALTH_CHECK_FAILED');
      }
    }

    function wrapCommitError(error, datasetName, fallbackCode) {
      var details = error && error.details && typeof error.details === 'object' ? error.details : {};
      throw resolveErrorCodes().create(fallbackCode || 'MIGRATION_COMMIT_FAILED', {
        cause: error,
        details: {
          backupRunId: transaction.group && transaction.group.runId || null,
          chunkStartRow: Number.isInteger(details.chunkStartRow) ? details.chunkStartRow : null,
          columnIndex: Number.isInteger(details.columnIndex) ? details.columnIndex : null,
          columnName: details.columnName || null,
          comparisonReason: details.comparisonReason || null,
          datasetName: details.datasetName || datasetName || null,
          intendedValueType: details.intendedValueType || null,
          operation: details.operation || null,
          originalErrorCode: error && typeof error.code === 'string' ? error.code : null,
          persistedValueType: details.persistedValueType || null,
          reason: details.reason || null,
          rowOffset: Number.isInteger(details.rowOffset) ? details.rowOffset : null,
          schemaType: details.schemaType || null,
        },
      });
    }

    function stageChunk(context, cursor) {
      var validated = context.operationResults.validateSchema;
      var duplicate = context.operationResults.checkDuplicate;
      if (
        !validated ||
        !Array.isArray(validated.payloads) ||
        !duplicate ||
        typeof duplicate.fingerprint !== 'string' ||
        !Array.isArray(duplicate.sourceFiles)
      ) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.stageChunk' },
        });
      }
      transaction.payloads = validated.payloads.slice();
      transaction.datasetNames = transaction.payloads.map(function (payload) {
        return payload.datasetName;
      });
      transaction.fingerprint = duplicate.fingerprint;
      transaction.sourceFiles = duplicate.sourceFiles.slice();
      var datasetIndex = cursor && Number.isInteger(cursor.datasetIndex) ? cursor.datasetIndex : 0;
      var datasetNames = Array.isArray(validated.datasetNames) && validated.datasetNames.length
        ? validated.datasetNames.slice()
        : transaction.payloads.map(function (candidate) { return candidate.datasetName; });
      transaction.datasetNames = datasetNames;
      if (datasetIndex >= datasetNames.length) {
        return Object.freeze({
          complete: true,
          prepareCursor: null,
        });
      }
      var datasetName = cursor && cursor.datasetName || datasetNames[datasetIndex];
      var payload = transaction.payloads.filter(function (candidate) {
        return candidate.datasetName === datasetName;
      })[0];
      if (!payload) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.stageChunkPayload' },
        });
      }
      var workUnitStartedMs = nowMs();
      var result = observed('stageWrite', function () {
        return stagingRepository.writePayloadChunk(payload, cursor);
      });
      if (result && result.cursor && result.cursor.phase === 'verify') {
        dependencies.flush();
        result = observed('stageReadback', function () {
          return stagingRepository.writePayloadChunk(payload, result.cursor);
        });
      }
      if (result.datasetComplete) {
        var nextIndex = datasetIndex + 1;
        return Object.freeze({
          complete: nextIndex >= datasetNames.length,
          datasetName: payload.datasetName,
          prepareCursor: nextIndex >= datasetNames.length ? null : Object.freeze({
            datasetIndex: nextIndex,
            datasetName: datasetNames[nextIndex],
            nextRow: 1,
            phase: 'clear',
          }),
          workUnitDurationMs: Math.max(0, nowMs() - workUnitStartedMs),
        });
      }
      return Object.freeze({
        complete: false,
        datasetName: payload.datasetName,
        prepareCursor: Object.freeze({
          chunkRows: result.cursor.chunkRows,
          columnCount: result.cursor.columnCount,
          datasetIndex: datasetIndex,
          datasetName: payload.datasetName,
          nextRow: result.cursor.nextRow,
          phase: result.cursor.phase,
        }),
        workUnitDurationMs: Math.max(0, nowMs() - workUnitStartedMs),
      });
    }

    function backupChunk(context, cursor) {
      requireTransaction();
      return resolveScriptLock().withLock(
        dependencies.lockService,
        dependencies.lockTimeoutMs === undefined
          ? DEFAULT_LOCK_TIMEOUT_MS
          : dependencies.lockTimeoutMs,
        function () {},
        function () {
          var groups = backupRepository.discoverGroups();
          var ownGroup = groups.filter(function (group) {
            return group.runId === context.runId;
          })[0] || null;
          var foreignGroups = groups.filter(function (group) {
            return group.runId !== context.runId;
          });
          if (!ownGroup) {
            if (typeof dependencies.beforeReconcile === 'function') {
              dependencies.beforeReconcile(Object.freeze({
                backupRepository: backupRepository,
                ledgerRepository: dependencies.ledgerRepository,
                targetSpreadsheet: dependencies.targetSpreadsheet,
              }));
            }
            rollbackService.reconcile();
          } else if (foreignGroups.length > 0) {
            throw resolveErrorCodes().create('MIGRATION_RECOVERY_FAILED', {
              details: { reason: 'foreign_backup_group_during_incremental_backup' },
            });
          }
          if (!ownGroup) {
            resolveDuplicateService().check(
              duplicateInput(context),
              dependencies.ledgerRepository,
            );
          }
          var names = transaction.datasetNames;
          var datasetIndex = cursor && Number.isInteger(cursor.datasetIndex)
            ? cursor.datasetIndex
            : (ownGroup ? Object.keys(ownGroup.sheetsByDataset).length : 0);
          if (datasetIndex >= names.length || ownGroup && ownGroup.complete) {
            transaction.group = ownGroup;
            return Object.freeze({ backupCursor: null, complete: true, createdDatasetName: names[names.length - 1] || null });
          }
          var result = observed('backup', function () {
            return backupRepository.createGroupStep(context.runId, ownGroup, names[datasetIndex]);
          });
          transaction.group = result.group;
          var nextIndex = datasetIndex + 1;
          return Object.freeze({
            backupCursor: result.complete ? null : Object.freeze({
              datasetIndex: nextIndex,
              datasetName: names[nextIndex],
              nextRow: 1,
              phase: 'copy',
            }),
            complete: result.complete === true,
            createdDatasetName: result.createdDatasetName,
          });
        },
      );
    }

    function commitChunk(context, progress) {
      requireTransaction();
      var nextDatasetIndex = progress && progress.nextDatasetIndex;
      var datasetName = transaction.datasetNames && transaction.datasetNames[nextDatasetIndex];
      if (!Number.isInteger(nextDatasetIndex) || nextDatasetIndex < 0 ||
          progress.complete === true || !datasetName) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.commitChunk' },
        });
      }
      var nativeStagedTransfer = context.request && context.request.packagingKind === 'single_dataset' &&
        transaction.currentDatasetName === datasetName &&
        typeof rawRepository.replaceStagedChunk === 'function';
      if (!nativeStagedTransfer && (!transaction.currentPayload ||
          transaction.currentPayload.datasetName !== datasetName)) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.commitChunk.payload' },
        });
      }
      var expectedRowCount = transaction.expectedRowCounts && transaction.expectedRowCounts[datasetName];
      if (nativeStagedTransfer && (!Number.isInteger(expectedRowCount) || expectedRowCount < 0)) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.commitChunk.rowCounts' },
        });
      }
      if (!transaction.group) {
        throw resolveErrorCodes().create('MIGRATION_BACKUP_FAILED', {
          details: { reason: 'prepared_backup_group_unavailable' },
        });
      }
      var suppliedCursor = progress.commitCursor || null;
      if (suppliedCursor && suppliedCursor.datasetName && suppliedCursor.datasetName !== datasetName) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.commitCursorDataset' },
        });
      }
      var flushRequired = false;
      return resolveScriptLock().withLock(
        dependencies.lockService,
        dependencies.lockTimeoutMs === undefined
          ? DEFAULT_LOCK_TIMEOUT_MS
          : dependencies.lockTimeoutMs,
        function () { if (flushRequired) dependencies.flush(); },
        function () {
          try {
            var cursor = suppliedCursor;
            if (!cursor || cursor.phase === 'clear') {
              resolveDuplicateService().check(
                duplicateInput(context),
                dependencies.ledgerRepository,
              );
              // Native staged transfer clears the destination and uses a
              // contents-only copy, which is itself the values-only invariant.
              // Keep the legacy formula preflight for payload writes, but do
              // not scan the destination before the optimized transfer.
              if (!nativeStagedTransfer) rawRepository.preflightOne(datasetName);
            }
            var workUnitStartedMs = nowMs();
            var nativePhase = cursor && cursor.phase || 'clear';
            var commitSubphase = nativeStagedTransfer &&
              (nativePhase === 'verify' || nativePhase === 'trim_verify')
              ? 'commitVerify'
              : 'commitWrite';
            var replaced = observed(commitSubphase, function () {
              if (nativeStagedTransfer) {
                return rawRepository.replaceStagedChunk(datasetName, cursor, expectedRowCount);
              }
              return rawRepository.replacePayloadChunk(transaction.currentPayload, cursor, { preflightVerified: true });
            });
            flushRequired = Boolean(!nativeStagedTransfer && replaced && replaced.cursor && replaced.cursor.phase === 'verify');
            if (flushRequired) {
              dependencies.flush();
              flushRequired = false;
              replaced = observed('commitVerify', function () {
                return rawRepository.replacePayloadChunk(
                  transaction.currentPayload,
                  replaced.cursor,
                  { preflightVerified: true },
                );
              });
            }
            if (replaced.datasetComplete) {
              var followingIndex = nextDatasetIndex + 1;
              return Object.freeze({
                commitCursor: null,
                complete: followingIndex === transaction.datasetNames.length,
                lastCompletedDatasetName: datasetName,
                nextDatasetIndex: followingIndex,
                rowCounts: Object.freeze((function () {
                  var counts = {};
                  counts[datasetName] = replaced.rowCount;
                  return counts;
                })()),
                workUnitDurationMs: Math.max(0, nowMs() - workUnitStartedMs),
              });
            }
            return Object.freeze({
              commitCursor: Object.freeze(Object.assign({ datasetName: datasetName }, replaced.cursor)),
              complete: false,
              lastCompletedDatasetName: datasetName,
              nextDatasetIndex: nextDatasetIndex,
              rowCounts: Object.freeze((function () {
                var counts = {};
                counts[datasetName] = replaced.rowCount;
                return counts;
              })()),
              workUnitDurationMs: Math.max(0, nowMs() - workUnitStartedMs),
            });
          } catch (error) {
            wrapCommitError(error, datasetName, 'MIGRATION_COMMIT_FAILED');
          }
        },
      );
    }

    function healthDatasetStep(context, cursor, expectedRowCounts) {
      requireTransaction();
      var names = transaction.datasetNames;
      var index = cursor && Number.isInteger(cursor.nextDatasetIndex) ? cursor.nextDatasetIndex : 0;
      if (index >= names.length) {
        return Object.freeze({
          complete: false,
          healthCursor: Object.freeze({ nextDatasetIndex: names.length, readyToFinalize: true }),
        });
      }
      var datasetName = names[index];
      var expectedRowCount = expectedRowCounts && expectedRowCounts[datasetName];
      rawRepository.inspectOne(datasetName, expectedRowCount);
      return Object.freeze({
        complete: false,
        healthCursor: Object.freeze({ nextDatasetIndex: index + 1 }),
      });
    }

    function healthFinalize(context) {
      requireTransaction();
      try {
        recordSuccessOnce(context);
        return Object.freeze({
          // The protected rollback point is retained until RunService has
          // durably persisted the terminal SUCCESS record.
          backupCleanupStatus: 'RETAINED_UNTIL_AUDIT',
          datasetCount: transaction.datasetNames.length,
          ledgerStatus: 'CONFIRMED',
        });
      } catch (error) {
        wrapCommitError(error, null, 'CALCULATION_HEALTH_CHECK_FAILED');
      }
    }

    function cleanupAfterSuccess() {
      requireTransaction();
      if (!transaction.group) {
        return Object.freeze({ backupCleanupStatus: 'DELETED' });
      }
      try {
        backupRepository.deleteGroup(transaction.group);
        transaction.group = null;
        return Object.freeze({ backupCleanupStatus: 'DELETED' });
      } catch (cleanupError) {
        // The success audit is already durable. Retaining the protected
        // backup is safe cleanup debt and must not turn success into rollback.
        return Object.freeze({ backupCleanupStatus: 'PENDING' });
      }
    }

    function rollbackChunk(context, cursor) {
      requireTransaction();
      if (!transaction.group) {
        throw resolveErrorCodes().create('MIGRATION_BACKUP_FAILED', {
          details: { reason: 'prepared_backup_group_unavailable' },
        });
      }
      var pending = context && context.pendingFailure || {};
      var cause = {
        code: pending.code || 'MIGRATION_COMMIT_FAILED',
        details: pending.details || {},
      };
      return resolveScriptLock().withLock(
        dependencies.lockService,
        dependencies.lockTimeoutMs === undefined
          ? DEFAULT_LOCK_TIMEOUT_MS
          : dependencies.lockTimeoutMs,
        function () {},
        function () {
          var result = rollbackService.rollbackStep(transaction.group, cursor, cause);
          if (result.complete) transaction.group = null;
          return result;
        },
      );
    }

    var operations = {
      backupChunk: backupChunk,
      backupStep: backupStep,
      commitChunk: commitChunk,
      commitDatasetStep: commitDatasetStep,
      commitStep: commitStep,
      stage: stage,
      stageChunk: stageChunk,
      validateStage: validateStage,
      commit: commit,
      recalculate: recalculate,
      healthCheck: healthCheck,
      healthDatasetStep: healthDatasetStep,
      healthFinalize: healthFinalize,
      cleanupAfterSuccess: cleanupAfterSuccess,
      resume: resume,
      resumeBackup: resumeBackup,
      resumeDataset: resumeDataset,
      rollbackChunk: rollbackChunk,
    };
    return Object.freeze(operations);
  }

  return Object.freeze({ createOperations: createOperations });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CommitService;
}
