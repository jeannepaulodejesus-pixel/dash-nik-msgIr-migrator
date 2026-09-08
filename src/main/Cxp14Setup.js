/** Versioned, resumable, non-destructive CXP-14 release-readiness setup. */
var Cxp14Setup = (function () {
  'use strict';

  var STATE_KEY = 'CXP14_RELEASE_SETUP_STATE_V1';
  var STATE_VERSION = 1;
  var CONTINUATION_HANDLER = 'continueCxp14ReleaseReadinessSetup';
  var CONTINUATION_DELAY_MS = 1000;
  var STATES = Object.freeze({ IDLE: 'IDLE', RUNNING: 'RUNNING', COMPLETE: 'COMPLETE', FAILED: 'FAILED' });
  var STEPS = Object.freeze([
    'VERIFY_RELEASE_CONTRACT',
    'VERIFY_EVIDENCE_STORE',
    'VERIFY_PREDECESSOR_SURFACES',
    'VERIFY_BOUNDARY_CONTRACT',
  ]);
  var STATE_FIELDS = Object.freeze([
    'completedAtUtc', 'errorCode', 'nextStep', 'startedAtUtc', 'status',
    'stepCount', 'updatedAtUtc', 'version',
  ]);

  function failure(code, message) { var result = new Error(message); result.code = code; return result; }
  function resolve(name, path) {
    if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name];
    if (typeof require === 'function') return require(path);
    throw failure('CXP14_SETUP_DEPENDENCY_MISSING', 'A required CXP-14 setup dependency is unavailable.');
  }
  function resolveProperties(value) {
    if (value && typeof value.getProperty === 'function' && typeof value.setProperty === 'function') return value;
    if (typeof PropertiesService !== 'undefined') return PropertiesService.getScriptProperties();
    throw failure('CXP14_SETUP_DEPENDENCY_MISSING', 'Script Properties are required for CXP-14 setup.');
  }
  function ports(overrides) {
    var supplied = overrides || {};
    return {
      clock: supplied.clock || { now: function () { return new Date(); } },
      maxStepsPerInvocation: Number.isInteger(supplied.maxStepsPerInvocation) && supplied.maxStepsPerInvocation > 0 ? supplied.maxStepsPerInvocation : STEPS.length,
      properties: resolveProperties(supplied.properties),
      scriptApp: supplied.scriptApp || (typeof ScriptApp !== 'undefined' ? ScriptApp : null),
      stepRunner: supplied.stepRunner || defaultStepRunner,
    };
  }
  function utc(runtime) {
    var value = runtime.clock.now(); var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw failure('CXP14_SETUP_CLOCK_INVALID', 'The CXP-14 setup clock is invalid.');
    return date.toISOString();
  }
  function validUtc(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)); }
  function validState(state) {
    if (!state || Object.keys(state).sort().join('|') !== STATE_FIELDS.slice().sort().join('|')) return false;
    if (!state || state.version !== STATE_VERSION || Object.keys(STATES).map(function (key) { return STATES[key]; }).indexOf(state.status) === -1) return false;
    if (!Number.isInteger(state.nextStep) || state.nextStep < 0 || state.nextStep > STEPS.length || state.stepCount !== STEPS.length) return false;
    if (!validUtc(state.startedAtUtc) || !validUtc(state.updatedAtUtc)) return false;
    if (state.completedAtUtc !== null && !validUtc(state.completedAtUtc)) return false;
    if (state.errorCode !== null && (typeof state.errorCode !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(state.errorCode))) return false;
    if (state.status === STATES.COMPLETE && (state.nextStep !== STEPS.length || !state.completedAtUtc)) return false;
    if (state.status === STATES.RUNNING && (state.completedAtUtc !== null || state.errorCode !== null)) return false;
    if (state.status === STATES.FAILED && !state.errorCode) return false;
    return true;
  }
  function load(properties) {
    var raw = properties.getProperty(STATE_KEY); if (!raw) return null;
    var state; try { state = JSON.parse(raw); } catch (_error) { throw failure('CXP14_SETUP_STATE_INVALID', 'The persisted CXP-14 setup state is malformed.'); }
    if (!validState(state)) throw failure('CXP14_SETUP_STATE_INVALID', 'The persisted CXP-14 setup state is unsupported or malformed.');
    return state;
  }
  function save(properties, state) { properties.setProperty(STATE_KEY, JSON.stringify(state)); }
  function removeTriggers(scriptApp) {
    if (!scriptApp || typeof scriptApp.getProjectTriggers !== 'function' || typeof scriptApp.deleteTrigger !== 'function') return;
    scriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger && typeof trigger.getHandlerFunction === 'function' && trigger.getHandlerFunction() === CONTINUATION_HANDLER) scriptApp.deleteTrigger(trigger);
    });
  }
  function replaceSuccessor(scriptApp) {
    if (!scriptApp || typeof scriptApp.newTrigger !== 'function') return false;
    var successor = scriptApp.newTrigger(CONTINUATION_HANDLER).timeBased().after(CONTINUATION_DELAY_MS).create();
    if (typeof scriptApp.getProjectTriggers === 'function' && typeof scriptApp.deleteTrigger === 'function') {
      scriptApp.getProjectTriggers().forEach(function (trigger) {
        if (trigger !== successor && trigger && typeof trigger.getHandlerFunction === 'function' && trigger.getHandlerFunction() === CONTINUATION_HANDLER) scriptApp.deleteTrigger(trigger);
      });
    }
    return true;
  }
  function publicState(state, continuationScheduled) {
    if (!state) return Object.freeze({ completedAtUtc: null, continuationScheduled: false, errorCode: null, nextStep: 0, startedAtUtc: null, status: STATES.IDLE, stepCount: STEPS.length, updatedAtUtc: null, version: STATE_VERSION });
    return Object.freeze({
      completedAtUtc: state.completedAtUtc,
      continuationScheduled: continuationScheduled === true,
      errorCode: state.errorCode,
      nextStep: state.nextStep,
      startedAtUtc: state.startedAtUtc,
      status: state.status,
      stepCount: state.stepCount,
      updatedAtUtc: state.updatedAtUtc,
      version: state.version,
    });
  }
  function defaultStepRunner(step, runtime) {
    var evidence = resolve('Cxp14ReleaseEvidence', '../release/Cxp14ReleaseEvidence.js');
    if (step === 'VERIFY_RELEASE_CONTRACT') {
      if (evidence.CONTRACT_VERSION !== 1) throw failure('CXP14_RELEASE_CONTRACT_INVALID', 'The CXP-14 release contract is unavailable.');
      return;
    }
    if (step === 'VERIFY_EVIDENCE_STORE') {
      var raw = runtime.properties.getProperty('CXP14_UAT_EVIDENCE_V1');
      if (raw) { var parsed; try { parsed = JSON.parse(raw); } catch (_error) { throw failure('CXP14_UAT_EVIDENCE_INVALID', 'Persisted CXP-14 UAT evidence is malformed.'); } evidence.validateUatPatch(parsed); }
      return;
    }
    if (step === 'VERIFY_PREDECESSOR_SURFACES') {
      [['Cxp11Setup','./Cxp11Setup.js'],['Cxp12Setup','./Cxp12Setup.js'],['Cxp13Setup','./Cxp13Setup.js']].forEach(function (item) {
        var dependency = resolve(item[0], item[1]);
        if (!dependency || typeof dependency.getStatus !== 'function') throw failure('CXP14_PREDECESSOR_UNAVAILABLE', 'A predecessor setup surface is unavailable.');
      });
      return;
    }
    if (step === 'VERIFY_BOUNDARY_CONTRACT') {
      if (evidence.BOUNDARIES.invocationBudgetMs !== 270000 || evidence.BOUNDARIES.minimumNextStepReserveMs !== 60000 || evidence.BOUNDARIES.handoffMarginMs !== 15000) throw failure('CXP14_BOUNDARY_CONTRACT_INVALID', 'The CXP-14 execution boundary contract is invalid.');
      return;
    }
    throw failure('CXP14_SETUP_CURSOR_INVALID', 'The CXP-14 setup cursor is invalid.');
  }
  function execute(overrides, initialize) {
    var runtime = ports(overrides); var state = load(runtime.properties);
    if (!state) {
      if (!initialize) return publicState(null, false);
      var started = utc(runtime); state = { completedAtUtc: null, errorCode: null, nextStep: 0, startedAtUtc: started, status: STATES.RUNNING, stepCount: STEPS.length, updatedAtUtc: started, version: STATE_VERSION }; save(runtime.properties, state);
    }
    if (state.status === STATES.COMPLETE) { removeTriggers(runtime.scriptApp); return publicState(state, false); }
    if (state.status === STATES.FAILED) { state.status = STATES.RUNNING; state.errorCode = null; state.updatedAtUtc = utc(runtime); save(runtime.properties, state); }
    var completed = 0;
    try {
      while (state.nextStep < STEPS.length && completed < runtime.maxStepsPerInvocation) {
        runtime.stepRunner(STEPS[state.nextStep], runtime);
        state.nextStep += 1; completed += 1; state.updatedAtUtc = utc(runtime); save(runtime.properties, state);
      }
    } catch (error) {
      state.status = STATES.FAILED;
      state.errorCode = error && typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'CXP14_SETUP_STEP_FAILED';
      state.updatedAtUtc = utc(runtime); save(runtime.properties, state); removeTriggers(runtime.scriptApp); throw error;
    }
    if (state.nextStep === STEPS.length) {
      state.status = STATES.COMPLETE; state.completedAtUtc = utc(runtime); state.updatedAtUtc = state.completedAtUtc; save(runtime.properties, state); removeTriggers(runtime.scriptApp); return publicState(state, false);
    }
    state.status = STATES.RUNNING; state.updatedAtUtc = utc(runtime); save(runtime.properties, state);
    return publicState(state, replaceSuccessor(runtime.scriptApp));
  }
  function initialize(overrides) { return execute(overrides, true); }
  function continueSetup(overrides) { return execute(overrides, false); }
  function getStatus(overrides) { var runtime = ports(overrides); return publicState(load(runtime.properties), false); }
  function reset(overrides) {
    var runtime = ports(overrides); var state = load(runtime.properties);
    if (state && state.status === STATES.RUNNING) throw failure('CXP14_SETUP_RESET_REFUSED', 'Refusing to reset CXP-14 setup while RUNNING.');
    removeTriggers(runtime.scriptApp);
    if (typeof runtime.properties.deleteProperty === 'function') runtime.properties.deleteProperty(STATE_KEY); else runtime.properties.setProperty(STATE_KEY, '');
    return publicState(null, false);
  }
  function diagnose(overrides) {
    var runtime = ports(overrides); var evidence = resolve('Cxp14ReleaseEvidence', '../release/Cxp14ReleaseEvidence.js'); var state = getStatus(runtime);
    return Object.freeze({ boundaryContractValid: evidence.BOUNDARIES.invocationBudgetMs === 270000 && evidence.BOUNDARIES.minimumNextStepReserveMs === 60000 && evidence.BOUNDARIES.handoffMarginMs === 15000, contractVersion: evidence.CONTRACT_VERSION, setup: state });
  }
  return Object.freeze({ CONTINUATION_HANDLER: CONTINUATION_HANDLER, STATE_KEY: STATE_KEY, STATES: STATES, STEPS: STEPS, continueSetup: continueSetup, diagnose: diagnose, getStatus: getStatus, initialize: initialize, reset: reset });
})();

function initializeCxp14ReleaseReadiness() { return Cxp14Setup.initialize(); }
function continueCxp14ReleaseReadinessSetup() { return Cxp14Setup.continueSetup(); }
function getCxp14ReleaseReadinessSetupStatus() { return Cxp14Setup.getStatus(); }
function resetCxp14ReleaseReadinessSetupState() { return Cxp14Setup.reset(); }
function diagnoseCxp14RunbookChecks() { return Cxp14Setup.diagnose(); }
if (typeof module !== 'undefined' && module.exports) module.exports = Cxp14Setup;
