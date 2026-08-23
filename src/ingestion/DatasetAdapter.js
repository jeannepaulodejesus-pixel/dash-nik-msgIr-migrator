var DatasetAdapter = (function () {
  'use strict';

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function resolvePayload() {
    if (typeof DatasetPayload !== 'undefined') {
      return DatasetPayload;
    }
    return require('./DatasetPayload.js');
  }

  function resolveRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return require('./SchemaRegistry.js');
  }

  function resolveValidator() {
    if (typeof SchemaValidator !== 'undefined') {
      return SchemaValidator;
    }
    return require('./SchemaValidator.js');
  }

  function decodeHtml(value) {
    var named = {
      amp: '&',
      apos: "'",
      gt: '>',
      lt: '<',
      nbsp: '\u00a0',
      quot: '"',
    };
    return value.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, function (_, entity) {
      var lower = entity.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(named, lower)) {
        return named[lower];
      }
      var codePoint = lower.indexOf('#x') === 0
        ? parseInt(lower.slice(2), 16)
        : parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    });
  }

  function cellText(html) {
    return decodeHtml(
      html
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<[^>]*>/g, ''),
    );
  }

  function freezeGrid(values) {
    return Object.freeze(values.map(function (row) {
      return Object.freeze(row.slice());
    }));
  }

  function parseHtmlTable(source) {
    if (!source || !source.blob || typeof source.blob.getDataAsString !== 'function') {
      throw resolveErrorCodes().create('SOURCE_INVALID_TABLE', {
        details: { reason: 'missing_blob' },
      });
    }
    var html = source.blob.getDataAsString('ISO-8859-1');
    var tableTags = html.match(/<table\b/gi) || [];
    if (tableTags.length > 1) {
      throw resolveErrorCodes().create('SOURCE_MULTIPLE_TABLES', {
        details: { tableCount: tableTags.length },
      });
    }
    if (tableTags.length !== 1) {
      throw resolveErrorCodes().create('SOURCE_INVALID_TABLE', {
        details: { tableCount: tableTags.length },
      });
    }

    var tableMatch = /<table\b[^>]*>([\s\S]*?)<\/table\s*>/i.exec(html);
    if (!tableMatch) {
      throw resolveErrorCodes().create('SOURCE_INVALID_TABLE', {
        details: { reason: 'unclosed_table' },
      });
    }
    var values = [];
    var rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
    var rowMatch;
    while ((rowMatch = rowPattern.exec(tableMatch[1])) !== null) {
      var row = [];
      var cellPattern = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]\s*>/gi;
      var match;
      while ((match = cellPattern.exec(rowMatch[1])) !== null) {
        row.push(cellText(match[1]));
      }
      if (row.length > 0) {
        values.push(row);
      }
    }
    if (values.length < 2 || values[0].length === 0) {
      throw resolveErrorCodes().create('SOURCE_INVALID_TABLE', {
        details: { reason: 'missing_header_or_rows' },
      });
    }
    var width = values[0].length;
    values.forEach(function (row, index) {
      if (row.length !== width) {
        throw resolveErrorCodes().create('SOURCE_RAGGED_ROWS', {
          details: {
            actualColumns: row.length,
            expectedColumns: width,
            rowNumber: index + 1,
          },
        });
      }
    });
    return Object.freeze({ values: freezeGrid(values) });
  }

  function rawToken(value) {
    if (value === null) {
      return 'null:';
    }
    if (value === undefined) {
      return 'undefined:';
    }
    if (value instanceof Date) {
      return 'date:' + value.toISOString();
    }
    return typeof value + ':' + String(value);
  }

  function collapseExactRows(datasetName, headers, rows) {
    var headerResult = resolveValidator().validateHeaders(datasetName, headers);
    var seen = Object.create(null);
    var uniqueRows = [];
    var duplicateRowsCollapsed = 0;
    rows.forEach(function (row) {
      if (!Array.isArray(row) || row.length !== headers.length) {
        throw resolveErrorCodes().create('SOURCE_RAGGED_ROWS', {
          details: {
            actualColumns: Array.isArray(row) ? row.length : null,
            expectedColumns: headers.length,
          },
        });
      }
      var key = JSON.stringify(headerResult.canonicalHeaders.map(function (header) {
        return rawToken(row[headerResult.sourceIndexByCanonicalHeader[header]]);
      }));
      if (seen[key]) {
        duplicateRowsCollapsed += 1;
      } else {
        seen[key] = true;
        uniqueRows.push(row.slice());
      }
    });
    return {
      duplicateRowsCollapsed: duplicateRowsCollapsed,
      rows: uniqueRows,
    };
  }

  function rejectDivergentKeys(payload) {
    var schema = resolveRegistry().getSchema(payload.datasetName);
    if (!schema || schema.keyFields.length === 0) {
      return;
    }
    var seen = Object.create(null);
    payload.records.forEach(function (record) {
      var key = JSON.stringify(schema.keyFields.map(function (field) { return record[field]; }));
      if (seen[key]) {
        throw resolveErrorCodes().create('SOURCE_DIVERGENT_DUPLICATE_KEY', {
          details: {
            datasetName: payload.datasetName,
            keyField: schema.keyFields.join('+'),
          },
        });
      }
      seen[key] = true;
    });
  }

  function fromTable(options) {
    var input = options || {};
    if (!Array.isArray(input.values) || input.values.length < 2) {
      throw resolveErrorCodes().create('SOURCE_INVALID_TABLE', {
        details: { datasetName: input.datasetName || '' },
      });
    }
    var headers = input.values[0].slice();
    var collapsed = collapseExactRows(input.datasetName, headers, input.values.slice(1));
    var source = Object.assign({}, input.source || {}, {
      duplicateRowsCollapsed: collapsed.duplicateRowsCollapsed,
    });
    var payload = resolvePayload().create({
      datasetName: input.datasetName,
      headers: headers,
      rows: collapsed.rows,
      runMetadata: input.runMetadata,
      source: source,
    });
    rejectDivergentKeys(payload);
    return payload;
  }

  return Object.freeze({
    fromTable: fromTable,
    parseHtmlTable: parseHtmlTable,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DatasetAdapter;
}
