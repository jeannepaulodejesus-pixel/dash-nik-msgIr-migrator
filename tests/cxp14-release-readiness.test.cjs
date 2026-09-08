const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const Cxp14ReleaseEvidence = require('../src/release/Cxp14ReleaseEvidence.js');
const Cxp14ExpectedPeakRepository = require('../src/release/Cxp14ExpectedPeakRepository.js');
const Cxp14Setup = require('../src/main/Cxp14Setup.js');
const Cxp14Uat = require('../src/main/Cxp14UatEntrypoints.js');

function propertyStore(initial = {}) {
  const values = { ...initial };
  return {
    deleteProperty(key) { delete values[key]; },
    getProperty(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setProperty(key, value) { values[key] = String(value); },
    values,
  };
}

function validPerformanceRun(overrides = {}) {
  return {
    activeWeekKeyAligned: true,
    auditState: 'EXACTLY_ONCE',
    cleanupState: 'COMPLETE',
    contentionCount: 0,
    continuationCount: 1,
    contractVersion: Cxp14ReleaseEvidence.CONTRACT_VERSION,
    cumulativeActiveMs: 1200,
    dataset: null,
    durationMs: 1000,
    endedAtUtc: '2026-09-07T01:00:01.000Z',
    healthResult: 'HEALTHY',
    lastKnownGoodPreserved: true,
    maxStepDurationMs: 500,
    packagingKind: 'COMBINED',
    paritySummary: 'MATCH',
    phase: 'COMPLETE',
    phaseDurations: {
      backup: 100,
      cleanup: 100,
      commit: 100,
      healthReadback: 100,
      parity: 100,
      preparation: 100,
      recalculation: 100,
      rollback: 0,
    },
    profile: 'EXPECTED_PEAK',
    releaseVersion: 'CXP-14-v1',
    rowCounts: {
      aht: 7000,
      auxes: 3000,
      handled: 5000,
      offered: 5000,
      staff: 300,
      total: 20300,
    },
    schedulerInclusiveMs: 1200000,
    serviceCallCounts: {
      drive: 5,
      flush: 2,
      lock: 4,
      properties: 12,
      spreadsheet: 20,
      trigger: 3,
    },
    sourceBundleDigest: 'a'.repeat(64),
    startedAtUtc: '2026-09-07T01:00:00.000Z',
    terminalRunState: 'SUCCESS',
    watchdogRecoveryCount: 0,
    ...overrides,
  };
}

function validUatEvidence(overrides = {}) {
  const result = {
    contractVersion: Cxp14ReleaseEvidence.CONTRACT_VERSION,
    releaseVersion: 'CXP-14-v1',
    sourceBundleDigest: 'b'.repeat(64),
  };
  Cxp14ReleaseEvidence.UAT_BOOLEAN_KEYS.forEach((key) => { result[key] = true; });
  return { ...result, ...overrides };
}

function expectedPeakSubmission(index, overrides = {}) {
  return {
    chunkCount: 5,
    maxInvocationMs: 239999,
    noQuotaFailure: true,
    noTimeout: true,
    record: validPerformanceRun({
      sourceBundleDigest: ['a', 'c', 'd'][index].repeat(64),
    }),
    ...overrides,
  };
}

function fakeTriggers() {
  const triggers = [];
  return {
    scriptApp: {
      deleteTrigger(trigger) {
        const index = triggers.indexOf(trigger);
        if (index >= 0) triggers.splice(index, 1);
      },
      getProjectTriggers() { return triggers.slice(); },
      newTrigger(handler) {
        return {
          timeBased() {
            return {
              after() { return this; },
              create() {
                const trigger = { getHandlerFunction: () => handler };
                triggers.push(trigger);
                return trigger;
              },
            };
          },
        };
      },
    },
    triggers,
  };
}

// CXP14 performance contract: workload fixtures retain the accepted five-dataset volumes.
test('workload profiles total exactly 20300 and 44500 rows', () => {
  const expected = Cxp14ReleaseEvidence.WORKLOAD_PROFILES.EXPECTED_PEAK;
  const maximum = Cxp14ReleaseEvidence.WORKLOAD_PROFILES.DECLARED_MAXIMUM;
  assert.equal(expected.totalRows, 20300);
  assert.equal(maximum.totalRows, 44500);
  assert.equal(expected.handled + expected.offered + expected.aht + expected.auxes + expected.staff, 20300);
  assert.equal(maximum.handled + maximum.offered + maximum.aht + maximum.auxes + maximum.staff, 44500);
});

// CXP14 evidence AC: only the complete bounded allowlist is accepted and persisted evidence is immutable.
test('performance evidence enforces an exact redacted shape', () => {
  const evidence = Cxp14ReleaseEvidence.buildPerformanceRun(validPerformanceRun());
  assert.deepEqual(Object.keys(evidence).sort(), Cxp14ReleaseEvidence.PERFORMANCE_KEYS.slice().sort());
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.rowCounts), true);
  assert.equal(JSON.stringify(evidence).includes('@example.test'), false);

  assert.throws(
    () => Cxp14ReleaseEvidence.buildPerformanceRun({
      ...validPerformanceRun(),
      email: 'operator@example.test',
    }),
    { code: 'CXP14_RELEASE_EVIDENCE_INVALID' },
  );
  assert.throws(
    () => Cxp14ReleaseEvidence.buildPerformanceRun({
      ...validPerformanceRun(),
      sourceRows: [['personal-value']],
    }),
    { code: 'CXP14_RELEASE_EVIDENCE_INVALID' },
  );
  assert.throws(
    () => Cxp14ReleaseEvidence.buildPerformanceRun(validPerformanceRun({
      releaseVersion: 'operator@example.test',
    })),
    { code: 'CXP14_RELEASE_EVIDENCE_INVALID' },
  );
});

