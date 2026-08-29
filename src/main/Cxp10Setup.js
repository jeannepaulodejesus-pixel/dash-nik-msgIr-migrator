var Cxp10Setup = (function () {
  'use strict';

  var CONTINUATION_HANDLER = 'continueCxp10ReportingSurfaces';
  var CONTINUATION_DELAY_MS = 1000;
  var DEFAULT_MAX_RUNTIME_MS = 240000;
  var WATCHDOG_DELAY_MS = 420000;
  var STATE_KEY = 'CXP10_REPORTING_INSTALL_STATE';
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
    if (typeof ReportingSurfaceTransformationService !== 'undefined') {
      return ReportingSurfaceTransformationService;
    }
    return require('../services/ReportingSurfaceTransformationService.js');
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
    throw new Error('Script Properties are required for CXP-10 initialization.');
  }

  function now(dependencies) {
    var value = dependencies.clock && typeof dependencies.clock.now === 'function'
      ? dependencies.clock.now()
      : new Date();
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error('The CXP-10 runtime clock returned an invalid value.');
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
      throw new Error('The persisted CXP-10 installation state is invalid.');
    }
    if (!state || state.version !== STATE_VERSION) {
      throw new Error('The persisted CXP-10 installation state is unsupported.');
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
      throw new Error('ScriptApp trigger management is required for CXP-10 continuation.');
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
      throw new Error('LockService is required for CXP-10 continuation.');
    }
    var lock = dependencies.lockService.getScriptLock();
    if (
      !lock ||
      typeof lock.tryLock !== 'function' ||
      typeof lock.releaseLock !== 'function' ||
      !lock.tryLock(5000)
    ) {
      throw new Error('Another CXP-10 installation step is already running.');
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
        'The active CXP-10 installation targets a different environment or spreadsheet. ' +
          'activeTarget=' + (state.targetSpreadsheetId || 'null') +
          ' configuredTarget=' + targetId +
          ' activeEnv=' + (state.environment || 'null') +
          ' configuredEnv=' + configuration.environment +
          '. If no install is RUNNING, delete Script Property ' + STATE_KEY +
          ' or run resetCxp07ReportingSurfaceInstallationState().',
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
      throw new Error('The CXP-10 transformation service is not resumable.');
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
      emitLog('CXP10_INSTALL', {
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
          emitLog('CXP10_STEP', {
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
            emitLog('CXP10_INSTALL', {
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
        state.lastError = error && error.message ? String(error.message) : 'CXP-10 step failed.';
        state.updatedAtUtc = now(dependencies).toISOString();
        saveState(properties, state);
        emitLog('CXP10_INSTALL', {
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
        emitLog('CXP10_INSTALL', {
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
      emitLog('CXP10_INSTALL', {
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
        ) + ' is required for CXP-10 initialization.',
      );
    }
    var dependencies = resolveServices(services);
    if (
      !dependencies.spreadsheetApp ||
      typeof dependencies.spreadsheetApp.openById !== 'function'
    ) {
      throw new Error(
        'A SpreadsheetApp adapter with openById is required for CXP-10 initialization.',
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
      throw new Error('The configured CXP-10 target spreadsheet ID is required.');
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

function logCxp10Public(tag, payload) {
  if (typeof Cxp10Setup !== 'undefined' && typeof Cxp10Setup.emitLog === 'function') {
    Cxp10Setup.emitLog(tag, payload);
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

function initializeCxp10ReportingSurfaces() {
  logCxp10Public('CXP10_INSTALL', { event: 'START', mode: 'initialize' });
  try {
    var result = Cxp10Setup.initializeConfigured();
    logCxp10Public('CXP10_INSTALL', {
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
    logCxp10Public('CXP10_INSTALL', {
      event: 'ERROR',
      mode: 'initialize',
      message: error && error.message ? String(error.message) : String(error),
    });
    throw error;
  }
}

function continueCxp10ReportingSurfaces() {
  logCxp10Public('CXP10_INSTALL', { event: 'START', mode: 'continue' });
  try {
    var result = Cxp10Setup.continueConfigured();
    logCxp10Public('CXP10_INSTALL', {
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
    logCxp10Public('CXP10_INSTALL', {
      event: 'ERROR',
      mode: 'continue',
      message: error && error.message ? String(error.message) : String(error),
    });
    throw error;
  }
}

function getCxp10ReportingSurfaceStatus() {
  var status = Cxp10Setup.getStatus();
  logCxp10Public('CXP10_STATUS', status);
  return status;
}

function resetCxp10ReportingInstallationState() {
  logCxp10Public('CXP10_INSTALL', { event: 'START', mode: 'reset' });
  try {
    var result = Cxp10Setup.resetConfigured();
    logCxp10Public('CXP10_INSTALL', {
      event: 'RETURN',
      mode: 'reset',
      cleared: result.cleared,
      status: result.status,
      stateKey: result.stateKey,
    });
    return result;
  } catch (error) {
    logCxp10Public('CXP10_INSTALL', {
      event: 'ERROR',
      mode: 'reset',
      message: error && error.message ? String(error.message) : String(error),
    });
    throw error;
  }
}

/**
 * CXP-10 runbook install/inspect diagnostic for a target workbook.
 * Pass a spreadsheet ID string, or omit to use the configured target.
 */
function diagnoseCxp10RunbookChecks(spreadsheetId) {
  var CatalogRef = typeof ReportingSurfaceFormulaCatalog !== 'undefined'
    ? ReportingSurfaceFormulaCatalog
    : null;
  if (!CatalogRef) {
    throw new Error('ReportingSurfaceFormulaCatalog is required.');
  }
  var id = spreadsheetId;
  if (!id || typeof id !== 'string') {
    id = Config.load().targetSpreadsheetId;
  }
  var ss = SpreadsheetApp.openById(id);
  var intervalSpec = CatalogRef.intervalViewSpec();
  var momSpec = CatalogRef.momSpec();
  var bridgeSpec = CatalogRef.forecastBridgeSpec();
  var report = {
    spreadsheetId: id,
    title: ss.getName(),
    status: null,
    intervalView: {},
    mom: {},
    forecastBridge: {},
  };
  try {
    report.status = Cxp10Setup.getStatus();
  } catch (statusError) {
    report.statusError = statusError && statusError.message
      ? statusError.message
      : String(statusError);
  }

  var intervalSheet = ss.getSheetByName(intervalSpec.reportSheetName);
  if (!intervalSheet) {
    report.intervalView.present = false;
  } else {
    var pstHeader = String(
      intervalSheet.getRange(intervalSpec.headerRow, 1).getDisplayValue() || '',
    ).trim();
    var metricHeaders = intervalSheet.getRange(
      intervalSpec.headerRow,
      intervalSpec.headerStartColumn,
      1,
      intervalSpec.headers.length,
    ).getDisplayValues()[0];
    var headerDiffs = [];
    var headerIndex;
    for (headerIndex = 0; headerIndex < intervalSpec.headers.length; headerIndex += 1) {
      if (metricHeaders[headerIndex] !== intervalSpec.headers[headerIndex]) {
        headerDiffs.push({
          actual: metricHeaders[headerIndex],
          expected: intervalSpec.headers[headerIndex],
        });
      }
    }
    var metricAnchorsMissing = [];
    intervalSpec.metricFormulas.forEach(function (entry) {
      if (!intervalSheet.getRange(intervalSpec.firstDataRow, entry.anchorColumn).getFormula()) {
        metricAnchorsMissing.push(entry.anchorColumn);
      }
    });
    var axisFormula = intervalSheet.getRange(
      intervalSpec.firstDataRow,
      1,
    ).getFormula() || '';
    var legacyPivotDetected = false;
    intervalSpec.metricFormulas.forEach(function (entry) {
      var formula = intervalSheet.getRange(intervalSpec.firstDataRow, entry.anchorColumn).getFormula();
      if (formula && formula.indexOf('GETPIVOTDATA') >= 0) {
        legacyPivotDetected = true;
      }
      if (formula && (formula.indexOf('_CALC_') >= 0 || formula.indexOf('_RAW_') >= 0)) {
        legacyPivotDetected = true;
      }
    });
    report.intervalView = {
      headerCountOk: headerDiffs.length === 0,
      headerDiffs: headerDiffs,
      legacyBackendReferenceDetected: legacyPivotDetected,
      metricAnchorCountOk: metricAnchorsMissing.length === 0,
      metricAnchorsMissing: metricAnchorsMissing,
      metricCount: intervalSpec.headers.length,
      present: true,
      pstHeaderOk: pstHeader === intervalSpec.pstHeader,
      timeAxisFormulaOk: axisFormula.indexOf('SEQUENCE') >= 0,
      viewDateAnchorColumn: intervalSpec.businessDayAnchor.column,
    };
  }

  var momSheet = ss.getSheetByName(momSpec.reportSheetName);
  if (!momSheet) {
    report.mom.present = false;
  } else {
    var titleMnl = String(momSheet.getRange(1, 1).getDisplayValue() || '').trim();
    var sectionRequired = String(momSheet.getRange(2, 1).getDisplayValue() || '').trim();
    var timeAxisFormula = momSheet.getRange(momSpec.firstTimeRow, 1).getFormula() || '';
    report.mom = {
      present: true,
      titleMnlOk: titleMnl === momSpec.titleMnl,
      sectionLabelOk: sectionRequired === 'Required FTE at Plan',
      timeAxisFormulaOk: timeAxisFormula.indexOf('SEQUENCE') >= 0,
      weekStartAnchorColumn: momSpec.weekStartAnchor.column,
      weekDateFormulaCount: momSpec.weekDateFormulas.length,
      dayNameFormulaCount: momSpec.dayNameFormulas.length,
    };
  }

  var forecastSheet = ss.getSheetByName(bridgeSpec.aggregationSheetName);
  if (!forecastSheet) {
    report.forecastBridge.present = false;
  } else {
    var bridgeFormula = forecastSheet.getRange(
      bridgeSpec.formulaAnchor.row,
      bridgeSpec.formulaAnchor.column,
    ).getFormula();
    report.forecastBridge = {
      bridgeFormulaPresent: Boolean(bridgeFormula),
      momReferenceDetected: bridgeFormula ? bridgeFormula.indexOf('MOM!') >= 0 : false,
      present: true,
    };
  }

  if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
    Logger.log(JSON.stringify(report));
  }
  return report;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp10Setup;
}
