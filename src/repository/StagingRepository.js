var StagingRepository = (function () {
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

  function rowCountSummary(entries) {
    var counts = {};
    entries.forEach(function (entry) {
      counts[entry.binding.datasetName] = entry.payload.rowCount;
    });
    return Object.freeze({ datasetCount: entries.length, rowCounts: Object.freeze(counts) });
  }

  function create(spreadsheet) {
    function requireEntries(payloads) {
      if (!spreadsheet || typeof spreadsheet.getSheetByName !== 'function') {
        throw new Error('Target spreadsheet is unavailable.');
      }
      if (!Array.isArray(payloads)) {
        throw new Error('Five normalized payloads are required.');
      }
      var payloadByName = Object.create(null);
      payloads.forEach(function (payload) {
        if (!payload || payloadByName[payload.datasetName]) {
          throw new Error('Normalized payload datasets must be unique.');
        }
        payloadByName[payload.datasetName] = payload;
      });
      var bindings = resolveDatasetSheets().listBindings();
      if (
        payloads.length !== bindings.length ||
        payloads.some(function (payload) {
          return !bindings.some(function (binding) {
            return binding.datasetName === payload.datasetName;
          });
        })
      ) {
        throw new Error('Exactly the five registered payloads are required.');
      }
      return bindings.map(function (binding) {
        var sheet = spreadsheet.getSheetByName(binding.stagingSheetName);
        if (!sheet || !payloadByName[binding.datasetName]) {
          throw new Error('A required staging sheet or payload is unavailable.');
        }
        return Object.freeze({
          binding: binding,
          payload: payloadByName[binding.datasetName],
          sheet: sheet,
        });
      });
    }

    function writeAll(payloads) {
      try {
        var entries = requireEntries(payloads);
        entries.forEach(function (entry) {
          entry.sheet.getDataRange().clearContent();
          var matrix = resolveCodec().encodePayload(entry.payload);
          entry.sheet.getRange(1, 1, matrix.length, matrix[0].length).setValues(matrix);
        });
        return rowCountSummary(entries);
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'MIGRATION_STAGE_WRITE_FAILED');
      }
    }

    function readAll() {
      try {
        var bindings = resolveDatasetSheets().listBindings();
        var sheets = bindings.map(function (binding) {
          var sheet = spreadsheet && spreadsheet.getSheetByName(binding.stagingSheetName);
          if (!sheet) {
            throw new Error('A required staging sheet is unavailable.');
          }
          return { binding: binding, sheet: sheet };
        });
        return Object.freeze(sheets.map(function (entry) {
          var range = entry.sheet.getDataRange();
          return Object.freeze({
            datasetName: entry.binding.datasetName,
            formulas: range.getFormulas(),
            sheetName: entry.binding.stagingSheetName,
            values: range.getValues(),
          });
        }));
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'MIGRATION_STAGE_WRITE_FAILED');
      }
    }

    return Object.freeze({ readAll: readAll, writeAll: writeAll });
  }

  return Object.freeze({ create: create });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StagingRepository;
}
