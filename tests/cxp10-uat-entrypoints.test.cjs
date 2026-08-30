const assert = require('node:assert/strict');
const test = require('node:test');

const Cxp10ParityUat = require('../src/main/Cxp10UatEntrypoints.js');
const ReportingSurfaceFormulaCatalog = require(
  '../src/transformations/ReportingSurfaceFormulaCatalog.js',
);
const parityFixture = require('./fixtures/cxp10/report-parity.json');

class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  clearContent() {
    for (let rowOffset = 0; rowOffset < this.rowCount; rowOffset += 1) {
      for (let colOffset = 0; colOffset < this.columnCount; colOffset += 1) {
        this.sheet.setCell(this.row + rowOffset, this.column + colOffset, '');
      }
    }
    return this;
  }

  getDisplayValues() {
    const values = [];
    for (let rowOffset = 0; rowOffset < this.rowCount; rowOffset += 1) {
      const rowValues = [];
      for (let colOffset = 0; colOffset < this.columnCount; colOffset += 1) {
        rowValues.push(this.sheet.getDisplayCell(
          this.row + rowOffset,
          this.column + colOffset,
        ));
      }
      values.push(rowValues);
    }
    return values;
  }

  getValues() {
    const values = [];
    for (let rowOffset = 0; rowOffset < this.rowCount; rowOffset += 1) {
      const rowValues = [];
      for (let colOffset = 0; colOffset < this.columnCount; colOffset += 1) {
        rowValues.push(this.sheet.getCell(this.row + rowOffset, this.column + colOffset));
      }
      values.push(rowValues);
    }
    return values;
  }

  setValues(values) {
    values.forEach((row, rowOffset) => {
      row.forEach((value, colOffset) => {
        this.sheet.setCell(this.row + rowOffset, this.column + colOffset, value);
      });
    });
    return this;
  }

  setValue(value) {
    this.sheet.setCell(this.row, this.column, value);
    return this;
  }

  getValue() {
    return this.sheet.getCell(this.row, this.column);
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.cells = new Map();
    this.displayCells = new Map();
  }

  cellKey(row, column) {
    return row + ':' + column;
  }

  getCell(row, column) {
    return this.cells.has(this.cellKey(row, column))
      ? this.cells.get(this.cellKey(row, column))
      : '';
  }

  setCell(row, column, value) {
    this.cells.set(this.cellKey(row, column), value);
  }

  setDisplayCell(row, column, value) {
    this.displayCells.set(this.cellKey(row, column), value);
  }

  getDisplayCell(row, column) {
    return this.displayCells.has(this.cellKey(row, column))
      ? this.displayCells.get(this.cellKey(row, column))
      : this.getCell(row, column);
  }

  getRange(row, column, rowCount, columnCount) {
    return new FakeRange(this, row, column, rowCount, columnCount);
  }
}

function buildIntervalViewRow(expectedRow) {
  const row = new Array(26).fill('');
  const epoch = Date.UTC(1899, 11, 30);
  const dateParts = String(expectedRow.Date).split('-').map(Number);
  const timeParts = String(expectedRow.Interval).split(':').map(Number);
  const daySerial = (Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]) - epoch) / 86400000;
  row[0] = daySerial + (timeParts[0] * 60 + timeParts[1]) / 1440;
  ReportingSurfaceFormulaCatalog.METRIC_HEADERS.forEach((header, index) => {
    row[1 + index] = expectedRow[header];
  });
  return row;
}

test('CXP-10 parity fixture is embedded in hosted UAT module', () => {
  assert.deepEqual(
    Cxp10ParityUat.FIXTURE.expected.intervalView,
    parityFixture.expected.intervalView,
  );
  assert.equal(Cxp10ParityUat.FIXTURE.businessDay, parityFixture.businessDay);
});

