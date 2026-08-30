var ErrorTokenCoalescer = (function () {
  'use strict';

  function resolveRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return require('./SchemaRegistry.js');
  }

  function tokenLookup() {
    var lookup = Object.create(null);
    resolveRegistry().EMPTY_VALUE_POLICY.coalescedErrorTokens.forEach(function (token) {
      lookup[String(token).toUpperCase()] = true;
    });
    return lookup;
  }

  function coalesceValue(value, lookup) {
    if (typeof value !== 'string') {
      return Object.freeze({ coalesced: false, value: value });
    }
    var normalizedToken = value.trim().toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(lookup, normalizedToken)) {
      return Object.freeze({ coalesced: false, value: value });
    }
    return Object.freeze({ coalesced: true, value: null });
  }

  function coalesceRows(rows) {
    if (!Array.isArray(rows)) {
      return Object.freeze({ count: 0, rows: Object.freeze([]) });
    }
    var lookup = tokenLookup();
    var count = 0;
    var normalizedRows = rows.map(function (row) {
      if (!Array.isArray(row)) {
        return row;
      }
      return row.map(function (value) {
        var result = coalesceValue(value, lookup);
        if (result.coalesced) count += 1;
        return result.value;
      });
    });
    return Object.freeze({
      count: count,
      rows: Object.freeze(normalizedRows.map(function (row) {
        return Array.isArray(row) ? Object.freeze(row.slice()) : row;
      })),
    });
  }

  return Object.freeze({
    coalesceRows: coalesceRows,
    coalesceValue: function (value) {
      return coalesceValue(value, tokenLookup());
    },
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ErrorTokenCoalescer;
}
