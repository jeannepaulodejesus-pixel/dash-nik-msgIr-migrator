const assert = require('node:assert/strict');
const test = require('node:test');

function loadSeeder() {
  return require('../src/uat/Cxp06BackupTopologySeeder.js');
}

const DATASETS = ['Handled', 'Offered', 'AHT - Raw', 'Auxes - Raw', 'Staff'];
const TOKENS = {
  'AHT - Raw': 'AHT',
  'Auxes - Raw': 'AUXES',
  Handled: 'HANDLED',
  Offered: 'OFFERED',
  Staff: 'STAFF',
};

function fixture(options = {}) {
  const events = [];
  const existingGroups = options.existingGroups || [];
  const tokens = (options.tokens || ['token1', 'token2']).slice();
  const sheets = new Map();

  const backupRepository = {
    discoverGroups() {
      events.push(['discoverGroups']);
      if (options.discoveryError) {
        throw options.discoveryError;
      }
      return existingGroups;
    },
    createGroup(runId) {
      events.push(['createGroup', runId]);
      if (options.createErrorAt === events.filter(([name]) => name === 'createGroup').length) {
        throw new Error('sensitive backup creation details');
      }
      const sheetsByDataset = {};
      DATASETS.forEach((datasetName) => {
        const sheetName = `_CXP06_BAK_${TOKENS[datasetName]}_${runId}`;
        const sheet = { datasetName, sheetName };
        sheets.set(sheetName, sheet);
        sheetsByDataset[datasetName] = Object.freeze({ datasetName, sheetName });
      });
      return Object.freeze({
        complete: true,
        runId,
        sheetsByDataset: Object.freeze(sheetsByDataset),
      });
    },
  };

  const appended = [];
  const ledgerRepository = {
    append(records) {
      events.push(['append', records]);
      appended.push(...records);
      if (options.appendError) {
        throw new Error('sensitive ledger write details');
      }
    },
    findSuccessfulByRunId(runId) {
      events.push(['findSuccessfulByRunId', runId]);
      if (options.confirmationError) {
        throw new Error('sensitive ledger read details');
      }
      if (options.confirmationMismatch) {
        return { result: 'SUCCESS', runId: 'different-run' };
      }
      return appended.find((record) => record.runId === runId) || null;
    },
  };

  const targetSpreadsheet = {
    deleteSheet(sheet) {
      events.push(['deleteSheet', sheet.sheetName]);
      sheets.delete(sheet.sheetName);
    },
    getSheetByName(sheetName) {
      events.push(['getSheetByName', sheetName]);
      return sheets.get(sheetName) || null;
    },
  };

  return {
    appended,
    dependencies: {
      backupRepository,
      ledgerRepository,
      now: () => new Date('2026-08-24T12:00:00.000Z'),
      targetSpreadsheet,
      uniqueToken: () => tokens.shift(),
    },
    events,
  };
}

function assertSeedFailure(action, reason) {
  assert.throws(
    action,
    (error) => error?.code === 'UAT_BACKUP_TOPOLOGY_SEED_FAILED' &&
      error?.details?.reason === reason &&
      !JSON.stringify(error).includes('sensitive'),
  );
}

// Defect caught: incomplete recovery UAT silently creates a complete group,
// so reconciliation tests restore instead of discarding partial evidence.
test('incomplete topology retains only the deterministic Handled backup', () => {
  const { dependencies, events } = fixture();
  const result = loadSeeder().create(dependencies).seed('CASE5_INCOMPLETE_BACKUP');

  assert.deepEqual(result, {
    groupCount: 1,
    runIds: ['UATSEED_INC_token1'],
    scenario: 'CASE5_INCOMPLETE_BACKUP',
    sheetNames: ['_CXP06_BAK_HANDLED_UATSEED_INC_token1'],
  });
  assert.deepEqual(
    events.filter(([name]) => name === 'deleteSheet').map(([, sheetName]) => sheetName),
    [
      '_CXP06_BAK_OFFERED_UATSEED_INC_token1',
      '_CXP06_BAK_AHT_UATSEED_INC_token1',
      '_CXP06_BAK_AUXES_UATSEED_INC_token1',
      '_CXP06_BAK_STAFF_UATSEED_INC_token1',
    ],
  );
});

// Defect caught: an unfinished group is incorrectly marked successful and is
// deleted without exercising the restore-and-verify recovery path.
test('complete unsuccessful topology creates one group without ledger mutation', () => {
  const { dependencies, events } = fixture();
  const result = loadSeeder().create(dependencies)
    .seed('CASE5_COMPLETE_UNSUCCESSFUL_BACKUP');

  assert.equal(result.groupCount, 1);
  assert.deepEqual(result.runIds, ['UATSEED_UNFIN_token1']);
  assert.equal(result.sheetNames.length, 5);
  assert.equal(events.some(([name]) => name === 'append'), false);
  assert.equal(events.some(([name]) => name === 'deleteSheet'), false);
});

