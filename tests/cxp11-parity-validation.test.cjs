const assert = require('node:assert/strict');
const test = require('node:test');

const Cxp11ParityUat = require('../src/main/Cxp11UatEntrypoints.js');
const LegacyExportAdapter = require('../src/parity/LegacyExportAdapter.js');
const ParityComparator = require('../src/parity/ParityComparator.js');
const ParityContracts = require('../src/parity/ParityContracts.js');
const ParityDigest = require('../src/parity/ParityDigest.js');
const SourceErrorBaseline = require('../src/parity/SourceErrorBaseline.js');
const fixture = require('./fixtures/cxp11/synthetic-parity-bundle.json');

const adapter = LegacyExportAdapter.create({});
const comparator = ParityComparator.create({
  clock: { now: () => new Date('2026-08-18T19:00:00Z') },
});

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

function withManifest(bundle, mutate) {
  const manifest = JSON.parse(bundle.manifestText);
  mutate(manifest);
  return { files: { ...bundle.files }, manifestText: JSON.stringify(manifest) };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code, `expected ${code} but got ${error.code}`);
    return true;
  });
}

test('a contracted export bundle validates into canonical records', () => {
  const validated = adapter.validate(buildBundle());

  assert.equal(validated.contractVersion, ParityContracts.CONTRACT_VERSION);
  assert.equal(validated.datasets.length, 5);
  assert.deepEqual(
    validated.datasets.map((dataset) => dataset.datasetName),
    ['Handled', 'Offered', 'AHT - Raw', 'Auxes - Raw', 'Staff'],
  );
  validated.datasets.forEach((dataset) => {
    assert.equal(dataset.rowCount, 2);
    assert.deepEqual(dataset.headers, ParityContracts.datasetHeaders(dataset.datasetName));
  });
  assert.equal(validated.metrics.length, fixture.legacyMetrics.length);
  assert.equal(validated.legacyErrors.length, fixture.legacyErrors.length);
  assert.match(validated.manifestFingerprint, /^[0-9a-f]{64}$/);
});

test('Staff datetime cells canonicalize so Sheets Date objects match the export CSV', () => {
  const validated = adapter.validate(buildBundle());
  const staffExport = validated.datasets.find((dataset) => dataset.datasetName === 'Staff');

  assert.equal(staffExport.rows[0]['Status Start Date'], '8/18/2026 2:00 AM');
  assert.equal(staffExport.rows[0]['Status End Date'], '8/18/2026 10:00 AM');

  const fromIso = LegacyExportAdapter.canonicalizeDataset('Staff', {
    headers: staffExport.headers,
    rows: [{
      'Athlete Display Name': 'Athlete One',
      'Athlete Profile': 'Messaging',
      'Athlete Site': 'PH',
      'Status End Date': '2026-08-18T10:00:00.000Z',
      'Status Start Date': '2026-08-18T02:00:00.000Z',
    }],
  });
  const fromDate = LegacyExportAdapter.canonicalizeDataset('Staff', {
    headers: staffExport.headers,
    rows: [{
      'Athlete Display Name': 'Athlete One',
      'Athlete Profile': 'Messaging',
      'Athlete Site': 'PH',
      'Status End Date': new Date('2026-08-18T10:00:00.000Z'),
      'Status Start Date': new Date('2026-08-18T02:00:00.000Z'),
    }],
  });

  assert.equal(fromIso.rows[0]['Status Start Date'], staffExport.rows[0]['Status Start Date']);
  assert.equal(fromDate.rows[0]['Status Start Date'], staffExport.rows[0]['Status Start Date']);

  const chunk = comparator.compareSourceTableChunk({
    batchSize: 10,
    legacy: staffExport,
    migrated: {
      headers: staffExport.headers,
      rows: fromDate.rows.concat(
        LegacyExportAdapter.canonicalizeDataset('Staff', {
          headers: staffExport.headers,
          rows: [{
            'Athlete Display Name': 'Athlete Two',
            'Athlete Profile': 'Messaging',
            'Athlete Site': 'LAS',
            'Status End Date': new Date('2026-08-18T11:00:00.000Z'),
            'Status Start Date': new Date('2026-08-18T03:00:00.000Z'),
          }],
        }).rows,
      ),
    },
    offset: 0,
    runId: 'RUN-STAFF-DATE',
  });

  const defects = chunk.comparisons.filter((comparison) => (
    comparison.classification !== ParityContracts.CLASSIFICATIONS.match
  ));
  assert.equal(defects.length, 0);
  assert.equal(chunk.comparisons.length, 2);
});

