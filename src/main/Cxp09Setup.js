var Cxp09Setup = (function () {
  'use strict';

  var CONTINUATION_HANDLER = 'continueCxp09StableAggregationModel';
  var CONTINUATION_DELAY_MS = 1000;
  var DEFAULT_MAX_RUNTIME_MS = 240000;
  var WATCHDOG_DELAY_MS = 420000;
  // V3 removes CXP-09 ownership of the CXP-10 forecast bridge anchor.
  var STATE_KEY = 'CXP09_AGGREGATION_INSTALL_STATE_V3';
  var STATE_VERSION = 3;

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
    if (typeof StableAggregationTransformationService !== 'undefined') {
      return StableAggregationTransformationService;
    }
    return require('../services/StableAggregationTransformationService.js');
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
    throw new Error('Script Properties are required for CXP-09 initialization.');
  }

  function now(dependencies) {
    var value = dependencies.clock && typeof dependencies.clock.now === 'function'
      ? dependencies.clock.now()
      : new Date();
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error('The CXP-09 runtime clock returned an invalid value.');
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
      throw new Error('The persisted CXP-09 installation state is invalid.');
    }
    if (!state || state.version !== STATE_VERSION) {
      throw new Error('The persisted CXP-09 installation state is unsupported.');
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
      throw new Error('ScriptApp trigger management is required for CXP-09 continuation.');
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
      targetSpreadsheetId: state.targetSpreadsheetId || null,
    });
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

  function requireLock(dependencies) {
    if (
      !dependencies.lockService ||
      typeof dependencies.lockService.getScriptLock !== 'function'
    ) {
      throw new Error('LockService is required for CXP-09 continuation.');
    }
    var lock = dependencies.lockService.getScriptLock();
    if (
      !lock ||
      typeof lock.tryLock !== 'function' ||
      typeof lock.releaseLock !== 'function' ||
      !lock.tryLock(5000)
    ) {
      throw new Error('Another CXP-09 installation step is already running.');
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
        'The active CXP-09 installation targets a different environment or spreadsheet. ' +
          'activeTarget=' + (state.targetSpreadsheetId || 'null') +
          ' configuredTarget=' + targetId +
          ' activeEnv=' + (state.environment || 'null') +
          ' configuredEnv=' + configuration.environment +
          '. If no install is RUNNING, delete Script Property ' + STATE_KEY +
          ' or run resetCxp07StableAggregationInstallationState().',
      );
    }
  }

  function clearState(properties) {
    var resolved = resolveProperties(properties);
    if (typeof resolved.deleteProperty === 'function') {
      resolved.deleteProperty(STATE_KEY);
      return;
    }
    if (typeof resolved.setProperty === 'function') {
      resolved.setProperty(STATE_KEY, '');
    }
  }

  function resetConfigured(properties, services) {
    var dependencies = resolveServices(services);
    var lock = requireLock(dependencies);
    try {
      removeContinuationTriggers(dependencies.scriptApp);
      clearState(resolveProperties(properties));
      return Object.freeze({
        cleared: true,
        stateKey: STATE_KEY,
        status: 'IDLE',
      });
    } finally {
      lock.releaseLock();
    }
  }

  function runResumable(configuration, targetId, properties, dependencies, continueOnly) {
    var transformationService = resolveTransformationService(dependencies);
    if (
      typeof transformationService.getInstallStepCount !== 'function' ||
      typeof transformationService.installStep !== 'function'
    ) {
      throw new Error('The CXP-09 transformation service is not resumable.');
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
        var targetMismatch =
          state.environment !== configuration.environment ||
          state.targetSpreadsheetId !== targetId;
        if (targetMismatch) {
          // Allow a clean reinstall when prior work finished or failed on another
          // target. Refuse to retarget a RUNNING install (operator must reset).
          if (continueOnly || state.status === 'RUNNING') {
            validateStateTarget(state, configuration, targetId);
          }
          state = newState(
            configuration,
            targetId,
            transformationService.getInstallStepCount(),
            now(dependencies),
          );
          saveState(properties, state);
        } else if (!continueOnly && state.status === 'COMPLETE') {
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
      emitLog('CXP09_INSTALL', {
        event: continueOnly ? 'CONTINUE' : 'INITIALIZE',
        environment: configuration.environment,
        targetSpreadsheetId: targetId,
        nextStep: state.nextStep,
        stepCount: state.stepCount,
        status: state.status,
      });
      var spreadsheet = dependencies.spreadsheetApp.openById(targetId);
      var invocationStartedMs = now(dependencies).getTime();
      var maxRuntimeMs = Number.isFinite(dependencies.maxRuntimeMs)
        ? dependencies.maxRuntimeMs
        : DEFAULT_MAX_RUNTIME_MS;
      try {
        while (state.nextStep < state.stepCount) {
          var stepIndex = state.nextStep;
          var stepResult = transformationService.installStep(
            spreadsheet,
            stepIndex,
          );
          state.lastCompletedStep = stepResult.label;
          state.nextStep += 1;
          state.updatedAtUtc = now(dependencies).toISOString();
          saveState(properties, state);
          emitLog('CXP09_STEP', {
            stepIndex: stepIndex,
            label: stepResult.label,
            nextStep: state.nextStep,
            stepCount: state.stepCount,
            elapsedMs: now(dependencies).getTime() - invocationStartedMs,
          });
          if (
            state.nextStep < state.stepCount &&
            now(dependencies).getTime() - invocationStartedMs >= maxRuntimeMs
          ) {
            emitLog('CXP09_INSTALL', {
              event: 'CHECKPOINT',
              nextStep: state.nextStep,
              stepCount: state.stepCount,
              lastCompletedStep: state.lastCompletedStep,
              elapsedMs: now(dependencies).getTime() - invocationStartedMs,
            });
            break;
          }
        }
      } catch (error) {
        removeContinuationTriggers(dependencies.scriptApp);
        state.status = 'FAILED';
        state.lastError = error && error.message ? String(error.message) : 'CXP-09 step failed.';
        state.updatedAtUtc = now(dependencies).toISOString();
        saveState(properties, state);
        emitLog('CXP09_INSTALL', {
          event: 'FAILED',
          nextStep: state.nextStep,
          stepCount: state.stepCount,
          lastCompletedStep: state.lastCompletedStep,
          lastError: state.lastError,
        });
        throw error;
      }

      if (state.nextStep >= state.stepCount) {
        removeContinuationTriggers(dependencies.scriptApp);
        state.status = 'COMPLETE';
        state.completedAtUtc = now(dependencies).toISOString();
        state.updatedAtUtc = state.completedAtUtc;
        saveState(properties, state);
        var completeResult = publicResult(state, false);
        emitLog('CXP09_INSTALL', {
          event: 'COMPLETE',
          status: completeResult.status,
          nextStep: completeResult.nextStep,
          stepCount: completeResult.stepCount,
          lastCompletedStep: completeResult.lastCompletedStep,
          targetSpreadsheetId: completeResult.targetSpreadsheetId,
          continuationScheduled: false,
        });
        return completeResult;
      }

      state.status = 'RUNNING';
      removeContinuationTriggers(dependencies.scriptApp);
      scheduleContinuation(dependencies.scriptApp, CONTINUATION_DELAY_MS);
      state.updatedAtUtc = now(dependencies).toISOString();
      saveState(properties, state);
      var runningResult = publicResult(state, true);
      emitLog('CXP09_INSTALL', {
        event: 'RUNNING',
        status: runningResult.status,
        nextStep: runningResult.nextStep,
        stepCount: runningResult.stepCount,
        lastCompletedStep: runningResult.lastCompletedStep,
        targetSpreadsheetId: runningResult.targetSpreadsheetId,
        continuationScheduled: true,
      });
      return runningResult;
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
        ) + ' is required for CXP-09 initialization.',
      );
    }
    var dependencies = resolveServices(services);
    if (
      !dependencies.spreadsheetApp ||
      typeof dependencies.spreadsheetApp.openById !== 'function'
    ) {
      throw new Error(
        'A SpreadsheetApp adapter with openById is required for CXP-09 initialization.',
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
      throw new Error('The configured CXP-09 target spreadsheet ID is required.');
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
        targetSpreadsheetId: null,
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
      targetSpreadsheetId: state.targetSpreadsheetId || null,
      updatedAtUtc: state.updatedAtUtc,
    });
  }

  return Object.freeze({
    CONTINUATION_HANDLER: CONTINUATION_HANDLER,
    STATE_KEY: STATE_KEY,
    continueConfigured: continueConfigured,
    emitLog: emitLog,
    getStatus: getStatus,
    initializeConfigured: initializeConfigured,
    resetConfigured: resetConfigured,
  });
})();

