var Cxp06FaultInjector = (function () {
  'use strict';

  function create(faultKind) {
    var replacementCount = 0;
    var restoreWriteCount = 0;
    var healthCorrupted = false;
    var rollbackVerifyCorrupted = false;
    var invalidStageCorrupted = false;

    var rawObserver = Object.freeze({
      afterReplacement: function (info) {
        var index = (info && info.index !== undefined) ? info.index : replacementCount++;
        if (faultKind === 'AFTER_SECOND_RAW_REPLACEMENT' && index === 1) {
          throw new Error('UAT_AFTER_SECOND_RAW_REPLACEMENT: synthetic failure after second raw replacement');
        }
        if ((faultKind === 'ROLLBACK_WRITE_FAILURE' || faultKind === 'ROLLBACK_VERIFY_FAILURE') && index === 1) {
          throw new Error('UAT_ROLLBACK_TRIGGER: synthetic commit failure to trigger rollback');
        }
      },
      afterRestoreWrite: function (info) {
        var index = (info && info.index !== undefined) ? info.index : restoreWriteCount++;
        if (faultKind === 'ROLLBACK_WRITE_FAILURE') {
          throw new Error('UAT_ROLLBACK_WRITE_FAILURE: synthetic failure during restore write');
        }
      },
    });

    function wrapRawRepository(rawRepo) {
      if (!rawRepo) {
        return rawRepo;
      }

      return Object.assign({}, rawRepo, {
        replaceAll: function (payloads) {
          if (faultKind === 'AFTER_SECOND_RAW_REPLACEMENT') {
            rawObserver.afterReplacement({ index: 0 });
            rawObserver.afterReplacement({ index: 1 });
          }
          if (faultKind === 'ROLLBACK_WRITE_FAILURE' || faultKind === 'ROLLBACK_VERIFY_FAILURE') {
            rawRepo.replaceAll(payloads);
            rawObserver.afterReplacement({ index: 1 });
          }
          var result = rawRepo.replaceAll(payloads);
          if (faultKind === 'HEALTH_MISMATCH') {
            healthCorrupted = true;
          }
          if (faultKind === 'READER_VISIBILITY') {
            if (typeof Utilities !== 'undefined' && typeof Utilities.sleep === 'function') {
              Utilities.sleep(1000);
            }
          }
          return result;
        },
        restoreAll: function (snapshots) {
          if (faultKind === 'ROLLBACK_WRITE_FAILURE') {
            rawObserver.afterRestoreWrite({ index: 0 });
          }
          var result = rawRepo.restoreAll(snapshots);
          if (faultKind === 'ROLLBACK_VERIFY_FAILURE') {
            rollbackVerifyCorrupted = true;
          }
          return result;
        },
        readAll: function () {
          var reads = rawRepo.readAll();
          if (healthCorrupted || rollbackVerifyCorrupted) {
            return reads.map(function (read, index) {
              if (index === 0) {
                var newValues = read.values.map(function (row) { return row.slice(); });
                if (newValues.length > 0 && newValues[0].length > 0) {
                  newValues[0][0] = 'corrupted-uat-mismatch';
                }
                return Object.assign({}, read, { values: newValues });
              }
              return read;
            });
          }
          return reads;
        },
      });
    }

    function wrapBackupRepository(backupRepo) {
      if (!backupRepo) {
        return backupRepo;
      }

      return Object.assign({}, backupRepo, {
        deleteGroup: function (group) {
          if (faultKind === 'BACKUP_CLEANUP_FAILURE') {
            throw new Error('UAT_BACKUP_CLEANUP_FAILURE: synthetic backup deletion failure after success confirmation');
          }
          return backupRepo.deleteGroup(group);
        },
      });
    }

    function wrapStagingRepository(stagingRepo) {
      if (!stagingRepo) {
        return stagingRepo;
      }

      return Object.assign({}, stagingRepo, {
        writeAll: function (payloads) {
          var result = stagingRepo.writeAll(payloads);
          if (faultKind === 'INVALID_STAGE') {
            invalidStageCorrupted = true;
          }
          return result;
        },
        readAll: function () {
          var reads = stagingRepo.readAll();
          if (invalidStageCorrupted) {
            return reads.map(function (read, index) {
              if (index === 0) {
                var newFormulas = read.formulas.map(function (row) { return row.slice(); });
                if (newFormulas.length > 0 && newFormulas[0].length > 0) {
                  newFormulas[0][0] = '=1+1';
                }
                return Object.assign({}, read, { formulas: newFormulas });
              }
              return read;
            });
          }
          return reads;
        },
      });
    }

    return Object.freeze({
      faultKind: faultKind,
      rawObserver: rawObserver,
      wrapBackupRepository: wrapBackupRepository,
      wrapRawRepository: wrapRawRepository,
      wrapStagingRepository: wrapStagingRepository,
    });
  }

  return Object.freeze({
    create: create,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp06FaultInjector;
}