// Defect caught: the successful-leftover topology proceeds without a confirmed
// SUCCESS row, causing production recovery to restore committed raw data.
test('successful leftover appends and confirms one bounded synthetic SUCCESS record', () => {
  const { appended, dependencies } = fixture();
  const result = loadSeeder().create(dependencies)
    .seed('CASE5_SUCCESSFUL_LEFTOVER_BACKUP');

  assert.deepEqual(result.runIds, ['UATSEED_SUCCESS_token1']);
  assert.deepEqual(appended, [{
    checkedAtUtc: '2026-08-24T12:00:00.000Z',
    datasetNames: [],
    fingerprint: 'uat-seed:UATSEED_SUCCESS_token1',
    fingerprintAlgorithm: 'UAT-SEED',
    result: 'SUCCESS',
    runId: 'UATSEED_SUCCESS_token1',
    schemaVersion: '1.0.0',
    sourceFileIds: [],
    sourceFileNames: [],
  }]);
});

// Defect caught: the ambiguous-recovery case creates one group twice under the
// same ID, so production reconciliation never sees two unfinished groups.
test('ambiguous topology creates two distinct complete unsuccessful groups', () => {
  const { dependencies, events } = fixture();
  const result = loadSeeder().create(dependencies)
    .seed('CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS');

  assert.deepEqual(result.runIds, ['UATSEED_AMBIG_token1', 'UATSEED_AMBIG_token2']);
  assert.equal(result.groupCount, 2);
  assert.equal(result.sheetNames.length, 10);
  assert.equal(events.filter(([name]) => name === 'createGroup').length, 2);
  assert.equal(events.some(([name]) => name === 'append'), false);
});

// Defect caught: a topology run erases retained recovery evidence before
// creating its seed, hiding the state that blocked the prior writer.
test('dirty starting topology fails before every mutation', () => {
  const { dependencies, events } = fixture({
    existingGroups: [{ complete: true, runId: 'prior-run', sheetsByDataset: {} }],
  });

  assertSeedFailure(
    () => loadSeeder().create(dependencies).seed('CASE5_INCOMPLETE_BACKUP'),
    'existing_backup_topology',
  );
  assert.deepEqual(events, [['discoverGroups']]);
});

// Defect caught: setup errors leak spreadsheet or ledger dependency messages
// and speculative cleanup removes partial backup evidence.
test('setup failures are sanitized and retain partial evidence', () => {
  for (const [options, scenario, reason] of [
    [{ discoveryError: new Error('sensitive malformed sheet name') }, 'CASE5_INCOMPLETE_BACKUP', 'backup_discovery_failed'],
    [{ createErrorAt: 1 }, 'CASE5_COMPLETE_UNSUCCESSFUL_BACKUP', 'backup_group_creation_failed'],
    [{ appendError: true }, 'CASE5_SUCCESSFUL_LEFTOVER_BACKUP', 'ledger_confirmation_failed'],
    [{ confirmationMismatch: true }, 'CASE5_SUCCESSFUL_LEFTOVER_BACKUP', 'ledger_confirmation_failed'],
    [{ tokens: ['same', 'same'] }, 'CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS', 'duplicate_seed_run_id'],
  ]) {
    const { dependencies, events } = fixture(options);
    assertSeedFailure(() => loadSeeder().create(dependencies).seed(scenario), reason);
    if (events.some(([name]) => name === 'createGroup')) {
      assert.equal(events.some(([name]) => name === 'deleteSheet'), false);
    }
  }
});

// Defect caught: unsupported scenarios or unsafe token generators reach backup
// creation with uncontrolled Apps Script sheet names.
test('unsupported scenarios, invalid tokens, and incomplete services fail before mutation', () => {
  const unsupported = fixture();
  assertSeedFailure(
    () => loadSeeder().create(unsupported.dependencies).seed('CASE1_PEAK_SUCCESS'),
    'unsupported_scenario',
  );
  assert.equal(unsupported.events.length, 0);

  for (const token of ['', 'bad token', 'x'.repeat(80)]) {
    const invalid = fixture({ tokens: [token] });
    assertSeedFailure(
      () => loadSeeder().create(invalid.dependencies).seed('CASE5_INCOMPLETE_BACKUP'),
      'invalid_unique_token',
    );
    assert.deepEqual(invalid.events, [['discoverGroups']]);
  }

  assertSeedFailure(
    () => loadSeeder().create({}).seed('CASE5_INCOMPLETE_BACKUP'),
    'seeder_services_incomplete',
  );
});
