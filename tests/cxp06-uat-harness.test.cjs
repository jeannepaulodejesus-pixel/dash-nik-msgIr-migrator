const assert = require('node:assert/strict');
const test = require('node:test');

const Cxp06FaultInjector = require('../src/uat/Cxp06FaultInjector.js');
const Cxp06UatEvidence = require('../src/uat/Cxp06UatEvidence.js');
const Cxp06UatHarness = require('../src/uat/Cxp06UatHarness.js');
const Cxp06UatEntrypoints = require('../src/main/Cxp06UatEntrypoints.js');

function properties(values) {
  return {
    getProperty(name) {
      return Object.hasOwn(values, name) ? values[name] : null;
    },
  };
}

function safeProperties(overrides = {}) {
  return properties({
    CXP_ENV: 'DEV',
    CXP_UAT_ENABLED: 'true',
    CXP_DEV_CONTROL_SPREADSHEET_ID: 'control-id',
    CXP_DEV_TARGET_SPREADSHEET_ID: 'target-id',
    CXP_UAT_HANDLED_FILE_ID: 'handled-id',
    CXP_UAT_OFFERED_FILE_ID: 'offered-id',
    CXP_UAT_AHT_FILE_ID: 'aht-id',
    CXP_UAT_AUXES_FILE_ID: 'auxes-id',
    CXP_UAT_STAFF_FILE_ID: 'staff-id',
    ...overrides,
  });
}

// Defect caught: a destructive UAT preparation or scenario can execute in PROD.
test('PROD is blocked and every UAT action requires the enable flag', () => {
  assert.throws(
    () => Cxp06UatHarness.requireSafetyGate(properties({
      CXP_ENV: 'PROD',
      CXP_UAT_ENABLED: 'true',
    })),
    /not available in PROD/,
  );
  assert.throws(
    () => Cxp06UatHarness.requireSafetyGate(properties({
      CXP_ENV: 'DEV',
      CXP_UAT_ENABLED: 'false',
    })),
    /CXP_UAT_ENABLED=true/,
  );
  assert.throws(
    () => Cxp06UatHarness.requireSafetyGate(properties({
      CXP_ENV: 'UNKNOWN',
      CXP_UAT_ENABLED: 'true',
    })),
    /requires DEV or UAT environment/,
  );
  assert.equal(Cxp06UatHarness.requireSafetyGate(safeProperties()).environment, 'DEV');
});

// Defect caught: the harness skips or duplicates a production operation callback.
test('composeOperations returns exactly the four input and five commit callbacks', () => {
  const calls = [];
  const input = Object.fromEntries(
    ['validateFile', 'parse', 'validateSchema', 'checkDuplicate'].map((name) => [
      name,
      () => calls.push(name),
    ]),
  );
  const commit = Object.fromEntries(
    ['stage', 'validateStage', 'commit', 'recalculate', 'healthCheck'].map((name) => [
      name,
      () => calls.push(name),
    ]),
  );
  const operations = Cxp06UatHarness.composeOperations(input, commit);
  assert.deepEqual(Object.keys(operations), [
    'validateFile',
    'parse',
    'validateSchema',
    'checkDuplicate',
    'stage',
    'validateStage',
    'commit',
    'recalculate',
    'healthCheck',
  ]);
  Object.values(operations).forEach((operation) => operation());
  assert.deepEqual(calls, Object.keys(operations));
});

// Defect caught: UAT invokes callbacks itself or uses a second orchestration path.
test('execute delegates the composed operations exactly once to RunService.execute', () => {
  const observed = [];
  const result = Cxp06UatHarness.execute({ scenario: 'PEAK_SUCCESS' }, {
    commitService: {
      createOperations() {
        return Object.fromEntries(
          ['stage', 'validateStage', 'commit', 'recalculate', 'healthCheck'].map((name) => [
            name,
            () => {},
          ]),
        );
      },
    },
    inputAdapter: {
      createOperations() {
        return Object.fromEntries(
          ['validateFile', 'parse', 'validateSchema', 'checkDuplicate'].map((name) => [
            name,
            () => {},
          ]),
        );
      },
    },
    runService: {
      execute(request, operations, services) {
        observed.push({ operations, request, services });
        return { runRecord: { runId: 'run-uat', status: 'SUCCESS' } };
      },
    },
    runServices: { marker: 'production-services' },
    request: { marker: 'production-request' },
  });
  assert.equal(observed.length, 1);
  assert.equal(Object.keys(observed[0].operations).length, 9);
  assert.equal(observed[0].request.marker, 'production-request');
  assert.equal(observed[0].services.marker, 'production-services');
  assert.equal(result.runRecord.status, 'SUCCESS');
});

function rawRepository() {
  const state = {
    reads: [{ datasetName: 'Handled', formulas: [['']], values: [['old']] }],
  };
  return {
    state,
    repository: {
      preflight: () => ({ datasetCount: 5 }),
      readAll: () => state.reads,
      replaceAll: () => ({ datasetCount: 5 }),
      restoreAll: () => ({ datasetCount: 5 }),
    },
  };
}

