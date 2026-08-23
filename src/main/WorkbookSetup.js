var WorkbookSetup = (function () {
  'use strict';

  function resolveDependency(globalDependency, requirePath) {
    if (globalDependency) {
      return globalDependency;
    }
    return require(requirePath);
  }

  function resolveServices(services) {
    if (typeof services !== 'undefined') {
      return services;
    }
    return { spreadsheetApp: SpreadsheetApp, session: Session };
  }

  function resolveProtectionHelpers() {
    if (typeof ProtectionHelpers !== 'undefined') {
      return ProtectionHelpers;
    }
    return require('../services/ProtectionHelpers.js');
  }

  function requiredSpreadsheetId(configuration, configModule, fieldName) {
    var value = configuration[fieldName];
    var suffix = configModule.CONFIGURATION_KEYS[fieldName];
    var propertyName = configModule.propertyKey(configuration.environment, suffix);
    var normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
      throw new Error(propertyName + ' is required for CXP-02 initialization.');
    }
    return normalized;
  }

  function initializeConfiguredWorkbooks(properties, services) {
    var configModule = resolveDependency(
      typeof Config !== 'undefined' ? Config : null,
      '../config/Config.js',
    );
    var targetInitializer = resolveDependency(
      typeof WorkbookInitializer !== 'undefined' ? WorkbookInitializer : null,
      './WorkbookInitializer.js',
    );
    var controlInitializer = resolveDependency(
      typeof ControlWorkbookInitializer !== 'undefined'
        ? ControlWorkbookInitializer
        : null,
      './ControlWorkbookInitializer.js',
    );
    var configuration = configModule.load(properties);
    var targetSpreadsheetId = requiredSpreadsheetId(
      configuration,
      configModule,
      'targetSpreadsheetId',
    );
    var controlSpreadsheetId = requiredSpreadsheetId(
      configuration,
      configModule,
      'controlSpreadsheetId',
    );
    if (targetSpreadsheetId === controlSpreadsheetId) {
      throw new Error('Target and control spreadsheet IDs must be distinct.');
    }

    var resolvedServices = resolveServices(services);
    resolveProtectionHelpers().validateServices(
      resolvedServices,
      'for CXP-02 initialization',
    );
    if (typeof resolvedServices.spreadsheetApp.openById !== 'function') {
      throw new Error(
        'A SpreadsheetApp adapter with openById is required for CXP-02 initialization.',
      );
    }
    var target = resolvedServices.spreadsheetApp.openById(
      targetSpreadsheetId,
    );
    var control = resolvedServices.spreadsheetApp.openById(
      controlSpreadsheetId,
    );

    targetInitializer.preflight(target, resolvedServices);
    controlInitializer.preflight(control, resolvedServices);

    return Object.freeze({
      environment: configuration.environment,
      target: targetInitializer.initialize(target, resolvedServices),
      control: controlInitializer.initialize(control, resolvedServices),
    });
  }

  return Object.freeze({
    initializeConfiguredWorkbooks: initializeConfiguredWorkbooks,
  });
})();

function initializeCxp02Workbooks() {
  return WorkbookSetup.initializeConfiguredWorkbooks();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorkbookSetup;
}
