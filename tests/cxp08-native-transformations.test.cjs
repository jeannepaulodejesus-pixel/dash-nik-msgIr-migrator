const assert = require('node:assert/strict');
const test = require('node:test');

const AhtAuxesStaffReferenceModel = require(
  '../src/transformations/AhtAuxesStaffReferenceModel.js'
);
const AhtAuxesStaffFormulaCatalog = require(
  '../src/transformations/AhtAuxesStaffFormulaCatalog.js'
);
const AhtAuxesStaffTransformationService = require(
  '../src/services/AhtAuxesStaffTransformationService.js'
);
const Cxp08Setup = require('../src/main/Cxp08Setup.js');
const SchemaRegistry = require('../src/ingestion/SchemaRegistry.js');
const parityFixture = require('./fixtures/cxp08/aht-auxes-staff-parity.json');

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
    if (this.row === 1 && this.rowCount === 1 && this.column === 1) {
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
  const ahtHeaders = SchemaRegistry.getSchema('AHT - Raw').requiredHeaders;
  const auxesHeaders = SchemaRegistry.getSchema('Auxes - Raw').requiredHeaders;
  const staffHeaders = SchemaRegistry.getSchema('Staff').requiredHeaders;
  const sheets = new Map([
    ['_RAW_AHT', new FakeSheet('_RAW_AHT', ahtHeaders)],
    ['_RAW_AUXES', new FakeSheet('_RAW_AUXES', auxesHeaders)],
    ['_RAW_STAFF', new FakeSheet('_RAW_STAFF', staffHeaders)],
    ['_CALC_AHT', new FakeSheet('_CALC_AHT', [])],
    ['_CALC_AUXES', new FakeSheet('_CALC_AUXES', [])],
    ['_CALC_STAFF', new FakeSheet('_CALC_STAFF', [])],
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

test('CXP-08 reference model reproduces the Excel-control fixture after fixed-PST bucketing', () => {
  const actual = AhtAuxesStaffReferenceModel.transform({
    ...parityFixture.inputs,
    businessDay: parityFixture.businessDay,
  });

  assert.deepEqual(actual, parityFixture.expected);
});

test('CXP-08 installs bounded native spill formulas with constant write shape', () => {
  const harness = createFormulaHarness();

  const result = AhtAuxesStaffTransformationService.install(harness.spreadsheet);

  assert.equal(result.datasetCount, 3);
  assert.deepEqual(result.rowCapacity, {
    aht: 15000,
    auxes: 7500,
    staff: 2000,
  });
  assert.equal(result.formulaAnchorCount, 7 + 1 + 4 + 1 + 48 + 1 + 96);

  const aht = harness.sheets.get('_CALC_AHT');
  const auxes = harness.sheets.get('_CALC_AUXES');
  const staff = harness.sheets.get('_CALC_STAFF');
  assert.equal(aht.maxRows, 15001);
  assert.equal(aht.maxColumns, 34);
  assert.equal(auxes.maxRows, 7501);
  assert.equal(auxes.maxColumns, 28);
  assert.equal(staff.maxRows, 2001);
  assert.equal(staff.maxColumns, 57);
  assert.deepEqual(aht.headers.slice(0, 7), [
    'Date',
    'Interval',
    'Count',
    'Service Level',
    'ASA Total',
    'CC',
    'Request Interval',
  ]);
  assert.deepEqual(auxes.headers.slice(0, 4), [
    'Date',
    'Interval',
    'Available Messaging in Hours',
    'Concluding in Hours',
  ]);
  assert.deepEqual(
    staff.headers.slice(0, 48),
    AhtAuxesStaffFormulaCatalog.halfHourHeaders(),
  );
  assert.match(aht.formulas.get('2:1'), /-8\/24/);
  assert.match(aht.formulas.get('2:6'), /QUERY\(/);
  assert.match(aht.formulas.get('2:8'), /_RAW_AHT'!A2:AA15001/);
  assert.match(auxes.formulas.get('2:5'), /_RAW_AUXES'!A2:X7501/);
  assert.match(staff.formulas.get('2:1'), /\$BE\$1/);
  assert.match(staff.formulas.get('2:49'), /_RAW_STAFF'!A2:E2001/);
  assert.match(staff.formulas.get('3:55'), /SUMIF\(/);
});

test('CXP-08 exposes the native installation as retry-safe bounded steps', () => {
  const harness = createFormulaHarness();
  const stepCount = AhtAuxesStaffTransformationService.getInstallStepCount();

  assert.equal(stepCount, 74);
  const labels = [];
  for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
    labels.push(
      AhtAuxesStaffTransformationService.installStep(
        harness.spreadsheet,
        stepIndex,
      ).label,
    );
  }

  assert.equal(labels[0], 'PREFLIGHT');
  assert.equal(labels.at(-1), 'Staff:SUMMARY_FORMULAS');
  assert.equal(harness.sheets.get('_CALC_AHT').formulas.size, 8);
  assert.equal(harness.sheets.get('_CALC_AUXES').formulas.size, 5);
  assert.equal(harness.sheets.get('_CALC_STAFF').formulas.size, 48 + 1 + 96);
});

test('CXP-08 configured setup opens only the target workbook and installs the native model', () => {
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

  const result = Cxp08Setup.initializeConfigured(properties, {
    spreadsheetApp: {
      openById(id) {
        openedIds.push(id);
        return harness.spreadsheet;
      },
    },
  });

  assert.deepEqual(openedIds, ['synthetic-target-id']);
  assert.equal(result.environment, 'DEV');
  assert.equal(result.transformations.datasetCount, 3);
});

test('CXP-08 hosted setup checkpoints before timeout and resumes without replaying steps', () => {
  const harness = createFormulaHarness();
  const properties = createPropertyStore({
    CXP_ENV: 'DEV',
    CXP_DEV_TARGET_SPREADSHEET_ID: 'synthetic-target-id',
  });
  const scriptApp = createTriggerService();
  const completedSteps = [];
  let nowMs = Date.parse('2026-08-27T00:00:00.000Z');
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

  const first = Cxp08Setup.initializeConfigured(properties, services);
  assert.equal(first.status, 'RUNNING');
  assert.equal(first.nextStep, 2);
  assert.equal(first.continuationScheduled, true);
  assert.deepEqual(completedSteps, [0, 1]);
  assert.equal(Cxp08Setup.STATE_KEY, 'CXP08_AHT_AUXES_STAFF_INSTALL_STATE');
  assert.equal(
    Cxp08Setup.CONTINUATION_HANDLER,
    'continueCxp08AhtAuxesStaffTransformations',
  );

  nowMs += 1000;
  const second = Cxp08Setup.continueConfigured(properties, services);
  assert.equal(second.status, 'COMPLETE');
  assert.equal(second.nextStep, 3);
  assert.deepEqual(completedSteps, [0, 1, 2]);
});

test('CXP-08 rejects schema drift before mutating calculation sheets', () => {
  const harness = createFormulaHarness();
  harness.sheets.get('_RAW_AHT').headers[0] = 'Unexpected Header';

  assert.throws(
    () => AhtAuxesStaffTransformationService.install(harness.spreadsheet),
    /_RAW_AHT headers do not match the active CXP-03 schema/,
  );
  assert.equal(harness.sheets.get('_CALC_AHT').clearCount, 0);
});

test('CXP-08 install is idempotent on reinstall', () => {
  const harness = createFormulaHarness();
  AhtAuxesStaffTransformationService.install(harness.spreadsheet);
  const firstFormulas = harness.sheets.get('_CALC_AHT').formulas.size;
  AhtAuxesStaffTransformationService.install(harness.spreadsheet);
  assert.equal(harness.sheets.get('_CALC_AHT').formulas.size, firstFormulas);
  assert.equal(harness.sheets.get('_CALC_AHT').clearCount, 2);
});
