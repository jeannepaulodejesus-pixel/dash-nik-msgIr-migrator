const assert = require('node:assert/strict');
const test = require('node:test');

const ControlWorkbookHeaders = require('../src/main/ControlWorkbookHeaders.js');
const ErrorLogger = require('../src/monitoring/ErrorLogger.js');
const FileLedgerRepository = require('../src/repository/FileLedgerRepository.js');
const RunLogger = require('../src/monitoring/RunLogger.js');
const SchemaRegistry = require('../src/ingestion/SchemaRegistry.js');
const SheetNames = require('../src/config/SheetNames.js');

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.values = [];
  }

  getName() {
    return this.name;
  }

  getLastRow() {
    return this.values.length;
  }

  getRange(row, _column, rowCount, _columnCount) {
    const sheet = this;
    return {
      setValues(matrix) {
        for (let index = 0; index < matrix.length; index += 1) {
          sheet.values[row - 1 + index] = matrix[index].slice();
        }
        return this;
      },
    };
  }
}

class FakeSpreadsheet {
  constructor(sheets) {
    this.sheets = new Map(sheets.map((sheet) => [sheet.getName(), sheet]));
  }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }
}

function createControlSpreadsheet() {
  return new FakeSpreadsheet(
    SheetNames.CONTROL.map((name) => new FakeSheet(name)),
  );
}

test('control header seed writes row 1 on all seven tabs and seeds SCHEMA_REGISTRY rows', () => {
  const spreadsheet = createControlSpreadsheet();
  const result = ControlWorkbookHeaders.seed(spreadsheet);

  assert.equal(result.seededControlSheets.length, 7);
  assert.deepEqual(
    spreadsheet.getSheetByName('RUN_LOG').values[0],
    RunLogger.HEADERS,
  );
  assert.deepEqual(
    spreadsheet.getSheetByName('ERROR_LOG').values[0],
    ErrorLogger.HEADERS,
  );
  assert.deepEqual(
    spreadsheet.getSheetByName('FILE_LEDGER').values[0],
    FileLedgerRepository.HEADERS,
  );
  assert.deepEqual(
    spreadsheet.getSheetByName('SCHEMA_REGISTRY').values[0],
    SchemaRegistry.REGISTRY_RECORD_HEADERS,
  );
  assert.equal(
    spreadsheet.getSheetByName('SCHEMA_REGISTRY').values.length,
    SchemaRegistry.listSchemas().length + 1,
  );
  assert.deepEqual(
    spreadsheet.getSheetByName('WEEK_REGISTRY').values[0],
    ControlWorkbookHeaders.PROVISIONAL_WEEK_REGISTRY_HEADERS,
  );
});

test('control header seed skips populated sheets unless overwrite is true', () => {
  const spreadsheet = createControlSpreadsheet();
  spreadsheet.getSheetByName('RUN_LOG').values[0] = ['existing'];

  const skipped = ControlWorkbookHeaders.seed(spreadsheet);
  assert.equal(skipped.seededControlSheets.length, 6);
  assert.deepEqual(spreadsheet.getSheetByName('RUN_LOG').values[0], ['existing']);

  const overwritten = ControlWorkbookHeaders.seed(spreadsheet, { overwrite: true });
  assert.equal(overwritten.seededControlSheets.length, 7);
  assert.deepEqual(
    spreadsheet.getSheetByName('RUN_LOG').values[0],
    RunLogger.HEADERS,
  );
});
