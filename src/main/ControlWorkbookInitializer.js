var ControlWorkbookInitializer = (function () {
  'use strict';

  function resolveSheetNames() {
    if (typeof SheetNames !== 'undefined') {
      return SheetNames;
    }
    return require('../config/SheetNames.js');
  }

  function resolveWorkbookSkeleton() {
    if (typeof WorkbookSkeleton !== 'undefined') {
      return WorkbookSkeleton;
    }
    return require('../services/WorkbookSkeleton.js');
  }

  function resolveServices(services) {
    if (typeof services !== 'undefined') {
      return services;
    }
    return { spreadsheetApp: SpreadsheetApp, session: Session };
  }

  function initialize(spreadsheet, services) {
    var names = resolveSheetNames();
    return resolveWorkbookSkeleton().initialize(
      spreadsheet,
      names.CONTROL,
      names.BUSINESS_TIME_ZONE,
      names.CONTROL,
      resolveServices(services),
    );
  }

  function preflight(spreadsheet, services) {
    var names = resolveSheetNames();
    return resolveWorkbookSkeleton().preflight(
      spreadsheet,
      names.CONTROL,
      resolveServices(services),
    );
  }

  function resolveControlWorkbookHeaders() {
    if (typeof ControlWorkbookHeaders !== 'undefined') {
      return ControlWorkbookHeaders;
    }
    return require('./ControlWorkbookHeaders.js');
  }

  function seedHeaders(spreadsheet, options) {
    return resolveControlWorkbookHeaders().seed(spreadsheet, options);
  }

  return Object.freeze({
    initialize: initialize,
    preflight: preflight,
    seedHeaders: seedHeaders,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ControlWorkbookInitializer;
}
