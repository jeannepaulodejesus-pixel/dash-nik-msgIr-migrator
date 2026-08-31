const assert = require('node:assert/strict');
const test = require('node:test');

const ControlWorkbookHeaders = require('../src/main/ControlWorkbookHeaders.js');
const Cxp11ParityRun = require('../src/main/Cxp11ParityRun.js');
const Cxp11ParityUat = require('../src/main/Cxp11UatEntrypoints.js');
const Cxp11Setup = require('../src/main/Cxp11Setup.js');
const FileLedgerRepository = require('../src/repository/FileLedgerRepository.js');
const LegacyExportAdapter = require('../src/parity/LegacyExportAdapter.js');
const ParityContracts = require('../src/parity/ParityContracts.js');
const ParityResultsRepository = require('../src/repository/ParityResultsRepository.js');
const ParityValidationInstallService = require('../src/services/ParityValidationInstallService.js');
const ReportingSurfaceFormulaCatalog = require(
  '../src/transformations/ReportingSurfaceFormulaCatalog.js',
);
const SourceErrorBaseline = require('../src/parity/SourceErrorBaseline.js');
const SourceErrorBaselineRepository = require('../src/repository/SourceErrorBaselineRepository.js');
const fixture = require('./fixtures/cxp11/synthetic-parity-bundle.json');

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.grid = [];
  }

  getName() {
    return this.name;
  }

  getLastRow() {
    for (let index = this.grid.length - 1; index >= 0; index -= 1) {
      const row = this.grid[index];
      if (row && row.some((cell) => cell !== '' && cell !== undefined && cell !== null)) {
        return index + 1;
      }
    }
    return 0;
  }

  cell(row, column, value) {
    while (this.grid.length < row) {
      this.grid.push([]);
    }
    const target = this.grid[row - 1];
    while (target.length < column) {
      target.push('');
    }
    if (value !== undefined) {
      target[column - 1] = value;
    }
    return target[column - 1];
  }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    const sheet = this;
    return {
      clearContent() {
        for (let r = 0; r < rowCount; r += 1) {
          for (let c = 0; c < columnCount; c += 1) {
            sheet.cell(row + r, column + c, '');
          }
        }
        return this;
      },
      getValue() {
        return sheet.cell(row, column);
      },
      getDisplayValue() {
        return sheet.cell(row, column);
      },
      getValues() {
        const values = [];
        for (let r = 0; r < rowCount; r += 1) {
          const line = [];
          for (let c = 0; c < columnCount; c += 1) {
            line.push(sheet.cell(row + r, column + c));
          }
          values.push(line);
        }
        return values;
      },
      setValues(matrix) {
        matrix.forEach((line, r) => {
          line.forEach((value, c) => {
            sheet.cell(row + r, column + c, value);
          });
        });
        return this;
      },
      setNumberFormat() {
        return this;
      },
    };
  }
}

class FakeSpreadsheet {
  constructor(names) {
    this.sheets = new Map(names.map((name) => [name, new FakeSheet(name)]));
  }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }
}

class FakeProperties {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
  }

  getProperty(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setProperty(key, value) {
    this.values.set(key, value);
  }

  deleteProperty(key) {
    this.values.delete(key);
  }
}

class FakeScriptApp {
  constructor() {
    this.triggers = [];
  }

  getProjectTriggers() {
    return this.triggers.slice();
  }

  deleteTrigger(trigger) {
    this.triggers = this.triggers.filter((candidate) => candidate !== trigger);
  }

  newTrigger(handler) {
    const scriptApp = this;
    return {
      timeBased() {
        return {
          after() {
            return {
              create() {
                const trigger = { getHandlerFunction: () => handler };
                scriptApp.triggers.push(trigger);
                return trigger;
              },
            };
          },
        };
      },
    };
  }
}

function controlSpreadsheet() {
  return new FakeSpreadsheet(['PARITY_RESULTS', 'SOURCE_ERROR_BASELINE']);
}

function setupServices(spreadsheet, overrides = {}) {
  return {
    clock: { now: () => new Date('2026-08-31T00:00:00Z') },
    lockService: {
      getScriptLock: () => ({ releaseLock() {}, tryLock: () => overrides.lockAcquired !== false }),
    },
    maxRuntimeMs: overrides.maxRuntimeMs,
    scriptApp: overrides.scriptApp || new FakeScriptApp(),
    spreadsheetApp: { openById: () => spreadsheet },
  };
}