test('manifest and file digest failures fail closed', () => {
  const bundle = buildBundle();

  expectCode(
    () => adapter.validate({
      files: bundle.files,
      manifestText: bundle.manifestText.replace('{', '{,'),
    }),
    'PARITY_EXPORT_MANIFEST_INVALID',
  );

  expectCode(
    () => adapter.validate(withManifest(bundle, (manifest) => {
      manifest.contractVersion = '0.9.0';
    })),
    'PARITY_EXPORT_CONTRACT_VERSION_MISMATCH',
  );

  expectCode(
    () => adapter.validate(withManifest(bundle, (manifest) => {
      manifest.controlWorkbookSha256 = 'A'.repeat(64);
    })),
    'PARITY_EXPORT_MANIFEST_INVALID',
  );

  expectCode(
    () => adapter.validate(withManifest(bundle, (manifest) => {
      manifest.acquisitionTimestampUtc = '2026-08-18 18:30';
    })),
    'PARITY_EXPORT_INVALID_TIMESTAMP',
  );

  const tampered = { files: { ...bundle.files }, manifestText: bundle.manifestText };
  tampered.files['offered.csv'] = `${tampered.files['offered.csv']}extra\r\n`;
  expectCode(() => adapter.validate(tampered), 'PARITY_EXPORT_DIGEST_MISMATCH');
});

test('missing, unexpected, and drifted export files fail closed', () => {
  const bundle = buildBundle();

  const missing = { files: { ...bundle.files }, manifestText: bundle.manifestText };
  delete missing.files['staff.csv'];
  expectCode(() => adapter.validate(missing), 'PARITY_EXPORT_FILE_MISSING');

  const unexpected = {
    files: { ...bundle.files, 'notes.csv': 'a\r\n' },
    manifestText: bundle.manifestText,
  };
  expectCode(() => adapter.validate(unexpected), 'PARITY_EXPORT_FILE_UNEXPECTED');

  const headers = ParityContracts.datasetHeaders('Staff');
  const swapped = [headers[1], headers[0], ...headers.slice(2)];
  const driftedText = `${swapped.join(',')}\r\n`;
  const drifted = withManifest(
    { files: { ...bundle.files, 'staff.csv': driftedText }, manifestText: bundle.manifestText },
    (manifest) => {
      const entry = manifest.files.find((file) => file.name === 'staff.csv');
      entry.sha256 = ParityDigest.sha256Hex(driftedText);
      entry.rowCount = 0;
    },
  );
  expectCode(() => adapter.validate(drifted), 'PARITY_EXPORT_SCHEMA_DRIFT');
});

test('row-count, duplicate-key, and blank-key policies fail closed', () => {
  const bundle = buildBundle();

  expectCode(
    () => adapter.validate(withManifest(bundle, (manifest) => {
      manifest.files.find((file) => file.name === 'handled.csv').rowCount = 3;
    })),
    'PARITY_EXPORT_ROW_COUNT_MISMATCH',
  );

  const divergent = buildBundle({
    datasets: {
      ...fixture.datasets,
      Offered: [
        fixture.datasets.Offered[0],
        { ...fixture.datasets.Offered[0], 'Initial Athlete Site': 'LAS' },
      ],
    },
  });
  expectCode(() => adapter.validate(divergent), 'PARITY_EXPORT_DUPLICATE_KEY');

  const blankKey = buildBundle({
    datasets: {
      ...fixture.datasets,
      Handled: [{ ...fixture.datasets.Handled[0], 'Messaging Session Name': '' }],
    },
  });
  expectCode(() => adapter.validate(blankKey), 'PARITY_EXPORT_MISSING_KEY');
});

