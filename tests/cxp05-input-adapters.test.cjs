const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function loadModule(relativePath) {
  try {
    return require(relativePath);
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      return undefined;
    }
    throw error;
  }
}

const SchemaRegistry = require('../src/ingestion/SchemaRegistry.js');

function validValue(column, suffix) {
  if (column.type === 'date_time') {
    return '8/17/2026 4:00 AM';
  }
  if (column.type === 'date') {
    return '8/17/2026';
  }
  if (column.type === 'number') {
    return 1;
  }
  return column.name + '-' + suffix;
}

function tableFor(datasetName, suffix = 'one') {
  const schema = SchemaRegistry.getSchema(datasetName);
  return [
    schema.requiredHeaders.slice(),
    schema.columns.map((column) => validValue(column, suffix)),
  ];
}

function allDatasetTables() {
  return Object.fromEntries(
    SchemaRegistry.listSchemas().map((schema) => [schema.name, tableFor(schema.name)]),
  );
}

class FakeBlob {
  constructor(bytes, mimeType, events = []) {
    this.bytes = Buffer.from(bytes);
    this.events = events;
    this.mimeType = mimeType;
  }

  getBytes() {
    this.events.push(['getBytes']);
    return Array.from(this.bytes);
  }

  getContentType() {
    return this.mimeType;
  }

  getDataAsString(charset) {
    this.events.push(['getDataAsString', charset]);
    return this.bytes.toString('latin1');
  }
}

class FakeDriveFile {
  constructor({ bytes, id, mimeType, name, events = [] }) {
    this.blob = new FakeBlob(bytes, mimeType, events);
    this.id = id;
    this.mimeType = mimeType;
    this.name = name;
  }

  getBlob() {
    return this.blob;
  }

  getId() {
    return this.id;
  }

  getLastUpdated() {
    return new Date('2026-08-23T00:00:00.000Z');
  }

  getMimeType() {
    return this.mimeType;
  }

  getName() {
    return this.name;
  }

  getSize() {
    return this.blob.bytes.length;
  }
}

class FakeDriveApp {
  constructor(files) {
    this.files = new Map(files.map((file) => [file.getId(), file]));
  }

  getFileById(id) {
    const file = this.files.get(id);
    if (!file) {
      throw new Error('not found');
    }
    return file;
  }
}

function nodeUtilities() {
  return {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest(algorithm, value) {
      assert.equal(algorithm, 'SHA_256');
      const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
      return Array.from(crypto.createHash('sha256').update(bytes).digest());
    },
    getUuid() {
      return 'temp-uuid';
    },
  };
}

function runMetadata(runId = 'run-cxp05') {
  return { runId, schemaVersion: '1.0.0', sourceActor: 'synthetic-rta' };
}

function fakeWorkbook(sheetTables, options = {}) {
  return {
    getSheets() {
      return Object.entries(sheetTables).map(([name, values]) => ({
        getDataRange() {
          return {
            getFormulas() {
              if (options.formulaSheet === name) {
                return values.map((row, rowIndex) =>
                  row.map((_, columnIndex) =>
                    rowIndex === 1 && columnIndex === 0 ? '=1+1' : '',
                  ),
                );
              }
              return values.map((row) => row.map(() => ''));
            },
            getValues() {
              if (options.failValues) {
                throw new Error('synthetic conversion read failure');
              }
              return values.map((row) => row.slice());
            },
          };
        },
        getName() {
          return name;
        },
      }));
    },
  };
}

function xlsxServices(sheetTables, options = {}) {
  const events = [];
  const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const sheetsMime = 'application/vnd.google-apps.spreadsheet';
  return {
    events,
    driveApi: {
      About: {
        get(parameters) {
          events.push(['about.get', parameters]);
          return { importFormats: { [xlsxMime]: [sheetsMime] } };
        },
      },
      Files: {
        create(metadata, blob, parameters) {
          events.push(['files.create', metadata, blob, parameters]);
          return { id: 'temporary-sheet-id' };
        },
        remove(fileId, parameters) {
          events.push(['files.remove', fileId, parameters]);
        },
      },
    },
    spreadsheetApp: {
      openById(fileId) {
        events.push(['spreadsheet.openById', fileId]);
        return fakeWorkbook(sheetTables, options);
      },
    },
    utilities: nodeUtilities(),
  };
}

