const assert = require('node:assert/strict');
const test = require('node:test');

const ReportingSurfaceReferenceModel = require(
  '../src/transformations/ReportingSurfaceReferenceModel.js',
);
const ReportingSurfaceTransformationService = require(
  '../src/services/ReportingSurfaceTransformationService.js',
);
const ReportingSurfaceFormulaCatalog = require(
  '../src/transformations/ReportingSurfaceFormulaCatalog.js',
);
const StableAggregationFormulaCatalog = require(
  '../src/transformations/StableAggregationFormulaCatalog.js',
);
const Cxp10Setup = require('../src/main/Cxp10Setup.js');
const parityFixture = require('./fixtures/cxp10/report-parity.json');

class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  getDisplayValues() {
    return this.getValues();
  }

  getFormula() {
    return this.sheet.formulas.get(`${this.row}:${this.column}`) || '';
  }

  getValues() {
    if (this.row === 1 && this.rowCount === 1) {
      return [this.sheet.headers.slice(this.column - 1, this.column - 1 + this.columnCount)];
    }
    return [[]];
  }

  setFormula(formula) {
    this.sheet.formulas.set(`${this.row}:${this.column}`, formula);
    this.sheet.formulaWriteCount += 1;
    return this;
  }

  setValues(values) {
    if (this.row === 1 && this.rowCount === 1) {
      this.sheet.headers = values[0].slice();
    }
    if (this.row === ReportingSurfaceFormulaCatalog.HEADER_ROW && this.column === 4) {
      this.sheet.metricHeaders = values[0].slice();
    }
    this.sheet.valueWriteCount += 1;
    return this;
  }
}

class FakeSheet {
  constructor(name, headers = [], maxRows = 200, maxColumns = 30) {
    this.name = name;
    this.headers = headers.slice();
    this.metricHeaders = [];
    this.maxRows = maxRows;
    this.maxColumns = maxColumns;
    this.formulaWriteCount = 0;
    this.valueWriteCount = 0;
    this.formulas = new Map();
    this.lastRow = 2;
  }

  getLastRow() {
    return this.lastRow;
  }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    return new FakeRange(this, row, column, rowCount, columnCount);
  }
}

function createFormulaHarness() {
  const sheets = new Map();
  StableAggregationFormulaCatalog.list().forEach((spec) => {
    sheets.set(spec.aggregationSheetName, new FakeSheet(spec.aggregationSheetName, spec.headers));
  });
  sheets.set('Interval View', new FakeSheet('Interval View'));
  sheets.set('MOM', new FakeSheet('MOM'));
  return {
    sheets,
    spreadsheet: {
      getSheetByName(name) {
        return sheets.get(name) || null;
      },
    },
  };
}

function createPropertyStore(initialValues) {
  const values = new Map(Object.entries(initialValues));
  return {
    deleteProperty(name) {
      values.delete(name);
      return this;
    },
    getProperty(name) {
      return values.has(name) ? values.get(name) : null;
    },
    setProperty(name, value) {
      values.set(name, String(value));
      return this;
    },
  };
}

function createTriggerService() {
  const triggers = [];
  let nextId = 1;
  return {
    deleteTrigger(trigger) {
      const index = triggers.indexOf(trigger);
      if (index >= 0) {
        triggers.splice(index, 1);
      }
    },
    getProjectTriggers() {
      return triggers.slice();
    },
    newTrigger(handler) {
      const draft = { delayMs: null, handler };
      const builder = {
        after(delayMs) {
          draft.delayMs = delayMs;
          return builder;
        },
        create() {
          const trigger = {
            delayMs: draft.delayMs,
            getHandlerFunction() {
              return draft.handler;
            },
            getUniqueId() {
              return `trigger-${nextId++}`;
            },
          };
          triggers.push(trigger);
          return trigger;
        },
        timeBased() {
          return builder;
        },
      };
      return builder;
    },
    triggers,
  };
}

test('CXP-10 reference model reproduces the report parity fixture', () => {
  const actual = ReportingSurfaceReferenceModel.transform(parityFixture.inputs);
  assert.deepEqual(actual.intervalView, parityFixture.expected.intervalView);
  assert.equal(actual.metricOrder.length, 25);
});

