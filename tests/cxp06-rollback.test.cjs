const assert = require('node:assert/strict');
const test = require('node:test');

const FileLedgerRepository = require('../src/repository/FileLedgerRepository.js');

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

class LedgerRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    Object.assign(this, { sheet, row, column, rowCount, columnCount });
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.rows[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] ?? '',
      ),
    );
  }

  setValues(values) {
    values.forEach((rowValues, rowOffset) => {
      while (this.sheet.rows.length < this.row + rowOffset) {
        this.sheet.rows.push([]);
      }
      rowValues.forEach((value, columnOffset) => {
        this.sheet.rows[this.row - 1 + rowOffset][this.column - 1 + columnOffset] = value;
      });
    });
  }
}

class LedgerSheet {
  constructor(rows) {
    this.rows = rows.map((row) => row.slice());
  }

  getLastRow() {
    return this.rows.length;
  }

  getRange(row, column, rowCount, columnCount) {
    return new LedgerRange(this, row, column, rowCount, columnCount);
  }
}

function ledgerRow({ fingerprint, result, runId }) {
  return [
    fingerprint,
    'SHA-256',
    result,
    runId,
    '',
    '2026-08-23T00:00:00.000Z',
    '1.0.0',
    '["Handled","Offered","AHT - Raw","Auxes - Raw","Staff"]',
    '[]',
    '[]',
  ];
}

function snapshots(marker) {
  return ['Handled', 'Offered', 'AHT - Raw', 'Auxes - Raw', 'Staff'].map(
    (datasetName) => ({
      datasetName,
      formulas: [[''], ['']],
      sheetName: `backup-${datasetName}`,
      values: [['Header'], [`${marker}-${datasetName}`]],
    }),
  );
}

function completeGroup(runId) {
  return {
    complete: true,
    runId,
    sheetsByDataset: Object.fromEntries(
      ['Handled', 'Offered', 'AHT - Raw', 'Auxes - Raw', 'Staff'].map(
        (datasetName) => [datasetName, { datasetName, sheetName: `backup-${datasetName}` }],
      ),
    ),
  };
}

function incompleteGroup(runId) {
  return {
    complete: false,
    runId,
    sheetsByDataset: { Handled: { datasetName: 'Handled', sheetName: 'backup-Handled' } },
  };
}

function serviceHarness(groups, options = {}) {
  const events = [];
  const backupValues = snapshots('original');
  let rawValues = snapshots('changed');
  const backupRepository = {
    deleteGroup(group) {
      events.push(['delete', group.runId]);
    },
    discoverGroups() {
      if (options.discoveryFailure) {
        throw new Error('sensitive discovery failure');
      }
      return groups.slice();
    },
    readGroup(group) {
      events.push(['readBackup', group.runId]);
      return backupValues.map((snapshot) => ({
        ...snapshot,
        formulas: snapshot.formulas.map((row) => row.slice()),
        values: snapshot.values.map((row) => row.slice()),
      }));
    },
  };
  const rawRepository = {
    readAll() {
      events.push(['readRaw']);
      const source = options.restoreMismatch ? snapshots('wrong') : rawValues;
      return source.map((snapshot) => ({
        ...snapshot,
        formulas: snapshot.formulas.map((row) => row.slice()),
        values: snapshot.values.map((row) => row.slice()),
      }));
    },
    restoreAll(restored) {
      events.push(['restore', restored.length]);
      if (options.restoreFailure) {
        throw new Error('sensitive restore failure');
      }
      rawValues = restored;
    },
  };
  const successfulRuns = new Set(options.successfulRuns || []);
  const ledgerRepository = {
    findSuccessfulByRunId(runId) {
      events.push(['ledger', runId]);
      return successfulRuns.has(runId) ? { result: 'SUCCESS', runId } : null;
    },
  };
  const RollbackService = loadModule('../src/services/RollbackService.js');
  assert.equal(typeof RollbackService?.create, 'function');
  return {
    events,
    service: RollbackService.create({
      backupRepository,
      flush() {
        events.push(['flush']);
      },
      ledgerRepository,
      rawRepository,
    }),
  };
}

