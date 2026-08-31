const assert = require('node:assert/strict');
const test = require('node:test');

const Cxp11ParityUat = require('../src/main/Cxp11UatEntrypoints.js');
const LegacyExportAdapter = require('../src/parity/LegacyExportAdapter.js');
const ParityContracts = require('../src/parity/ParityContracts.js');
const ParityRunEngine = require('../src/parity/ParityRunEngine.js');
const SourceErrorBaseline = require('../src/parity/SourceErrorBaseline.js');
const fixture = require('./fixtures/cxp11/synthetic-parity-bundle.json');

const adapter = LegacyExportAdapter.create({});

function buildBundle(overrides = {}) {
  return Cxp11ParityUat.buildBundleFiles({
    acquisitionTimestampUtc: fixture.acquisitionTimestampUtc,
    datasets: fixture.datasets,
    legacyErrors: fixture.legacyErrors,
    legacyMetrics: fixture.legacyMetrics,
    sourceBundleFingerprint: fixture.sourceBundleFingerprint,
    ...overrides,
  });
}

class FakeProperties {
  constructor() {
    this.values = new Map();
  }

  getProperty(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setProperty(key, value) {
    this.values.set(key, value);
  }

  deleteProperty(key) {
    this.values.delete(key);
  }
}

class FakeResults {
  constructor() {
    this.rows = [];
    this.chunks = [];
  }

  appendChunk(runId, chunkId, comparisons) {
    const key = `${runId}\u001d${chunkId}`;
    if (this.chunks.includes(key)) {
      return { appended: false, chunkId, rowCount: 0 };
    }
    if (!comparisons || comparisons.length === 0) {
      return { appended: false, chunkId, rowCount: 0 };
    }
    this.chunks.push(key);
    comparisons.forEach((comparison) => this.rows.push(comparison));
    return { appended: true, chunkId, rowCount: comparisons.length };
  }
}

class FakeScriptApp {
  constructor() {
    this.triggers = [];
  }

  getProjectTriggers() {
    return this.triggers.slice();
  }

  deleteTrigger(trigger) {
    this.triggers = this.triggers.filter((candidate) => candidate !== trigger);
  }

  newTrigger(handler) {
    const scriptApp = this;
    return {
      timeBased() {
        return {
          after() {
            return {
              create() {
                const trigger = { getHandlerFunction: () => handler };
                scriptApp.triggers.push(trigger);
                return trigger;
              },
            };
          },
        };
      },
    };
  }
}

function lockService(acquired = true) {
  return {
    getScriptLock() {
      return {
        releaseLock() {},
        tryLock() {
          return acquired;
        },
      };
    },
  };
}

function targetReaderFrom(bundle, options = {}) {
  const validated = adapter.validate(bundle);
  const datasetByName = new Map(
    validated.datasets.map((dataset) => [dataset.datasetName, dataset]),
  );
  return {
    readDataset(datasetName) {
      const dataset = datasetByName.get(datasetName);
      return {
        headers: dataset.headers.slice(),
        rows: dataset.rows.map((row) => ({ ...row })),
      };
    },
    readMetrics() {
      return options.metrics || fixture.targetMetrics;
    },
  };
}

function createHarness(overrides = {}) {
  const bundle = overrides.bundle || buildBundle();
  const properties = overrides.properties || new FakeProperties();
  const results = overrides.results || new FakeResults();
  const scriptApp = overrides.scriptApp || new FakeScriptApp();
  const exportReader = overrides.exportReader || {
    read() {
      return { files: { ...bundle.files }, manifestText: bundle.manifestText };
    },
  };
  const engine = ParityRunEngine.create({
    baseline: overrides.baseline || {
      read: () => SourceErrorBaseline.listRecords(),
      verifyInstalled: () => ({ recordCount: 6 }),
    },
    clock: overrides.clock || { now: () => new Date('2026-08-18T19:00:00Z') },
    controlSpreadsheetId: 'control-id',
    environment: 'DEV',
    exportFolderId: overrides.exportFolderId === null ? null : 'export-folder',
    exportReader,
    ledger: overrides.ledger || {
      findSuccessfulByFingerprint: () => ({
        fingerprint: fixture.sourceBundleFingerprint,
        runId: fixture.ingestionRunId,
      }),
    },
    lockService: overrides.lockService || lockService(),
    maxRuntimeMs: overrides.maxRuntimeMs,
    properties,
    results,
    scriptApp,
    targetReader: overrides.targetReader || targetReaderFrom(bundle),
    targetSpreadsheetId: 'target-id',
  });
  return { bundle, engine, properties, results, scriptApp };
}

function readState(properties) {
  return JSON.parse(properties.getProperty(ParityRunEngine.STATE_KEY));
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code, `expected ${code} but got ${error.code}`);
    return true;
  });
}

