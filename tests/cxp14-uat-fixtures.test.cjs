const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const Cxp14ReleaseEvidence = require('../src/release/Cxp14ReleaseEvidence.js');
const DatasetAdapter = require('../src/ingestion/DatasetAdapter.js');
const InboxBundleRepository = require('../src/repository/InboxBundleRepository.js');
const LegacyExportAdapter = require('../src/parity/LegacyExportAdapter.js');
const ReportingSurfaceReferenceModel = require(
  '../src/transformations/ReportingSurfaceReferenceModel.js',
);
const SchemaRegistry = require('../src/ingestion/SchemaRegistry.js');
const SchemaValidator = require('../src/ingestion/SchemaValidator.js');

async function loadGenerator() {
  return import(pathToFileURL(path.resolve(__dirname, '../scripts/generate-cxp14-uat-fixtures.mjs')).href);
}

function htmlBlob(text) {
  return {
    getDataAsString(charset) {
      assert.equal(charset, 'ISO-8859-1');
      return text;
    },
  };
}

function readHtml(filePath) {
  return fs.readFileSync(filePath, 'latin1');
}

function listNames(directory) {
  return fs.readdirSync(directory).sort();
}

function inboxFiles(directory) {
  return listNames(directory).map((name, index) => ({
    id: `file-${index}`,
    name,
    updatedAtUtc: '2026-09-08T12:00:00.000Z',
  }));
}

test('full workload profiles match the CXP-14 release contract', async () => {
  const generator = await loadGenerator();
  assert.deepEqual(generator.WORKLOAD_PROFILES, Cxp14ReleaseEvidence.WORKLOAD_PROFILES);
  assert.equal(generator.totalRows(generator.countsFor('EXPECTED_PEAK', 'full')), 20300);
  assert.equal(generator.totalRows(generator.countsFor('DECLARED_MAXIMUM', 'full')), 44500);
});