function logCxp09Public(tag, payload) {
  if (typeof Cxp09Setup !== 'undefined' && typeof Cxp09Setup.emitLog === 'function') {
    Cxp09Setup.emitLog(tag, payload);
    return;
  }
  var line = tag + ' ' + JSON.stringify(payload || {});
  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    console.log(line);
  }
  if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
    Logger.log(line);
  }
}

function initializeCxp09StableAggregationModel() {
  logCxp09Public('CXP09_INSTALL', { event: 'START', mode: 'initialize' });
  try {
    var result = Cxp09Setup.initializeConfigured();
    logCxp09Public('CXP09_INSTALL', {
      event: 'RETURN',
      mode: 'initialize',
      status: result.status,
      nextStep: result.nextStep,
      stepCount: result.stepCount,
      lastCompletedStep: result.lastCompletedStep,
      continuationScheduled: result.continuationScheduled,
      targetSpreadsheetId: result.targetSpreadsheetId || null,
    });
    return result;
  } catch (error) {
    logCxp09Public('CXP09_INSTALL', {
      event: 'ERROR',
      mode: 'initialize',
      message: error && error.message ? String(error.message) : String(error),
    });
    throw error;
  }
}

function continueCxp09StableAggregationModel() {
  logCxp09Public('CXP09_INSTALL', { event: 'START', mode: 'continue' });
  try {
    var result = Cxp09Setup.continueConfigured();
    logCxp09Public('CXP09_INSTALL', {
      event: 'RETURN',
      mode: 'continue',
      status: result.status,
      nextStep: result.nextStep,
      stepCount: result.stepCount,
      lastCompletedStep: result.lastCompletedStep,
      continuationScheduled: result.continuationScheduled,
      targetSpreadsheetId: result.targetSpreadsheetId || null,
    });
    return result;
  } catch (error) {
    logCxp09Public('CXP09_INSTALL', {
      event: 'ERROR',
      mode: 'continue',
      message: error && error.message ? String(error.message) : String(error),
    });
    throw error;
  }
}