// Defect caught: a fault fires before its documented production seam.
test('faults fire only at their intended raw, health, rollback, and cleanup seams', () => {
  const mid = Cxp06FaultInjector.create('AFTER_SECOND_RAW_REPLACEMENT');
  assert.doesNotThrow(() => mid.rawObserver.afterReplacement({ index: 0 }));
  assert.throws(
    () => mid.rawObserver.afterReplacement({ index: 1 }),
    /UAT_AFTER_SECOND_RAW_REPLACEMENT/,
  );

  const healthBase = rawRepository();
  const health = Cxp06FaultInjector.create('HEALTH_MISMATCH')
    .wrapRawRepository(healthBase.repository);
  health.replaceAll([]);
  assert.notDeepEqual(health.readAll(), healthBase.state.reads);

  const write = Cxp06FaultInjector.create('ROLLBACK_WRITE_FAILURE');
  assert.throws(
    () => write.rawObserver.afterReplacement({ index: 1 }),
    /UAT_ROLLBACK_TRIGGER/,
  );
  assert.throws(
    () => write.rawObserver.afterRestoreWrite({ index: 0 }),
    /UAT_ROLLBACK_WRITE_FAILURE/,
  );

  const verifyBase = rawRepository();
  const verifyInjector = Cxp06FaultInjector.create('ROLLBACK_VERIFY_FAILURE');
  const verify = verifyInjector.wrapRawRepository(verifyBase.repository);
  assert.throws(
    () => verifyInjector.rawObserver.afterReplacement({ index: 1 }),
    /UAT_ROLLBACK_TRIGGER/,
  );
  verify.restoreAll([]);
  assert.notDeepEqual(verify.readAll(), verifyBase.state.reads);

  let cleanupCalls = 0;
  const cleanup = Cxp06FaultInjector.create('BACKUP_CLEANUP_FAILURE')
    .wrapBackupRepository({
      createGroup: () => ({}),
      deleteGroup: () => { cleanupCalls += 1; },
      discoverGroups: () => [],
      readGroup: () => [],
    });
  assert.throws(() => cleanup.deleteGroup({}), /UAT_BACKUP_CLEANUP_FAILURE/);
  assert.equal(cleanupCalls, 0);
});

// Defect caught: evidence leaks cell contents, keys, emails, filenames, or formulas.
test('evidence applies a strict sanitized metadata allowlist', () => {
  const evidence = Cxp06UatEvidence.sanitize({
    backupCleanupStatus: 'PENDING',
    backupSheetCount: 5,
    elapsedMs: 1234,
    endedAtUtc: '2026-08-24T00:00:02.000Z',
    environment: 'DEV',
    fileLedgerResult: 'SUCCESS',
    formulaText: '=SECRET()',
    rawFormulaCount: 0,
    rawRowCounts: { Handled: 10000 },
    rollbackStatus: 'VERIFIED',
    rows: [['secret@example.test']],
    runId: 'run-uat',
    scenario: 'PEAK_SUCCESS',
    sourceFileName: 'private.xlsx',
    stageFormulaCount: 0,
    stageRowCounts: { Handled: 10000 },
    startedAtUtc: '2026-08-24T00:00:00.000Z',
    terminalState: 'SUCCESS',
    runtimeIndicator: 'WITHIN_LIMIT',
  });
  assert.deepEqual(Object.keys(evidence), Cxp06UatEvidence.ALLOWED_FIELDS);
  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes('secret@example.test'), false);
  assert.equal(serialized.includes('private.xlsx'), false);
  assert.equal(serialized.includes('SECRET'), false);
});

// Defect caught: Entrypoints fail to expose parameterless entrypoints or allow PROD execution.
test('every entrypoint is parameterless and delegates to Cxp06UatHarness with safety checks', () => {
  const entrypoints = [
    'cxp06UatPreflight',
    'cxp06UatCase1PeakSuccess',
    'cxp06UatCase2InvalidStage',
    'cxp06UatCase3MidCommitFailure',
    'cxp06UatCase4HealthMismatch',
    'cxp06UatCase4RollbackFailure',
    'cxp06UatCase5IncompleteBackup',
    'cxp06UatCase5CompleteUnsuccessfulBackup',
    'cxp06UatCase5SuccessfulLeftoverBackup',
    'cxp06UatCase5TwoCompleteUnsuccessfulBackups',
    'cxp06UatCase5CleanupFailure',
    'cxp06UatReaderVisibility',
  ];

  entrypoints.forEach((name) => {
    assert.equal(typeof Cxp06UatEntrypoints[name], 'function');
    assert.equal(Cxp06UatEntrypoints[name].length, 0);
  });

  const preflight = Cxp06UatEntrypoints.cxp06UatPreflight();
  assert.equal(preflight.runRecord.status, 'PREFLIGHT_PASS');
  assert.equal(preflight.evidence.scenario, 'PREFLIGHT');
  assert.equal(preflight.evidence.environment, 'DEV');
});
