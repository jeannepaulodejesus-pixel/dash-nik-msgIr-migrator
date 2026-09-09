/** Durable bounded work-unit windows. Persists cursors only, never source rows. */
var WorkChunks = (function () {
  'use strict';

  var DEFAULT_CHUNK_ROWS = 5000;
  var MAX_CHUNK_ROWS = 5000;
  var MIN_CHUNK_ROWS = 250;
  var MAX_CHUNK_CELLS = 200000;
  var TARGET_STEP_MS = 45000;
  var FAST_STEP_MS = 20000;
  var SLOW_STEP_MS = 75000;

  function adaptiveRows(currentRows, measuredMs, columnCount) {
    var current = Number.isInteger(currentRows) && currentRows > 0 ? currentRows : DEFAULT_CHUNK_ROWS;
    // Preserve the predecessor two-argument contract; production cursors supply
    // columnCount and use the CXP14 cell-bounded target-duration policy below.
    if (!Number.isInteger(columnCount) || columnCount < 1) {
      if (!Number.isFinite(measuredMs) || measuredMs <= 0) return current;
      if (measuredMs < FAST_STEP_MS) return Math.min(4000, current * 2);
      if (measuredMs > SLOW_STEP_MS) return Math.max(500, Math.floor(current / 2));
      return current;
    }
    // The cell ceiling is a hard safety bound. The normal row floor applies
    // only while it still fits within that ceiling.
    var cellBound = Math.max(1, Math.min(MAX_CHUNK_ROWS, Math.floor(MAX_CHUNK_CELLS / columnCount)));
    // Hosted preparation time includes Drive acquisition and XLSX conversion.
    // Do not let those fixed costs shrink otherwise safe Sheets work units.
    return cellBound;
  }

  function windowFor(totalRows, startRow, chunkRows) {
    var size = Number.isInteger(chunkRows) && chunkRows > 0 ? chunkRows : DEFAULT_CHUNK_ROWS;
    var start = Number.isInteger(startRow) && startRow > 0 ? startRow : 1;
    var total = Number.isInteger(totalRows) && totalRows > 0 ? totalRows : 0;
    if (start > total) {
      return Object.freeze({
        complete: true,
        nextStartRow: start,
        rowCount: 0,
        startRow: start,
        totalRows: total,
      });
    }
    var height = Math.min(size, total - start + 1);
    var next = start + height;
    return Object.freeze({
      complete: next > total,
      nextStartRow: next,
      rowCount: height,
      startRow: start,
      totalRows: total,
    });
  }

  function sliceMatrix(matrix, startRow, rowCount) {
    if (!Array.isArray(matrix) || rowCount <= 0) return [];
    var from = startRow - 1;
    return matrix.slice(from, from + rowCount);
  }

  return Object.freeze({
    DEFAULT_CHUNK_ROWS: DEFAULT_CHUNK_ROWS,
    FAST_STEP_MS: FAST_STEP_MS,
    MAX_CHUNK_ROWS: MAX_CHUNK_ROWS,
    MAX_CHUNK_CELLS: MAX_CHUNK_CELLS,
    MIN_CHUNK_ROWS: MIN_CHUNK_ROWS,
    SLOW_STEP_MS: SLOW_STEP_MS,
    TARGET_STEP_MS: TARGET_STEP_MS,
    adaptiveRows: adaptiveRows,
    sliceMatrix: sliceMatrix,
    windowFor: windowFor,
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = WorkChunks;
