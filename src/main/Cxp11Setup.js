/**
 * CXP-11 parity-validation setup state machine.
 *
 * Installs the final PARITY_RESULTS / SOURCE_ERROR_BASELINE contracts on the
 * configured control workbook behind a script lock, a checkpointed cursor, and
 * a single time-trigger continuation. Setup states are IDLE, RUNNING, COMPLETE,
 * and FAILED; the active parity run keeps its own separate state machine.
 */
var Cxp11Setup = (function () {
  'use strict';

  var CONTINUATION_HANDLER = 'continueCxp11ParityValidationSetup';
  var CONTINUATION_DELAY_MS = 1000;
  var WATCHDOG_DELAY_MS = 420000;
  var DEFAULT_MAX_RUNTIME_MS = 240000;
  var LOCK_TIMEOUT_MS = 5000;
  var STATE_KEY = 'CXP11_PARITY_SETUP_STATE_V1';
  var STATE_VERSION = 1;

  function resolveConfig() {
    if (typeof Config !== 'undefined') {
      return Config;
    }
    return require('../config/Config.js');
  }

  function resolveContracts() {
    if (typeof ParityContracts !== 'undefined') {
      return ParityContracts;
    }
    return require('../parity/ParityContracts.js');
  }

  function resolveInstallService(services) {
    if (services && services.installService) {
      return services.installService;
    }
    if (typeof ParityValidationInstallService !== 'undefined') {
      return ParityValidationInstallService;
    }
    return require('../services/ParityValidationInstallService.js');
  }

  function resolveServices(services) {
    if (services) {
      return services;
    }
    return {
      clock: { now: function () { return new Date(); } },
      lockService: LockService,
      scriptApp: ScriptApp,
      session: typeof Session !== 'undefined' ? Session : null,
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
    throw new Error('Script Properties are required for CXP-11 initialization.');
  }

  function now(dependencies) {
    var value = dependencies.clock && typeof dependencies.clock.now === 'function'
      ? dependencies.clock.now()
      : new Date();
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error('The CXP-11 runtime clock returned an invalid value.');
    }
    return date;
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

  function loadState(properties) {
    var raw = properties.getProperty(STATE_KEY);
    if (!raw) {
      return null;
    }
    var state;
    try {
      state = JSON.parse(raw);
    } catch (error) {
      throw new Error('The persisted CXP-11 setup state is invalid.');
    }
    if (!state || state.version !== STATE_VERSION) {
      throw new Error('The persisted CXP-11 setup state is unsupported.');
    }
    return state;
  }

  function saveState(properties, state) {
    properties.setProperty(STATE_KEY, JSON.stringify(state));
  }

  function clearState(properties) {
    if (typeof properties.deleteProperty === 'function') {
      properties.deleteProperty(STATE_KEY);
      return;
    }
    properties.setProperty(STATE_KEY, '');
  }

  function removeContinuationTriggers(scriptApp) {
    if (
      !scriptApp ||
      typeof scriptApp.getProjectTriggers !== 'function' ||
      typeof scriptApp.deleteTrigger !== 'function'
    ) {
      throw new Error('ScriptApp trigger management is required for CXP-11 continuation.');
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
    return scriptApp.newTrigger(CONTINUATION_HANDLER).timeBased().after(delayMs).create();
  }

  function requireLock(dependencies) {
    if (
      !dependencies.lockService ||
      typeof dependencies.lockService.getScriptLock !== 'function'
    ) {
      throw new Error('LockService is required for CXP-11 setup.');
    }
    var lock = dependencies.lockService.getScriptLock();
    if (
      !lock ||
      typeof lock.tryLock !== 'function' ||
      typeof lock.releaseLock !== 'function' ||
      !lock.tryLock(LOCK_TIMEOUT_MS)
    ) {
      throw new Error('Another CXP-11 setup step is already running.');
    }
    return lock;
  }

  function newState(configuration, controlId, stepCount, startedAt) {
    var contracts = resolveContracts();
    return {
      baselineVersion: contracts.BASELINE_VERSION,
      completedAtUtc: null,
      controlSpreadsheetId: controlId,
      environment: configuration.environment,
      lastCompletedStep: null,
      lastError: null,
      nextStep: 0,
      startedAtUtc: startedAt.toISOString(),
      status: contracts.SETUP_STATES.running,
      stepCount: stepCount,
      updatedAtUtc: startedAt.toISOString(),
      version: STATE_VERSION,
    };
  }

  function publicResult(state, continuationScheduled) {
    return Object.freeze({
      baselineVersion: state.baselineVersion,
      continuationScheduled: continuationScheduled === true,
      controlSpreadsheetId: state.controlSpreadsheetId || null,
      environment: state.environment,
      lastCompletedStep: state.lastCompletedStep || null,
      nextStep: state.nextStep,
      status: state.status,
      stepCount: state.stepCount,
    });
  }

  function assertSameTarget(state, configuration, controlId) {
    if (
      state.environment !== configuration.environment ||
      state.controlSpreadsheetId !== controlId
    ) {
      throw new Error(
        'The active CXP-11 setup targets a different environment or control workbook. ' +
          'activeEnv=' + (state.environment || 'null') +
          ' configuredEnv=' + configuration.environment +
          '. If no setup is RUNNING, run resetCxp11ParityValidationSetupState().',
      );
    }
  }

  function resolveControlId(configuration) {
    var configModule = resolveConfig();
    var controlId = typeof configuration.controlSpreadsheetId === 'string'
      ? configuration.controlSpreadsheetId.trim()
      : '';
    if (!controlId) {
      throw new Error(
        configModule.propertyKey(
          configuration.environment,
          configModule.CONFIGURATION_KEYS.controlSpreadsheetId,
        ) + ' is required for CXP-11 initialization.',
      );
    }
    return controlId;
  }

  function runResumable(configuration, controlId, properties, dependencies, continueOnly) {
    var contracts = resolveContracts();
    var installService = resolveInstallService(dependencies);
    var stepCount = installService.getInstallStepCount();
    var lock = requireLock(dependencies);
    try {
      removeContinuationTriggers(dependencies.scriptApp);
      var state = loadState(properties);
      if (!state) {
        if (continueOnly) {
          return Object.freeze({
            baselineVersion: contracts.BASELINE_VERSION,
            continuationScheduled: false,
            controlSpreadsheetId: null,
            environment: configuration.environment,
            lastCompletedStep: null,
            nextStep: 0,
            status: contracts.SETUP_STATES.idle,
            stepCount: stepCount,
          });
        }
        state = newState(configuration, controlId, stepCount, now(dependencies));
        saveState(properties, state);
      } else if (
        state.environment !== configuration.environment ||
        state.controlSpreadsheetId !== controlId
      ) {
        // A clean reinstall may retarget after COMPLETE or FAILED; a RUNNING
        // setup must be reset deliberately by the operator.
        if (continueOnly || state.status === contracts.SETUP_STATES.running) {
          assertSameTarget(state, configuration, controlId);
        }
        state = newState(configuration, controlId, stepCount, now(dependencies));
        saveState(properties, state);
      } else if (!continueOnly && state.status === contracts.SETUP_STATES.complete) {
        state = newState(configuration, controlId, stepCount, now(dependencies));
        saveState(properties, state);
      } else if (state.status === contracts.SETUP_STATES.failed) {
        state.status = contracts.SETUP_STATES.running;
        state.lastError = null;
        state.updatedAtUtc = now(dependencies).toISOString();
        saveState(properties, state);
      }

      if (state.status === contracts.SETUP_STATES.complete) {
        return publicResult(state, false);
      }

      scheduleContinuation(dependencies.scriptApp, WATCHDOG_DELAY_MS);
      emitLog('CXP11_SETUP', {
        environment: configuration.environment,
        event: continueOnly ? 'CONTINUE' : 'INITIALIZE',
        nextStep: state.nextStep,
        status: state.status,
        stepCount: state.stepCount,
      });

      var spreadsheet = dependencies.spreadsheetApp.openById(controlId);
      var invocationStartedMs = now(dependencies).getTime();
      var maxRuntimeMs = Number.isFinite(dependencies.maxRuntimeMs)
        ? dependencies.maxRuntimeMs
        : DEFAULT_MAX_RUNTIME_MS;
      try {
        while (state.nextStep < state.stepCount) {
          var stepIndex = state.nextStep;
          var stepResult = installService.installStep(spreadsheet, stepIndex, dependencies);
          state.lastCompletedStep = stepResult.label;
          state.nextStep += 1;
          state.updatedAtUtc = now(dependencies).toISOString();
          saveState(properties, state);
          emitLog('CXP11_SETUP_STEP', {
            elapsedMs: now(dependencies).getTime() - invocationStartedMs,
            label: stepResult.label,
            nextStep: state.nextStep,
            stepCount: state.stepCount,
            stepIndex: stepIndex,
          });
          if (
            state.nextStep < state.stepCount &&
            now(dependencies).getTime() - invocationStartedMs >= maxRuntimeMs
          ) {
            emitLog('CXP11_SETUP', {
              event: 'CHECKPOINT',
              lastCompletedStep: state.lastCompletedStep,
              nextStep: state.nextStep,
              stepCount: state.stepCount,
            });
            break;
          }
        }
      } catch (error) {
        removeContinuationTriggers(dependencies.scriptApp);
        state.status = contracts.SETUP_STATES.failed;
        state.lastError = error && error.code
          ? String(error.code)
          : 'CXP11_SETUP_STEP_FAILED';
        state.updatedAtUtc = now(dependencies).toISOString();
        saveState(properties, state);
        emitLog('CXP11_SETUP', {
          event: 'FAILED',
          lastCompletedStep: state.lastCompletedStep,
          lastError: state.lastError,
          nextStep: state.nextStep,
        });
        throw error;
      }

      if (state.nextStep >= state.stepCount) {
        removeContinuationTriggers(dependencies.scriptApp);
        state.status = contracts.SETUP_STATES.complete;
        state.completedAtUtc = now(dependencies).toISOString();
        state.updatedAtUtc = state.completedAtUtc;
        saveState(properties, state);
        var completeResult = publicResult(state, false);
        emitLog('CXP11_SETUP', {
          event: 'COMPLETE',
          nextStep: completeResult.nextStep,
          status: completeResult.status,
          stepCount: completeResult.stepCount,
        });
        return completeResult;
      }

      state.status = contracts.SETUP_STATES.running;
      removeContinuationTriggers(dependencies.scriptApp);
      scheduleContinuation(dependencies.scriptApp, CONTINUATION_DELAY_MS);
      state.updatedAtUtc = now(dependencies).toISOString();
      saveState(properties, state);
      var runningResult = publicResult(state, true);
      emitLog('CXP11_SETUP', {
        continuationScheduled: true,
        event: 'RUNNING',
        nextStep: runningResult.nextStep,
        status: runningResult.status,
        stepCount: runningResult.stepCount,
      });
      return runningResult;
    } finally {
      lock.releaseLock();
    }
  }

  function loadConfiguration(properties) {
    return resolveConfig().load(properties);
  }

  function initializeConfigured(properties, services) {
    var resolvedProperties = resolveProperties(properties);
    var configuration = loadConfiguration(resolvedProperties);
    var controlId = resolveControlId(configuration);
    var dependencies = resolveServices(services);
    if (
      !dependencies.spreadsheetApp ||
      typeof dependencies.spreadsheetApp.openById !== 'function'
    ) {
      throw new Error(
        'A SpreadsheetApp adapter with openById is required for CXP-11 initialization.',
      );
    }
    return runResumable(configuration, controlId, resolvedProperties, dependencies, false);
  }

  function continueConfigured(properties, services) {
    var resolvedProperties = resolveProperties(properties);
    var configuration = loadConfiguration(resolvedProperties);
    var controlId = resolveControlId(configuration);
    return runResumable(
      configuration,
      controlId,
      resolvedProperties,
      resolveServices(services),
      true,
    );
  }

  function getStatus(properties, services) {
    var contracts = resolveContracts();
    var state = loadState(resolveProperties(properties));
    var stepCount = resolveInstallService(services).getInstallStepCount();
    if (!state) {
      return Object.freeze({
        baselineVersion: contracts.BASELINE_VERSION,
        completedAtUtc: null,
        controlSpreadsheetId: null,
        environment: null,
        lastCompletedStep: null,
        lastError: null,
        nextStep: 0,
        startedAtUtc: null,
        status: contracts.SETUP_STATES.idle,
        stepCount: stepCount,
        updatedAtUtc: null,
      });
    }
    return Object.freeze({
      baselineVersion: state.baselineVersion,
      completedAtUtc: state.completedAtUtc || null,
      controlSpreadsheetId: state.controlSpreadsheetId || null,
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

  function resetConfigured(properties, services) {
    var contracts = resolveContracts();
    var dependencies = resolveServices(services);
    var resolvedProperties = resolveProperties(properties);
    var lock = requireLock(dependencies);
    try {
      var state = loadState(resolvedProperties);
      if (state && state.status === contracts.SETUP_STATES.running) {
        // Refuse silent reset of an in-flight install; the operator must let it
        // finish or fail first so a partial schema is never treated as absent.
        if (!dependencies.force) {
          throw new Error(
            'CXP-11 setup is RUNNING. Wait for COMPLETE/FAILED or pass force to reset.',
          );
        }
      }
      removeContinuationTriggers(dependencies.scriptApp);
      clearState(resolvedProperties);
      return Object.freeze({
        cleared: true,
        stateKey: STATE_KEY,
        status: contracts.SETUP_STATES.idle,
      });
    } finally {
      lock.releaseLock();
    }
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


function logCxp11Public(tag, payload) {
  if (typeof Cxp11Setup !== 'undefined' && typeof Cxp11Setup.emitLog === 'function') {
    Cxp11Setup.emitLog(tag, payload);
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

function initializeCxp11ParityValidation() {
  logCxp11Public('CXP11_SETUP', { event: 'START', mode: 'initialize' });
  try {
    var result = Cxp11Setup.initializeConfigured();
    logCxp11Public('CXP11_SETUP', {
      continuationScheduled: result.continuationScheduled,
      event: 'RETURN',
      lastCompletedStep: result.lastCompletedStep,
      mode: 'initialize',
      nextStep: result.nextStep,
      status: result.status,
      stepCount: result.stepCount,
    });
    return result;
  } catch (error) {
    logCxp11Public('CXP11_SETUP', {
      event: 'ERROR',
      message: error && error.message ? String(error.message) : String(error),
      mode: 'initialize',
    });
    throw error;
  }
}

function continueCxp11ParityValidationSetup() {
  logCxp11Public('CXP11_SETUP', { event: 'START', mode: 'continue' });
  try {
    var result = Cxp11Setup.continueConfigured();
    logCxp11Public('CXP11_SETUP', {
      continuationScheduled: result.continuationScheduled,
      event: 'RETURN',
      lastCompletedStep: result.lastCompletedStep,
      mode: 'continue',
      nextStep: result.nextStep,
      status: result.status,
      stepCount: result.stepCount,
    });
    return result;
  } catch (error) {
    logCxp11Public('CXP11_SETUP', {
      event: 'ERROR',
      message: error && error.message ? String(error.message) : String(error),
      mode: 'continue',
    });
    throw error;
  }
}

function getCxp11ParityValidationSetupStatus() {
  var status = Cxp11Setup.getStatus();
  logCxp11Public('CXP11_SETUP_STATUS', status);
  return status;
}

function resetCxp11ParityValidationSetupState() {
  logCxp11Public('CXP11_SETUP', { event: 'START', mode: 'reset' });
  try {
    var result = Cxp11Setup.resetConfigured();
    logCxp11Public('CXP11_SETUP', {
      cleared: result.cleared,
      event: 'RETURN',
      mode: 'reset',
      stateKey: result.stateKey,
      status: result.status,
    });
    return result;
  } catch (error) {
    logCxp11Public('CXP11_SETUP', {
      event: 'ERROR',
      message: error && error.message ? String(error.message) : String(error),
      mode: 'reset',
    });
    throw error;
  }
}

/**
 * CXP-11 runbook diagnostic for the control workbook. Pass a control spreadsheet
 * ID, or omit to use the configured active-environment control workbook.
 */
function diagnoseCxp11RunbookChecks(spreadsheetId) {
  var contracts = typeof ParityContracts !== 'undefined' ? ParityContracts : null;
  var installService = typeof ParityValidationInstallService !== 'undefined'
    ? ParityValidationInstallService
    : null;
  if (!contracts || !installService) {
    throw new Error('ParityContracts and ParityValidationInstallService are required.');
  }
  var configuration = Config.load();
  var id = spreadsheetId;
  if (!id || typeof id !== 'string') {
    id = configuration.controlSpreadsheetId;
  }
  if (!id) {
    throw new Error('A control spreadsheet ID is required for the CXP-11 diagnostic.');
  }
  var spreadsheet = SpreadsheetApp.openById(id);
  var report = {
    baselineVersion: contracts.BASELINE_VERSION,
    contractVersion: contracts.CONTRACT_VERSION,
    controls: installService.inspect(spreadsheet, {
      session: typeof Session !== 'undefined' ? Session : null,
      spreadsheetApp: SpreadsheetApp,
    }),
    expectedBaselineTotal: contracts.BASELINE_TOTAL_ERRORS,
    metricCount: contracts.listMetrics().length,
    setupStatus: null,
    runStatus: null,
  };
  try {
    report.setupStatus = Cxp11Setup.getStatus();
  } catch (error) {
    report.setupStatusError = error && error.message ? String(error.message) : String(error);
  }
  try {
    report.runStatus = typeof Cxp11ParityRun !== 'undefined'
      ? Cxp11ParityRun.getStatus()
      : null;
  } catch (error) {
    report.runStatusError = error && error.message ? String(error.message) : String(error);
  }
  report.exportFolderConfigured = Boolean(configuration.legacyParityExportFolderId);
  logCxp11Public('CXP11_DIAGNOSTIC', {
    baselineTotalsOk: report.controls.sourceErrorBaseline.totalsOk === true,
    exportFolderConfigured: report.exportFolderConfigured,
    parityResultsSchemaOk: report.controls.parityResults.schemaOk === true,
    setupStatus: report.setupStatus ? report.setupStatus.status : null,
  });
  return report;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp11Setup;
}