// CXP14 evidence AC: counts/durations are finite non-negative bounded integers and totals reconcile.
test('performance evidence rejects numeric boundary and aggregation defects', () => {
  const invalidRecords = [
    validPerformanceRun({ durationMs: -1 }),
    validPerformanceRun({ maxStepDurationMs: 1.5 }),
    validPerformanceRun({ contentionCount: Number.POSITIVE_INFINITY }),
    validPerformanceRun({
      serviceCallCounts: { ...validPerformanceRun().serviceCallCounts, spreadsheet: 1000000001 },
    }),
    validPerformanceRun({
      rowCounts: { ...validPerformanceRun().rowCounts, total: 20299 },
    }),
    validPerformanceRun({
      rowCounts: {
        ...validPerformanceRun().rowCounts,
        handled: 4999,
        staff: 301,
      },
    }),
    validPerformanceRun({ cumulativeActiveMs: 999 }),
    validPerformanceRun({ schedulerInclusiveMs: 1199 }),
    validPerformanceRun({ healthResult: 'UNHEALTHY' }),
  ];
  invalidRecords.forEach((record) => {
    assert.throws(
      () => Cxp14ReleaseEvidence.validatePerformanceRun(record),
      { code: 'CXP14_RELEASE_EVIDENCE_INVALID' },
    );
  });
});

// CXP14 boundary AC: 240s is the blocking objective and 270s remains the absolute hard failure.
test('invocation objective and hard boundaries are exact', () => {
  const base = {
    noQuotaFailure: true,
    noTimeout: true,
    profile: 'EXPECTED_PEAK',
    schedulerInclusiveMs: 1200000,
  };
  const objectivePass = Cxp14ReleaseEvidence.evaluateTiming({ ...base, maxInvocationMs: 239999 });
  const objectiveFail = Cxp14ReleaseEvidence.evaluateTiming({ ...base, maxInvocationMs: 240000 });
  const hardPass = Cxp14ReleaseEvidence.evaluateTiming({ ...base, maxInvocationMs: 269999 });
  const hardFail = Cxp14ReleaseEvidence.evaluateTiming({ ...base, maxInvocationMs: 270000 });

  assert.equal(objectivePass.objectiveMet, true);
  assert.equal(objectivePass.pass, true);
  assert.equal(objectiveFail.objectiveMet, false);
  assert.equal(objectiveFail.pass, false);
  assert.equal(hardPass.hardBoundaryMet, true);
  assert.equal(hardFail.hardBoundaryMet, false);
  assert.equal(hardFail.pass, false);
});

