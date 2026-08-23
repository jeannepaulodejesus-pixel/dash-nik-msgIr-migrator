const assert = require('node:assert/strict');
const test = require('node:test');

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

// Defect caught: transaction code binds a payload to the wrong staging or raw sheet.
test('dataset sheet registry exposes the exact immutable five-dataset transaction order', () => {
  const DatasetSheets = loadModule('../src/config/DatasetSheets.js');
  assert.equal(typeof DatasetSheets?.listBindings, 'function');
  assert.equal(typeof DatasetSheets?.getByDatasetName, 'function');

  const bindings = DatasetSheets.listBindings();
  assert.deepEqual(bindings, [
    {
      datasetName: 'Handled',
      rawSheetName: '_RAW_HANDLED',
      stagingSheetName: '_STG_HANDLED',
    },
    {
      datasetName: 'Offered',
      rawSheetName: '_RAW_OFFERED',
      stagingSheetName: '_STG_OFFERED',
    },
    {
      datasetName: 'AHT - Raw',
      rawSheetName: '_RAW_AHT',
      stagingSheetName: '_STG_AHT',
    },
    {
      datasetName: 'Auxes - Raw',
      rawSheetName: '_RAW_AUXES',
      stagingSheetName: '_STG_AUXES',
    },
    {
      datasetName: 'Staff',
      rawSheetName: '_RAW_STAFF',
      stagingSheetName: '_STG_STAFF',
    },
  ]);
  assert.equal(Object.isFrozen(bindings), true);
  assert.equal(Object.isFrozen(bindings[0]), true);
  assert.strictEqual(DatasetSheets.getByDatasetName('AHT - Raw'), bindings[2]);
  assert.throws(
    () => DatasetSheets.getByDatasetName('Unknown'),
    (error) => error?.code === 'SCHEMA_UNKNOWN_DATASET',
  );
});

// Defect caught: the Sheets transport changes normalized nulls or scalar types.
test('sheet value codec round-trips controlled blanks without coercing other values', () => {
  const SheetValueCodec = loadModule('../src/services/SheetValueCodec.js');
  assert.equal(typeof SheetValueCodec?.encodePayload, 'function');
  assert.equal(typeof SheetValueCodec?.decodeMatrix, 'function');
  assert.equal(typeof SheetValueCodec?.matricesEqual, 'function');

  const matrix = SheetValueCodec.encodePayload({
    datasetName: 'Staff',
    headers: ['Name', 'Count', 'Enabled', 'When', 'Optional'],
    records: [
      {
        Count: 0,
        Enabled: false,
        Name: 'Athlete',
        Optional: null,
        When: '2026-08-23T00:00:00.000Z',
      },
    ],
  });

  assert.deepEqual(matrix, [
    ['Name', 'Count', 'Enabled', 'When', 'Optional'],
    ['Athlete', 0, false, '2026-08-23T00:00:00.000Z', ''],
  ]);
  assert.deepEqual(SheetValueCodec.decodeMatrix('Staff', matrix), {
    datasetName: 'Staff',
    headers: ['Name', 'Count', 'Enabled', 'When', 'Optional'],
    records: [
      {
        Count: 0,
        Enabled: false,
        Name: 'Athlete',
        Optional: null,
        When: '2026-08-23T00:00:00.000Z',
      },
    ],
  });
  assert.equal(SheetValueCodec.matricesEqual(matrix, matrix.map((row) => row.slice())), true);
  assert.equal(
    SheetValueCodec.matricesEqual(matrix, [matrix[0], ['Athlete', '0', false, matrix[1][3], '']]),
    false,
  );
});

// Defect caught: transactional failures collapse into generic migration errors.
test('error taxonomy defines distinct CXP-06 write, backup, recovery, and rollback codes', () => {
  const ErrorCodes = require('../src/monitoring/ErrorCodes.js');
  for (const code of [
    'MIGRATION_STAGE_WRITE_FAILED',
    'MIGRATION_BACKUP_FAILED',
    'MIGRATION_RECOVERY_FAILED',
    'MIGRATION_ROLLBACK_FAILED',
  ]) {
    const definition = ErrorCodes.get(code);
    assert.equal(definition?.category, 'MIGRATION_CALCULATION', code);
  }
});
