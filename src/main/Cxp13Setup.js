var Cxp13Setup = (function () {
  'use strict';
  var STATE_KEY = 'CXP13_INTAKE_SETUP_STATE_V1';
  var STATES = Object.freeze({ IDLE: 'IDLE', RUNNING: 'RUNNING', COMPLETE: 'COMPLETE', FAILED: 'FAILED' });
  var STEPS = Object.freeze(['VERIFY_CONFIGURATION','VERIFY_INBOX_ACCESS','VERIFY_ACTIVE_TARGET','VERIFY_WEB_RUNTIME']);
  function resolve(name, path) { if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name]; return require(path); }
  function properties(value) { return value || (typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null); }
  function load(props) { var raw = props.getProperty(STATE_KEY); if (!raw) return null; try { return JSON.parse(raw); } catch (_error) { return null; } }
  function save(props, state) { props.setProperty(STATE_KEY, JSON.stringify(state)); }
  function status(props) {
    var state = load(properties(props));
    return Object.freeze(state ? { errorCode: state.errorCode || null, nextStep: state.nextStep, status: state.status, stepCount: STEPS.length, version: 1 } : { errorCode: null, nextStep: 0, status: STATES.IDLE, stepCount: STEPS.length, version: 1 });
  }
  function runStep(name, config, services) {
    if (name === 'VERIFY_CONFIGURATION') {
      if (!config.controlSpreadsheetId || !config.targetSpreadsheetId || !config.driveInboxFolderId || !config.rtaAllowedDomain) throw new Error('CXP-13 environment configuration is incomplete.');
      return;
    }
    if (name === 'VERIFY_INBOX_ACCESS') { resolve('InboxBundleRepository', '../repository/InboxBundleRepository.js').create(services.driveApp, config.driveInboxFolderId).getLatest(); return; }
    if (name === 'VERIFY_ACTIVE_TARGET') {
      var control = services.spreadsheetApp.openById(config.controlSpreadsheetId);
      var active = resolve('WeekRegistryRepository', '../repository/WeekRegistryRepository.js').create(control).findActive();
      if (!active || active.targetSpreadsheetId !== config.targetSpreadsheetId) throw resolve('ErrorCodes', '../monitoring/ErrorCodes.js').create('LIFECYCLE_ACTIVE_TARGET_MISMATCH');
      return;
    }
    if (name === 'VERIFY_WEB_RUNTIME' && (!services.htmlService || !services.session || !services.scriptApp)) throw new Error('CXP-13 web runtime is unavailable.');
  }
  function initialize(overrides) {
    var services = overrides || {};
    services.properties = properties(services.properties);
    services.driveApp = services.driveApp || (typeof DriveApp !== 'undefined' ? DriveApp : null);
    services.spreadsheetApp = services.spreadsheetApp || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp : null);
    services.htmlService = services.htmlService || (typeof HtmlService !== 'undefined' ? HtmlService : null);
    services.session = services.session || (typeof Session !== 'undefined' ? Session : null);
    services.scriptApp = services.scriptApp || (typeof ScriptApp !== 'undefined' ? ScriptApp : null);
    var config = resolve('Config', '../config/Config.js').load(services.properties);
    var state = { errorCode: null, nextStep: 0, status: STATES.RUNNING, version: 1 }; save(services.properties, state);
    for (var i = 0; i < STEPS.length; i += 1) {
      try { runStep(STEPS[i], config, services); state.nextStep = i + 1; save(services.properties, state); }
      catch (error) { state.status = STATES.FAILED; state.errorCode = error.code || 'INGESTION_OPERATION_FAILED'; save(services.properties, state); throw error; }
    }
    state.status = STATES.COMPLETE; save(services.properties, state); return status(services.properties);
  }
  function reset(props) {
    var resolved = properties(props); var current = status(resolved);
    if (current.status === STATES.RUNNING) throw new Error('Refusing to reset CXP-13 setup while RUNNING.');
    resolved.deleteProperty(STATE_KEY); return status(resolved);
  }
  return Object.freeze({ STATE_KEY: STATE_KEY, STATES: STATES, STEPS: STEPS, getStatus: status, initialize: initialize, reset: reset });
})();

function initializeCxp13Intake() { return Cxp13Setup.initialize(); }
function getCxp13IntakeSetupStatus() { return Cxp13Setup.getStatus(); }
function resetCxp13IntakeSetupState() { return Cxp13Setup.reset(); }
if (typeof module !== 'undefined' && module.exports) module.exports = Cxp13Setup;
