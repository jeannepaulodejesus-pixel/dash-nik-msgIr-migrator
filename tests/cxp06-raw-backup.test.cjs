const assert = require('node:assert/strict');
const test = require('node:test');

const DatasetSheets = require('../src/config/DatasetSheets.js');
const {
  allNormalizedPayloads,
} = require('./helpers/cxp06-staging-fakes.cjs');
const {
  FakeProtection,
  FakeSpreadsheet,
  FakeUser,
} = require('./helpers/cxp06-transaction-fakes.cjs');

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

function matrixForPayload(payload) {
  return [payload.headers.slice()].concat(
    payload.records.map((record) =>
      payload.headers.map((header) => (record[header] === null ? '' : record[header])),
    ),
  );
}

function rawSpreadsheet(payloads, owner, otherEditor) {
  const spreadsheet = new FakeSpreadsheet([owner, otherEditor]);
  DatasetSheets.listBindings().forEach((binding) => {
    const payload = payloads.find((candidate) => candidate.datasetName === binding.datasetName);
    const sheet = spreadsheet.addSheet(binding.rawSheetName, matrixForPayload(payload));
    sheet.protections.push(
      new FakeProtection([owner, otherEditor], `CXP-02 managed protection: ${binding.rawSheetName}`),
    );
  });
  return spreadsheet;
}

// Defect caught: raw replacement clears some datasets before preflight detects a missing sheet or formula.
test('raw repository preflights formula-free sheets and replaces or restores all five in bulk', () => {
  const RawDataRepository = loadModule('../src/repository/RawDataRepository.js');
  assert.equal(typeof RawDataRepository?.create, 'function');
  const owner = new FakeUser('owner@example.test');
  const other = new FakeUser('rta@example.test');
  const originalPayloads = allNormalizedPayloads();
  const spreadsheet = rawSpreadsheet(originalPayloads, owner, other);
  const repository = RawDataRepository.create(spreadsheet);
  const originalSnapshots = repository.readAll();

  const changedPayloads = allNormalizedPayloads(
    Object.fromEntries(
      originalPayloads.map((payload) => [payload.datasetName, {
        ...payload,
        records: payload.records.map((record) =>
          Object.fromEntries(
            Object.entries(record).map(([key, value]) => [
              key,
              typeof value === 'string' ? `${value}-changed` : value + 10,
            ]),
          ),
        ),
      }]),
    ),
  );

  assert.deepEqual(repository.replaceAll(changedPayloads).datasetCount, 5);
  assert.deepEqual(
    spreadsheet.events.filter(([name]) => name === 'setValues').map((event) => event[1]),
    DatasetSheets.listBindings().map((binding) => binding.rawSheetName),
  );
  assert.equal(
    repository.readAll().every((snapshot) =>
      snapshot.formulas.every((row) => row.every((formula) => formula === '')),
    ),
    true,
  );

  repository.restoreAll(originalSnapshots);
  assert.deepEqual(
    repository.readAll().map((snapshot) => snapshot.values),
    originalSnapshots.map((snapshot) => snapshot.values),
  );

  const formulaSheet = spreadsheet.getSheetByName('_RAW_AHT');
  formulaSheet.formulas[1][0] = '=1+1';
  const eventCount = spreadsheet.events.length;
  assert.throws(
    () => repository.replaceAll(changedPayloads),
    (error) => error?.code === 'MIGRATION_COMMIT_FAILED',
  );
  assert.equal(spreadsheet.events.length, eventCount);
});

// Defect caught: the UAT mid-commit hook fires before any raw write instead of
// immediately after the second persisted dataset replacement.
test('raw repository exposes replacement and restore observers at persisted write seams', () => {
  const RawDataRepository = loadModule('../src/repository/RawDataRepository.js');
  const owner = new FakeUser('owner@example.test');
  const other = new FakeUser('rta@example.test');
  const payloads = allNormalizedPayloads();
  const spreadsheet = rawSpreadsheet(payloads, owner, other);
  const observed = [];
  const repository = RawDataRepository.create(spreadsheet, {
    observer: {
      afterReplacement(info) {
        observed.push(['replace', info.index, info.datasetName]);
        if (info.index === 1) {
          throw new Error('controlled failure after second replacement');
        }
      },
    },
  });

  assert.throws(
    () => repository.replaceAll(payloads),
    (error) => error?.code === 'MIGRATION_COMMIT_FAILED',
  );
  assert.deepEqual(observed, [
    ['replace', 0, 'Handled'],
    ['replace', 1, 'Offered'],
  ]);
  assert.equal(
    spreadsheet.events.filter(([name]) => name === 'setValues').length,
    2,
  );
});

