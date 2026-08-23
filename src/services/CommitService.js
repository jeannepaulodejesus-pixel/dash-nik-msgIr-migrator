var CommitService = (function () {
  'use strict';

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
    var rawRepository = resolveRawDataRepository().create(
      dependencies.targetSpreadsheet,
    );
    var backupRepository = resolveBackupRepository().create(
      dependencies.targetSpreadsheet,
      {
        session: dependencies.session,
        spreadsheetApp: dependencies.spreadsheetApp,
      },
    );
    var rollbackService = resolveRollbackService().create({
      backupRepository: backupRepository,
      flush: dependencies.flush,
      ledgerRepository: dependencies.ledgerRepository,
      rawRepository: rawRepository,
    });
    var transaction = {
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
        datasetNames: transaction.payloads.map(function (payload) {
          return payload.datasetName;
        }),
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

    function commit(context) {
      requireTransaction();
      var recovery = rollbackService.reconcile();
      resolveDuplicateService().check(
        duplicateInput(context),
        dependencies.ledgerRepository,
      );
      rawRepository.preflight();
      try {
        transaction.group = backupRepository.createGroup(context.runId);
        var result = rawRepository.replaceAll(transaction.payloads);
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
      stage: stage,
      validateStage: validateStage,
      commit: commit,
      recalculate: recalculate,
      healthCheck: healthCheck,
    });
  }

  return Object.freeze({ createOperations: createOperations });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CommitService;
}
