const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'cxp03', 'schema-fixtures.json'),
    'utf8',
  ),
);

function loadModule(relativePath) {
  try {
    return require(relativePath);
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      return undefined;
    }
    throw error;
  }
}

function blankRow(headers, values) {
  return headers.map((header) =>
    Object.prototype.hasOwnProperty.call(values, header) ? values[header] : null,
  );
}

function assertContractError(error, code) {
  assert.equal(error && error.code, code);
  return true;
}

// Defect caught: one logical source lacks a versioned schema, key, type, or safe row bound.
test('registry defines one active, position-independent contract for all five datasets', () => {
  const SchemaRegistry = loadModule('../src/ingestion/SchemaRegistry.js');
  assert.equal(typeof SchemaRegistry?.listSchemas, 'function');

  assert.equal(SchemaRegistry.ACTIVE_SCHEMA_VERSION, fixtures.schemaVersion);
  assert.deepEqual(
    SchemaRegistry.listSchemas().map((schema) => ({
      headers: schema.requiredHeaders,
      keyFields: schema.keyFields,
      name: schema.name,
      optionalHeaders: schema.optionalHeaders,
      rowVolume: schema.rowVolume,
      version: schema.version,
    })),
    fixtures.datasets.map((fixture) => ({
      headers: fixture.headers,
      keyFields: fixture.keyFields,
      name: fixture.name,
      optionalHeaders: [],
      rowVolume: fixture.rowVolume,
      version: fixtures.schemaVersion,
    })),
  );
  assert.ok(
    SchemaRegistry.listSchemas().every((schema) =>
      schema.columns.every((column) => ['text', 'number', 'date', 'date_time'].includes(column.type)),
    ),
  );
  assert.deepEqual(Object.keys(SchemaRegistry.PACKAGING_CONTRACTS).sort(), [
    'MULTI_SHEET_WORKBOOK',
    'SINGLE_DATASET',
  ]);
});

// Defect caught: a missing required column reaches downstream code as an undefined value.
test('missing required columns fail deterministically with a specific code', () => {
  const SchemaValidator = loadModule('../src/ingestion/SchemaValidator.js');
  assert.equal(typeof SchemaValidator?.validateHeaders, 'function');
  const handled = fixtures.datasets.find((fixture) => fixture.name === 'Handled');
  const headers = handled.headers.filter((header) => header !== 'Messaging Session Name');

  assert.throws(
    () => SchemaValidator.validateHeaders('Handled', headers),
    (error) => {
      assertContractError(error, 'SCHEMA_MISSING_REQUIRED_COLUMNS');
      assert.deepEqual(error.details.missingHeaders, ['Messaging Session Name']);
      return true;
    },
  );
});

// Defect caught: a valid export breaks when its columns move, or AHT's approved workbook alias is lost.
test('header reordering and explicit aliases normalize to canonical column names', () => {
  const SchemaValidator = loadModule('../src/ingestion/SchemaValidator.js');
  assert.equal(typeof SchemaValidator?.normalizeRows, 'function');
  const aht = fixtures.datasets.find((fixture) => fixture.name === 'AHT - Raw');
  const headers = aht.headers
    .map((header) => (header === 'Speed to Answer' ? 'Speed to Answer2' : header))
    .reverse();
  const row = blankRow(headers, {
    'Agent Work ID': 'synthetic-agent-work-id',
    'Speed To Answer': '12.5',
    'Speed to Answer2': '3',
  });

  const normalized = SchemaValidator.normalizeRows('AHT - Raw', headers, [row]);

  assert.deepEqual(normalized.headers, aht.headers);
  assert.equal(normalized.records[0]['Agent Work ID'], 'synthetic-agent-work-id');
  assert.equal(normalized.records[0]['Speed To Answer'], 12.5);
  assert.equal(normalized.records[0]['Speed to Answer'], 3);
});

// Defect caught: a renamed, additional, or alias-colliding critical column passes silently.
test('unexpected and duplicate canonical columns are rejected instead of guessed', () => {
  const SchemaValidator = loadModule('../src/ingestion/SchemaValidator.js');
  assert.equal(typeof SchemaValidator?.validateHeaders, 'function');
  const staff = fixtures.datasets.find((fixture) => fixture.name === 'Staff');

  assert.throws(
    () => SchemaValidator.validateHeaders('Staff', staff.headers.concat('Unapproved Metric')),
    (error) => assertContractError(error, 'SCHEMA_UNEXPECTED_COLUMNS'),
  );

  const aht = fixtures.datasets.find((fixture) => fixture.name === 'AHT - Raw');
  assert.throws(
    () => SchemaValidator.validateHeaders('AHT - Raw', aht.headers.concat('Speed to Answer2')),
    (error) => assertContractError(error, 'SCHEMA_DUPLICATE_COLUMNS'),
  );
});