// CXP14 boundary AC: scheduler-inclusive windows are separate from per-invocation duration.
test('scheduler-inclusive windows accept equality and reject one millisecond over', () => {
  const evaluate = (profile, schedulerInclusiveMs) => Cxp14ReleaseEvidence.evaluateTiming({
    maxInvocationMs: 239999,
    noQuotaFailure: true,
    noTimeout: true,
    profile,
    schedulerInclusiveMs,
  });
  assert.equal(evaluate('EXPECTED_PEAK', 1200000).windowMet, true);
  assert.equal(evaluate('EXPECTED_PEAK', 1200001).windowMet, false);
  assert.equal(evaluate('DECLARED_MAXIMUM', 1800000).windowMet, true);
  assert.equal(evaluate('DECLARED_MAXIMUM', 1800001).windowMet, false);
});

// CXP14 boundary AC: setup/worker handoff retains both the 60s reserve and 15s margin.
test('another boundary step is refused at the exact cooperative handoff threshold', () => {
  assert.equal(Cxp14ReleaseEvidence.canStartAnotherStep(194999, 0), true);
  assert.equal(Cxp14ReleaseEvidence.canStartAnotherStep(195000, 0), false);
  assert.equal(Cxp14ReleaseEvidence.canStartAnotherStep(0, -1), false);
});

// CXP14 performance AC: remote calls may be constant/chunk-bounded, never proportional to rows.
test('service-call scaling rejects one remote call per additional source row', () => {
  const calls = {
    drive: 5,
    flush: 2,
    lock: 4,
    properties: 12,
    spreadsheet: 20,
    trigger: 3,
  };
  assert.equal(Cxp14ReleaseEvidence.rowScalingBounded(
    { chunkCount: 5, serviceCallCounts: calls, totalRows: 20300 },
    { chunkCount: 7, serviceCallCounts: { ...calls, spreadsheet: 22 }, totalRows: 44500 },
  ), true);
  assert.equal(Cxp14ReleaseEvidence.rowScalingBounded(
    { chunkCount: 5, serviceCallCounts: { ...calls, spreadsheet: 200 }, totalRows: 20300 },
    { chunkCount: 6, serviceCallCounts: { ...calls, spreadsheet: 220 }, totalRows: 44500 },
  ), true);
  assert.equal(Cxp14ReleaseEvidence.rowScalingBounded(
    { chunkCount: 5, serviceCallCounts: calls, totalRows: 20300 },
    {
      chunkCount: 7,
      serviceCallCounts: { ...calls, spreadsheet: calls.spreadsheet + (44500 - 20300) },
      totalRows: 44500,
    },
  ), false);
  const perRun = Cxp14ReleaseEvidence.expectedPeakCallsBounded(calls, 5);
  assert.equal(perRun.pass, true);
  assert.deepEqual(perRun.bounds, {
    drive: 45,
    flush: 15,
    lock: 45,
    properties: 160,
    spreadsheet: 300,
    trigger: 45,
  });
  assert.equal(Object.isFrozen(Cxp14ReleaseEvidence.EXPECTED_PEAK_CALL_BOUNDS), true);
  assert.equal(Object.isFrozen(Cxp14ReleaseEvidence.EXPECTED_PEAK_CALL_BOUNDS.spreadsheet), true);
});

