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
    return this.getValues();
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

test('Interval View axis formulas emit SEQUENCE from AA2 midnight with lookup keys', () => {
  const spec = ReportingSurfaceFormulaCatalog.intervalViewSpec();
  const pstFormula = spec.axisFormulas.find((entry) => entry.anchorColumn === 1).formula;
  const dateKey = spec.axisFormulas.find((entry) => entry.anchorColumn === 28).formula;
  const timeKey = spec.axisFormulas.find((entry) => entry.anchorColumn === 29).formula;
  assert.match(pstFormula, /SEQUENCE\(38/);
  assert.match(pstFormula, /\$AA\$2\+TIME\(0,0,0\)/);
  assert.match(dateKey, /INT\(A17:A54\)/);
  assert.match(timeKey, /\*30\)\/1440/);
  assert.doesNotMatch(timeKey, /MOD\(/);
  assert.equal(spec.axisFormulas.length, 3);
  assert.equal(spec.businessDayAnchor.column, 27);
  assert.equal(spec.headerRow, 16);
});

test('recordParityOutputs passes when Interval View rows match on-axis fixture grains', () => {
  const catalog = ReportingSurfaceFormulaCatalog;
  const intervalSheet = new FakeSheet('Interval View');
  const onAxisExpected = parityFixture.expected.intervalView.filter(
    (row) => row.Date === parityFixture.businessDay,
  );
  assert.ok(onAxisExpected.length >= 1);
  onAxisExpected.forEach((expectedRow) => {
    const [hours, minutes] = String(expectedRow.Interval).split(':').map(Number);
    const slot = (hours * 60 + minutes - catalog.AXIS_START_HOUR * 60) / 30;
    const targetRow = catalog.FIRST_DATA_ROW + slot;
    const values = buildIntervalViewRow(expectedRow);
    values.forEach((value, columnIndex) => {
      intervalSheet.setCell(targetRow, columnIndex + 1, value);
    });
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
  const epoch = Date.UTC(1899, 11, 30);
  const businessSerial = (Date.UTC(2026, 7, 18) - epoch) / 86400000;
  const weekSerial = (Date.UTC(2026, 7, 17) - epoch) / 86400000;
  intervalSheet.setCell(2, 27, businessSerial);
  momSheet.setCell(3, 2, weekSerial);

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
  } finally {
    global.SpreadsheetApp = originalOpen;
    delete global.Config;
    delete global.ReportingSurfaceFormulaCatalog;
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
    // LAS Required 2026-08-18 00:00 → LV required block Z (col 26), day+1 → AA (col 27), row 5
    assert.equal(momSheet.getCell(5, 27), 5);
  } finally {
    global.SpreadsheetApp = originalOpen;
    delete global.Config;
    delete global.ReportingSurfaceFormulaCatalog;
  }
});