function comparison(overrides = {}) {
  return {
    aggregationIdentity: 'id',
    businessDate: '2026-08-18',
    chunkId: 'METRICS:0',
    classification: ParityContracts.CLASSIFICATIONS.match,
    comparedAtUtc: '2026-08-18T19:00:00.000Z',
    comparisonId: 'c1',
    dataset: '',
    delta: 0,
    intervalStart: '10:00',
    lineage: '{}',
    metricName: 'Offered',
    phase: ParityContracts.RUN_STATES.metrics,
    queueOrLob: 'ALL',
    resolutionStatus: ParityContracts.RESOLUTION_STATUSES.notRequired,
    runId: 'RUN-1',
    site: 'ALL',
    sourceValue: 4,
    targetValue: 4,
    tolerance: 0,
    ...overrides,
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code, `expected ${code} but got ${error.code}`);
    return true;
  });
}

test('the hosted fixture mirrors the committed synthetic bundle', () => {
  assert.equal(Cxp11ParityUat.FIXTURE.acquisitionTimestampUtc, fixture.acquisitionTimestampUtc);
  assert.equal(Cxp11ParityUat.FIXTURE.sourceBundleFingerprint, fixture.sourceBundleFingerprint);
  assert.deepEqual(
    Object.keys(Cxp11ParityUat.FIXTURE.datasets).sort(),
    Object.keys(fixture.datasets).sort(),
  );
  Object.keys(fixture.datasets).forEach((datasetName) => {
    assert.deepEqual(
      Cxp11ParityUat.FIXTURE.datasets[datasetName].map((row) => ({ ...row })),
      fixture.datasets[datasetName],
    );
  });
  assert.deepEqual(
    Cxp11ParityUat.FIXTURE.legacyErrors.map((row) => ({ ...row })),
    fixture.legacyErrors,
  );
});

test('the embedded legacy-error rows reproduce the WB0817 baseline totals', () => {
  const observed = Cxp11ParityUat.FIXTURE.legacyErrors.reduce(
    (total, row) => total + row.observedCount,
    0,
  );
  assert.equal(observed, ParityContracts.BASELINE_TOTAL_ERRORS);
  assert.notEqual(observed, ParityContracts.SUPERSEDED_BASELINE_TOTAL_ERRORS);
});

test('the bundle builder emits a manifest the export adapter accepts', () => {
  const bundle = Cxp11ParityUat.buildBundleFiles({
    legacyMetrics: fixture.legacyMetrics,
  });
  const manifest = JSON.parse(bundle.manifestText);

  assert.equal(manifest.contractVersion, ParityContracts.CONTRACT_VERSION);
  assert.equal(manifest.baselineVersion, ParityContracts.BASELINE_VERSION);
  assert.equal(manifest.files.length, ParityContracts.listExportFileNames().length - 1);
  assert.deepEqual(
    Object.keys(bundle.files).sort(),
    ParityContracts.listExportFileNames()
      .filter((name) => name !== ParityContracts.MANIFEST_FILE_NAME)
      .sort(),
  );

  const validated = LegacyExportAdapter.create({}).validate(bundle);
  assert.equal(validated.datasets.length, 5);
  assert.equal(validated.metrics.length, fixture.legacyMetrics.length);
});

test('the fixture export reader replays the same bundle bytes on every read', () => {
  const reader = Cxp11ParityUat.createFixtureExportReader({
    legacyMetrics: fixture.legacyMetrics,
  });
  const first = reader.read();
  const second = reader.read();

  assert.equal(first.manifestText, second.manifestText);
  assert.deepEqual(Object.keys(first.files), Object.keys(second.files));
  first.files['offered.csv'] = 'mutated';
  assert.notEqual(reader.read().files['offered.csv'], 'mutated');
});

