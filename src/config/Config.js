var Config = (function () {
  'use strict';

  var ACTIVE_ENVIRONMENT_KEY = 'CXP_ENV';
  var SUPPORTED_ENVIRONMENTS = Object.freeze(['DEV', 'UAT', 'PROD']);
  var CONFIGURATION_KEYS = Object.freeze({
    targetSpreadsheetId: 'TARGET_SPREADSHEET_ID',
    controlSpreadsheetId: 'CONTROL_SPREADSHEET_ID',
    driveInboxFolderId: 'DRIVE_INBOX_FOLDER_ID',
    masterTemplateSpreadsheetId: 'MASTER_TEMPLATE_SPREADSHEET_ID',
    legacyParityExportFolderId: 'LEGACY_PARITY_EXPORT_FOLDER_ID',
    rtaAllowedDomain: 'RTA_ALLOWED_DOMAIN',
    staleDataThresholdMinutes: 'STALE_DATA_THRESHOLD_MINUTES',
  });

  function normalizeEnvironment(value) {
    var normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';

    if (SUPPORTED_ENVIRONMENTS.indexOf(normalized) === -1) {
      throw new Error('CXP_ENV must be one of DEV, UAT, PROD.');
    }

    return normalized;
  }

  function propertyKey(environment, suffix) {
    var normalizedEnvironment = normalizeEnvironment(environment);
    var allowedSuffixes = Object.keys(CONFIGURATION_KEYS).map(function (name) {
      return CONFIGURATION_KEYS[name];
    });

    if (allowedSuffixes.indexOf(suffix) === -1) {
      throw new Error('Unknown configuration key: ' + suffix);
    }

    return 'CXP_' + normalizedEnvironment + '_' + suffix;
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

    throw new Error(
      'A PropertiesService-compatible adapter is required outside Apps Script.',
    );
  }

  function optionalProperty(properties, name) {
    var value = properties.getProperty(name);
    return value === null || value === undefined || value === '' ? null : value;
  }

  function load(properties) {
    var resolvedProperties = resolveProperties(properties);
    var environment = normalizeEnvironment(
      resolvedProperties.getProperty(ACTIVE_ENVIRONMENT_KEY),
    );
    var configuration = { environment: environment };

    Object.keys(CONFIGURATION_KEYS).forEach(function (name) {
      configuration[name] = optionalProperty(
        resolvedProperties,
        propertyKey(environment, CONFIGURATION_KEYS[name]),
      );
    });

    return Object.freeze(configuration);
  }

  return Object.freeze({
    ACTIVE_ENVIRONMENT_KEY: ACTIVE_ENVIRONMENT_KEY,
    CONFIGURATION_KEYS: CONFIGURATION_KEYS,
    SUPPORTED_ENVIRONMENTS: SUPPORTED_ENVIRONMENTS,
    load: load,
    normalizeEnvironment: normalizeEnvironment,
    propertyKey: propertyKey,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Config;
}
