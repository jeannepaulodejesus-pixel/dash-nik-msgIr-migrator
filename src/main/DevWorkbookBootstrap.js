/**
 * DEV-only automation: create target + control workbooks in a Drive folder,
 * store their IDs in Script Properties, run CXP-02 sheet init, and seed CXP-03
 * headers on the five raw sheets so CXP-07/CXP-08 install preflight can pass.
 *
 * Editor entrypoints:
 *   bootstrapCxpDevWorkbooks()           // folder from CXP_DEV_BOOTSTRAP_FOLDER_ID
 *   bootstrapCxpDevWorkbooks(folderId)   // optional folder ID argument
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

  function assertIdsReplaceable(properties, forceReplace) {
    var config = resolveConfig();
    var targetKey = config.propertyKey(ENVIRONMENT, config.CONFIGURATION_KEYS.targetSpreadsheetId);
    var controlKey = config.propertyKey(ENVIRONMENT, config.CONFIGURATION_KEYS.controlSpreadsheetId);
    var existingTarget = properties.getProperty(targetKey);
    var existingControl = properties.getProperty(controlKey);
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
    return { controlKey: controlKey, targetKey: targetKey };
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
    var config = resolveConfig();

    assertDevOnly(resolvedProperties);
    var keys = assertIdsReplaceable(resolvedProperties, forceReplace);
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

    resolvedProperties.setProperty(config.ACTIVE_ENVIRONMENT_KEY, ENVIRONMENT);
    resolvedProperties.setProperty(keys.targetKey, targetId);
    resolvedProperties.setProperty(keys.controlKey, controlId);
    resolvedProperties.setProperty(BOOTSTRAP_FOLDER_PROPERTY, resolvedFolderId);

    var skeleton = resolveWorkbookSetup().initializeConfiguredWorkbooks(
      resolvedProperties,
      resolvedServices,
    );
    removeDefaultSheetIfPresent(target);
    removeDefaultSheetIfPresent(control);
    var seededRawSheets = seedRawHeaders(target);

    var result = Object.freeze({
      controlSpreadsheetId: controlId,
      environment: ENVIRONMENT,
      folderId: resolvedFolderId,
      seededRawSheets: Object.freeze(seededRawSheets.slice()),
      skeleton: skeleton,
      targetSpreadsheetId: targetId,
    });
    emitLog('CXP_DEV_BOOTSTRAP', {
      event: 'COMPLETE',
      environment: result.environment,
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DevWorkbookBootstrap;
}