test('Step 03 seeds a SUCCESS FILE_LEDGER row for the synthetic fingerprint', () => {
  const spreadsheet = new FakeSpreadsheet(['FILE_LEDGER']);
  const first = Cxp11ParityUat.seedSyntheticLedgerEntry(spreadsheet);

  assert.equal(first.seeded, true);
  assert.equal(first.fingerprint, Cxp11ParityUat.FIXTURE.sourceBundleFingerprint);
  assert.equal(first.ingestionRunId, Cxp11ParityUat.SYNTHETIC_LEDGER_RUN_ID);

  const entry = FileLedgerRepository.create(spreadsheet)
    .findSuccessfulByFingerprint(first.fingerprint);
  assert.equal(entry.result, 'SUCCESS');
  assert.equal(entry.runId, Cxp11ParityUat.SYNTHETIC_LEDGER_RUN_ID);

  const identity = LegacyExportAdapter.create({}).assertLedgerIdentity(
    { sourceBundleFingerprint: first.fingerprint },
    entry,
  );
  assert.equal(identity.ingestionRunId, Cxp11ParityUat.SYNTHETIC_LEDGER_RUN_ID);

  const second = Cxp11ParityUat.seedSyntheticLedgerEntry(spreadsheet);
  assert.equal(second.seeded, false);
  assert.equal(second.ingestionRunId, Cxp11ParityUat.SYNTHETIC_LEDGER_RUN_ID);
  assert.equal(spreadsheet.getSheetByName('FILE_LEDGER').getLastRow(), 2);
});

test('fixed-PST grains shift forward by 480 minutes into legacy UTC grains', () => {
  assert.deepEqual(
    Cxp11ParityUat.shiftToLegacyUtcGrain({ businessDate: '2026-08-18', intervalStart: '10:00' }),
    { businessDate: '2026-08-18', intervalStart: '18:00' },
  );
  assert.deepEqual(
    Cxp11ParityUat.shiftToLegacyUtcGrain({ businessDate: '2026-08-17', intervalStart: '23:30' }),
    { businessDate: '2026-08-18', intervalStart: '07:30' },
  );
});

test('Step 05 classifies DEC-025 and known errors without migration defects', () => {
  const report = Cxp11ParityUat.validateExpectedVarianceAndErrors({
    legacyMetrics: [{
      aggregationIdentity: 'INTERVAL_VIEW',
      businessDate: '2026-08-18',
      intervalStart: '18:00',
      metric: 'Offered',
      queueOrLob: 'ALL',
      site: 'ALL',
      value: '4',
    }],
    migratedMetrics: [
      {
        aggregationIdentity: 'INTERVAL_VIEW',
        businessDate: '2026-08-18',
        intervalStart: '10:00',
        metric: 'Offered',
        queueOrLob: 'ALL',
        site: 'ALL',
        value: 11,
      },
      {
        aggregationIdentity: 'INTERVAL_VIEW',
        businessDate: '2026-08-18',
        intervalStart: '18:00',
        metric: 'Offered',
        queueOrLob: 'ALL',
        site: 'ALL',
        value: 4,
      },
    ],
  });

  assert.equal(report.approvedVarianceCount, 1);
  assert.equal(report.expectedSourceErrorCount, 6);
  assert.equal(report.migrationDefectCount, 0);
  assert.equal(report.defectCount, 0);
  assert.equal(report.baselineObservedTotal, ParityContracts.BASELINE_TOTAL_ERRORS);
  assert.equal(report.pass, true);
});

test('Step 05 fails when an observed legacy error is not in the baseline', () => {
  const report = Cxp11ParityUat.validateExpectedVarianceAndErrors({
    legacyErrors: Cxp11ParityUat.FIXTURE.legacyErrors.concat([{
      cellOrRange: 'A1:A9',
      errorToken: '#NAME?',
      formulaFamily: 'unknown',
      observedCount: 4,
      worksheet: 'Data',
    }]),
  });

  assert.equal(report.pass, false);
  assert.notEqual(report.baselineObservedTotal, report.baselineExpectedTotal);
});