test('an exact-match bundle completes every phase in one invocation', () => {
  const harness = createHarness();
  const status = harness.engine.start({ runId: 'RUN-EXACT' });

  assert.equal(status.runState, ParityContracts.RUN_STATES.complete);
  assert.equal(status.evaluatedDatasetCount, 5);
  assert.equal(status.evaluatedMetricCount, 25);
  assert.equal(status.baselineObservedTotal, fixture.expected.baselineTotal);
  assert.equal(status.baselineExpectedTotal, fixture.expected.baselineTotal);
  assert.equal(status.summary.pass, fixture.expected.pass);
  assert.equal(status.summary.comparisonCount, fixture.expected.comparisonCount);
  assert.equal(status.summary.defectCount, fixture.expected.defectCount);
  assert.deepEqual(
    Object.assign({}, status.summary.byClassification),
    fixture.expected.byClassification,
  );
  assert.equal(harness.results.rows.length, fixture.expected.comparisonCount);
  assert.equal(harness.scriptApp.getProjectTriggers().length, 0);
});

test('every persisted comparison carries lineage, classification, and resolution', () => {
  const harness = createHarness();
  harness.engine.start({ runId: 'RUN-CONTRACT' });

  harness.results.rows.forEach((row) => {
    assert.equal(row.runId, 'RUN-CONTRACT');
    assert.ok(row.comparisonId);
    assert.ok(row.chunkId);
    assert.ok(ParityContracts.RUN_STATE_ORDER.includes(row.phase));
    assert.ok(Object.keys(ParityContracts.CLASSIFICATIONS).length > 0);
    assert.equal(
      row.resolutionStatus,
      ParityContracts.resolutionFor(row.classification),
    );
    assert.doesNotThrow(() => JSON.parse(row.lineage));
    assert.match(row.comparedAtUtc, /^\d{4}-\d{2}-\d{2}T/);
  });

  const ids = harness.results.rows.map((row) => row.comparisonId);
  assert.equal(new Set(ids).size, ids.length);
});

test('a zero budget checkpoints after each step and resumes to completion', () => {
  const harness = createHarness({ maxRuntimeMs: 0 });
  let status = harness.engine.start({ runId: 'RUN-RESUME' });

  assert.equal(status.runState, ParityContracts.RUN_STATES.sourceTables);
  assert.equal(status.continuationScheduled, true);
  assert.equal(harness.scriptApp.getProjectTriggers().length, 1);

  let continuations = 0;
  while (status.runState !== ParityContracts.RUN_STATES.complete && continuations < 50) {
    status = harness.engine.continueRun();
    continuations += 1;
  }

  assert.equal(status.runState, ParityContracts.RUN_STATES.complete);
  assert.ok(continuations > 1, 'the run must span multiple continuations');
  assert.equal(status.summary.pass, true);
  assert.equal(harness.results.rows.length, fixture.expected.comparisonCount);
  assert.equal(harness.scriptApp.getProjectTriggers().length, 0);
});

test('replaying an already-written chunk does not append it twice', () => {
  const harness = createHarness();
  harness.engine.start({ runId: 'RUN-REPLAY' });
  const rowCount = harness.results.rows.length;
  const chunkCount = harness.results.chunks.length;

  const state = readState(harness.properties);
  state.runState = ParityContracts.RUN_STATES.sourceTables;
  state.datasetIndex = 0;
  state.rowOffset = 0;
  state.metricIndex = 0;
  state.evaluatedDatasets = [];
  state.evaluatedMetrics = [];
  harness.properties.setProperty(ParityRunEngine.STATE_KEY, JSON.stringify(state));

  const replayed = harness.engine.continueRun();

  assert.equal(replayed.runState, ParityContracts.RUN_STATES.complete);
  assert.equal(harness.results.rows.length, rowCount);
  assert.equal(harness.results.chunks.length, chunkCount);
});

