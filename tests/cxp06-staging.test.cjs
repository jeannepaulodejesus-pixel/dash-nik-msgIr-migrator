const assert = require('node:assert/strict');
const test = require('node:test');

const SchemaRegistry = require('../src/ingestion/SchemaRegistry.js');
const DatasetSheets = require('../src/config/DatasetSheets.js');

const {
  TransactionSpreadsheet,
  allNormalizedPayloads,
  cloneSnapshots,
  normalizedPayload,
  snapshotsForPayloads,
  stagingSpreadsheet,
} = require('./helpers/cxp06-staging-fakes.cjs');

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

// Defect caught: staging starts destructive clears before proving all five stage sheets exist.
test('staging repository preflights all sheets and performs one bulk write per dataset', () => {
  const StagingRepository = loadModule('../src/repository/StagingRepository.js');
  assert.equal(typeof StagingRepository?.create, 'function');
  const spreadsheet = stagingSpreadsheet();
  const payloads = allNormalizedPayloads();
  const repository = StagingRepository.create(spreadsheet);

  const summary = repository.writeAll(payloads);
  const snapshots = repository.readAll();

  assert.deepEqual(summary, {
    datasetCount: 5,
    rowCounts: {
      'AHT - Raw': 1,
      'Auxes - Raw': 1,
      Handled: 1,
      Offered: 1,
      Staff: 1,
    },
  });
  assert.equal(spreadsheet.events.filter(([name]) => name === 'clearContent').length, 5);
  assert.deepEqual(
    spreadsheet.events.filter(([name]) => name === 'setValues').map((event) => event[1]),
    ['_STG_HANDLED', '_STG_OFFERED', '_STG_AHT', '_STG_AUXES', '_STG_STAFF'],
  );
  assert.equal(snapshots.length, 5);
  assert.deepEqual(snapshots[0].values[0], payloads[0].headers);

  const missing = new TransactionSpreadsheet(['_STG_HANDLED']);
  assert.throws(
    () => StagingRepository.create(missing).writeAll(payloads),
    (error) => error?.code === 'MIGRATION_STAGE_WRITE_FAILED',
  );
  assert.deepEqual(missing.events, []);
});

// Defect caught: a continuation cannot reconstruct canonical payloads from protected staging sheets.
test('staging repository reconstructs a bounded checkpoint payload set for a fresh invocation', () => {
  const StageValidator = loadModule('../src/validation/StageValidator.js');
  const StagingRepository = loadModule('../src/repository/StagingRepository.js');
  const spreadsheet = stagingSpreadsheet();
  const originalPayloads = allNormalizedPayloads();
  const repository = StagingRepository.create(spreadsheet);
  repository.writeAll(originalPayloads);

  assert.equal(typeof repository.readCheckpoint, 'function');
  const restored = repository.readCheckpoint({
    runId: 'run-cxp06-resumed',
    schemaVersion: '1.0.0',
  });

  assert.equal(restored.payloads.length, 5);
  assert.equal(restored.snapshots.length, 5);
  assert.deepEqual(
    restored.payloads.map((payload) => [payload.datasetName, payload.rowCount]),
    originalPayloads.map((payload) => [payload.datasetName, payload.rowCount]),
  );
  assert.deepEqual(
    StageValidator.validate(restored.payloads, restored.snapshots).rowCounts,
    {
      'AHT - Raw': 1,
      'Auxes - Raw': 1,
      Handled: 1,
      Offered: 1,
      Staff: 1,
    },
  );
});

