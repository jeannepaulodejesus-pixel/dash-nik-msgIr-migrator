const assert = require('node:assert/strict');
const test = require('node:test');

const Cxp06FaultInjector = require('../src/uat/Cxp06FaultInjector.js');
const Cxp06UatEvidence = require('../src/uat/Cxp06UatEvidence.js');
const Cxp06UatHarness = require('../src/uat/Cxp06UatHarness.js');
const Cxp06UatEntrypoints = require('../src/main/Cxp06UatEntrypoints.js');
const ErrorCodes = require('../src/monitoring/ErrorCodes.js');

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

// Defect caught: scenario faults are attached after CommitService construction,
// so CASE2 executes the ordinary stage path and is recorded as SUCCESS.
test('CASE2 wires invalid-stage corruption into the repository used by commit operations', () => {
  const baseStaging = {
    readAll: () => [{ formulas: [['']], values: [['Header'], ['value']] }],
    writeAll: () => ({ datasetCount: 5 }),
  };
  let stagingRepository = baseStaging;

  const result = Cxp06UatHarness.execute({ scenario: 'CASE2_INVALID_STAGE' }, {
    commitService: {
      createOperations(services) {
        stagingRepository = services.decorateStagingRepository(baseStaging);
        return {
          stage: () => stagingRepository.writeAll([]),
          validateStage() {
            const staged = stagingRepository.readAll();
            if (staged[0].formulas[0][0]) {
              const error = new Error('controlled invalid stage');
              error.code = 'MIGRATION_STAGE_VALIDATION_FAILED';
              error.failureState = 'FAILED_MIGRATION_CALCULATION';
              throw error;
            }
          },
          commit() {},
          recalculate() {},
          healthCheck() {},
        };
      },
    },
    inputOperations: {
      validateFile() {},
      parse() {},
      validateSchema() {},
      checkDuplicate() {},
    },
    runService: {
      execute(request, operations) {
        operations.stage({ operationResults: {} });
        operations.validateStage({ operationResults: {} });
        return { runRecord: { runId: 'false-success', status: 'SUCCESS' } };
      },
    },
  });

  assert.equal(result.error.code, 'MIGRATION_STAGE_VALIDATION_FAILED');
  assert.equal(result.evidence.terminalState, 'FAILED_MIGRATION_CALCULATION');
});

// Defect caught: Case 05 labels are executable but never install the controlled
// topology seed at the locked pre-reconciliation seam.
test('CASE5 topology scenarios install one controlled pre-reconciliation seed', () => {
  for (const scenario of [
    'CASE5_INCOMPLETE_BACKUP',
    'CASE5_COMPLETE_UNSUCCESSFUL_BACKUP',
    'CASE5_SUCCESSFUL_LEFTOVER_BACKUP',
    'CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS',
  ]) {
    const events = [];
    const backupRepository = { marker: 'backup' };
    const ledgerRepository = { marker: 'ledger' };
    const targetSpreadsheet = { marker: 'target' };
    const result = Cxp06UatHarness.execute({ scenario }, {
      commitService: {
        createOperations(services) {
          return {
            stage() {},
            validateStage() {},
            commit() {
              const context = Object.freeze({
                backupRepository,
                ledgerRepository,
                targetSpreadsheet,
              });
              services.beforeReconcile(context);
              services.beforeReconcile(context);
            },
            recalculate() {},
            healthCheck() {},
          };
        },
      },
      inputOperations: {
        validateFile() {},
        parse() {},
        validateSchema() {},
        checkDuplicate() {},
      },
      properties: safeProperties(),
      runService: {
        execute(request, operations) {
          operations.commit();
          return { runRecord: { runId: 'topology-run', status: 'SUCCESS' } };
        },
      },
      topologySeeder: {
        create(services) {
          events.push(['create', services]);
          return {
            seed(seedScenario) {
              events.push(['seed', seedScenario]);
              return {
                groupCount: 1,
                scenario: seedScenario,
                sheetNames: ['_CXP06_BAK_HANDLED_safe-seed'],
              };
            },
          };
        },
      },
      topologyServices: {
        now: () => new Date('2026-08-24T12:00:00.000Z'),
        uniqueToken: () => 'controlled-token',
      },
    });

    assert.equal(result.runRecord.status, 'SUCCESS');
    assert.equal(result.evidence.backupSheetCount, 1);
    assert.deepEqual(result.evidence.backupSheetNames, [
      '_CXP06_BAK_HANDLED_safe-seed',
    ]);
    assert.equal(events.filter(([name]) => name === 'create').length, 1, scenario);
    assert.deepEqual(events.filter(([name]) => name === 'seed'), [['seed', scenario]]);
    assert.equal(events[0][1].backupRepository, backupRepository);
    assert.equal(events[0][1].ledgerRepository, ledgerRepository);
    assert.equal(events[0][1].targetSpreadsheet, targetSpreadsheet);
    assert.equal(typeof events[0][1].now, 'function');
    assert.equal(typeof events[0][1].uniqueToken, 'function');
  }

  assert.throws(
    () => Cxp06UatHarness.execute({ scenario: 'CASE2_INVALID_STAG' }, {
      properties: safeProperties(),
    }),
    /Unknown UAT scenario/,
  );
});