// CXP14 promotion AC: every missing or failed predicate is named without leaking evidence.
test('promotion fails closed with a deterministic missing-gate list', () => {
  const blocked = Cxp14ReleaseEvidence.evaluatePromotion(validUatEvidence({
    finalParity: false,
    permissionsVerified: false,
    prodAcknowledged: false,
  }));
  assert.equal(blocked.promotionReady, false);
  assert.deepEqual(blocked.missing, ['finalParity', 'permissionsVerified', 'prodAcknowledged']);

  const ready = Cxp14ReleaseEvidence.evaluatePromotion(validUatEvidence());
  assert.equal(ready.pass, true);
  assert.equal(ready.promotionReady, true);
  assert.deepEqual(ready.missing, []);
  assert.equal(Object.isFrozen(ready.missing), true);
});

// CXP14 hosted evidence AC: strict patches accumulate while release identity remains immutable.
test('UAT evidence records progressive gates without erasing prior observations', () => {
  const properties = propertyStore();
  const configuration = { environment: 'UAT' };
  const identity = {
    contractVersion: Cxp14ReleaseEvidence.CONTRACT_VERSION,
    releaseVersion: 'CXP-14-v1',
    sourceBundleDigest: 'b'.repeat(64),
  };

  Cxp14Uat.recordEvidence({ configuration, properties }, { ...identity, prerequisites: true });
  Cxp14Uat.recordEvidence({ configuration, properties }, { setup: true });
  const recorded = Cxp14Uat.readEvidence({ configuration, properties });
  assert.deepEqual(recorded, { ...identity, prerequisites: true, setup: true });

  const blocked = Cxp14Uat.step08({ configuration, properties });
  assert.equal(blocked.pass, false);
  assert.equal(blocked.missing.includes('expectedPeak'), true);
  assert.equal(blocked.missing.includes('prerequisites'), false);
  assert.throws(
    () => Cxp14Uat.recordEvidence(
      { configuration, properties },
      { releaseVersion: 'CXP-14-v2' },
    ),
    { code: 'CXP14_UAT_EVIDENCE_IDENTITY_MISMATCH' },
  );
  assert.throws(
    () => Cxp14Uat.recordEvidence(
      { configuration, properties: propertyStore() },
      { prerequisites: true },
    ),
    { code: 'CXP14_UAT_EVIDENCE_IDENTITY_REQUIRED' },
  );
});

// CXP14 setup AC: a bounded invocation checkpoints, keeps one successor, resumes, and is idempotent.
test('versioned setup progresses by durable cursor and does not replay completed steps', () => {
  const properties = propertyStore();
  const { scriptApp, triggers } = fakeTriggers();
  const executed = [];
  let now = Date.parse('2026-09-07T01:00:00.000Z');
  const overrides = {
    clock: { now: () => new Date(now += 1000) },
    maxStepsPerInvocation: 1,
    properties,
    scriptApp,
    stepRunner(step) { executed.push(step); },
  };

  let status = Cxp14Setup.initialize(overrides);
  assert.equal(status.version, 1);
  assert.equal(status.status, 'RUNNING');
  assert.equal(status.nextStep, 1);
  assert.equal(triggers.length, 1);

  while (status.status === 'RUNNING') status = Cxp14Setup.continueSetup(overrides);
  assert.equal(status.status, 'COMPLETE');
  assert.equal(status.nextStep, Cxp14Setup.STEPS.length);
  assert.deepEqual(executed, Cxp14Setup.STEPS);
  assert.equal(triggers.length, 0);

  const replay = Cxp14Setup.initialize(overrides);
  assert.equal(replay.status, 'COMPLETE');
  assert.deepEqual(executed, Cxp14Setup.STEPS);
  assert.equal(Cxp14Setup.getStatus({ properties }).status, 'COMPLETE');
});