// Defect caught: rollback transfers every peak-sized backup matrix through the
// Apps Script runtime and five setValues calls, exhausting the hosted limit
// even when the incoming UAT bundle is small.
test('raw rollback restores backup sheets with five server-side values-only copies', () => {
  const RawDataRepository = loadModule('../src/repository/RawDataRepository.js');
  const owner = new FakeUser('owner@example.test');
  const payloads = allNormalizedPayloads();
  const spreadsheet = rawSpreadsheet(payloads, owner, new FakeUser('other@example.test'));
  const runId = 'server-copy-restore';
  const tokenByDataset = {
    'AHT - Raw': 'AHT',
    'Auxes - Raw': 'AUXES',
    Handled: 'HANDLED',
    Offered: 'OFFERED',
    Staff: 'STAFF',
  };
  const sheetsByDataset = {};

  DatasetSheets.listBindings().forEach((binding) => {
    const raw = spreadsheet.getSheetByName(binding.rawSheetName);
    const backupName = `_CXP06_BAK_${tokenByDataset[binding.datasetName]}_${runId}`;
    spreadsheet.addSheet(backupName, raw.values.map((row) => row.slice()));
    sheetsByDataset[binding.datasetName] = { sheetName: backupName };
    raw.values = [['changed']];
    raw.formulas = [['']];
  });

  const observed = [];
  const repository = RawDataRepository.create(spreadsheet, {
    observer: {
      afterRestoreWrite(info) {
        observed.push(info);
      },
    },
  });
  const eventStart = spreadsheet.events.length;
  const result = repository.restoreGroup({
    complete: true,
    runId,
    sheetsByDataset,
  });
  const restoreEvents = spreadsheet.events.slice(eventStart);

  assert.deepEqual(result, { datasetCount: 5 });
  assert.equal(restoreEvents.filter(([name]) => name === 'rangeCopyTo').length, 5);
  assert.equal(restoreEvents.some(([name]) => name === 'setValues'), false);
  assert.equal(
    restoreEvents
      .filter(([name]) => name === 'rangeCopyTo')
      .every((event) => event[3]?.contentsOnly === true),
    true,
  );
  assert.deepEqual(
    observed.map(({ datasetName, index }) => ({ datasetName, index })),
    DatasetSheets.listBindings().map((binding, index) => ({
      datasetName: binding.datasetName,
      index,
    })),
  );
});

// Defect caught: backups rely on copied visibility/protection or are deleted before group verification.
test('backup repository creates verified hidden protected groups and deletes only that group', () => {
  const BackupRepository = loadModule('../src/repository/BackupRepository.js');
  assert.equal(typeof BackupRepository?.create, 'function');
  const owner = new FakeUser('owner@example.test');
  const other = new FakeUser('rta@example.test');
  const payloads = allNormalizedPayloads();
  const spreadsheet = rawSpreadsheet(payloads, owner, other);
  const repository = BackupRepository.create(spreadsheet, {
    session: { getEffectiveUser: () => owner },
    spreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
  });

  const group = repository.createGroup('run-cxp06');

  assert.equal(group.complete, true);
  assert.equal(Object.keys(group.sheetsByDataset).length, 5);
  assert.deepEqual(
    Object.values(group.sheetsByDataset).map((sheet) => sheet.getName()),
    [
      '_CXP06_BAK_HANDLED_run-cxp06',
      '_CXP06_BAK_OFFERED_run-cxp06',
      '_CXP06_BAK_AHT_run-cxp06',
      '_CXP06_BAK_AUXES_run-cxp06',
      '_CXP06_BAK_STAFF_run-cxp06',
    ],
  );
  for (const sheet of Object.values(group.sheetsByDataset)) {
    assert.equal(sheet.hidden, true);
    const protections = sheet.getProtections('SHEET');
    assert.equal(protections.length, 1);
    assert.equal(protections[0].getDescription(), `CXP-06 backup protection: ${sheet.getName()}`);
    assert.deepEqual(protections[0].getEditors().map((editor) => editor.getEmail()), [
      'owner@example.test',
    ]);
    assert.equal(protections[0].canDomainEdit(), false);
    assert.deepEqual(protections[0].targetAudiences, []);
    assert.deepEqual(protections[0].unprotectedRanges, []);
  }

  const discovered = repository.discoverGroups();
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].runId, 'run-cxp06');
  assert.equal(discovered[0].complete, true);
  assert.deepEqual(
    repository.readGroup(discovered[0]).map((snapshot) => snapshot.values),
    payloads.map(matrixForPayload),
  );

  repository.deleteGroup(discovered[0]);
  assert.equal(repository.discoverGroups().length, 0);
  assert.equal(
    DatasetSheets.listBindings().every((binding) => spreadsheet.getSheetByName(binding.rawSheetName)),
    true,
  );
});

// Defect caught: recovery discovery treats a partial prior copy set as a complete rollback source.
test('backup repository reports incomplete run-scoped groups without exposing cell values', () => {
  const BackupRepository = loadModule('../src/repository/BackupRepository.js');
  assert.equal(typeof BackupRepository?.create, 'function');
  const owner = new FakeUser('owner@example.test');
  const other = new FakeUser('rta@example.test');
  const payloads = allNormalizedPayloads();
  const spreadsheet = rawSpreadsheet(payloads, owner, other);
  const source = spreadsheet.getSheetByName('_RAW_HANDLED');
  source.copyTo(spreadsheet).setName('_CXP06_BAK_HANDLED_interrupted-run');
  const repository = BackupRepository.create(spreadsheet, {
    session: { getEffectiveUser: () => owner },
    spreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
  });

  const groups = repository.discoverGroups();
  assert.equal(groups.length, 1);
  assert.equal(groups[0].complete, false);
  assert.equal(groups[0].runId, 'interrupted-run');
  assert.deepEqual(Object.keys(groups[0].sheetsByDataset), ['Handled']);
  assert.equal(JSON.stringify(groups).includes('Case:'), false);
});
