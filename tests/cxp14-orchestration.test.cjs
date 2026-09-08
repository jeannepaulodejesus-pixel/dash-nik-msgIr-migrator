const assert = require('node:assert/strict');
const test = require('node:test');

const Cxp13IngestionTelemetry = require('../src/ingestion/Cxp13IngestionTelemetry.js');
const Cxp14ExpectedPeakRepository = require('../src/release/Cxp14ExpectedPeakRepository.js');
const Cxp14ReleaseEvidence = require('../src/release/Cxp14ReleaseEvidence.js');
const Cxp14RunTelemetry = require('../src/release/Cxp14RunTelemetry.js');
const Cxp14Uat = require('../src/main/Cxp14UatEntrypoints.js');
const Cxp14UatOrchestrator = require('../src/main/Cxp14UatOrchestrator.js');
const FileLedgerRepository = require('../src/repository/FileLedgerRepository.js');

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

function telemetryBag(overrides = {}) {
  const bag = Cxp13IngestionTelemetry.empty('token');
  Object.assign(bag, {
    chunkCount: 5,
    continuationCount: 1,
    invocations: [
      {
        durationMs: 400,
        endedAtUtc: '2026-09-07T01:00:00.400Z',
        startedAtUtc: '2026-09-07T01:00:00.000Z',
      },
      {
        durationMs: 600,
        endedAtUtc: '2026-09-07T01:00:01.000Z',
        startedAtUtc: '2026-09-07T01:00:00.400Z',
      },
    ],
    packagingKind: 'combined',
    phaseDurations: {
      backup: 100,
      cleanup: 100,
      commit: 200,
      healthReadback: 100,
      parity: 100,
      preparation: 200,
      recalculation: 100,
      rollback: 0,
    },
    rowCounts: {
      aht: 7000,
      auxes: 3000,
      handled: 5000,
      offered: 5000,
      staff: 300,
      total: 20300,
    },
    serviceCallCounts: {
      drive: 5,
      flush: 2,
      lock: 4,
      properties: 12,
      spreadsheet: 20,
      trigger: 3,
    },
    sourceBundleDigest: 'a'.repeat(64),
    timedOut: false,
    ...overrides,
  });
  return bag;
}

test('Step00 records release identity from Script Properties without pending JSON', () => {
  const properties = propertyStore({
    [Cxp14UatOrchestrator.RELEASE_VERSION_KEY]: 'CXP-14-v1',
    [Cxp14UatOrchestrator.SOURCE_BUNDLE_DIGEST_KEY]: 'b'.repeat(64),
  });
  const result = Cxp14Uat.step00({
    checks: { prerequisites: () => true },
    configuration: { environment: 'UAT' },
    properties,
  });
  assert.equal(result.pass, true);
  const evidence = Cxp14Uat.readEvidence({ configuration: { environment: 'UAT' }, properties });
  assert.equal(evidence.contractVersion, Cxp14ReleaseEvidence.CONTRACT_VERSION);
  assert.equal(evidence.releaseVersion, 'CXP-14-v1');
  assert.equal(evidence.sourceBundleDigest, 'b'.repeat(64));
  assert.equal(evidence.prerequisites, true);
  assert.equal(properties.getProperty(Cxp14Uat.PENDING_EVIDENCE_KEY), null);
});

test('Step00 names config and predecessor gaps instead of a blank prerequisites miss', () => {
  const properties = propertyStore({
    [Cxp14UatOrchestrator.RELEASE_VERSION_KEY]: 'CXP-14-v1',
    [Cxp14UatOrchestrator.SOURCE_BUNDLE_DIGEST_KEY]: 'b'.repeat(64),
  });
  const result = Cxp14Uat.step00({
    configuration: { environment: 'UAT' },
    predecessors: {
      cxp11: { getSetupStatus: () => ({ status: 'IDLE' }) },
      cxp12: {
        getSetupStatus: () => ({ status: 'COMPLETE' }),
        step03: () => ({ pass: false }),
      },
      cxp13: { getSetupStatus: () => ({ status: 'IDLE' }) },
    },
    properties,
  });
  assert.equal(result.pass, false);
  assert.ok(result.missing.includes('rtaAllowedDomain'));
  assert.ok(result.missing.includes('cxp11Setup'));
  assert.ok(result.missing.includes('cxp12ActiveWeek'));
  assert.equal(result.missing.includes('prerequisites'), false);
});

