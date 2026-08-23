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

function tickingClock(startIso = '2026-08-23T00:00:00.000Z') {
  let next = new Date(startIso).getTime();
  return {
    now() {
      const value = new Date(next);
      next += 1000;
      return value;
    },
  };
}

class FakeRepository {
  constructor() {
    this.calls = [];
  }

  persist(runRecords, errorRecords) {
    this.calls.push({ errorRecords, runRecords });
  }
}

class FakeScriptLock {
  constructor(shared, events) {
    this.acquired = false;
    this.events = events;
    this.shared = shared;
  }

  tryLock(timeoutMs) {
    this.events.push(['tryLock', timeoutMs]);
    if (this.shared.held) {
      return false;
    }
    this.shared.held = true;
    this.acquired = true;
    return true;
  }

  hasLock() {
    return this.acquired;
  }

  releaseLock() {
    this.events.push(['releaseLock']);
    if (this.acquired) {
      this.acquired = false;
      this.shared.held = false;
    }
  }
}

class FakeLockService {
  constructor(shared = { held: false }, events = []) {
    this.events = events;
    this.shared = shared;
  }

  getScriptLock() {
    this.events.push(['getScriptLock']);
    return new FakeScriptLock(this.shared, this.events);
  }
}

function validRequest(overrides = {}) {
  return {
    inputRowCounts: { Handled: 2, Staff: 1 },
    outputRowCounts: {},
    schemaVersion: '1.0.0',
    sourceActor: 'synthetic-rta@example.test',
    sourceFileId: 'synthetic-file-id',
    sourceFileName: 'synthetic-source.xls',
    targetWorkbookId: 'synthetic-target-id',
    ...overrides,
  };
}

function operationsWith(overrides = {}) {
  const operationNames = [
    'validateFile',
    'parse',
    'validateSchema',
    'checkDuplicate',
    'stage',
    'validateStage',
    'commit',
    'recalculate',
    'healthCheck',
  ];
  return Object.fromEntries(
    operationNames.map((name) => [name, overrides[name] || (() => name + '-result')]),
  );
}

function servicesWith(overrides = {}) {
  const lockEvents = [];
  return {
    clock: tickingClock(),
    flush: () => lockEvents.push(['flush']),
    lockService: new FakeLockService({ held: false }, lockEvents),
    lockTimeoutMs: 5000,
    repository: new FakeRepository(),
    uuid: () => 'run-0001',
    ...overrides,
  };
}

// Defect caught: downstream packets receive unstable codes or cannot map a code to one failure state.
test('error taxonomy has stable source, ingestion, migration/calculation, and reporting categories', () => {
  const ErrorCodes = loadModule('../src/monitoring/ErrorCodes.js');
  assert.equal(typeof ErrorCodes?.get, 'function');
  assert.equal(typeof ErrorCodes?.failureStateFor, 'function');

  assert.deepEqual(ErrorCodes.CATEGORIES, {
    INGESTION: 'INGESTION',
    MIGRATION_CALCULATION: 'MIGRATION_CALCULATION',
    REPORTING: 'REPORTING',
    SOURCE: 'SOURCE',
  });
  assert.equal(ErrorCodes.get('SOURCE_FILE_NOT_FOUND').category, 'SOURCE');
  assert.equal(ErrorCodes.get('SCHEMA_MISSING_REQUIRED_COLUMNS').category, 'SOURCE');
  assert.equal(ErrorCodes.get('INGESTION_LOCK_TIMEOUT').category, 'INGESTION');
  assert.equal(ErrorCodes.get('MIGRATION_COMMIT_FAILED').category, 'MIGRATION_CALCULATION');
  assert.equal(
    ErrorCodes.get('CALCULATION_RECALCULATION_FAILED').category,
    'MIGRATION_CALCULATION',
  );
  assert.equal(ErrorCodes.get('REPORTING_LOG_WRITE_FAILED').category, 'REPORTING');
  assert.equal(
    ErrorCodes.failureStateFor('SCHEMA_MISSING_REQUIRED_COLUMNS'),
    'FAILED_SOURCE',
  );
  assert.equal(ErrorCodes.failureStateFor('INGESTION_LOCK_TIMEOUT'), 'FAILED_INGESTION');
  assert.equal(
    ErrorCodes.failureStateFor('MIGRATION_COMMIT_FAILED'),
    'FAILED_MIGRATION_CALCULATION',
  );
  assert.equal(
    ErrorCodes.failureStateFor('REPORTING_LOG_WRITE_FAILED'),
    'FAILED_REPORTING',
  );
});