test('exact-duplicate rows collapse instead of failing', () => {
  const collapsed = adapter.validate(buildBundle({
    datasets: {
      ...fixture.datasets,
      Handled: [fixture.datasets.Handled[0], fixture.datasets.Handled[0]],
    },
  }));

  const handled = collapsed.datasets.find((dataset) => dataset.datasetName === 'Handled');
  assert.equal(handled.rowCount, 1);
});

test('a fingerprint without a successful ledger entry fails closed', () => {
  const validated = adapter.validate(buildBundle());

  expectCode(
    () => adapter.assertLedgerIdentity(validated, null),
    'PARITY_SOURCE_FINGERPRINT_MISMATCH',
  );
  expectCode(
    () => adapter.assertLedgerIdentity(validated, { fingerprint: 'sha256:other', runId: 'R1' }),
    'PARITY_SOURCE_FINGERPRINT_MISMATCH',
  );
  assert.deepEqual(
    adapter.assertLedgerIdentity(validated, {
      fingerprint: fixture.sourceBundleFingerprint,
      runId: 'RUN-1',
    }),
    {
      ingestionRunId: 'RUN-1',
      sourceBundleFingerprint: fixture.sourceBundleFingerprint,
    },
  );
});

test('legacy interval keys shift by -480 minutes across the calendar boundary', () => {
  assert.deepEqual(
    comparator.alignLegacyGrain({ businessDate: '2026-08-18', intervalStart: '18:00' }),
    { businessDate: '2026-08-18', intervalStart: '10:00', queueOrLob: '', site: '' },
  );
  assert.deepEqual(
    comparator.alignLegacyGrain({ businessDate: '2026-08-18', intervalStart: '07:45' }),
    { businessDate: '2026-08-17', intervalStart: '23:45', queueOrLob: '', site: '' },
  );
  assert.equal(ParityContracts.LEGACY_INTERVAL_SHIFT_MINUTES, -480);
});

test('only intervals whose right boundary is at or before the checkpoint compare', () => {
  const checkpoint = comparator.checkpointMinutes('2026-08-18T18:30:00Z');

  assert.equal(
    comparator.isClosedInterval({ businessDate: '2026-08-18', intervalStart: '10:00' }, checkpoint),
    true,
  );
  assert.equal(
    comparator.isClosedInterval({ businessDate: '2026-08-18', intervalStart: '10:30' }, checkpoint),
    false,
  );

  const chunk = comparator.compareMetricChunk({
    acquisitionTimestampUtc: fixture.acquisitionTimestampUtc,
    legacyMetrics: adapter.validate(buildBundle()).metrics,
    metricIndex: 0,
    metricNames: ParityContracts.listMetrics(),
    migratedMetrics: fixture.targetMetrics,
    runId: 'RUN-CLOSED',
  });

  assert.equal(chunk.comparisons.length, 4);
  chunk.comparisons.forEach((comparison) => {
    assert.equal(comparison.classification, ParityContracts.CLASSIFICATIONS.match);
    assert.notEqual(comparison.intervalStart, '10:30');
  });
});