test('Step00 initializes CXP-11 and aligns CXP-12 then records prerequisites', () => {
  const properties = propertyStore({
    [Cxp14UatOrchestrator.RELEASE_VERSION_KEY]: 'CXP-14-v1',
    [Cxp14UatOrchestrator.SOURCE_BUNDLE_DIGEST_KEY]: 'b'.repeat(64),
  });
  let cxp11 = 'IDLE';
  const result = Cxp14Uat.step00({
    configuration: {
      controlSpreadsheetId: 'control',
      driveInboxFolderId: 'inbox',
      environment: 'UAT',
      rtaAllowedDomain: 'example.test',
      targetSpreadsheetId: 'target',
    },
    predecessors: {
      cxp11: {
        getSetupStatus: () => ({ status: cxp11 }),
        initialize: () => {
          cxp11 = 'COMPLETE';
          return { status: 'COMPLETE' };
        },
      },
      cxp12: {
        getSetupStatus: () => ({ status: 'COMPLETE' }),
        step02: () => ({ pass: true }),
        step03: () => ({ pass: true }),
      },
      cxp13: { getSetupStatus: () => ({ status: 'IDLE' }) },
    },
    properties,
  });
  assert.equal(result.pass, true);
  assert.deepEqual(result.missing, []);
  assert.equal(cxp11, 'COMPLETE');
});

test('Step03 queues while CXP-13 is in flight and records from SUCCESS telemetry', () => {
  const properties = propertyStore();
  const configuration = { environment: 'UAT' };
  const identity = {
    contractVersion: Cxp14ReleaseEvidence.CONTRACT_VERSION,
    releaseVersion: 'CXP-14-v1',
    sourceBundleDigest: 'b'.repeat(64),
  };
  Cxp14Uat.recordEvidence({ configuration, properties }, { ...identity, prerequisites: true });
  properties.setProperty(Cxp13IngestionTelemetry.KEY, JSON.stringify(telemetryBag()));

  const queued = Cxp14Uat.step03({
    configuration,
    predecessors: {
      cxp13: {
        getIntakeStatus: () => ({ status: 'QUEUED' }),
        getRunStatus: () => ({ status: 'QUEUED' }),
      },
    },
    properties,
  });
  assert.equal(queued.pass, false);
  assert.equal(queued.status, 'QUEUED');
  assert.equal(queued.nextAction, Cxp14UatOrchestrator.NEXT_ACTION);
  assert.equal(properties.getProperty(Cxp14ExpectedPeakRepository.STATE_KEY), null);

  const recorded = Cxp14Uat.step03({
    configuration,
    predecessors: {
      cxp13: {
        getIntakeStatus: () => ({ status: 'SUCCESS', packagingKind: 'combined' }),
        getRunStatus: () => ({
          endedAtUtc: '2026-09-07T01:00:01.000Z',
          health: { healthy: true },
          packagingKind: 'combined',
          startedAtUtc: '2026-09-07T01:00:00.000Z',
          status: 'SUCCESS',
        }),
      },
    },
    properties,
  });
  assert.equal(recorded.recordedRunCount, 1);
  assert.equal(recorded.status, 'NOT_RECORDED');
  const stored = JSON.parse(properties.getProperty(Cxp14ExpectedPeakRepository.STATE_KEY));
  assert.equal(stored.runs.length, 1);
  assert.equal(stored.runs[0].record.sourceBundleDigest, 'a'.repeat(64));
  assert.equal(stored.releaseDigest, 'b'.repeat(64));
});

