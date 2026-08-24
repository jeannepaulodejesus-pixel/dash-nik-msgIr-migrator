var RawDataRepository = (function () {
  'use strict';

  function resolveDatasetSheets() {
    if (typeof DatasetSheets !== 'undefined') {
      return DatasetSheets;
    }
    return require('../config/DatasetSheets.js');
  }

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
    return require('../services/SheetValueCodec.js');
  }

  function containsFormula(formulas) {
    return formulas.some(function (row) {
      return row.some(function (formula) {
        return typeof formula === 'string' && formula.length > 0;
      });
    });
  }

  function create(spreadsheet, options) {
    var observer = options && options.observer ? options.observer : {};
    function rawEntries() {
      if (!spreadsheet || typeof spreadsheet.getSheetByName !== 'function') {
        throw new Error('Target spreadsheet is unavailable.');
      }
      return resolveDatasetSheets().listBindings().map(function (binding) {
        var sheet = spreadsheet.getSheetByName(binding.rawSheetName);
        if (!sheet) {
          throw new Error('A required raw sheet is unavailable.');
        }
        return { binding: binding, sheet: sheet };
      });
    }

    function payloadEntries(payloads) {
      if (!Array.isArray(payloads)) {
        throw new Error('Five normalized payloads are required.');
      }
      var byName = Object.create(null);
      payloads.forEach(function (payload) {
        if (!payload || byName[payload.datasetName]) {
          throw new Error('Normalized payload datasets must be unique.');
        }
        byName[payload.datasetName] = payload;
      });
      var entries = rawEntries();
      if (
        payloads.length !== entries.length ||
        entries.some(function (entry) { return !byName[entry.binding.datasetName]; })
      ) {
        throw new Error('Exactly the five registered payloads are required.');
      }
      return entries.map(function (entry) {
        entry.payload = byName[entry.binding.datasetName];
        return entry;
      });
    }

    function snapshotEntries(snapshots) {
      if (!Array.isArray(snapshots)) {
        throw new Error('Five backup snapshots are required.');
      }
      var byName = Object.create(null);
      snapshots.forEach(function (snapshot) {
        if (!snapshot || byName[snapshot.datasetName]) {
          throw new Error('Backup snapshot datasets must be unique.');
        }
        byName[snapshot.datasetName] = snapshot;
      });
      var entries = rawEntries();
      if (
        snapshots.length !== entries.length ||
        entries.some(function (entry) { return !byName[entry.binding.datasetName]; })
      ) {
        throw new Error('Exactly five registered backup snapshots are required.');
      }
      return entries.map(function (entry) {
        entry.snapshot = byName[entry.binding.datasetName];
        return entry;
      });
    }

    function groupEntries(group) {
      if (!group || group.complete !== true || !group.sheetsByDataset) {
        throw new Error('A complete backup group is required.');
      }
      return rawEntries().map(function (entry) {
        var reference = group.sheetsByDataset[entry.binding.datasetName];
        var backupSheet = reference && spreadsheet.getSheetByName(reference.sheetName);
        if (!backupSheet) {
          throw new Error('A required backup sheet is unavailable.');
        }
        entry.backupSheet = backupSheet;
        return entry;
      });
    }

    function preflight() {
      try {
        var entries = rawEntries();
        entries.forEach(function (entry) {
          if (containsFormula(entry.sheet.getDataRange().getFormulas())) {
            throw resolveErrorCodes().create('MIGRATION_COMMIT_FAILED', {
              details: {
                datasetName: entry.binding.datasetName,
                reason: 'raw_formulas_not_allowed',
              },
            });
          }
        });
        return Object.freeze({ datasetCount: entries.length, valuesOnly: true });
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'MIGRATION_COMMIT_FAILED');
      }
    }

    function replaceAll(payloads, options) {
      try {
        if (!options || options.preflightVerified !== true) {
          preflight();
        }
        var entries = payloadEntries(payloads);
        var rowCounts = {};
        entries.forEach(function (entry, index) {
          var matrix = resolveCodec().encodePayload(entry.payload);
          entry.sheet.getDataRange().clearContent();
          entry.sheet.getRange(1, 1, matrix.length, matrix[0].length).setValues(matrix);
          if (typeof observer.afterReplacement === 'function') {
            observer.afterReplacement({
              datasetName: entry.binding.datasetName,
              index: index,
            });
          }
          rowCounts[entry.binding.datasetName] = entry.payload.rowCount;
        });
        return Object.freeze({ datasetCount: entries.length, rowCounts: Object.freeze(rowCounts) });
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'MIGRATION_COMMIT_FAILED');
      }
    }

    function restoreAll(snapshots) {
      var entries = snapshotEntries(snapshots);
      entries.forEach(function (entry, index) {
        var values = entry.snapshot.values;
        if (!Array.isArray(values) || values.length === 0 || values[0].length === 0) {
          throw new Error('Backup snapshot matrix is unavailable.');
        }
        entry.sheet.getDataRange().clearContent();
        entry.sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
        if (typeof observer.afterRestoreWrite === 'function') {
          observer.afterRestoreWrite({
            datasetName: entry.binding.datasetName,
            index: index,
          });
        }
      });
      return Object.freeze({ datasetCount: entries.length });
    }

    function restoreGroup(group) {
      var entries = groupEntries(group);
      entries.forEach(function (entry, index) {
        var sourceRange = entry.backupSheet.getDataRange();
        entry.sheet.getDataRange().clearContent();
        sourceRange.copyTo(
          entry.sheet.getRange(
            1,
            1,
            sourceRange.getNumRows(),
            sourceRange.getNumColumns(),
          ),
          { contentsOnly: true },
        );
        if (typeof observer.afterRestoreWrite === 'function') {
          observer.afterRestoreWrite({
            datasetName: entry.binding.datasetName,
            index: index,
          });
        }
      });
      return Object.freeze({ datasetCount: entries.length });
    }

    function readAll() {
      return Object.freeze(rawEntries().map(function (entry) {
        var range = entry.sheet.getDataRange();
        return Object.freeze({
          datasetName: entry.binding.datasetName,
          formulas: range.getFormulas(),
          sheetName: entry.binding.rawSheetName,
          values: range.getValues(),
        });
      }));
    }

    return Object.freeze({
      preflight: preflight,
      readAll: readAll,
      replaceAll: replaceAll,
      restoreAll: restoreAll,
      restoreGroup: restoreGroup,
    });
  }

  return Object.freeze({ create: create });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RawDataRepository;
}
