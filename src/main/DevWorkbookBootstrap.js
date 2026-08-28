/**
 * DEV-only automation: create target + control workbooks in a Drive folder,
 * store their IDs in Script Properties, run CXP-02 sheet init, seed CXP-03
 * headers on the five raw sheets, and seed CXP-04/CXP-05 control headers so
 * CXP-07/CXP-08 install preflight and hosted UAT audit writes can pass.
 *
 * Editor entrypoints:
 *   bootstrapCxpDevWorkbooks()                    // folder from CXP_DEV_BOOTSTRAP_FOLDER_ID
 *   bootstrapCxpDevWorkbooks(folderId)            // optional folder ID argument
 *   bootstrapCxpDevWorkbooksForceReplace()        // forceReplace=true; folder from property
 *   registerCxpDevWorkbookIds(targetId, controlId) // set Script Properties for existing workbooks
 *   registerCxpDevWorkbooksFromFolder(folderId?)  // discover by folder + set Script Properties
 *   registerCxpDevWorkbooksFromFolderAndSeed()    // folder from property; init + seed headers
 *   listCxpUatSourceFiles()                       // list configured CXP_UAT_* Drive files
 *   listCxpUatFilesIfFound()                      // alias for listCxpUatSourceFiles()
 *   scanCxpUatSourceFileValidation()              // scan all five UAT sources for schema/type errors
 *   repairCxpUatSourceFiles(updateProperties?)    // export Fixed-*.xlsx sources; optional property update
 *
 * Never commits IDs to source. Refuses PROD. Refuses overwrite of existing
 * CXP_DEV_* spreadsheet IDs unless forceReplace is true.
 */