test('unit-scale fixtures are distinct, negative, and fingerprint-matched', async (t) => {
  const generator = await loadGenerator();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cxp14-fixtures-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  const result = await generator.generateCxp14UatFixtures({ outputDir, scale: 'unit' });
  const byId = Object.fromEntries(result.catalog.map((entry) => [entry.id, entry]));
  const peaks = ['expected-peak-01', 'expected-peak-02', 'expected-peak-03'].map((id) => byId[id]);

  assert.equal(new Set(peaks.map((entry) => entry.fingerprint)).size, 3);
  assert.equal(new Set(peaks.map((entry) => entry.token)).size, 3);
  peaks.forEach((entry) => {
    assert.equal(entry.totalRows, generator.totalRows(generator.UNIT_SCALE_COUNTS.EXPECTED_PEAK));
    assert.equal(InboxBundleRepository.validToken(entry.token), true);
    assert.equal(
      InboxBundleRepository.selectLatest(inboxFiles(path.join(outputDir, entry.relativeDir))).status,
      'READY',
    );
  });

  const declared = byId['declared-maximum'];
  assert.equal(declared.totalRows, generator.totalRows(generator.UNIT_SCALE_COUNTS.DECLARED_MAXIMUM));
  assert.notEqual(declared.fingerprint, peaks[0].fingerprint);

  assert.equal(byId['duplicate-same-name'].fingerprint, peaks[0].fingerprint);
  assert.equal(byId['duplicate-different-name'].fingerprint, peaks[0].fingerprint);
  assert.notEqual(byId['duplicate-different-name'].token, peaks[0].token);

  const handledPath = path.join(outputDir, 'expected-peak-01', `${peaks[0].token}__handled.xls`);
  const html = readHtml(handledPath);
  assert.equal(html.toLowerCase().startsWith('<head'), true);
  const parsed = DatasetAdapter.parseHtmlTable({ blob: htmlBlob(html) });
  const payload = DatasetAdapter.fromTable({
    datasetName: 'Handled',
    runMetadata: { runId: 'cxp14-fixture', schemaVersion: '1.0.0' },
    source: { artifactId: 'cxp14-peak-01-handled', datasetName: 'Handled', kind: 'single_dataset' },
    values: parsed.values,
  });
  assert.equal(payload.rowCount, generator.UNIT_SCALE_COUNTS.EXPECTED_PEAK.handled);
  assert.equal(payload.records[0]['Service Level Met'], '0');
  assert.equal(payload.records[0]['Is Internal'], '0');
  assert.equal(/>(?:TRUE|FALSE)</.test(html), false);

  const reordered = DatasetAdapter.parseHtmlTable({
    blob: htmlBlob(readHtml(path.join(
      outputDir,
      'negatives',
      'reordered-headers',
      `${byId['reordered-headers'].token}__handled.xls`,
    ))),
  });
  const reorderedHeaders = SchemaValidator.validateHeaders('Handled', reordered.values[0]);
  assert.deepEqual(reorderedHeaders.canonicalHeaders, SchemaRegistry.getSchema('Handled').requiredHeaders);

  assert.throws(
    () => DatasetAdapter.fromTable({
      datasetName: 'Handled',
      runMetadata: { runId: 'cxp14-fixture', schemaVersion: '1.0.0' },
      source: { artifactId: 'cxp14-missing-header', datasetName: 'Handled', kind: 'single_dataset' },
      values: DatasetAdapter.parseHtmlTable({
        blob: htmlBlob(readHtml(path.join(
          outputDir,
          'negatives',
          'missing-header',
          `${byId['missing-header'].token}__handled.xls`,
        ))),
      }).values,
    }),
    (error) => error.code === 'SCHEMA_MISSING_REQUIRED_COLUMNS' || error.code === 'SCHEMA_UNEXPECTED_COLUMNS',
  );

  assert.throws(
    () => DatasetAdapter.parseHtmlTable({
      blob: htmlBlob(readHtml(path.join(
        outputDir,
        'negatives',
        'empty-dataset',
        '20260908T170800Z__handled.xls',
      ))),
    }),
    (error) => error.code === 'SOURCE_INVALID_TABLE',
  );

  assert.throws(
    () => DatasetAdapter.fromTable({
      datasetName: 'Handled',
      runMetadata: { runId: 'cxp14-fixture', schemaVersion: '1.0.0' },
      source: { artifactId: 'cxp14-duplicate-key', datasetName: 'Handled', kind: 'single_dataset' },
      values: DatasetAdapter.parseHtmlTable({
        blob: htmlBlob(readHtml(path.join(
          outputDir,
          'negatives',
          'duplicate-key',
          `${byId['duplicate-key'].token}__handled.xls`,
        ))),
      }).values,
    }),
    (error) => error.code === 'SOURCE_DIVERGENT_DUPLICATE_KEY',
  );

  assert.throws(
    () => InboxBundleRepository.selectLatest(inboxFiles(path.join(outputDir, 'negatives', 'missing-dataset'))),
    (error) => error.code === 'SOURCE_INBOX_BUNDLE_INCOMPLETE',
  );
  assert.throws(
    () => InboxBundleRepository.selectLatest(inboxFiles(path.join(outputDir, 'negatives', 'incomplete-newest'))),
    (error) => error.code === 'SOURCE_INBOX_BUNDLE_INCOMPLETE',
  );
  assert.throws(
    () => InboxBundleRepository.selectLatest(inboxFiles(path.join(outputDir, 'negatives', 'mixed-packaging'))),
    (error) => error.code === 'SOURCE_INBOX_BUNDLE_AMBIGUOUS',
  );

  const formulaBytes = fs.readFileSync(path.join(
    outputDir,
    'negatives',
    'formula-xlsx',
    '20260908T171000Z__bundle.xlsx',
  ));
  assert.equal(formulaBytes[0], 0x50);
  assert.equal(formulaBytes[1], 0x4b);
  assert.match(formulaBytes.toString('utf8'), /<f>1\+1<\/f>/);

  assert.equal(byId['parity-export'].fingerprint, byId['parity-source'].fingerprint);
  assert.notEqual(byId['parity-source'].fingerprint, 'sha256:cxp11syntheticbundle0000000000000000000000000000000000000000000');

  const exportDir = path.join(outputDir, 'parity', 'export');
  const manifestText = fs.readFileSync(path.join(exportDir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.sourceBundleFingerprint, byId['parity-source'].fingerprint);
  assert.equal(manifest.baselineVersion, 'WB0817');
  const files = {};
  for (const name of fs.readdirSync(exportDir)) {
    if (name === 'manifest.json') continue;
    files[name] = fs.readFileSync(path.join(exportDir, name), 'utf8');
  }
  const validated = LegacyExportAdapter.create().validate({ files, manifestText });
  assert.equal(validated.sourceBundleFingerprint, byId['parity-source'].fingerprint);
  assert.equal(validated.datasets.length, 5);
  assert.equal(validated.metrics.length, ReportingSurfaceReferenceModel.METRIC_ORDER.length);
  assert.equal(
    validated.legacyErrors.reduce((sum, record) => sum + Number(record.observedCount), 0),
    1885,
  );
});
