/** Thin, UAT-only CXP-14 release gates. Long jobs are queued, never polled here. */
var Cxp14Uat = (function () {
  'use strict';

  var EVIDENCE_KEY = 'CXP14_UAT_EVIDENCE_V1';
  var PENDING_EVIDENCE_KEY = 'CXP14_UAT_PENDING_EVIDENCE_V1';
  var GATE_KEYS = Object.freeze([
    'prerequisites', 'setup', 'criticalPaths', 'expectedPeak',
    'declaredMaximum', 'failureRecovery', 'lifecycleStatus', 'finalParity',
  ]);

  function failure(code, message) { var result = new Error(message); result.code = code; return result; }
  function resolve(name, path) {
    if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name];
    if (typeof require === 'function') return require(path);
    throw failure('CXP14_UAT_DEPENDENCY_MISSING', 'A required CXP-14 UAT dependency is unavailable.');
  }
  function resolveProperties(value) {
    if (value && typeof value.getProperty === 'function' && typeof value.setProperty === 'function') return value;
    if (typeof PropertiesService !== 'undefined') return PropertiesService.getScriptProperties();
    throw failure('CXP14_UAT_DEPENDENCY_MISSING', 'Script Properties are required for CXP-14 UAT.');
  }
  function ports(overrides) {
    var supplied = overrides || {}; var properties = resolveProperties(supplied.properties);
    var configuration = supplied.configuration || resolve('Config', '../config/Config.js').load(properties);
    var performanceRepository = supplied.performanceRepository ||
      resolve('Cxp14ExpectedPeakRepository', '../release/Cxp14ExpectedPeakRepository.js').create(properties);
    var declaredMaximumRepository = supplied.declaredMaximumRepository ||
      resolve('Cxp14ExpectedPeakRepository', '../release/Cxp14ExpectedPeakRepository.js').create(properties, {
        profile: 'DECLARED_MAXIMUM',
      });
    var orchestrator = resolve('Cxp14UatOrchestrator', './Cxp14UatOrchestrator.js');
    return {
      checks: supplied.checks || {},
      configuration: configuration,
      declaredMaximumRepository: declaredMaximumRepository,
      jobs: supplied.jobs || {},
      predecessors: supplied.predecessors || orchestrator.hostedPredecessors(),
      performanceRepository: performanceRepository,
      properties: properties,
      setup: supplied.setup || resolve('Cxp14Setup', './Cxp14Setup.js'),
    };
  }
  function bind(runtime, overrides) {
    var supplied = overrides || {};
    runtime.readEvidence = function () { return evidenceOrEmpty(runtime); };
    runtime.recordEvidence = function (patch) { recordEvidence(runtime, patch); return true; };
    runtime.clock = supplied.clock;
    runtime.maxStepsPerInvocation = supplied.maxStepsPerInvocation;
    runtime.scriptApp = supplied.scriptApp;
    runtime.stepRunner = supplied.stepRunner;
    return runtime;
  }
  function orchestrator() { return resolve('Cxp14UatOrchestrator', './Cxp14UatOrchestrator.js'); }
  function assertUat(runtime) {
    if (runtime.configuration.environment === 'PROD') throw failure('CXP14_PROD_FORBIDDEN', 'CXP-14 UAT helpers refuse PROD.');
    if (runtime.configuration.environment !== 'UAT') throw failure('CXP14_UAT_ENV_REQUIRED', 'CXP-14 hosted helpers require the UAT environment.');
  }
  function readEvidenceFrom(properties) {
    var raw = properties.getProperty(EVIDENCE_KEY);
    if (!raw) return null;
    var parsed; try { parsed = JSON.parse(raw); } catch (_error) { throw failure('CXP14_UAT_EVIDENCE_INVALID', 'Persisted CXP-14 UAT evidence is malformed.'); }
    return resolve('Cxp14ReleaseEvidence', '../release/Cxp14ReleaseEvidence.js').validateUatPatch(parsed);
  }
  function readEvidence(overrides) { var runtime = ports(overrides); assertUat(runtime); return readEvidenceFrom(runtime.properties); }
  function recordEvidence(overrides, supplied) {
    var runtime = ports(overrides); assertUat(runtime);
    var contract = resolve('Cxp14ReleaseEvidence', '../release/Cxp14ReleaseEvidence.js');
    var patch = contract.validateUatPatch(supplied);
    var patchKeys = Object.keys(patch);
    if (patchKeys.length === 0) throw failure('CXP14_UAT_EVIDENCE_INVALID', 'CXP-14 UAT evidence patches cannot be empty.');
    var current = readEvidenceFrom(runtime.properties) || {};
    var identityKeys = ['contractVersion', 'releaseVersion', 'sourceBundleDigest'];
    if (Object.keys(current).length === 0 && identityKeys.some(function (key) { return !Object.prototype.hasOwnProperty.call(patch, key); })) {
      throw failure('CXP14_UAT_EVIDENCE_IDENTITY_REQUIRED', 'The first CXP-14 UAT evidence record must include the immutable release identity.');
    }
    identityKeys.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(current, key) && Object.prototype.hasOwnProperty.call(patch, key) && current[key] !== patch[key]) {
        throw failure('CXP14_UAT_EVIDENCE_IDENTITY_MISMATCH', 'CXP-14 UAT release identity cannot change after initialization.');
      }
    });
    var merged = contract.validateUatPatch(Object.assign({}, current, patch));
    runtime.properties.setProperty(EVIDENCE_KEY, JSON.stringify(merged));
    return output('recordCxp14UatEvidence', true, { recorded: true, recordedFields: Object.freeze(patchKeys.sort()) });
  }
  function recordPending(overrides) {
    var runtime = ports(overrides); assertUat(runtime); var raw = runtime.properties.getProperty(PENDING_EVIDENCE_KEY); var supplied;
    try { supplied = JSON.parse(raw || ''); } catch (_error) { throw failure('CXP14_UAT_EVIDENCE_INVALID', 'Set the documented CXP14_UAT_PENDING_EVIDENCE_V1 JSON object before recording.'); }
    var result = recordEvidence(runtime, supplied);
    if (typeof runtime.properties.deleteProperty === 'function') runtime.properties.deleteProperty(PENDING_EVIDENCE_KEY); else runtime.properties.setProperty(PENDING_EVIDENCE_KEY, '');
    return result;
  }
  function output(step, pass, details) {
    var evidence = resolve('Cxp14ReleaseEvidence', '../release/Cxp14ReleaseEvidence.js');
    var result = evidence.deepFreeze(Object.assign({ pass: pass === true, step: step }, details || {}));
    if (typeof console !== 'undefined' && typeof console.log === 'function') console.log('CXP14_UAT ' + step + ' ' + JSON.stringify(result));
    return result;
  }
  function evidenceOrEmpty(runtime) { return readEvidenceFrom(runtime.properties) || {}; }
  function identityMissing(evidence) {
    return ['contractVersion', 'releaseVersion', 'sourceBundleDigest'].filter(function (key) {
      return !Object.prototype.hasOwnProperty.call(evidence, key);
    });
  }
  function releaseIdentity(evidence) {
    return {
      contractVersion: evidence.contractVersion,
      releaseVersion: evidence.releaseVersion,
      sourceBundleDigest: evidence.sourceBundleDigest,
    };
  }
  function step00(overrides) {
    var runtime = bind(ports(overrides), overrides); assertUat(runtime);
    return orchestrator().step00(runtime);
  }
  function step01(overrides) {
    var runtime = bind(ports(overrides), overrides); assertUat(runtime);
    return orchestrator().step01(runtime);
  }
  function step02(overrides) {
    var runtime = bind(ports(overrides), overrides); assertUat(runtime);
    return orchestrator().step02(runtime);
  }
  function step03(overrides) {
    var runtime = bind(ports(overrides), overrides); assertUat(runtime);
    return orchestrator().step03(runtime);
  }
  function step04(overrides) {
    var runtime = bind(ports(overrides), overrides); assertUat(runtime);
    return orchestrator().step04(runtime);
  }
  function step05(overrides) {
    var runtime = bind(ports(overrides), overrides); assertUat(runtime);
    return orchestrator().step05(runtime);
  }
  function step06(overrides) {
    var runtime = bind(ports(overrides), overrides); assertUat(runtime);
    return orchestrator().step06(runtime);
  }
  function step07(overrides) {
    var runtime = bind(ports(overrides), overrides); assertUat(runtime);
    return orchestrator().step07(runtime);
  }
  function step08(overrides) {
    var runtime = bind(ports(overrides), overrides); assertUat(runtime);
    return orchestrator().step08(runtime);
  }
  function configureFixtureFolders(overrides) {
    var runtime = ports(overrides); assertUat(runtime);
    var folders = resolve('Cxp14UatFixtureFolders', '../release/Cxp14UatFixtureFolders.js');
    var result = folders.install(runtime.properties, overrides && overrides.catalog, runtime.configuration);
    if (typeof console !== 'undefined' && typeof console.log === 'function') {
      console.log('CXP14_UAT configureCxp14UatFixtureFolders ' + JSON.stringify(result));
    }
    return result;
  }
  function acknowledgeProduction(overrides) {
    var runtime = ports(overrides); assertUat(runtime);
    var evidence = evidenceOrEmpty(runtime);
    if (identityMissing(evidence).length > 0) {
      throw failure('CXP14_UAT_EVIDENCE_IDENTITY_REQUIRED', 'The first CXP-14 UAT evidence record must include the immutable release identity.');
    }
    return recordEvidence(runtime, { prodAcknowledged: true });
  }
  function recordExpectedPeakRun(overrides, supplied) {
    var runtime = ports(overrides); assertUat(runtime); var evidence = evidenceOrEmpty(runtime);
    if (identityMissing(evidence).length > 0) throw failure('CXP14_EXPECTED_PEAK_IDENTITY_INVALID', 'Record the immutable CXP-14 release identity before performance runs.');
    var result = runtime.performanceRepository.record(releaseIdentity(evidence), supplied);
    return output('recordCxp14ExpectedPeakRun', result.status === 'COMPLETE', result);
  }
  function recordExpectedPeakPending(overrides) {
    var runtime = ports(overrides); assertUat(runtime);
    var repository = resolve('Cxp14ExpectedPeakRepository', '../release/Cxp14ExpectedPeakRepository.js');
    var raw = runtime.properties.getProperty(repository.PENDING_KEY); var supplied;
    try { supplied = JSON.parse(raw || ''); } catch (_error) { throw failure('CXP14_EXPECTED_PEAK_EVIDENCE_INVALID', 'Set the documented expected-peak pending run JSON before recording.'); }
    var result = recordExpectedPeakRun(runtime, supplied);
    if (typeof runtime.properties.deleteProperty === 'function') runtime.properties.deleteProperty(repository.PENDING_KEY); else runtime.properties.setProperty(repository.PENDING_KEY, '');
    return result;
  }
  return Object.freeze({
    EVIDENCE_KEY: EVIDENCE_KEY, GATE_KEYS: GATE_KEYS, PENDING_EVIDENCE_KEY: PENDING_EVIDENCE_KEY,
    acknowledgeProduction: acknowledgeProduction,
    configureFixtureFolders: configureFixtureFolders,
    readEvidence: readEvidence, recordEvidence: recordEvidence, recordExpectedPeakPending: recordExpectedPeakPending, recordExpectedPeakRun: recordExpectedPeakRun, recordPending: recordPending,
    step00: step00, step01: step01, step02: step02, step03: step03, step04: step04,
    step05: step05, step06: step06, step07: step07, step08: step08,
  });
})();

