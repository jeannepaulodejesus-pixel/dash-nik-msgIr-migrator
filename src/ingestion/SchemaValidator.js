var SchemaValidator = (function () {
  'use strict';

  var ERROR_CODES = Object.freeze({
    DATASET_ERROR_TOKEN: 'DATASET_ERROR_TOKEN',
    DATASET_INVALID_ROW: 'DATASET_INVALID_ROW',
    DATASET_INVALID_TYPE: 'DATASET_INVALID_TYPE',
    DATASET_MISSING_KEY: 'DATASET_MISSING_KEY',
    DATASET_ROW_VOLUME_OUT_OF_BOUNDS: 'DATASET_ROW_VOLUME_OUT_OF_BOUNDS',
    SCHEMA_DUPLICATE_COLUMNS: 'SCHEMA_DUPLICATE_COLUMNS',
    SCHEMA_INVALID_HEADERS: 'SCHEMA_INVALID_HEADERS',
    SCHEMA_MISSING_REQUIRED_COLUMNS: 'SCHEMA_MISSING_REQUIRED_COLUMNS',
    SCHEMA_UNEXPECTED_COLUMNS: 'SCHEMA_UNEXPECTED_COLUMNS',
    SCHEMA_UNKNOWN_DATASET: 'SCHEMA_UNKNOWN_DATASET',
  });

  function resolveRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return require('./SchemaRegistry.js');
  }

  function SchemaContractError(code, message, details) {
    this.name = 'SchemaContractError';
    this.code = code;
    this.message = message;
    this.details = Object.freeze(Object.assign({}, details || {}));
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SchemaContractError);
    }
  }
  SchemaContractError.prototype = Object.create(Error.prototype);
  SchemaContractError.prototype.constructor = SchemaContractError;

  function fail(code, message, details) {
    throw new SchemaContractError(code, message, details);
  }

  function requireSchema(datasetName) {
    var schema = resolveRegistry().getSchema(datasetName);
    if (!schema) {
      fail(
        ERROR_CODES.SCHEMA_UNKNOWN_DATASET,
        'No active schema is registered for dataset: ' + datasetName,
        { datasetName: datasetName },
      );
    }
    return schema;
  }

  function normalizeHeader(header, index) {
    if (typeof header !== 'string' || !header.trim()) {
      fail(
        ERROR_CODES.SCHEMA_INVALID_HEADERS,
        'Header at index ' + index + ' must be a nonblank string.',
        { headerIndex: index },
      );
    }
    return header.trim();
  }

  function validateHeaders(datasetName, sourceHeaders) {
    var schema = requireSchema(datasetName);
    if (!Array.isArray(sourceHeaders)) {
      fail(
        ERROR_CODES.SCHEMA_INVALID_HEADERS,
        'Headers for ' + datasetName + ' must be an array.',
        { datasetName: datasetName },
      );
    }

    var allowed = Object.create(null);
    schema.requiredHeaders.concat(schema.optionalHeaders).forEach(function (header) {
      allowed[header] = true;
    });
    var canonicalSourceHeaders = [];
    var canonicalIndex = Object.create(null);
    var duplicates = [];
    var unexpected = [];

    sourceHeaders.forEach(function (sourceHeader, index) {
      var normalized = normalizeHeader(sourceHeader, index);
      var canonical = schema.aliases[normalized] || normalized;
      canonicalSourceHeaders.push(canonical);
      if (Object.prototype.hasOwnProperty.call(canonicalIndex, canonical)) {
        duplicates.push(canonical);
      } else {
        canonicalIndex[canonical] = index;
      }
      if (!allowed[canonical]) {
        unexpected.push(normalized);
      }
    });

    if (duplicates.length > 0) {
      fail(
        ERROR_CODES.SCHEMA_DUPLICATE_COLUMNS,
        'Headers for ' + datasetName + ' map to duplicate canonical columns.',
        { duplicateHeaders: Object.freeze(duplicates.slice()), datasetName: datasetName },
      );
    }

    var missing = schema.requiredHeaders.filter(function (header) {
      return !Object.prototype.hasOwnProperty.call(canonicalIndex, header);
    });
    if (missing.length > 0) {
      fail(
        ERROR_CODES.SCHEMA_MISSING_REQUIRED_COLUMNS,
        'Headers for ' + datasetName + ' are missing required columns.',
        { datasetName: datasetName, missingHeaders: Object.freeze(missing.slice()) },
      );
    }
    if (unexpected.length > 0 && !schema.allowUnexpectedHeaders) {
      fail(
        ERROR_CODES.SCHEMA_UNEXPECTED_COLUMNS,
        'Headers for ' + datasetName + ' contain unexpected columns.',
        { datasetName: datasetName, unexpectedHeaders: Object.freeze(unexpected.slice()) },
      );
    }

    var canonicalHeaders = schema.requiredHeaders.concat(
      schema.optionalHeaders.filter(function (header) {
        return Object.prototype.hasOwnProperty.call(canonicalIndex, header);
      }),
    );
    return Object.freeze({
      canonicalHeaders: Object.freeze(canonicalHeaders),
      canonicalSourceHeaders: Object.freeze(canonicalSourceHeaders),
      datasetName: datasetName,
      schemaVersion: schema.version,
      sourceIndexByCanonicalHeader: Object.freeze(canonicalIndex),
    });
  }

  function validateRowVolume(datasetName, rowCount) {
    var schema = requireSchema(datasetName);
    if (
      !Number.isInteger(rowCount) ||
      rowCount < schema.rowVolume.minimum ||
      rowCount > schema.rowVolume.maximum
    ) {
      fail(
        ERROR_CODES.DATASET_ROW_VOLUME_OUT_OF_BOUNDS,
        'Row count for ' + datasetName + ' is outside the active schema bounds.',
        {
          actual: rowCount,
          datasetName: datasetName,
          maximum: schema.rowVolume.maximum,
          minimum: schema.rowVolume.minimum,
        },
      );
    }
    return rowCount;
  }

  function validatedUtcDate(year, month, day) {
    var timestamp = Date.UTC(year, month - 1, day);
    var date = new Date(timestamp);
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return date;
  }

  function normalizeDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    if (typeof value !== 'string') {
      return null;
    }
    var match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
    if (!match) {
      return null;
    }
    var date = validatedUtcDate(Number(match[3]), Number(match[1]), Number(match[2]));
    return date ? date.toISOString().slice(0, 10) : null;
  }

  function normalizeDateTime(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
    if (typeof value !== 'string') {
      return null;
    }
    var match = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}) (AM|PM)$/i.exec(
      value.trim(),
    );
    if (!match) {
      return null;
    }

    var hour = Number(match[4]);
    var minute = Number(match[5]);
    if (hour < 1 || hour > 12 || minute > 59) {
      return null;
    }
    var date = validatedUtcDate(Number(match[3]), Number(match[1]), Number(match[2]));
    if (!date) {
      return null;
    }
    hour %= 12;
    if (match[6].toUpperCase() === 'PM') {
      hour += 12;
    }
    date.setUTCHours(hour, minute, 0, 0);
    return date.toISOString();
  }

  function normalizeNumber(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (
      typeof value !== 'string' ||
      !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())
    ) {
      return null;
    }
    var numberValue = Number(value.trim());
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  function normalizeText(value) {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  }

  function normalizeValue(column, value, datasetName, rowNumber) {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      var trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      if (/^#/.test(trimmed)) {
        fail(
          ERROR_CODES.DATASET_ERROR_TOKEN,
          'Raw error tokens are not accepted in ' + datasetName + '.',
          { column: column.name, datasetName: datasetName, rowNumber: rowNumber },
        );
      }
    }

    var normalized = null;
    if (column.type === 'text') {
      normalized = normalizeText(value);
    } else if (column.type === 'number') {
      normalized = normalizeNumber(value);
    } else if (column.type === 'date') {
      normalized = normalizeDate(value);
    } else if (column.type === 'date_time') {
      normalized = normalizeDateTime(value);
    }

    if (normalized === null) {
      fail(
        ERROR_CODES.DATASET_INVALID_TYPE,
        'Value for ' + datasetName + ' column ' + column.name + ' is not a valid ' + column.type + '.',
        {
          column: column.name,
          datasetName: datasetName,
          expectedType: column.type,
          rowNumber: rowNumber,
        },
      );
    }
    return normalized;
  }

  function normalizeRows(datasetName, sourceHeaders, rows) {
    var schema = requireSchema(datasetName);
    var headerResult = validateHeaders(datasetName, sourceHeaders);
    if (!Array.isArray(rows)) {
      fail(
        ERROR_CODES.DATASET_INVALID_ROW,
        'Rows for ' + datasetName + ' must be an array.',
        { datasetName: datasetName },
      );
    }
    validateRowVolume(datasetName, rows.length);

    var columnByName = Object.create(null);
    schema.columns.forEach(function (column) {
      columnByName[column.name] = column;
    });
    var records = rows.map(function (row, rowIndex) {
      var rowNumber = rowIndex + 2;
      if (!Array.isArray(row) || row.length !== sourceHeaders.length) {
        fail(
          ERROR_CODES.DATASET_INVALID_ROW,
          'Row ' + rowNumber + ' for ' + datasetName + ' is ragged.',
          {
            actualColumns: Array.isArray(row) ? row.length : null,
            datasetName: datasetName,
            expectedColumns: sourceHeaders.length,
            rowNumber: rowNumber,
          },
        );
      }

      var record = {};
      headerResult.canonicalHeaders.forEach(function (header) {
        var sourceIndex = headerResult.sourceIndexByCanonicalHeader[header];
        record[header] = normalizeValue(
          columnByName[header],
          row[sourceIndex],
          datasetName,
          rowNumber,
        );
      });
      schema.keyFields.forEach(function (keyField) {
        if (record[keyField] === null) {
          fail(
            ERROR_CODES.DATASET_MISSING_KEY,
            'Key field ' + keyField + ' must be nonblank in ' + datasetName + '.',
            { datasetName: datasetName, keyField: keyField, rowNumber: rowNumber },
          );
        }
      });
      return Object.freeze(record);
    });

    return Object.freeze({
      datasetName: datasetName,
      headers: Object.freeze(headerResult.canonicalHeaders.slice()),
      records: Object.freeze(records),
      schemaVersion: schema.version,
    });
  }

  return Object.freeze({
    ERROR_CODES: ERROR_CODES,
    SchemaContractError: SchemaContractError,
    normalizeRows: normalizeRows,
    validateHeaders: validateHeaders,
    validateRowVolume: validateRowVolume,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SchemaValidator;
}