test('tolerance boundaries hold for ratio metrics and integer metrics compare exactly', () => {
  const legacy = (metric, value) => [{
    aggregationIdentity: 'INTERVAL_VIEW',
    businessDate: '2026-08-18',
    intervalStart: '18:00',
    metric,
    queueOrLob: 'ALL',
    site: 'ALL',
    value,
  }];
  const migrated = (metric, value) => [{
    aggregationIdentity: 'INTERVAL_VIEW',
    businessDate: '2026-08-18',
    intervalStart: '10:00',
    metric,
    queueOrLob: 'ALL',
    site: 'ALL',
    value,
  }];

  function classify(metric, sourceValue, targetValue) {
    const chunk = comparator.compareMetricChunk({
      acquisitionTimestampUtc: fixture.acquisitionTimestampUtc,
      legacyMetrics: legacy(metric, sourceValue),
      metricIndex: 0,
      metricNames: [metric],
      migratedMetrics: migrated(metric, targetValue),
      runId: 'RUN-TOLERANCE',
    });
    assert.equal(chunk.comparisons.length, 1);
    return chunk.comparisons[0];
  }

  assert.equal(ParityContracts.toleranceFor('SL % Total'), 1e-9);
  assert.equal(ParityContracts.toleranceFor('Offered'), 0);

  assert.equal(
    classify('SL % Total', '0.75', 0.75 + 1e-9).classification,
    ParityContracts.CLASSIFICATIONS.match,
  );
  assert.equal(
    classify('SL % Total', '0.75', 0.75 + 2e-9).classification,
    ParityContracts.CLASSIFICATIONS.migrationDefect,
  );
  assert.equal(
    classify('Offered', '4', 4.0000000001).classification,
    ParityContracts.CLASSIFICATIONS.migrationDefect,
  );
});

test('blank, single-space, zero, and error-token semantics never compare equal', () => {
  assert.notEqual(comparator.normalizeValue(''), comparator.normalizeValue(0));
  assert.notEqual(comparator.normalizeValue(''), comparator.normalizeValue(' '));
  assert.equal(comparator.normalizeValue('#N/A'), '#N/A');
  assert.notEqual(comparator.normalizeValue('#N/A'), comparator.normalizeValue(''));
  assert.equal(comparator.normalizeValue('0.75'), 0.75);
});

test('an unshifted legacy key is classified as the approved DEC-025 variance', () => {
  const chunk = comparator.compareMetricChunk({
    acquisitionTimestampUtc: fixture.acquisitionTimestampUtc,
    legacyMetrics: [{
      aggregationIdentity: 'INTERVAL_VIEW',
      businessDate: '2026-08-18',
      intervalStart: '18:00',
      metric: 'Offered',
      queueOrLob: 'ALL',
      site: 'ALL',
      value: '4',
    }],
    metricIndex: 0,
    metricNames: ['Offered'],
    migratedMetrics: [
      {
        aggregationIdentity: 'INTERVAL_VIEW',
        businessDate: '2026-08-18',
        intervalStart: '10:00',
        metric: 'Offered',
        queueOrLob: 'ALL',
        site: 'ALL',
        value: 11,
      },
      {
        aggregationIdentity: 'INTERVAL_VIEW',
        businessDate: '2026-08-18',
        intervalStart: '18:00',
        metric: 'Offered',
        queueOrLob: 'ALL',
        site: 'ALL',
        value: 4,
      },
    ],
    runId: 'RUN-VARIANCE',
  });

  const aligned = chunk.comparisons.find((comparison) => comparison.intervalStart === '10:00');
  assert.equal(
    aligned.classification,
    ParityContracts.CLASSIFICATIONS.approvedExpectedVariance,
  );
  assert.equal(aligned.resolutionStatus, ParityContracts.RESOLUTION_STATUSES.closedExpected);
  assert.equal(JSON.parse(aligned.lineage).decision, 'DEC-025');
});

test('missing source and missing target metric records are separated', () => {
  const missingTarget = comparator.compareMetricChunk({
    acquisitionTimestampUtc: fixture.acquisitionTimestampUtc,
    legacyMetrics: fixture.legacyMetrics.filter((row) => row.intervalStart === '18:00'),
    metricIndex: 0,
    metricNames: ParityContracts.listMetrics(),
    migratedMetrics: [],
    runId: 'RUN-MISSING-TARGET',
  });
  assert.equal(missingTarget.comparisons.length, 3);
  missingTarget.comparisons.forEach((comparison) => {
    assert.equal(comparison.classification, ParityContracts.CLASSIFICATIONS.missingTarget);
    assert.equal(comparison.resolutionStatus, ParityContracts.RESOLUTION_STATUSES.open);
  });

  const missingSource = comparator.compareMetricChunk({
    acquisitionTimestampUtc: fixture.acquisitionTimestampUtc,
    legacyMetrics: [],
    metricIndex: 0,
    metricNames: ParityContracts.listMetrics(),
    migratedMetrics: fixture.targetMetrics,
    runId: 'RUN-MISSING-SOURCE',
  });
  assert.equal(missingSource.comparisons.length, 4);
  missingSource.comparisons.forEach((comparison) => {
    assert.equal(comparison.classification, ParityContracts.CLASSIFICATIONS.missingSource);
  });
});

