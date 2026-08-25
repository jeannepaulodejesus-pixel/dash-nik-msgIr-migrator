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
      { observer: dependencies.rawObserver },
    );
    if (typeof dependencies.decorateRawRepository === 'function') {
      rawRepository = dependencies.decorateRawRepository(rawRepository);
    }
    var backupRepository = resolveBackupRepository().create(
      dependencies.targetSpreadsheet,
      {
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
      datasetNames: null,
      fingerprint: null,
      group: null,
      payloads: null,
      sourceFiles: null,
    };

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
      var rollbackResult = rollbackService.rollback(group, error);
      transaction.group = null;
      throw resolveErrorCodes().create(fallbackCode, {
        cause: error,
        details: {
          backupRunId: group.runId,
          originalErrorCode: error && typeof error.code === 'string' ? error.code : null,
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
          progress.complete === true || !datasetName || !transaction.currentPayload ||
          transaction.currentPayload.datasetName !== datasetName) {
        throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
          details: { boundary: 'CommitService.commitDatasetStep' },
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

    return Object.freeze({
      backupStep: backupStep,
      commitDatasetStep: commitDatasetStep,
      commitStep: commitStep,
      stage: stage,
      validateStage: validateStage,
      commit: commit,
      recalculate: recalculate,
      healthCheck: healthCheck,
      resume: resume,
      resumeBackup: resumeBackup,
      resumeDataset: resumeDataset,
    });
  }

  return Object.freeze({ createOperations: createOperations });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CommitService;
}
