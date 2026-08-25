const assert = require('node:assert/strict');
const test = require('node:test');

const HandledOfferedReferenceModel = require(
  '../src/transformations/HandledOfferedReferenceModel.js'
);
const HandledOfferedTransformationService = require(
  '../src/services/HandledOfferedTransformationService.js'
);
const Cxp07Setup = require('../src/main/Cxp07Setup.js');
const SchemaRegistry = require('../src/ingestion/SchemaRegistry.js');
const parityFixture = require('./fixtures/cxp07/handled-offered-parity.json');

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

  setFormulas(formulas) {
    formulas[0].forEach((formula, index) => {
      this.sheet.formulas.set(`${this.row}:${this.column + index}`, formula);
    });
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
  constructor(name, headers, maxRows = 1000, maxColumns = 26) {
    this.name = name;
    this.headers = headers.slice();
    this.maxRows = maxRows;
    this.maxColumns = maxColumns;
    this.clearCount = 0;
    this.formulaWriteCount = 0;
    this.valueWriteCount = 0;
    this.formulas = new Map();
  }

  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(1, this.maxRows), Math.max(1, this.maxColumns));
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
  const handledHeaders = SchemaRegistry.getSchema('Handled').requiredHeaders;
  const offeredHeaders = SchemaRegistry.getSchema('Offered').requiredHeaders;
  const ahtHeaders = SchemaRegistry.getSchema('AHT - Raw').requiredHeaders;
  const sheets = new Map([
    ['_RAW_HANDLED', new FakeSheet('_RAW_HANDLED', handledHeaders)],
    ['_RAW_OFFERED', new FakeSheet('_RAW_OFFERED', offeredHeaders)],
    ['_RAW_AHT', new FakeSheet('_RAW_AHT', ahtHeaders)],
    ['_CALC_HANDLED', new FakeSheet('_CALC_HANDLED', [])],
    ['_CALC_OFFERED', new FakeSheet('_CALC_OFFERED', [])],
  ]);
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

test('CXP-07 reference model reproduces the Excel-control fixture after fixed-PST bucketing', () => {
  const actual = HandledOfferedReferenceModel.transform(parityFixture.inputs);

  assert.deepEqual(actual, parityFixture.expected);
});

test('CXP-07 installs bounded native spill formulas with constant write count', () => {
  const harness = createFormulaHarness();

  const result = HandledOfferedTransformationService.install(harness.spreadsheet);

  assert.deepEqual(result, {
    datasetCount: 2,
    formulaAnchorCount: 20,
    rowCapacity: 10000,
  });

  const handled = harness.sheets.get('_CALC_HANDLED');
  const offered = harness.sheets.get('_CALC_OFFERED');
  assert.equal(handled.maxRows, 10001);
  assert.equal(handled.maxColumns, 30);
  assert.equal(offered.maxRows, 10001);
  assert.equal(offered.maxColumns, 42);
  assert.deepEqual(handled.headers.slice(0, 3), ['Accept Date', 'Interval', 'AHT']);
  assert.deepEqual(offered.headers.slice(0, 15), [
    'Accept Date',
    'Interval View',
    'Athlete Site',
    'SL',
    'ASA',
    'Handled SL',
    'Handled ASA',
    'Count',
    'Handled',
    'Handled Fragments',
    'Response',
    'SL Total',
    'SL Total (Session)',
    'AHT Session',
    'Active Time',
  ]);
  assert.equal(handled.formulas.size, 4);
  assert.equal(offered.formulas.size, 16);
  assert.match(handled.formulas.get('2:1'), /^=ARRAYFORMULA\(/);
  assert.match(handled.formulas.get('2:1'), /-8\/24/);
  assert.match(handled.formulas.get('2:3'), /QUERY\(/);
  assert.match(handled.formulas.get('2:4'), /_RAW_HANDLED'!A2:AA10001/);
  assert.match(offered.formulas.get('2:16'), /_RAW_OFFERED'!A2:AA10001/);
  assert.equal(handled.valueWriteCount + offered.valueWriteCount, 2);
  assert.equal(handled.formulaWriteCount + offered.formulaWriteCount, 4);
});

test('CXP-07 exposes the native installation as retry-safe bounded steps', () => {
  const harness = createFormulaHarness();
  const stepCount = typeof HandledOfferedTransformationService.getInstallStepCount === 'function'
    ? HandledOfferedTransformationService.getInstallStepCount()
    : null;

  assert.equal(stepCount, 27);
  const labels = [];
  for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
    labels.push(
      HandledOfferedTransformationService.installStep(
        harness.spreadsheet,
        stepIndex,
      ).label,
    );
  }

  const handled = harness.sheets.get('_CALC_HANDLED');
  const offered = harness.sheets.get('_CALC_OFFERED');
  assert.equal(labels[0], 'PREFLIGHT');
  assert.equal(labels.at(-1), 'Offered:RAW_COPY');
  assert.equal(handled.formulas.size, 4);
  assert.equal(offered.formulas.size, 16);
  assert.equal(handled.maxRows, 10001);
  assert.equal(offered.maxRows, 10001);

  HandledOfferedTransformationService.installStep(
    harness.spreadsheet,
    stepCount - 1,
  );
  assert.equal(offered.formulas.size, 16);
});

test('CXP-07 configured setup opens only the target workbook and installs the native model', () => {
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

  const result = Cxp07Setup.initializeConfigured(properties, {
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
      datasetCount: 2,
      formulaAnchorCount: 20,
      rowCapacity: 10000,
    },
  });
});

test('CXP-07 hosted setup checkpoints before timeout and resumes without replaying steps', () => {
  const harness = createFormulaHarness();
  const properties = createPropertyStore({
    CXP_ENV: 'DEV',
    CXP_DEV_TARGET_SPREADSHEET_ID: 'synthetic-target-id',
  });
  const scriptApp = createTriggerService();
  const completedSteps = [];
  const safetyTriggerDelaysSeen = [];
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
        safetyTriggerDelaysSeen.push(scriptApp.triggers.map((trigger) => trigger.delayMs));
        completedSteps.push(stepIndex);
        nowMs += 150000;
        return { label: `STEP_${stepIndex}` };
      },
    },
  };

  const first = Cxp07Setup.initializeConfigured(properties, services);

  assert.equal(typeof Cxp07Setup.getStatus, 'function');
  assert.equal(first.status, 'RUNNING');
  assert.equal(first.nextStep, 2);
  assert.equal(first.stepCount, 3);
  assert.equal(first.continuationScheduled, true);
  assert.deepEqual(completedSteps, [0, 1]);
  assert.deepEqual(safetyTriggerDelaysSeen[0], [420000]);
  assert.deepEqual(
    {
      environment: Cxp07Setup.getStatus(properties).environment,
      nextStep: Cxp07Setup.getStatus(properties).nextStep,
      status: Cxp07Setup.getStatus(properties).status,
      stepCount: Cxp07Setup.getStatus(properties).stepCount,
    },
    { environment: 'DEV', nextStep: 2, status: 'RUNNING', stepCount: 3 },
  );
  assert.equal(scriptApp.triggers.length, 1);
  assert.equal(
    scriptApp.triggers[0].getHandlerFunction(),
    'continueCxp07HandledOfferedTransformations',
  );

  const second = Cxp07Setup.continueConfigured(properties, services);

  assert.equal(second.status, 'COMPLETE');
  assert.equal(second.nextStep, 3);
  assert.equal(second.continuationScheduled, false);
  assert.deepEqual(completedSteps, [0, 1, 2]);
  assert.equal(scriptApp.triggers.length, 0);
  assert.equal(Cxp07Setup.getStatus(properties).status, 'COMPLETE');
});

