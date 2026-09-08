/** Durable, privacy-bounded CXP-14 expected-peak run evidence. */
var Cxp14ExpectedPeakRepository = (function () {
  'use strict';

  var STATE_KEY = 'CXP14_EXPECTED_PEAK_RUNS_V1';
  var PENDING_KEY = 'CXP14_EXPECTED_PEAK_PENDING_RUN_V1';
  var DECLARED_MAXIMUM_STATE_KEY = 'CXP14_DECLARED_MAXIMUM_RUNS_V1';
  var DECLARED_MAXIMUM_PENDING_KEY = 'CXP14_DECLARED_MAXIMUM_PENDING_RUN_V1';
  var STATE_VERSION = 1;
  var REQUIRED_RUNS = 3;
  var SUBMISSION_KEYS = Object.freeze([
    'chunkCount', 'maxInvocationMs', 'noQuotaFailure', 'noTimeout', 'record',
  ]);

  function fail(code, message) { var error = new Error(message); error.code = code; return error; }
  function resolveContract() {
    if (typeof Cxp14ReleaseEvidence !== 'undefined') return Cxp14ReleaseEvidence;
    if (typeof require === 'function') return require('./Cxp14ReleaseEvidence.js');
    throw fail('CXP14_EXPECTED_PEAK_DEPENDENCY_MISSING', 'The CXP-14 release evidence contract is unavailable.');
  }
  function exactKeys(value, keys) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
    return Object.keys(value).sort().join('|') === keys.slice().sort().join('|');
  }
  function identity(value) {
    var contract = resolveContract();
    var checked = contract.validateUatPatch(value || {});
    if (!exactKeys(checked, ['contractVersion', 'releaseVersion', 'sourceBundleDigest'])) {
      throw fail('CXP14_EXPECTED_PEAK_IDENTITY_INVALID', 'The complete immutable CXP-14 release identity is required.');
    }
    return checked;
  }
  function validateSubmission(value, expectedProfile) {
    var contract = resolveContract();
    var profile = expectedProfile || 'EXPECTED_PEAK';
    if (!exactKeys(value, SUBMISSION_KEYS)) {
      throw fail('CXP14_EXPECTED_PEAK_EVIDENCE_INVALID', 'Expected-peak run evidence has missing or unexpected fields.');
    }
    if (!Number.isInteger(value.chunkCount) || value.chunkCount < 1 || value.chunkCount > 100000 ||
      typeof value.noTimeout !== 'boolean' || typeof value.noQuotaFailure !== 'boolean') {
      throw fail('CXP14_EXPECTED_PEAK_EVIDENCE_INVALID', 'Expected-peak run telemetry is invalid.');
    }
    var record = contract.validatePerformanceRun(value.record);
    var timing = contract.evaluateTiming({
      maxInvocationMs: value.maxInvocationMs,
      noQuotaFailure: value.noQuotaFailure,
      noTimeout: value.noTimeout,
      profile: record.profile,
      schedulerInclusiveMs: record.schedulerInclusiveMs,
    });
    var callBounds = contract.expectedPeakCallsBounded(
      record.serviceCallCounts,
      value.chunkCount,
    );
    if (record.profile !== profile || record.terminalRunState !== 'SUCCESS' ||
      record.paritySummary !== 'MATCH' || timing.pass !== true || callBounds.pass !== true) {
      throw fail('CXP14_EXPECTED_PEAK_EVIDENCE_INVALID', 'Expected-peak run evidence does not satisfy its release gates.');
    }
    return contract.deepFreeze({
      chunkCount: value.chunkCount,
      maxInvocationMs: value.maxInvocationMs,
      noQuotaFailure: value.noQuotaFailure,
      noTimeout: value.noTimeout,
      record: record,
    });
  }
  function missingRunKey(profile, index) {
    return profile === 'DECLARED_MAXIMUM' ? 'declaredMaximumRun' + index : 'expectedPeakRun' + index;
  }
  function missingRunsKey(profile) {
    return profile === 'DECLARED_MAXIMUM' ? 'declaredMaximumRuns' : 'expectedPeakRuns';
  }
  function missingScalingKey(profile) {
    return profile === 'DECLARED_MAXIMUM' ? 'declaredMaximumServiceCallScaling' : 'expectedPeakServiceCallScaling';
  }
  function validateState(value, requiredRuns, expectedProfile) {
    var profile = expectedProfile || 'EXPECTED_PEAK';
    var needed = Number.isInteger(requiredRuns) && requiredRuns > 0 ? requiredRuns : REQUIRED_RUNS;
    if (!exactKeys(value, ['contractVersion', 'releaseDigest', 'releaseVersion', 'runs', 'version']) ||
      value.version !== STATE_VERSION || !Array.isArray(value.runs) || value.runs.length > needed) {
      throw fail('CXP14_EXPECTED_PEAK_STATE_INVALID', 'Persisted expected-peak evidence is malformed.');
    }
    var id = identity({
      contractVersion: value.contractVersion,
      releaseVersion: value.releaseVersion,
      sourceBundleDigest: value.releaseDigest,
    });
    var seen = Object.create(null);
    var runs = value.runs.map(function (run) {
      var checked = validateSubmission(run, profile);
      var digest = checked.record.sourceBundleDigest;
      if (seen[digest]) throw fail('CXP14_EXPECTED_PEAK_STATE_INVALID', 'Expected-peak run evidence contains a duplicate source digest.');
      seen[digest] = true;
      return checked;
    });
    return resolveContract().deepFreeze({
      contractVersion: id.contractVersion,
      releaseDigest: id.sourceBundleDigest,
      releaseVersion: id.releaseVersion,
      runs: runs,
      version: STATE_VERSION,
    });
  }
  function create(properties, options) {
    if (!properties || typeof properties.getProperty !== 'function' || typeof properties.setProperty !== 'function') {
      throw fail('CXP14_EXPECTED_PEAK_DEPENDENCY_MISSING', 'Script Properties are required for expected-peak evidence.');
    }
    var opts = options || {};
    var profile = opts.profile || 'EXPECTED_PEAK';
    var requiredRuns = Number.isInteger(opts.requiredRuns) && opts.requiredRuns > 0 ? opts.requiredRuns : (profile === 'DECLARED_MAXIMUM' ? 1 : REQUIRED_RUNS);
    var stateKey = opts.stateKey || (profile === 'DECLARED_MAXIMUM' ? DECLARED_MAXIMUM_STATE_KEY : STATE_KEY);
    function load() {
      var raw = properties.getProperty(stateKey); if (!raw) return null;
      var parsed; try { parsed = JSON.parse(raw); } catch (_error) { throw fail('CXP14_EXPECTED_PEAK_STATE_INVALID', 'Persisted expected-peak evidence is malformed.'); }
      return validateState(parsed, requiredRuns, profile);
    }
    function assertIdentity(state, expected) {
      if (state.contractVersion !== expected.contractVersion || state.releaseVersion !== expected.releaseVersion || state.releaseDigest !== expected.sourceBundleDigest) {
        throw fail('CXP14_EXPECTED_PEAK_IDENTITY_MISMATCH', 'Expected-peak evidence belongs to another release candidate.');
      }
    }
    function scalingBounded(runs) {
      if (requiredRuns <= 1) return true;
      var ordered = runs.slice().sort(function (left, right) { return left.chunkCount - right.chunkCount; });
      for (var index = 1; index < ordered.length; index += 1) {
        if (!resolveContract().rowScalingBounded({
          chunkCount: ordered[index - 1].chunkCount,
          serviceCallCounts: ordered[index - 1].record.serviceCallCounts,
          totalRows: ordered[index - 1].record.rowCounts.total,
        }, {
          chunkCount: ordered[index].chunkCount,
          serviceCallCounts: ordered[index].record.serviceCallCounts,
          totalRows: ordered[index].record.rowCounts.total,
        })) return false;
      }
      return true;
    }
    function reconcile(releaseIdentity) {
      var expected = identity(releaseIdentity); var state = load(); var missing = [];
      if (!state) missing.push(missingRunsKey(profile));
      else {
        assertIdentity(state, expected);
        for (var index = state.runs.length; index < requiredRuns; index += 1) missing.push(missingRunKey(profile, index + 1));
        if (state.runs.length === requiredRuns && !scalingBounded(state.runs)) missing.push(missingScalingKey(profile));
      }
      var complete = missing.length === 0;
      return resolveContract().deepFreeze({
        missing: missing.sort(),
        recordedRunCount: state ? state.runs.length : 0,
        requiredRunCount: requiredRuns,
        status: complete ? 'COMPLETE' : 'NOT_RECORDED',
      });
    }
    function record(releaseIdentity, submission) {
      var expected = identity(releaseIdentity); var checked = validateSubmission(submission, profile); var state = load();
      if (checked.record.contractVersion !== expected.contractVersion || checked.record.releaseVersion !== expected.releaseVersion) {
        throw fail('CXP14_EXPECTED_PEAK_IDENTITY_MISMATCH', 'Expected-peak run evidence belongs to another release candidate.');
      }
      if (!state) state = { contractVersion: expected.contractVersion, releaseDigest: expected.sourceBundleDigest, releaseVersion: expected.releaseVersion, runs: [], version: STATE_VERSION };
      else assertIdentity(state, expected);
      var digest = checked.record.sourceBundleDigest;
      var existing = state.runs.filter(function (run) { return run.record.sourceBundleDigest === digest; })[0];
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(checked)) throw fail('CXP14_EXPECTED_PEAK_EVIDENCE_CONFLICT', 'A recorded expected-peak source digest has conflicting telemetry.');
        var replay = reconcile(expected);
        return resolveContract().deepFreeze(Object.assign({ idempotent: true }, replay));
      }
      if (state.runs.length >= requiredRuns) throw fail('CXP14_EXPECTED_PEAK_EVIDENCE_FULL', 'Exactly three distinct expected-peak runs are allowed.');
      state = {
        contractVersion: state.contractVersion,
        releaseDigest: state.releaseDigest,
        releaseVersion: state.releaseVersion,
        runs: state.runs.concat([checked]),
        version: state.version,
      };
      properties.setProperty(stateKey, JSON.stringify(validateState(state, requiredRuns, profile)));
      var result = reconcile(expected);
      return resolveContract().deepFreeze(Object.assign({ idempotent: false }, result));
    }
    return Object.freeze({ load: load, profile: profile, reconcile: reconcile, record: record, requiredRunCount: requiredRuns, stateKey: stateKey });
  }
  return Object.freeze({
    DECLARED_MAXIMUM_PENDING_KEY: DECLARED_MAXIMUM_PENDING_KEY,
    DECLARED_MAXIMUM_STATE_KEY: DECLARED_MAXIMUM_STATE_KEY,
    PENDING_KEY: PENDING_KEY,
    REQUIRED_RUNS: REQUIRED_RUNS,
    STATE_KEY: STATE_KEY,
    STATE_VERSION: STATE_VERSION,
    SUBMISSION_KEYS: SUBMISSION_KEYS,
    create: create,
    validateSubmission: validateSubmission,
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Cxp14ExpectedPeakRepository;
