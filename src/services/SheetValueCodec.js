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
          return value === other[columnIndex];
        });
    });
  }

  return Object.freeze({
    decodeMatrix: decodeMatrix,
    encodePayload: encodePayload,
    matricesEqual: matricesEqual,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SheetValueCodec;
}