test('Step 08 requires setup, schemas, source identity, and a passing summary', () => {
  const originalSetupStatus = global.getCxp11ParityValidationSetupStatus;
  const originalDiagnose = global.diagnoseCxp11RunbookChecks;
  const originalRun = global.Cxp11ParityRun;

  global.getCxp11ParityValidationSetupStatus = () => ({
    nextStep: 6,
    status: ParityContracts.SETUP_STATES.complete,
    stepCount: 6,
  });
  global.diagnoseCxp11RunbookChecks = () => ({
    controls: {
      parityResults: { schemaOk: true },
      sourceErrorBaseline: { schemaOk: true, totalsOk: true },
    },
    setupStatus: { status: ParityContracts.SETUP_STATES.complete },
  });

  try {
    global.Cxp11ParityRun = {
      getStatus: () => ({
        baselineExpectedTotal: 1885,
        baselineObservedTotal: 1885,
        runId: 'RUN-1',
        runState: ParityContracts.RUN_STATES.complete,
        summary: {
          comparisonCount: 20,
          datasetCount: 5,
          defectCount: 0,
          metricCount: 25,
          pass: true,
        },
      }),
    };
    const ready = Cxp11ParityUat.promotionGate('control-id');
    assert.equal(ready.promotionReady, true);
    assert.equal(ready.setupComplete, true);
    assert.equal(ready.schemasReady, true);
    assert.equal(ready.sourceIdentityVerified, true);

    global.Cxp11ParityRun = {
      getStatus: () => ({
        baselineExpectedTotal: 1885,
        baselineObservedTotal: 1884,
        runId: 'RUN-2',
        runState: ParityContracts.RUN_STATES.complete,
        summary: {
          comparisonCount: 20,
          datasetCount: 5,
          defectCount: 1,
          metricCount: 25,
          pass: false,
        },
      }),
    };
    const blocked = Cxp11ParityUat.promotionGate('control-id');
    assert.equal(blocked.promotionReady, false);
    assert.equal(blocked.sourceIdentityVerified, false);
  } finally {
    global.getCxp11ParityValidationSetupStatus = originalSetupStatus;
    global.diagnoseCxp11RunbookChecks = originalDiagnose;
    global.Cxp11ParityRun = originalRun;
  }
});

test('the control installer declares ordered, idempotent steps', () => {
  assert.deepEqual(ParityValidationInstallService.listInstallStepLabels(), [
    'INSTALL_PARITY_RESULTS_SCHEMA',
    'INSTALL_SOURCE_ERROR_BASELINE_SCHEMA',
    'SEED_WB0817_SOURCE_ERROR_BASELINE',
    'VERIFY_WB0817_BASELINE_TOTALS',
    'PROTECT_PARITY_RESULTS',
    'PROTECT_SOURCE_ERROR_BASELINE',
  ]);
  assert.equal(ParityValidationInstallService.getInstallStepCount(), 6);

  const spreadsheet = controlSpreadsheet();
  ParityValidationInstallService.install(spreadsheet);
  ParityValidationInstallService.install(spreadsheet);

  const baselineSheet = spreadsheet.getSheetByName('SOURCE_ERROR_BASELINE');
  assert.deepEqual(
    baselineSheet.getRange(1, 1, 1, SourceErrorBaselineRepository.HEADERS.length).getValues()[0],
    SourceErrorBaselineRepository.HEADERS,
  );
  assert.equal(baselineSheet.getLastRow(), SourceErrorBaseline.listRecords().length + 1);

  const inspection = ParityValidationInstallService.inspect(spreadsheet);
  assert.equal(inspection.parityResults.schemaOk, true);
  assert.equal(inspection.sourceErrorBaseline.totalsOk, true);
  assert.equal(inspection.sourceErrorBaseline.actualTotal, 1885);
});

test('a drifted baseline sheet fails verification instead of passing silently', () => {
  const spreadsheet = controlSpreadsheet();
  ParityValidationInstallService.install(spreadsheet);
  const repository = SourceErrorBaselineRepository.create(spreadsheet);
  const expectedCountColumn = SourceErrorBaselineRepository.HEADERS.indexOf('Expected Count') + 1;
  spreadsheet.getSheetByName('SOURCE_ERROR_BASELINE').cell(2, expectedCountColumn, 900);

  expectCode(() => repository.verifyInstalled(), 'PARITY_BASELINE_COUNT_MISMATCH');
});

test('parity result chunks append once and stay retry-safe', () => {
  const spreadsheet = controlSpreadsheet();
  const repository = ParityResultsRepository.create(spreadsheet);
  repository.installHeaders({ overwrite: true });

  const first = repository.appendChunk('RUN-1', 'METRICS:0', [comparison(), comparison({
    classification: ParityContracts.CLASSIFICATIONS.migrationDefect,
    comparisonId: 'c2',
    resolutionStatus: ParityContracts.RESOLUTION_STATUSES.open,
  })]);
  assert.equal(first.appended, true);
  assert.equal(first.rowCount, 2);

  const replayed = repository.appendChunk('RUN-1', 'METRICS:0', [comparison()]);
  assert.equal(replayed.appended, false);
  assert.equal(replayed.rowCount, 0);

  assert.deepEqual(repository.listChunkIds('RUN-1'), ['METRICS:0']);
  assert.equal(repository.hasChunk('RUN-1', 'METRICS:5'), false);

  const summary = repository.summarizeRun('RUN-1');
  assert.equal(summary.comparisonCount, 2);
  assert.equal(summary.byClassification.MATCH, 1);
  assert.equal(summary.byClassification.MIGRATION_DEFECT, 1);

  const other = repository.appendChunk('RUN-2', 'METRICS:0', [comparison({ runId: 'RUN-2' })]);
  assert.equal(other.appended, true);
  assert.equal(repository.summarizeRun('RUN-1').comparisonCount, 2);
});

