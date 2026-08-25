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

  function resolveRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return require('../ingestion/SchemaRegistry.js');
  }

  function rowCountSummary(entries) {
    var counts = {};
    entries.forEach(function (entry) {
      counts[entry.binding.datasetName] = entry.payload.rowCount;
    });
    return Object.freeze({ datasetCount: entries.length, rowCounts: Object.freeze(counts) });
  }

  function create(spreadsheet) {
    function requireRunMetadata(runMetadata) {
      if (
        !runMetadata ||
        typeof runMetadata.runId !== 'string' || !runMetadata.runId ||
        typeof runMetadata.schemaVersion !== 'string' || !runMetadata.schemaVersion
      ) {
        throw resolveErrorCodes().create('INGESTION_INVALID_RUN_METADATA', {
          details: { boundary: 'StagingRepository.readCheckpoint' },
        });
      }
    }

    function bindingForDataset(datasetName) {
      var binding = resolveDatasetSheets().listBindings().filter(function (candidate) {
        return candidate.datasetName === datasetName;
      })[0];
      if (!binding) {
        throw new Error('A registered staging dataset is required.');
      }
      return binding;
    }

    function snapshotForBinding(binding) {
      var sheet = spreadsheet && spreadsheet.getSheetByName(binding.stagingSheetName);
      if (!sheet) {
        throw new Error('A required staging sheet is unavailable.');
      }
      var range = sheet.getDataRange();
      return Object.freeze({
        datasetName: binding.datasetName,
        formulas: range.getFormulas(),
        sheetName: binding.stagingSheetName,
        values: range.getValues(),
      });
    }

    function payloadForSnapshot(snapshot, runMetadata) {
      var decoded = resolveCodec().decodeMatrix(
        snapshot.datasetName,
        snapshot.values,
      );
      var schema = resolveRegistry().getSchema(
        snapshot.datasetName,
        runMetadata.schemaVersion,
      );
      if (!schema) {
        throw resolveErrorCodes().create('MIGRATION_STAGE_VALIDATION_FAILED', {
          details: {
            datasetName: snapshot.datasetName,
            reason: 'schema_version_mismatch',
          },
        });
      }
      decoded.records.forEach(function (record) {
        schema.columns.forEach(function (column) {
          record[column.name] = resolveCodec().normalizePersistedValue(
            column,
            record[column.name],
          );
        });
      });
      return Object.freeze({
        contract: 'DatasetPayload',
        contractVersion: '1.0.0',
        datasetName: decoded.datasetName,
        headers: Object.freeze(decoded.headers.slice()),
        records: Object.freeze(decoded.records.slice()),
        rowCount: decoded.records.length,
        runMetadata: Object.freeze({
          runId: runMetadata.runId,
          schemaVersion: runMetadata.schemaVersion,
        }),
        schemaVersion: runMetadata.schemaVersion,
        source: Object.freeze({ kind: 'staging_checkpoint' }),
      });
    }

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
        return Object.freeze(bindings.map(snapshotForBinding));
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'MIGRATION_STAGE_WRITE_FAILED');
      }
    }

    function readCheckpoint(runMetadata) {
      requireRunMetadata(runMetadata);
      var snapshots = readAll();
      var payloads = snapshots.map(function (snapshot) {
        return payloadForSnapshot(snapshot, runMetadata);
      });
      return Object.freeze({
        payloads: Object.freeze(payloads),
        snapshots: snapshots,
      });
    }

    function readDatasetCheckpoint(runMetadata, datasetName) {
      try {
        requireRunMetadata(runMetadata);
        var snapshot = snapshotForBinding(bindingForDataset(datasetName));
        return Object.freeze({
          payload: payloadForSnapshot(snapshot, runMetadata),
          snapshot: snapshot,
        });
      } catch (error) {
        if (error && (error.code === 'INGESTION_INVALID_RUN_METADATA' ||
            error.code === 'MIGRATION_STAGE_VALIDATION_FAILED')) {
          throw error;
        }
        throw resolveErrorCodes().normalize(error, 'MIGRATION_STAGE_WRITE_FAILED');
      }
    }

    return Object.freeze({
      readAll: readAll,
      readCheckpoint: readCheckpoint,
      readDatasetCheckpoint: readDatasetCheckpoint,
      writeAll: writeAll,
    });
  }

  return Object.freeze({ create: create });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StagingRepository;
}