test('CXP-10 installs Interval View, MOM, and forecast bridge formulas', () => {
  const harness = createFormulaHarness();
  const result = ReportingSurfaceTransformationService.install(harness.spreadsheet);

  assert.equal(result.metricCount, 25);
  assert.equal(result.reportSheetCount, 2);
  assert.ok(result.formulaAnchorCount >= 40);

  const intervalView = harness.sheets.get('Interval View');
  const mom = harness.sheets.get('MOM');
  const forecast = harness.sheets.get('_AGG_FORECAST');
  assert.match(intervalView.formulas.get('113:5'), /SUMIFS/);
  assert.match(intervalView.formulas.get('113:5'), /_AGG_INTERVAL/);
  assert.match(intervalView.formulas.get('113:4'), /_AGG_FORECAST/);
  assert.match(forecast.formulas.get('2:1'), /QUERY\(MOM!/);
  assert.equal(mom.formulas.get('4:2'), '=IF($A$1="","",$A$1+0)');
});

test('CXP-10 exposes the report installation as retry-safe bounded steps', () => {
  const harness = createFormulaHarness();
  const stepCount = ReportingSurfaceTransformationService.getInstallStepCount();
  assert.ok(stepCount >= 40);

  const labels = [];
  for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
    labels.push(
      ReportingSurfaceTransformationService.installStep(
        harness.spreadsheet,
        stepIndex,
      ).label,
    );
  }

  assert.equal(labels[0], 'PREFLIGHT');
  assert.equal(labels[1], 'Interval View:HEADERS');
  assert.equal(labels.at(-1), 'Forecast Bridge:FORMULA');
});

test('CXP-10 configured setup opens only the target workbook and installs report surfaces', () => {
  const harness = createFormulaHarness();
  const openedIds = [];
  const properties = {
    getProperty(name) {
      return {
        CXP_ENV: 'DEV',
        CXP_DEV_TARGET_SPREADSHEET_ID: 'synthetic-target-id',
      }[name] ?? null;
    },
  };

  const result = Cxp10Setup.initializeConfigured(properties, {
    spreadsheetApp: {
      openById(id) {
        openedIds.push(id);
        return harness.spreadsheet;
      },
    },
  });

  assert.deepEqual(openedIds, ['synthetic-target-id']);
  assert.equal(result.environment, 'DEV');
  assert.equal(result.transformations.metricCount, 25);
});

test('CXP-10 hosted setup checkpoints before timeout and resumes without replaying steps', () => {
  const harness = createFormulaHarness();
  const properties = createPropertyStore({
    CXP_ENV: 'DEV',
    CXP_DEV_TARGET_SPREADSHEET_ID: 'synthetic-target-id',
  });
  const scriptApp = createTriggerService();
  const completedSteps = [];
  let nowMs = Date.parse('2026-08-25T00:00:00.000Z');
  const services = {
    clock: {
      now() {
        return new Date(nowMs);
      },
    },
    lockService: {
      getScriptLock() {
        return {
          releaseLock() {},
          tryLock() {
            return true;
          },
        };
      },
    },
    maxRuntimeMs: 240000,
    scriptApp,
    spreadsheetApp: {
      openById() {
        return harness.spreadsheet;
      },
    },
    transformationService: {
      getInstallStepCount() {
        return 3;
      },
      installStep(_spreadsheet, stepIndex) {
        completedSteps.push(stepIndex);
        nowMs += 150000;
        return { label: `STEP_${stepIndex}` };
      },
    },
  };

  const first = Cxp10Setup.initializeConfigured(properties, services);
  assert.equal(first.status, 'RUNNING');
  assert.equal(first.nextStep, 2);
  assert.deepEqual(completedSteps, [0, 1]);

  const second = Cxp10Setup.continueConfigured(properties, services);
  assert.equal(second.status, 'COMPLETE');
  assert.equal(second.nextStep, 3);
  assert.deepEqual(completedSteps, [0, 1, 2]);
});

test('CXP-10 rejects installation when required aggregation sheets are missing', () => {
  const harness = createFormulaHarness();
  harness.sheets.delete('_AGG_INTERVAL');
  assert.throws(
    () => ReportingSurfaceTransformationService.install(harness.spreadsheet),
    /_AGG_INTERVAL/,
  );
});

test('CXP-10 metric headers match the CXP-01 registry order', () => {
  assert.deepEqual(
    ReportingSurfaceFormulaCatalog.METRIC_HEADERS,
    ReportingSurfaceReferenceModel.METRIC_ORDER,
  );
  assert.equal(ReportingSurfaceFormulaCatalog.METRIC_HEADERS.length, 25);
});