// Defect caught: callers skip required phases, leave terminal states, or invent unregistered states.
test('state machine exposes the complete success path and rejects illegal transitions', () => {
  const RunStateMachine = loadModule('../src/ingestion/RunStateMachine.js');
  assert.equal(typeof RunStateMachine?.create, 'function');

  assert.deepEqual(RunStateMachine.SUCCESS_PATH, [
    'RECEIVED',
    'VALIDATING_FILE',
    'PARSING',
    'VALIDATING_SCHEMA',
    'CHECKING_DUPLICATE',
    'STAGING',
    'VALIDATING_STAGE',
    'COMMITTING',
    'RECALCULATING',
    'HEALTH_CHECK',
    'SUCCESS',
  ]);
  assert.deepEqual(RunStateMachine.FAILURE_STATES, [
    'FAILED_SOURCE',
    'FAILED_INGESTION',
    'FAILED_MIGRATION_CALCULATION',
    'FAILED_REPORTING',
  ]);

  const machine = RunStateMachine.create(tickingClock());
  assert.throws(
    () => machine.transition('PARSING'),
    (error) => {
      assert.equal(error.code, 'INGESTION_ILLEGAL_STATE_TRANSITION');
      assert.deepEqual(error.details, { attemptedState: 'PARSING', currentState: 'RECEIVED' });
      return true;
    },
  );
  for (const state of RunStateMachine.SUCCESS_PATH.slice(1)) {
    machine.transition(state);
  }
  assert.equal(machine.currentState(), 'SUCCESS');
  assert.throws(
    () => machine.transition('FAILED_INGESTION'),
    (error) => error.code === 'INGESTION_ILLEGAL_STATE_TRANSITION',
  );
});

