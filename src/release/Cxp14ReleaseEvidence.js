/**
 * Pure CXP-14 release evidence contract. Records are deliberately bounded and
 * contain no source values, identifiers, filenames, formulas, or user data.
 */
var Cxp14ReleaseEvidence = (function () {
  'use strict';

  var CONTRACT_VERSION = 1;
  var MAX_COUNT = 1000000000;
  var MAX_DURATION_MS = 604800000;
  var BOUNDARIES = Object.freeze({
    invocationBudgetMs: 270000,
    invocationObjectiveMs: 240000,
    minimumNextStepReserveMs: 60000,
    handoffMarginMs: 15000,
    recoveryWatchdogMs: 420000,
    contentionBackoffMs: 90000,
  });
  var WORKLOAD_PROFILES = Object.freeze({
    EXPECTED_PEAK: Object.freeze({
      aht: 7000,
      auxes: 3000,
      handled: 5000,
      offered: 5000,
      staff: 300,
      schedulerObjectiveMs: 600000,
      schedulerWindowMs: 1200000,
      totalRows: 20300,
    }),
    DECLARED_MAXIMUM: Object.freeze({
      aht: 15000,
      auxes: 7500,
      handled: 10000,
      offered: 10000,
      staff: 2000,
      schedulerObjectiveMs: 1800000,
      schedulerWindowMs: 1800000,
      totalRows: 44500,
    }),
  });
  var PERFORMANCE_KEYS = Object.freeze([
    'activeWeekKeyAligned', 'auditState', 'cleanupState', 'contentionCount',
    'continuationCount', 'contractVersion', 'cumulativeActiveMs', 'dataset',
    'durationMs', 'endedAtUtc', 'healthResult', 'lastKnownGoodPreserved',
    'maxStepDurationMs', 'packagingKind', 'paritySummary', 'phase',
    'phaseDurations', 'profile', 'releaseVersion', 'rowCounts',
    'schedulerInclusiveMs', 'serviceCallCounts', 'sourceBundleDigest',
    'startedAtUtc', 'terminalRunState', 'watchdogRecoveryCount',
  ]);
  var ROW_KEYS = Object.freeze(['aht', 'auxes', 'handled', 'offered', 'staff', 'total']);
  var CALL_KEYS = Object.freeze(['drive', 'flush', 'lock', 'properties', 'spreadsheet', 'trigger']);
  // Expected-peak calls are bounded by operation/chunk count and an absolute
  // ceiling that is categorically below the 20,300-row workload.
  var EXPECTED_PEAK_CALL_BOUNDS = Object.freeze({
    drive: Object.freeze({ base: 30, ceiling: 1000, perChunk: 3 }),
    flush: Object.freeze({ base: 10, ceiling: 250, perChunk: 1 }),
    lock: Object.freeze({ base: 30, ceiling: 1000, perChunk: 3 }),
    properties: Object.freeze({ base: 100, ceiling: 4000, perChunk: 12 }),
    spreadsheet: Object.freeze({ base: 200, ceiling: 6000, perChunk: 20 }),
    trigger: Object.freeze({ base: 30, ceiling: 1000, perChunk: 3 }),
  });
  var PHASE_DURATION_KEYS = Object.freeze([
    'backup', 'cleanup', 'commit', 'healthReadback', 'parity', 'preparation',
    'recalculation', 'rollback',
  ]);
  var UAT_BOOLEAN_KEYS = Object.freeze([
    'criticalPaths', 'declaredMaximum', 'deploymentChecklistComplete',
    'expectedPeak', 'failureRecovery', 'finalParity', 'lifecycleStatus',
    'permissionsVerified', 'prerequisites', 'prodAcknowledged',
    'rollbackRehearsed', 'setup',
  ]);
  var UAT_KEYS = Object.freeze(UAT_BOOLEAN_KEYS.concat([
    'contractVersion', 'releaseVersion', 'sourceBundleDigest',
  ]).sort());

  function error(code, message, fields) {
    var failure = new Error(message);
    failure.code = code;
    failure.details = Object.freeze({ invalidFields: Object.freeze((fields || []).slice().sort()) });
    return failure;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  function ownKeysMatch(value, allowed) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
    var keys = Object.keys(value).sort();
    var expected = allowed.slice().sort();
    return keys.length === expected.length && keys.every(function (key, index) {
      return key === expected[index];
    });
  }

  function boundedInteger(value) {
    return Number.isInteger(value) && value >= 0 && value <= MAX_COUNT;
  }

  function boundedDuration(value) {
    return Number.isInteger(value) && value >= 0 && value <= MAX_DURATION_MS;
  }

  function canonicalUtc(value) {
    return typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
      !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
  }

  function safeReleaseVersion(value) {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value);
  }

  function safeDigest(value) {
    return typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value);
  }

  function validateExactIntegerMap(value, keys, durationMap, field, invalid) {
    if (!ownKeysMatch(value, keys)) {
      invalid.push(field);
      return;
    }
    keys.forEach(function (key) {
      if (!(durationMap ? boundedDuration(value[key]) : boundedInteger(value[key]))) {
        invalid.push(field + '.' + key);
      }
    });
  }

  function validatePerformanceRun(input) {
    var invalid = [];
    if (!ownKeysMatch(input, PERFORMANCE_KEYS)) {
      throw error('CXP14_RELEASE_EVIDENCE_INVALID', 'CXP-14 performance evidence has missing or unexpected fields.', ['record']);
    }
    if (input.contractVersion !== CONTRACT_VERSION) invalid.push('contractVersion');
    if (!Object.prototype.hasOwnProperty.call(WORKLOAD_PROFILES, input.profile)) invalid.push('profile');
    if (['PREPARATION','BACKUP','COMMIT','RECALCULATION','HEALTH_READBACK','ROLLBACK','CLEANUP','PARITY','COMPLETE'].indexOf(input.phase) === -1) invalid.push('phase');
    if ([null,'Handled','Offered','AHT','Auxes','Staff'].indexOf(input.dataset) === -1) invalid.push('dataset');
    if (['MULTI_SHEET_WORKBOOK','SINGLE_DATASET','COMBINED'].indexOf(input.packagingKind) === -1) invalid.push('packagingKind');
    if (!canonicalUtc(input.startedAtUtc)) invalid.push('startedAtUtc');
    if (!canonicalUtc(input.endedAtUtc) || (canonicalUtc(input.startedAtUtc) && Date.parse(input.endedAtUtc) < Date.parse(input.startedAtUtc))) invalid.push('endedAtUtc');
    ['durationMs','cumulativeActiveMs','schedulerInclusiveMs','maxStepDurationMs'].forEach(function (key) {
      if (!boundedDuration(input[key])) invalid.push(key);
    });
    ['continuationCount','contentionCount','watchdogRecoveryCount'].forEach(function (key) {
      if (!boundedInteger(input[key])) invalid.push(key);
    });
    validateExactIntegerMap(input.rowCounts, ROW_KEYS, false, 'rowCounts', invalid);
    validateExactIntegerMap(input.serviceCallCounts, CALL_KEYS, false, 'serviceCallCounts', invalid);
    validateExactIntegerMap(input.phaseDurations, PHASE_DURATION_KEYS, true, 'phaseDurations', invalid);
    if (input.rowCounts && boundedInteger(input.rowCounts.total) &&
      input.rowCounts.total !== ROW_KEYS.slice(0, 5).reduce(function (sum, key) { return sum + input.rowCounts[key]; }, 0)) invalid.push('rowCounts.total');
    if (WORKLOAD_PROFILES[input.profile] && input.rowCounts &&
      ROW_KEYS.slice(0, 5).some(function (key) { return input.rowCounts[key] !== WORKLOAD_PROFILES[input.profile][key]; })) invalid.push('rowCounts.profile');
    if (WORKLOAD_PROFILES[input.profile] && input.rowCounts &&
      input.rowCounts.total !== WORKLOAD_PROFILES[input.profile].totalRows) invalid.push('rowCounts.profileTotal');
    if (!safeReleaseVersion(input.releaseVersion)) invalid.push('releaseVersion');
    if (!safeDigest(input.sourceBundleDigest)) invalid.push('sourceBundleDigest');
    if (['SUCCESS','FAILED_SOURCE','FAILED_INGESTION','ROLLED_BACK'].indexOf(input.terminalRunState) === -1) invalid.push('terminalRunState');
    if (['EXACTLY_ONCE','MISSING','DUPLICATE'].indexOf(input.auditState) === -1) invalid.push('auditState');
    if (['HEALTHY','UNHEALTHY','NOT_RUN'].indexOf(input.healthResult) === -1) invalid.push('healthResult');
    if (['COMPLETE','RETAINED_FOR_RECONCILIATION','FAILED'].indexOf(input.cleanupState) === -1) invalid.push('cleanupState');
    if (['MATCH','EXPECTED_SOURCE_ERROR_ONLY','DEFECT','NOT_RUN'].indexOf(input.paritySummary) === -1) invalid.push('paritySummary');
    ['activeWeekKeyAligned','lastKnownGoodPreserved'].forEach(function (key) {
      if (typeof input[key] !== 'boolean') invalid.push(key);
    });
    if (canonicalUtc(input.startedAtUtc) && canonicalUtc(input.endedAtUtc) && boundedDuration(input.durationMs) &&
      Date.parse(input.endedAtUtc) - Date.parse(input.startedAtUtc) !== input.durationMs) invalid.push('durationMs.elapsed');
    if (boundedDuration(input.durationMs) && boundedDuration(input.cumulativeActiveMs) &&
      input.cumulativeActiveMs < input.durationMs) invalid.push('cumulativeActiveMs');
    if (boundedDuration(input.cumulativeActiveMs) && boundedDuration(input.schedulerInclusiveMs) &&
      input.schedulerInclusiveMs < input.cumulativeActiveMs) invalid.push('schedulerInclusiveMs');
    if (boundedDuration(input.cumulativeActiveMs) && boundedDuration(input.maxStepDurationMs) &&
      input.maxStepDurationMs > input.cumulativeActiveMs) invalid.push('maxStepDurationMs');
    if (ownKeysMatch(input.phaseDurations, PHASE_DURATION_KEYS) && boundedDuration(input.cumulativeActiveMs) &&
      PHASE_DURATION_KEYS.reduce(function (sum, key) { return sum + input.phaseDurations[key]; }, 0) > input.cumulativeActiveMs) invalid.push('phaseDurations.total');
    if (input.terminalRunState === 'SUCCESS') {
      if (input.phase !== 'COMPLETE') invalid.push('phase.success');
      if (input.auditState !== 'EXACTLY_ONCE') invalid.push('auditState.success');
      if (input.healthResult !== 'HEALTHY') invalid.push('healthResult.success');
      if (input.cleanupState !== 'COMPLETE') invalid.push('cleanupState.success');
      if (input.activeWeekKeyAligned !== true) invalid.push('activeWeekKeyAligned.success');
      if (input.lastKnownGoodPreserved !== true) invalid.push('lastKnownGoodPreserved.success');
    }
    if (invalid.length) throw error('CXP14_RELEASE_EVIDENCE_INVALID', 'CXP-14 performance evidence failed validation.', invalid);
    return deepFreeze(JSON.parse(JSON.stringify(input)));
  }

  function buildPerformanceRun(input) {
    return validatePerformanceRun(input);
  }

  function canStartAnotherStep(elapsedMs, nextStepEstimateMs) {
    if (!boundedDuration(elapsedMs) || !boundedDuration(nextStepEstimateMs)) return false;
    return elapsedMs + nextStepEstimateMs + BOUNDARIES.minimumNextStepReserveMs +
      BOUNDARIES.handoffMarginMs < BOUNDARIES.invocationBudgetMs;
  }

  function evaluateTiming(input) {
    var source = input || {};
    var profile = WORKLOAD_PROFILES[source.profile];
    var missing = [];
    if (!profile) missing.push('knownProfile');
    if (!boundedDuration(source.maxInvocationMs)) missing.push('maxInvocationMs');
    if (!boundedDuration(source.schedulerInclusiveMs)) missing.push('schedulerInclusiveMs');
    if (source.noTimeout !== true) missing.push('noTimeout');
    if (source.noQuotaFailure !== true) missing.push('noQuotaFailure');
    var objectiveMet = boundedDuration(source.maxInvocationMs) && source.maxInvocationMs < BOUNDARIES.invocationObjectiveMs;
    var hardBoundaryMet = boundedDuration(source.maxInvocationMs) && source.maxInvocationMs < BOUNDARIES.invocationBudgetMs;
    var schedulerObjectiveMet = Boolean(profile) && boundedDuration(source.schedulerInclusiveMs) &&
      source.schedulerInclusiveMs <= profile.schedulerObjectiveMs;
    var windowMet = Boolean(profile) && boundedDuration(source.schedulerInclusiveMs) && source.schedulerInclusiveMs <= profile.schedulerWindowMs;
    if (!hardBoundaryMet) missing.push('invocationUnder270000Ms');
    if (!objectiveMet) missing.push('invocationUnder240000Ms');
    if (!schedulerObjectiveMet) missing.push('schedulerObjectiveMet');
    if (!windowMet) missing.push('schedulerWindowMet');
    return deepFreeze({
      hardBoundaryMet: hardBoundaryMet,
      missing: Array.from(new Set(missing)).sort(),
      objectiveMet: objectiveMet,
      pass: missing.length === 0 && objectiveMet && hardBoundaryMet && schedulerObjectiveMet && windowMet,
      schedulerObjectiveMet: schedulerObjectiveMet,
      windowMet: windowMet,
    });
  }

  function rowScalingBounded(baseline, comparison) {
    if (!baseline || !comparison || !boundedInteger(baseline.totalRows) ||
      !boundedInteger(comparison.totalRows) || comparison.totalRows < baseline.totalRows ||
      !boundedInteger(baseline.chunkCount) || !boundedInteger(comparison.chunkCount) ||
      comparison.chunkCount < baseline.chunkCount) return false;
    if (!ownKeysMatch(baseline.serviceCallCounts, CALL_KEYS) ||
      !ownKeysMatch(comparison.serviceCallCounts, CALL_KEYS)) return false;
    return CALL_KEYS.every(function (key) {
      var rule = EXPECTED_PEAK_CALL_BOUNDS[key];
      return boundedInteger(baseline.serviceCallCounts[key]) &&
        boundedInteger(comparison.serviceCallCounts[key]) &&
        comparison.serviceCallCounts[key] <= baseline.serviceCallCounts[key] +
          rule.perChunk * (comparison.chunkCount - baseline.chunkCount);
    });
  }

  function expectedPeakCallsBounded(serviceCallCounts, chunkCount) {
    var missing = [];
    var bounds = {};
    if (!ownKeysMatch(serviceCallCounts, CALL_KEYS) || !Number.isInteger(chunkCount) ||
      chunkCount < 1 || chunkCount > 100000) {
      return deepFreeze({ bounds: bounds, missing: ['expectedPeakServiceCallShape'], pass: false });
    }
    CALL_KEYS.forEach(function (key) {
      var rule = EXPECTED_PEAK_CALL_BOUNDS[key];
      var maximum = Math.min(rule.ceiling, rule.base + rule.perChunk * chunkCount);
      bounds[key] = maximum;
      if (!boundedInteger(serviceCallCounts[key]) || serviceCallCounts[key] > maximum) {
        missing.push(key + 'CallBound');
      }
    });
    return deepFreeze({ bounds: bounds, missing: missing.sort(), pass: missing.length === 0 });
  }

  function validateUatEvidence(input) {
    if (!ownKeysMatch(input, UAT_KEYS)) {
      throw error('CXP14_UAT_EVIDENCE_INVALID', 'CXP-14 UAT evidence has missing or unexpected fields.', ['record']);
    }
    var invalid = [];
    if (input.contractVersion !== CONTRACT_VERSION) invalid.push('contractVersion');
    if (!safeReleaseVersion(input.releaseVersion)) invalid.push('releaseVersion');
    if (!safeDigest(input.sourceBundleDigest)) invalid.push('sourceBundleDigest');
    UAT_BOOLEAN_KEYS.forEach(function (key) { if (typeof input[key] !== 'boolean') invalid.push(key); });
    if (invalid.length) throw error('CXP14_UAT_EVIDENCE_INVALID', 'CXP-14 UAT evidence failed validation.', invalid);
    return deepFreeze(JSON.parse(JSON.stringify(input)));
  }

  function validateUatPatch(input) {
    if (!input || Object.prototype.toString.call(input) !== '[object Object]' ||
      Object.keys(input).some(function (key) { return UAT_KEYS.indexOf(key) === -1; })) {
      throw error('CXP14_UAT_EVIDENCE_INVALID', 'CXP-14 UAT evidence patch has unexpected fields.', ['record']);
    }
    var invalid = [];
    if (Object.prototype.hasOwnProperty.call(input, 'contractVersion') && input.contractVersion !== CONTRACT_VERSION) invalid.push('contractVersion');
    if (Object.prototype.hasOwnProperty.call(input, 'releaseVersion') && !safeReleaseVersion(input.releaseVersion)) invalid.push('releaseVersion');
    if (Object.prototype.hasOwnProperty.call(input, 'sourceBundleDigest') && !safeDigest(input.sourceBundleDigest)) invalid.push('sourceBundleDigest');
    UAT_BOOLEAN_KEYS.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(input, key) && typeof input[key] !== 'boolean') invalid.push(key);
    });
    if (invalid.length) throw error('CXP14_UAT_EVIDENCE_INVALID', 'CXP-14 UAT evidence patch failed validation.', invalid);
    return deepFreeze(JSON.parse(JSON.stringify(input)));
  }

  function evaluatePromotion(input) {
    var evidence = validateUatPatch(input);
    var missing = ['contractVersion', 'releaseVersion', 'sourceBundleDigest'].filter(function (key) {
      return !Object.prototype.hasOwnProperty.call(evidence, key);
    }).concat(UAT_BOOLEAN_KEYS.filter(function (key) { return evidence[key] !== true; })).sort();
    if (missing.length === 0) validateUatEvidence(evidence);
    return deepFreeze({ missing: missing, pass: missing.length === 0, promotionReady: missing.length === 0 });
  }

  return Object.freeze({
    BOUNDARIES: BOUNDARIES,
    CALL_KEYS: CALL_KEYS,
    CONTRACT_VERSION: CONTRACT_VERSION,
    EXPECTED_PEAK_CALL_BOUNDS: EXPECTED_PEAK_CALL_BOUNDS,
    PERFORMANCE_KEYS: PERFORMANCE_KEYS,
    UAT_BOOLEAN_KEYS: UAT_BOOLEAN_KEYS,
    UAT_KEYS: UAT_KEYS,
    WORKLOAD_PROFILES: WORKLOAD_PROFILES,
    buildPerformanceRun: buildPerformanceRun,
    canStartAnotherStep: canStartAnotherStep,
    deepFreeze: deepFreeze,
    evaluatePromotion: evaluatePromotion,
    evaluateTiming: evaluateTiming,
    expectedPeakCallsBounded: expectedPeakCallsBounded,
    rowScalingBounded: rowScalingBounded,
    validatePerformanceRun: validatePerformanceRun,
    validateUatEvidence: validateUatEvidence,
    validateUatPatch: validateUatPatch,
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Cxp14ReleaseEvidence;
