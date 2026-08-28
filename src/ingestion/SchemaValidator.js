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

  var SHEETS_SERIAL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
  var SHEETS_SERIAL_DATE_MIN = 1000;
  var SHEETS_SERIAL_DATE_MAX = 999999;

  function isSheetsSerialCandidate(value) {
    return typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= SHEETS_SERIAL_DATE_MIN &&
      value <= SHEETS_SERIAL_DATE_MAX;
  }

  function isSheetsSerialString(value) {
    if (typeof value !== 'string') {
      return false;
    }
    var trimmed = value.trim();
    return /^\d{4,6}(\.\d+)?$/.test(trimmed) &&
      isSheetsSerialCandidate(Number(trimmed));
  }

  function sheetsSerialToUtcDate(serial) {
    if (!isSheetsSerialCandidate(serial)) {
      return null;
    }
    var utcMs = SHEETS_SERIAL_EPOCH_UTC_MS + Math.floor(serial) * 86400000;
    var date = new Date(utcMs);
    return validatedUtcDate(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
    );
  }

  function sheetsSerialToUtcDateTime(serial) {
    if (!isSheetsSerialCandidate(serial)) {
      return null;
    }
    var utcMs = SHEETS_SERIAL_EPOCH_UTC_MS + serial * 86400000;
    var date = new Date(utcMs);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date;
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatContractDate(isoDate) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
    if (!match) {
      return null;
    }
    return Number(match[2]) + '/' + Number(match[3]) + '/' + match[1];
  }

  function formatContractDateTime(isoDateTime) {
    var date = new Date(isoDateTime);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    var calendar = formatContractDate(date.toISOString().slice(0, 10));
    if (!calendar) {
      return null;
    }
    var hour24 = date.getUTCHours();
    var minute = date.getUTCMinutes();
    var ampm = hour24 >= 12 ? 'PM' : 'AM';
    var hour12 = hour24 % 12;
    if (hour12 === 0) {
      hour12 = 12;
    }
    return calendar + ' ' + hour12 + ':' + pad2(minute) + ' ' + ampm;
  }

  function normalizeDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    if (isSheetsSerialCandidate(value)) {
      var serialDate = sheetsSerialToUtcDate(value);
      return serialDate ? serialDate.toISOString().slice(0, 10) : null;
    }
    if (typeof value !== 'string') {
      return null;
    }
    var trimmed = value.trim();
    if (isSheetsSerialString(trimmed)) {
      var serialFromString = sheetsSerialToUtcDate(Number(trimmed));
      return serialFromString ? serialFromString.toISOString().slice(0, 10) : null;
    }
    var match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
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
    if (isSheetsSerialCandidate(value)) {
      var serialDateTime = sheetsSerialToUtcDateTime(value);
      return serialDateTime ? serialDateTime.toISOString() : null;
    }
    if (typeof value !== 'string') {
      return null;
    }
    var trimmed = value.trim();
    if (isSheetsSerialString(trimmed)) {
      var serialDateTimeFromString = sheetsSerialToUtcDateTime(Number(trimmed));
      return serialDateTimeFromString ? serialDateTimeFromString.toISOString() : null;
    }
    var match = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}) (AM|PM)$/i.exec(
      trimmed,
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

  function previewValue(value, maxLength) {
    var limit = typeof maxLength === 'number' ? maxLength : 48;
    if (value === null || value === undefined) {
      return '';
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    var text = typeof value === 'string' ? value : String(value);
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length > limit) {
      return text.slice(0, limit) + '...';
    }
    return text;
  }

  function recordGroupedIssue(groups, issue) {
    var key = issue.errorCode + '\0' + (issue.column || '');
    var existing = groups[key];
    if (!existing) {
      groups[key] = {
        column: issue.column,
        count: 1,
        errorCode: issue.errorCode,
        expectedType: issue.expectedType,
        firstRowNumber: issue.rowNumber,
        lastRowNumber: issue.rowNumber,
        sampleValuePreview: issue.valuePreview,
      };
      return;
    }
    existing.count += 1;
    existing.lastRowNumber = issue.rowNumber;
  }

  function collectValidationErrorSummary(datasetName, sourceHeaders, rows) {
    var groups = Object.create(null);
    var totalErrorCount = 0;
    var headerResult;

    try {
      headerResult = validateHeaders(datasetName, sourceHeaders);
    } catch (error) {
      if (error instanceof SchemaContractError) {
        return Object.freeze({
          datasetName: datasetName,
          errorGroups: Object.freeze([]),
          headerError: Object.freeze({
            details: error.details,
            errorCode: error.code,
            message: error.message,
          }),
          rowCount: Array.isArray(rows) ? rows.length : 0,
          rowVolumeError: null,
          totalErrorCount: 0,
        });
      }
      throw error;
    }

    if (!Array.isArray(rows)) {
      recordGroupedIssue(groups, {
        column: null,
        errorCode: ERROR_CODES.DATASET_INVALID_ROW,
        expectedType: null,
        rowNumber: null,
        valuePreview: '',
      });
      totalErrorCount = 1;
      return Object.freeze({
        datasetName: datasetName,
        errorGroups: Object.freeze([Object.freeze(groups[ERROR_CODES.DATASET_INVALID_ROW + '\0'])]),
        headerError: null,
        rowCount: 0,
        rowVolumeError: null,
        totalErrorCount: totalErrorCount,
      });
    }

    try {
      validateRowVolume(datasetName, rows.length);
    } catch (error) {
      if (error instanceof SchemaContractError) {
        return Object.freeze({
          datasetName: datasetName,
          errorGroups: Object.freeze([]),
          headerError: null,
          rowCount: rows.length,
          rowVolumeError: Object.freeze({
            details: error.details,
            errorCode: error.code,
            message: error.message,
          }),
          totalErrorCount: 0,
        });
      }
      throw error;
    }

    var schema = requireSchema(datasetName);
    var columnByName = Object.create(null);
    schema.columns.forEach(function (column) {
      columnByName[column.name] = column;
    });

    for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      var row = rows[rowIndex];
      var rowNumber = rowIndex + 2;
      if (!Array.isArray(row) || row.length !== sourceHeaders.length) {
        recordGroupedIssue(groups, {
          column: null,
          errorCode: ERROR_CODES.DATASET_INVALID_ROW,
          expectedType: null,
          rowNumber: rowNumber,
          valuePreview: '',
        });
        totalErrorCount += 1;
        continue;
      }

      for (var headerIndex = 0; headerIndex < headerResult.canonicalHeaders.length; headerIndex += 1) {
        var header = headerResult.canonicalHeaders[headerIndex];
        var sourceIndex = headerResult.sourceIndexByCanonicalHeader[header];
        var rawValue = row[sourceIndex];
        try {
          normalizeValue(columnByName[header], rawValue, datasetName, rowNumber);
        } catch (error) {
          if (!(error instanceof SchemaContractError)) {
            throw error;
          }
          recordGroupedIssue(groups, {
            column: error.details.column || header,
            errorCode: error.code,
            expectedType: error.details.expectedType || columnByName[header].type,
            rowNumber: error.details.rowNumber || rowNumber,
            valuePreview: previewValue(rawValue),
          });
          totalErrorCount += 1;
        }
      }

      for (var keyIndex = 0; keyIndex < schema.keyFields.length; keyIndex += 1) {
        var keyField = schema.keyFields[keyIndex];
        var keySourceIndex = headerResult.sourceIndexByCanonicalHeader[keyField];
        var keyValue = row[keySourceIndex];
        if (keyValue === null || keyValue === undefined) {
          recordGroupedIssue(groups, {
            column: keyField,
            errorCode: ERROR_CODES.DATASET_MISSING_KEY,
            expectedType: columnByName[keyField].type,
            rowNumber: rowNumber,
            valuePreview: previewValue(keyValue),
          });
          totalErrorCount += 1;
          continue;
        }
        if (typeof keyValue === 'string' && !keyValue.trim()) {
          recordGroupedIssue(groups, {
            column: keyField,
            errorCode: ERROR_CODES.DATASET_MISSING_KEY,
            expectedType: columnByName[keyField].type,
            rowNumber: rowNumber,
            valuePreview: '',
          });
          totalErrorCount += 1;
        }
      }
    }

    var errorGroups = Object.keys(groups).map(function (key) {
      return Object.freeze(groups[key]);
    }).sort(function (left, right) {
      if (left.column !== right.column) {
        return String(left.column).localeCompare(String(right.column));
      }
      return String(left.errorCode).localeCompare(String(right.errorCode));
    });

    return Object.freeze({
      datasetName: datasetName,
      errorGroups: Object.freeze(errorGroups),
      headerError: null,
      rowCount: rows.length,
      rowVolumeError: null,
      totalErrorCount: totalErrorCount,
    });
  }

  function collectValidationErrors(datasetName, sourceHeaders, rows, options) {
    var opts = options || {};
    var maxErrors = typeof opts.maxErrors === 'number' ? opts.maxErrors : 50;
    var errors = [];
    var headerResult;

    try {
      headerResult = validateHeaders(datasetName, sourceHeaders);
    } catch (error) {
      if (error instanceof SchemaContractError) {
        return Object.freeze({
          datasetName: datasetName,
          errors: Object.freeze([]),
          headerError: Object.freeze({
            details: error.details,
            errorCode: error.code,
            message: error.message,
          }),
          rowCount: Array.isArray(rows) ? rows.length : 0,
          rowVolumeError: null,
          truncated: false,
        });
      }
      throw error;
    }

    if (!Array.isArray(rows)) {
      return Object.freeze({
        datasetName: datasetName,
        errors: Object.freeze([Object.freeze({
          column: null,
          errorCode: ERROR_CODES.DATASET_INVALID_ROW,
          expectedType: null,
          rowNumber: null,
          valuePreview: '',
        })]),
        headerError: null,
        rowCount: 0,
        rowVolumeError: null,
        truncated: false,
      });
    }

    try {
      validateRowVolume(datasetName, rows.length);
    } catch (error) {
      if (error instanceof SchemaContractError) {
        return Object.freeze({
          datasetName: datasetName,
          errors: Object.freeze([]),
          headerError: null,
          rowCount: rows.length,
          rowVolumeError: Object.freeze({
            details: error.details,
            errorCode: error.code,
            message: error.message,
          }),
          truncated: false,
        });
      }
      throw error;
    }

    var schema = requireSchema(datasetName);
    var columnByName = Object.create(null);
    schema.columns.forEach(function (column) {
      columnByName[column.name] = column;
    });

    outer:
    for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      var row = rows[rowIndex];
      var rowNumber = rowIndex + 2;
      if (!Array.isArray(row) || row.length !== sourceHeaders.length) {
        errors.push(Object.freeze({
          column: null,
          errorCode: ERROR_CODES.DATASET_INVALID_ROW,
          expectedType: null,
          rowNumber: rowNumber,
          valuePreview: '',
        }));
        if (errors.length >= maxErrors) {
          break;
        }
        continue;
      }

      for (var headerIndex = 0; headerIndex < headerResult.canonicalHeaders.length; headerIndex += 1) {
        var header = headerResult.canonicalHeaders[headerIndex];
        var sourceIndex = headerResult.sourceIndexByCanonicalHeader[header];
        var rawValue = row[sourceIndex];
        try {
          normalizeValue(columnByName[header], rawValue, datasetName, rowNumber);
        } catch (error) {
          if (!(error instanceof SchemaContractError)) {
            throw error;
          }
          errors.push(Object.freeze({
            column: error.details.column || header,
            errorCode: error.code,
            expectedType: error.details.expectedType || columnByName[header].type,
            rowNumber: error.details.rowNumber || rowNumber,
            valuePreview: previewValue(rawValue),
          }));
          if (errors.length >= maxErrors) {
            break outer;
          }
        }
      }

      for (var keyIndex = 0; keyIndex < schema.keyFields.length; keyIndex += 1) {
        var keyField = schema.keyFields[keyIndex];
        var keySourceIndex = headerResult.sourceIndexByCanonicalHeader[keyField];
        var keyValue = row[keySourceIndex];
        if (keyValue === null || keyValue === undefined) {
          errors.push(Object.freeze({
            column: keyField,
            errorCode: ERROR_CODES.DATASET_MISSING_KEY,
            expectedType: columnByName[keyField].type,
            rowNumber: rowNumber,
            valuePreview: previewValue(keyValue),
          }));
          if (errors.length >= maxErrors) {
            break outer;
          }
          continue;
        }
        if (typeof keyValue === 'string' && !keyValue.trim()) {
          errors.push(Object.freeze({
            column: keyField,
            errorCode: ERROR_CODES.DATASET_MISSING_KEY,
            expectedType: columnByName[keyField].type,
            rowNumber: rowNumber,
            valuePreview: '',
          }));
          if (errors.length >= maxErrors) {
            break outer;
          }
        }
      }
    }

    return Object.freeze({
      datasetName: datasetName,
      errors: Object.freeze(errors.slice()),
      headerError: null,
      rowCount: rows.length,
      rowVolumeError: null,
      truncated: errors.length >= maxErrors,
    });
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

  function coerceCellToContractString(column, value) {
    if (value === null || value === undefined) {
      return value;
    }
    if (typeof value === 'string' && !value.trim()) {
      return value;
    }
    if (column.type !== 'date' && column.type !== 'date_time') {
      return value;
    }
    var normalized = null;
    if (column.type === 'date') {
      normalized = normalizeDate(value);
      return normalized ? formatContractDate(normalized) : value;
    }
    normalized = normalizeDateTime(value);
    return normalized ? formatContractDateTime(normalized) : value;
  }

  function coerceSourceTableValues(datasetName, sourceHeaders, rows) {
    var headerResult = validateHeaders(datasetName, sourceHeaders);
    var schema = requireSchema(datasetName);
    var columnByName = Object.create(null);
    schema.columns.forEach(function (column) {
      columnByName[column.name] = column;
    });
    if (!Array.isArray(rows)) {
      fail(
        ERROR_CODES.DATASET_INVALID_ROW,
        'Rows for ' + datasetName + ' must be an array.',
        { datasetName: datasetName },
      );
    }
    var coercedRows = rows.map(function (row) {
      if (!Array.isArray(row)) {
        return row;
      }
      var nextRow = row.slice();
      headerResult.canonicalHeaders.forEach(function (header) {
        var column = columnByName[header];
        if (!column || (column.type !== 'date' && column.type !== 'date_time')) {
          return;
        }
        var sourceIndex = headerResult.sourceIndexByCanonicalHeader[header];
        nextRow[sourceIndex] = coerceCellToContractString(column, nextRow[sourceIndex]);
      });
      return nextRow;
    });
    return Object.freeze({
      datasetName: datasetName,
      headers: Object.freeze(sourceHeaders.slice()),
      rows: Object.freeze(coercedRows.map(function (row) {
        return Object.freeze(row.slice());
      })),
    });
  }

  return Object.freeze({
    ERROR_CODES: ERROR_CODES,
    SchemaContractError: SchemaContractError,
    coerceSourceTableValues: coerceSourceTableValues,
    collectValidationErrorSummary: collectValidationErrorSummary,
    collectValidationErrors: collectValidationErrors,
    formatContractDate: formatContractDate,
    formatContractDateTime: formatContractDateTime,
    normalizeDate: normalizeDate,
    normalizeRows: normalizeRows,
    validateHeaders: validateHeaders,
    validateRowVolume: validateRowVolume,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SchemaValidator;
}
