const SchemaRegistry = require('../../src/ingestion/SchemaRegistry.js');

function normalizedValue(column, rowNumber) {
  if (column.type === 'date_time') {
    return `2026-08-${String(20 + rowNumber).padStart(2, '0')}T04:00:00.000Z`;
  }
  if (column.type === 'date') {
    return `2026-08-${String(20 + rowNumber).padStart(2, '0')}`;
  }
  if (column.type === 'number') {
    return rowNumber;
  }
  return `${column.name}-${rowNumber}`;
}

function normalizedPayload(datasetName, rowCount = 1) {
  const schema = SchemaRegistry.getSchema(datasetName);
  const records = Array.from({ length: rowCount }, (_, rowIndex) =>
    Object.fromEntries(
      schema.columns.map((column) => [column.name, normalizedValue(column, rowIndex + 1)]),
    ),
  );
  return {
    contract: 'DatasetPayload',
    contractVersion: '1.0.0',
    datasetName,
    headers: schema.requiredHeaders.slice(),
    records,
    rowCount,
    runMetadata: { runId: 'run-cxp06', schemaVersion: '1.0.0' },
    schemaVersion: '1.0.0',
    source: { artifactId: `${datasetName}-source`, kind: 'single_dataset' },
  };
}

function allNormalizedPayloads(overrides = {}) {
  return SchemaRegistry.listSchemas().map(
    (schema) => overrides[schema.name] || normalizedPayload(schema.name),
  );
}

function matrixForPayload(payload) {
  return [payload.headers.slice()].concat(
    payload.records.map((record) =>
      payload.headers.map((header) => (record[header] === null ? '' : record[header])),
    ),
  );
}

class TransactionRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    Object.assign(this, { sheet, row, column, rowCount, columnCount });
  }

  clearContent() {
    this.sheet.events.push(['clearContent', this.sheet.name, this.rowCount, this.columnCount]);
    this.sheet.values = this.sheet.values.map((row) => row.map(() => ''));
    this.sheet.formulas = this.sheet.formulas.map((row) => row.map(() => ''));
    return this;
  }

  getFormulas() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.formulas[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] || '',
      ),
    );
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.values[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] ?? '',
      ),
    );
  }

  setValues(values) {
    if (
      values.length !== this.rowCount ||
      !values.every((row) => row.length === this.columnCount)
    ) {
      throw new Error('Fake setValues matrix does not match the requested range.');
    }
    this.sheet.events.push([
      'setValues',
      this.sheet.name,
      this.rowCount,
      this.columnCount,
    ]);
    values.forEach((rowValues, rowOffset) => {
      while (this.sheet.values.length < this.row + rowOffset) {
        this.sheet.values.push([]);
      }
      rowValues.forEach((value, columnOffset) => {
        this.sheet.values[this.row - 1 + rowOffset][this.column - 1 + columnOffset] = value;
      });
    });
    this.sheet.formulas = this.sheet.values.map((row) => row.map(() => ''));
    return this;
  }
}

class TransactionSheet {
  constructor(name, events, values = [['stale']]) {
    this.events = events;
    this.formulas = values.map((row) => row.map(() => ''));
    this.name = name;
    this.values = values.map((row) => row.slice());
  }

  getDataRange() {
    return new TransactionRange(
      this,
      1,
      1,
      Math.max(1, this.getLastRow()),
      Math.max(1, this.getLastColumn()),
    );
  }

  getLastColumn() {
    return this.values.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  }

  getLastRow() {
    return this.values.length;
  }

  getName() {
    return this.name;
  }

  getRange(row, column, rowCount, columnCount) {
    return new TransactionRange(this, row, column, rowCount, columnCount);
  }
}

class TransactionSpreadsheet {
  constructor(sheetNames) {
    this.events = [];
    this.sheets = new Map(
      sheetNames.map((name) => [name, new TransactionSheet(name, this.events)]),
    );
  }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }
}

function stagingSpreadsheet() {
  return new TransactionSpreadsheet([
    '_STG_HANDLED',
    '_STG_OFFERED',
    '_STG_AHT',
    '_STG_AUXES',
    '_STG_STAFF',
    '_RAW_HANDLED',
    '_RAW_OFFERED',
    '_RAW_AHT',
    '_RAW_AUXES',
    '_RAW_STAFF',
  ]);
}

function snapshotsForPayloads(payloads) {
  return payloads.map((payload) => {
    const values = matrixForPayload(payload);
    return {
      datasetName: payload.datasetName,
      formulas: values.map((row) => row.map(() => '')),
      sheetName: `stage-${payload.datasetName}`,
      values,
    };
  });
}

function cloneSnapshots(snapshots) {
  return snapshots.map((snapshot) => ({
    datasetName: snapshot.datasetName,
    formulas: snapshot.formulas.map((row) => row.slice()),
    sheetName: snapshot.sheetName,
    values: snapshot.values.map((row) => row.slice()),
  }));
}

module.exports = {
  TransactionSpreadsheet,
  allNormalizedPayloads,
  cloneSnapshots,
  normalizedPayload,
  snapshotsForPayloads,
  stagingSpreadsheet,
};
