const assert = require('node:assert/strict');
const test = require('node:test');

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
        copy[0].values[1][queueIndex] = 7;
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
