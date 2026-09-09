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

 function resolveChunks() {
    if (typeof WorkChunks !== 'undefined') {
      return WorkChunks;
    }
    return require('../ingestion/WorkChunks.js');
  }

  function resolveSchemaRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return require('../ingestion/SchemaRegistry.js');
  }

  function containsFormula(formulas) {
    return formulas.some(function (row) {
      return row.some(function (formula) {
        return typeof formula === 'string' && formula.length > 0;
      });
    });
  }

  function matrixIsBlank(matrix) {
    return Array.isArray(matrix) && matrix.every(function (row) {
      return Array.isArray(row) && row.every(function (value) { return value === '' || value === null; });
    });
  }

  function formulaSentinel(sheet, rowCount, columnCount) {
    var rows = [1];
    if (rowCount > 1) rows.push(2);
    if (rowCount > 2) rows.push(rowCount);
    var seen = Object.create(null);
    return rows.filter(function (sentinelRow) {
      if (seen[sentinelRow]) return false;
      seen[sentinelRow] = true;
      return true;
    }).reduce(function (sentinel, sentinelRow) {
      return sentinel.concat(sheet.getRange(sentinelRow, 1, 1, columnCount).getFormulas());
    }, []);
  }

  function create(spreadsheet, options) {
    var dependencies = options || {};
    var observer = dependencies.observer || {};
    var encodedByDataset = Object.create(null);
    function bindingForDataset(datasetName) {
      var binding = resolveDatasetSheets().listBindings().filter(function (candidate) {
        return candidate.datasetName === datasetName;
      })[0];
      if (!binding) {
        throw new Error('A registered raw dataset is required.');
      }
      return binding;
    }

    function rawEntry(binding) {
      if (!spreadsheet || typeof spreadsheet.getSheetByName !== 'function') {
        throw new Error('Target spreadsheet is unavailable.');
      }
      var sheet = spreadsheet.getSheetByName(binding.rawSheetName);
      if (!sheet) {
        throw new Error('A required raw sheet is unavailable.');
      }
      return { binding: binding, sheet: sheet };
    }

    function rawEntries() {
      return resolveDatasetSheets().listBindings().map(function (binding) {
        return rawEntry(binding);
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

    function preflightOne(datasetName) {
      try {
        var entry = rawEntry(bindingForDataset(datasetName));
        if (containsFormula(entry.sheet.getDataRange().getFormulas())) {
          throw resolveErrorCodes().create('MIGRATION_COMMIT_FAILED', {
            details: {
              datasetName: datasetName,
              reason: 'raw_formulas_not_allowed',
            },
          });
        }
        return Object.freeze({ datasetName: datasetName, valuesOnly: true });
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

    function replaceOne(payloads, datasetIndex, options) {
      try {
        if (!Number.isInteger(datasetIndex) || datasetIndex < 0) {
          throw new Error('A non-negative raw dataset index is required.');
        }
        if (!options || options.preflightVerified !== true) {
          preflight();
        }
        var entries = payloadEntries(payloads);
        if (datasetIndex >= entries.length) {
          throw new Error('The raw dataset index is outside the registered transaction.');
        }
        var entry = entries[datasetIndex];
        var matrix = resolveCodec().encodePayload(entry.payload);
        entry.sheet.getDataRange().clearContent();
        entry.sheet.getRange(1, 1, matrix.length, matrix[0].length).setValues(matrix);
        if (typeof observer.afterReplacement === 'function') {
          observer.afterReplacement({
            datasetName: entry.binding.datasetName,
            index: datasetIndex,
          });
        }
        return Object.freeze({
          datasetName: entry.binding.datasetName,
          rowCount: entry.payload.rowCount,
        });
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'MIGRATION_COMMIT_FAILED');
      }
    }

    function notify(name, payload) {
      if (observer && typeof observer[name] === 'function') {
        observer[name](payload);
      }
    }

    function sheetBounds(sheet) {
      if (sheet && typeof sheet.getLastRow === 'function' && typeof sheet.getLastColumn === 'function') {
        return {
          columns: Math.max(1, sheet.getLastColumn()),
          rows: Math.max(1, sheet.getLastRow()),
        };
      }
      var range = sheet.getDataRange();
      return { columns: range.getNumColumns(), rows: range.getNumRows() };
    }

    function replacePayload(payload, options) {
      try {
        if (!payload || typeof payload.datasetName !== 'string') {
          throw new Error('A normalized raw payload is required.');
        }
        if (!options || options.preflightVerified !== true) {
          preflightOne(payload.datasetName);
        }
        var binding = bindingForDataset(payload.datasetName);
        var entry = rawEntry(binding);
        var matrix = resolveCodec().encodePayload(payload);
        entry.sheet.getDataRange().clearContent();
        entry.sheet.getRange(1, 1, matrix.length, matrix[0].length).setValues(matrix);
        if (typeof observer.afterReplacement === 'function') {
          observer.afterReplacement({
            datasetName: payload.datasetName,
            index: resolveDatasetSheets().listBindings().indexOf(binding),
          });
        }
        return Object.freeze({
          datasetName: payload.datasetName,
          rowCount: payload.rowCount,
        });
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'MIGRATION_COMMIT_FAILED');
      }
    }

    function replacePayloadChunk(payload, cursor, options) {
      try {
        if (!payload || typeof payload.datasetName !== 'string') {
          throw new Error('A normalized raw payload is required.');
        }
        var chunks = resolveChunks();
        var codec = resolveCodec();
        var schema = resolveSchemaRegistry().getSchema(payload.datasetName);
        if (!schema || !Array.isArray(schema.columns)) {
          throw new Error('The active dataset schema is unavailable.');
        }
        var cached = encodedByDataset[payload.datasetName];
        if (!cached || cached.payload !== payload) {
          cached = { matrix: codec.encodePayload(payload), payload: payload };
          encodedByDataset[payload.datasetName] = cached;
        }
        var matrix = cached.matrix;
        var nextRow = cursor && Number.isInteger(cursor.nextRow) ? cursor.nextRow : 1;
        var phase = cursor && typeof cursor.phase === 'string' ? cursor.phase : (nextRow === 1 ? 'clear' : 'write');
        var chunkRows = cursor && Number.isInteger(cursor.chunkRows) ? cursor.chunkRows : chunks.DEFAULT_CHUNK_ROWS;
        var binding = bindingForDataset(payload.datasetName);
        var entry = rawEntry(binding);
        if (phase === 'clear') {
          if (!options || options.preflightVerified !== true) {
            preflightOne(payload.datasetName);
          }
          entry.sheet.getDataRange().clearContent();
          notify('afterRawClear', {
            datasetName: payload.datasetName,
            startRow: 1,
          });
          return Object.freeze({
            cursor: Object.freeze({ chunkRows: chunkRows, columnCount: matrix[0].length, nextRow: 1, phase: 'write' }),
            datasetComplete: false,
            datasetName: payload.datasetName,
            rowCount: payload.rowCount,
          });
        }
        var window = chunks.windowFor(matrix.length, nextRow, chunkRows);
        if (window.rowCount > 0) {
          var intended = chunks.sliceMatrix(matrix, window.startRow, window.rowCount);
          var dest = entry.sheet.getRange(window.startRow, 1, window.rowCount, matrix[0].length);
          if (phase !== 'verify') {
            dest.setValues(intended);
            notify('afterRawWrite', {
              datasetName: payload.datasetName,
              startRow: window.startRow,
            });
            return Object.freeze({
              cursor: Object.freeze({ chunkRows: chunkRows, columnCount: matrix[0].length, nextRow: window.startRow, phase: 'verify' }),
              datasetComplete: false,
              datasetName: payload.datasetName,
              rowCount: payload.rowCount,
            });
          }
          var comparison = codec.compareForColumns(intended, dest.getValues(), schema.columns);
          if (!comparison.equal) {
            var mismatch = comparison.mismatch || {};
            throw resolveErrorCodes().create('MIGRATION_COMMIT_FAILED', {
              details: {
                chunkStartRow: window.startRow,
                columnIndex: Number.isInteger(mismatch.columnIndex) ? mismatch.columnIndex : null,
                columnName: mismatch.columnName || null,
                comparisonReason: mismatch.comparisonReason || 'value_mismatch',
                datasetName: payload.datasetName,
                intendedValueType: mismatch.intendedValueType || null,
                operation: 'verify_raw_chunk',
                persistedValueType: mismatch.persistedValueType || null,
                reason: 'raw_write_verify_failed',
                rowOffset: Number.isInteger(mismatch.rowOffset) ? mismatch.rowOffset : null,
                schemaType: mismatch.schemaType || null,
              },
            });
          }
          notify('afterRawVerify', {
            datasetName: payload.datasetName,
            startRow: window.startRow,
          });
        }
        return Object.freeze({
          cursor: Object.freeze({
            chunkRows: chunkRows,
            columnCount: matrix[0].length,
            nextRow: window.nextStartRow,
            phase: window.complete ? 'complete' : 'write',
          }),
          datasetComplete: window.complete === true,
          datasetName: payload.datasetName,
          rowCount: payload.rowCount,
        });
      } catch (error) {
        if (error && error.code === 'MIGRATION_COMMIT_FAILED') {
          throw error;
        }
        throw resolveErrorCodes().create('MIGRATION_COMMIT_FAILED', {
          cause: error,
          details: {
            causeMessage: error && typeof error.message === 'string' ? error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500) : null,
            datasetName: payload && payload.datasetName || null,
            operation: cursor && cursor.phase ? cursor.phase + '_raw_chunk' : 'replace_raw_chunk',
            reason: 'raw_chunk_failed',
          },
        });
      }
    }

    function replaceStagedChunk(datasetName, cursor, expectedRowCount) {
      var operation = 'validate_staged_transfer';
      try {
        if (!Number.isInteger(expectedRowCount) || expectedRowCount < 0) {
          throw new Error('An expected staged row count is required.');
        }
        var binding = bindingForDataset(datasetName);
        var stagingSheet = spreadsheet && spreadsheet.getSheetByName(binding.stagingSheetName);
        var rawSheet = spreadsheet && spreadsheet.getSheetByName(binding.rawSheetName);
        if (!stagingSheet || !rawSheet) {
          throw new Error('A required staging or raw sheet is unavailable.');
        }
        var schema = resolveSchemaRegistry().getSchema(datasetName);
        if (!schema || !Array.isArray(schema.columns) || schema.columns.length < 1) {
          throw new Error('The active dataset schema is unavailable.');
        }
        var chunks = resolveChunks();
        var matrixRows = expectedRowCount + 1;
        var columnCount = schema.columns.length;
        var supplied = cursor || {};
        var phase = typeof supplied.phase === 'string' ? supplied.phase : 'clear';
        var requestedChunkRows = Number.isInteger(supplied.chunkRows) && supplied.chunkRows > 0
          ? supplied.chunkRows
          : chunks.DEFAULT_CHUNK_ROWS;
        var maxChunkCells = Number.isInteger(chunks.MAX_CHUNK_CELLS) && chunks.MAX_CHUNK_CELLS > 0
          ? chunks.MAX_CHUNK_CELLS
          : Number.MAX_SAFE_INTEGER;
        var chunkRows = Math.max(1, Math.min(
          requestedChunkRows,
          Math.floor(maxChunkCells / Math.max(1, columnCount)),
        ));
        var nextRow = Number.isInteger(supplied.nextRow) && supplied.nextRow > 0
          ? supplied.nextRow
          : 1;
        var tailEndRow = Number.isInteger(supplied.tailEndRow) ? supplied.tailEndRow : null;
        var tailColumnCount = Number.isInteger(supplied.tailColumnCount) && supplied.tailColumnCount > 0
          ? supplied.tailColumnCount
          : columnCount;

        if (phase === 'clear') {
          operation = 'clear_raw_dataset';
          rawSheet.getDataRange().clearContent();
          return Object.freeze({
            cursor: Object.freeze({
              chunkRows: chunkRows,
              columnCount: columnCount,
              datasetName: datasetName,
              expectedRowCount: expectedRowCount,
              nextRow: 1,
              phase: 'copy',
            }),
            datasetComplete: false,
            datasetName: datasetName,
            rowCount: expectedRowCount,
          });
        }

        if (phase === 'copy' || phase === 'verify') {
          var sourceLastRow = Math.max(1, stagingSheet.getLastRow());
          var sourceLastColumn = Math.max(1, stagingSheet.getLastColumn());
          if (sourceLastRow !== matrixRows || sourceLastColumn !== columnCount) {
            throw resolveErrorCodes().create('MIGRATION_COMMIT_FAILED', {
              details: {
                datasetName: datasetName,
                operation: 'validate_staged_bounds',
                reason: 'staged_bounds_mismatch',
              },
            });
          }
          var window = chunks.windowFor(matrixRows, nextRow, chunkRows);
          var source = stagingSheet.getRange(window.startRow, 1, window.rowCount, columnCount);
          var destination = rawSheet.getRange(window.startRow, 1, window.rowCount, columnCount);
          if (phase === 'copy') {
            operation = 'copy_staged_range';
            source.copyTo(destination, { contentsOnly: true });
            if (typeof dependencies.flush === 'function') dependencies.flush();
            return Object.freeze({
              cursor: Object.freeze({
                chunkRows: chunkRows,
                columnCount: columnCount,
                datasetName: datasetName,
                expectedRowCount: expectedRowCount,
                nextRow: window.startRow,
                phase: 'verify',
              }),
              datasetComplete: false,
              datasetName: datasetName,
              rowCount: expectedRowCount,
            });
          }
          operation = 'verify_staged_range';
          var comparison = resolveCodec().compareForColumns(
            source.getValues(),
            destination.getValues(),
            schema.columns,
          );
          if (!comparison.equal) {
            var mismatch = comparison.mismatch || {};
            throw resolveErrorCodes().create('MIGRATION_COMMIT_FAILED', {
              details: {
                chunkStartRow: window.startRow,
                columnIndex: Number.isInteger(mismatch.columnIndex) ? mismatch.columnIndex : null,
                columnName: mismatch.columnName || null,
                comparisonReason: mismatch.comparisonReason || 'value_mismatch',
                datasetName: datasetName,
                intendedValueType: mismatch.intendedValueType || null,
                operation: 'verify_staged_range',
                persistedValueType: mismatch.persistedValueType || null,
                reason: 'staged_transfer_verify_failed',
                rowOffset: Number.isInteger(mismatch.rowOffset) ? mismatch.rowOffset : null,
                schemaType: mismatch.schemaType || null,
              },
            });
          }
          if (!window.complete) {
            return Object.freeze({
              cursor: Object.freeze({
                chunkRows: chunkRows,
                columnCount: columnCount,
                datasetName: datasetName,
                expectedRowCount: expectedRowCount,
                nextRow: window.nextStartRow,
                phase: 'copy',
              }),
              datasetComplete: false,
              datasetName: datasetName,
              rowCount: expectedRowCount,
            });
          }
          var rawLastRow = Math.max(1, rawSheet.getLastRow());
          var rawLastColumn = Math.max(1, rawSheet.getLastColumn());
          if (rawLastRow > matrixRows) {
            return Object.freeze({
              cursor: Object.freeze({
                chunkRows: chunkRows,
                columnCount: columnCount,
                datasetName: datasetName,
                expectedRowCount: expectedRowCount,
                nextRow: matrixRows + 1,
                phase: 'trim',
                tailColumnCount: Math.max(tailColumnCount, rawLastColumn),
                tailEndRow: rawLastRow,
              }),
              datasetComplete: false,
              datasetName: datasetName,
              rowCount: expectedRowCount,
            });
          }
          return Object.freeze({
            cursor: Object.freeze({
              chunkRows: chunkRows,
              columnCount: columnCount,
              datasetName: datasetName,
              expectedRowCount: expectedRowCount,
              nextRow: matrixRows + 1,
              phase: 'complete',
            }),
            datasetComplete: true,
            datasetName: datasetName,
            rowCount: expectedRowCount,
          });
        }

        if (phase === 'trim' || phase === 'trim_verify') {
          if (!Number.isInteger(tailEndRow) || tailEndRow < matrixRows + 1) {
            throw resolveErrorCodes().create('MIGRATION_COMMIT_FAILED', {
              details: { datasetName: datasetName, operation: 'trim_raw_dataset', reason: 'invalid_tail_cursor' },
            });
          }
          var trimRows = Math.max(1, Math.min(
            chunkRows,
            Math.floor(maxChunkCells / Math.max(1, tailColumnCount)),
          ));
          var trimWindow = chunks.windowFor(tailEndRow, nextRow, trimRows);
          var trimRange = rawSheet.getRange(trimWindow.startRow, 1, trimWindow.rowCount, tailColumnCount);
          if (phase === 'trim') {
            operation = 'trim_raw_dataset';
            trimRange.clearContent();
            if (typeof dependencies.flush === 'function') dependencies.flush();
            return Object.freeze({
              cursor: Object.freeze({
                chunkRows: chunkRows,
                columnCount: columnCount,
                datasetName: datasetName,
                expectedRowCount: expectedRowCount,
                nextRow: trimWindow.startRow,
                phase: 'trim_verify',
                tailColumnCount: tailColumnCount,
                tailEndRow: tailEndRow,
              }),
              datasetComplete: false,
              datasetName: datasetName,
              rowCount: expectedRowCount,
            });
          }
          operation = 'verify_raw_trim';
          if (!matrixIsBlank(trimRange.getValues()) ||
              (typeof trimRange.getFormulas === 'function' && !matrixIsBlank(trimRange.getFormulas()))) {
            throw resolveErrorCodes().create('MIGRATION_COMMIT_FAILED', {
              details: { datasetName: datasetName, operation: operation, reason: 'trailing_rows_remain' },
            });
          }
          var trimNextRow = trimWindow.nextStartRow;
          if (trimNextRow <= tailEndRow) {
            return Object.freeze({
              cursor: Object.freeze({
                chunkRows: chunkRows,
                columnCount: columnCount,
                datasetName: datasetName,
                expectedRowCount: expectedRowCount,
                nextRow: trimNextRow,
                phase: 'trim',
                tailColumnCount: tailColumnCount,
                tailEndRow: tailEndRow,
              }),
              datasetComplete: false,
              datasetName: datasetName,
              rowCount: expectedRowCount,
            });
          }
          return Object.freeze({
            cursor: Object.freeze({
              chunkRows: chunkRows,
              columnCount: columnCount,
              datasetName: datasetName,
              expectedRowCount: expectedRowCount,
              nextRow: tailEndRow + 1,
              phase: 'complete',
            }),
            datasetComplete: true,
            datasetName: datasetName,
            rowCount: expectedRowCount,
          });
        }

        if (phase === 'complete') {
          return Object.freeze({
            cursor: Object.freeze(Object.assign({}, supplied)),
            datasetComplete: true,
            datasetName: datasetName,
            rowCount: expectedRowCount,
          });
        }
        throw new Error('A staged transfer cursor phase is unsupported.');
      } catch (error) {
        if (error && error.code === 'MIGRATION_COMMIT_FAILED') throw error;
        throw resolveErrorCodes().create('MIGRATION_COMMIT_FAILED', {
          cause: error,
          details: {
            causeMessage: error && typeof error.message === 'string' ? error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500) : null,
            datasetName: datasetName || null,
            operation: operation,
            reason: 'staged_transfer_failed',
          },
        });
      }
    }

    function restoreDatasetChunk(group, datasetName, cursor) {
      try {
        if (!group || !group.sheetsByDataset || !group.sheetsByDataset[datasetName]) {
          throw new Error('A backup dataset is required.');
        }
        var chunks = resolveChunks();
        var codec = resolveCodec();
        var binding = bindingForDataset(datasetName);
        var entry = rawEntry(binding);
        var backupSheet = spreadsheet.getSheetByName(group.sheetsByDataset[datasetName].sheetName);
        if (!backupSheet) {
          throw new Error('A required backup sheet is unavailable.');
        }
        var bounds = sheetBounds(backupSheet);
        var schema = resolveSchemaRegistry().getSchema(datasetName);
        var comparisonColumns = [];
        for (var columnIndex = 0; columnIndex < bounds.columns; columnIndex += 1) {
          comparisonColumns.push(schema && schema.columns && schema.columns[columnIndex] || { type: 'text' });
        }
        var nextRow = cursor && Number.isInteger(cursor.nextRow) ? cursor.nextRow : 1;
        var phase = cursor && typeof cursor.phase === 'string' ? cursor.phase : 'restore';
        var chunkRows = cursor && Number.isInteger(cursor.chunkRows) ? cursor.chunkRows : 1000;
        if (phase === 'trim' || phase === 'trim_verify') {
          var trimEndRow = cursor && Number.isInteger(cursor.tailEndRow) ? cursor.tailEndRow : bounds.rows;
          var trimColumns = cursor && Number.isInteger(cursor.columnCount) ? cursor.columnCount : bounds.columns;
          var trimNextRow = cursor && Number.isInteger(cursor.trimNextRow) ? cursor.trimNextRow : null;
          if (phase === 'trim') {
            var cellBoundRows = Math.max(1, Math.floor(50000 / trimColumns));
            var trimWindow = chunks.windowFor(trimEndRow, nextRow, Math.min(chunkRows, cellBoundRows));
            if (trimWindow.rowCount > 0) {
              entry.sheet.getRange(trimWindow.startRow, 1, trimWindow.rowCount, trimColumns).clearContent();
            }
            return Object.freeze({
              cursor: Object.freeze({
                chunkRows: chunkRows,
                columnCount: trimColumns,
                nextRow: trimWindow.startRow,
                phase: 'trim_verify',
                tailEndRow: trimEndRow,
                trimNextRow: trimWindow.nextStartRow,
              }),
              datasetComplete: false,
              datasetName: datasetName,
            });
          }
          if (!Number.isInteger(trimNextRow) || trimNextRow <= nextRow || trimNextRow > trimEndRow + 1) {
            throw resolveErrorCodes().create('MIGRATION_ROLLBACK_FAILED', {
              details: { datasetName: datasetName, operation: 'verify_rollback_trailing_rows', reason: 'rollback_trim_cursor_invalid', rollbackStatus: 'FAILED' },
            });
          }
          var verifyRows = trimNextRow - nextRow;
          if (verifyRows > 0) {
            var trimRange = entry.sheet.getRange(nextRow, 1, verifyRows, trimColumns);
            if (!matrixIsBlank(trimRange.getValues()) ||
                (typeof trimRange.getFormulas === 'function' && !matrixIsBlank(trimRange.getFormulas()))) {
              throw resolveErrorCodes().create('MIGRATION_ROLLBACK_FAILED', {
                details: {
                  chunkStartRow: nextRow,
                  datasetName: datasetName,
                  operation: 'verify_rollback_trailing_rows',
                  reason: 'rollback_trailing_rows_remain',
                  rollbackStatus: 'FAILED',
                },
              });
            }
          }
          return Object.freeze({
            cursor: Object.freeze({
              chunkRows: chunkRows,
              columnCount: trimColumns,
              nextRow: trimNextRow,
              phase: trimNextRow > trimEndRow ? 'complete' : 'trim',
              tailEndRow: trimEndRow,
            }),
            datasetComplete: trimNextRow > trimEndRow,
            datasetName: datasetName,
          });
        }
        var window = chunks.windowFor(bounds.rows, nextRow, chunkRows);
        var rawBounds = sheetBounds(entry.sheet);
        if (window.rowCount > 0) {
          var source = backupSheet.getRange(window.startRow, 1, window.rowCount, bounds.columns);
          var dest = entry.sheet.getRange(window.startRow, 1, window.rowCount, bounds.columns);
          var values = source.getValues();
          if (phase !== 'verify') {
            if (!codec.compareForColumns(values, dest.getValues(), comparisonColumns).equal) {
              dest.setValues(values);
            }
            notify('afterRestoreWrite', {
              datasetName: datasetName,
              startRow: window.startRow,
            });
            return Object.freeze({
              cursor: Object.freeze({ chunkRows: chunkRows, columnCount: bounds.columns, nextRow: window.startRow, phase: 'verify' }),
              datasetComplete: false,
              datasetName: datasetName,
            });
          }
          var comparison = codec.compareForColumns(values, dest.getValues(), comparisonColumns);
          if (!comparison.equal) {
            var mismatch = comparison.mismatch || {};
            throw resolveErrorCodes().create('MIGRATION_ROLLBACK_FAILED', {
              details: {
                chunkStartRow: window.startRow,
                columnIndex: Number.isInteger(mismatch.columnIndex) ? mismatch.columnIndex : null,
                columnName: mismatch.columnName || null,
                comparisonReason: mismatch.comparisonReason || 'value_mismatch',
                datasetName: datasetName,
                intendedValueType: mismatch.intendedValueType || null,
                operation: 'verify_rollback_chunk',
                persistedValueType: mismatch.persistedValueType || null,
                reason: 'rollback_write_verify_failed',
                rollbackStatus: 'FAILED',
                rowOffset: Number.isInteger(mismatch.rowOffset) ? mismatch.rowOffset : null,
                schemaType: mismatch.schemaType || null,
              },
            });
          }
          notify('afterRestoreVerify', {
            datasetName: datasetName,
            startRow: window.startRow,
          });
        }
        var trailingRows = window.complete && rawBounds.rows > bounds.rows;
        return Object.freeze({
          cursor: Object.freeze({
            chunkRows: chunkRows,
            columnCount: trailingRows ? rawBounds.columns : bounds.columns,
            nextRow: trailingRows ? bounds.rows + 1 : window.nextStartRow,
            phase: trailingRows ? 'trim' : (window.complete ? 'complete' : 'restore'),
            tailEndRow: trailingRows ? rawBounds.rows : undefined,
          }),
          datasetComplete: window.complete === true && !trailingRows,
          datasetName: datasetName,
        });
      } catch (error) {
        if (error && error.code === 'MIGRATION_ROLLBACK_FAILED') {
          throw error;
        }
        throw resolveErrorCodes().create('MIGRATION_ROLLBACK_FAILED', {
          cause: error,
          details: {
            causeMessage: error && typeof error.message === 'string' ? error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500) : null,
            datasetName: datasetName || null,
            operation: cursor && cursor.phase ? cursor.phase + '_rollback_chunk' : 'restore_raw_chunk',
            reason: 'rollback_chunk_failed',
          },
        });
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

    function readOne(datasetName) {
      try {
        var entry = rawEntry(bindingForDataset(datasetName));
        var range = entry.sheet.getDataRange();
        return Object.freeze({
          datasetName: entry.binding.datasetName,
          formulas: range.getFormulas(),
          sheetName: entry.binding.rawSheetName,
          values: range.getValues(),
        });
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'MIGRATION_COMMIT_FAILED');
      }
    }

    function inspectOne(datasetName, expectedRowCount) {
      try {
        if (!Number.isInteger(expectedRowCount) || expectedRowCount < 0) {
          throw new Error('An expected raw row count is required.');
        }
        var entry = rawEntry(bindingForDataset(datasetName));
        var schema = resolveSchemaRegistry().getSchema(datasetName);
        if (!schema || !Array.isArray(schema.columns)) {
          throw new Error('The active dataset schema is unavailable.');
        }
        var actualRows = Math.max(0, entry.sheet.getLastRow() - 1);
        var actualColumns = entry.sheet.getLastColumn();
        var hasFormula = containsFormula(formulaSentinel(entry.sheet, actualRows + 1, actualColumns));
        if (actualRows !== expectedRowCount || actualColumns !== schema.columns.length || hasFormula) {
          throw resolveErrorCodes().create('CALCULATION_HEALTH_CHECK_FAILED', {
            details: { datasetName: datasetName, reason: hasFormula ? 'raw_formulas_not_allowed' : 'raw_bounds_mismatch' },
          });
        }
        return Object.freeze({
          columnCount: actualColumns,
          datasetName: datasetName,
          rowCount: actualRows,
        });
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'CALCULATION_HEALTH_CHECK_FAILED');
      }
    }

    return Object.freeze({
      preflight: preflight,
      preflightOne: preflightOne,
      inspectOne: inspectOne,
      readAll: readAll,
      readOne: readOne,
      replaceAll: replaceAll,
      replaceOne: replaceOne,
      replacePayload: replacePayload,
      replacePayloadChunk: replacePayloadChunk,
      replaceStagedChunk: replaceStagedChunk,
      restoreAll: restoreAll,
      restoreDatasetChunk: restoreDatasetChunk,
      restoreGroup: restoreGroup,
    });
  }

  return Object.freeze({ create: create });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RawDataRepository;
}
