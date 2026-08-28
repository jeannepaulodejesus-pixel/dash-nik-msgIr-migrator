/**
 * Row-1 headers (and SCHEMA_REGISTRY seed rows) for the seven CXP-02 control tabs.
 * CXP-04 owns RUN_LOG/ERROR_LOG; CXP-05 owns FILE_LEDGER; CXP-03 owns SCHEMA_REGISTRY.
 * WEEK_REGISTRY, PARITY_RESULTS, and SOURCE_ERROR_BASELINE use provisional headers until
 * CXP-11/CXP-12 land their write contracts.
 */
var ControlWorkbookHeaders = (function () {
  'use strict';

  var PROVISIONAL_WEEK_REGISTRY_HEADERS = Object.freeze([
    'Week Key',
    'Target Spreadsheet ID',
    'Master Template Spreadsheet ID',
    'Registered At UTC',
    'Status',
    'Notes',
  ]);
  var PROVISIONAL_PARITY_RESULTS_HEADERS = Object.freeze([
    'Run ID',
    'Business Date',
    'Interval Start',
    'Site',
    'Queue Or LOB',
    'Metric Name',
    'Source Value',
    'Target Value',
    'Delta',
    'Tolerance',
    'Lineage JSON',
    'Classification',
    'Resolution Status',
    'Compared At UTC',
  ]);
  var PROVISIONAL_SOURCE_ERROR_BASELINE_HEADERS = Object.freeze([
    'Worksheet Name',
    'Cell Reference',
    'Cached Value',
    'Error Type',
    'Classification',
    'Treatment',
    'Resolution Status',
    'Notes',
  ]);

  function resolveRunLogger() {
    if (typeof RunLogger !== 'undefined') {
      return RunLogger;
    }
    return require('../monitoring/RunLogger.js');
  }

  function resolveErrorLogger() {
    if (typeof ErrorLogger !== 'undefined') {
      return ErrorLogger;
    }
    return require('../monitoring/ErrorLogger.js');
  }

  function resolveFileLedgerRepository() {
    if (typeof FileLedgerRepository !== 'undefined') {
      return FileLedgerRepository;
    }
    return require('../repository/FileLedgerRepository.js');
  }

  function resolveSchemaRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return require('../ingestion/SchemaRegistry.js');
  }

  function resolveSheetNames() {
    if (typeof SheetNames !== 'undefined') {
      return SheetNames;
    }
    return require('../config/SheetNames.js');
  }

  function headersBySheetName() {
    var registry = resolveSchemaRegistry();
    var ledger = resolveFileLedgerRepository();
    return Object.freeze({
      ERROR_LOG: resolveErrorLogger().HEADERS,
      FILE_LEDGER: ledger.HEADERS,
      PARITY_RESULTS: PROVISIONAL_PARITY_RESULTS_HEADERS,
      RUN_LOG: resolveRunLogger().HEADERS,
      SCHEMA_REGISTRY: registry.REGISTRY_RECORD_HEADERS,
      SOURCE_ERROR_BASELINE: PROVISIONAL_SOURCE_ERROR_BASELINE_HEADERS,
      WEEK_REGISTRY: PROVISIONAL_WEEK_REGISTRY_HEADERS,
    });
  }

  function buildSchemaRegistryRows(registry) {
    return registry.listSchemas().map(function (schema) {
      return [
        schema.version,
        schema.name,
        'ACTIVE',
        JSON.stringify(schema.requiredHeaders),
        JSON.stringify(schema.optionalHeaders || []),
        JSON.stringify(schema.keyFields || []),
        schema.rowVolume.minimum,
        schema.rowVolume.maximum,
      ];
    });
  }

  function writeHeaderRow(sheet, headers) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers.slice()]);
  }

  function seed(spreadsheet, options) {
    var opts = options || {};
    var overwrite = opts.overwrite === true;
    var headersForSheets = headersBySheetName();
    var registry = resolveSchemaRegistry();
    var seeded = [];

    resolveSheetNames().CONTROL.forEach(function (sheetName) {
      var sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        throw new Error('Control sheet missing after CXP-02 init: ' + sheetName);
      }
      var lastRow =
        typeof sheet.getLastRow === 'function' ? sheet.getLastRow() : 0;
      if (!overwrite && lastRow > 0) {
        return;
      }
      var headers = headersForSheets[sheetName];
      if (!headers) {
        throw new Error('No control headers defined for sheet: ' + sheetName);
      }
      writeHeaderRow(sheet, headers);
      if (sheetName === 'SCHEMA_REGISTRY') {
        var rows = buildSchemaRegistryRows(registry);
        if (rows.length > 0) {
          sheet
            .getRange(2, 1, rows.length, headers.length)
            .setValues(rows);
        }
      }
      seeded.push(sheetName);
    });

    return Object.freeze({
      seededControlSheets: Object.freeze(seeded.slice()),
    });
  }

  return Object.freeze({
    PROVISIONAL_PARITY_RESULTS_HEADERS: PROVISIONAL_PARITY_RESULTS_HEADERS,
    PROVISIONAL_SOURCE_ERROR_BASELINE_HEADERS:
      PROVISIONAL_SOURCE_ERROR_BASELINE_HEADERS,
    PROVISIONAL_WEEK_REGISTRY_HEADERS: PROVISIONAL_WEEK_REGISTRY_HEADERS,
    buildSchemaRegistryRows: buildSchemaRegistryRows,
    headersBySheetName: headersBySheetName,
    seed: seed,
  });
})();

function seedCxpControlWorkbookHeaders(spreadsheetId, overwrite) {
  var configModule =
    typeof Config !== 'undefined' ? Config : require('../config/Config.js');
  var configuration = configModule.load();
  var resolvedId =
    typeof spreadsheetId === 'string' && spreadsheetId.trim()
      ? spreadsheetId.trim()
      : configuration.controlSpreadsheetId;
  if (!resolvedId) {
    throw new Error(
      'Control spreadsheet ID is required (argument or CXP_<ENV>_CONTROL_SPREADSHEET_ID).',
    );
  }
  if (
    typeof SpreadsheetApp === 'undefined' ||
    typeof SpreadsheetApp.openById !== 'function'
  ) {
    throw new Error('SpreadsheetApp.openById is required to seed control headers.');
  }
  return ControlWorkbookHeaders.seed(SpreadsheetApp.openById(resolvedId), {
    overwrite: overwrite === true,
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ControlWorkbookHeaders;
}
