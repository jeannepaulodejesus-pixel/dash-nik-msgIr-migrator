/**
 * CXP-11 hosted parity run wiring.
 *
 * Binds the pure run engine to Drive (legacy export bundle), the migrated target
 * workbook (`_RAW_*` tables and Interval View metric outputs), the control
 * workbook (PARITY_RESULTS, SOURCE_ERROR_BASELINE, FILE_LEDGER), Script
 * Properties, LockService, and ScriptApp triggers.
 *
 * Editor entrypoints (parameterless unless noted):
 *   startCxp11ParityRun(exportFolderId?)
 *   continueCxp11ParityRun
 *   getCxp11ParityRunStatus
 *   resetCxp11ParityRunState
 */
var Cxp11ParityRun = (function () {
  'use strict';

  function resolveConfig() {
    if (typeof Config !== 'undefined') {
      return Config;
    }
    return require('../config/Config.js');
  }

  function resolveContracts() {
    if (typeof ParityContracts !== 'undefined') {
      return ParityContracts;
    }
    return require('../parity/ParityContracts.js');
  }

  function resolveEngineModule() {
    if (typeof ParityRunEngine !== 'undefined') {
      return ParityRunEngine;
    }
    return require('../parity/ParityRunEngine.js');
  }

  function resolveDatasetSheets() {
    if (typeof DatasetSheets !== 'undefined') {
      return DatasetSheets;
    }
    return require('../config/DatasetSheets.js');
  }

  function resolveReportingCatalog() {
    if (typeof ReportingSurfaceFormulaCatalog !== 'undefined') {
      return ReportingSurfaceFormulaCatalog;
    }
    return require('../transformations/ReportingSurfaceFormulaCatalog.js');
  }

  function resolveResultsRepository() {
    if (typeof ParityResultsRepository !== 'undefined') {
      return ParityResultsRepository;
    }
    return require('../repository/ParityResultsRepository.js');
  }

  function resolveBaselineRepository() {
    if (typeof SourceErrorBaselineRepository !== 'undefined') {
      return SourceErrorBaselineRepository;
    }
    return require('../repository/SourceErrorBaselineRepository.js');
  }

  function resolveLedgerRepository() {
    if (typeof FileLedgerRepository !== 'undefined') {
      return FileLedgerRepository;
    }
    return require('../repository/FileLedgerRepository.js');
  }

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function resolveExportAdapter() {
    if (typeof LegacyExportAdapter !== 'undefined') {
      return LegacyExportAdapter;
    }
    return require('../parity/LegacyExportAdapter.js');
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  /**
   * Reads exactly the contracted export files from one Drive folder. Extra files
   * in the folder are surfaced to the adapter, which fails closed on them.
   */
  function createDriveExportReader(services) {
    var dependencies = services || {};
    var driveApp = dependencies.driveApp ||
      (typeof DriveApp !== 'undefined' ? DriveApp : null);
    if (!driveApp || typeof driveApp.getFolderById !== 'function') {
      throw new Error('DriveApp is required to read the CXP-11 legacy export bundle.');
    }
    var contracts = dependencies.contracts || resolveContracts();

    function read(folderId) {
      var folder;
      try {
        folder = driveApp.getFolderById(folderId);
      } catch (error) {
        throw resolveErrorCodes().create('PARITY_EXPORT_FILE_MISSING', {
          cause: error,
          details: { reason: 'folder_unavailable' },
        });
      }
      var expected = contracts.listExportFileNames();
      var files = {};
      var iterator = folder.getFiles();
      while (iterator.hasNext()) {
        var file = iterator.next();
        var name = file.getName();
        if (expected.indexOf(name) === -1) {
          continue;
        }
        files[name] = file.getBlob().getDataAsString('UTF-8');
      }
      var manifestText = files[contracts.MANIFEST_FILE_NAME];
      if (typeof manifestText !== 'string') {
        throw resolveErrorCodes().create('PARITY_EXPORT_FILE_MISSING', {
          details: { fileName: contracts.MANIFEST_FILE_NAME },
        });
      }
      delete files[contracts.MANIFEST_FILE_NAME];
      return { files: files, manifestText: manifestText };
    }

    return Object.freeze({ read: read });
  }


  function sheetRowsToRecords(values) {
    if (!values || values.length === 0) {
      return { headers: [], rows: [] };
    }
    var headers = values[0].map(function (header) { return String(header).trim(); });
    var rows = [];
    var rowIndex;
    for (rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
      var row = values[rowIndex];
      var allBlank = row.every(function (cell) {
        return cell === '' || cell === null || cell === undefined;
      });
      if (allBlank) {
        continue;
      }
      var record = Object.create(null);
      headers.forEach(function (header, columnIndex) {
        var cell = row[columnIndex];
        record[header] = cell === null || cell === undefined ? '' : cell;
      });
      rows.push(record);
    }
    return { headers: headers, rows: rows };
  }

  function isDateObject(value) {
    return Object.prototype.toString.call(value) === '[object Date]' &&
      !Number.isNaN(value.getTime());
  }

  /**
   * CXP-10 v2 has no helper key columns (`INTERVAL_KEY_COLUMN` is null). The
   * visible PST axis lives in column C; the business date lives on AA2.
   */
  function pstAxisColumn(catalog) {
    var spec = typeof catalog.intervalViewSpec === 'function'
      ? catalog.intervalViewSpec()
      : null;
    if (
      spec &&
      spec.axisFormulas &&
      spec.axisFormulas[0] &&
      Number.isInteger(spec.axisFormulas[0].anchorColumn)
    ) {
      return spec.axisFormulas[0].anchorColumn;
    }
    return 3;
  }

  function businessDateFromAnchor(rawValue, displayValue) {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      var epoch = Date.UTC(1899, 11, 30);
      var date = new Date(epoch + Math.floor(rawValue) * 86400000);
      return date.getUTCFullYear() +
        '-' + pad2(date.getUTCMonth() + 1) +
        '-' + pad2(date.getUTCDate());
    }
    if (isDateObject(rawValue)) {
      return rawValue.getFullYear() +
        '-' + pad2(rawValue.getMonth() + 1) +
        '-' + pad2(rawValue.getDate());
    }
    var text = String(displayValue || rawValue || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
      return text.slice(0, 10);
    }
    var mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (mdy) {
      return mdy[3] + '-' + pad2(mdy[1]) + '-' + pad2(mdy[2]);
    }
    return text;
  }

  function intervalFromAxis(rawValue, displayValue) {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      var minutes = Math.round(((rawValue % 1) + 1) % 1 * 24 * 60);
      return pad2(Math.floor(minutes / 60) % 24) + ':' + pad2(minutes % 60);
    }
    if (isDateObject(rawValue)) {
      return pad2(rawValue.getHours()) + ':' + pad2(rawValue.getMinutes());
    }
    var display = String(displayValue || rawValue || '').trim();
    var timeMatch = display.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      return pad2(timeMatch[1]) + ':' + timeMatch[2];
    }
    return display;
  }

  function normalizeMetricCell(rawValue, displayValue) {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return rawValue;
    }
    if (Object.prototype.toString.call(rawValue) === '[object Date]') {
      // Duration-formatted metrics render as h:mm:ss; store the day fraction.
      var text = String(displayValue || '').trim();
      var match = text.match(/^(-)?(\d+):([0-5]\d)(?::([0-5]\d(?:\.\d+)?))?$/);
      if (match) {
        var seconds = Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4] || 0);
        return (match[1] ? -1 : 1) * seconds / 86400;
      }
      return text;
    }
    if (rawValue === '' || rawValue === null || rawValue === undefined) {
      return '';
    }
    return String(rawValue);
  }

  /**
   * Reads the migrated side: normalized `_RAW_*` tables plus the 25 Interval View
   * metric outputs as long-form records at the interval grain.
   */
  function createTargetReader(spreadsheet, services) {
    var dependencies = services || {};
    var catalog = dependencies.catalog || resolveReportingCatalog();
    var datasetSheets = dependencies.datasetSheets || resolveDatasetSheets();
    var metricHeaders = catalog.METRIC_HEADERS.slice();
    var intervalSheetName = dependencies.intervalSheetName || 'Interval View';
    var aggregationIdentity = dependencies.aggregationIdentity || 'INTERVAL_VIEW';
    var site = dependencies.site || 'ALL';
    var queueOrLob = dependencies.queueOrLob || 'ALL';

    function readDataset(datasetName) {
      var binding = datasetSheets.getByDatasetName(datasetName);
      var sheet = spreadsheet.getSheetByName(binding.rawSheetName);
      if (!sheet) {
        return { headers: [], rows: [] };
      }
      var parsed = sheetRowsToRecords(sheet.getDataRange().getValues());
      var canonical = resolveExportAdapter().canonicalizeDataset(datasetName, parsed);
      return {
        headers: canonical.headers,
        rows: canonical.rows,
      };
    }

    function readMetrics() {
      var sheet = spreadsheet.getSheetByName(intervalSheetName);
      if (!sheet) {
        return [];
      }
      var firstColumn = pstAxisColumn(catalog);
      var lastColumn = catalog.METRIC_COLUMNS[metricHeaders[metricHeaders.length - 1]];
      var dateAnchor = typeof catalog.intervalViewSpec === 'function'
        ? catalog.intervalViewSpec().businessDayAnchor
        : { column: catalog.VIEW_DATE_COLUMN, row: catalog.VIEW_DATE_ROW };
      var dateCell = sheet.getRange(dateAnchor.row, dateAnchor.column);
      var businessDate = businessDateFromAnchor(
        dateCell.getValue ? dateCell.getValue() : dateCell.getValues()[0][0],
        typeof dateCell.getDisplayValue === 'function'
          ? dateCell.getDisplayValue()
          : '',
      );
      var range = sheet.getRange(
        catalog.FIRST_DATA_ROW,
        firstColumn,
        catalog.LAST_DATA_ROW - catalog.FIRST_DATA_ROW + 1,
        lastColumn - firstColumn + 1,
      );
      var rawValues = range.getValues();
      var displayValues = typeof range.getDisplayValues === 'function'
        ? range.getDisplayValues()
        : rawValues;
      var records = [];
      rawValues.forEach(function (row, rowIndex) {
        var intervalStart = intervalFromAxis(row[0], displayValues[rowIndex][0]);
        if (!intervalStart) {
          return;
        }
        metricHeaders.forEach(function (metricName) {
          var columnOffset = catalog.METRIC_COLUMNS[metricName] - firstColumn;
          records.push({
            aggregationIdentity: aggregationIdentity,
            businessDate: businessDate,
            intervalStart: intervalStart,
            metric: metricName,
            queueOrLob: queueOrLob,
            site: site,
            value: normalizeMetricCell(
              row[columnOffset],
              displayValues[rowIndex][columnOffset],
            ),
          });
        });
      });
      return records;
    }

    return Object.freeze({ readDataset: readDataset, readMetrics: readMetrics });
  }

  function resolveProperties(properties) {
    if (properties && typeof properties.getProperty === 'function') {
      return properties;
    }
    if (
      typeof PropertiesService !== 'undefined' &&
      PropertiesService &&
      typeof PropertiesService.getScriptProperties === 'function'
    ) {
      return PropertiesService.getScriptProperties();
    }
    throw new Error('Script Properties are required for the CXP-11 parity run.');
  }

  function buildEngine(options) {
    var request = options || {};
    if (request.engine) {
      return request.engine;
    }
    var properties = resolveProperties(request.properties);
    var configuration = resolveConfig().load(properties);
    var targetId = configuration.targetSpreadsheetId;
    var controlId = configuration.controlSpreadsheetId;
    if (!targetId || !controlId) {
      throw new Error(
        'CXP-11 requires both target and control spreadsheet IDs for the active environment.',
      );
    }
    var spreadsheetApp = request.spreadsheetApp ||
      (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp : null);
    if (!spreadsheetApp || typeof spreadsheetApp.openById !== 'function') {
      throw new Error('SpreadsheetApp.openById is required for the CXP-11 parity run.');
    }
    var target = spreadsheetApp.openById(targetId);
    var control = spreadsheetApp.openById(controlId);
    return resolveEngineModule().create({
      baseline: resolveBaselineRepository().create(control),
      clock: request.clock || { now: function () { return new Date(); } },
      controlSpreadsheetId: controlId,
      environment: configuration.environment,
      exportFolderId: configuration.legacyParityExportFolderId,
      exportReader: request.exportReader || createDriveExportReader({
        driveApp: request.driveApp,
      }),
      ledger: resolveLedgerRepository().create(control),
      lockService: request.lockService ||
        (typeof LockService !== 'undefined' ? LockService : null),
      properties: properties,
      results: resolveResultsRepository().create(control),
      scriptApp: request.scriptApp || (typeof ScriptApp !== 'undefined' ? ScriptApp : null),
      targetReader: request.targetReader || createTargetReader(target),
      targetSpreadsheetId: targetId,
    });
  }

  function start(exportFolderId, options) {
    return buildEngine(options).start({ exportFolderId: exportFolderId });
  }

  function continueRun(options) {
    return buildEngine(options).continueRun();
  }

  function getStatus(options) {
    return buildEngine(options).status();
  }

  function reset(options) {
    var request = options || {};
    return buildEngine(request).reset({ force: request.force === true });
  }


  return Object.freeze({
    buildEngine: buildEngine,
    continueRun: continueRun,
    createDriveExportReader: createDriveExportReader,
    createTargetReader: createTargetReader,
    getStatus: getStatus,
    reset: reset,
    start: start,
  });
})();

