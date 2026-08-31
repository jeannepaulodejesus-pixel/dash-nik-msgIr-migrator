/**
 * Final PARITY_RESULTS write contract (CXP-11).
 *
 * Chunk appends are retry-safe: if execution stops after a write but before the
 * run cursor advances, the repeated chunk ID is detected and not appended twice.
 */
var ParityResultsRepository = (function () {
  'use strict';

  var SHEET_NAME = 'PARITY_RESULTS';
  var HEADERS = Object.freeze([
    'Run ID',
    'Comparison ID',
    'Chunk ID',
    'Phase',
    'Dataset',
    'Metric Name',
    'Business Date',
    'Interval Start',
    'Site',
    'Queue Or LOB',
    'Aggregation Identity',
    'Source Value',
    'Target Value',
    'Delta',
    'Tolerance',
    'Lineage JSON',
    'Classification',
    'Resolution Status',
    'Compared At UTC',
  ]);
  var RUN_ID_COLUMN = 1;
  var CHUNK_ID_COLUMN = 3;
  var CLASSIFICATION_COLUMN = 17;

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

  function toRow(comparison) {
    return [
      comparison.runId,
      comparison.comparisonId,
      comparison.chunkId,
      comparison.phase,
      comparison.dataset,
      comparison.metricName,
      comparison.businessDate,
      comparison.intervalStart,
      comparison.site,
      comparison.queueOrLob,
      comparison.aggregationIdentity,
      comparison.sourceValue,
      comparison.targetValue,
      comparison.delta,
      comparison.tolerance,
      comparison.lineage,
      comparison.classification,
      comparison.resolutionStatus,
      comparison.comparedAtUtc,
    ];
  }

  function create(spreadsheet) {
    if (!spreadsheet || typeof spreadsheet.getSheetByName !== 'function') {
      throw resolveErrorCodes().create('PARITY_RESULTS_UNAVAILABLE', {
        details: { reason: 'control_spreadsheet_unavailable' },
      });
    }

    function requireSheet() {
      var sheet = spreadsheet.getSheetByName(SHEET_NAME);
      if (!sheet) {
        throw resolveErrorCodes().create('PARITY_RESULTS_SCHEMA_MISMATCH', {
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
        throw resolveErrorCodes().create('PARITY_RESULTS_SCHEMA_MISMATCH', {
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

    function readColumns(sheet, columns) {
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) {
        return [];
      }
      return sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues().map(function (row) {
        return columns.map(function (column) {
          return row[column - 1];
        });
      });
    }

    function listChunkIds(runId) {
      try {
        var sheet = ensureHeaders();
        var seen = Object.create(null);
        readColumns(sheet, [RUN_ID_COLUMN, CHUNK_ID_COLUMN]).forEach(function (row) {
          if (row[0] === runId && row[1] !== '') {
            seen[row[1]] = true;
          }
        });
        return Object.keys(seen);
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'PARITY_RESULTS_READ_FAILED');
      }
    }

    function hasChunk(runId, chunkId) {
      return listChunkIds(runId).indexOf(chunkId) >= 0;
    }


    /**
     * Appends one comparison chunk. Returns `{ appended: false }` when the chunk
     * ID already exists for the run so replayed continuations stay idempotent.
     */
    function appendChunk(runId, chunkId, comparisons) {
      try {
        var sheet = ensureHeaders();
        if (hasChunk(runId, chunkId)) {
          return Object.freeze({
            appended: false,
            chunkId: chunkId,
            rowCount: 0,
          });
        }
        var rows = (comparisons || []).map(toRow);
        if (rows.length === 0) {
          return Object.freeze({ appended: false, chunkId: chunkId, rowCount: 0 });
        }
        sheet
          .getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length)
          .setValues(rows);
        return Object.freeze({
          appended: true,
          chunkId: chunkId,
          rowCount: rows.length,
        });
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'PARITY_RESULTS_WRITE_FAILED');
      }
    }

    function summarizeRun(runId) {
      try {
        var sheet = ensureHeaders();
        var byClassification = Object.create(null);
        var comparisonCount = 0;
        readColumns(sheet, [RUN_ID_COLUMN, CLASSIFICATION_COLUMN]).forEach(function (row) {
          if (row[0] !== runId) {
            return;
          }
          comparisonCount += 1;
          byClassification[row[1]] = (byClassification[row[1]] || 0) + 1;
        });
        return Object.freeze({
          byClassification: Object.freeze(byClassification),
          comparisonCount: comparisonCount,
          runId: runId,
        });
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'PARITY_RESULTS_READ_FAILED');
      }
    }

    return Object.freeze({
      appendChunk: appendChunk,
      ensureHeaders: ensureHeaders,
      hasChunk: hasChunk,
      installHeaders: installHeaders,
      listChunkIds: listChunkIds,
      summarizeRun: summarizeRun,
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
  module.exports = ParityResultsRepository;
}
