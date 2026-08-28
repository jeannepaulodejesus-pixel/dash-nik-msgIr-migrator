const assert = require('node:assert/strict');
const test = require('node:test');

const StableAggregationReferenceModel = require(
  '../src/transformations/StableAggregationReferenceModel.js',
);
const StableAggregationTransformationService = require(
  '../src/services/StableAggregationTransformationService.js',
);
const StableAggregationFormulaCatalog = require(
  '../src/transformations/StableAggregationFormulaCatalog.js',
);
const HandledOfferedFormulaCatalog = require(
  '../src/transformations/HandledOfferedFormulaCatalog.js',
);
const AhtAuxesStaffFormulaCatalog = require(
  '../src/transformations/AhtAuxesStaffFormulaCatalog.js',
);
const Cxp09Setup = require('../src/main/Cxp09Setup.js');
const parityFixture = require('./fixtures/cxp09/aggregation-parity.json');

class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  clearContent() {
    this.sheet.clearCount += 1;
    return this;
  }

  getValues() {
    if (this.row === 1 && this.rowCount === 1) {
      return [this.sheet.headers.slice(this.column - 1, this.column - 1 + this.columnCount)];
    }
    return [];
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
    this.sheet.valueWriteCount += 1;
    return this;
  }
}

class FakeSheet {
  constructor(name, headers = [], maxRows = 1000, maxColumns = 60) {
    this.name = name;
    this.headers = headers.slice();
    this.maxRows = maxRows;
    this.maxColumns = maxColumns;
    this.clearCount = 0;
    this.formulaWriteCount = 0;
    this.valueWriteCount = 0;
    this.formulas = new Map();
    this.lastRow = 1;
  }

  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(1, this.maxRows), Math.max(1, this.maxColumns));
  }

  getLastRow() {
    return this.lastRow;
  }

  getMaxColumns() {
    return this.maxColumns;
  }

  getMaxRows() {
    return this.maxRows;
  }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    return new FakeRange(this, row, column, rowCount, columnCount);
  }

  insertColumnsAfter(_after, count) {
    this.maxColumns += count;
  }

  insertRowsAfter(_after, count) {
    this.maxRows += count;
  }
}

function createFormulaHarness() {
  const sheets = new Map();
  HandledOfferedFormulaCatalog.list().forEach((spec) => {
    sheets.set(spec.calculationSheetName, new FakeSheet(spec.calculationSheetName));
  });
  AhtAuxesStaffFormulaCatalog.list().forEach((spec) => {
    sheets.set(spec.calculationSheetName, new FakeSheet(spec.calculationSheetName));
  });
  StableAggregationFormulaCatalog.list().forEach((spec) => {
    sheets.set(
      spec.aggregationSheetName,
      new FakeSheet(spec.aggregationSheetName, [], spec.rowCapacity + 1, spec.headers.length),
    );
  });
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

test('CXP-09 reference model reproduces the aggregation parity fixture', () => {
  const actual = StableAggregationReferenceModel.transform(parityFixture.inputs);
  assert.deepEqual(actual, parityFixture.expected);
});

test('CXP-09 installs bounded aggregation formulas with constant write count', () => {
  const harness = createFormulaHarness();
  const result = StableAggregationTransformationService.install(harness.spreadsheet);

  assert.deepEqual(result, {
    datasetCount: 3,
    formulaAnchorCount: 8,
    rowCapacity: 50,
  });

  const interval = harness.sheets.get('_AGG_INTERVAL');
  const forecast = harness.sheets.get('_AGG_FORECAST');
  const allocation = harness.sheets.get('_AGG_ALLOCATION');
  assert.equal(interval.maxRows, 51);
  assert.equal(interval.maxColumns, 12);
  assert.equal(forecast.maxColumns, 5);
  assert.equal(allocation.maxColumns, 6);
  assert.match(interval.formulas.get('2:1'), /QUERY\(/);
  assert.match(interval.formulas.get('2:1'), /_CALC_OFFERED/);
  assert.match(interval.formulas.get('2:9'), /_CALC_AHT/);
  assert.match(interval.formulas.get('2:10'), /_CALC_AHT/);
  assert.match(interval.formulas.get('2:11'), /_CALC_AHT/);
  assert.match(interval.formulas.get('2:12'), /_CALC_AHT/);
  assert.match(forecast.formulas.get('2:1'), /QUERY\(A2:E/);
  assert.match(allocation.formulas.get('2:1'), /_CALC_OFFERED/);
  assert.match(allocation.formulas.get('2:6'), /SUMIFS/);
  assert.equal(
    interval.formulaWriteCount + forecast.formulaWriteCount + allocation.formulaWriteCount,
    8,
  );
});

test('CXP-09 exposes the aggregation installation as retry-safe bounded steps', () => {
  const harness = createFormulaHarness();
  const stepCount = StableAggregationTransformationService.getInstallStepCount();
  assert.equal(stepCount, 18);

  const labels = [];
  for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
    labels.push(
      StableAggregationTransformationService.installStep(
        harness.spreadsheet,
        stepIndex,
      ).label,
    );
  }

  assert.equal(labels[0], 'PREFLIGHT');
  assert.equal(labels.at(-1), 'Allocation:FORMULA:2');
  assert.equal(harness.sheets.get('_AGG_INTERVAL').formulas.size, 5);
  assert.equal(harness.sheets.get('_AGG_ALLOCATION').formulas.size, 2);
});

test('CXP-09 configured setup opens only the target workbook and installs the aggregation model', () => {
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

  const result = Cxp09Setup.initializeConfigured(properties, {
    spreadsheetApp: {
      openById(id) {
        openedIds.push(id);
        return harness.spreadsheet;
      },
    },
  });

  assert.deepEqual(openedIds, ['synthetic-target-id']);
  assert.deepEqual(result, {
    environment: 'DEV',
    transformations: {
      datasetCount: 3,
      formulaAnchorCount: 8,
      rowCapacity: 50,
    },
  });
});

test('CXP-09 hosted setup checkpoints before timeout and resumes without replaying steps', () => {
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

  const first = Cxp09Setup.initializeConfigured(properties, services);
  assert.equal(first.status, 'RUNNING');
  assert.equal(first.nextStep, 2);
  assert.deepEqual(completedSteps, [0, 1]);

  const second = Cxp09Setup.continueConfigured(properties, services);
  assert.equal(second.status, 'COMPLETE');
  assert.equal(second.nextStep, 3);
  assert.deepEqual(completedSteps, [0, 1, 2]);
});

test('CXP-09 rejects installation when required calculation sheets are missing', () => {
  const harness = createFormulaHarness();
  harness.sheets.delete('_CALC_OFFERED');
  assert.throws(
    () => StableAggregationTransformationService.install(harness.spreadsheet),
    /_CALC_OFFERED/,
  );
});

test('CXP-09 idempotent reinstall clears and restores aggregation topology', () => {
  const harness = createFormulaHarness();
  StableAggregationTransformationService.install(harness.spreadsheet);
  const interval = harness.sheets.get('_AGG_INTERVAL');
  const firstClearCount = interval.clearCount;
  StableAggregationTransformationService.install(harness.spreadsheet);
  assert.equal(interval.clearCount, firstClearCount + 1);
  assert.equal(interval.formulas.size, 5);
});
