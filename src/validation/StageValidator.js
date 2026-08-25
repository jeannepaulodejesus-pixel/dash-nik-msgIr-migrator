var StageValidator = (function () {
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

  function resolveRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return require('../ingestion/SchemaRegistry.js');
  }

  function resolveCodec() {
    if (typeof SheetValueCodec !== 'undefined') {
      return SheetValueCodec;
    }
    return require('../services/SheetValueCodec.js');
  }

  function fail(reason, datasetName, details) {
    throw resolveErrorCodes().create('MIGRATION_STAGE_VALIDATION_FAILED', {
      details: Object.assign(
        { datasetName: datasetName || null, reason: reason },
        details || {},
      ),
    });
  }

  function arraysEqual(left, right) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every(function (value, index) {
        return value === right[index];
      });
  }

  function isRectangular(matrix) {
    return Array.isArray(matrix) && matrix.length > 0 && Array.isArray(matrix[0]) &&
      matrix[0].length > 0 && matrix.every(function (row) {
        return Array.isArray(row) && row.length === matrix[0].length;
      });
  }

  function containsFormula(formulas) {
    return formulas.some(function (row) {
      return row.some(function (formula) {
        return typeof formula === 'string' && formula.length > 0;
      });
    });
  }

  function isIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    var date = new Date(value + 'T00:00:00.000Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function isIsoDateTime(value) {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    ) {
      return false;
    }
    var date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.toISOString() === value;
  }

  function validValue(column, value) {
    if (value === null) {
      return true;
    }
    if (column.type === 'text') {
      return typeof value === 'string';
    }
    if (column.type === 'number') {
      return typeof value === 'number' && Number.isFinite(value);
    }
    if (column.type === 'date') {
      return isIsoDate(value);
    }
    if (column.type === 'date_time') {
      return isIsoDateTime(value);
    }
    return false;
  }

  function requireDatasetSet(items, label) {
    var bindings = resolveDatasetSheets().listBindings();
    if (!Array.isArray(items) || items.length !== bindings.length) {
      fail('datasets_mismatch', null, { boundary: label });
    }
    var byName = Object.create(null);
    items.forEach(function (item) {
      if (!item || byName[item.datasetName]) {
        fail('datasets_mismatch', item && item.datasetName, { boundary: label });
      }
      byName[item.datasetName] = item;
    });
    bindings.forEach(function (binding) {
      if (!byName[binding.datasetName]) {
        fail('datasets_mismatch', binding.datasetName, { boundary: label });
      }
    });
    return byName;
  }

  function validateDataset(payload, snapshot, schema) {
    if (
      payload.schemaVersion !== resolveRegistry().ACTIVE_SCHEMA_VERSION ||
      !payload.runMetadata ||
      payload.runMetadata.schemaVersion !== resolveRegistry().ACTIVE_SCHEMA_VERSION
    ) {
      fail('schema_version_mismatch', payload.datasetName);
    }
    if (!isRectangular(snapshot.values) || !isRectangular(snapshot.formulas)) {
      fail('invalid_matrix', payload.datasetName);
    }
    if (
      snapshot.values.length !== snapshot.formulas.length ||
      snapshot.values[0].length !== snapshot.formulas[0].length
    ) {
      fail('invalid_matrix', payload.datasetName);
    }
    if (containsFormula(snapshot.formulas)) {
      fail('formulas_not_allowed', payload.datasetName);
    }
    if (
      !arraysEqual(snapshot.values[0], schema.requiredHeaders) ||
      !arraysEqual(payload.headers, schema.requiredHeaders)
    ) {
      fail('invalid_headers', payload.datasetName);
    }
    var rowCount = snapshot.values.length - 1;
    if (
      rowCount !== payload.rowCount ||
      rowCount !== payload.records.length ||
      rowCount < schema.rowVolume.minimum ||
      rowCount > schema.rowVolume.maximum
    ) {
      fail('row_count_mismatch', payload.datasetName, { rowCount: rowCount });
    }

    var decoded = resolveCodec().decodeMatrix(payload.datasetName, snapshot.values);
    var seenKeys = Object.create(null);
    decoded.records.forEach(function (record, rowIndex) {
      schema.columns.forEach(function (column) {
        record[column.name] = resolveCodec().normalizePersistedValue(
          column,
          record[column.name],
        );
        if (!validValue(column, record[column.name])) {
          fail('invalid_type', payload.datasetName, {
            column: column.name,
            rowNumber: rowIndex + 2,
          });
        }
      });
      var key;
      if (schema.keyFields.length > 0) {
        var keyParts = schema.keyFields.map(function (keyField) {
          var value = record[keyField];
          if (value === null || typeof value !== 'string' || !value.trim()) {
            fail('blank_key', payload.datasetName, {
              keyField: keyField,
              rowNumber: rowIndex + 2,
            });
          }
          return value;
        });
        key = keyParts.join('\u0000');
      } else if (schema.technicalDedupeKey === 'canonical_full_row_hash') {
        key = JSON.stringify(schema.requiredHeaders.map(function (header) {
          return record[header];
        }));
      }
      if (key !== undefined) {
        if (seenKeys[key]) {
          fail('duplicate_key', payload.datasetName, { rowNumber: rowIndex + 2 });
        }
        seenKeys[key] = true;
      }
    });

    if (!resolveCodec().matricesEqual(
      resolveCodec().encodePayload(payload),
      resolveCodec().encodePayload({
        headers: decoded.headers,
        records: decoded.records,
      }),
    )) {
      fail('persisted_values_mismatch', payload.datasetName);
    }
    return rowCount;
  }

  function validate(payloads, snapshots) {
    var payloadByName = requireDatasetSet(payloads, 'payloads');
    var snapshotByName = requireDatasetSet(snapshots, 'snapshots');
    var rowCounts = {};
    resolveDatasetSheets().listBindings().forEach(function (binding) {
      var schema = resolveRegistry().getSchema(
        binding.datasetName,
        resolveRegistry().ACTIVE_SCHEMA_VERSION,
      );
      if (!schema) {
        fail('schema_version_mismatch', binding.datasetName);
      }
      rowCounts[binding.datasetName] = validateDataset(
        payloadByName[binding.datasetName],
        snapshotByName[binding.datasetName],
        schema,
      );
    });
    return Object.freeze({ datasetCount: 5, rowCounts: Object.freeze(rowCounts) });
  }

  function snapshotMatchesPayload(snapshot, payload) {
    if (!snapshot || !payload || snapshot.datasetName !== payload.datasetName) {
      return false;
    }
    try {
      var schema = resolveRegistry().getSchema(
        payload.datasetName,
        resolveRegistry().ACTIVE_SCHEMA_VERSION,
      );
      if (!schema) {
        return false;
      }
      validateDataset(payload, snapshot, schema);
      return true;
    } catch (error) {
      return false;
    }
  }

  function validateDatasetCheckpoint(payload, snapshot) {
    if (!payload || !snapshot || payload.datasetName !== snapshot.datasetName) {
      fail('datasets_mismatch', payload && payload.datasetName ? payload.datasetName : null);
    }
    var schema = resolveRegistry().getSchema(
      payload.datasetName,
      resolveRegistry().ACTIVE_SCHEMA_VERSION,
    );
    if (!schema) {
      fail('schema_version_mismatch', payload.datasetName);
    }
    return Object.freeze({
      datasetName: payload.datasetName,
      rowCount: validateDataset(payload, snapshot, schema),
    });
  }

  return Object.freeze({
    snapshotMatchesPayload: snapshotMatchesPayload,
    validate: validate,
    validateDatasetCheckpoint: validateDatasetCheckpoint,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StageValidator;
}
