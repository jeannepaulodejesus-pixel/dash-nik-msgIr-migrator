/**
 * Final SOURCE_ERROR_BASELINE write contract (CXP-11).
 *
 * Installation is idempotent: reinstalling rewrites the same bounded WB0817
 * rule set rather than appending duplicates.
 */
var SourceErrorBaselineRepository = (function () {
  'use strict';

  var SHEET_NAME = 'SOURCE_ERROR_BASELINE';
  var HEADERS = Object.freeze([
    'Baseline Version',
    'Control Workbook SHA-256',
    'Worksheet Name',
    'Reference Kind',
    'Cell Or Range',
    'Formula Family',
    'Error Type',
    'Expected Count',
    'Classification',
    'Treatment',
    'Evidence',
    'Resolution Status',
  ]);

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function resolveBaseline() {
    if (typeof SourceErrorBaseline !== 'undefined') {
      return SourceErrorBaseline;
    }
    return require('../parity/SourceErrorBaseline.js');
  }

  function arraysEqual(left, right) {
    return left.length === right.length && left.every(function (value, index) {
      return value === right[index];
    });
  }

  function toRow(record) {
    return [
      record.baselineVersion,
      record.controlWorkbookSha256,
      record.worksheet,
      record.referenceKind,
      record.cellOrRange,
      record.formulaFamily,
      record.errorType,
      record.expectedCount,
      record.classification,
      record.treatment,
      record.evidence,
      record.resolutionStatus,
    ];
  }

  function fromRow(row) {
    return Object.freeze({
      baselineVersion: row[0],
      cellOrRange: row[4],
      classification: row[8],
      controlWorkbookSha256: row[1],
      errorType: row[6],
      evidence: row[10],
      expectedCount: Number(row[7]),
      formulaFamily: row[5],
      referenceKind: row[3],
      resolutionStatus: row[11],
      worksheet: row[2],
    });
  }

  function create(spreadsheet) {
    if (!spreadsheet || typeof spreadsheet.getSheetByName !== 'function') {
      throw resolveErrorCodes().create('PARITY_BASELINE_UNAVAILABLE', {
        details: { reason: 'control_spreadsheet_unavailable' },
      });
    }

    function requireSheet() {
      var sheet = spreadsheet.getSheetByName(SHEET_NAME);
      if (!sheet) {
        throw resolveErrorCodes().create('PARITY_BASELINE_SCHEMA_MISMATCH', {
          details: { sheetName: SHEET_NAME },
        });
      }
      return sheet;
    }

    function ensureHeaders() {
      var sheet = requireSheet();
      if (sheet.getLastRow() === 0) {
        sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS.slice()]);
        return sheet;
      }
      var actual = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
      if (!arraysEqual(actual, HEADERS)) {
        throw resolveErrorCodes().create('PARITY_BASELINE_SCHEMA_MISMATCH', {
          details: {
            actualHeaders: actual,
            expectedHeaders: HEADERS,
            sheetName: SHEET_NAME,
          },
        });
      }
      return sheet;
    }

    function installHeaders(options) {
      var sheet = requireSheet();
      var overwrite = options && options.overwrite === true;
      if (sheet.getLastRow() === 0 || overwrite) {
        sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS.slice()]);
        return Object.freeze({ installed: true, sheetName: SHEET_NAME });
      }
      ensureHeaders();
      return Object.freeze({ installed: false, sheetName: SHEET_NAME });
    }

    function read() {
      try {
        var sheet = ensureHeaders();
        var lastRow = sheet.getLastRow();
        if (lastRow < 2) {
          return Object.freeze([]);
        }
        return Object.freeze(
          sheet
            .getRange(2, 1, lastRow - 1, HEADERS.length)
            .getValues()
            .filter(function (row) { return String(row[0]).trim() !== ''; })
            .map(fromRow),
        );
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'PARITY_BASELINE_READ_FAILED');
      }
    }

    function install(records) {
      try {
        var sheet = ensureHeaders();
        var rows = (records || resolveBaseline().listRecords()).map(toRow);
        var lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          sheet.getRange(2, 1, lastRow - 1, HEADERS.length).clearContent();
        }
        if (rows.length > 0) {
          sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
        }
        return Object.freeze({ rowCount: rows.length, sheetName: SHEET_NAME });
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'PARITY_BASELINE_WRITE_FAILED');
      }
    }

    /** Fails closed unless installed rows equal the WB0817 authority. */
    function verifyInstalled() {
      var records = read();
      if (records.length === 0) {
        throw resolveErrorCodes().create('PARITY_BASELINE_NOT_INSTALLED', {
          details: { sheetName: SHEET_NAME },
        });
      }
      var verification = resolveBaseline().verify(records);
      if (!verification.pass) {
        throw resolveErrorCodes().create('PARITY_BASELINE_COUNT_MISMATCH', {
          details: {
            actualByType: verification.actualByType,
            actualTotal: verification.actualTotal,
            expectedTotal: verification.expectedTotal,
          },
        });
      }
      return Object.freeze({
        recordCount: records.length,
        verification: verification,
      });
    }

    return Object.freeze({
      ensureHeaders: ensureHeaders,
      install: install,
      installHeaders: installHeaders,
      read: read,
      verifyInstalled: verifyInstalled,
    });
  }

  return Object.freeze({
    HEADERS: HEADERS,
    SHEET_NAME: SHEET_NAME,
    create: create,
    toRow: toRow,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SourceErrorBaselineRepository;
}
