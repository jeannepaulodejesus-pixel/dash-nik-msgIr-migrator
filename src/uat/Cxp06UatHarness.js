var Cxp06UatHarness = (function () {
  'use strict';

  function resolveCxp06FaultInjector() {
    if (typeof Cxp06FaultInjector !== 'undefined') {
      return Cxp06FaultInjector;
    }
    return require('./Cxp06FaultInjector.js');
  }

  function resolveCxp06BackupTopologySeeder() {
    if (typeof Cxp06BackupTopologySeeder !== 'undefined') {
      return Cxp06BackupTopologySeeder;
    }
    return require('./Cxp06BackupTopologySeeder.js');
  }

  function resolveCxp06UatEvidence() {
    if (typeof Cxp06UatEvidence !== 'undefined') {
      return Cxp06UatEvidence;
    }
    return require('./Cxp06UatEvidence.js');
  }

  function resolveInputAdapter() {
    if (typeof InputAdapter !== 'undefined') {
      return InputAdapter;
    }
    return require('../ingestion/InputAdapter.js');
  }

  function resolveCommitService() {
    if (typeof CommitService !== 'undefined') {
      return CommitService;
    }
    return require('../services/CommitService.js');
  }

  function resolveRunService() {
    if (typeof RunService !== 'undefined') {
      return RunService;
    }
    return require('../ingestion/RunService.js');
  }

  function resolveFileLedgerRepository() {
    if (typeof FileLedgerRepository !== 'undefined') {
      return FileLedgerRepository;
    }
    return require('../repository/FileLedgerRepository.js');
  }

  function resolveRunRepository() {
    if (typeof RunRepository !== 'undefined') {
      return RunRepository;
    }
    return require('../repository/RunRepository.js');
  }

  function resolveDriveService() {
    if (typeof DriveService !== 'undefined') {
      return DriveService;
    }
    return require('../services/DriveService.js');
  }

  function resolveDatasetAdapter() {
    if (typeof DatasetAdapter !== 'undefined') {
      return DatasetAdapter;
    }
    return require('../ingestion/DatasetAdapter.js');
  }

  function resolveXlsxAdapter() {
    if (typeof XlsxAdapter !== 'undefined') {
      return XlsxAdapter;
    }
    return require('../ingestion/XlsxAdapter.js');
  }

  function resolveSchemaValidator() {
    if (typeof SchemaValidator !== 'undefined') {
      return SchemaValidator;
    }
    return require('../ingestion/SchemaValidator.js');
  }

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function getPropValue(props, key) {
    if (!props) {
      return null;
    }
    if (typeof props.getProperty === 'function') {
      return props.getProperty(key);
    }
    if (Object.hasOwn(props, key)) {
      return props[key];
    }
    return null;
  }

  function requireSafetyGate(properties) {
    var props = properties;
    if (!props && typeof PropertiesService !== 'undefined' && typeof PropertiesService.getScriptProperties === 'function') {
      props = PropertiesService.getScriptProperties();
    }
    if (!props) {
      props = {
        CXP_ENV: 'DEV',
        CXP_UAT_ENABLED: 'true',
      };
    }

    var env = getPropValue(props, 'CXP_ENV');
    var enabled = getPropValue(props, 'CXP_UAT_ENABLED');

    if (env === 'PROD') {
      throw new Error('UAT harness is not available in PROD environment.');
    }
    if (env !== 'DEV' && env !== 'UAT') {
      throw new Error('UAT harness requires DEV or UAT environment.');
    }
    if (enabled !== 'true' && enabled !== true) {
      throw new Error('UAT harness requires CXP_UAT_ENABLED=true Script Property.');
    }

    return Object.freeze({ environment: env });
  }

  function composeOperations(inputOperations, commitOperations) {
    var input = inputOperations || {};
    var commit = commitOperations || {};
    var operations = {
      validateFile: input.validateFile,
      parse: input.parse,
      validateSchema: input.validateSchema,
      checkDuplicate: input.checkDuplicate,
      stage: commit.stage,
      validateStage: commit.validateStage,
      commit: commit.commit,
      recalculate: commit.recalculate,
      healthCheck: commit.healthCheck,
    };
    if (typeof commit.resume === 'function') {
      operations.resume = commit.resume;
    }
    if (typeof commit.resumeBackup === 'function') {
      operations.resumeBackup = commit.resumeBackup;
    }
    if (typeof commit.resumeDataset === 'function') {
      operations.resumeDataset = commit.resumeDataset;
    }
    if (typeof commit.backupStep === 'function') {
      operations.backupStep = commit.backupStep;
    }
    if (typeof commit.commitStep === 'function') {
      operations.commitStep = commit.commitStep;
    }
    if (typeof commit.commitDatasetStep === 'function') {
      operations.commitDatasetStep = commit.commitDatasetStep;
    }
    return Object.freeze(operations);
  }

  var UAT_SOURCE_FILE_DEFINITIONS = Object.freeze([
    { datasetName: 'Handled', propertyKey: 'CXP_UAT_HANDLED_FILE_ID' },
    { datasetName: 'Offered', propertyKey: 'CXP_UAT_OFFERED_FILE_ID' },
    { datasetName: 'AHT - Raw', propertyKey: 'CXP_UAT_AHT_FILE_ID' },
    { datasetName: 'Auxes - Raw', propertyKey: 'CXP_UAT_AUXES_FILE_ID' },
    { datasetName: 'Staff', propertyKey: 'CXP_UAT_STAFF_FILE_ID' },
  ]);

  var BOOTSTRAP_FOLDER_PROPERTY = 'CXP_DEV_BOOTSTRAP_FOLDER_ID';

  function requireListingEnvironment(properties) {
    var props = properties;
    if (
      !props &&
      typeof PropertiesService !== 'undefined' &&
      typeof PropertiesService.getScriptProperties === 'function'
    ) {
      props = PropertiesService.getScriptProperties();
    }
    var env = getPropValue(props, 'CXP_ENV');
    if (env === 'PROD') {
      throw new Error('UAT file listing is not available in PROD environment.');
    }
    if (env !== 'DEV' && env !== 'UAT') {
      throw new Error('UAT file listing requires DEV or UAT environment.');
    }
    return Object.freeze({ environment: env, properties: props });
  }

  function lookupDriveFile(driveApp, fileId) {
    if (!driveApp || typeof driveApp.getFileById !== 'function') {
      return Object.freeze({ found: false, reason: 'drive_unavailable' });
    }
    try {
      var file = driveApp.getFileById(fileId);
      if (!file || typeof file.getName !== 'function') {
        return Object.freeze({ found: false, reason: 'not_found' });
      }
      return Object.freeze({
        found: true,
        name: file.getName(),
      });
    } catch (error) {
      return Object.freeze({ found: false, reason: 'not_accessible' });
    }
  }

  function listConfiguredSourceFiles(properties, driveApp) {
    return UAT_SOURCE_FILE_DEFINITIONS.map(function (definition) {
      var rawId = getPropValue(properties, definition.propertyKey);
      var fileId = typeof rawId === 'string' ? rawId.trim() : '';
      var entry = {
        configured: fileId.length > 0,
        datasetName: definition.datasetName,
        found: false,
        propertyKey: definition.propertyKey,
      };
      if (!entry.configured) {
        return Object.freeze(entry);
      }
      var lookup = lookupDriveFile(driveApp, fileId);
      return Object.freeze(Object.assign({}, entry, lookup));
    });
  }

  function listFolderFiles(folderId, driveApp) {
    if (!folderId || !driveApp || typeof driveApp.getFolderById !== 'function') {
      return Object.freeze([]);
    }
    var folder;
    try {
      folder = driveApp.getFolderById(folderId);
    } catch (error) {
      return Object.freeze([]);
    }
    if (!folder || typeof folder.getFiles !== 'function') {
      return Object.freeze([]);
    }
    var listed = [];
    var iterator = folder.getFiles();
    while (iterator.hasNext()) {
      var file = iterator.next();
      if (file && typeof file.getName === 'function') {
        listed.push(Object.freeze({
          found: true,
          name: file.getName(),
        }));
      }
    }
    listed.sort(function (left, right) {
      return left.name.localeCompare(right.name);
    });
    return Object.freeze(listed);
  }

  function listBackupSheetsIfFound(properties, spreadsheetApp, environment) {
    if (
      !spreadsheetApp ||
      typeof spreadsheetApp.openById !== 'function' ||
      typeof environment !== 'string'
    ) {
      return Object.freeze([]);
    }
    var targetKey = 'CXP_' + environment + '_TARGET_SPREADSHEET_ID';
    var targetId = getPropValue(properties, targetKey);
    if (typeof targetId !== 'string' || !targetId.trim()) {
      return Object.freeze([]);
    }
    try {
      var spreadsheet = spreadsheetApp.openById(targetId.trim());
      if (!spreadsheet || typeof spreadsheet.getSheets !== 'function') {
        return Object.freeze([]);
      }
      return Object.freeze(spreadsheet.getSheets().map(function (sheet) {
        return sheet && typeof sheet.getName === 'function' ? sheet.getName() : '';
      }).filter(function (name) {
        return name.indexOf('_CXP06_BAK_') === 0;
      }).sort().map(function (name) {
        return Object.freeze({ found: true, name: name });
      }));
    } catch (error) {
      return Object.freeze([]);
    }
  }

  function listSourceFiles(options) {
    var opts = options || {};
    var gate = requireListingEnvironment(opts.properties);
    var properties = gate.properties;
    var services = opts.services || {};
    var driveApp = services.driveApp ||
      (typeof DriveApp !== 'undefined' ? DriveApp : null);
    var spreadsheetApp = services.spreadsheetApp ||
      (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp : null);
    var sourceFiles = listConfiguredSourceFiles(properties, driveApp);
    var folderId = typeof opts.folderId === 'string' && opts.folderId.trim()
      ? opts.folderId.trim()
      : getPropValue(properties, BOOTSTRAP_FOLDER_PROPERTY);
    var folderFiles = listFolderFiles(
      typeof folderId === 'string' ? folderId.trim() : '',
      driveApp,
    );
    var backupSheets = listBackupSheetsIfFound(
      properties,
      spreadsheetApp,
      gate.environment,
    );
    return Object.freeze({
      allConfigured: sourceFiles.every(function (entry) { return entry.configured; }),
      allFound: sourceFiles.every(function (entry) {
        return !entry.configured || entry.found;
      }),
      backupSheets: backupSheets,
      environment: gate.environment,
      folderFileCount: folderFiles.length,
      folderFiles: folderFiles,
      sourceFiles: Object.freeze(sourceFiles),
    });
  }

  function readConfiguredSourceTable(datasetName, fileId, services) {
    if (services && typeof services.readSourceTable === 'function') {
      return services.readSourceTable(datasetName, fileId);
    }
    var driveService = resolveDriveService();
    var source = driveService.readFile(fileId, services);
    var enrichedSource = Object.assign({}, source, { datasetName: datasetName });
    if (source.format === driveService.FORMATS.HTML_TABLE) {
      return resolveDatasetAdapter().parseHtmlTable(enrichedSource);
    }
    if (source.format === driveService.FORMATS.XLSX) {
      var workbook = resolveXlsxAdapter().read(enrichedSource, services);
      var populatedSheets = workbook.sheets.filter(function (sheet) {
        return sheet.values.length > 0;
      });
      if (populatedSheets.length > 1) {
        throw resolveErrorCodes().create('SOURCE_MULTIPLE_TABLES', {
          details: { sheetCount: populatedSheets.length },
        });
      }
      if (populatedSheets.length !== 1) {
        throw resolveErrorCodes().create('SOURCE_INVALID_TABLE', {
          details: { sheetCount: populatedSheets.length },
        });
      }
      return populatedSheets[0];
    }
    throw resolveErrorCodes().create('SOURCE_UNSUPPORTED_FORMAT');
  }

  function countDatasetValidationErrors(datasetResult) {
    if (datasetResult.readError) {
      return 1;
    }
    if (datasetResult.headerError || datasetResult.rowVolumeError) {
      return 1;
    }
    if (typeof datasetResult.totalErrorCount === 'number') {
      return datasetResult.totalErrorCount;
    }
    return datasetResult.errors.length;
  }

  function formatSourceValidationLog(result) {
    return Object.freeze({
      allValid: result.allValid,
      datasets: Object.freeze(result.datasets.map(function (datasetResult) {
        return Object.freeze({
          datasetName: datasetResult.datasetName,
          errorGroups: datasetResult.errorGroups || Object.freeze([]),
          headerError: datasetResult.headerError,
          readError: datasetResult.readError,
          rowCount: datasetResult.rowCount,
          rowVolumeError: datasetResult.rowVolumeError,
          sourceName: datasetResult.sourceName,
          totalErrorCount: typeof datasetResult.totalErrorCount === 'number'
            ? datasetResult.totalErrorCount
            : datasetResult.errors.length,
          valid: countDatasetValidationErrors(datasetResult) === 0,
        });
      })),
      environment: result.environment,
      totalErrors: result.totalErrors,
    });
  }

  function scanSourceFileValidation(options) {
    var opts = options || {};
    var gate = requireListingEnvironment(opts.properties);
    var properties = gate.properties;
    var services = opts.services || {};
    var datasets = UAT_SOURCE_FILE_DEFINITIONS.map(function (definition) {
      var rawId = getPropValue(properties, definition.propertyKey);
      var fileId = typeof rawId === 'string' ? rawId.trim() : '';
      var entry = {
        configured: fileId.length > 0,
        datasetName: definition.datasetName,
        errorGroups: Object.freeze([]),
        found: false,
        headerError: null,
        propertyKey: definition.propertyKey,
        readError: null,
        rowCount: 0,
        rowVolumeError: null,
        sourceName: null,
        totalErrorCount: 0,
      };
      if (!entry.configured) {
        return Object.freeze(Object.assign({}, entry, {
          readError: Object.freeze({
            errorCode: 'SOURCE_FILE_NOT_CONFIGURED',
            message: definition.propertyKey + ' is not configured.',
          }),
        }));
      }

      var lookup = lookupDriveFile(services.driveApp ||
        (typeof DriveApp !== 'undefined' ? DriveApp : null), fileId);
      if (!lookup.found) {
        return Object.freeze(Object.assign({}, entry, {
          readError: Object.freeze({
            errorCode: 'SOURCE_FILE_NOT_FOUND',
            message: 'Drive file is not accessible for ' + definition.propertyKey + '.',
          }),
        }));
      }

      try {
        var table = readConfiguredSourceTable(definition.datasetName, fileId, services);
        if (!table || !Array.isArray(table.values) || table.values.length < 2) {
          return Object.freeze(Object.assign({}, entry, {
            found: true,
            readError: Object.freeze({
              errorCode: 'SOURCE_INVALID_TABLE',
              message: 'Source table is missing headers or data rows.',
            }),
            sourceName: lookup.name,
          }));
        }
        var headers = table.values[0].slice();
        var bodyRows = table.values.slice(1);
        var scan = resolveSchemaValidator().collectValidationErrorSummary(
          definition.datasetName,
          headers,
          bodyRows,
        );
        return Object.freeze(Object.assign({}, entry, {
          errorGroups: scan.errorGroups,
          found: true,
          headerError: scan.headerError,
          rowCount: scan.rowCount,
          rowVolumeError: scan.rowVolumeError,
          sourceName: lookup.name,
          totalErrorCount: scan.totalErrorCount,
        }));
      } catch (error) {
        return Object.freeze(Object.assign({}, entry, {
          found: lookup.found,
          readError: Object.freeze({
            errorCode: error && typeof error.code === 'string'
              ? error.code
              : 'SOURCE_READ_FAILED',
            message: error && error.message ? error.message : String(error),
          }),
          sourceName: lookup.name,
        }));
      }
    });

    var totalErrors = datasets.reduce(function (sum, datasetResult) {
      return sum + countDatasetValidationErrors(datasetResult);
    }, 0);

    return Object.freeze({
      allValid: datasets.every(function (datasetResult) {
        return countDatasetValidationErrors(datasetResult) === 0;
      }),
      datasets: Object.freeze(datasets),
      environment: gate.environment,
      totalErrors: totalErrors,
    });
  }

  function scanSourceFileValidationLog(options) {
    return formatSourceValidationLog(scanSourceFileValidation(options));
  }

  function buildRepairedFileName(sourceName) {
    var normalized = typeof sourceName === 'string' ? sourceName.trim() : '';
    if (!normalized) {
      return 'Fixed-UAT-Source.xlsx';
    }
    if (/^fixed[\s_-]/i.test(normalized)) {
      return normalized;
    }
    return 'Fixed - ' + normalized.replace(/\.xlsx$/i, '') + '.xlsx';
  }

  function exportRepairedTableToFolder(table, fileName, folderId, services) {
    var spreadsheetApp = services.spreadsheetApp;
    var driveApp = services.driveApp;
    var utilities = services.utilities;
    if (
      !spreadsheetApp ||
      typeof spreadsheetApp.create !== 'function' ||
      !driveApp ||
      typeof driveApp.getFileById !== 'function' ||
      typeof driveApp.getFolderById !== 'function'
    ) {
      throw new Error('SpreadsheetApp and DriveApp are required to export repaired source files.');
    }
    var folder = driveApp.getFolderById(folderId);
    if (!folder || typeof folder.createFile !== 'function') {
      throw new Error('Bootstrap Drive folder was not found for repaired source export.');
    }
    var tempName = 'CXP-UAT-REPAIR-TEMP-' +
      (utilities && typeof utilities.getUuid === 'function'
        ? utilities.getUuid()
        : String(Date.now()));
    var spreadsheet = spreadsheetApp.create(tempName);
    var tempFileId = spreadsheet.getId();
    try {
      var sheet = spreadsheet.getSheets()[0];
      var values = [table.headers.slice()].concat(table.rows.map(function (row) {
        return row.slice();
      }));
      sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
      if (typeof spreadsheetApp.flush === 'function') {
        spreadsheetApp.flush();
      }
      var blob = driveApp.getFileById(tempFileId).getAs(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      blob.setName(fileName);
      var created = folder.createFile(blob);
      return Object.freeze({
        fileId: created.getId(),
        fileName: created.getName(),
      });
    } finally {
      driveApp.getFileById(tempFileId).setTrashed(true);
    }
  }

  function repairSourceFiles(options) {
    var opts = options || {};
    var gate = requireListingEnvironment(opts.properties);
    var properties = gate.properties;
    var services = opts.services || {};
    var updateProperties = opts.updateProperties === true;
    var folderId = typeof opts.folderId === 'string' && opts.folderId.trim()
      ? opts.folderId.trim()
      : getPropValue(properties, BOOTSTRAP_FOLDER_PROPERTY);
    if (typeof folderId !== 'string' || !folderId.trim()) {
      throw new Error(BOOTSTRAP_FOLDER_PROPERTY + ' is required to export repaired source files.');
    }

    var repairedFiles = [];
    var skippedFiles = [];
    UAT_SOURCE_FILE_DEFINITIONS.forEach(function (definition) {
      var rawId = getPropValue(properties, definition.propertyKey);
      var fileId = typeof rawId === 'string' ? rawId.trim() : '';
      if (!fileId) {
        skippedFiles.push(Object.freeze({
          datasetName: definition.datasetName,
          propertyKey: definition.propertyKey,
          reason: 'not_configured',
        }));
        return;
      }
      var lookup = lookupDriveFile(services.driveApp ||
        (typeof DriveApp !== 'undefined' ? DriveApp : null), fileId);
      if (!lookup.found) {
        skippedFiles.push(Object.freeze({
          datasetName: definition.datasetName,
          propertyKey: definition.propertyKey,
          reason: 'not_accessible',
        }));
        return;
      }

      try {
        var table = readConfiguredSourceTable(definition.datasetName, fileId, services);
        var headers = table.values[0].slice();
        var bodyRows = table.values.slice(1);
        var coerced = resolveSchemaValidator().coerceSourceTableValues(
          definition.datasetName,
          headers,
          bodyRows,
        );
        var changedCellCount = 0;
        coerced.rows.forEach(function (coercedRow, rowIndex) {
          var sourceRow = bodyRows[rowIndex];
          if (!Array.isArray(sourceRow) || !Array.isArray(coercedRow)) {
            return;
          }
          for (var columnIndex = 0; columnIndex < sourceRow.length; columnIndex += 1) {
            if (sourceRow[columnIndex] !== coercedRow[columnIndex]) {
              changedCellCount += 1;
            }
          }
        });
        var afterScan = resolveSchemaValidator().collectValidationErrorSummary(
          definition.datasetName,
          coerced.headers,
          coerced.rows,
        );
        if (afterScan.totalErrorCount > 0) {
          skippedFiles.push(Object.freeze({
            datasetName: definition.datasetName,
            propertyKey: definition.propertyKey,
            reason: 'still_invalid',
            remainingErrorCount: afterScan.totalErrorCount,
            sourceName: lookup.name,
          }));
          return;
        }
        if (changedCellCount === 0) {
          skippedFiles.push(Object.freeze({
            datasetName: definition.datasetName,
            propertyKey: definition.propertyKey,
            reason: 'already_valid',
            sourceName: lookup.name,
          }));
          return;
        }
        var exportResult = exportRepairedTableToFolder(
          coerced,
          buildRepairedFileName(lookup.name),
          folderId.trim(),
          {
            driveApp: services.driveApp || (typeof DriveApp !== 'undefined' ? DriveApp : null),
            spreadsheetApp: services.spreadsheetApp ||
              (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp : null),
            utilities: services.utilities ||
              (typeof Utilities !== 'undefined' ? Utilities : null),
          },
        );
        if (
          updateProperties &&
          properties &&
          typeof properties.setProperty === 'function'
        ) {
          properties.setProperty(definition.propertyKey, exportResult.fileId);
        }
        repairedFiles.push(Object.freeze({
          cellsCoerced: changedCellCount,
          datasetName: definition.datasetName,
          fileId: exportResult.fileId,
          fileName: exportResult.fileName,
          propertyKey: definition.propertyKey,
          propertyUpdated: updateProperties,
          sourceName: lookup.name,
        }));
      } catch (error) {
        skippedFiles.push(Object.freeze({
          datasetName: definition.datasetName,
          propertyKey: definition.propertyKey,
          reason: 'repair_failed',
          sourceName: lookup.name,
        }));
      }
    });

    return Object.freeze({
      environment: gate.environment,
      folderId: folderId.trim(),
      propertiesUpdated: updateProperties,
      repairedFiles: Object.freeze(repairedFiles),
      repairedFileCount: repairedFiles.length,
      skippedFiles: Object.freeze(skippedFiles),
    });
  }

  function readSyntheticFileIds(properties) {
    var props = properties;
    if (!props && typeof PropertiesService !== 'undefined' && typeof PropertiesService.getScriptProperties === 'function') {
      props = PropertiesService.getScriptProperties();
    }
    return Object.freeze({
      handledFileId: getPropValue(props, 'CXP_UAT_HANDLED_FILE_ID') || 'synth-handled-id',
      offeredFileId: getPropValue(props, 'CXP_UAT_OFFERED_FILE_ID') || 'synth-offered-id',
      ahtFileId: getPropValue(props, 'CXP_UAT_AHT_FILE_ID') || 'synth-aht-id',
      auxesFileId: getPropValue(props, 'CXP_UAT_AUXES_FILE_ID') || 'synth-auxes-id',
      staffFileId: getPropValue(props, 'CXP_UAT_STAFF_FILE_ID') || 'synth-staff-id',
    });
  }

  function requiredProperty(properties, key) {
    var value = getPropValue(properties, key);
    var normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
      throw new Error(key + ' is required for hosted UAT execution.');
    }
    return normalized;
  }

  function createHostedDependencies(properties, services, modules) {
    var gate = requireSafetyGate(properties);
    var runtime = services || {};
    var resolvedModules = modules || {};
    var spreadsheetApp = runtime.spreadsheetApp;
    if (!spreadsheetApp || typeof spreadsheetApp.openById !== 'function') {
      throw new Error('SpreadsheetApp.openById is required for hosted UAT execution.');
    }

    var targetSpreadsheetId = requiredProperty(
      properties,
      'CXP_' + gate.environment + '_TARGET_SPREADSHEET_ID',
    );
    var controlSpreadsheetId = requiredProperty(
      properties,
      'CXP_' + gate.environment + '_CONTROL_SPREADSHEET_ID',
    );
    if (targetSpreadsheetId === controlSpreadsheetId) {
      throw new Error('Target and control spreadsheet IDs must be distinct.');
    }

    var sourceDefinitions = [
      ['Handled', 'handledFileId'],
      ['Offered', 'offeredFileId'],
      ['AHT - Raw', 'ahtFileId'],
      ['Auxes - Raw', 'auxesFileId'],
      ['Staff', 'staffFileId'],
    ];
    var sources = sourceDefinitions.map(function (definition) {
      return Object.freeze({
        datasetName: definition[0],
        fileId: requiredProperty(properties, {
          handledFileId: 'CXP_UAT_HANDLED_FILE_ID',
          offeredFileId: 'CXP_UAT_OFFERED_FILE_ID',
          ahtFileId: 'CXP_UAT_AHT_FILE_ID',
          auxesFileId: 'CXP_UAT_AUXES_FILE_ID',
          staffFileId: 'CXP_UAT_STAFF_FILE_ID',
        }[definition[1]]),
      });
    });

    var targetSpreadsheet = spreadsheetApp.openById(targetSpreadsheetId);
    var controlSpreadsheet = spreadsheetApp.openById(controlSpreadsheetId);
    var ledgerRepository = (resolvedModules.fileLedgerRepository || resolveFileLedgerRepository())
      .create(controlSpreadsheet);
    var runRepository = (resolvedModules.runRepository || resolveRunRepository())
      .create(controlSpreadsheet);
    var flush = typeof runtime.flush === 'function'
      ? runtime.flush
      : function () { spreadsheetApp.flush(); };
    var activeUser = runtime.session && typeof runtime.session.getActiveUser === 'function'
      ? runtime.session.getActiveUser()
      : null;
    var sourceActor = activeUser && typeof activeUser.getEmail === 'function'
      ? activeUser.getEmail()
      : 'uat-operator';
    var inputRowCounts = {
      Handled: 10000,
      Offered: 10000,
      'AHT - Raw': 15000,
      'Auxes - Raw': 7500,
      Staff: 2000,
    };

    return Object.freeze({
      adapterRequest: Object.freeze({
        packagingKind: 'single_dataset',
        runMetadata: Object.freeze({ schemaVersion: '1.0.0' }),
        sources: Object.freeze(sources),
      }),
      commitServices: Object.freeze({
        flush: flush,
        ledgerRepository: ledgerRepository,
        lockService: runtime.lockService,
        session: runtime.session,
        spreadsheetApp: spreadsheetApp,
        targetSpreadsheet: targetSpreadsheet,
      }),
      inputServices: Object.freeze({
        driveApi: runtime.driveApi,
        driveApp: runtime.driveApp,
        ledgerRepository: ledgerRepository,
        spreadsheetApp: spreadsheetApp,
        utilities: runtime.utilities,
      }),
      properties: properties,
      request: Object.freeze({
        inputRowCounts: Object.freeze(inputRowCounts),
        outputRowCounts: Object.freeze({}),
        schemaVersion: '1.0.0',
        sourceActor: sourceActor,
        sourceFileId: sources[0].fileId,
        sourceFileName: 'cxp06-uat-five-file-bundle',
        targetWorkbookId: targetSpreadsheetId,
      }),
      runServices: Object.freeze({
        flush: flush,
        lockService: runtime.lockService,
        repository: runRepository,
        telemetry: runtime.telemetry,
      }),
      topologyServices: Object.freeze({
        now: function () { return new Date(); },
        uniqueToken: function () {
          if (!runtime.utilities || typeof runtime.utilities.getUuid !== 'function') {
            throw new Error('Utilities.getUuid is required for controlled topology seeding.');
          }
          return runtime.utilities.getUuid().replace(/[^A-Za-z0-9_-]/g, '');
        },
      }),
    });
  }

  function hasHostedRuntime() {
    return typeof PropertiesService !== 'undefined' &&
      typeof SpreadsheetApp !== 'undefined';
  }

  function hostedRuntimeServices() {
    var telemetryStartedAtMs = Date.now();
    return {
      driveApi: typeof Drive !== 'undefined' ? Drive : null,
      driveApp: typeof DriveApp !== 'undefined' ? DriveApp : null,
      lockService: typeof LockService !== 'undefined' ? LockService : null,
      session: typeof Session !== 'undefined' ? Session : null,
      spreadsheetApp: SpreadsheetApp,
      telemetry: function (event) {
        if (typeof console !== 'undefined' && typeof console.log === 'function') {
          console.log('CXP_UAT_PHASE ' + JSON.stringify(Object.assign({}, event, {
            elapsedMs: Date.now() - telemetryStartedAtMs,
          })));
        }
      },
      utilities: typeof Utilities !== 'undefined' ? Utilities : null,
    };
  }

  function normalizeScenario(options) {
    if (typeof options === 'string') {
      return options.toUpperCase();
    }
    if (options && typeof options.scenario === 'string') {
      return options.scenario.toUpperCase();
    }
    return 'PEAK_SUCCESS';
  }

  function scenarioFaultKind(scenario) {
    if (scenario.indexOf('INVALID_STAGE') !== -1) {
      return 'INVALID_STAGE';
    }
    if (scenario.indexOf('MID_COMMIT') !== -1) {
      return 'AFTER_SECOND_RAW_REPLACEMENT';
    }
    if (scenario.indexOf('HEALTH_MISMATCH') !== -1) {
      return 'HEALTH_MISMATCH';
    }
    if (scenario.indexOf('ROLLBACK_FAILURE') !== -1) {
      return 'ROLLBACK_WRITE_FAILURE';
    }
    if (scenario.indexOf('CLEANUP_FAILURE') !== -1) {
      return 'BACKUP_CLEANUP_FAILURE';
    }
    if (scenario.indexOf('READER_VISIBILITY') !== -1) {
      return 'READER_VISIBILITY';
    }
    return null;
  }

  function requireExecutableScenario(scenario) {
    var executableScenarios = [
      'PREFLIGHT',
      'PEAK_SUCCESS',
      'CASE1_PEAK_SUCCESS',
      'CASE2_INVALID_STAGE',
      'CASE3_MID_COMMIT_FAILURE',
      'CASE4_HEALTH_MISMATCH',
      'CASE4_ROLLBACK_FAILURE',
      'CASE5_INCOMPLETE_BACKUP',
      'CASE5_COMPLETE_UNSUCCESSFUL_BACKUP',
      'CASE5_SUCCESSFUL_LEFTOVER_BACKUP',
      'CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS',
      'CASE5_CLEANUP_FAILURE',
      'READER_VISIBILITY',
    ];
    if (executableScenarios.indexOf(scenario) === -1) {
      throw new Error('Unknown UAT scenario: ' + scenario + '.');
    }
  }

  function isTopologyScenario(scenario) {
    return [
      'CASE5_INCOMPLETE_BACKUP',
      'CASE5_COMPLETE_UNSUCCESSFUL_BACKUP',
      'CASE5_SUCCESSFUL_LEFTOVER_BACKUP',
      'CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS',
    ].indexOf(scenario) !== -1;
  }

  function buildInputOperations(inputAdapter, deps) {
    if (deps.inputOperations) {
      return deps.inputOperations;
    }
    if (inputAdapter && typeof inputAdapter.createOperations === 'function') {
      return inputAdapter.createOperations(deps.adapterRequest || {}, deps.inputServices || {});
    }
    return {};
  }

  function buildCommitOperations(commitService, deps) {
    if (deps.commitOperations) {
      return deps.commitOperations;
    }
    if (commitService && typeof commitService.createOperations === 'function') {
      return commitService.createOperations(deps.commitServices || {});
    }
    return {};
  }

  function execute(options, dependencies) {
    var scenario = normalizeScenario(options);
    requireExecutableScenario(scenario);
    var deps = dependencies || {};
    if (!dependencies && hasHostedRuntime()) {
      var hostedProperties = PropertiesService.getScriptProperties();
      deps = createHostedDependencies(hostedProperties, hostedRuntimeServices());
    }
    var gate = requireSafetyGate(deps.properties);
    var syntheticFileIds = readSyntheticFileIds(deps.properties);

    var startTimeMs = Date.now();
    var startedAtUtc = new Date(startTimeMs).toISOString();

    if (scenario === 'PREFLIGHT') {
      var endedAtUtc = new Date().toISOString();
      var preflightEvidence = resolveCxp06UatEvidence().sanitize({
        backupCleanupStatus: 'N/A',
        backupSheetCount: 0,
        elapsedMs: Date.now() - startTimeMs,
        endedAtUtc: endedAtUtc,
        environment: gate.environment,
        fileLedgerResult: 'N/A',
        rawFormulaCount: 0,
        rawRowCounts: {},
        rollbackStatus: 'N/A',
        runId: 'preflight',
        runtimeIndicator: 'WITHIN_LIMIT',
        sanitizedErrorCode: null,
        scenario: 'PREFLIGHT',
        stageFormulaCount: 0,
        stageRowCounts: {},
        startedAtUtc: startedAtUtc,
        terminalState: 'PREFLIGHT_PASS',
      });
      return Object.freeze({
        evidence: preflightEvidence,
        runRecord: { runId: 'preflight', status: 'PREFLIGHT_PASS' },
      });
    }

    var inputAdapter = deps.inputAdapter || resolveInputAdapter();
    var commitService = deps.commitService || resolveCommitService();
    var runService = deps.runService || resolveRunService();

    var request = deps.request || {
      inputRowCounts: { Handled: 10000, Offered: 10000, 'AHT - Raw': 15000, 'Auxes - Raw': 7500, Staff: 2000 },
      outputRowCounts: {},
      schemaVersion: '1.0.0',
      sourceActor: 'uat-operator@example.test',
      sourceFileId: syntheticFileIds.handledFileId,
      sourceFileName: 'cxp06-uat-bundle.xlsx',
      targetWorkbookId: 'uat-target-id',
    };

    var faultKind = scenarioFaultKind(scenario);
    if (faultKind) {
      var faultInjector = resolveCxp06FaultInjector().create(faultKind);
      deps = Object.assign({}, deps, {
        commitServices: Object.assign({}, deps.commitServices || {}, {
          decorateBackupRepository: faultInjector.wrapBackupRepository,
          decorateRawRepository: faultInjector.wrapRawRepository,
          decorateStagingRepository: faultInjector.wrapStagingRepository,
          rawObserver: faultInjector.rawObserver,
        }),
      });
    }

    if (isTopologyScenario(scenario)) {
      var topologySeeder = deps.topologySeeder || resolveCxp06BackupTopologySeeder();
      var topologyServices = deps.topologyServices || {};
      var topologySeeded = false;
      var topologySeedResult = null;
      deps = Object.assign({}, deps, {
        commitServices: Object.assign({}, deps.commitServices || {}, {
          beforeReconcile: function (context) {
            if (topologySeeded) {
              return topologySeedResult;
            }
            topologySeeded = true;
            topologySeedResult = topologySeeder.create({
              backupRepository: context.backupRepository,
              ledgerRepository: context.ledgerRepository,
              now: topologyServices.now,
              targetSpreadsheet: context.targetSpreadsheet,
              uniqueToken: topologyServices.uniqueToken,
            }).seed(scenario);
            return topologySeedResult;
          },
        }),
      });
    }

    var inputOperations = buildInputOperations(inputAdapter, deps);
    var commitOperations = buildCommitOperations(commitService, deps);

    var composedOperations = composeOperations(inputOperations, commitOperations);
    if (faultInjector && typeof faultInjector.wrapOperations === 'function') {
      composedOperations = faultInjector.wrapOperations(composedOperations);
    }

    var runResult = null;
    var executionError = null;

    try {
      runResult = runService.execute(request, composedOperations, deps.runServices || {});
    } catch (error) {
      executionError = error;
    }

    var endTimeMs = Date.now();
    var endedAtUtcStr = new Date(endTimeMs).toISOString();
    var elapsedMs = endTimeMs - startTimeMs;

    var runRecord = runResult ? runResult.runRecord : (executionError && executionError.runRecord ? executionError.runRecord : null);
    var terminalState = runRecord ? runRecord.status : (executionError ? (executionError.failureState || 'FAILED') : 'UNKNOWN');
    var runId = runRecord ? runRecord.runId : (executionError ? executionError.runId || 'failed-run' : 'unknown-run');
    var sanitizedErrorCode = executionError ? (executionError.code || 'UNKNOWN_ERROR') : null;

    var operationResults = (runResult && runResult.operationResults) ? runResult.operationResults : {};
    var healthResults = operationResults.healthCheck || {};

    var rawEvidence = {
      backupCleanupStatus: healthResults.backupCleanupStatus || (executionError ? 'N/A' : 'DELETED'),
      backupSheetCount: deps.backupSheetCount !== undefined
        ? deps.backupSheetCount
        : (topologySeedResult ? topologySeedResult.sheetNames.length : 0),
      backupSheetNames: deps.backupSheetNames ||
        (topologySeedResult ? topologySeedResult.sheetNames : []),
      elapsedMs: elapsedMs,
      endedAtUtc: endedAtUtcStr,
      environment: gate.environment,
      fileLedgerResult: healthResults.ledgerStatus === 'CONFIRMED' ? 'SUCCESS' : (executionError ? 'FAILED' : 'SUCCESS'),
      rawFormulaCount: 0,
      rawRowCounts: request.inputRowCounts,
      rollbackStatus: executionError && executionError.details && executionError.details.rollbackStatus
        ? executionError.details.rollbackStatus
        : (executionError ? 'N/A' : 'NOT_REQUIRED'),
      runId: runId,
      runtimeIndicator: elapsedMs < 300000 ? 'WITHIN_LIMIT' : 'EXCEEDS_QUOTA',
      sanitizedErrorCode: sanitizedErrorCode,
      sanitizedWarningCode: null,
      scenario: scenario,
      stageFormulaCount: 0,
      stageRowCounts: request.inputRowCounts,
      startedAtUtc: startedAtUtc,
      terminalState: terminalState,
    };

    var evidence = resolveCxp06UatEvidence().sanitize(rawEvidence);

    if (executionError) {
      return Object.freeze({
        error: executionError,
        evidence: evidence,
        runRecord: runRecord,
      });
    }

    return Object.freeze({
      evidence: evidence,
      operationResults: operationResults,
      runRecord: runResult ? runResult.runRecord : null,
    });
  }

  return Object.freeze({
    BOOTSTRAP_FOLDER_PROPERTY: BOOTSTRAP_FOLDER_PROPERTY,
    composeOperations: composeOperations,
    createHostedDependencies: createHostedDependencies,
    execute: execute,
    formatSourceValidationLog: formatSourceValidationLog,
    hostedRuntimeServices: hostedRuntimeServices,
    listSourceFiles: listSourceFiles,
    readSyntheticFileIds: readSyntheticFileIds,
    repairSourceFiles: repairSourceFiles,
    requireSafetyGate: requireSafetyGate,
    scanSourceFileValidation: scanSourceFileValidation,
    scanSourceFileValidationLog: scanSourceFileValidationLog,
    UAT_SOURCE_FILE_DEFINITIONS: UAT_SOURCE_FILE_DEFINITIONS,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp06UatHarness;
}