function logCxp11RunPublic(tag, payload) {
  var line = tag + ' ' + JSON.stringify(payload || {});
  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    console.log(line);
  }
  if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
    Logger.log(line);
  }
}

/**
 * Starts a CXP-11 parity run. Pass a Drive folder ID to override the configured
 * `CXP_<ENV>_LEGACY_PARITY_EXPORT_FOLDER_ID`; omit it to fail closed unless the
 * active-environment property exists.
 */
function startCxp11ParityRun(exportFolderId) {
  logCxp11RunPublic('CXP11_RUN', { event: 'START', mode: 'start' });
  try {
    var result = Cxp11ParityRun.start(exportFolderId);
    logCxp11RunPublic('CXP11_RUN', {
      continuationScheduled: result.continuationScheduled,
      event: 'RETURN',
      mode: 'start',
      runId: result.runId,
      runState: result.runState,
    });
    return result;
  } catch (error) {
    logCxp11RunPublic('CXP11_RUN', {
      code: error && error.code ? String(error.code) : null,
      event: 'ERROR',
      message: error && error.message ? String(error.message) : String(error),
      mode: 'start',
    });
    throw error;
  }
}


function continueCxp11ParityRun() {
  logCxp11RunPublic('CXP11_RUN', { event: 'START', mode: 'continue' });
  try {
    var result = Cxp11ParityRun.continueRun();
    logCxp11RunPublic('CXP11_RUN', {
      continuationScheduled: result.continuationScheduled,
      event: 'RETURN',
      mode: 'continue',
      runState: result.runState,
    });
    return result;
  } catch (error) {
    logCxp11RunPublic('CXP11_RUN', {
      code: error && error.code ? String(error.code) : null,
      event: 'ERROR',
      message: error && error.message ? String(error.message) : String(error),
      mode: 'continue',
    });
    throw error;
  }
}

function getCxp11ParityRunStatus() {
  var status = Cxp11ParityRun.getStatus();
  logCxp11RunPublic('CXP11_RUN_STATUS', {
    evaluatedDatasetCount: status.evaluatedDatasetCount,
    evaluatedMetricCount: status.evaluatedMetricCount,
    runState: status.runState,
    summary: status.summary,
  });
  return status;
}

function resetCxp11ParityRunState() {
  logCxp11RunPublic('CXP11_RUN', { event: 'START', mode: 'reset' });
  try {
    var result = Cxp11ParityRun.reset();
    logCxp11RunPublic('CXP11_RUN', {
      cleared: result.cleared,
      event: 'RETURN',
      mode: 'reset',
      stateKey: result.stateKey,
    });
    return result;
  } catch (error) {
    logCxp11RunPublic('CXP11_RUN', {
      code: error && error.code ? String(error.code) : null,
      event: 'ERROR',
      message: error && error.message ? String(error.message) : String(error),
      mode: 'reset',
    });
    throw error;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp11ParityRun;
}