class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    Object.assign(this, { sheet, row, column, rowCount, columnCount });
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.valueAt(this.row + rowOffset, this.column + columnOffset),
      ),
    );
  }

  setValues(values) {
    this.sheet.writeCalls.push({
      column: this.column,
      row: this.row,
      values: values.map((row) => row.slice()),
    });
    values.forEach((rowValues, rowOffset) => {
      rowValues.forEach((value, columnOffset) => {
        this.sheet.setValueAt(this.row + rowOffset, this.column + columnOffset, value);
      });
    });
  }
}

class FakeLedgerSheet {
  constructor(rows = []) {
    this.rows = rows.map((row) => row.slice());
    this.writeCalls = [];
  }

  getLastRow() {
    return this.rows.length;
  }

  getRange(row, column, rowCount, columnCount) {
    return new FakeRange(this, row, column, rowCount, columnCount);
  }

  setValueAt(row, column, value) {
    while (this.rows.length < row) {
      this.rows.push([]);
    }
    this.rows[row - 1][column - 1] = value;
  }

  valueAt(row, column) {
    return this.rows[row - 1]?.[column - 1] ?? '';
  }
}

class FakeControlSpreadsheet {
  constructor(ledgerSheet) {
    this.ledgerSheet = ledgerSheet;
  }

  getSheetByName(name) {
    return name === 'FILE_LEDGER' ? this.ledgerSheet : null;
  }
}

function descriptor(overrides = {}) {
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const blob = overrides.blob || new FakeBlob(Buffer.from('PK\x03\x04synthetic'), mimeType);
  return {
    blob,
    bytes: Object.freeze(blob.getBytes()),
    contentFingerprint: 'sha256:synthetic',
    fileId: 'xlsx-source-id',
    fileName: 'synthetic-source.xlsx',
    format: 'xlsx',
    lastUpdatedUtc: '2026-08-23T00:00:00.000Z',
    mimeType,
    sizeBytes: blob.bytes.length,
    ...overrides,
  };
}