// Defect caught: a successful attempt omits audit metadata, misorders phases, or releases before flushing.
test('successful runs execute every phase, enter COMMITTING under lock, and persist one audit record', () => {
  const RunService = loadModule('../src/ingestion/RunService.js');
  assert.equal(typeof RunService?.execute, 'function');
  const operationEvents = [];
  const operations = operationsWith(
    Object.fromEntries(
      [
        'validateFile',
        'parse',
        'validateSchema',
        'checkDuplicate',
        'stage',
        'validateStage',
        'commit',
        'recalculate',
        'healthCheck',
      ].map((name) => [name, () => operationEvents.push(name)]),
    ),
  );
  const services = servicesWith();

  const result = RunService.execute(validRequest(), operations, services);

  assert.deepEqual(operationEvents, [
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
  assert.deepEqual(services.lockService.events, [
    ['getScriptLock'],
    ['tryLock', 5000],
    ['flush'],
    ['releaseLock'],
  ]);
  assert.equal(services.repository.calls.length, 1);
  assert.equal(services.repository.calls[0].runRecords.length, 1);
  assert.equal(services.repository.calls[0].errorRecords.length, 0);
  assert.deepEqual(result.runRecord, {
    endedAtUtc: '2026-08-23T00:00:11.000Z',
    errorCode: null,
    inputRowCounts: { Handled: 2, Staff: 1 },
    outputRowCounts: {},
    runId: 'run-0001',
    schemaVersion: '1.0.0',
    sourceActor: 'synthetic-rta@example.test',
    sourceFileId: 'synthetic-file-id',
    sourceFileName: 'synthetic-source.xls',
    startedAtUtc: '2026-08-23T00:00:00.000Z',
    stateHistory: [
      { atUtc: '2026-08-23T00:00:01.000Z', state: 'RECEIVED' },
      { atUtc: '2026-08-23T00:00:02.000Z', state: 'VALIDATING_FILE' },
      { atUtc: '2026-08-23T00:00:03.000Z', state: 'PARSING' },
      { atUtc: '2026-08-23T00:00:04.000Z', state: 'VALIDATING_SCHEMA' },
      { atUtc: '2026-08-23T00:00:05.000Z', state: 'CHECKING_DUPLICATE' },
      { atUtc: '2026-08-23T00:00:06.000Z', state: 'STAGING' },
      { atUtc: '2026-08-23T00:00:07.000Z', state: 'VALIDATING_STAGE' },
      { atUtc: '2026-08-23T00:00:08.000Z', state: 'COMMITTING' },
      { atUtc: '2026-08-23T00:00:09.000Z', state: 'RECALCULATING' },
      { atUtc: '2026-08-23T00:00:10.000Z', state: 'HEALTH_CHECK' },
      { atUtc: '2026-08-23T00:00:11.000Z', state: 'SUCCESS' },
    ],
    status: 'SUCCESS',
    targetWorkbookId: 'synthetic-target-id',
  });
});

// Defect caught: an operation failure escapes without a terminal run row and categorized error row.
test('failed attempts are audited with terminal failure state and safe error metadata', () => {
  const ErrorCodes = loadModule('../src/monitoring/ErrorCodes.js');
  const RunService = loadModule('../src/ingestion/RunService.js');
  assert.equal(typeof ErrorCodes?.create, 'function');
  assert.equal(typeof RunService?.execute, 'function');
  const repository = new FakeRepository();
  const services = servicesWith({ repository });
  const operations = operationsWith({
    validateSchema() {
      throw ErrorCodes.create('SCHEMA_MISSING_REQUIRED_COLUMNS', {
        details: { missingHeaders: ['Messaging Session Name'] },
      });
    },
  });

  assert.throws(
    () => RunService.execute(validRequest(), operations, services),
    (error) => {
      assert.equal(error.code, 'SCHEMA_MISSING_REQUIRED_COLUMNS');
      assert.equal(error.runRecord.status, 'FAILED_SOURCE');
      return true;
    },
  );

  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0].runRecords.length, 1);
  assert.equal(repository.calls[0].errorRecords.length, 1);
  const runRecord = repository.calls[0].runRecords[0];
  assert.equal(runRecord.status, 'FAILED_SOURCE');
  assert.equal(runRecord.errorCode, 'SCHEMA_MISSING_REQUIRED_COLUMNS');
  assert.deepEqual(
    runRecord.stateHistory.map((event) => event.state),
    ['RECEIVED', 'VALIDATING_FILE', 'PARSING', 'VALIDATING_SCHEMA', 'FAILED_SOURCE'],
  );
  assert.deepEqual(repository.calls[0].errorRecords[0], {
    atUtc: '2026-08-23T00:00:06.000Z',
    category: 'SOURCE',
    details: { missingHeaders: ['Messaging Session Name'] },
    errorCode: 'SCHEMA_MISSING_REQUIRED_COLUMNS',
    failureState: 'FAILED_SOURCE',
    message: 'Required source columns are missing.',
    runId: 'run-0001',
    state: 'VALIDATING_SCHEMA',
  });
});

// Defect caught: a second execution reaches COMMITTING while the first still owns the script lock.
test('two simultaneous write attempts cannot both enter COMMITTING', () => {
  const RunService = loadModule('../src/ingestion/RunService.js');
  assert.equal(typeof RunService?.execute, 'function');
  const sharedLock = { held: false };
  const lockEvents = [];
  const lockService = new FakeLockService(sharedLock, lockEvents);
  const firstRepository = new FakeRepository();
  const secondRepository = new FakeRepository();
  const firstServices = servicesWith({
    lockService,
    repository: firstRepository,
    uuid: () => 'run-first',
  });
  const secondServices = servicesWith({
    lockService,
    repository: secondRepository,
    uuid: () => 'run-second',
  });
  let secondError;
  const firstOperations = operationsWith({
    commit() {
      try {
        RunService.execute(validRequest(), operationsWith(), secondServices);
      } catch (error) {
        secondError = error;
      }
    },
  });

  const firstResult = RunService.execute(validRequest(), firstOperations, firstServices);

  assert.equal(firstResult.runRecord.status, 'SUCCESS');
  assert.equal(secondError.code, 'INGESTION_LOCK_TIMEOUT');
  assert.equal(secondError.runRecord.status, 'FAILED_INGESTION');
  assert.equal(
    secondError.runRecord.stateHistory.some((event) => event.state === 'COMMITTING'),
    false,
  );
  assert.equal(
    firstResult.runRecord.stateHistory.filter((event) => event.state === 'COMMITTING').length,
    1,
  );
  assert.equal(firstRepository.calls.length, 1);
  assert.equal(secondRepository.calls.length, 1);
});