test('Interval View axis matches the control 04:00-22:30 contract without helpers', () => {
  const spec = ReportingSurfaceFormulaCatalog.intervalViewSpec();
  const pstFormula = spec.axisFormulas.find((entry) => entry.anchorColumn === 3).formula;
  assert.match(pstFormula, /SEQUENCE\(38/);
  assert.match(pstFormula, /TIME\(4,0,0\)/);
  assert.equal(spec.axisFormulas.length, 1);
  assert.equal(spec.businessDayAnchor.column, 27);
  assert.equal(spec.headerRow, 112);
  assert.equal(spec.firstDataRow, 113);
  assert.equal(spec.totalRow, 151);
});

test('recordParityOutputs passes when Interval View rows match on-axis fixture grains', () => {
  const catalog = ReportingSurfaceFormulaCatalog;
  const intervalSheet = new FakeSheet('Interval View');
  const onAxisExpected = parityFixture.expected.intervalView.filter(
    (row) => row.Date === parityFixture.businessDay,
  );
  assert.ok(onAxisExpected.length >= 1);
  for (let slot = 0; slot < catalog.INTERVAL_COUNT; slot += 1) {
    intervalSheet.setCell(
      catalog.FIRST_DATA_ROW + slot,
      3,
      (catalog.AXIS_START_HOUR * 60 + slot * 30) / 1440,
    );
  }
  onAxisExpected.forEach((expectedRow) => {
    const [hours, minutes] = String(expectedRow.Interval).split(':').map(Number);
    const slot = (hours * 60 + minutes - catalog.AXIS_START_HOUR * 60) / 30;
    const targetRow = catalog.FIRST_DATA_ROW + slot;
    const values = buildIntervalViewRow(expectedRow);
    values.forEach((value, columnIndex) => {
      intervalSheet.setCell(targetRow, columnIndex + 3, value);
    });
    if (typeof expectedRow['Required Hours'] === 'number') {
      const metricIndex = ReportingSurfaceFormulaCatalog.METRIC_HEADERS.indexOf(
        'Required Hours',
      );
      const targetColumn = 4 + metricIndex;
      intervalSheet.setCell(targetRow, targetColumn, new Date(1899, 11, 30, 2, 30, 0));
      intervalSheet.setDisplayCell(targetRow, targetColumn, '2:30:00');
    }
  });

  const originalOpen = global.SpreadsheetApp;
  global.SpreadsheetApp = {
    flush() {},
    openById() {
      return {
        getSheetByName(name) {
          if (name === 'Interval View') {
            return intervalSheet;
          }
          throw new Error('Unexpected sheet: ' + name);
        },
      };
    },
  };
  global.Config = {
    load() {
      return { targetSpreadsheetId: 'target-id' };
    },
  };
  global.ReportingSurfaceFormulaCatalog = ReportingSurfaceFormulaCatalog;
  global.ReportingSurfaceReferenceModel = {
    METRIC_ORDER: ReportingSurfaceFormulaCatalog.METRIC_HEADERS.slice(),
  };

  try {
    const report = Cxp10ParityUat.recordParityOutputs('target-id');
    assert.equal(report.pass, true);
    assert.equal(report.diffCount, 0);
    assert.equal(report.expectedOnAxisCount, onAxisExpected.length);
  } finally {
    global.SpreadsheetApp = originalOpen;
    delete global.Config;
    delete global.ReportingSurfaceFormulaCatalog;
    delete global.ReportingSurfaceReferenceModel;
  }
});

test('weeklyRollover advances Interval View and MOM anchors by seven days', () => {
  const intervalSheet = new FakeSheet('Interval View');
  const momSheet = new FakeSheet('MOM');
  const staffSheet = new FakeSheet('_CALC_STAFF');
  const epoch = Date.UTC(1899, 11, 30);
  const businessSerial = (Date.UTC(2026, 7, 18) - epoch) / 86400000;
  const weekSerial = (Date.UTC(2026, 7, 17) - epoch) / 86400000;
  intervalSheet.setCell(2, 27, businessSerial);
  momSheet.setCell(3, 2, weekSerial);
  staffSheet.setCell(1, 57, businessSerial);

  const originalOpen = global.SpreadsheetApp;
  global.SpreadsheetApp = {
    flush() {},
    openById() {
      return {
        getSheetByName(name) {
          if (name === 'Interval View') {
            return intervalSheet;
          }
          if (name === 'MOM') {
            return momSheet;
          }
          if (name === '_CALC_STAFF') {
            return staffSheet;
          }
          throw new Error('Unexpected sheet: ' + name);
        },
      };
    },
  };
  global.Config = {
    load() {
      return { targetSpreadsheetId: 'target-id' };
    },
  };
  global.ReportingSurfaceFormulaCatalog = ReportingSurfaceFormulaCatalog;

  try {
    const report = Cxp10ParityUat.weeklyRollover('target-id');
    assert.equal(report.intervalView.before, '2026-08-18');
    assert.equal(report.intervalView.after, '2026-08-25');
    assert.equal(report.mom.before, '2026-08-17');
    assert.equal(report.mom.after, '2026-08-24');
    assert.equal(momSheet.getCell(3, 2), (Date.UTC(2026, 7, 24) - epoch) / 86400000);
    assert.equal(staffSheet.getCell(1, 57), (Date.UTC(2026, 7, 25) - epoch) / 86400000);
    assert.equal(report.staff.before, '2026-08-18');
    assert.equal(report.staff.after, '2026-08-25');
  } finally {
    global.SpreadsheetApp = originalOpen;
    delete global.Config;
    delete global.ReportingSurfaceFormulaCatalog;
  }
});

test('setReportAnchors rejects a week start that is not the derived Monday', () => {
  const intervalSheet = new FakeSheet('Interval View');
  const momSheet = new FakeSheet('MOM');
  const staffSheet = new FakeSheet('_CALC_STAFF');
  const originalOpen = global.SpreadsheetApp;
  global.SpreadsheetApp = {
    openById() {
      return {
        getSheetByName(name) {
          return new Map([
            ['Interval View', intervalSheet],
            ['MOM', momSheet],
            ['_CALC_STAFF', staffSheet],
          ]).get(name) || null;
        },
      };
    },
  };
  global.Config = { load() { return { targetSpreadsheetId: 'target-id' }; } };

  try {
    assert.throws(
      () => Cxp10ParityUat.setReportAnchors(
        'target-id',
        '2026-08-18',
        '2026-08-18',
      ),
      (error) => error.code === 'BUSINESS_CONTEXT_INVALID',
    );
    assert.equal(intervalSheet.getCell(2, 27), '');
    assert.equal(momSheet.getCell(3, 2), '');
    assert.equal(staffSheet.getCell(1, 57), '');
  } finally {
    global.SpreadsheetApp = originalOpen;
    delete global.Config;
  }
});

test('promotion gate reports one root anchor error and skips parity', () => {
  const originalStatus = global.getCxp10ReportingSurfaceStatus;
  const originalDiagnose = global.diagnoseCxp10RunbookChecks;
  global.getCxp10ReportingSurfaceStatus = () => ({
    status: 'COMPLETE',
    nextStep: 139,
    stepCount: 139,
  });
  global.diagnoseCxp10RunbookChecks = () => ({
    rootError: {
      code: 'BUSINESS_CONTEXT_ANCHOR_INVALID',
      invalidAnchors: ['businessDay', 'weekStart'],
    },
    intervalView: { present: true, formulaErrorCount: null, formulaErrorScanSkipped: true },
    mom: { present: true },
    forecastBridge: { present: true },
  });

  try {
    const report = Cxp10ParityUat.promotionGate('target-id');
    assert.equal(report.promotionReady, false);
    assert.equal(report.parity.skipped, true);
    assert.equal(report.parity.reason, 'INVALID_BUSINESS_CONTEXT');
    assert.deepEqual(report.rootError.invalidAnchors, ['businessDay', 'weekStart']);
  } finally {
    global.getCxp10ReportingSurfaceStatus = originalStatus;
    global.diagnoseCxp10RunbookChecks = originalDiagnose;
  }
});

test('promotion gate bounds parity failure when valid context no longer matches fixture', () => {
  const originalStatus = global.getCxp10ReportingSurfaceStatus;
  const originalDiagnose = global.diagnoseCxp10RunbookChecks;
  global.getCxp10ReportingSurfaceStatus = () => ({
    status: 'COMPLETE',
    nextStep: 139,
    stepCount: 139,
  });
  global.diagnoseCxp10RunbookChecks = () => ({
    businessContext: {
      pass: true,
      context: {
        businessDay: '2026-08-25',
        weekStart: '2026-08-24',
        staffDay: '2026-08-25',
      },
    },
    intervalView: { present: true, formulaErrorCount: 0 },
    mom: { present: true },
    forecastBridge: { present: true },
  });

  try {
    const report = Cxp10ParityUat.promotionGate('target-id');
    assert.equal(report.promotionReady, false);
    assert.equal(report.parity.skipped, true);
    assert.equal(report.parity.reason, 'FIXTURE_CONTEXT_MISMATCH');
    assert.equal(report.parity.actualContext.businessDay, '2026-08-25');
    assert.equal(report.parity.expectedContext.businessDay, '2026-08-18');
  } finally {
    global.getCxp10ReportingSurfaceStatus = originalStatus;
    global.diagnoseCxp10RunbookChecks = originalDiagnose;
  }
});

test('writeMomCalendarInputs maps fixture rows onto Band-Aid calendar cells', () => {
  const momSheet = new FakeSheet('MOM');
  const originalOpen = global.SpreadsheetApp;
  global.SpreadsheetApp = {
    flush() {},
    openById() {
      return {
        getSheetByName(name) {
          if (name === 'MOM') {
            return momSheet;
          }
          throw new Error('Unexpected sheet: ' + name);
        },
      };
    },
  };
  global.Config = {
    load() {
      return { targetSpreadsheetId: 'target-id' };
    },
  };
  global.ReportingSurfaceFormulaCatalog = ReportingSurfaceFormulaCatalog;

  try {
    const result = Cxp10ParityUat.writeMomCalendarInputs(
      'target-id',
      Cxp10ParityUat.FIXTURE.forecastInputs,
      Cxp10ParityUat.FIXTURE.weekStart,
    );
    assert.equal(result.cells, 2);
    // PH Forecast 2026-08-17 23:30 → MNL volume block J (col 10), row 52
    assert.equal(momSheet.getCell(52, 10), 10);
    // LAS Required 2026-08-18 04:00 → LV required block, day+1, row 13
    assert.equal(momSheet.getCell(13, 27), 5);
  } finally {
    global.SpreadsheetApp = originalOpen;
    delete global.Config;
    delete global.ReportingSurfaceFormulaCatalog;
  }
});
