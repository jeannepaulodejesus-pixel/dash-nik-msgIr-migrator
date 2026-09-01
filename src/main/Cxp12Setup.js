/**
 * CXP-12 lifecycle setup: install final WEEK_REGISTRY headers on the control workbook.
 */
var Cxp12Setup = (function () {
  'use strict';

  var STATE_KEY = 'CXP12_LIFECYCLE_SETUP_STATE_V1';
  var STATE_VERSION = 1;
  var SETUP_STATES = Object.freeze({
    IDLE: 'IDLE',
    RUNNING: 'RUNNING',
    COMPLETE: 'COMPLETE',
    FAILED: 'FAILED',
  });
  var STEPS = Object.freeze([
    'INSTALL_WEEK_REGISTRY_HEADERS',
    'VERIFY_WEEK_REGISTRY_HEADERS',
  ]);

  function resolveConfig() {
    if (typeof Config !== 'undefined') {
      return Config;
    }
    return require('../config/Config.js');
  }

  function resolveWeekRegistry() {
    if (typeof WeekRegistryRepository !== 'undefined') {
      return WeekRegistryRepository;
    }
    return require('../repository/WeekRegistryRepository.js');
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
    throw new Error('Script Properties are required for CXP-12 setup.');
  }

  function emitLog(tag, payload) {
    var line = 'CXP12_SETUP ' + tag + ' ' + JSON.stringify(payload || {});
    if (typeof console !== 'undefined' && typeof console.log === 'function') {
      console.log(line);
    }
    if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
      Logger.log(line);
    }
  }

  function loadState(properties) {
    var raw = properties.getProperty(STATE_KEY);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function saveState(properties, state) {
    properties.setProperty(STATE_KEY, JSON.stringify(state));
  }

  function clearState(properties) {
    if (typeof properties.deleteProperty === 'function') {
      properties.deleteProperty(STATE_KEY);
    } else {
      properties.setProperty(STATE_KEY, '');
    }
  }

  function openControl(services, configuration) {
    if (!configuration.controlSpreadsheetId) {
      throw new Error('CXP_<ENV>_CONTROL_SPREADSHEET_ID is required.');
    }
    return services.spreadsheetApp.openById(configuration.controlSpreadsheetId);
  }

  function runStep(stepName, control) {
    var registry = resolveWeekRegistry().create(control);
    if (stepName === 'INSTALL_WEEK_REGISTRY_HEADERS') {
      registry.installHeaders();
      return { installed: true };
    }
    if (stepName === 'VERIFY_WEEK_REGISTRY_HEADERS') {
      if (!registry.headersMatch()) {
        throw new Error('WEEK_REGISTRY headers do not match the CXP-12 contract.');
      }
      return { verified: true };
    }
    throw new Error('Unknown CXP-12 setup step: ' + stepName);
  }

  function getStatus(properties) {
    var state = loadState(resolveProperties(properties));
    if (!state) {
      return Object.freeze({
        nextStep: 0,
        status: SETUP_STATES.IDLE,
        stepCount: STEPS.length,
      });
    }
    return Object.freeze({
      errorCode: state.errorCode || null,
      nextStep: state.nextStep || 0,
      status: state.status || SETUP_STATES.IDLE,
      stepCount: STEPS.length,
      version: state.version || STATE_VERSION,
    });
  }

  function initialize(services, properties) {
    var props = resolveProperties(properties);
    var configuration = resolveConfig().load(props);
    var resolvedServices = services || {
      spreadsheetApp: typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp : null,
    };
    if (!resolvedServices.spreadsheetApp) {
      throw new Error('SpreadsheetApp is required for CXP-12 setup.');
    }
    var control = openControl(resolvedServices, configuration);
    var state = {
      nextStep: 0,
      status: SETUP_STATES.RUNNING,
      version: STATE_VERSION,
    };
    saveState(props, state);
    emitLog('start', { stepCount: STEPS.length });

    for (var index = 0; index < STEPS.length; index += 1) {
      var stepName = STEPS[index];
      try {
        runStep(stepName, control);
        state.nextStep = index + 1;
        saveState(props, state);
        emitLog('step', { nextStep: state.nextStep, step: stepName });
      } catch (error) {
        state.status = SETUP_STATES.FAILED;
        state.errorCode = error && error.code ? error.code : 'LIFECYCLE_REGISTRY_SCHEMA_MISMATCH';
        saveState(props, state);
        emitLog('failed', { errorCode: state.errorCode, step: stepName });
        throw error;
      }
    }

    state.status = SETUP_STATES.COMPLETE;
    saveState(props, state);
    emitLog('complete', { nextStep: state.nextStep });
    return getStatus(props);
  }

  function reset(properties, options) {
    var props = resolveProperties(properties);
    var current = getStatus(props);
    if (current.status === SETUP_STATES.RUNNING && !(options && options.force)) {
      throw new Error('Refusing to reset CXP-12 setup while RUNNING.');
    }
    clearState(props);
    return getStatus(props);
  }

  return Object.freeze({
    SETUP_STATES: SETUP_STATES,
    STATE_KEY: STATE_KEY,
    STEPS: STEPS,
    getStatus: getStatus,
    initialize: initialize,
    reset: reset,
  });
})();

function initializeCxp12Lifecycle() {
  return Cxp12Setup.initialize();
}

function continueCxp12LifecycleSetup() {
  return Cxp12Setup.initialize();
}

function getCxp12LifecycleSetupStatus() {
  return Cxp12Setup.getStatus();
}

function resetCxp12LifecycleSetupState() {
  return Cxp12Setup.reset();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp12Setup;
}