test('timeout telemetry is refused by harvest and does not count as a peak run', () => {
  const harvested = Cxp14RunTelemetry.harvest({
    healthResult: 'HEALTHY',
    identity: {
      contractVersion: Cxp14ReleaseEvidence.CONTRACT_VERSION,
      releaseVersion: 'CXP-14-v1',
    },
    profile: 'EXPECTED_PEAK',
    telemetry: telemetryBag({
      invocations: [
        {
          durationMs: 360927,
          endedAtUtc: '2026-09-08T04:10:00.000Z',
          startedAtUtc: '2026-09-08T04:03:59.073Z',
        },
      ],
      timedOut: true,
    }),
  });
  assert.equal(harvested.eligible, false);
  assert.equal(harvested.missing.includes('noTimeout'), true);
  assert.equal(harvested.submission, null);

  const properties = propertyStore();
  const configuration = { environment: 'UAT' };
  Cxp14Uat.recordEvidence({ configuration, properties }, {
    contractVersion: Cxp14ReleaseEvidence.CONTRACT_VERSION,
    prerequisites: true,
    releaseVersion: 'CXP-14-v1',
    sourceBundleDigest: 'b'.repeat(64),
  });
  properties.setProperty(Cxp13IngestionTelemetry.KEY, JSON.stringify(telemetryBag({
    invocations: [
      {
        durationMs: 360927,
        endedAtUtc: '2026-09-08T04:10:00.000Z',
        startedAtUtc: '2026-09-08T04:03:59.073Z',
      },
    ],
    timedOut: true,
  })));
  const result = Cxp14Uat.step03({
    configuration,
    predecessors: {
      cxp13: {
        getIntakeStatus: () => ({ status: 'SUCCESS' }),
        getRunStatus: () => ({
          endedAtUtc: '2026-09-08T04:10:00.000Z',
          health: { healthy: true },
          startedAtUtc: '2026-09-08T04:03:59.073Z',
          status: 'SUCCESS',
        }),
      },
    },
    properties,
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'NOT_RECORDED');
  assert.equal(properties.getProperty(Cxp14ExpectedPeakRepository.STATE_KEY), null);
});

test('telemetry harvest emits exact submission keys and strips runId and filenames', () => {
  const harvested = Cxp14RunTelemetry.harvest({
    filenames: ['peak-a.xlsx'],
    healthResult: 'HEALTHY',
    identity: {
      contractVersion: Cxp14ReleaseEvidence.CONTRACT_VERSION,
      releaseVersion: 'CXP-14-v1',
    },
    profile: 'EXPECTED_PEAK',
    runId: 'cxp13-secret-run',
    status: 'SUCCESS',
    telemetry: telemetryBag({ runId: 'cxp13-secret-run', filenames: ['peak-a.xlsx'] }),
  });
  assert.equal(harvested.eligible, true);
  assert.deepEqual(Object.keys(harvested.submission).sort(), Cxp14ExpectedPeakRepository.SUBMISSION_KEYS.slice().sort());
  assert.deepEqual(
    Object.keys(harvested.submission.record).sort(),
    Cxp14ReleaseEvidence.PERFORMANCE_KEYS.slice().sort(),
  );
  assert.equal(JSON.stringify(harvested.submission).includes('cxp13-secret-run'), false);
  assert.equal(JSON.stringify(harvested.submission).includes('peak-a.xlsx'), false);
  assert.equal(harvested.submission.record.sourceBundleDigest, 'a'.repeat(64));
});

test('Step08 stays blocked on prodAcknowledged until acknowledgeCxp14Production', () => {
  const properties = propertyStore();
  const configuration = { environment: 'UAT' };
  const evidence = validUatEvidence({ prodAcknowledged: false });
  Cxp14Uat.recordEvidence({ configuration, properties }, evidence);
  for (let index = 0; index < 3; index += 1) {
    Cxp14Uat.recordExpectedPeakRun({ configuration, properties }, expectedPeakSubmission(index));
  }
  const blocked = Cxp14Uat.step08({
    checks: {
      deploymentChecklistComplete: () => true,
      permissionsVerified: () => true,
      rollbackRehearsed: () => true,
    },
    configuration,
    properties,
  });
  assert.equal(blocked.pass, false);
  assert.deepEqual(blocked.missing, ['prodAcknowledged']);
  const ack = Cxp14Uat.acknowledgeProduction({ configuration, properties });
  assert.equal(ack.recorded, true);
  const ready = Cxp14Uat.step08({
    checks: {
      deploymentChecklistComplete: () => true,
      permissionsVerified: () => true,
      rollbackRehearsed: () => true,
    },
    configuration,
    properties,
  });
  assert.equal(ready.promotionReady, true);
  assert.deepEqual(ready.missing, []);
});

test('declared-maximum repository completes after one distinct bounded SUCCESS run', () => {
  const properties = propertyStore();
  const repository = Cxp14ExpectedPeakRepository.create(properties, { profile: 'DECLARED_MAXIMUM' });
  const identity = {
    contractVersion: Cxp14ReleaseEvidence.CONTRACT_VERSION,
    releaseVersion: 'CXP-14-v1',
    sourceBundleDigest: 'b'.repeat(64),
  };
  const result = repository.record(identity, {
    chunkCount: 8,
    maxInvocationMs: 239999,
    noQuotaFailure: true,
    noTimeout: true,
    record: validPerformanceRun({
      profile: 'DECLARED_MAXIMUM',
      rowCounts: {
        aht: 15000,
        auxes: 7500,
        handled: 10000,
        offered: 10000,
        staff: 2000,
        total: 44500,
      },
      schedulerInclusiveMs: 1800000,
      sourceBundleDigest: 'e'.repeat(64),
    }),
  });
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.recordedRunCount, 1);
  assert.equal(result.requiredRunCount, 1);
  assert.equal(properties.getProperty(Cxp14ExpectedPeakRepository.STATE_KEY), null);
  assert.ok(properties.getProperty(Cxp14ExpectedPeakRepository.DECLARED_MAXIMUM_STATE_KEY));
});