function getCxp09StableAggregationStatus() {
  var status = Cxp09Setup.getStatus();
  logCxp09Public('CXP09_STATUS', status);
  return status;
}

function resetCxp09StableAggregationInstallationState() {
  logCxp09Public('CXP09_INSTALL', { event: 'START', mode: 'reset' });
  try {
    var result = Cxp09Setup.resetConfigured();
    logCxp09Public('CXP09_INSTALL', {
      event: 'RETURN',
      mode: 'reset',
      cleared: result.cleared,
      status: result.status,
      stateKey: result.stateKey,
    });
    return result;
  } catch (error) {
    logCxp09Public('CXP09_INSTALL', {
      event: 'ERROR',
      mode: 'reset',
      message: error && error.message ? String(error.message) : String(error),
    });
    throw error;
  }
}

/**
 * CXP-09 runbook install/inspect diagnostic for a target workbook.
 * Pass a spreadsheet ID string, or omit to use the configured target.
 */
function diagnoseCxp09RunbookChecks(spreadsheetId) {
  var CatalogRef = typeof StableAggregationFormulaCatalog !== 'undefined'
    ? StableAggregationFormulaCatalog
    : null;
  if (!CatalogRef) {
    throw new Error('StableAggregationFormulaCatalog is required.');
  }
  var id = spreadsheetId;
  if (!id || typeof id !== 'string') {
    id = Config.load().targetSpreadsheetId;
  }
  var ss = SpreadsheetApp.openById(id);
  var report = {
    spreadsheetId: id,
    title: ss.getName(),
    status: null,
    aggregation: {},
  };
  try {
    report.status = Cxp09Setup.getStatus();
  } catch (statusError) {
    report.statusError = statusError && statusError.message
      ? statusError.message
      : String(statusError);
  }

  CatalogRef.list().forEach(function (spec) {
    var sheet = ss.getSheetByName(spec.aggregationSheetName);
    if (!sheet) {
      report.aggregation[spec.aggregationSheetName] = { present: false };
      return;
    }
    var headers = sheet.getRange(1, 1, 1, spec.headers.length).getDisplayValues()[0];
    var headerDiffs = [];
    var index;
    for (index = 0; index < spec.headers.length; index += 1) {
      if (headers[index] !== spec.headers[index]) {
        headerDiffs.push({
          col: index + 1,
          actual: headers[index],
          expected: spec.headers[index],
        });
      }
    }
    var formulaAnchors = [];
    var formulaMissing = [];
    spec.formulaAnchors.forEach(function (column) {
      var formula = sheet.getRange(2, column).getFormula();
      var colLetter = column <= 26
        ? String.fromCharCode(64 + column)
        : 'A' + String.fromCharCode(64 + column - 26);
      if (formula) {
        formulaAnchors.push(colLetter + '2');
        if (formula.indexOf('GETPIVOTDATA') >= 0) {
          report.aggregation[spec.aggregationSheetName] = report.aggregation[spec.aggregationSheetName] || {};
          report.aggregation[spec.aggregationSheetName].getPivotDataDetected = true;
        }
      } else {
        formulaMissing.push(colLetter + '2');
      }
    });
    report.aggregation[spec.aggregationSheetName] = Object.assign(
      report.aggregation[spec.aggregationSheetName] || {},
      {
        present: true,
        headerCount: headers.length,
        headerCountOk: headerDiffs.length === 0,
        headerDiffs: headerDiffs,
        formulaAnchorsPresent: formulaAnchors,
        formulaAnchorsMissing: formulaMissing,
        formulaAnchorCountOk: formulaMissing.length === 0,
        measureColumnCount: spec.headers.length,
        lastRow: sheet.getLastRow(),
      },
    );
  });

  if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
    Logger.log(JSON.stringify(report));
  }
  return report;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp09Setup;
}