var DevWorkbookBootstrap = (function () {
  'use strict';

  var BOOTSTRAP_FOLDER_PROPERTY = 'CXP_DEV_BOOTSTRAP_FOLDER_ID';
  var TARGET_WORKBOOK_NAME = 'DEV_TARGET_WORKBOOK';
  var CONTROL_WORKBOOK_NAME = 'DEV_SYSTEM_CONTROL_WORKBOOK';
  var ENVIRONMENT = 'DEV';

  function resolveConfig() {
    if (typeof Config !== 'undefined') {
      return Config;
    }
    return require('../config/Config.js');
  }

  function resolveSchemaRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return require('../ingestion/SchemaRegistry.js');
  }

  function resolveDatasetSheets() {
    if (typeof DatasetSheets !== 'undefined') {
      return DatasetSheets;
    }
    return require('../config/DatasetSheets.js');
  }

  function resolveWorkbookSetup() {
    if (typeof WorkbookSetup !== 'undefined') {
      return WorkbookSetup;
    }
    return require('./WorkbookSetup.js');
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
    throw new Error('Script Properties are required for DEV workbook bootstrap.');
  }

  function resolveServices(services) {
    if (services) {
      return services;
    }
    return {
      driveApp: typeof DriveApp !== 'undefined' ? DriveApp : null,
      session: typeof Session !== 'undefined' ? Session : null,
      spreadsheetApp: typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp : null,
    };
  }

  function emitLog(tag, payload) {
    var line = tag + ' ' + JSON.stringify(payload || {});
    if (typeof console !== 'undefined' && typeof console.log === 'function') {
      console.log(line);
    }
    if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
      Logger.log(line);
    }
  }

  function requireNonEmptyString(value, label) {
    var normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
      throw new Error(label + ' is required.');
    }
    return normalized;
  }

  function resolveFolderId(folderId, properties) {
    if (folderId && typeof folderId === 'string' && folderId.trim()) {
      return folderId.trim();
    }
    return requireNonEmptyString(
      properties.getProperty(BOOTSTRAP_FOLDER_PROPERTY),
      BOOTSTRAP_FOLDER_PROPERTY + ' (or folderId argument)',
    );
  }

  function assertDevOnly(properties) {
    var env = properties.getProperty(resolveConfig().ACTIVE_ENVIRONMENT_KEY);
    if (env && String(env).trim().toUpperCase() === 'PROD') {
      throw new Error('DEV workbook bootstrap refuses CXP_ENV=PROD.');
    }
  }

  function parseSpreadsheetId(value, label) {
    var normalized = requireNonEmptyString(value, label);
    var match = normalized.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match) {
      return match[1];
    }
    return normalized;
  }

  function devWorkbookPropertyKeys(config) {
    return {
      controlKey: config.propertyKey(ENVIRONMENT, config.CONFIGURATION_KEYS.controlSpreadsheetId),
      targetKey: config.propertyKey(ENVIRONMENT, config.CONFIGURATION_KEYS.targetSpreadsheetId),
    };
  }

  function writeDevWorkbookProperties(properties, targetId, controlId) {
    var config = resolveConfig();
    var keys = devWorkbookPropertyKeys(config);
    if (targetId === controlId) {
      throw new Error('Target and control spreadsheet IDs must be distinct.');
    }
    properties.setProperty(config.ACTIVE_ENVIRONMENT_KEY, ENVIRONMENT);
    properties.setProperty(keys.targetKey, targetId);
    properties.setProperty(keys.controlKey, controlId);
    return keys;
  }

  function assertSpreadsheetsOpen(targetId, controlId, services) {
    if (
      !services.spreadsheetApp ||
      typeof services.spreadsheetApp.openById !== 'function'
    ) {
      return;
    }
    services.spreadsheetApp.openById(targetId);
    services.spreadsheetApp.openById(controlId);
  }

  function findUniqueSpreadsheetInFolder(folder, name) {
    if (!folder || typeof folder.getFilesByName !== 'function') {
      throw new Error('Drive folder lookup requires getFilesByName.');
    }
    var iterator = folder.getFilesByName(name);
    if (!iterator.hasNext()) {
      throw new Error(
        'Expected spreadsheet "' +
          name +
          '" in bootstrap folder. Run bootstrapCxpDevWorkbooks() first.',
      );
    }
    var file = iterator.next();
    if (iterator.hasNext()) {
      throw new Error('Multiple spreadsheets named "' + name + '" in bootstrap folder.');
    }
    if (!file || typeof file.getId !== 'function') {
      throw new Error('Spreadsheet file lookup failed for "' + name + '".');
    }
    return file.getId();
  }

  function discoverWorkbooksInFolder(folder) {
    return Object.freeze({
      controlSpreadsheetId: findUniqueSpreadsheetInFolder(
        folder,
        CONTROL_WORKBOOK_NAME,
      ),
      targetSpreadsheetId: findUniqueSpreadsheetInFolder(folder, TARGET_WORKBOOK_NAME),
    });
  }

  function registerWorkbooksFromFolder(folderId, options, properties, services) {
    var opts = options || {};
    var resolvedProperties = resolveProperties(properties);
    var resolvedServices = resolveServices(services);

    assertDevOnly(resolvedProperties);
    var resolvedFolderId = resolveFolderId(folderId, resolvedProperties);
    if (
      !resolvedServices.driveApp ||
      typeof resolvedServices.driveApp.getFolderById !== 'function'
    ) {
      throw new Error('DriveApp.getFolderById is required for folder registration.');
    }
    var folder = resolvedServices.driveApp.getFolderById(resolvedFolderId);
    if (!folder) {
      throw new Error('Bootstrap Drive folder was not found.');
    }
    var discovered = discoverWorkbooksInFolder(folder);
    resolvedProperties.setProperty(BOOTSTRAP_FOLDER_PROPERTY, resolvedFolderId);
    emitLog('CXP_DEV_REGISTER', {
      event: 'DISCOVERED_FROM_FOLDER',
      initializeAndSeed: opts.initializeAndSeed === true,
    });
    return registerWorkbookIds(
      discovered.targetSpreadsheetId,
      discovered.controlSpreadsheetId,
      opts,
      resolvedProperties,
      resolvedServices,
    );
  }

  function registerWorkbookIds(targetSpreadsheetId, controlSpreadsheetId, options, properties, services) {
    var opts = options || {};
    var resolvedProperties = resolveProperties(properties);
    var resolvedServices = resolveServices(services);

    assertDevOnly(resolvedProperties);
    var targetId = parseSpreadsheetId(targetSpreadsheetId, 'targetSpreadsheetId');
    var controlId = parseSpreadsheetId(controlSpreadsheetId, 'controlSpreadsheetId');
    assertSpreadsheetsOpen(targetId, controlId, resolvedServices);
    writeDevWorkbookProperties(resolvedProperties, targetId, controlId);

    emitLog('CXP_DEV_REGISTER', {
      event: 'PROPERTIES_SET',
      initializeAndSeed: opts.initializeAndSeed === true,
    });

    var skeleton = null;
    var seededRawSheets = Object.freeze([]);
    var seededControlSheets = Object.freeze([]);
    if (opts.initializeAndSeed === true) {
      skeleton = resolveWorkbookSetup().initializeConfiguredWorkbooks(
        resolvedProperties,
        resolvedServices,
      );
      var target = resolvedServices.spreadsheetApp.openById(targetId);
      var control = resolvedServices.spreadsheetApp.openById(controlId);
      removeDefaultSheetIfPresent(target);
      removeDefaultSheetIfPresent(control);
      seededRawSheets = Object.freeze(seedRawHeaders(target));
      seededControlSheets = Object.freeze(seedControlHeaders(control));
    }

    return Object.freeze({
      controlSpreadsheetId: controlId,
      environment: ENVIRONMENT,
      seededControlSheets: seededControlSheets,
      seededRawSheets: seededRawSheets,
      skeleton: skeleton,
      targetSpreadsheetId: targetId,
    });
  }

  function assertIdsReplaceable(properties, forceReplace) {
    var keys = devWorkbookPropertyKeys(resolveConfig());
    var existingTarget = properties.getProperty(keys.targetKey);
    var existingControl = properties.getProperty(keys.controlKey);
    if (
      !forceReplace &&
      ((existingTarget && String(existingTarget).trim()) ||
        (existingControl && String(existingControl).trim()))
    ) {
      throw new Error(
        'CXP_DEV_TARGET_SPREADSHEET_ID or CXP_DEV_CONTROL_SPREADSHEET_ID is already set. ' +
          'Pass forceReplace=true to create replacements, or clear those Script Properties first.',
      );
    }
    return keys;
  }

  function createSpreadsheetInFolder(name, folder, services) {
    if (
      !services.spreadsheetApp ||
      typeof services.spreadsheetApp.create !== 'function'
    ) {
      throw new Error('SpreadsheetApp.create is required for DEV workbook bootstrap.');
    }
    if (!folder || typeof folder.getId !== 'function') {
      throw new Error('A Drive folder is required for DEV workbook bootstrap.');
    }
    var spreadsheet = services.spreadsheetApp.create(name);
    var fileId = spreadsheet.getId();
    if (services.driveApp && typeof services.driveApp.getFileById === 'function') {
      var file = services.driveApp.getFileById(fileId);
      if (file && typeof file.moveTo === 'function') {
        file.moveTo(folder);
      } else if (folder && typeof folder.addFile === 'function' && file) {
        // Legacy DriveApp path for older runtimes / fakes.
        folder.addFile(file);
        var parents = file.getParents && file.getParents();
        if (parents && typeof parents.hasNext === 'function') {
          while (parents.hasNext()) {
            var parent = parents.next();
            if (parent.getId() !== folder.getId() && typeof parent.removeFile === 'function') {
              parent.removeFile(file);
            }
          }
        }
      }
    }
    return spreadsheet;
  }

  function removeDefaultSheetIfPresent(spreadsheet) {
    var sheet = spreadsheet.getSheetByName('Sheet1');
    if (
      sheet &&
      typeof spreadsheet.getSheets === 'function' &&
      spreadsheet.getSheets().length > 1 &&
      typeof spreadsheet.deleteSheet === 'function'
    ) {
      spreadsheet.deleteSheet(sheet);
    }
  }

  function resolveControlWorkbookHeaders() {
    if (typeof ControlWorkbookHeaders !== 'undefined') {
      return ControlWorkbookHeaders;
    }
    return require('./ControlWorkbookHeaders.js');
  }

  function seedControlHeaders(spreadsheet) {
    return resolveControlWorkbookHeaders().seed(spreadsheet).seededControlSheets;
  }

  function seedRawHeaders(spreadsheet) {
    var seeded = [];
    resolveDatasetSheets().listBindings().forEach(function (binding) {
      var schema = resolveSchemaRegistry().getSchema(binding.datasetName);
      var sheet = spreadsheet.getSheetByName(binding.rawSheetName);
      if (!sheet) {
        throw new Error('Raw sheet missing after CXP-02 init: ' + binding.rawSheetName);
      }
      sheet.getRange(1, 1, 1, schema.requiredHeaders.length).setValues([
        schema.requiredHeaders.slice(),
      ]);
      seeded.push(binding.rawSheetName);
    });
    return seeded;
  }

  function bootstrap(folderId, options, properties, services) {
    var opts = options || {};
    var forceReplace = opts.forceReplace === true;
    var resolvedProperties = resolveProperties(properties);
    var resolvedServices = resolveServices(services);

    assertDevOnly(resolvedProperties);
    assertIdsReplaceable(resolvedProperties, forceReplace);
    var resolvedFolderId = resolveFolderId(folderId, resolvedProperties);

    if (!resolvedServices.driveApp || typeof resolvedServices.driveApp.getFolderById !== 'function') {
      throw new Error('DriveApp.getFolderById is required for DEV workbook bootstrap.');
    }
    var folder = resolvedServices.driveApp.getFolderById(resolvedFolderId);
    if (!folder) {
      throw new Error('Bootstrap Drive folder was not found.');
    }

    emitLog('CXP_DEV_BOOTSTRAP', {
      event: 'START',
      folderIdPresent: true,
      forceReplace: forceReplace,
    });

    var target = createSpreadsheetInFolder(
      TARGET_WORKBOOK_NAME,
      folder,
      resolvedServices,
    );
    var control = createSpreadsheetInFolder(
      CONTROL_WORKBOOK_NAME,
      folder,
      resolvedServices,
    );
    var targetId = target.getId();
    var controlId = control.getId();
    if (targetId === controlId) {
      throw new Error('Bootstrap created identical spreadsheet IDs.');
    }

    resolvedProperties.setProperty(BOOTSTRAP_FOLDER_PROPERTY, resolvedFolderId);

    writeDevWorkbookProperties(resolvedProperties, targetId, controlId);

    var skeleton = resolveWorkbookSetup().initializeConfiguredWorkbooks(
      resolvedProperties,
      resolvedServices,
    );
    removeDefaultSheetIfPresent(target);
    removeDefaultSheetIfPresent(control);
    var seededRawSheets = seedRawHeaders(target);
    var seededControlSheets = seedControlHeaders(control);

    var result = Object.freeze({
      controlSpreadsheetId: controlId,
      environment: ENVIRONMENT,
      folderId: resolvedFolderId,
      seededControlSheets: Object.freeze(seededControlSheets.slice()),
      seededRawSheets: Object.freeze(seededRawSheets.slice()),
      skeleton: skeleton,
      targetSpreadsheetId: targetId,
    });
    emitLog('CXP_DEV_BOOTSTRAP', {
      event: 'COMPLETE',
      environment: result.environment,
      seededControlSheetCount: result.seededControlSheets.length,
      seededRawSheetCount: result.seededRawSheets.length,
      targetName: TARGET_WORKBOOK_NAME,
      controlName: CONTROL_WORKBOOK_NAME,
      // IDs omitted from logs intentionally.
    });
    return result;
  }

  return Object.freeze({
    BOOTSTRAP_FOLDER_PROPERTY: BOOTSTRAP_FOLDER_PROPERTY,
    CONTROL_WORKBOOK_NAME: CONTROL_WORKBOOK_NAME,
    ENVIRONMENT: ENVIRONMENT,
    TARGET_WORKBOOK_NAME: TARGET_WORKBOOK_NAME,
    bootstrap: bootstrap,
    discoverWorkbooksInFolder: discoverWorkbooksInFolder,
    parseSpreadsheetId: parseSpreadsheetId,
    registerWorkbookIds: registerWorkbookIds,
    registerWorkbooksFromFolder: registerWorkbooksFromFolder,
  });
})();