test('FILE_LEDGER latest SUCCESS is the newest matching row', () => {
  const rows = [
    FileLedgerRepository.HEADERS.slice(),
    ['sha256:' + '1'.repeat(64), 'SHA-256', 'FAILED', 'run-1', '', '2026-09-07T01:00:00.000Z', '1.0.0', '[]', '[]', '[]'],
    ['sha256:' + '2'.repeat(64), 'SHA-256', 'SUCCESS', 'run-2', '', '2026-09-07T02:00:00.000Z', '1.0.0', '[]', '[]', '[]'],
    ['sha256:' + '3'.repeat(64), 'SHA-256', 'SUCCESS', 'run-3', '', '2026-09-07T03:00:00.000Z', '1.0.0', '[]', '[]', '[]'],
  ];
  const spreadsheet = {
    getSheetByName() {
      return {
        getLastRow: () => rows.length,
        getRange(row, _column, numRows) {
          return {
            getValues() { return rows.slice(row - 1, row - 1 + numRows); },
            setValues() {},
          };
        },
      };
    },
  };
  const latest = FileLedgerRepository.create(spreadsheet).findLatestSuccess();
  assert.equal(latest.runId, 'run-3');
  assert.equal(Cxp14RunTelemetry.digestFromFingerprint(latest.fingerprint), '3'.repeat(64));
});

function fakeFolder(label) {
  return ('folder' + label + 'xxxxxxxxxxxxxxxxxxxx').slice(0, 28);
}

function testFixtureCatalog() {
  const Cxp14UatFixtureFolders = require('../src/release/Cxp14UatFixtureFolders.js');
  const negatives = {};
  Cxp14UatFixtureFolders.NEGATIVE_SLOTS.forEach((slot, index) => {
    negatives[slot] = fakeFolder('n' + String(index).padStart(2, '0'));
  });
  return {
    declaredMaximum: fakeFolder('max'),
    expectedPeak1: fakeFolder('p1'),
    expectedPeak2: fakeFolder('p2'),
    expectedPeak3: fakeFolder('p3'),
    negatives,
    parityExport: fakeFolder('pe'),
    paritySource: fakeFolder('ps'),
    version: 1,
  };
}

