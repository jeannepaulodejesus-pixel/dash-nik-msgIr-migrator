(function (root, factory) {
  var errorCodes = root.ErrorCodes;
  var runLogger = root.RunLogger;
  var errorLogger = root.ErrorLogger;

  if (typeof module === 'object' && module.exports) {
    errorCodes = require('../monitoring/ErrorCodes');
    runLogger = require('../monitoring/RunLogger');
    errorLogger = require('../monitoring/ErrorLogger');
  }

  var api = factory(errorCodes, runLogger, errorLogger);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.RunRepository = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ErrorCodes, RunLogger, ErrorLogger) {
  'use strict';

  var RUN_LOG_SHEET = 'RUN_LOG';
  var ERROR_LOG_SHEET = 'ERROR_LOG';

  function resolveRuntimeDependencies() {
    var runtimeRoot = typeof globalThis !== 'undefined' ? globalThis : this;
    ErrorCodes = ErrorCodes || runtimeRoot.ErrorCodes;
    RunLogger = RunLogger || runtimeRoot.RunLogger;
    ErrorLogger = ErrorLogger || runtimeRoot.ErrorLogger;

    if (!ErrorCodes || !RunLogger || !ErrorLogger) {
      throw new Error('CXP-04 logging dependencies are unavailable.');
    }
  }

  function arraysEqual(left, right) {
    if (!left || !right || left.length !== right.length) {
      return false;
    }

    return left.every(function (value, index) {
      return value === right[index];
    });
  }

  function requireSheet(spreadsheet, sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      throw ErrorCodes.create('REPORTING_LOG_SCHEMA_MISMATCH', {
        message: 'Required logging sheet is missing.',
        details: { sheetName: sheetName }
      });
    }

    return sheet;
  }

  function ensureHeaders(sheet, sheetName, expectedHeaders) {
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders.slice()]);
      return;
    }

    var actualHeaders = sheet.getRange(1, 1, 1, expectedHeaders.length).getValues()[0];
    if (!arraysEqual(actualHeaders, expectedHeaders)) {
      throw ErrorCodes.create('REPORTING_LOG_SCHEMA_MISMATCH', {
        details: {
          actualHeaders: actualHeaders,
          expectedHeaders: expectedHeaders,
          sheetName: sheetName
        }
      });
    }
  }

  function appendRows(sheet, rows, width) {
    if (rows.length === 0) {
      return;
    }

    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, width).setValues(rows);
  }

  function existingRunIds(sheet) {
    var ids = Object.create(null);
    var dataRowCount = sheet.getLastRow() - 1;
    if (dataRowCount <= 0) {
      return ids;
    }
    sheet.getRange(2, 1, dataRowCount, 1).getValues().forEach(function (row) {
      if (row[0] !== '') {
        ids[String(row[0])] = true;
      }
    });
    return ids;
  }

  function missingRecords(records, knownIds) {
    var existingCount = 0;
    var missing = [];
    records.forEach(function (record) {
      var runId = String(record && record.runId || '');
      if (knownIds[runId]) {
        existingCount += 1;
        return;
      }
      knownIds[runId] = true;
      missing.push(record);
    });
    return { existingCount: existingCount, records: missing };
  }

  function create(spreadsheet) {
    resolveRuntimeDependencies();
    if (!spreadsheet || typeof spreadsheet.getSheetByName !== 'function') {
      throw ErrorCodes.create('REPORTING_LOG_WRITE_FAILED', {
        message: 'A control spreadsheet with getSheetByName is required.'
      });
    }

    function persist(runRecords, errorRecords) {
      var normalizedRuns = runRecords || [];
      var normalizedErrors = errorRecords || [];

      try {
        var runSheet = null;
        var errorSheet = null;

        if (normalizedRuns.length > 0) {
          runSheet = requireSheet(spreadsheet, RUN_LOG_SHEET);
          ensureHeaders(runSheet, RUN_LOG_SHEET, RunLogger.HEADERS);
        }

        if (normalizedErrors.length > 0) {
          errorSheet = requireSheet(spreadsheet, ERROR_LOG_SHEET);
          ensureHeaders(errorSheet, ERROR_LOG_SHEET, ErrorLogger.HEADERS);
        }

        if (runSheet) {
          appendRows(runSheet, RunLogger.toRows(normalizedRuns), RunLogger.HEADERS.length);
        }

        if (errorSheet) {
          appendRows(errorSheet, ErrorLogger.toRows(normalizedErrors), ErrorLogger.HEADERS.length);
        }
      } catch (error) {
        throw ErrorCodes.normalize(error, 'REPORTING_LOG_WRITE_FAILED');
      }
    }

    function persistOnce(runRecords, errorRecords) {
      var normalizedRuns = runRecords || [];
      var normalizedErrors = errorRecords || [];

      try {
        var runSheet = null;
        var errorSheet = null;
        if (normalizedRuns.length > 0) {
          runSheet = requireSheet(spreadsheet, RUN_LOG_SHEET);
          ensureHeaders(runSheet, RUN_LOG_SHEET, RunLogger.HEADERS);
        }
        if (normalizedErrors.length > 0) {
          errorSheet = requireSheet(spreadsheet, ERROR_LOG_SHEET);
          ensureHeaders(errorSheet, ERROR_LOG_SHEET, ErrorLogger.HEADERS);
        }

        var filteredRuns = runSheet
          ? missingRecords(normalizedRuns, existingRunIds(runSheet))
          : { existingCount: 0, records: [] };
        var filteredErrors = errorSheet
          ? missingRecords(normalizedErrors, existingRunIds(errorSheet))
          : { existingCount: 0, records: [] };
        if (runSheet) {
          appendRows(runSheet, RunLogger.toRows(filteredRuns.records), RunLogger.HEADERS.length);
        }
        if (errorSheet) {
          appendRows(
            errorSheet,
            ErrorLogger.toRows(filteredErrors.records),
            ErrorLogger.HEADERS.length,
          );
        }
        return Object.freeze({
          appendedErrors: filteredErrors.records.length,
          appendedRuns: filteredRuns.records.length,
          existingErrors: filteredErrors.existingCount,
          existingRuns: filteredRuns.existingCount,
        });
      } catch (error) {
        throw ErrorCodes.normalize(error, 'REPORTING_LOG_WRITE_FAILED');
      }
    }

    return Object.freeze({ persist: persist, persistOnce: persistOnce });
  }

  return Object.freeze({
    ERROR_LOG_SHEET: ERROR_LOG_SHEET,
    RUN_LOG_SHEET: RUN_LOG_SHEET,
    create: create
  });
});
