var WorkbookInitializer = (function () {
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
      names.targetAll(),
      names.BUSINESS_TIME_ZONE,
      names.targetBackend(),
      resolveServices(services),
    );
  }

  function preflight(spreadsheet, services) {
    var names = resolveSheetNames();
    return resolveWorkbookSkeleton().preflight(
      spreadsheet,
      names.targetBackend(),
      resolveServices(services),
    );
  }

  return Object.freeze({ initialize: initialize, preflight: preflight });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorkbookInitializer;
}