test('source-table comparisons persist hashed identities instead of raw values', () => {
  const validated = adapter.validate(buildBundle());
  const offered = validated.datasets.find((dataset) => dataset.datasetName === 'Offered');
  const migratedRows = offered.rows.map((row) => ({ ...row }));
  migratedRows[0]['Initial Athlete BPO'] = 'CNX';

  const chunk = comparator.compareSourceTableChunk({
    batchSize: 10,
    legacy: offered,
    migrated: { headers: offered.headers, rows: migratedRows },
    offset: 0,
    runId: 'RUN-REDACTION',
  });

  const defect = chunk.comparisons.find(
    (comparison) => comparison.metricName === 'Initial Athlete BPO',
  );
  assert.equal(defect.classification, ParityContracts.CLASSIFICATIONS.migrationDefect);
  assert.equal(defect.dataset, 'Offered');
  const serialized = JSON.stringify(chunk.comparisons);
  ['MS-1001', 'MS-1002', 'C-1001', 'INT', 'CNX'].forEach((secret) => {
    assert.equal(
      serialized.includes(secret),
      false,
      `raw source value ${secret} must not be persisted`,
    );
  });
  assert.match(defect.sourceValue, /^[0-9a-f]{16}$/);
  assert.match(defect.aggregationIdentity, /^[0-9a-f]{16}$/);
});

test('a legacy error token in a source table is an expected source error', () => {
  const validated = adapter.validate(buildBundle());
  const handled = validated.datasets.find((dataset) => dataset.datasetName === 'Handled');
  const legacyRows = handled.rows.map((row) => ({ ...row }));
  legacyRows[0]['Speed to Answer'] = '#N/A';

  const chunk = comparator.compareSourceTableChunk({
    batchSize: 10,
    legacy: { ...handled, rows: legacyRows },
    migrated: { headers: handled.headers, rows: handled.rows.map((row) => ({ ...row })) },
    offset: 0,
    runId: 'RUN-SOURCE-ERROR',
  });

  const classified = chunk.comparisons.find(
    (comparison) => comparison.metricName === 'Speed to Answer',
  );
  assert.equal(
    classified.classification,
    ParityContracts.CLASSIFICATIONS.expectedSourceError,
  );
  assert.equal(
    JSON.parse(classified.lineage).reference,
    ParityContracts.LINEAGE_REFERENCES.sourceErrorBaseline,
  );
});

test('source-table batches are bounded and resumable by row offset', () => {
  const validated = adapter.validate(buildBundle());
  const handled = validated.datasets.find((dataset) => dataset.datasetName === 'Handled');
  const migrated = { headers: handled.headers, rows: handled.rows.map((row) => ({ ...row })) };

  const first = comparator.compareSourceTableChunk({
    batchSize: 1,
    legacy: handled,
    migrated,
    offset: 0,
    runId: 'RUN-BATCH',
  });
  assert.equal(first.done, false);
  assert.equal(first.nextOffset, 1);
  assert.equal(first.comparisons.length, 1);
  assert.equal(first.chunkId, 'SOURCE_TABLES:Handled:0');

  const second = comparator.compareSourceTableChunk({
    batchSize: 1,
    legacy: handled,
    migrated,
    offset: first.nextOffset,
    runId: 'RUN-BATCH',
  });
  assert.equal(second.done, true);
  assert.equal(second.chunkId, 'SOURCE_TABLES:Handled:1');
  assert.notEqual(first.comparisons[0].comparisonId, second.comparisons[0].comparisonId);
});

