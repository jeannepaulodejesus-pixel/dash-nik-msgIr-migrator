const assert = require('node:assert/strict');
const test = require('node:test');

const CommitService = require('../src/services/CommitService.js');
const DatasetSheets = require('../src/config/DatasetSheets.js');
const { allNormalizedPayloads } = require('./helpers/cxp06-staging-fakes.cjs');
const { FakeSpreadsheet, FakeUser } = require('./helpers/cxp06-transaction-fakes.cjs');

function matrixForPayload(payload) {
  return [payload.headers.slice()].concat(
    payload.records.map((record) =>
      payload.headers.map((header) => (record[header] === null ? '' : record[header])),
    ),
  );
}

// Defect caught: failed backup creation leaves avoidable partial copies before any raw mutation.
test('backup creation failure cleans its partial run group while leaving raw untouched', () => {
  const owner = new FakeUser('owner@example.test');
  const payloads = allNormalizedPayloads();
  const target = new FakeSpreadsheet([owner]);
  DatasetSheets.listBindings().forEach((binding) => {
    target.addSheet(binding.stagingSheetName, [['stale']]);
    const payload = payloads.find((candidate) => candidate.datasetName === binding.datasetName);
    target.addSheet(binding.rawSheetName, matrixForPayload(payload));
  });
  const originalRaw = DatasetSheets.listBindings().map((binding) =>
    target.getSheetByName(binding.rawSheetName).values.map((row) => row.slice()),
  );
  target.getSheetByName('_RAW_AHT').copyTo = () => {
    throw new Error('synthetic backup copy failure');
  };
  const ledger = {
    append() {},
    findSuccessfulByFingerprint() { return null; },
    findSuccessfulByRunId() { return null; },
  };
  const operations = CommitService.createOperations({
    clock: { now: () => new Date('2026-08-23T00:00:00.000Z') },
    flush() {},
    ledgerRepository: ledger,
    session: { getEffectiveUser: () => owner },
    spreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
    targetSpreadsheet: target,
  });
  const context = {
    operationResults: {
      checkDuplicate: {
        fingerprint: 'sha256:backup-failure',
        payloads,
        sourceFiles: [{ fileId: 'source-id', fileName: 'source.xlsx' }],
      },
      validateSchema: { payloads },
    },
    request: { schemaVersion: '1.0.0' },
    runId: 'run-backup-failure',
  };
  operations.stage(context);
  operations.validateStage(context);

  assert.throws(
    () => operations.commit(context),
    (error) => error?.code === 'MIGRATION_BACKUP_FAILED',
  );
  assert.equal(
    target.getSheets().filter((sheet) => sheet.getName().startsWith('_CXP06_BAK_')).length,
    0,
  );
  assert.deepEqual(
    DatasetSheets.listBindings().map((binding) =>
      target.getSheetByName(binding.rawSheetName).values,
    ),
    originalRaw,
  );
  assert.equal(
    target.events.some(
      ([name, sheetName]) => name === 'clearContent' && sheetName?.startsWith('_RAW_'),
    ),
    false,
  );
});