// CXP14 setup negative/recovery AC: stale state fails closed and active work cannot be reset.
test('setup rejects malformed or unknown state and refuses reset while RUNNING', () => {
  const malformed = propertyStore({ [Cxp14Setup.STATE_KEY]: '{not-json' });
  assert.throws(
    () => Cxp14Setup.getStatus({ properties: malformed }),
    { code: 'CXP14_SETUP_STATE_INVALID' },
  );

  const unknownVersion = propertyStore({
    [Cxp14Setup.STATE_KEY]: JSON.stringify({
      completedAtUtc: null,
      errorCode: null,
      nextStep: 0,
      startedAtUtc: '2026-09-07T01:00:00.000Z',
      status: 'RUNNING',
      stepCount: Cxp14Setup.STEPS.length,
      updatedAtUtc: '2026-09-07T01:00:00.000Z',
      version: 2,
    }),
  });
  assert.throws(
    () => Cxp14Setup.getStatus({ properties: unknownVersion }),
    { code: 'CXP14_SETUP_STATE_INVALID' },
  );

  const running = propertyStore();
  Cxp14Setup.initialize({
    maxStepsPerInvocation: 1,
    properties: running,
    stepRunner() {},
  });
  assert.throws(
    () => Cxp14Setup.reset({ properties: running }),
    { code: 'CXP14_SETUP_RESET_REFUSED' },
  );
});

// CXP14 access AC: every hosted UAT step fails before work when pointed at PROD.
test('all Step00-08 UAT helpers refuse PROD', () => {
  const properties = propertyStore();
  for (let step = 0; step <= 8; step += 1) {
    assert.throws(
      () => Cxp14Uat[`step0${step}`]({
        configuration: { environment: 'PROD' },
        properties,
      }),
      { code: 'CXP14_PROD_FORBIDDEN' },
    );
  }
  assert.equal(properties.getProperty(Cxp14Uat.EVIDENCE_KEY), null);
  assert.equal(properties.getProperty(Cxp14Setup.STATE_KEY), null);
});

// Defect caught: Step 01 treated the incremental UAT evidence store as a complete promotion record.
test('Step01 accepts identity-plus-prerequisites evidence before later gates exist', () => {
  const properties = propertyStore();
  const configuration = { environment: 'UAT' };
  Cxp14Uat.recordEvidence({ configuration, properties }, {
    contractVersion: Cxp14ReleaseEvidence.CONTRACT_VERSION,
    prerequisites: true,
    releaseVersion: 'CXP-14-v1',
    sourceBundleDigest: 'b'.repeat(64),
  });

  const step00 = Cxp14Uat.step00({
    checks: { prerequisites: () => true },
    configuration,
    properties,
  });
  assert.equal(step00.pass, true);

  const step01 = Cxp14Uat.step01({ configuration, properties });
  assert.equal(step01.pass, true);
  assert.equal(step01.setupStatus, 'COMPLETE');
  assert.equal(JSON.parse(properties.getProperty(Cxp14Uat.EVIDENCE_KEY)).setup, true);

  const unexpected = propertyStore({
    [Cxp14Uat.EVIDENCE_KEY]: JSON.stringify({
      contractVersion: Cxp14ReleaseEvidence.CONTRACT_VERSION,
      email: 'operator@example.test',
      prerequisites: true,
      releaseVersion: 'CXP-14-v1',
      sourceBundleDigest: 'b'.repeat(64),
    }),
  });
  assert.throws(
    () => Cxp14Uat.step01({ configuration, properties: unexpected }),
    { code: 'CXP14_UAT_EVIDENCE_INVALID' },
  );
});

