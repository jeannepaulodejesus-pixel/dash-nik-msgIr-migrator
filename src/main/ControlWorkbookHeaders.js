/**
 * Row-1 headers (and SCHEMA_REGISTRY seed rows) for the seven CXP-02 control tabs.
 * CXP-04 owns RUN_LOG/ERROR_LOG; CXP-05 owns FILE_LEDGER; CXP-03 owns SCHEMA_REGISTRY;
 * CXP-11 owns the final PARITY_RESULTS and SOURCE_ERROR_BASELINE contracts.
 * CXP-12 owns the final WEEK_REGISTRY write contract.
 *
 * Apps Script has no require(). Keep final WEEK_REGISTRY headers inline so this
 * module can load before WeekRegistryRepository in clasp file order, and only
 * call require() under Node.
 */
var ControlWorkbookHeaders = (function () {
  'use strict';

  // Must stay aligned with WeekRegistryRepository.HEADERS (CXP-12 contract 1.0.0).
  var WEEK_REGISTRY_HEADERS = Object.freeze([
    'Week Key',
    'Target Spreadsheet ID',
    'Master Template Spreadsheet ID',
    'Registered At UTC',
    'Activated At UTC',
    'Status',
    'Notes',
  ]);

  function nodeRequire(path) {
    if (typeof require === 'function') {
      return require(path);
    }
    return null;
  }

  function resolveParityResultsRepository() {
    if (typeof ParityResultsRepository !== 'undefined') {
      return ParityResultsRepository;
    }
    return nodeRequire('../repository/ParityResultsRepository.js');
  }

  function resolveSourceErrorBaselineRepository() {
    if (typeof SourceErrorBaselineRepository !== 'undefined') {
      return SourceErrorBaselineRepository;
    }
    return nodeRequire('../repository/SourceErrorBaselineRepository.js');
  }

  function resolveWeekRegistryHeaders() {
    if (typeof WeekRegistryRepository !== 'undefined' && WeekRegistryRepository.HEADERS) {
      return WeekRegistryRepository.HEADERS;
    }
    var repo = nodeRequire('../repository/WeekRegistryRepository.js');
    if (repo && repo.HEADERS) {
      return repo.HEADERS;
    }
    return WEEK_REGISTRY_HEADERS;
  }

  function resolveRunLogger() {
    if (typeof RunLogger !== 'undefined') {
      return RunLogger;
    }
    return nodeRequire('../monitoring/RunLogger.js');
  }

  function resolveErrorLogger() {
    if (typeof ErrorLogger !== 'undefined') {
      return ErrorLogger;
    }
    return nodeRequire('../monitoring/ErrorLogger.js');
  }

  function resolveFileLedgerRepository() {
    if (typeof FileLedgerRepository !== 'undefined') {
      return FileLedgerRepository;
    }
    return nodeRequire('../repository/FileLedgerRepository.js');
  }

  function resolveSchemaRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return nodeRequire('../ingestion/SchemaRegistry.js');
  }

  function resolveSheetNames() {
    if (typeof SheetNames !== 'undefined') {
      return SheetNames;
    }
    return nodeRequire('../config/SheetNames.js');
  }

  function headersBySheetName() {
    var registry = resolveSchemaRegistry();
    var ledger = resolveFileLedgerRepository();
    return Object.freeze({
      ERROR_LOG: resolveErrorLogger().HEADERS,
      FILE_LEDGER: ledger.HEADERS,
      PARITY_RESULTS: resolveParityResultsRepository().HEADERS,
      RUN_LOG: resolveRunLogger().HEADERS,
      SCHEMA_REGISTRY: registry.REGISTRY_RECORD_HEADERS,
      SOURCE_ERROR_BASELINE: resolveSourceErrorBaselineRepository().HEADERS,
      WEEK_REGISTRY: resolveWeekRegistryHeaders(),
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
    WEEK_REGISTRY_HEADERS: WEEK_REGISTRY_HEADERS,
    // Back-compat alias; values are the final CXP-12 contract, not the old 6-column shell.
    PROVISIONAL_WEEK_REGISTRY_HEADERS: WEEK_REGISTRY_HEADERS,
    buildSchemaRegistryRows: buildSchemaRegistryRows,
    headersBySheetName: headersBySheetName,
    seed: seed,
  });
})();

function seedCxpControlWorkbookHeaders(spreadsheetId, overwrite) {
  var configModule = typeof Config !== 'undefined' ? Config : null;
  if (!configModule && typeof require === 'function') {
    configModule = require('../config/Config.js');
  }
  if (!configModule) {
    throw new Error('Config is required to seed control headers.');
  }
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