test('CXP-07 rejects schema drift before either calculation sheet is mutated', () => {
  const harness = createFormulaHarness();
  harness.sheets.get('_RAW_OFFERED').headers[0] = 'Unexpected Header';

  assert.throws(
    () => HandledOfferedTransformationService.install(harness.spreadsheet),
    /headers do not match the active CXP-03 schema/,
  );
  assert.equal(harness.sheets.get('_CALC_HANDLED').clearCount, 0);
  assert.equal(harness.sheets.get('_CALC_OFFERED').clearCount, 0);
});

test('CXP-07 rejects AHT schema drift before fixed source columns can be misread', () => {
  const harness = createFormulaHarness();
  harness.sheets.get('_RAW_AHT').headers[5] = 'Unexpected Accept Header';

  assert.throws(
    () => HandledOfferedTransformationService.install(harness.spreadsheet),
    /_RAW_AHT headers do not match the active CXP-03 schema/,
  );
  assert.equal(harness.sheets.get('_CALC_HANDLED').clearCount, 0);
  assert.equal(harness.sheets.get('_CALC_OFFERED').clearCount, 0);
});

test('CXP-07 preserves the Handled interval approximate forward-reverse lookup modes', () => {
  const harness = createFormulaHarness();

  HandledOfferedTransformationService.install(harness.spreadsheet);

  const handledInterval = harness.sheets.get('_CALC_HANDLED').formulas.get('2:2');
  const offeredInterval = harness.sheets.get('_CALC_OFFERED').formulas.get('2:2');
  assert.match(handledInterval, /,,1,1\)/);
  assert.match(handledInterval, /,,1,-1\)/);
  assert.doesNotMatch(offeredInterval, /,,1,(?:1|-1)\)/);
});

test('CXP-07 repeat installation preserves the same bounded spill architecture', () => {
  const harness = createFormulaHarness();

  const first = HandledOfferedTransformationService.install(harness.spreadsheet);
  const second = HandledOfferedTransformationService.install(harness.spreadsheet);

  assert.deepEqual(second, first);
  assert.equal(harness.sheets.get('_CALC_HANDLED').formulas.size, 4);
  assert.equal(harness.sheets.get('_CALC_OFFERED').formulas.size, 16);
  assert.equal(harness.sheets.get('_CALC_HANDLED').maxRows, 10001);
  assert.equal(harness.sheets.get('_CALC_OFFERED').maxRows, 10001);
});
