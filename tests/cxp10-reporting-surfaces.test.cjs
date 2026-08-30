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
const controlContract = require('./fixtures/cxp10/interval-view-control-contract.json');

class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  getDisplayValue() {
    return this.getValue();
  }

  getDisplayValues() {
    return this.getValues();
  }

  getFormula() {
    return this.sheet.formulas.get(`${this.row}:${this.column}`) || '';
  }

  getValue() {
    return this.sheet.values.get(`${this.row}:${this.column}`) ?? '';
  }

  getValues() {
    const values = [];
    for (let rowOffset = 0; rowOffset < this.rowCount; rowOffset += 1) {
      const rowValues = [];
      for (let colOffset = 0; colOffset < this.columnCount; colOffset += 1) {
        const key = `${this.row + rowOffset}:${this.column + colOffset}`;
        if (this.row + rowOffset === 1 && this.sheet.headers.length > 0) {
          rowValues.push(this.sheet.headers[this.column + colOffset - 1] ?? '');
        } else {
          rowValues.push(this.sheet.values.get(key) ?? '');
        }
      }
      values.push(rowValues);
    }
    return values;
  }

  setFormula(formula) {
    this.sheet.formulas.set(`${this.row}:${this.column}`, formula);
    this.sheet.formulaWriteCount += 1;
    return this;
  }

  clearContent() {
    for (let rowOffset = 0; rowOffset < this.rowCount; rowOffset += 1) {
      for (let colOffset = 0; colOffset < this.columnCount; colOffset += 1) {
        const key = `${this.row + rowOffset}:${this.column + colOffset}`;
        this.sheet.values.delete(key);
        this.sheet.formulas.delete(key);
      }
    }
    return this;
  }

  setValue(value) {
    this.sheet.values.set(`${this.row}:${this.column}`, value);
    this.sheet.valueWriteCount += 1;
    if (this.row === 1 && this.column === 1) {
      this.sheet.headers[0] = value;
    }
    return this;
  }

  setValues(values) {
    values.forEach((row, rowOffset) => {
      row.forEach((value, colOffset) => {
        const absoluteRow = this.row + rowOffset;
        const absoluteColumn = this.column + colOffset;
        this.sheet.values.set(`${absoluteRow}:${absoluteColumn}`, value);
        if (absoluteRow === 1) {
          this.sheet.headers[absoluteColumn - 1] = value;
        }
        if (
          absoluteRow === ReportingSurfaceFormulaCatalog.HEADER_ROW &&
          absoluteColumn === 4
        ) {
          this.sheet.metricHeaders = row.slice();
        }
      });
    });
    this.sheet.valueWriteCount += 1;
    return this;
  }
}

class FakeSheet {
  constructor(name, headers = [], maxRows = 200, maxColumns = 60) {
    this.name = name;
    this.headers = headers.slice();
    this.metricHeaders = [];
    this.maxRows = maxRows;
    this.maxColumns = maxColumns;
    this.formulaWriteCount = 0;
    this.valueWriteCount = 0;
    this.formulas = new Map();
    this.values = new Map();
    this.lastRow = 2;
  }