// Defect caught: a seed refusal is swallowed or replaced by an ordinary
// successful run and its bounded setup evidence is omitted.
test('topology setup failures remain authoritative and sanitized', () => {
  let createCalls = 0;
  assert.throws(
    () => Cxp06UatHarness.execute({ scenario: 'CASE5_INCOMPLETE_BACKUP' }, {
      properties: safeProperties({ CXP_UAT_ENABLED: 'false' }),
      topologySeeder: {
        create() {
          createCalls += 1;
          return { seed() {} };
        },
      },
    }),
    /CXP_UAT_ENABLED=true/,
  );
  assert.equal(createCalls, 0);

  const result = Cxp06UatHarness.execute({ scenario: 'CASE5_INCOMPLETE_BACKUP' }, {
    commitService: {
      createOperations(services) {
        return {
          stage() {},
          validateStage() {},
          commit() {
            services.beforeReconcile({
              backupRepository: {},
              ledgerRepository: {},
              targetSpreadsheet: {},
            });
          },
          recalculate() {},
          healthCheck() {},
        };
      },
    },
    inputOperations: {
      validateFile() {}, parse() {}, validateSchema() {}, checkDuplicate() {},
    },
    properties: safeProperties(),
    runService: {
      execute(request, operations) {
        operations.commit();
        return { runRecord: { runId: 'false-success', status: 'SUCCESS' } };
      },
    },
    topologySeeder: {
      create() {
        return {
          seed() {
            throw ErrorCodes.create('UAT_BACKUP_TOPOLOGY_SEED_FAILED', {
              details: { reason: 'existing_backup_topology' },
            });
          },
        };
      },
    },
    topologyServices: { now: () => new Date(), uniqueToken: () => 'safe' },
  });

  assert.equal(result.error.code, 'UAT_BACKUP_TOPOLOGY_SEED_FAILED');
  assert.equal(result.evidence.sanitizedErrorCode, 'UAT_BACKUP_TOPOLOGY_SEED_FAILED');
  assert.equal(JSON.stringify(result.evidence).includes('existing_backup_topology'), false);
});

// Defect caught: production and non-topology UAT scenarios construct a seeder
// even though they must not create backup topology.
test('non-topology scenarios never construct the controlled topology seeder', () => {
  let createCalls = 0;
  const result = Cxp06UatHarness.execute({ scenario: 'CASE1_PEAK_SUCCESS' }, {
    commitOperations: {
      stage() {}, validateStage() {}, commit() {}, recalculate() {}, healthCheck() {},
    },
    inputOperations: {
      validateFile() {}, parse() {}, validateSchema() {}, checkDuplicate() {},
    },
    properties: safeProperties(),
    runService: {
      execute() {
        return { runRecord: { runId: 'ordinary-run', status: 'SUCCESS' } };
      },
    },
    topologySeeder: {
      create() {
        createCalls += 1;
        return { seed() {} };
      },
    },
  });

  assert.equal(result.runRecord.status, 'SUCCESS');
  assert.equal(createCalls, 0);
});

// Defect caught: missing workbook services are swallowed, allowing Apps Script to
// report a completed UAT execution even though no target-workbook operation ran.
test('execute fails visibly when production operation construction fails', () => {
  let orchestrationCalls = 0;

  assert.throws(
    () => Cxp06UatHarness.execute({ scenario: 'PEAK_SUCCESS' }, {
      inputOperations: {
        validateFile() {},
        parse() {},
        validateSchema() {},
        checkDuplicate() {},
      },
      runService: {
        execute() {
          orchestrationCalls += 1;
          return { runRecord: { runId: 'false-success', status: 'SUCCESS' } };
        },
      },
    }),
    (error) => error && error.code === 'INGESTION_INVALID_OPERATIONS',
  );
  assert.equal(orchestrationCalls, 0);
});

// Defect caught: parameterless hosted runs never open the configured target and
// control workbooks, so production adapters have nothing to write to.
test('hosted dependencies bind configured workbooks to input, commit, and run services', () => {
  const openedIds = [];
  const spreadsheets = {
    'control-id': { role: 'control' },
    'target-id': { role: 'target' },
  };
  const ledgerRepository = { role: 'ledger' };
  const runRepository = { role: 'runs' };
  const flush = () => {};

  const dependencies = Cxp06UatHarness.createHostedDependencies(
    safeProperties(),
    {
      driveApi: { role: 'drive-api' },
      driveApp: { role: 'drive-app' },
      flush,
      lockService: { role: 'lock' },
      session: { getActiveUser: () => ({ getEmail: () => 'uat@example.test' }) },
      spreadsheetApp: {
        openById(id) {
          openedIds.push(id);
          return spreadsheets[id];
        },
      },
      utilities: { role: 'utilities' },
    },
    {
      fileLedgerRepository: { create: () => ledgerRepository },
      runRepository: { create: () => runRepository },
    },
  );

  assert.deepEqual(openedIds, ['target-id', 'control-id']);
  assert.equal(dependencies.commitServices.targetSpreadsheet, spreadsheets['target-id']);
  assert.equal(dependencies.commitServices.ledgerRepository, ledgerRepository);
  assert.equal(dependencies.inputServices.ledgerRepository, ledgerRepository);
  assert.equal(dependencies.runServices.repository, runRepository);
  assert.equal(dependencies.request.targetWorkbookId, 'target-id');
  assert.equal(dependencies.adapterRequest.sources.length, 5);
  assert.equal(dependencies.adapterRequest.sources[0].fileId, 'handled-id');
  assert.equal(dependencies.adapterRequest.sources[4].datasetName, 'Staff');
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
  assert.deepEqual(health.readAll(), healthBase.state.reads);

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
