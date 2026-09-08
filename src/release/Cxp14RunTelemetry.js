/** Map hosted CXP-13 telemetry into a CXP-14 performance submission. Fail closed. */
var Cxp14RunTelemetry = (function () {
  'use strict';

  var PACKAGING = Object.freeze({
    combined: 'COMBINED',
    multi_sheet_workbook: 'MULTI_SHEET_WORKBOOK',
    single_dataset: 'SINGLE_DATASET',
  });

  function resolveContract() {
    if (typeof Cxp14ReleaseEvidence !== 'undefined') return Cxp14ReleaseEvidence;
    if (typeof require === 'function') return require('./Cxp14ReleaseEvidence.js');
    throw new Error('The CXP-14 release evidence contract is unavailable.');
  }

  function digestFromFingerprint(value) {
    var raw = String(value || '').trim();
    if (raw.indexOf('sha256:') === 0) raw = raw.slice(7);
    return /^[a-fA-F0-9]{64}$/.test(raw) ? raw : null;
  }

  function maxInvocation(invocations) {
    var max = 0;
    (invocations || []).forEach(function (item) {
      if (item && Number.isInteger(item.durationMs) && item.durationMs > max) max = item.durationMs;
    });
    return max;
  }

  function harvest(input) {
    var source = input || {};
    var contract = resolveContract();
    var telemetry = source.telemetry || {};
    var identity = source.identity || {};
    var profile = source.profile || 'EXPECTED_PEAK';
    var profileSpec = contract.WORKLOAD_PROFILES[profile];
    var missing = [];
    var invocations = telemetry.invocations || [];
    var startedAtUtc = source.startedAtUtc || (invocations[0] && invocations[0].startedAtUtc) || null;
    var endedAtUtc = source.endedAtUtc || (invocations.length ? invocations[invocations.length - 1].endedAtUtc : null);
    var digest = digestFromFingerprint(source.sourceBundleDigest || telemetry.sourceBundleDigest);
    var packagingKind = PACKAGING[telemetry.packagingKind] || telemetry.packagingKind || source.packagingKind || null;
    var rowCounts = telemetry.rowCounts && Number.isInteger(telemetry.rowCounts.total) &&
      telemetry.rowCounts.total > 0 ? telemetry.rowCounts : null;
    var serviceCallCounts = telemetry.serviceCallCounts;
    var phaseDurations = telemetry.phaseDurations;
    var maxInvocationMs = Number.isInteger(source.maxInvocationMs)
      ? source.maxInvocationMs
      : maxInvocation(invocations);
    var durationMs = startedAtUtc && endedAtUtc ? Date.parse(endedAtUtc) - Date.parse(startedAtUtc) : null;
    var cumulativeActiveMs = invocations.reduce(function (sum, item) {
      return sum + (item && Number.isInteger(item.durationMs) ? item.durationMs : 0);
    }, 0);
    if (!cumulativeActiveMs && Number.isInteger(durationMs) && durationMs >= 0) cumulativeActiveMs = durationMs;
    var schedulerInclusiveMs = Number.isInteger(source.schedulerInclusiveMs)
      ? source.schedulerInclusiveMs
      : durationMs;
    var continuationCount = Number.isInteger(telemetry.continuationCount)
      ? telemetry.continuationCount
      : Math.max(0, invocations.length - 1);
    var noTimeout = telemetry.timedOut !== true && source.noTimeout !== false &&
      !(Number.isInteger(maxInvocationMs) && maxInvocationMs >= 270000);
    var noQuotaFailure = telemetry.noQuotaFailure !== false && source.noQuotaFailure !== false;
    var chunkCount = Number.isInteger(telemetry.chunkCount) && telemetry.chunkCount > 0 ? telemetry.chunkCount : null;
    var healthResult = source.healthResult || (source.healthy === true ? 'HEALTHY' : null);
    var activeWeekKeyAligned = source.activeWeekKeyAligned === true || source.registryPropertyAligned === true;
    var lastKnownGoodPreserved = telemetry.lastKnownGoodPreserved !== false;
    var terminalRunState = source.terminalRunState || (source.status === 'SUCCESS' ? 'SUCCESS' : null);

    if (!identity.contractVersion) missing.push('contractVersion');
    if (!identity.releaseVersion) missing.push('releaseVersion');
    if (!digest) missing.push('sourceBundleDigest');
    if (!profileSpec) missing.push('knownProfile');
    if (!Number.isInteger(chunkCount)) missing.push('chunkCount');
    if (!Number.isInteger(maxInvocationMs) || maxInvocationMs < 0) missing.push('maxInvocationMs');
    if (!startedAtUtc) missing.push('startedAtUtc');
    if (!endedAtUtc) missing.push('endedAtUtc');
    if (!Number.isInteger(durationMs) || durationMs < 0) missing.push('durationMs');
    if (!Number.isInteger(schedulerInclusiveMs) || schedulerInclusiveMs < 0) missing.push('schedulerInclusiveMs');
    if (!serviceCallCounts) missing.push('serviceCallCounts');
    else contract.CALL_KEYS.forEach(function (key) {
      if (!Number.isInteger(serviceCallCounts[key])) missing.push('serviceCallCounts.' + key);
    });
    if (!phaseDurations) missing.push('phaseDurations');
    if (!rowCounts || !Number.isInteger(rowCounts.total)) missing.push('rowCounts');
    if (!packagingKind) missing.push('packagingKind');
    if (!healthResult) missing.push('healthResult');
    if (!terminalRunState) missing.push('terminalRunState');
    if (noTimeout !== true) missing.push('noTimeout');
    if (noQuotaFailure !== true) missing.push('noQuotaFailure');

    var record = null;
    var submission = null;
    if (missing.length === 0) {
      var maxStepDurationMs = maxInvocationMs;
      if (maxStepDurationMs > cumulativeActiveMs) cumulativeActiveMs = maxStepDurationMs;
      if (schedulerInclusiveMs < cumulativeActiveMs) schedulerInclusiveMs = cumulativeActiveMs;
      record = {
        activeWeekKeyAligned: activeWeekKeyAligned,
        auditState: source.auditState || 'EXACTLY_ONCE',
        cleanupState: source.cleanupState || 'COMPLETE',
        contentionCount: Number.isInteger(telemetry.contentionCount) ? telemetry.contentionCount : 0,
        continuationCount: continuationCount,
        contractVersion: identity.contractVersion,
        cumulativeActiveMs: cumulativeActiveMs,
        dataset: null,
        durationMs: durationMs,
        endedAtUtc: endedAtUtc,
        healthResult: healthResult,
        lastKnownGoodPreserved: lastKnownGoodPreserved,
        maxStepDurationMs: maxStepDurationMs,
        packagingKind: packagingKind,
        paritySummary: source.paritySummary || 'MATCH',
        phase: 'COMPLETE',
        phaseDurations: phaseDurations,
        profile: profile,
        releaseVersion: identity.releaseVersion,
        rowCounts: rowCounts,
        schedulerInclusiveMs: schedulerInclusiveMs,
        serviceCallCounts: serviceCallCounts,
        sourceBundleDigest: digest,
        startedAtUtc: startedAtUtc,
        terminalRunState: terminalRunState,
        watchdogRecoveryCount: Number.isInteger(telemetry.watchdogRecoveryCount)
          ? telemetry.watchdogRecoveryCount
          : 0,
      };
      var timing = contract.evaluateTiming({
        maxInvocationMs: maxInvocationMs,
        noQuotaFailure: noQuotaFailure,
        noTimeout: noTimeout,
        profile: profile,
        schedulerInclusiveMs: schedulerInclusiveMs,
      });
      if (timing.pass !== true) {
        missing = missing.concat(timing.missing);
        record = null;
      } else {
        var callBounds = contract.expectedPeakCallsBounded(serviceCallCounts, chunkCount);
        if (callBounds.pass !== true) {
          missing = missing.concat(callBounds.missing);
          record = null;
        }
      }
    }

    if (record && missing.length === 0) {
      submission = {
        chunkCount: chunkCount,
        maxInvocationMs: maxInvocationMs,
        noQuotaFailure: noQuotaFailure,
        noTimeout: noTimeout,
        record: record,
      };
    }

    return contract.deepFreeze({
      eligible: missing.length === 0 && Boolean(submission),
      missing: Array.from(new Set(missing)).sort(),
      submission: submission,
    });
  }

  return Object.freeze({
    digestFromFingerprint: digestFromFingerprint,
    harvest: harvest,
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Cxp14RunTelemetry;