test('configure writes the UAT fixture catalog and seeds empty inbox/parity keys', () => {
  const Cxp14UatFixtureFolders = require('../src/release/Cxp14UatFixtureFolders.js');
  const properties = propertyStore({ CXP_ENV: 'UAT' });
  const catalog = testFixtureCatalog();
  const result = Cxp14Uat.configureFixtureFolders({
    catalog,
    configuration: { environment: 'UAT' },
    properties,
  });
  assert.equal(result.pass, true);
  assert.equal(result.configured, true);
  assert.equal(properties.getProperty('CXP_UAT_DRIVE_INBOX_FOLDER_ID'), catalog.expectedPeak1);
  assert.equal(properties.getProperty('CXP_UAT_LEGACY_PARITY_EXPORT_FOLDER_ID'), catalog.parityExport);
  const stored = Cxp14UatFixtureFolders.load(properties);
  assert.equal(stored.expectedPeak2, catalog.expectedPeak2);
  assert.equal(stored.negatives['missing-header'], catalog.negatives['missing-header']);
  assert.equal(Cxp14Uat.EVIDENCE_KEY in properties.values, false);
});

test('Step03 retargets the UAT inbox to the next unused expected-peak folder', () => {
  const properties = propertyStore({ CXP_ENV: 'UAT' });
  const configuration = { environment: 'UAT' };
  const catalog = testFixtureCatalog();
  Cxp14Uat.configureFixtureFolders({ catalog, configuration, properties });
  Cxp14Uat.recordEvidence({ configuration, properties }, {
    contractVersion: Cxp14ReleaseEvidence.CONTRACT_VERSION,
    prerequisites: true,
    releaseVersion: 'CXP-14-v1',
    sourceBundleDigest: 'b'.repeat(64),
  });
  const queued = Cxp14Uat.step03({
    configuration,
    predecessors: {
      cxp13: {
        getIntakeStatus: () => ({ status: 'QUEUED' }),
        getRunStatus: () => ({ status: 'IDLE' }),
      },
    },
    properties,
  });
  assert.equal(queued.status, 'QUEUED');
  assert.equal(queued.fixtureSlot, 'expectedPeak1');
  assert.equal(properties.getProperty('CXP_UAT_DRIVE_INBOX_FOLDER_ID'), catalog.expectedPeak1);

  Cxp14Uat.recordExpectedPeakRun({ configuration, properties }, expectedPeakSubmission(0));
  const second = Cxp14Uat.step03({
    configuration,
    predecessors: {
      cxp13: {
        getIntakeStatus: () => ({ status: 'READY' }),
        getRunStatus: () => ({ status: 'IDLE' }),
        start: () => ({ status: 'QUEUED' }),
      },
    },
    properties,
  });
  assert.equal(second.status, 'QUEUED');
  assert.equal(second.fixtureSlot, 'expectedPeak2');
  assert.equal(properties.getProperty('CXP_UAT_DRIVE_INBOX_FOLDER_ID'), catalog.expectedPeak2);
  assert.equal(JSON.stringify(Cxp14Uat.readEvidence({ configuration, properties })).includes(catalog.expectedPeak1), false);
});

test('Step03 does not retarget the inbox while a peak run is still queued', () => {
  const properties = propertyStore({ CXP_ENV: 'UAT' });
  const configuration = { environment: 'UAT' };
  const catalog = testFixtureCatalog();
  Cxp14Uat.configureFixtureFolders({ catalog, configuration, properties });
  properties.setProperty('CXP_UAT_DRIVE_INBOX_FOLDER_ID', catalog.expectedPeak1);
  Cxp14Uat.recordEvidence({ configuration, properties }, {
    contractVersion: Cxp14ReleaseEvidence.CONTRACT_VERSION,
    prerequisites: true,
    releaseVersion: 'CXP-14-v1',
    sourceBundleDigest: 'b'.repeat(64),
  });
  const queued = Cxp14Uat.step03({
    configuration,
    predecessors: {
      cxp13: {
        getIntakeStatus: () => ({ status: 'QUEUED' }),
        getRunStatus: () => ({ status: 'QUEUED' }),
      },
    },
    properties,
  });
  assert.equal(queued.status, 'QUEUED');
  assert.equal(properties.getProperty('CXP_UAT_DRIVE_INBOX_FOLDER_ID'), catalog.expectedPeak1);
});