/**
 * @param {string=} folderId Drive folder ID (optional if CXP_DEV_BOOTSTRAP_FOLDER_ID is set)
 * @param {boolean=} forceReplace recreate even when DEV spreadsheet IDs already exist
 */
function bootstrapCxpDevWorkbooks(folderId, forceReplace) {
  return DevWorkbookBootstrap.bootstrap(folderId, {
    forceReplace: forceReplace === true,
  });
}

function bootstrapCxpDevWorkbooksForceReplace() {
  return bootstrapCxpDevWorkbooks(null, true);
}

/**
 * @param {string} targetSpreadsheetId spreadsheet ID or Google Sheets URL
 * @param {string} controlSpreadsheetId spreadsheet ID or Google Sheets URL
 * @param {boolean=} initializeAndSeed run CXP-02 init and seed target/control headers
 */
function registerCxpDevWorkbookIds(
  targetSpreadsheetId,
  controlSpreadsheetId,
  initializeAndSeed,
) {
  return DevWorkbookBootstrap.registerWorkbookIds(
    targetSpreadsheetId,
    controlSpreadsheetId,
    { initializeAndSeed: initializeAndSeed === true },
  );
}

/**
 * @param {string=} folderId Drive folder ID (optional if CXP_DEV_BOOTSTRAP_FOLDER_ID is set)
 * @param {boolean=} initializeAndSeed run CXP-02 init and seed target/control headers
 */
