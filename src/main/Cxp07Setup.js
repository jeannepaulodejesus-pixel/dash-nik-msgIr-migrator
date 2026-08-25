var Cxp07Setup = (function () {
  'use strict';

  var CONTINUATION_HANDLER = 'continueCxp07HandledOfferedTransformations';
  var CONTINUATION_DELAY_MS = 1000;
  var DEFAULT_MAX_RUNTIME_MS = 240000;
  var WATCHDOG_DELAY_MS = 420000;
  var STATE_KEY = 'CXP07_HANDLED_OFFERED_INSTALL_STATE';
  var STATE_VERSION = 1;

  function resolveConfig() {
    if (typeof Config !== 'undefined') {
      return Config;
    }
    return require('../config/Config.js');
  }

  function resolveTransformationService(services) {
    if (services && services.transformationService) {
      return services.transformationService;
    }
    if (typeof HandledOfferedTransformationService !== 'undefined') {
      return HandledOfferedTransformationService;
    }
    return require('../services/HandledOfferedTransformationService.js');
  }

  function resolveServices(services) {
    if (services) {
      return services;
    }
    return {
      clock: { now: function () { return new Date(); } },
      lockService: LockService,
      scriptApp: ScriptApp,
      spreadsheetApp: SpreadsheetApp,
    };
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
    throw new Error('Script Properties are required for CXP-07 initialization.');
  }

  function now(dependencies) {
    var value = dependencies.clock && typeof dependencies.clock.now === 'function'
      ? dependencies.clock.now()
      : new Date();
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error('The CXP-07 runtime clock returned an invalid value.');
    }
    return date;
  }

  function loadState(properties) {
    var raw = properties.getProperty(STATE_KEY);
    if (!raw) {
      return null;
    }
    var state;
    try {
      state = JSON.parse(raw);
    } catch (error) {
      throw new Error('The persisted CXP-07 installation state is invalid.');
    }
    if (!state || state.version !== STATE_VERSION) {
      throw new Error('The persisted CXP-07 installation state is unsupported.');
    }
    return state;
  }

  function saveState(properties, state) {
    properties.setProperty(STATE_KEY, JSON.stringify(state));
  }

  function removeContinuationTriggers(scriptApp) {
    if (
      !scriptApp ||
      typeof scriptApp.getProjectTriggers !== 'function' ||
      typeof scriptApp.deleteTrigger !== 'function'
    ) {
      throw new Error('ScriptApp trigger management is required for CXP-07 continuation.');
    }
    scriptApp.getProjectTriggers().forEach(function (trigger) {
      if (
        trigger &&
        typeof trigger.getHandlerFunction === 'function' &&
        trigger.getHandlerFunction() === CONTINUATION_HANDLER
      ) {
        scriptApp.deleteTrigger(trigger);
      }
    });
  }

  function scheduleContinuation(scriptApp, delayMs) {
    var builder = scriptApp.newTrigger(CONTINUATION_HANDLER).timeBased();
    return builder.after(delayMs).create();
  }

  function publicResult(state, continuationScheduled) {
    return Object.freeze({
      continuationScheduled: continuationScheduled === true,
      environment: state.environment,
      lastCompletedStep: state.lastCompletedStep || null,
      nextStep: state.nextStep,
      status: state.status,
      stepCount: state.stepCount,
    });
  }

  function requireLock(dependencies) {
    if (
      !dependencies.lockService ||
      typeof dependencies.lockService.getScriptLock !== 'function'
    ) {
      throw new Error('LockService is required for CXP-07 continuation.');
    }
    var lock = dependencies.lockService.getScriptLock();
    if (
      !lock ||
      typeof lock.tryLock !== 'function' ||
      typeof lock.releaseLock !== 'function' ||
      !lock.tryLock(5000)
    ) {
      throw new Error('Another CXP-07 installation step is already running.');
    }
    return lock;
  }

  function newState(configuration, targetId, stepCount, startedAt) {
    return {
      completedAtUtc: null,
      environment: configuration.environment,
      lastCompletedStep: null,
      nextStep: 0,
      startedAtUtc: startedAt.toISOString(),
      status: 'RUNNING',
      stepCount: stepCount,
      targetSpreadsheetId: targetId,
      updatedAtUtc: startedAt.toISOString(),
      version: STATE_VERSION,
    };
  }

  function validateStateTarget(state, configuration, targetId) {
    if (
      state.environment !== configuration.environment ||
      state.targetSpreadsheetId !== targetId
    ) {
      throw new Error(
        'The active CXP-07 installation targets a different environment or spreadsheet.',
      );
    }
  }

  function runResumable(configuration, targetId, properties, dependencies, continueOnly) {
    var transformationService = resolveTransformationService(dependencies);
    if (
      typeof transformationService.getInstallStepCount !== 'function' ||
      typeof transformationService.installStep !== 'function'
    ) {
      throw new Error('The CXP-07 transformation service is not resumable.');
    }
    var lock = requireLock(dependencies);
    try {
      removeContinuationTriggers(dependencies.scriptApp);
      var state = loadState(properties);
      if (!state) {
        if (continueOnly) {
          return Object.freeze({
            continuationScheduled: false,
            environment: configuration.environment,
            lastCompletedStep: null,
            nextStep: 0,
            status: 'IDLE',
            stepCount: transformationService.getInstallStepCount(),
          });
        }
        state = newState(
          configuration,
          targetId,
          transformationService.getInstallStepCount(),
          now(dependencies),
        );
        saveState(properties, state);
      } else {
        validateStateTarget(state, configuration, targetId);
        if (!continueOnly && state.status === 'COMPLETE') {
          state = newState(
            configuration,
            targetId,
            transformationService.getInstallStepCount(),
            now(dependencies),
          );
          saveState(properties, state);
        } else if (state.status === 'FAILED') {
          state.status = 'RUNNING';
          state.lastError = null;
          state.updatedAtUtc = now(dependencies).toISOString();
          saveState(properties, state);
        }
      }

      if (state.status === 'COMPLETE') {
        return publicResult(state, false);
      }

      scheduleContinuation(dependencies.scriptApp, WATCHDOG_DELAY_MS);
      var spreadsheet = dependencies.spreadsheetApp.openById(targetId);
      var invocationStartedMs = now(dependencies).getTime();
      var maxRuntimeMs = Number.isFinite(dependencies.maxRuntimeMs)
        ? dependencies.maxRuntimeMs
        : DEFAULT_MAX_RUNTIME_MS;
      try {
        while (state.nextStep < state.stepCount) {
          var stepResult = transformationService.installStep(
            spreadsheet,
            state.nextStep,
          );
          state.lastCompletedStep = stepResult.label;
          state.nextStep += 1;
          state.updatedAtUtc = now(dependencies).toISOString();
          saveState(properties, state);
          if (
            state.nextStep < state.stepCount &&
            now(dependencies).getTime() - invocationStartedMs >= maxRuntimeMs
          ) {
            break;
          }
        }
      } catch (error) {
        removeContinuationTriggers(dependencies.scriptApp);
        state.status = 'FAILED';
        state.lastError = error && error.message ? String(error.message) : 'CXP-07 step failed.';
        state.updatedAtUtc = now(dependencies).toISOString();
        saveState(properties, state);
        throw error;
      }

      if (state.nextStep >= state.stepCount) {
        removeContinuationTriggers(dependencies.scriptApp);
        state.status = 'COMPLETE';
        state.completedAtUtc = now(dependencies).toISOString();
        state.updatedAtUtc = state.completedAtUtc;
        saveState(properties, state);
        return publicResult(state, false);
      }

      state.status = 'RUNNING';
      removeContinuationTriggers(dependencies.scriptApp);
      scheduleContinuation(dependencies.scriptApp, CONTINUATION_DELAY_MS);
      state.updatedAtUtc = now(dependencies).toISOString();
      saveState(properties, state);
      return publicResult(state, true);
    } finally {
      lock.releaseLock();
    }
  }

  function supportsResumableRuntime(dependencies) {
    var transformationService = resolveTransformationService(dependencies);
    return Boolean(
      dependencies.scriptApp &&
      dependencies.lockService &&
      typeof transformationService.getInstallStepCount === 'function' &&
      typeof transformationService.installStep === 'function'
    );
  }

  function initializeConfigured(properties, services) {
    var configModule = resolveConfig();
    var resolvedProperties = resolveProperties(properties);
    var configuration = configModule.load(resolvedProperties);
    var targetId = typeof configuration.targetSpreadsheetId === 'string'
      ? configuration.targetSpreadsheetId.trim()
      : '';
    if (!targetId) {
      throw new Error(
        configModule.propertyKey(
          configuration.environment,
          configModule.CONFIGURATION_KEYS.targetSpreadsheetId,
        ) + ' is required for CXP-07 initialization.',
      );
    }
    var dependencies = resolveServices(services);
    if (
      !dependencies.spreadsheetApp ||
      typeof dependencies.spreadsheetApp.openById !== 'function'
    ) {
      throw new Error(
        'A SpreadsheetApp adapter with openById is required for CXP-07 initialization.',
      );
    }
    if (supportsResumableRuntime(dependencies)) {
      return runResumable(
        configuration,
        targetId,
        resolvedProperties,
        dependencies,
        false,
      );
    }
    var spreadsheet = dependencies.spreadsheetApp.openById(targetId);
    return Object.freeze({
      environment: configuration.environment,
      transformations: resolveTransformationService(dependencies).install(spreadsheet),
    });
  }

  function continueConfigured(properties, services) {
    var resolvedProperties = resolveProperties(properties);
    var configModule = resolveConfig();
    var configuration = configModule.load(resolvedProperties);
    var targetId = typeof configuration.targetSpreadsheetId === 'string'
      ? configuration.targetSpreadsheetId.trim()
      : '';
    if (!targetId) {
      throw new Error('The configured CXP-07 target spreadsheet ID is required.');
    }
    var dependencies = resolveServices(services);
    return runResumable(
      configuration,
      targetId,
      resolvedProperties,
      dependencies,
      true,
    );
  }

  function getStatus(properties) {
    var state = loadState(resolveProperties(properties));
    if (!state) {
      return Object.freeze({
        completedAtUtc: null,
        environment: null,
        lastCompletedStep: null,
        lastError: null,
        nextStep: 0,
        startedAtUtc: null,
        status: 'IDLE',
        stepCount: resolveTransformationService().getInstallStepCount(),
        updatedAtUtc: null,
      });
    }
    return Object.freeze({
      completedAtUtc: state.completedAtUtc || null,
      environment: state.environment,
      lastCompletedStep: state.lastCompletedStep || null,
      lastError: state.lastError || null,
      nextStep: state.nextStep,
      startedAtUtc: state.startedAtUtc,
      status: state.status,
      stepCount: state.stepCount,
      updatedAtUtc: state.updatedAtUtc,
    });
  }

  return Object.freeze({
    CONTINUATION_HANDLER: CONTINUATION_HANDLER,
    STATE_KEY: STATE_KEY,
    continueConfigured: continueConfigured,
    getStatus: getStatus,
    initializeConfigured: initializeConfigured,
  });
})();

function initializeCxp07HandledOfferedTransformations() {
  return Cxp07Setup.initializeConfigured();
}

function continueCxp07HandledOfferedTransformations() {
  return Cxp07Setup.continueConfigured();
}

function getCxp07HandledOfferedTransformationStatus() {
  var status = Cxp07Setup.getStatus();
  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    console.log('CXP07_STATUS ' + JSON.stringify(status));
  }
  return status;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp07Setup;
}
