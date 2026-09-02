var Cxp13Uat = (function () {
  'use strict';
  var EVIDENCE_KEY = 'CXP13_UAT_EVIDENCE_V1';
  function resolve(name, path) { if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name]; return require(path); }
  function services(overrides) { return resolve('Cxp13Runtime', '../ingestion/Cxp13Runtime.js').hostedServices(overrides); }
  function read(props) { var raw = props.getProperty(EVIDENCE_KEY); if (!raw) return {}; try { return JSON.parse(raw); } catch (_error) { return {}; } }
  function mark(props, key, value) { var evidence = read(props); evidence[key] = value; props.setProperty(EVIDENCE_KEY, JSON.stringify(evidence)); return evidence; }
  function output(step, pass, details) {
    var result = Object.freeze(Object.assign({ pass: pass === true, step: step }, details || {}));
    if (typeof console !== 'undefined' && console.log) console.log('CXP13_UAT ' + step + ' ' + JSON.stringify(result));
    return result;
  }
  function step00(overrides) {
    var runtime = services(overrides); var config = resolve('Config', '../config/Config.js').load(runtime.properties);
    var cxp12 = resolve('Cxp12Setup', './Cxp12Setup.js').getStatus(runtime.properties);
    var activeTargetAligned = false;
    if (config.controlSpreadsheetId && config.targetSpreadsheetId && runtime.spreadsheetApp) {
      try {
        var control = runtime.spreadsheetApp.openById(config.controlSpreadsheetId);
        var active = resolve('WeekRegistryRepository', '../repository/WeekRegistryRepository.js').create(control).findActive();
        activeTargetAligned = Boolean(active && active.targetSpreadsheetId === config.targetSpreadsheetId);
      } catch (_error) {
        activeTargetAligned = false;
      }
    }
    var pass = config.environment !== 'PROD' && Boolean(config.controlSpreadsheetId && config.targetSpreadsheetId && config.driveInboxFolderId && config.rtaAllowedDomain) && cxp12.status === 'COMPLETE' && activeTargetAligned;
    mark(runtime.properties, 'prerequisites', pass); return output('CXP13UatStep00VerifyPrerequisites', pass, { activeTargetAligned: activeTargetAligned, environment: config.environment, cxp12Complete: cxp12.status === 'COMPLETE' });
  }
  function step01(overrides) { var runtime = services(overrides); var state = resolve('Cxp13Setup', './Cxp13Setup.js').initialize(runtime); var pass = state.status === 'COMPLETE' && state.nextStep === state.stepCount; mark(runtime.properties, 'setup', pass); return output('CXP13UatStep01InstallIntake', pass, { setupStatus: state.status, stepCount: state.stepCount }); }
  function step02(overrides) { var runtime = services(overrides); var status = resolve('RtaIntakeService', '../services/RtaIntakeService.js').getIntakeStatus(runtime); var pass = status && ['IDLE','READY','SUCCESS','DUPLICATE','VALIDATION_FAILED','PROCESSING_ERROR'].indexOf(status.status) !== -1; mark(runtime.properties, 'webStatus', pass); return output('CXP13UatStep02WebStatus', pass, { status: status.status }); }
  function step03(overrides) { var runtime = services(overrides); var status = resolve('RtaIntakeService', '../services/RtaIntakeService.js').getIntakeStatus(runtime); var pass = status.status === 'READY' && Boolean(status.batchToken) && status.datasetNames.length === 5; mark(runtime.properties, 'discovery', pass); return output('CXP13UatStep03DiscoverLatestBundle', pass, { batchToken: status.batchToken, packagingKind: status.packagingKind }); }
  function step04(overrides) { var runtime = services(overrides); var intake = resolve('RtaIntakeService', '../services/RtaIntakeService.js'); var status = intake.getIntakeStatus(runtime); var started = intake.startLatest(status.batchToken, runtime); var pass = started.status === 'QUEUED' && started.continuationScheduled; mark(runtime.properties, 'start', pass); return output('CXP13UatStep04StartIngestion', pass, { runId: started.runId, status: started.status }); }
  function step05(overrides) { var runtime = services(overrides); var status = resolve('RtaIntakeService', '../services/RtaIntakeService.js').getRunStatus(null, runtime); var pass = status.status === 'SUCCESS' && Boolean(status.activeDataAtUtc) && status.health.healthy; mark(runtime.properties, 'success', pass); return output('CXP13UatStep05ReconcileSuccess', pass, { activeWeekKey: status.activeWeekKey, status: status.status }); }
  function step06(overrides) { var runtime = services(overrides); var intake = resolve('RtaIntakeService', '../services/RtaIntakeService.js'); var status = intake.getIntakeStatus(runtime); var started = intake.startLatest(status.batchToken, runtime); var pass = started.status === 'QUEUED'; mark(runtime.properties, 'duplicateQueued', pass); return output('CXP13UatStep06QueueDuplicate', pass, { status: started.status }); }
  function recordNegative(overrides, evidence) {
    var runtime = services(overrides); var supplied = evidence || {};
    ['duplicate','invalid','concurrency','rollbackPreserved','multiInvocation'].forEach(function (key) { mark(runtime.properties, key, supplied[key] === true); });
    mark(runtime.properties, 'maxInvocationMs', Number(supplied.maxInvocationMs));
    return output('recordCxp13UatNegativeEvidence', true, { recorded: true });
  }
  function step07(overrides) {
    var runtime = services(overrides); var evidence = read(runtime.properties);
    var pass = evidence.duplicate === true && evidence.invalid === true && evidence.concurrency === true && evidence.rollbackPreserved === true && evidence.multiInvocation === true && Number.isFinite(evidence.maxInvocationMs) && evidence.maxInvocationMs < 270000;
    mark(runtime.properties, 'negativeAndTiming', pass); return output('CXP13UatStep07VerifyNegativeAndTiming', pass, { maxInvocationMs: evidence.maxInvocationMs || null });
  }
  function step08(overrides) {
    var runtime = services(overrides); var evidence = read(runtime.properties);
    var required = ['prerequisites','setup','webStatus','discovery','start','success','duplicateQueued','negativeAndTiming'];
    var missing = required.filter(function (key) { return evidence[key] !== true; });
    return output('CXP13UatStep08PromotionGate', missing.length === 0, { missing: Object.freeze(missing), promotionReady: missing.length === 0 });
  }
  return Object.freeze({ EVIDENCE_KEY: EVIDENCE_KEY, recordNegative: recordNegative, step00: step00, step01: step01, step02: step02, step03: step03, step04: step04, step05: step05, step06: step06, step07: step07, step08: step08 });
})();

function CXP13UatStep00VerifyPrerequisites() { return Cxp13Uat.step00(); }
function CXP13UatStep01InstallIntake() { return Cxp13Uat.step01(); }
function CXP13UatStep02WebStatus() { return Cxp13Uat.step02(); }
function CXP13UatStep03DiscoverLatestBundle() { return Cxp13Uat.step03(); }
function CXP13UatStep04StartIngestion() { return Cxp13Uat.step04(); }
function CXP13UatStep05ReconcileSuccess() { return Cxp13Uat.step05(); }
function CXP13UatStep06QueueDuplicate() { return Cxp13Uat.step06(); }
function CXP13UatStep07VerifyNegativeAndTiming() { return Cxp13Uat.step07(); }
function CXP13UatStep08PromotionGate() { return Cxp13Uat.step08(); }
function recordCxp13UatNegativeEvidence(evidence) { return Cxp13Uat.recordNegative(null, evidence); }
if (typeof module !== 'undefined' && module.exports) module.exports = Cxp13Uat;