// Defect caught: Apps Script getValues rehydrates staged date cells as Date
// objects, but readCheckpoint retains them in the payload and validation then
// compares Date objects with its canonical ISO-string snapshot.
test('checkpoint reconstruction canonicalizes Apps Script Date values before validation', () => {
  const StageValidator = loadModule('../src/validation/StageValidator.js');
  const StagingRepository = loadModule('../src/repository/StagingRepository.js');
  const spreadsheet = stagingSpreadsheet();
  const repository = StagingRepository.create(spreadsheet);
  repository.writeAll(allNormalizedPayloads());

  DatasetSheets.listBindings().forEach((binding) => {
    const schema = SchemaRegistry.getSchema(binding.datasetName);
    const sheet = spreadsheet.getSheetByName(binding.stagingSheetName);
    schema.columns.forEach((column, columnIndex) => {
      if (column.type === 'date') {
        sheet.values[1][columnIndex] = new Date(`${sheet.values[1][columnIndex]}T00:00:00.000Z`);
      } else if (column.type === 'date_time') {
        sheet.values[1][columnIndex] = new Date(sheet.values[1][columnIndex]);
      }
    });
  });

  const restored = repository.readCheckpoint({
    runId: 'run-cxp06-date-resume',
    schemaVersion: '1.0.0',
  });

  assert.equal(
    restored.payloads.find((payload) => payload.datasetName === 'Handled')
      .records[0]['Start Time'],
    '2026-08-21T04:00:00.000Z',
  );
  assert.equal(StageValidator.validate(restored.payloads, restored.snapshots).datasetCount, 5);
});

// Defect caught: a hosted commit continuation reconstructs and validates all
// five staged datasets even though its cursor can advance only one dataset.
test('staging checkpoint resume reads and validates only the requested dataset', () => {
  const StageValidator = loadModule('../src/validation/StageValidator.js');
  const StagingRepository = loadModule('../src/repository/StagingRepository.js');
  const spreadsheet = stagingSpreadsheet();
  const repository = StagingRepository.create(spreadsheet);
  repository.writeAll(allNormalizedPayloads());
  const reads = [];

  DatasetSheets.listBindings().forEach((binding) => {
    const sheet = spreadsheet.getSheetByName(binding.stagingSheetName);
    const originalGetDataRange = sheet.getDataRange.bind(sheet);
    sheet.getDataRange = () => {
      reads.push(binding.stagingSheetName);
      return originalGetDataRange();
    };
  });

  assert.equal(typeof repository.readDatasetCheckpoint, 'function');
  assert.equal(typeof StageValidator.validateDatasetCheckpoint, 'function');
  const restored = repository.readDatasetCheckpoint({
    runId: 'run-cxp06-dataset-resume',
    schemaVersion: '1.0.0',
  }, 'AHT - Raw');

  assert.deepEqual(reads, ['_STG_AHT']);
  assert.equal(restored.payload.datasetName, 'AHT - Raw');
  assert.equal(restored.snapshot.datasetName, 'AHT - Raw');
  assert.deepEqual(
    StageValidator.validateDatasetCheckpoint(restored.payload, restored.snapshot),
    { datasetName: 'AHT - Raw', rowCount: 1 },
  );
  assert.throws(
    () => repository.readDatasetCheckpoint({
      runId: 'run-cxp06-dataset-resume',
      schemaVersion: '1.0.0',
    }, 'Unknown'),
    (error) => error?.code === 'MIGRATION_STAGE_WRITE_FAILED',
  );
});