  clear() {
    this.formulas.clear();
    this.values.clear();
    this.headers = [];
    this.metricHeaders = [];
    return this;
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

test('CXP-10 Interval View contract is independently pinned to the control workbook', () => {
  const spec = ReportingSurfaceFormulaCatalog.intervalViewSpec();
  const presentation = ReportingSurfaceTransformationService.getIntervalPresentationContract();
  const formats = Object.fromEntries(
    presentation.numberFormats.map((entry) => [entry.range, entry.pattern]),
  );

  assert.equal(controlContract.sourceSha256, spec.metricLineage.sourceSha256);
  assert.equal(spec.reportSheetName, controlContract.sheet);
  assert.equal(spec.headerRow, 112);
  assert.equal(spec.firstDataRow, controlContract.axis.firstRow);
  assert.equal(spec.lastDataRow, controlContract.axis.lastRow);
  assert.equal(spec.totalRow, 151);
  assert.equal(spec.headers.length, controlContract.headers.metricCount);
  assert.match(spec.axisFormulas[0].formula, /SEQUENCE\(38/);
  assert.match(spec.axisFormulas[0].formula, /TIME\(4,0,0\)/);
  assert.deepEqual(presentation.merges, controlContract.requiredMerges);
  assert.deepEqual(presentation.hiddenColumns, controlContract.hiddenColumns);
  Object.entries(controlContract.numberFormats).forEach(([range, pattern]) => {
    assert.equal(formats[range], pattern);
  });
  assert.equal(spec.totalFormulas.length, controlContract.headers.metricCount);
});

test('CXP-10 installs Interval View, MOM, and forecast bridge formulas', () => {
  const harness = createFormulaHarness();
  harness.sheets.get('Interval View').values.set('2:27', 46252);
  harness.sheets.get('Interval View').values.set('16:1', 'v1 PST');
  harness.sheets.get('Interval View').values.set('97:4', 0.1768);
  harness.sheets.get('MOM').values.set('5:2', 99);
  const result = ReportingSurfaceTransformationService.install(harness.spreadsheet);

  assert.equal(result.metricCount, 25);
  assert.equal(result.reportSheetCount, 2);
  assert.ok(result.formulaAnchorCount >= 40);

  const intervalView = harness.sheets.get('Interval View');
  const mom = harness.sheets.get('MOM');
  const forecast = harness.sheets.get('_AGG_FORECAST');
  assert.match(intervalView.formulas.get('113:5'), /SUMPRODUCT/);
  assert.match(intervalView.formulas.get('113:5'), /_AGG_INTERVAL/);
  assert.match(intervalView.formulas.get('113:5'), /ROUND\([^)]*\*1440\)/);
  assert.match(intervalView.formulas.get('113:4'), /_AGG_FORECAST/);
  assert.match(intervalView.formulas.get('113:3'), /SEQUENCE\(38/);
  assert.match(intervalView.formulas.get('113:3'), /TIME\(4,0,0\)/);
  assert.match(intervalView.formulas.get('113:5'), /MAP\(/);
  assert.match(intervalView.formulas.get('113:10'), /SUMPRODUCT/);
  assert.match(intervalView.formulas.get('113:10'), /\$M\$2:\$M\$51/);
  assert.match(intervalView.formulas.get('113:7'), /SUMPRODUCT/);
  assert.match(intervalView.formulas.get('113:7'), /=0,"",SUMPRODUCT/);
  assert.doesNotMatch(intervalView.formulas.get('113:10'), /\)=0,""/);
  assert.match(intervalView.formulas.get('113:13'), /_AGG_ALLOCATION/);
  assert.match(intervalView.formulas.get('113:13'), /ROUND\([^)]*\*1440\)/);
  assert.match(intervalView.formulas.get('113:13'), /="INT"/);
  assert.match(intervalView.formulas.get('113:15'), /\$N\$2:\$N\$51/);
  assert.match(intervalView.formulas.get('113:16'), /\$O\$2:\$O\$51/);
  assert.doesNotMatch(intervalView.formulas.get('113:11'), /OR\([^)]*113:150/);
  assert.equal(intervalView.formulas.has('113:29'), false);
  assert.equal(intervalView.values.get('112:2'), 'Remarks');
  assert.equal(intervalView.values.get('112:3'), 'PST');
  assert.equal(intervalView.values.get('111:3'), 'Operational Metrics');
  assert.equal(intervalView.values.get('111:20'), 'Staffing');
  assert.equal(intervalView.values.get('1:27'), 'View Date');
  assert.equal(intervalView.formulas.get('2:3'), '=$AA$2');
  assert.equal(intervalView.values.get('2:27'), 46252);
  assert.equal(intervalView.values.has('16:1'), false);
  assert.equal(intervalView.values.get('97:4'), 0.1768);
  assert.equal(intervalView.formulas.get('97:5'), '=IF(D97="","",D97-0.05)');
  assert.equal(
    ReportingSurfaceFormulaCatalog.intervalViewSpec().totalFormulas.length,
    25,
  );
  assert.match(forecast.formulas.get('2:1'), /LET\(/);
  assert.match(forecast.formulas.get('2:1'), /MOM!\$A\$5:\$A\$52/);
  assert.match(forecast.formulas.get('2:1'), /IFNA\(FILTER/);
  assert.equal(mom.values.get('1:1'), 'CHAT MNL');
  assert.equal(mom.values.get('1:25'), 'CHAT LV');
  assert.equal(mom.values.get('2:1'), 'Required FTE at Plan');
  assert.equal(mom.values.get('5:2'), 99);
  assert.match(mom.formulas.get('5:1'), /SEQUENCE\(48,1,0,TIME\(0,30,0\)\)/);
  assert.equal(mom.formulas.get('3:3'), '=B3+1');
  assert.equal(mom.formulas.get('3:10'), '=$B$3');
  assert.equal(mom.formulas.get('4:2'), '=TEXT(B3,"ddd")');
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
  assert.equal(labels[1], 'Interval View:CHROME');
  assert.equal(labels[2], 'Interval View:HEADERS');
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
