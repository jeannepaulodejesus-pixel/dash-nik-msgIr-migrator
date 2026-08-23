var FileLedgerRepository = (function () {
  'use strict';

  var SHEET_NAME = 'FILE_LEDGER';
  var HEADERS = Object.freeze([
    'Fingerprint',
    'Fingerprint Algorithm',
    'Result',
    'Run ID',
    'Original Successful Run ID',
    'Checked At UTC',
    'Schema Version',
    'Dataset Names JSON',
    'Source File IDs JSON',
    'Source File Names JSON',
  ]);

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function arraysEqual(left, right) {
    return left.length === right.length && left.every(function (value, index) {
      return value === right[index];
    });
  }

  function requireSheet(spreadsheet) {
    var sheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet) {
      throw resolveErrorCodes().create('INGESTION_FILE_LEDGER_SCHEMA_MISMATCH', {
        details: { sheetName: SHEET_NAME },
      });
    }
    return sheet;
  }

  function ensureHeaders(sheet) {
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS.slice()]);
      return;
    }
    var actual = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    if (!arraysEqual(actual, HEADERS)) {
      throw resolveErrorCodes().create('INGESTION_FILE_LEDGER_SCHEMA_MISMATCH', {
        details: { actualHeaders: actual, expectedHeaders: HEADERS, sheetName: SHEET_NAME },
      });
    }
  }

  function toRow(record) {
    return [
      record.fingerprint,
      record.fingerprintAlgorithm,
      record.result,
      record.runId,
      record.originalSuccessfulRunId || '',
      record.checkedAtUtc,
      record.schemaVersion,
      JSON.stringify(record.datasetNames || []),
      JSON.stringify(record.sourceFileIds || []),
      JSON.stringify(record.sourceFileNames || []),
    ];
  }

  function fromRow(row) {
    return Object.freeze({
      checkedAtUtc: row[5],
      datasetNames: JSON.parse(row[7] || '[]'),
      fingerprint: row[0],
      fingerprintAlgorithm: row[1],
      originalSuccessfulRunId: row[4] || null,
      result: row[2],
      runId: row[3],
      schemaVersion: row[6],
      sourceFileIds: JSON.parse(row[8] || '[]'),
      sourceFileNames: JSON.parse(row[9] || '[]'),
    });
  }

  function create(spreadsheet) {
    if (!spreadsheet || typeof spreadsheet.getSheetByName !== 'function') {
      throw resolveErrorCodes().create('INGESTION_FILE_LEDGER_UNAVAILABLE', {
        details: { reason: 'control_spreadsheet_unavailable' },
      });
    }
    var sheet = requireSheet(spreadsheet);

    function append(records) {
      var entries = records || [];
      if (entries.length === 0) {
        return;
      }
      try {
        ensureHeaders(sheet);
        var rows = entries.map(toRow);
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'INGESTION_FILE_LEDGER_WRITE_FAILED');
      }
    }

    function findSuccessfulByFingerprint(fingerprint) {
      try {
        ensureHeaders(sheet);
        var lastRow = sheet.getLastRow();
        if (lastRow < 2) {
          return null;
        }
        var rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
        for (var index = rows.length - 1; index >= 0; index -= 1) {
          if (rows[index][0] === fingerprint && rows[index][2] === 'SUCCESS') {
            return fromRow(rows[index]);
          }
        }
        return null;
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'INGESTION_FILE_LEDGER_READ_FAILED');
      }
    }

    function findSuccessfulByRunId(runId) {
      try {
        ensureHeaders(sheet);
        var lastRow = sheet.getLastRow();
        if (lastRow < 2) {
          return null;
        }
        var rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
        for (var index = rows.length - 1; index >= 0; index -= 1) {
          if (rows[index][3] === runId && rows[index][2] === 'SUCCESS') {
            return fromRow(rows[index]);
          }
        }
        return null;
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'INGESTION_FILE_LEDGER_READ_FAILED');
      }
    }

    return Object.freeze({
      append: append,
      findSuccessfulByFingerprint: findSuccessfulByFingerprint,
      findSuccessfulByRunId: findSuccessfulByRunId,
    });
  }

  return Object.freeze({
    HEADERS: HEADERS,
    SHEET_NAME: SHEET_NAME,
    create: create,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FileLedgerRepository;
}