// Defect caught: a persisted stage can diverge from the normalized payload without stopping commit.
test('stage validation accepts only exact formula-free persisted normalized payloads', () => {
  const StageValidator = loadModule('../src/validation/StageValidator.js');
  const StagingRepository = loadModule('../src/repository/StagingRepository.js');
  assert.equal(typeof StageValidator?.validate, 'function');
  assert.equal(typeof StagingRepository?.create, 'function');
  const spreadsheet = stagingSpreadsheet();
  const payloads = allNormalizedPayloads();
  const repository = StagingRepository.create(spreadsheet);
  repository.writeAll(payloads);

  assert.deepEqual(StageValidator.validate(payloads, repository.readAll()), {
    datasetCount: 5,
    rowCounts: {
      'AHT - Raw': 1,
      'Auxes - Raw': 1,
      Handled: 1,
      Offered: 1,
      Staff: 1,
    },
  });

  const handledPayload = payloads.find((payload) => payload.datasetName === 'Handled');
  const caseNumberIndex = handledPayload.headers.indexOf('Case: Case Number');
  handledPayload.records[0]['Case: Case Number'] = '880000001';
  const coercedSnapshots = snapshotsForPayloads(payloads);
  coercedSnapshots.find((snapshot) => snapshot.datasetName === 'Handled')
    .values[1][caseNumberIndex] = 880000001;

  payloads.forEach((payload) => {
    const schema = SchemaRegistry.getSchema(payload.datasetName);
    const snapshot = coercedSnapshots.find(
      (candidate) => candidate.datasetName === payload.datasetName,
    );
    schema.columns.forEach((column, columnIndex) => {
      if (column.type === 'date') {
        snapshot.values[1][columnIndex] = new Date(
          payload.records[0][column.name] + 'T08:00:00.000Z',
        );
      } else if (column.type === 'date_time') {
        snapshot.values[1][columnIndex] = new Date(payload.records[0][column.name]);
      }
    });
  });

  assert.equal(StageValidator.validate(payloads, coercedSnapshots).rowCounts.Handled, 1);
});

// Defect caught: stage formulas, duplicate keys, invalid dates, or wrong text types reach raw data.
test('stage validation fails closed with a bounded reason for every persisted-stage violation', () => {
  const StageValidator = loadModule('../src/validation/StageValidator.js');
  assert.equal(typeof StageValidator?.validate, 'function');
  const twoHandled = normalizedPayload('Handled', 2);
  const payloads = allNormalizedPayloads({ Handled: twoHandled });
  const snapshots = snapshotsForPayloads(payloads);

  const cases = [
    {
      mutate(copy) {
        copy[0].formulas[1][0] = '=1+1';
      },
      reason: 'formulas_not_allowed',
    },
    {
      mutate(copy) {
        copy[0].values[0][0] = 'Wrong Header';
      },
      reason: 'invalid_headers',
    },
    {
      mutate(copy) {
        const keyIndex = copy[0].values[0].indexOf('Messaging Session Name');
        copy[0].values[2][keyIndex] = copy[0].values[1][keyIndex];
      },
      reason: 'duplicate_key',
    },
    {
      mutate(copy) {
        const dateIndex = copy[0].values[0].indexOf('Created Date');
        copy[0].values[1][dateIndex] = '2026-02-30';
      },
      reason: 'invalid_type',
    },
    {
      mutate(copy) {
        const queueIndex = copy[0].values[0].indexOf('Initial Queue');
        copy[0].values[1][queueIndex] = true;
      },
      reason: 'invalid_type',
    },
  ];

  for (const scenario of cases) {
    const copy = cloneSnapshots(snapshots);
    scenario.mutate(copy);
    assert.throws(
      () => StageValidator.validate(payloads, copy),
      (error) =>
        error?.code === 'MIGRATION_STAGE_VALIDATION_FAILED' &&
        error.details.reason === scenario.reason,
      scenario.reason,
    );
  }

  assert.throws(
    () => StageValidator.validate(payloads, snapshots.slice(0, 4)),
    (error) =>
      error?.code === 'MIGRATION_STAGE_VALIDATION_FAILED' &&
      error.details.reason === 'datasets_mismatch',
  );
  assert.throws(
    () => StageValidator.validate(
      payloads.map((payload, index) =>
        index === 0 ? { ...payload, schemaVersion: '0.9.0' } : payload,
      ),
      snapshots,
    ),
    (error) =>
      error?.code === 'MIGRATION_STAGE_VALIDATION_FAILED' &&
      error.details.reason === 'schema_version_mismatch',
  );

  assert.throws(
    () => StageValidator.validate(
      payloads.map((payload, index) => {
        if (index !== 0) {
          return payload;
        }
        const { runMetadata, ...withoutRunMetadata } = payload;
        return withoutRunMetadata;
      }),
      snapshots,
    ),
    (error) =>
      error?.code === 'MIGRATION_STAGE_VALIDATION_FAILED' &&
      error.details.reason === 'schema_version_mismatch',
  );
});