// CXP14 UAT AC: validated evidence supports the ordered Step00-08 release-gate succession.
test('Step00-08 reconcile validated evidence in order and finish promotion-ready', () => {
  const properties = propertyStore();
  const configuration = { environment: 'UAT' };
  const evidence = validUatEvidence();
  Cxp14Uat.recordEvidence({ configuration, properties }, evidence);
  for (let index = 0; index < 3; index += 1) {
    Cxp14Uat.recordExpectedPeakRun(
      { configuration, properties },
      expectedPeakSubmission(index),
    );
  }

  const common = {
    checks: {
      criticalPaths: () => true,
      declaredMaximum: () => true,
      expectedPeak: () => true,
      failureRecovery: () => true,
      finalParity: () => true,
      lifecycleStatus: () => true,
      prerequisites: () => true,
    },
    configuration,
    properties,
  };
  const results = [
    Cxp14Uat.step00(common),
    Cxp14Uat.step01(common),
    Cxp14Uat.step02(common),
    Cxp14Uat.step03(common),
    Cxp14Uat.step04(common),
    Cxp14Uat.step05(common),
    Cxp14Uat.step06(common),
    Cxp14Uat.step07(common),
    Cxp14Uat.step08(common),
  ];

  assert.deepEqual(
    results.map((result) => result.step),
    [
      'CXP14UatStep00VerifyPrerequisites',
      'CXP14UatStep01InstallReleaseReadiness',
      'CXP14UatStep02InspectCriticalPaths',
      'CXP14UatStep03BenchmarkExpectedPeak',
      'CXP14UatStep04StressDeclaredMaximum',
      'CXP14UatStep05VerifyFailureRecovery',
      'CXP14UatStep06VerifyLifecycleAndStatus',
      'CXP14UatStep07RunFinalParityAndValidation',
      'CXP14UatStep08PromotionGate',
    ],
  );
  assert.equal(results.every((result) => result.pass === true), true);
  assert.equal(results[8].promotionReady, true);
  assert.deepEqual(results[8].missing, []);
  assert.deepEqual(Cxp14Uat.readEvidence({ configuration, properties }), evidence);
});