test('lock contention fails closed without touching the cursor', () => {
  const harness = createHarness({ lockService: lockService(false) });

  expectCode(() => harness.engine.start({ runId: 'RUN-LOCK' }), 'PARITY_LOCK_TIMEOUT');
  assert.equal(harness.properties.getProperty(ParityRunEngine.STATE_KEY), null);
});

test('starting while a run is active is refused', () => {
  const harness = createHarness({ maxRuntimeMs: 0 });
  harness.engine.start({ runId: 'RUN-ACTIVE' });

  expectCode(() => harness.engine.start({ runId: 'RUN-SECOND' }), 'PARITY_RUN_ALREADY_ACTIVE');
});

test('a replaced export manifest fails with TARGET_SNAPSHOT_CHANGED', () => {
  const first = buildBundle();
  const second = buildBundle({
    acquisitionTimestampUtc: '2026-08-18T19:00:00Z',
  });
  let call = 0;
  const harness = createHarness({
    bundle: first,
    exportReader: {
      read() {
        call += 1;
        const bundle = call === 1 ? first : second;
        return { files: { ...bundle.files }, manifestText: bundle.manifestText };
      },
    },
    maxRuntimeMs: 0,
  });

  harness.engine.start({ runId: 'RUN-SNAPSHOT' });
  expectCode(() => harness.engine.continueRun(), 'PARITY_TARGET_SNAPSHOT_CHANGED');
  assert.equal(readState(harness.properties).runState, ParityContracts.RUN_STATES.failed);
  assert.equal(harness.scriptApp.getProjectTriggers().length, 0);
});

test('a re-ingested target fails with TARGET_SNAPSHOT_CHANGED', () => {
  let call = 0;
  const harness = createHarness({
    ledger: {
      findSuccessfulByFingerprint() {
        call += 1;
        return {
          fingerprint: fixture.sourceBundleFingerprint,
          runId: call === 1 ? 'RUN-INGEST-1' : 'RUN-INGEST-2',
        };
      },
    },
    maxRuntimeMs: 0,
  });

  harness.engine.start({ runId: 'RUN-REINGEST' });
  expectCode(() => harness.engine.continueRun(), 'PARITY_TARGET_SNAPSHOT_CHANGED');
});

test('an unledgered source bundle never reaches comparison', () => {
  const harness = createHarness({
    ledger: { findSuccessfulByFingerprint: () => null },
  });

  expectCode(
    () => harness.engine.start({ runId: 'RUN-NO-LEDGER' }),
    'PARITY_SOURCE_FINGERPRINT_MISMATCH',
  );
  assert.equal(harness.results.rows.length, 0);
});

test('an uninstalled baseline blocks the run at preflight', () => {
  const harness = createHarness({
    baseline: {
      read: () => [],
      verifyInstalled() {
        const error = new Error('not installed');
        error.code = 'PARITY_BASELINE_NOT_INSTALLED';
        throw error;
      },
    },
  });

  expectCode(
    () => harness.engine.start({ runId: 'RUN-NO-BASELINE' }),
    'PARITY_BASELINE_NOT_INSTALLED',
  );
  assert.equal(harness.results.rows.length, 0);
});

test('a missing export folder configuration fails closed', () => {
  const harness = createHarness({ exportFolderId: null });

  expectCode(
    () => harness.engine.start({ runId: 'RUN-NO-FOLDER' }),
    'PARITY_EXPORT_FOLDER_NOT_CONFIGURED',
  );
});