class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.column = column;
    this.columnCount = columnCount;
    this.row = row;
    this.rowCount = rowCount;
    this.sheet = sheet;
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.valueAt(this.row + rowOffset, this.column + columnOffset),
      ),
    );
  }

  setValues(values) {
    this.sheet.writeCalls.push({
      column: this.column,
      row: this.row,
      values: values.map((row) => row.slice()),
    });
    values.forEach((rowValues, rowOffset) => {
      rowValues.forEach((value, columnOffset) => {
        this.sheet.setValueAt(
          this.row + rowOffset,
          this.column + columnOffset,
          value,
        );
      });
    });
  }
}

class FakeLogSheet {
  constructor(name, rows = []) {
    this.name = name;
    this.rows = rows.map((row) => row.slice());
    this.writeCalls = [];
  }

  getLastRow() {
    return this.rows.length;
  }

  getRange(row, column, rowCount, columnCount) {
    return new FakeRange(this, row, column, rowCount, columnCount);
  }

  setValueAt(row, column, value) {
    while (this.rows.length < row) {
      this.rows.push([]);
    }
    this.rows[row - 1][column - 1] = value;
  }

  valueAt(row, column) {
    return this.rows[row - 1]?.[column - 1] ?? '';
  }
}

class FakeControlSpreadsheet {
  constructor(sheets) {
    this.sheets = new Map(sheets.map((sheet) => [sheet.name, sheet]));
  }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }
}

// Defect caught: logging uses appendRow/setValue loops or writes against an unverified drifting schema.
test('run repository validates controlled headers and appends run/error rows with bulk setValues', () => {
  const RunLogger = loadModule('../src/monitoring/RunLogger.js');
  const ErrorLogger = loadModule('../src/monitoring/ErrorLogger.js');
  const RunRepository = loadModule('../src/repository/RunRepository.js');
  assert.equal(typeof RunLogger?.toRows, 'function');
  assert.equal(typeof ErrorLogger?.toRows, 'function');
  assert.equal(typeof RunRepository?.create, 'function');

  const runSheet = new FakeLogSheet('RUN_LOG');
  const errorSheet = new FakeLogSheet('ERROR_LOG');
  const repository = RunRepository.create(
    new FakeControlSpreadsheet([runSheet, errorSheet]),
  );
  const runRecord = {
    endedAtUtc: '2026-08-23T00:01:00.000Z',
    errorCode: null,
    inputRowCounts: { Handled: 2 },
    outputRowCounts: { Handled: 2 },
    runId: 'run-sample',
    schemaVersion: '1.0.0',
    sourceActor: null,
    sourceFileId: 'file-sample',
    sourceFileName: 'sample.xls',
    startedAtUtc: '2026-08-23T00:00:00.000Z',
    stateHistory: [{ atUtc: '2026-08-23T00:00:00.000Z', state: 'RECEIVED' }],
    status: 'SUCCESS',
    targetWorkbookId: 'target-sample',
  };
  const errorRecord = {
    atUtc: '2026-08-23T00:00:30.000Z',
    category: 'SOURCE',
    details: { missingHeaders: ['Required Header'] },
    errorCode: 'SCHEMA_MISSING_REQUIRED_COLUMNS',
    failureState: 'FAILED_SOURCE',
    message: 'Required source columns are missing.',
    runId: 'run-failed',
    state: 'VALIDATING_SCHEMA',
  };

  repository.persist([runRecord, { ...runRecord, runId: 'run-sample-2' }], [
    errorRecord,
    { ...errorRecord, runId: 'run-failed-2' },
  ]);

  assert.deepEqual(runSheet.rows[0], RunLogger.HEADERS);
  assert.deepEqual(errorSheet.rows[0], ErrorLogger.HEADERS);
  assert.equal(runSheet.writeCalls.length, 2);
  assert.equal(errorSheet.writeCalls.length, 2);
  assert.equal(runSheet.writeCalls[1].values.length, 2);
  assert.equal(errorSheet.writeCalls[1].values.length, 2);
  assert.deepEqual(runSheet.rows[1], [
    'run-sample',
    '2026-08-23T00:00:00.000Z',
    '2026-08-23T00:01:00.000Z',
    null,
    'sample.xls',
    'file-sample',
    '1.0.0',
    '{"Handled":2}',
    '{"Handled":2}',
    'target-sample',
    'SUCCESS',
    null,
    '[{"atUtc":"2026-08-23T00:00:00.000Z","state":"RECEIVED"}]',
  ]);
  assert.deepEqual(errorSheet.rows[1], [
    'run-failed',
    '2026-08-23T00:00:30.000Z',
    'VALIDATING_SCHEMA',
    'FAILED_SOURCE',
    'SOURCE',
    'SCHEMA_MISSING_REQUIRED_COLUMNS',
    'Required source columns are missing.',
    '{"missingHeaders":["Required Header"]}',
  ]);

  runSheet.writeCalls = [];
  errorSheet.writeCalls = [];
  repository.persist([{ ...runRecord, runId: 'run-sample-3' }], []);
  assert.equal(runSheet.writeCalls.length, 1);
  assert.equal(runSheet.writeCalls[0].values.length, 1);
  assert.equal(errorSheet.writeCalls.length, 0);

  const driftedRunSheet = new FakeLogSheet('RUN_LOG', [['Wrong Header']]);
  const driftedRepository = RunRepository.create(
    new FakeControlSpreadsheet([driftedRunSheet, new FakeLogSheet('ERROR_LOG')]),
  );
  assert.throws(
    () => driftedRepository.persist([runRecord], []),
    (error) => error.code === 'REPORTING_LOG_SCHEMA_MISMATCH',
  );
  assert.equal(driftedRunSheet.writeCalls.length, 0);
});