// Defect caught: adapters emit different shapes or omit the active schema version from run metadata.
test('all five adapters can emit the same normalized DatasetPayload contract', () => {
  const DatasetPayload = loadModule('../src/ingestion/DatasetPayload.js');
  assert.equal(typeof DatasetPayload?.create, 'function');

  for (const [index, fixture] of fixtures.datasets.entries()) {
    const values = Object.fromEntries(
      fixture.keyFields.map((keyField) => [keyField, `synthetic-key-${index}`]),
    );
    const source =
      index % 2 === 0
        ? { artifactId: `source-${index}`, kind: 'single_dataset' }
        : {
            artifactId: `source-${index}`,
            kind: 'multi_sheet_workbook',
            sheetName: fixture.name,
          };
    const payload = DatasetPayload.create({
      datasetName: fixture.name,
      headers: fixture.headers,
      rows: [blankRow(fixture.headers, values)],
      runMetadata: {
        acquiredAtUtc: '2026-08-17T10:30:00.000Z',
        runId: 'synthetic-run',
      },
      source,
    });

    assert.equal(payload.contract, 'DatasetPayload');
    assert.equal(payload.contractVersion, '1.0.0');
    assert.equal(payload.datasetName, fixture.name);
    assert.equal(payload.schemaVersion, fixtures.schemaVersion);
    assert.deepEqual(payload.headers, fixture.headers);
    assert.equal(payload.records.length, 1);
    assert.deepEqual(payload.source, source);
    assert.deepEqual(payload.runMetadata, {
      acquiredAtUtc: '2026-08-17T10:30:00.000Z',
      runId: 'synthetic-run',
      schemaVersion: fixtures.schemaVersion,
    });
  }
});

// Defect caught: source datetimes drift from GMT, date labels shift, or blank/error/key rules diverge.
test('payload normalization enforces UTC dates, nulls, keys, types, and error tokens', () => {
  const DatasetPayload = loadModule('../src/ingestion/DatasetPayload.js');
  assert.equal(typeof DatasetPayload?.create, 'function');
  const handled = fixtures.datasets.find((fixture) => fixture.name === 'Handled');
  const validValues = {
    'Messaging Session Name': 'synthetic-session',
    'Start Time': '8/17/2026 4:01 AM',
    'Wait Time': '12.5',
    'Created Date': '8/17/2026',
    'Initial Queue': '   ',
    'Case Language': 'NA',
  };
  const input = {
    datasetName: 'Handled',
    headers: handled.headers,
    rows: [blankRow(handled.headers, validValues)],
    runMetadata: { runId: 'synthetic-run' },
    source: { artifactId: 'handled-fixture', kind: 'single_dataset' },
  };

  const payload = DatasetPayload.create(input);
  assert.equal(payload.records[0]['Start Time'], '2026-08-17T04:01:00.000Z');
  assert.equal(payload.records[0]['Created Date'], '2026-08-17');
  assert.equal(payload.records[0]['Wait Time'], 12.5);
  assert.equal(payload.records[0]['Initial Queue'], null);
  assert.equal(payload.records[0]['Case Language'], 'NA');

  const missingKeyRow = blankRow(handled.headers, validValues);
  missingKeyRow[handled.headers.indexOf('Messaging Session Name')] = ' ';
  assert.throws(
    () => DatasetPayload.create({ ...input, rows: [missingKeyRow] }),
    (error) => assertContractError(error, 'DATASET_MISSING_KEY'),
  );

  const errorRow = blankRow(handled.headers, validValues);
  errorRow[handled.headers.indexOf('Status')] = ' #REF! ';
  assert.throws(
    () => DatasetPayload.create({ ...input, rows: [errorRow] }),
    (error) => assertContractError(error, 'DATASET_ERROR_TOKEN'),
  );

  const invalidDateRow = blankRow(handled.headers, validValues);
  invalidDateRow[handled.headers.indexOf('Start Time')] = '2/29/2025 1:00 PM';
  assert.throws(
    () => DatasetPayload.create({ ...input, rows: [invalidDateRow] }),
    (error) => assertContractError(error, 'DATASET_INVALID_TYPE'),
  );
});

// Defect caught: oversized/empty exports or stale version labels enter a run unnoticed.
test('row-volume and schema-version gates fail closed', () => {
  const DatasetPayload = loadModule('../src/ingestion/DatasetPayload.js');
  const SchemaValidator = loadModule('../src/ingestion/SchemaValidator.js');
  assert.equal(typeof DatasetPayload?.create, 'function');
  assert.equal(typeof SchemaValidator?.validateRowVolume, 'function');
  const staff = fixtures.datasets.find((fixture) => fixture.name === 'Staff');

  assert.throws(
    () => SchemaValidator.validateRowVolume('Staff', 0),
    (error) => assertContractError(error, 'DATASET_ROW_VOLUME_OUT_OF_BOUNDS'),
  );
  assert.throws(
    () => SchemaValidator.validateRowVolume('Staff', 2001),
    (error) => assertContractError(error, 'DATASET_ROW_VOLUME_OUT_OF_BOUNDS'),
  );
  assert.throws(
    () =>
      DatasetPayload.create({
        datasetName: 'Staff',
        headers: staff.headers,
        rows: [blankRow(staff.headers, {})],
        runMetadata: { runId: 'synthetic-run', schemaVersion: '0.9.0' },
        source: { artifactId: 'staff-fixture', kind: 'single_dataset' },
      }),
    (error) => assertContractError(error, 'SCHEMA_VERSION_MISMATCH'),
  );
});
