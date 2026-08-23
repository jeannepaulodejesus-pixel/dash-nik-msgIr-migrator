var XlsxAdapter = (function () {
  'use strict';

  var GOOGLE_SHEETS_MIME = 'application/vnd.google-apps.spreadsheet';
  var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function resolveCleanupService() {
    if (typeof CleanupService !== 'undefined') {
      return CleanupService;
    }
    return require('../services/CleanupService.js');
  }

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function resolveService(injected, globalName) {
    if (injected) {
      return injected;
    }
    if (typeof globalThis !== 'undefined' && globalThis[globalName]) {
      return globalThis[globalName];
    }
    throw resolveErrorCodes().create('SOURCE_XLSX_CONVERSION_FAILED', {
      details: { dependency: globalName },
    });
  }

  function supportsXlsxImport(driveApi) {
    if (!driveApi.About || typeof driveApi.About.get !== 'function') {
      throw resolveErrorCodes().create('SOURCE_XLSX_CONVERSION_UNAVAILABLE', {
        details: { reason: 'about_api_unavailable' },
      });
    }
    var about = driveApi.About.get({ fields: 'importFormats' });
    var targets = about && about.importFormats && about.importFormats[XLSX_MIME];
    return Array.isArray(targets) && targets.indexOf(GOOGLE_SHEETS_MIME) !== -1;
  }

  function hasValue(value) {
    return value !== '' && value !== null && value !== undefined;
  }

  function trimGrid(values) {
    var rows = values.map(function (row) { return row.slice(); });
    while (rows.length > 0 && rows[rows.length - 1].every(function (value) { return !hasValue(value); })) {
      rows.pop();
    }
    if (rows.length === 0) {
      return [];
    }
    var width = rows.reduce(function (maximum, row) {
      for (var index = row.length - 1; index >= 0; index -= 1) {
        if (hasValue(row[index])) {
          return Math.max(maximum, index + 1);
        }
      }
      return maximum;
    }, 0);
    return rows.map(function (row) { return row.slice(0, width); });
  }

  function rejectFormulas(sheetName, formulas) {
    for (var rowIndex = 0; rowIndex < formulas.length; rowIndex += 1) {
      for (var columnIndex = 0; columnIndex < formulas[rowIndex].length; columnIndex += 1) {
        if (formulas[rowIndex][columnIndex]) {
          throw resolveErrorCodes().create('SOURCE_FORMULAS_NOT_ALLOWED', {
            details: {
              columnNumber: columnIndex + 1,
              rowNumber: rowIndex + 1,
              sheetName: sheetName,
            },
          });
        }
      }
    }
  }

  function readSheets(spreadsheet) {
    if (typeof spreadsheet.setSpreadsheetTimeZone === 'function') {
      spreadsheet.setSpreadsheetTimeZone('Etc/UTC');
    }
    return spreadsheet.getSheets().map(function (sheet) {
      var range = sheet.getDataRange();
      var values = range.getValues();
      rejectFormulas(sheet.getName(), range.getFormulas());
      return Object.freeze({
        name: sheet.getName(),
        values: Object.freeze(trimGrid(values).map(function (row) {
          return Object.freeze(row);
        })),
      });
    });
  }

  function read(source, services) {
    var dependencies = services || {};
    var driveApi = resolveService(dependencies.driveApi, 'Drive');
    var spreadsheetApp = resolveService(dependencies.spreadsheetApp, 'SpreadsheetApp');
    var utilities = resolveService(dependencies.utilities, 'Utilities');
    if (!source || source.format !== 'xlsx' || !source.blob) {
      throw resolveErrorCodes().create('SOURCE_UNSUPPORTED_FORMAT', {
        details: { expectedFormat: 'xlsx' },
      });
    }
    if (!supportsXlsxImport(driveApi)) {
      throw resolveErrorCodes().create('SOURCE_XLSX_CONVERSION_UNAVAILABLE', {
        details: { inputMimeType: XLSX_MIME, targetMimeType: GOOGLE_SHEETS_MIME },
      });
    }
    if (!driveApi.Files || typeof driveApi.Files.create !== 'function') {
      throw resolveErrorCodes().create('SOURCE_XLSX_CONVERSION_UNAVAILABLE', {
        details: { reason: 'files_create_unavailable' },
      });
    }

    var temporaryFileId = null;
    var result = null;
    var primaryError = null;
    try {
      var created = driveApi.Files.create(
        {
          mimeType: GOOGLE_SHEETS_MIME,
          name: 'CXP-05 temporary conversion ' + utilities.getUuid(),
        },
        source.blob,
        { fields: 'id' },
      );
      if (!created || typeof created.id !== 'string' || !created.id) {
        throw new Error('Drive conversion did not return a file ID.');
      }
      temporaryFileId = created.id;
      var spreadsheet = spreadsheetApp.openById(temporaryFileId);
      result = Object.freeze({ sheets: Object.freeze(readSheets(spreadsheet)) });
    } catch (error) {
      primaryError = resolveErrorCodes().normalize(error, 'SOURCE_XLSX_CONVERSION_FAILED');
    }

    if (temporaryFileId) {
      try {
        resolveCleanupService().removeTempFile(temporaryFileId, dependencies);
      } catch (cleanupError) {
        throw resolveErrorCodes().create('SOURCE_TEMP_CLEANUP_FAILED', {
          cause: cleanupError,
          details: {
            originalErrorCode: primaryError ? primaryError.code : null,
            tempFileIdPresent: true,
          },
        });
      }
    }
    if (primaryError) {
      throw primaryError;
    }
    return result;
  }

  return Object.freeze({
    GOOGLE_SHEETS_MIME: GOOGLE_SHEETS_MIME,
    XLSX_MIME: XLSX_MIME,
    read: read,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = XlsxAdapter;
}
