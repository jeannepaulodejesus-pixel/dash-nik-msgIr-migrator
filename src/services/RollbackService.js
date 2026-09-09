var RollbackService = (function () {
  'use strict';

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function resolveCodec() {
    if (typeof SheetValueCodec !== 'undefined') {
      return SheetValueCodec;
    }
    return require('./SheetValueCodec.js');
  }

  function resolveDatasetSheets() {
    if (typeof DatasetSheets !== 'undefined') {
      return DatasetSheets;
    }
    return require('../config/DatasetSheets.js');
  }

  function originalCode(cause) {
    return cause && typeof cause.code === 'string' ? cause.code : null;
  }

  function snapshotsEqual(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    var rightByName = Object.create(null);
    right.forEach(function (snapshot) {
      rightByName[snapshot.datasetName] = snapshot;
    });
    return left.every(function (snapshot) {
      var candidate = rightByName[snapshot.datasetName];
      return candidate &&
        resolveCodec().matricesEqual(snapshot.values, candidate.values) &&
        resolveCodec().matricesEqual(snapshot.formulas, candidate.formulas);
    });
  }

  function create(services) {
    var dependencies = services || {};
    if (
      !dependencies.backupRepository ||
      typeof dependencies.backupRepository.discoverGroups !== 'function' ||
      typeof dependencies.backupRepository.readGroup !== 'function' ||
      typeof dependencies.backupRepository.deleteGroup !== 'function' ||
      !dependencies.rawRepository ||
      typeof dependencies.rawRepository.restoreGroup !== 'function' ||
      typeof dependencies.rawRepository.readAll !== 'function' ||
      !dependencies.ledgerRepository ||
      typeof dependencies.ledgerRepository.findSuccessfulByRunId !== 'function' ||
      typeof dependencies.flush !== 'function'
    ) {
      throw resolveErrorCodes().create('MIGRATION_RECOVERY_FAILED', {
        details: { reason: 'recovery_services_incomplete' },
      });
    }

    function rollback(group, cause) {
      var runId = group && typeof group.runId === 'string' ? group.runId : null;
      var causeCode = originalCode(cause);
      try {
        if (!group || group.complete !== true) {
          throw new Error('A complete backup group is required.');
        }
        dependencies.rawRepository.restoreGroup(group);
        dependencies.flush();
        var backups = dependencies.backupRepository.readGroup(group);
        if (backups.length !== 5) {
          throw new Error('The backup group does not contain five datasets.');
        }
        var restored = dependencies.rawRepository.readAll();
        if (!snapshotsEqual(backups, restored)) {
          throw new Error('Restored raw data does not match the backup group.');
        }
        dependencies.backupRepository.deleteGroup(group);
        return Object.freeze({
          backupRunId: runId,
          datasetCount: backups.length,
          originalErrorCode: causeCode,
          rollbackStatus: 'VERIFIED',
        });
      } catch (error) {
        throw resolveErrorCodes().create('MIGRATION_ROLLBACK_FAILED', {
          cause: error,
          details: {
            backupRunId: runId,
            originalErrorCode: causeCode,
            rollbackStatus: 'FAILED',
          },
        });
      }
    }

    function rollbackStep(group, cursor, cause) {
      var runId = group && typeof group.runId === 'string' ? group.runId : null;
      var causeCode = originalCode(cause);
      try {
        if (!group || !group.sheetsByDataset) {
          throw new Error('A backup group is required.');
        }
        if (typeof dependencies.rawRepository.restoreDatasetChunk !== 'function') {
          return rollback(group, cause);
        }
        var names = resolveDatasetSheets().listBindings().map(function (binding) {
          return binding.datasetName;
        });
        var datasetIndex = cursor && Number.isInteger(cursor.datasetIndex) ? cursor.datasetIndex : 0;
        if (datasetIndex >= names.length) {
          dependencies.backupRepository.deleteGroup(group);
          return Object.freeze({
            backupRunId: runId,
            complete: true,
            datasetCount: names.length,
            originalErrorCode: causeCode,
            rollbackCursor: null,
            rollbackStatus: 'VERIFIED',
          });
        }
        var datasetName = names[datasetIndex];
        var result = dependencies.rawRepository.restoreDatasetChunk(group, datasetName, cursor);
        dependencies.flush();
        if (result.datasetComplete) {
          var nextIndex = datasetIndex + 1;
          return Object.freeze({
            backupRunId: runId,
            complete: false,
            datasetName: datasetName,
            originalErrorCode: causeCode,
            rollbackCursor: Object.freeze({
              chunkRows: result.cursor && result.cursor.chunkRows,
              datasetIndex: nextIndex,
              datasetName: names[nextIndex] || null,
              nextRow: 1,
              phase: 'restore',
            }),
            rollbackStatus: 'IN_PROGRESS',
          });
        }
        return Object.freeze({
          backupRunId: runId,
          complete: false,
          datasetName: datasetName,
          originalErrorCode: causeCode,
          rollbackCursor: Object.freeze({
            chunkRows: result.cursor.chunkRows,
            datasetIndex: datasetIndex,
            datasetName: datasetName,
            columnCount: result.cursor.columnCount,
            nextRow: result.cursor.nextRow,
            phase: result.cursor.phase,
            tailEndRow: result.cursor.tailEndRow,
            trimNextRow: result.cursor.trimNextRow,
          }),
          rollbackStatus: 'IN_PROGRESS',
        });
      } catch (error) {
        if (error && error.code === 'MIGRATION_ROLLBACK_FAILED' && error.details && error.details.rollbackStatus) {
          throw error;
        }
        throw resolveErrorCodes().create('MIGRATION_ROLLBACK_FAILED', {
          cause: error,
          details: {
            backupRunId: runId,
            causeMessage: error && error.details && error.details.causeMessage || (error && error.message) || null,
            datasetName: cursor && cursor.datasetName || null,
            originalErrorCode: causeCode,
            rollbackStatus: 'FAILED',
          },
        });
      }
    }

    function reconcile() {
      try {
        var groups = dependencies.backupRepository.discoverGroups();
        var classified = groups.map(function (group) {
          return {
            group: group,
            successful: Boolean(
              dependencies.ledgerRepository.findSuccessfulByRunId(group.runId),
            ),
          };
        });
        var unfinishedComplete = classified.filter(function (entry) {
          return !entry.successful && entry.group.complete;
        });
        if (unfinishedComplete.length > 1) {
          throw resolveErrorCodes().create('MIGRATION_RECOVERY_FAILED', {
            details: {
              completeGroupCount: unfinishedComplete.length,
              reason: 'multiple_unfinished_groups',
            },
          });
        }

        var actions = [];
        classified.forEach(function (entry) {
          var action;
          if (entry.successful) {
            dependencies.backupRepository.deleteGroup(entry.group);
            action = 'DELETE_COMMITTED_BACKUP';
          } else if (!entry.group.complete) {
            dependencies.backupRepository.deleteGroup(entry.group);
            action = 'DELETE_INCOMPLETE_BACKUP';
          } else {
            rollback(entry.group, { code: 'MIGRATION_RECOVERY_FAILED' });
            action = 'RESTORE_UNFINISHED_BACKUP';
          }
          actions.push(Object.freeze({ action: action, runId: entry.group.runId }));
        });
        return Object.freeze({
          actions: Object.freeze(actions),
          groupsProcessed: classified.length,
        });
      } catch (error) {
        if (error && error.code === 'MIGRATION_RECOVERY_FAILED') {
          throw error;
        }
        throw resolveErrorCodes().create('MIGRATION_RECOVERY_FAILED', {
          cause: error,
          details: { reason: 'reconciliation_failed' },
        });
      }
    }

    return Object.freeze({ reconcile: reconcile, rollback: rollback, rollbackStep: rollbackStep });
  }

  return Object.freeze({ create: create });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RollbackService;
}
