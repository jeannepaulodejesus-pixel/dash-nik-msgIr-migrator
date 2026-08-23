var WorkbookSkeleton = (function () {
  'use strict';

  function resolveProtectionHelpers() {
    if (typeof ProtectionHelpers !== 'undefined') {
      return ProtectionHelpers;
    }
    return require('./ProtectionHelpers.js');
  }

  function validateSpreadsheet(spreadsheet) {
    if (
      !spreadsheet ||
      typeof spreadsheet.getSheetByName !== 'function' ||
      typeof spreadsheet.insertSheet !== 'function' ||
      typeof spreadsheet.setSpreadsheetTimeZone !== 'function'
    ) {
      throw new Error(
        'A Spreadsheet-compatible target must provide getSheetByName, insertSheet, and setSpreadsheetTimeZone.',
      );
    }
  }

  function preflight(spreadsheet, protectedSheetNames, services) {
    validateSpreadsheet(spreadsheet);
    var protectionHelpers = resolveProtectionHelpers();
    if (protectedSheetNames.length > 0) {
      var validatedProtectionServices = protectionHelpers.validateServices(
        services,
        'to protect backend sheets',
      );
      protectedSheetNames.forEach(function (sheetName) {
        var existingSheet = spreadsheet.getSheetByName(sheetName);
        if (existingSheet) {
          protectionHelpers.assertManagedProtectionAvailable(
            existingSheet,
            validatedProtectionServices.protectionType,
          );
        }
      });
    }
  }

  function initialize(spreadsheet, sheetNames, timeZone, protectedSheetNames, services) {
    preflight(spreadsheet, protectedSheetNames, services);
    var protectionHelpers = resolveProtectionHelpers();

    spreadsheet.setSpreadsheetTimeZone(timeZone);
    var createdSheets = [];
    var existingSheets = [];

    sheetNames.forEach(function (sheetName) {
      var sheet = spreadsheet.getSheetByName(sheetName);
      if (sheet) {
        existingSheets.push(sheetName);
      } else {
        sheet = spreadsheet.insertSheet(sheetName);
        createdSheets.push(sheetName);
      }

      if (protectedSheetNames.indexOf(sheetName) !== -1) {
        protectionHelpers.ensureManagedProtection(sheet, services);
      }
    });

    return Object.freeze({
      createdSheets: Object.freeze(createdSheets),
      existingSheets: Object.freeze(existingSheets),
    });
  }

  return Object.freeze({ initialize: initialize, preflight: preflight });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorkbookSkeleton;
}