// Defect caught: stale backup recovery cannot distinguish a committed run from an unfinished one.
test('file ledger finds the latest successful record by run ID without changing fingerprint lookup', () => {
  const sheet = new LedgerSheet([
    FileLedgerRepository.HEADERS,
    ledgerRow({ fingerprint: 'sha256:a', result: 'SUCCESS', runId: 'run-a' }),
    ledgerRow({ fingerprint: 'sha256:b', result: 'DUPLICATE', runId: 'run-b' }),
    ledgerRow({ fingerprint: 'sha256:c', result: 'SUCCESS', runId: 'run-a' }),
  ]);
  const repository = FileLedgerRepository.create({
    getSheetByName: () => sheet,
  });

  assert.equal(typeof repository.findSuccessfulByRunId, 'function');
  assert.equal(repository.findSuccessfulByRunId('run-a').fingerprint, 'sha256:c');
  assert.equal(repository.findSuccessfulByRunId('run-b'), null);
  assert.equal(repository.findSuccessfulByFingerprint('sha256:a').runId, 'run-a');
});

// Defect caught: rollback deletes backups after writes without proving all five raw matrices match.
test('rollback restores, flushes, verifies every dataset, and only then deletes the group', () => {
  const group = completeGroup('run-unfinished');
  const harness = serviceHarness([group]);

  assert.deepEqual(
    harness.service.rollback(group, { code: 'MIGRATION_COMMIT_FAILED' }),
    {
      backupRunId: 'run-unfinished',
      datasetCount: 5,
      originalErrorCode: 'MIGRATION_COMMIT_FAILED',
      rollbackStatus: 'VERIFIED',
    },
  );
  assert.deepEqual(harness.events, [
    ['readBackup', 'run-unfinished'],
    ['restore', 5],
    ['flush'],
    ['readRaw'],
    ['delete', 'run-unfinished'],
  ]);

  const mismatch = serviceHarness([group], { restoreMismatch: true });
  assert.throws(
    () => mismatch.service.rollback(group, { code: 'MIGRATION_COMMIT_FAILED' }),
    (error) =>
      error?.code === 'MIGRATION_ROLLBACK_FAILED' &&
      error.details.rollbackStatus === 'FAILED' &&
      !JSON.stringify(error.details).includes('wrong-'),
  );
  assert.equal(mismatch.events.some(([name]) => name === 'delete'), false);
});

// Defect caught: next-run recovery restores committed data or trusts incomplete backup groups.
test('recovery keeps committed raw, restores one unfinished group, and discards incomplete groups', () => {
  const committed = completeGroup('run-committed');
  const committedHarness = serviceHarness([committed], {
    successfulRuns: ['run-committed'],
  });
  assert.deepEqual(committedHarness.service.reconcile().actions, [
    { action: 'DELETE_COMMITTED_BACKUP', runId: 'run-committed' },
  ]);
  assert.equal(committedHarness.events.some(([name]) => name === 'restore'), false);

  const unfinished = completeGroup('run-unfinished');
  const unfinishedHarness = serviceHarness([unfinished]);
  assert.deepEqual(unfinishedHarness.service.reconcile().actions, [
    { action: 'RESTORE_UNFINISHED_BACKUP', runId: 'run-unfinished' },
  ]);
  assert.equal(unfinishedHarness.events.some(([name]) => name === 'restore'), true);

  const partial = incompleteGroup('run-partial');
  const partialHarness = serviceHarness([partial]);
  assert.deepEqual(partialHarness.service.reconcile().actions, [
    { action: 'DELETE_INCOMPLETE_BACKUP', runId: 'run-partial' },
  ]);
  assert.equal(partialHarness.events.some(([name]) => name === 'restore'), false);
});

// Defect caught: ambiguous or failed recovery guesses a restore order or leaks dependency messages.
test('recovery fails closed for multiple unfinished groups and sanitizes dependency failures', () => {
  const ambiguous = serviceHarness([
    completeGroup('run-one'),
    completeGroup('run-two'),
  ]);
  assert.throws(
    () => ambiguous.service.reconcile(),
    (error) =>
      error?.code === 'MIGRATION_RECOVERY_FAILED' &&
      error.details.reason === 'multiple_unfinished_groups',
  );
  assert.equal(ambiguous.events.some(([name]) => name === 'restore'), false);

  const failed = serviceHarness([], { discoveryFailure: true });
  assert.throws(
    () => failed.service.reconcile(),
    (error) =>
      error?.code === 'MIGRATION_RECOVERY_FAILED' &&
      !JSON.stringify(error.details).includes('sensitive'),
  );
});