test('a drifted PARITY_RESULTS header is rejected', () => {
  const spreadsheet = controlSpreadsheet();
  const repository = ParityResultsRepository.create(spreadsheet);
  repository.installHeaders({ overwrite: true });
  spreadsheet.getSheetByName('PARITY_RESULTS').cell(1, 2, 'Comparison');

  expectCode(() => repository.ensureHeaders(), 'PARITY_RESULTS_SCHEMA_MISMATCH');
});

test('control header seeding uses the final CXP-11 write contracts', () => {
  const headers = ControlWorkbookHeaders.headersBySheetName();

  assert.deepEqual(headers.PARITY_RESULTS, ParityResultsRepository.HEADERS);
  assert.deepEqual(headers.SOURCE_ERROR_BASELINE, SourceErrorBaselineRepository.HEADERS);
  assert.equal(headers.PARITY_RESULTS.includes('Chunk ID'), true);
  assert.equal(headers.SOURCE_ERROR_BASELINE.includes('Expected Count'), true);
});

test('setup install completes, is idempotent, and reports a sanitized status', () => {
  const spreadsheet = controlSpreadsheet();
  const properties = new FakeProperties({
    CXP_DEV_CONTROL_SPREADSHEET_ID: 'control-id',
    CXP_ENV: 'DEV',
  });
  const services = setupServices(spreadsheet);

  const first = Cxp11Setup.initializeConfigured(properties, services);
  assert.equal(first.status, ParityContracts.SETUP_STATES.complete);
  assert.equal(first.nextStep, first.stepCount);
  assert.equal(first.continuationScheduled, false);
  assert.equal(services.scriptApp.getProjectTriggers().length, 0);

  const status = Cxp11Setup.getStatus(properties, services);
  assert.equal(status.status, ParityContracts.SETUP_STATES.complete);
  assert.equal(status.baselineVersion, 'WB0817');
  assert.equal(status.lastError, null);
  assert.equal(Object.prototype.hasOwnProperty.call(status, 'controlSpreadsheetId'), true);

  const reinstall = Cxp11Setup.initializeConfigured(properties, services);
  assert.equal(reinstall.status, ParityContracts.SETUP_STATES.complete);
  assert.equal(
    spreadsheet.getSheetByName('SOURCE_ERROR_BASELINE').getLastRow(),
    SourceErrorBaseline.listRecords().length + 1,
  );
});

test('setup checkpoints on a zero budget and resumes through continuation', () => {
  const spreadsheet = controlSpreadsheet();
  const properties = new FakeProperties({
    CXP_DEV_CONTROL_SPREADSHEET_ID: 'control-id',
    CXP_ENV: 'DEV',
  });
  const services = setupServices(spreadsheet, { maxRuntimeMs: 0 });

  let result = Cxp11Setup.initializeConfigured(properties, services);
  assert.equal(result.status, ParityContracts.SETUP_STATES.running);
  assert.equal(result.continuationScheduled, true);
  assert.equal(result.nextStep, 1);
  assert.equal(services.scriptApp.getProjectTriggers().length, 1);

  let guard = 0;
  while (result.status === ParityContracts.SETUP_STATES.running && guard < 20) {
    result = Cxp11Setup.continueConfigured(properties, services);
    guard += 1;
  }

  assert.equal(result.status, ParityContracts.SETUP_STATES.complete);
  assert.equal(result.nextStep, result.stepCount);
  assert.equal(services.scriptApp.getProjectTriggers().length, 0);
});