// Defect caught: fingerprints include filename/file ID or hash converted content instead of source bytes.
test('DriveService hashes original content bytes and detects format by signature', () => {
  const DriveService = loadModule('../src/services/DriveService.js');
  assert.equal(typeof DriveService?.readFile, 'function');
  const bytes = Buffer.from('PK\x03\x04same workbook bytes');
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const driveApp = new FakeDriveApp([
    new FakeDriveFile({ bytes, id: 'file-a', mimeType, name: 'first.xlsx' }),
    new FakeDriveFile({ bytes, id: 'file-b', mimeType, name: 'renamed.xlsx' }),
    new FakeDriveFile({ bytes: Buffer.from('plain text'), id: 'bad', mimeType: 'text/plain', name: 'bad.txt' }),
  ]);
  const services = { driveApp, utilities: nodeUtilities() };

  const first = DriveService.readFile('file-a', services);
  const renamed = DriveService.readFile('file-b', services);

  assert.equal(first.format, 'xlsx');
  assert.equal(first.contentFingerprint, renamed.contentFingerprint);
  assert.match(first.contentFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(first.fileName, renamed.fileName);
  assert.throws(
    () => DriveService.readFile('bad', services),
    (error) => error.code === 'SOURCE_UNSUPPORTED_FORMAT',
  );
});

// Defect caught: observed HTML .xls files are treated as BIFF or duplicate rows/entities leak through.
test('DatasetAdapter parses the constrained ISO-8859-1 HTML table and collapses exact rows', () => {
  const DatasetAdapter = loadModule('../src/ingestion/DatasetAdapter.js');
  assert.equal(typeof DatasetAdapter?.parseHtmlTable, 'function');
  assert.equal(typeof DatasetAdapter?.fromTable, 'function');
  const events = [];
  const html = [
    '<head><META charset="ISO-8859-1"></head><table>',
    '<tr><th>Status Start Date</th><th>Status End Date</th><th>Athlete Display Name</th><th>Athlete Site</th><th>Athlete Profile</th></tr>',
    '<tr><td>8/17/2026 4:00 AM</td><td>8/17/2026 4:30 AM</td><td>Sample&nbsp;Athlete</td><td>Site A</td><td>RTA &amp; Ops</td></tr>',
    '<tr><td>8/17/2026 4:00 AM</td><td>8/17/2026 4:30 AM</td><td>Sample&nbsp;Athlete</td><td>Site A</td><td>RTA &amp; Ops</td></tr>',
    '</table>',
  ].join('');
  const source = {
    ...descriptor({
      blob: new FakeBlob(Buffer.from(html, 'latin1'), 'application/vnd.ms-excel', events),
      fileId: 'staff-html-id',
      fileName: 'renamed-staff.xls',
      format: 'html_table',
      mimeType: 'application/vnd.ms-excel',
    }),
    contentFingerprint: 'sha256:staff-html',
  };

  const table = DatasetAdapter.parseHtmlTable(source);
  const payload = DatasetAdapter.fromTable({
    datasetName: 'Staff',
    runMetadata: runMetadata(),
    source: {
      artifactId: source.fileId,
      bundleFingerprint: 'sha256:bundle',
      contentFingerprint: source.contentFingerprint,
      fileName: source.fileName,
      kind: 'single_dataset',
    },
    values: table.values,
  });

  assert.deepEqual(events.filter((event) => event[0] === 'getDataAsString'), [
    ['getDataAsString', 'ISO-8859-1'],
  ]);
  assert.equal(payload.rowCount, 1);
  assert.equal(payload.source.duplicateRowsCollapsed, 1);
  assert.equal(payload.records[0]['Athlete Display Name'], 'Sample\u00a0Athlete');
  assert.equal(payload.records[0]['Athlete Profile'], 'RTA & Ops');
  assert.equal(payload.records[0]['Status Start Date'], '2026-08-17T04:00:00.000Z');
});

// Defect caught: multiple tables or ragged rows are silently truncated into a plausible dataset.
test('DatasetAdapter rejects multiple-table and ragged HTML before normalization', () => {
  const DatasetAdapter = loadModule('../src/ingestion/DatasetAdapter.js');
  assert.equal(typeof DatasetAdapter?.parseHtmlTable, 'function');
  const makeSource = (html) => descriptor({
    blob: new FakeBlob(Buffer.from(html, 'latin1'), 'application/vnd.ms-excel'),
    format: 'html_table',
  });

  assert.throws(
    () => DatasetAdapter.parseHtmlTable(makeSource('<table><tr><td>A</td></tr></table><table><tr><td>B</td></tr></table>')),
    (error) => error.code === 'SOURCE_MULTIPLE_TABLES',
  );
  assert.throws(
    () => DatasetAdapter.parseHtmlTable(makeSource('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td></tr></table>')),
    (error) => error.code === 'SOURCE_RAGGED_ROWS',
  );
});

// Defect caught: divergent rows sharing an approved business key pass as two records.
test('DatasetAdapter rejects divergent rows with the same authoritative key', () => {
  const DatasetAdapter = loadModule('../src/ingestion/DatasetAdapter.js');
  assert.equal(typeof DatasetAdapter?.fromTable, 'function');
  const values = tableFor('Handled');
  const second = values[1].slice();
  second[values[0].indexOf('Status')] = 'different-status';
  values.push(second);

  assert.throws(
    () => DatasetAdapter.fromTable({
      datasetName: 'Handled',
      runMetadata: runMetadata(),
      source: { artifactId: 'handled-id', kind: 'single_dataset' },
      values,
    }),
    (error) => {
      assert.equal(error.code, 'SOURCE_DIVERGENT_DUPLICATE_KEY');
      assert.equal(error.details.keyField, 'Messaging Session Name');
      assert.equal(Object.hasOwn(error.details, 'rows'), false);
      return true;
    },
  );
});

// Defect caught: XLSX conversion reads formulas or leaves the temporary Sheet after success/failure.
test('XlsxAdapter extracts values only and permanently cleans temporary conversions', () => {
  const XlsxAdapter = loadModule('../src/ingestion/XlsxAdapter.js');
  assert.equal(typeof XlsxAdapter?.read, 'function');
  const source = descriptor();
  const successServices = xlsxServices({ Staff: tableFor('Staff') });

  const workbook = XlsxAdapter.read(source, successServices);

  assert.deepEqual(workbook.sheets[0], { name: 'Staff', values: tableFor('Staff') });
  assert.equal(successServices.events.filter((event) => event[0] === 'files.create').length, 1);
  assert.deepEqual(successServices.events.at(-1), [
    'files.remove',
    'temporary-sheet-id',
    { supportsAllDrives: true },
  ]);

  const failureServices = xlsxServices({ Staff: tableFor('Staff') }, { failValues: true });
  assert.throws(
    () => XlsxAdapter.read(source, failureServices),
    (error) => error.code === 'SOURCE_XLSX_CONVERSION_FAILED',
  );
  assert.equal(failureServices.events.at(-1)[0], 'files.remove');
});

// Defect caught: converted source formulas are accepted as ordinary raw values.
test('XlsxAdapter rejects source formulas without exposing formula text and still cleans up', () => {
  const XlsxAdapter = loadModule('../src/ingestion/XlsxAdapter.js');
  assert.equal(typeof XlsxAdapter?.read, 'function');
  const services = xlsxServices({ Staff: tableFor('Staff') }, { formulaSheet: 'Staff' });

  assert.throws(
    () => XlsxAdapter.read(descriptor(), services),
    (error) => {
      assert.equal(error.code, 'SOURCE_FORMULAS_NOT_ALLOWED');
      assert.deepEqual(error.details, { columnNumber: 1, rowNumber: 2, sheetName: 'Staff' });
      assert.equal(JSON.stringify(error).includes('=1+1'), false);
      return true;
    },
  );
  assert.equal(services.events.at(-1)[0], 'files.remove');
});

// Defect caught: the workbook adapter omits a registered dataset or emits non-DatasetPayload shapes.
test('WorkbookBundleAdapter emits one normalized payload for every mapped sheet', () => {
  const WorkbookBundleAdapter = loadModule('../src/ingestion/WorkbookBundleAdapter.js');
  assert.equal(typeof WorkbookBundleAdapter?.toPayloads, 'function');
  const source = descriptor();
  const workbook = {
    sheets: Object.entries(allDatasetTables()).map(([name, values]) => ({ name, values })),
  };

  const payloads = WorkbookBundleAdapter.toPayloads({
    bundleFingerprint: 'sha256:bundle',
    runMetadata: runMetadata(),
    source,
    workbook,
  });

  assert.deepEqual(payloads.map((payload) => payload.datasetName), [
    'Handled',
    'Offered',
    'AHT - Raw',
    'Auxes - Raw',
    'Staff',
  ]);
  assert.equal(payloads.every((payload) => payload.contract === 'DatasetPayload'), true);
  assert.equal(payloads.every((payload) => payload.source.kind === 'multi_sheet_workbook'), true);
  assert.throws(
    () => WorkbookBundleAdapter.toPayloads({
      bundleFingerprint: 'sha256:bundle',
      runMetadata: runMetadata(),
      source,
      workbook: { sheets: workbook.sheets.slice(0, 4) },
    }),
    (error) => error.code === 'SOURCE_INCOMPLETE_BUNDLE',
  );
});

// Defect caught: FILE_LEDGER lookup ignores a successful fingerprint or fails to correlate the original run.
test('DuplicateService blocks renamed duplicate content and records the original successful run', () => {
  const DriveService = loadModule('../src/services/DriveService.js');
  const DuplicateService = loadModule('../src/services/DuplicateService.js');
  const FileLedgerRepository = loadModule('../src/repository/FileLedgerRepository.js');
  assert.equal(typeof DriveService?.readFile, 'function');
  assert.equal(typeof DuplicateService?.check, 'function');
  assert.equal(typeof DuplicateService?.recordSuccessful, 'function');
  assert.equal(typeof FileLedgerRepository?.create, 'function');
  const bytes = Buffer.from('PK\x03\x04identical-source');
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const driveApp = new FakeDriveApp([
    new FakeDriveFile({ bytes, id: 'original-file', mimeType, name: 'original.xlsx' }),
    new FakeDriveFile({ bytes, id: 'renamed-file', mimeType, name: 'renamed.xlsx' }),
  ]);
  const first = DriveService.readFile('original-file', { driveApp, utilities: nodeUtilities() });
  const renamed = DriveService.readFile('renamed-file', { driveApp, utilities: nodeUtilities() });
  const sheet = new FakeLedgerSheet();
  const repository = FileLedgerRepository.create(new FakeControlSpreadsheet(sheet));

  DuplicateService.recordSuccessful({
    checkedAtUtc: '2026-08-23T00:00:00.000Z',
    datasetNames: ['Handled'],
    fingerprint: first.contentFingerprint,
    runId: 'run-original',
    schemaVersion: '1.0.0',
    sourceFiles: [first],
  }, repository);
  sheet.writeCalls = [];

  assert.throws(
    () => DuplicateService.check({
      checkedAtUtc: '2026-08-23T01:00:00.000Z',
      datasetNames: ['Handled'],
      fingerprint: renamed.contentFingerprint,
      runId: 'run-renamed',
      schemaVersion: '1.0.0',
      sourceFiles: [renamed],
    }, repository),
    (error) => {
      assert.equal(error.code, 'SOURCE_DUPLICATE_SUBMISSION');
      assert.equal(error.details.originalSuccessfulRunId, 'run-original');
      assert.equal(error.duplicateResult.originalSuccessfulRunId, 'run-original');
      return true;
    },
  );
  assert.equal(sheet.writeCalls.length, 1);
  assert.equal(sheet.rows.at(-1)[2], 'DUPLICATE');
  assert.equal(sheet.rows.at(-1)[4], 'run-original');
  assert.equal(JSON.stringify(sheet.rows).includes('identical-source'), false);
});

// Defect caught: the end-to-end XLSX path bypasses duplicate checking or returns blobs/formulas downstream.
test('InputAdapter normalizes a valid five-sheet XLSX bundle before staging', () => {
  const FileLedgerRepository = loadModule('../src/repository/FileLedgerRepository.js');
  const InputAdapter = loadModule('../src/ingestion/InputAdapter.js');
  assert.equal(typeof FileLedgerRepository?.create, 'function');
  assert.equal(typeof InputAdapter?.read, 'function');
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const file = new FakeDriveFile({
    bytes: Buffer.from('PK\x03\x04five-sheet-workbook'),
    id: 'bundle-file-id',
    mimeType,
    name: 'bundle.xlsx',
  });
  const conversion = xlsxServices(allDatasetTables());
  const ledgerSheet = new FakeLedgerSheet();
  const ledgerRepository = FileLedgerRepository.create(
    new FakeControlSpreadsheet(ledgerSheet),
  );
  const services = {
    ...conversion,
    clock: { now: () => new Date('2026-08-23T01:00:00.000Z') },
    driveApp: new FakeDriveApp([file]),
    ledgerRepository,
  };

  const result = InputAdapter.read({
    packagingKind: 'multi_sheet_workbook',
    runMetadata: runMetadata('run-bundle'),
    sources: [{ fileId: 'bundle-file-id' }],
  }, services);

  assert.equal(result.payloads.length, 5);
  assert.match(result.fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(result.sourceFiles, [{
    contentFingerprint: result.fingerprint,
    fileId: 'bundle-file-id',
    fileName: 'bundle.xlsx',
    format: 'xlsx',
    lastUpdatedUtc: '2026-08-23T00:00:00.000Z',
    mimeType,
    sizeBytes: Buffer.byteLength('PK\x03\x04five-sheet-workbook'),
  }]);
  assert.equal(JSON.stringify(result).includes('blob'), false);
  assert.equal(JSON.stringify(result).includes('bytes'), false);
  assert.equal(conversion.events.at(-1)[0], 'files.remove');
  assert.equal(ledgerSheet.rows.length, 1, 'successful content is recorded only after CXP-06 commit');
});


// Defect caught: CXP-05 forces CXP-04 to call one opaque routine and skips audited phase boundaries.
test('InputAdapter exposes CXP-04-compatible phases without crossing their side-effect boundaries', () => {
  const FileLedgerRepository = loadModule('../src/repository/FileLedgerRepository.js');
  const InputAdapter = loadModule('../src/ingestion/InputAdapter.js');
  assert.equal(typeof InputAdapter?.validateFile, 'function');
  assert.equal(typeof InputAdapter?.parse, 'function');
  assert.equal(typeof InputAdapter?.validateSchema, 'function');
  assert.equal(typeof InputAdapter?.checkDuplicate, 'function');
  assert.equal(typeof InputAdapter?.createOperations, 'function');

  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const file = new FakeDriveFile({
    bytes: Buffer.from('PK\x03\x04phase-workbook'),
    id: 'phase-file-id',
    mimeType,
    name: 'phase.xlsx',
  });
  const conversion = xlsxServices(allDatasetTables());
  const ledgerSheet = new FakeLedgerSheet();
  const services = {
    ...conversion,
    clock: { now: () => new Date('2026-08-23T01:00:00.000Z') },
    driveApp: new FakeDriveApp([file]),
    ledgerRepository: FileLedgerRepository.create(new FakeControlSpreadsheet(ledgerSheet)),
  };
  const request = {
    packagingKind: 'multi_sheet_workbook',
    runMetadata: runMetadata('run-phases'),
    sources: [{ fileId: 'phase-file-id' }],
  };

  const validated = InputAdapter.validateFile(request, services);
  assert.deepEqual(conversion.events, []);
  assert.deepEqual(ledgerSheet.rows, []);

  const parsed = InputAdapter.parse(validated, services);
  assert.equal(conversion.events.at(-1)[0], 'files.remove');
  assert.deepEqual(ledgerSheet.rows, []);

  const normalized = InputAdapter.validateSchema(parsed);
  assert.equal(normalized.payloads.length, 5);
  assert.deepEqual(ledgerSheet.rows, []);

  const result = InputAdapter.checkDuplicate(normalized, services);
  assert.equal(result.payloads.length, 5);
  assert.equal(ledgerSheet.rows.length, 1, 'duplicate lookup initializes only the controlled header');

  const operations = InputAdapter.createOperations({
    packagingKind: 'multi_sheet_workbook',
    sources: [{ fileId: 'phase-file-id' }],
  }, services);
  assert.deepEqual(Object.keys(operations), [
    'validateFile',
    'parse',
    'validateSchema',
    'checkDuplicate',
  ]);
});

// Defect caught: unsupported content reaches conversion, duplicate lookup, or staging-adjacent work.
test('InputAdapter rejects unsupported content before conversion and ledger lookup', () => {
  const InputAdapter = loadModule('../src/ingestion/InputAdapter.js');
  assert.equal(typeof InputAdapter?.read, 'function');
  const file = new FakeDriveFile({
    bytes: Buffer.from('not a supported workbook'),
    id: 'unsupported-file',
    mimeType: 'application/octet-stream',
    name: 'unsupported.bin',
  });
  const conversion = xlsxServices({});
  const ledgerEvents = [];
  const services = {
    ...conversion,
    clock: { now: () => new Date('2026-08-23T01:00:00.000Z') },
    driveApp: new FakeDriveApp([file]),
    ledgerRepository: {
      append() { ledgerEvents.push('append'); },
      findSuccessfulByFingerprint() { ledgerEvents.push('find'); return null; },
    },
  };

  assert.throws(
    () => InputAdapter.read({
      packagingKind: 'multi_sheet_workbook',
      runMetadata: runMetadata('run-unsupported'),
      sources: [{ fileId: 'unsupported-file' }],
    }, services),
    (error) => error.code === 'SOURCE_UNSUPPORTED_FORMAT',
  );
  assert.deepEqual(conversion.events, []);
  assert.deepEqual(ledgerEvents, []);
});

// Defect caught: deployed code references Drive.Files without enabling the v3 advanced service.
test('Apps Script manifest enables the Drive v3 advanced service', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'appsscript.json'), 'utf8'),
  );
  assert.deepEqual(manifest.dependencies.enabledAdvancedServices, [{
    serviceId: 'drive',
    userSymbol: 'Drive',
    version: 'v3',
  }]);
});