test('corrupt cursors and unsupported state versions are rejected', () => {
  const harness = createHarness();
  harness.properties.setProperty(
    ParityRunEngine.STATE_KEY,
    JSON.stringify({ datasetIndex: -1, metricIndex: 0, rowOffset: 0, runState: 'PREFLIGHT', version: 1 }),
  );
  expectCode(() => harness.engine.continueRun(), 'PARITY_RUN_STATE_INVALID');

  harness.properties.setProperty(ParityRunEngine.STATE_KEY, '{not json');
  expectCode(() => harness.engine.continueRun(), 'PARITY_RUN_STATE_INVALID');

  harness.properties.setProperty(
    ParityRunEngine.STATE_KEY,
    JSON.stringify({ datasetIndex: 0, metricIndex: 0, rowOffset: 0, runState: 'PREFLIGHT', version: 99 }),
  );
  expectCode(() => harness.engine.continueRun(), 'PARITY_RUN_STATE_INVALID');
});

test('reset is refused while a run is active and permitted with force', () => {
  const harness = createHarness({ maxRuntimeMs: 0 });
  harness.engine.start({ runId: 'RUN-RESET' });

  expectCode(() => harness.engine.reset(), 'PARITY_RUN_ALREADY_ACTIVE');
  assert.notEqual(harness.properties.getProperty(ParityRunEngine.STATE_KEY), null);

  const cleared = harness.engine.reset({ force: true });
  assert.equal(cleared.cleared, true);
  assert.equal(harness.properties.getProperty(ParityRunEngine.STATE_KEY), null);
  assert.equal(harness.scriptApp.getProjectTriggers().length, 0);
});

test('reset after completion clears state and removes continuation triggers', () => {
  const harness = createHarness();
  harness.engine.start({ runId: 'RUN-DONE' });

  assert.equal(harness.engine.reset().cleared, true);
  assert.equal(harness.engine.status().status, 'IDLE');
  assert.equal(harness.scriptApp.getProjectTriggers().length, 0);
});

test('continuing with no persisted state is a no-op IDLE status', () => {
  const harness = createHarness();

  assert.equal(harness.engine.continueRun().status, 'IDLE');
  assert.equal(harness.results.rows.length, 0);
});

test('a second weekly bundle reruns with no comparison-logic change', () => {
  const secondFixtureMetrics = fixture.legacyMetrics.map((row) => ({
    ...row,
    businessDate: '2026-08-25',
  }));
  const secondTargetMetrics = fixture.targetMetrics.map((row) => ({
    ...row,
    businessDate: '2026-08-25',
  }));
  const bundle = buildBundle({
    acquisitionTimestampUtc: '2026-08-25T18:30:00Z',
    legacyMetrics: secondFixtureMetrics,
    sourceBundleFingerprint: 'sha256:cxp11week2000000000000000000000000000000000000000000000000000000',
  });
  const harness = createHarness({
    bundle,
    ledger: {
      findSuccessfulByFingerprint: (fingerprint) => ({
        fingerprint,
        runId: 'RUN-INGEST-WEEK2',
      }),
    },
    targetReader: targetReaderFrom(bundle, { metrics: secondTargetMetrics }),
  });

  const status = harness.engine.start({ runId: 'RUN-WEEK2' });

  assert.equal(status.runState, ParityContracts.RUN_STATES.complete);
  assert.equal(status.summary.pass, true);
  assert.equal(status.summary.comparisonCount, fixture.expected.comparisonCount);
});

test('a migrated metric defect is surfaced and blocks the pass', () => {
  const brokenTargets = fixture.targetMetrics.map((row) => (
    row.intervalStart === '10:00' && row.metric === 'Offered'
      ? { ...row, value: 5 }
      : row
  ));
  const bundle = buildBundle();
  const harness = createHarness({
    bundle,
    targetReader: targetReaderFrom(bundle, { metrics: brokenTargets }),
  });

  const status = harness.engine.start({ runId: 'RUN-DEFECT' });

  assert.equal(status.runState, ParityContracts.RUN_STATES.complete);
  assert.equal(status.summary.pass, false);
  assert.equal(status.summary.defectCount, 1);
  const defect = harness.results.rows.find(
    (row) => row.classification === ParityContracts.CLASSIFICATIONS.migrationDefect,
  );
  assert.equal(defect.metricName, 'Offered');
  assert.equal(defect.delta, 1);
  assert.equal(defect.resolutionStatus, ParityContracts.RESOLUTION_STATUSES.open);
});
