var SheetValueCodec = (function () {
  'use strict';

  function copyRows(rows) {
    return rows.map(function (row) {
      return row.slice();
    });
  }

  function encodePayload(payload) {
    var headers = payload.headers.slice();
    return [headers].concat(payload.records.map(function (record) {
      return headers.map(function (header) {
        return record[header] === null ? '' : record[header];
      });
    }));
  }

  function decodeMatrix(datasetName, values) {
    var matrix = copyRows(values || []);
    var headers = matrix.length > 0 ? matrix[0] : [];
    var records = matrix.slice(1).map(function (row) {
      var record = {};
      headers.forEach(function (header, index) {
        record[header] = row[index] === '' ? null : row[index];
      });
      return record;
    });
    return {
      datasetName: datasetName,
      headers: headers,
      records: records,
    };
  }

  function matricesEqual(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every(function (row, rowIndex) {
      var other = right[rowIndex];
      return Array.isArray(row) && Array.isArray(other) && row.length === other.length &&
        row.every(function (value, columnIndex) {
          var otherValue = other[columnIndex];
          var valueEpoch = dateEpoch(value);
          var otherEpoch = dateEpoch(otherValue);
          var valueIsDate = valueEpoch !== null;
          var otherIsDate = otherEpoch !== null;
          if (valueIsDate || otherIsDate) {
            return valueIsDate && otherIsDate &&
              !Number.isNaN(valueEpoch) &&
              valueEpoch === otherEpoch;
          }
          return value === otherValue;
        });
    });
  }

  function valueKind(value) {
    if (dateEpoch(value) !== null) return 'date';
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  function valuesEqualForColumn(column, left, right) {
    var safeColumn = column && typeof column === 'object' ? column : { type: 'text' };
    var normalizedLeft = normalizePersistedValue(safeColumn, left);
    var normalizedRight = normalizePersistedValue(safeColumn, right);
    if (normalizedLeft === normalizedRight) return true;
    var leftEpoch = dateEpoch(normalizedLeft);
    var rightEpoch = dateEpoch(normalizedRight);
    return leftEpoch !== null && rightEpoch !== null &&
      !Number.isNaN(leftEpoch) && leftEpoch === rightEpoch;
  }

  function compareForColumns(left, right, columns) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length ||
        !Array.isArray(columns)) {
      return Object.freeze({ equal: false, mismatch: Object.freeze({ reason: 'matrix_shape' }) });
    }
    for (var rowIndex = 0; rowIndex < left.length; rowIndex += 1) {
      var row = left[rowIndex];
      var other = right[rowIndex];
      if (!Array.isArray(row) || !Array.isArray(other) || row.length !== other.length ||
          row.length !== columns.length) {
        return Object.freeze({ equal: false, mismatch: Object.freeze({ reason: 'row_shape', rowOffset: rowIndex }) });
      }
      for (var columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
        if (!valuesEqualForColumn(columns[columnIndex], row[columnIndex], other[columnIndex])) {
          return Object.freeze({
            equal: false,
            mismatch: Object.freeze({
              columnIndex: columnIndex,
              columnName: columns[columnIndex] && columns[columnIndex].name || null,
              comparisonReason: 'normalized_value_mismatch',
              intendedValueType: valueKind(row[columnIndex]),
              persistedValueType: valueKind(other[columnIndex]),
              rowOffset: rowIndex,
              schemaType: columns[columnIndex] && columns[columnIndex].type || 'text',
            }),
          });
        }
      }
    }
    return Object.freeze({ equal: true, mismatch: null });
  }

  function dateEpoch(value) {
    if (Object.prototype.toString.call(value) !== '[object Date]') {
      return null;
    }
    try {
      return Date.prototype.getTime.call(value);
    } catch (_error) {
      return null;
    }
  }

  function normalizePersistedValue(column, value) {
    if (
      column.type === 'text' &&
      typeof value === 'number' &&
      Number.isFinite(value)
    ) {
      return String(value);
    }
    if (column.type === 'date_time' && typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
      var parsedEpoch = new Date(value).getTime();
      if (!Number.isNaN(parsedEpoch)) return new Date(parsedEpoch).toISOString();
    }
    var epoch = dateEpoch(value);
    if (epoch !== null && !Number.isNaN(epoch)) {
      if (column.type === 'date') {
        return new Date(epoch).toISOString().slice(0, 10);
      }
      if (column.type === 'date_time') {
        return new Date(epoch).toISOString();
      }
    }
    return value;
  }

  return Object.freeze({
    decodeMatrix: decodeMatrix,
    compareForColumns: compareForColumns,
    encodePayload: encodePayload,
    matricesEqual: matricesEqual,
    normalizePersistedValue: normalizePersistedValue,
    valuesEqualForColumn: valuesEqualForColumn,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SheetValueCodec;
}
