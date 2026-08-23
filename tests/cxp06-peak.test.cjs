const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const test = require('node:test');

const DatasetSheets = require('../src/config/DatasetSheets.js');
const RawDataRepository = require('../src/repository/RawDataRepository.js');
const SchemaRegistry = require('../src/ingestion/SchemaRegistry.js');
const StageValidator = require('../src/validation/StageValidator.js');
const StagingRepository = require('../src/repository/StagingRepository.js');
const { FakeSpreadsheet } = require('./helpers/cxp06-transaction-fakes.cjs');

function baseValue(column) {
  if (column.type === 'date_time') {
    return '2026-08-23T04:00:00.000Z';
  }
  if (column.type === 'date') {
    return '2026-08-23';
  }
  if (column.type === 'number') {
    return 1;
  }
  return `${column.name}-peak`;
}

function peakPayload(schema) {
  const baseRecord = Object.fromEntries(
    schema.columns.map((column) => [column.name, baseValue(column)]),
  );
  const records = Array.from({ length: schema.rowVolume.maximum }, (_, rowIndex) => {
    const record = Object.create(baseRecord);
    if (schema.keyFields.length > 0) {
      schema.keyFields.forEach((keyField) => {
        record[keyField] = `${baseRecord[keyField]}-${rowIndex + 1}`;
      });
    } else {
      record['Athlete Display Name'] = `Peak Athlete ${rowIndex + 1}`;
    }
    return record;
  });
  return {
    datasetName: schema.name,
    headers: schema.requiredHeaders.slice(),
    records,
    rowCount: records.length,
    runMetadata: { runId: 'run-cxp06-peak', schemaVersion: '1.0.0' },
    schemaVersion: '1.0.0',
  };
}

// Defect caught: peak-sized input degenerates into row/cell calls or omits a dataset.
test('peak declared volumes keep staging and raw writes constant per dataset', (context) => {
  const payloads = SchemaRegistry.listSchemas().map(peakPayload);
  const spreadsheet = new FakeSpreadsheet([]);
  DatasetSheets.listBindings().forEach((binding) => {
    spreadsheet.addSheet(binding.stagingSheetName, [['stale']]);
    spreadsheet.addSheet(binding.rawSheetName, [['old']]);
  });
  const staging = StagingRepository.create(spreadsheet);
  const raw = RawDataRepository.create(spreadsheet);
  const started = performance.now();

  const stageSummary = staging.writeAll(payloads);
  StageValidator.validate(payloads, staging.readAll());
  const rawSummary = raw.replaceAll(payloads);
  StageValidator.validate(payloads, raw.readAll());

  const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  const setValuesEvents = spreadsheet.events.filter(([name]) => name === 'setValues');
  const clearEvents = spreadsheet.events.filter(([name]) => name === 'clearContent');
  const expectedRows = {
    'AHT - Raw': 15000,
    'Auxes - Raw': 7500,
    Handled: 10000,
    Offered: 10000,
    Staff: 2000,
  };

  assert.deepEqual(stageSummary.rowCounts, expectedRows);
  assert.deepEqual(rawSummary.rowCounts, expectedRows);
  assert.equal(setValuesEvents.length, 10);
  assert.equal(clearEvents.length, 10);
  assert.equal(spreadsheet.events.some(([name]) => name === 'setValue'), false);
  assert.equal(
    raw.readAll().every((snapshot) =>
      snapshot.formulas.every((row) => row.every((formula) => formula === '')),
    ),
    true,
  );
  assert.ok(elapsedMs < 30000, `synthetic peak run exceeded 30 seconds: ${elapsedMs}`);
  assert.ok(JSON.stringify(stageSummary).length < 500);
  assert.ok(JSON.stringify(rawSummary).length < 500);
  context.diagnostic(JSON.stringify({
    clearContentCalls: clearEvents.length,
    elapsedMs,
    rows: expectedRows,
    setValuesCalls: setValuesEvents.length,
    totalRows: Object.values(expectedRows).reduce((sum, value) => sum + value, 0),
  }));
});