test('setup refuses reset while RUNNING and clears state once terminal', () => {
  const spreadsheet = controlSpreadsheet();
  const properties = new FakeProperties({
    CXP_DEV_CONTROL_SPREADSHEET_ID: 'control-id',
    CXP_ENV: 'DEV',
  });
  const services = setupServices(spreadsheet, { maxRuntimeMs: 0 });

  Cxp11Setup.initializeConfigured(properties, services);
  assert.throws(
    () => Cxp11Setup.resetConfigured(properties, services),
    /RUNNING/,
  );

  const cleared = Cxp11Setup.resetConfigured(
    properties,
    Object.assign({}, services, { force: true }),
  );
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.stateKey, Cxp11Setup.STATE_KEY);
  assert.equal(properties.getProperty(Cxp11Setup.STATE_KEY), null);
  assert.equal(
    Cxp11Setup.getStatus(properties, services).status,
    ParityContracts.SETUP_STATES.idle,
  );
});

test('setup refuses to retarget a RUNNING install on another control workbook', () => {
  const properties = new FakeProperties({
    CXP_DEV_CONTROL_SPREADSHEET_ID: 'control-a',
    CXP_ENV: 'DEV',
  });
  const services = setupServices(controlSpreadsheet(), { maxRuntimeMs: 0 });
  Cxp11Setup.initializeConfigured(properties, services);

  properties.setProperty('CXP_DEV_CONTROL_SPREADSHEET_ID', 'control-b');
  assert.throws(
    () => Cxp11Setup.initializeConfigured(properties, setupServices(controlSpreadsheet(), {
      maxRuntimeMs: 0,
      scriptApp: services.scriptApp,
    })),
    /different environment or control workbook/,
  );
});

test('setup fails closed without a configured control workbook and under lock contention', () => {
  const withoutControl = new FakeProperties({ CXP_ENV: 'DEV' });
  assert.throws(
    () => Cxp11Setup.initializeConfigured(withoutControl, setupServices(controlSpreadsheet())),
    /CXP_DEV_CONTROL_SPREADSHEET_ID is required/,
  );

  const properties = new FakeProperties({
    CXP_DEV_CONTROL_SPREADSHEET_ID: 'control-id',
    CXP_ENV: 'DEV',
  });
  assert.throws(
    () => Cxp11Setup.initializeConfigured(
      properties,
      setupServices(controlSpreadsheet(), { lockAcquired: false }),
    ),
    /already running/,
  );
});

test('a failed setup step records a sanitized failure code and clears triggers', () => {
  const spreadsheet = controlSpreadsheet();
  spreadsheet.sheets.delete('SOURCE_ERROR_BASELINE');
  const properties = new FakeProperties({
    CXP_DEV_CONTROL_SPREADSHEET_ID: 'control-id',
    CXP_ENV: 'DEV',
  });
  const services = setupServices(spreadsheet);

  expectCode(
    () => Cxp11Setup.initializeConfigured(properties, services),
    'PARITY_BASELINE_SCHEMA_MISMATCH',
  );

  const status = Cxp11Setup.getStatus(properties, services);
  assert.equal(status.status, ParityContracts.SETUP_STATES.failed);
  assert.equal(status.lastError, 'PARITY_BASELINE_SCHEMA_MISMATCH');
  assert.equal(status.lastCompletedStep, 'INSTALL_PARITY_RESULTS_SCHEMA');
  assert.equal(services.scriptApp.getProjectTriggers().length, 0);
});

test('readMetrics uses the PST axis and AA2 when helper key columns are null', () => {
  assert.equal(ReportingSurfaceFormulaCatalog.INTERVAL_KEY_COLUMN, null);
  const catalog = ReportingSurfaceFormulaCatalog;
  const sheet = new FakeSheet('Interval View');
  const epoch = Date.UTC(1899, 11, 30);
  sheet.cell(
    catalog.VIEW_DATE_ROW,
    catalog.VIEW_DATE_COLUMN,
    (Date.UTC(2026, 7, 18) - epoch) / 86400000,
  );
  sheet.cell(catalog.FIRST_DATA_ROW, 3, 10 / 24);
  sheet.cell(catalog.FIRST_DATA_ROW, catalog.METRIC_COLUMNS.Offered, 4);

  const records = Cxp11ParityRun.createTargetReader({
    getSheetByName(name) {
      return name === 'Interval View' ? sheet : null;
    },
  }).readMetrics();

  const offered = records.find((row) => row.metric === 'Offered' && row.intervalStart === '10:00');
  assert.ok(offered);
  assert.equal(offered.businessDate, '2026-08-18');
  assert.equal(offered.value, 4);
  assert.equal(offered.aggregationIdentity, 'INTERVAL_VIEW');
});