// Defect caught: Apps Script evaluates a consumer before its global dependency files.
test('Apps Script globals resolve dependencies at call time instead of source-load time', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const context = vm.createContext({});
  const source = (relativePath) =>
    fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

  vm.runInContext(source('src/ingestion/RunService.js'), context);
  vm.runInContext(source('src/repository/RunRepository.js'), context);
  for (const dependency of [
    'src/monitoring/ErrorCodes.js',
    'src/ingestion/RunStateMachine.js',
    'src/services/ScriptLock.js',
    'src/monitoring/RunLogger.js',
    'src/monitoring/ErrorLogger.js',
  ]) {
    vm.runInContext(source(dependency), context);
  }

  const runSheet = new FakeLogSheet('RUN_LOG');
  const errorSheet = new FakeLogSheet('ERROR_LOG');
  const repository = context.RunRepository.create(
    new FakeControlSpreadsheet([runSheet, errorSheet]),
  );
  const result = context.RunService.execute(
    validRequest(),
    operationsWith(),
    servicesWith({ repository }),
  );

  assert.equal(result.runRecord.status, 'SUCCESS');
  assert.equal(runSheet.rows[1][10], 'SUCCESS');
});

// Defect caught: RUN_LOG is appended before a known ERROR_LOG header mismatch is rejected.
test('run repository preflights every required log schema before appending either batch', () => {
  const RunLogger = loadModule('../src/monitoring/RunLogger.js');
  const RunRepository = loadModule('../src/repository/RunRepository.js');
  const runSheet = new FakeLogSheet('RUN_LOG', [RunLogger.HEADERS]);
  const errorSheet = new FakeLogSheet('ERROR_LOG', [['Wrong Header']]);
  const repository = RunRepository.create(
    new FakeControlSpreadsheet([runSheet, errorSheet]),
  );

  assert.throws(
    () => repository.persist(
      [{ runId: 'run-preflight', inputRowCounts: {}, outputRowCounts: {}, stateHistory: [] }],
      [{ runId: 'run-preflight', details: {} }],
    ),
    (error) => error.code === 'REPORTING_LOG_SCHEMA_MISMATCH',
  );
  assert.equal(runSheet.writeCalls.length, 0);
  assert.equal(errorSheet.writeCalls.length, 0);
});