test('a migrated header contract mismatch is INVALID_INPUT, not a value defect', () => {
  const validated = adapter.validate(buildBundle());
  const staff = validated.datasets.find((dataset) => dataset.datasetName === 'Staff');

  const chunk = comparator.compareSourceTableChunk({
    batchSize: 10,
    legacy: staff,
    migrated: { headers: staff.headers.slice(0, 3), rows: [] },
    offset: 0,
    runId: 'RUN-HEADER',
  });

  const invalid = chunk.comparisons.find(
    (comparison) => comparison.metricName === 'HEADER_CONTRACT',
  );
  assert.equal(invalid.classification, ParityContracts.CLASSIFICATIONS.invalidInput);
});

test('the WB0817 baseline seeds exactly 1,885 errors and never the superseded 5,655', () => {
  const records = SourceErrorBaseline.listRecords();
  const verification = SourceErrorBaseline.verify(records);

  assert.equal(verification.pass, true);
  assert.equal(verification.actualTotal, 1885);
  assert.deepEqual(Object.assign({}, verification.actualByType), {
    '#N/A': 1838,
    '#DIV/0!': 26,
    '#REF!': 21,
  });
  assert.equal(ParityContracts.BASELINE_TOTAL_ERRORS, 1885);
  assert.notEqual(verification.actualTotal, ParityContracts.SUPERSEDED_BASELINE_TOTAL_ERRORS);
  records.forEach((record) => {
    assert.equal(record.baselineVersion, 'WB0817');
    assert.equal(record.controlWorkbookSha256, ParityContracts.CONTROL_WORKBOOK_SHA256);
    assert.ok(record.evidence.length > 0);
  });
});

test('baseline drift is detected by total and by error type', () => {
  const records = SourceErrorBaseline.listRecords().map((record) => ({ ...record }));
  records[0].expectedCount = 918;
  const drifted = SourceErrorBaseline.verify(records);

  assert.equal(drifted.pass, false);
  assert.equal(drifted.actualTotal, 1884);
  assert.deepEqual(drifted.typeDiffs, ['#N/A']);
});

test('observed legacy errors reconcile against the baseline and assert the total', () => {
  const chunk = comparator.classifyLegacyErrors({
    baselineRecords: SourceErrorBaseline.listRecords(),
    legacyErrors: adapter.validate(buildBundle()).legacyErrors,
    runId: 'RUN-ERRORS',
  });

  assert.equal(chunk.observedTotal, 1885);
  assert.equal(chunk.expectedTotal, 1885);
  assert.equal(chunk.comparisons.length, 6);
  chunk.comparisons.forEach((comparison) => {
    assert.equal(
      comparison.classification,
      ParityContracts.CLASSIFICATIONS.expectedSourceError,
    );
  });

  const unexplained = comparator.classifyLegacyErrors({
    baselineRecords: SourceErrorBaseline.listRecords(),
    legacyErrors: [{
      cellOrRange: 'B2:B10',
      errorToken: '#VALUE!',
      formulaFamily: 'unknown',
      observedCount: 3,
      worksheet: 'Data',
    }],
    runId: 'RUN-ERRORS-UNEXPLAINED',
  });
  const defects = unexplained.comparisons.filter(
    (comparison) => ParityContracts.isDefect(comparison.classification),
  );
  assert.ok(defects.length > 0);
});

test('summary aggregation reports defect counts and a pass only without defects', () => {
  let counters = comparator.accumulate(comparator.emptyCounters(), [
    { classification: ParityContracts.CLASSIFICATIONS.match },
    { classification: ParityContracts.CLASSIFICATIONS.expectedSourceError },
  ]);
  assert.equal(comparator.summarize(counters).pass, true);
  assert.equal(comparator.summarize(counters).defectCount, 0);

  counters = comparator.accumulate(counters, [
    { classification: ParityContracts.CLASSIFICATIONS.migrationDefect },
  ]);
  assert.equal(comparator.summarize(counters).pass, false);
  assert.equal(comparator.summarize(counters).defectCount, 1);
});