test('Step05 records one matching negative observation per invocation', () => {
  const Cxp14UatFixtureFolders = require('../src/release/Cxp14UatFixtureFolders.js');
  const properties = propertyStore({ CXP_ENV: 'UAT' });
  const configuration = { environment: 'UAT' };
  const catalog = testFixtureCatalog();
  Cxp14Uat.configureFixtureFolders({ catalog, configuration, properties });
  Cxp14Uat.recordEvidence({ configuration, properties }, {
    contractVersion: Cxp14ReleaseEvidence.CONTRACT_VERSION,
    prerequisites: true,
    releaseVersion: 'CXP-14-v1',
    sourceBundleDigest: 'b'.repeat(64),
  });
  const firstSlot = Cxp14UatFixtureFolders.NEGATIVE_SLOTS[0];
  const result = Cxp14Uat.step05({
    configuration,
    predecessors: {
      cxp13: {
        getIntakeStatus: () => ({ status: 'DUPLICATE' }),
        getRunStatus: () => ({ status: 'DUPLICATE' }),
      },
    },
    properties,
  });
  assert.equal(result.pass, false);
  assert.equal(result.fixtureSlot, firstSlot);
  assert.equal(result.observedCount, 1);
  assert.equal(properties.getProperty('CXP_UAT_DRIVE_INBOX_FOLDER_ID'), catalog.negatives[firstSlot]);
  const progress = Cxp14UatFixtureFolders.loadNegativeProgress(properties);
  assert.equal(progress.lastOutcome, 'DUPLICATE');
  assert.equal(progress.lastSlot, firstSlot);
});

test('Step07 ingests parity source then starts CXP-11 with the export folder', () => {
  const properties = propertyStore({ CXP_ENV: 'UAT' });
  const configuration = { environment: 'UAT' };
  const catalog = testFixtureCatalog();
  Cxp14Uat.configureFixtureFolders({ catalog, configuration, properties });
  Cxp14Uat.recordEvidence({ configuration, properties }, {
    contractVersion: Cxp14ReleaseEvidence.CONTRACT_VERSION,
    prerequisites: true,
    releaseVersion: 'CXP-14-v1',
    sourceBundleDigest: 'b'.repeat(64),
  });
  let startedWith = 'unset';
  const queued = Cxp14Uat.step07({
    configuration,
    predecessors: {
      cxp11: {
        getParityStatus: () => ({ runState: 'IDLE' }),
        startParity: (folderId) => {
          startedWith = folderId;
          return { runState: 'QUEUED' };
        },
      },
      cxp13: {
        getIntakeStatus: () => ({ status: 'SUCCESS' }),
        getRunStatus: () => ({ status: 'SUCCESS' }),
      },
    },
    properties,
  });
  assert.equal(queued.status, 'QUEUED');
  assert.equal(queued.parityPhase, 'EXPORT');
  assert.equal(startedWith, catalog.parityExport);
  assert.equal(properties.getProperty('CXP_UAT_DRIVE_INBOX_FOLDER_ID'), catalog.paritySource);
  assert.equal(properties.getProperty('CXP_UAT_LEGACY_PARITY_EXPORT_FOLDER_ID'), catalog.parityExport);
});

test('default UAT fixture catalog has a valid Drive id for every slot', () => {
  const Cxp14UatFixtureFolders = require('../src/release/Cxp14UatFixtureFolders.js');
  const catalog = Cxp14UatFixtureFolders.defaultCatalog();
  assert.equal(Cxp14UatFixtureFolders.validFolderId(catalog.expectedPeak1), true);
  assert.equal(Cxp14UatFixtureFolders.validFolderId(catalog.parityExport), true);
  Cxp14UatFixtureFolders.NEGATIVE_SLOTS.forEach((slot) => {
    assert.equal(Cxp14UatFixtureFolders.validFolderId(catalog.negatives[slot]), true, slot);
  });
});

test('dirty critical-path modules fail stamp generation', async () => {
  const guard = await import('../scripts/check-critical-path.mjs');
  const dirty = [
    {
      path: 'src/services/CommitService.js',
      content: 'sheet.getRange(1, 1).setValue(value);',
    },
  ];
  const violations = guard.findCriticalPathViolations(dirty);
  assert.ok(violations.length > 0);
  const stamp = guard.buildStamp(dirty, violations);
  assert.equal(stamp.pass, false);
});