// CXP14 orchestration regression: long work queues once and returns without editor-side polling.
test('performance helper stays NOT_RECORDED until three validated durable runs exist', () => {
  const properties = propertyStore();
  const configuration = { environment: 'UAT' };
  Cxp14Uat.recordEvidence(
    { configuration, properties },
    validUatEvidence({ expectedPeak: false }),
  );
  const result = Cxp14Uat.step03({
    configuration,
    properties,
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'NOT_RECORDED');
  assert.equal(result.recordedRunCount, 0);
  assert.equal(result.requiredRunCount, 3);
});

test('expected-peak repository requires three distinct successful bounded runs and is idempotent', () => {
  const properties = propertyStore();
  const configuration = { environment: 'UAT' };
  const identity = {
    contractVersion: Cxp14ReleaseEvidence.CONTRACT_VERSION,
    releaseVersion: 'CXP-14-v1',
    sourceBundleDigest: 'b'.repeat(64),
  };
  Cxp14Uat.recordEvidence({ configuration, properties }, { ...identity, prerequisites: true });

  const first = Cxp14Uat.recordExpectedPeakRun(
    { configuration, properties },
    expectedPeakSubmission(0),
  );
  assert.equal(first.status, 'NOT_RECORDED');
  assert.equal(first.recordedRunCount, 1);
  const replay = Cxp14Uat.recordExpectedPeakRun(
    { configuration, properties },
    expectedPeakSubmission(0),
  );
  assert.equal(replay.idempotent, true);
  assert.equal(replay.recordedRunCount, 1);

  Cxp14Uat.recordExpectedPeakRun({ configuration, properties }, expectedPeakSubmission(1));
  const third = Cxp14Uat.recordExpectedPeakRun(
    { configuration, properties },
    expectedPeakSubmission(2),
  );
  assert.equal(third.status, 'COMPLETE');
  assert.equal(third.recordedRunCount, 3);

  const gate = Cxp14Uat.step03({ configuration, properties });
  assert.equal(gate.pass, true);
  assert.equal(gate.status, 'COMPLETE');
  assert.equal(JSON.parse(properties.getProperty(Cxp14Uat.EVIDENCE_KEY)).expectedPeak, true);
  const stored = properties.getProperty(Cxp14ExpectedPeakRepository.STATE_KEY);
  assert.equal(stored.includes('runId'), false);
  assert.equal(stored.includes('filename'), false);
  assert.equal(stored.includes('sourceRows'), false);
});

test('expected-peak repository rejects failed, stale-release, and unbounded call evidence', () => {
  const properties = propertyStore();
  const repository = Cxp14ExpectedPeakRepository.create(properties);
  const identity = {
    contractVersion: Cxp14ReleaseEvidence.CONTRACT_VERSION,
    releaseVersion: 'CXP-14-v1',
    sourceBundleDigest: 'b'.repeat(64),
  };
  const rowProportionalCalls = Object.fromEntries(
    Cxp14ReleaseEvidence.CALL_KEYS.map((key) => [key, 20300]),
  );
  assert.equal(
    Cxp14ReleaseEvidence.expectedPeakCallsBounded(rowProportionalCalls, 5).pass,
    false,
  );
  assert.throws(
    () => repository.record(identity, expectedPeakSubmission(0, {
      record: validPerformanceRun({ serviceCallCounts: rowProportionalCalls }),
    })),
    { code: 'CXP14_EXPECTED_PEAK_EVIDENCE_INVALID' },
  );
  assert.equal(properties.getProperty(Cxp14ExpectedPeakRepository.STATE_KEY), null);
  assert.throws(
    () => repository.record(identity, expectedPeakSubmission(0, {
      record: validPerformanceRun({
        auditState: 'MISSING',
        healthResult: 'UNHEALTHY',
        phase: 'COMPLETE',
        sourceBundleDigest: 'a'.repeat(64),
        terminalRunState: 'FAILED_INGESTION',
      }),
    })),
    { code: 'CXP14_EXPECTED_PEAK_EVIDENCE_INVALID' },
  );
  assert.throws(
    () => repository.record(identity, expectedPeakSubmission(0, {
      record: validPerformanceRun({ releaseVersion: 'CXP-14-old' }),
    })),
    { code: 'CXP14_EXPECTED_PEAK_IDENTITY_MISMATCH' },
  );
  repository.record(identity, expectedPeakSubmission(0));
  assert.throws(
    () => repository.record({ ...identity, releaseVersion: 'CXP-14-old' }, expectedPeakSubmission(1)),
    { code: 'CXP14_EXPECTED_PEAK_IDENTITY_MISMATCH' },
  );
  repository.record(identity, expectedPeakSubmission(1));
  repository.record(identity, expectedPeakSubmission(2, {
    record: validPerformanceRun({
      serviceCallCounts: {
        ...validPerformanceRun().serviceCallCounts,
        spreadsheet: 21,
      },
      sourceBundleDigest: 'd'.repeat(64),
    }),
  }));
  const result = repository.reconcile(identity);
  assert.equal(result.status, 'NOT_RECORDED');
  assert.deepEqual(result.missing, ['expectedPeakServiceCallScaling']);
});

// CXP14 predecessor-practice AC: Apps Script setup and zero-padded UAT helpers stay parameterless.
test('versioned setup and Step00-08 parameterless editor entrypoints remain declared', () => {
  const setupSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'Cxp14Setup.js'),
    'utf8',
  );
  const uatSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'Cxp14UatEntrypoints.js'),
    'utf8',
  );
  [
    'initializeCxp14ReleaseReadiness',
    'continueCxp14ReleaseReadinessSetup',
    'getCxp14ReleaseReadinessSetupStatus',
    'resetCxp14ReleaseReadinessSetupState',
    'diagnoseCxp14RunbookChecks',
  ].forEach((name) => assert.match(setupSource, new RegExp(`function ${name}\\(\\)`)));
  for (let step = 0; step <= 8; step += 1) {
    assert.match(uatSource, new RegExp(`function CXP14UatStep0${step}[^\\(]*\\(\\)`));
  }
  assert.match(uatSource, /function recordCxp14UatEvidence\(\)/);
  assert.match(uatSource, /function recordCxp14ExpectedPeakRun\(\)/);
  assert.match(uatSource, /function acknowledgeCxp14Production\(\)/);
});