function CXP14UatStep00VerifyPrerequisites() { return Cxp14Uat.step00(); }
function CXP14UatStep01InstallReleaseReadiness() { return Cxp14Uat.step01(); }
function CXP14UatStep02InspectCriticalPaths() { return Cxp14Uat.step02(); }
function CXP14UatStep03BenchmarkExpectedPeak() { return Cxp14Uat.step03(); }
function CXP14UatStep04StressDeclaredMaximum() { return Cxp14Uat.step04(); }
function CXP14UatStep05VerifyFailureRecovery() { return Cxp14Uat.step05(); }
function CXP14UatStep06VerifyLifecycleAndStatus() { return Cxp14Uat.step06(); }
function CXP14UatStep07RunFinalParityAndValidation() { return Cxp14Uat.step07(); }
function CXP14UatStep08PromotionGate() { return Cxp14Uat.step08(); }
function recordCxp14UatEvidence() { return Cxp14Uat.recordPending(); }
function recordCxp14ExpectedPeakRun() { return Cxp14Uat.recordExpectedPeakPending(); }
function acknowledgeCxp14Production() { return Cxp14Uat.acknowledgeProduction(); }
function configureCxp14UatFixtureFolders() { return Cxp14Uat.configureFixtureFolders(); }
if (typeof module !== 'undefined' && module.exports) module.exports = Cxp14Uat;