function registerCxpDevWorkbooksFromFolder(folderId, initializeAndSeed) {
  return DevWorkbookBootstrap.registerWorkbooksFromFolder(folderId, {
    initializeAndSeed: initializeAndSeed === true,
  });
}

function registerCxpDevWorkbooksFromFolderAndSeed() {
  return registerCxpDevWorkbooksFromFolder(null, true);
}

function resolveCxp06UatHarnessForBootstrap() {
  if (typeof Cxp06UatHarness !== 'undefined') {
    return Cxp06UatHarness;
  }
  return require('../uat/Cxp06UatHarness.js');
}

function logCxpUatHarnessResult(tag, result) {
  var line = tag + ' ' + JSON.stringify(result);
  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    console.log(line);
  }
  if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
    Logger.log(line);
  }
  return result;
}

/** Lists configured CXP_UAT_* Drive files, bootstrap folder files, and backup sheets. */
function listCxpUatSourceFiles() {
  return logCxpUatHarnessResult(
    'CXP06_UAT_SOURCE_FILES',
    resolveCxp06UatHarnessForBootstrap().listSourceFiles(),
  );
}

/** Alias kept for operator runbooks; same as listCxpUatSourceFiles(). */
function listCxpUatFilesIfFound() {
  return listCxpUatSourceFiles();
}

/** Scans all five configured UAT source files and reports schema/type validation errors. */
function scanCxpUatSourceFileValidation() {
  var harness = resolveCxp06UatHarnessForBootstrap();
  var result = harness.scanSourceFileValidation();
  return logCxpUatHarnessResult(
    'CXP06_UAT_SOURCE_VALIDATION',
    harness.formatSourceValidationLog(result),
  );
}

/**
 * Exports Fixed-*.xlsx copies with contract date strings and optionally updates CXP_UAT_* file IDs.
 * @param {boolean=} updateProperties when true, writes repaired Drive file IDs to Script Properties
 */
function repairCxpUatSourceFiles(updateProperties) {
  return logCxpUatHarnessResult(
    'CXP06_UAT_SOURCE_REPAIR',
    resolveCxp06UatHarnessForBootstrap().repairSourceFiles({
      updateProperties: updateProperties === true,
    }),
  );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DevWorkbookBootstrap;
}
