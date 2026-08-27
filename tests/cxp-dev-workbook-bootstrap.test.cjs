const assert = require('node:assert/strict');
const test = require('node:test');

const DevWorkbookBootstrap = require('../src/main/DevWorkbookBootstrap.js');
const ErrorLogger = require('../src/monitoring/ErrorLogger.js');
const RunLogger = require('../src/monitoring/RunLogger.js');
const SchemaRegistry = require('../src/ingestion/SchemaRegistry.js');
const SheetNames = require('../src/config/SheetNames.js');

class FakeUser {
  constructor(email) {
    this.email = email;
  }

  getEmail() {
    return this.email;
  }
}

class FakeProtection {
  constructor(editors) {
    this.description = '';
    this.editors = editors.slice();
    this.warningOnly = true;
    this.domainEdit = true;
    this.targetAudiences = [];
    this.unprotectedRanges = [];
  }

  getDescription() {
    return this.description;
  }

  setDescription(description) {
    this.description = description;
    return this;
  }

  setWarningOnly(warningOnly) {
    this.warningOnly = warningOnly;
    return this;
  }

  isWarningOnly() {
    return this.warningOnly;
  }

  addEditor(user) {
    this.editors.push(user);
    return this;
  }

  getEditors() {
    return this.editors.slice();
  }

  removeEditors() {
    return this;
  }

  canDomainEdit() {
    return this.domainEdit;
  }

  setDomainEdit(domainEdit) {
    this.domainEdit = domainEdit;
    return this;
  }

  getTargetAudiences() {
    return this.targetAudiences.slice();
  }

  removeTargetAudience() {
    return this;
  }

  getUnprotectedRanges() {
    return this.unprotectedRanges.slice();
  }

  setUnprotectedRanges(ranges) {
    this.unprotectedRanges = ranges.slice();
    return this;
  }
}

class FakeSheet {
  constructor(name, editors) {
    this.name = name;
    this.editors = editors;
    this.protections = [];
    this.values = [];
  }

  getName() {
    return this.name;
  }

  getProtections() {
    return this.protections.slice();
  }

  protect() {
    const protection = new FakeProtection(this.editors);
    this.protections.push(protection);
    return protection;
  }

  getRange(row, _column, rowCount = 1) {
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

  getLastRow() {
    return this.values.length;
  }
}

class FakeSpreadsheet {
  constructor(id, name, editors) {
    this.id = id;
    this.name = name;
    this.editors = editors;
    this.sheets = new Map([['Sheet1', new FakeSheet('Sheet1', editors)]]);
  }

  getId() {
    return this.id;
  }

  getName() {
    return this.name;
  }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }

  getSheets() {
    return Array.from(this.sheets.values());
  }

  insertSheet(name) {
    const sheet = new FakeSheet(name, this.editors);
    this.sheets.set(name, sheet);
    return sheet;
  }

  deleteSheet(sheet) {
    this.sheets.delete(sheet.name);
  }

  setSpreadsheetTimeZone() {}
}

function createPropertyStore(initialValues) {
  const values = new Map(Object.entries(initialValues || {}));
  return {
    getProperty(name) {
      return values.has(name) ? values.get(name) : null;
    },
    setProperty(name, value) {
      values.set(name, String(value));
      return this;
    },
  };
}

function createServices() {
  const editors = [new FakeUser('dev@example.com')];
  const created = [];
  const files = new Map();
  const folderFilesByName = new Map();
  const folder = {
    getId() {
      return 'folder-1';
    },
    getFilesByName(name) {
      const matches = folderFilesByName.get(name) || [];
      let index = 0;
      return {
        hasNext() {
          return index < matches.length;
        },
        next() {
          return matches[index++];
        },
      };
    },
  };
  return {
    created,
    driveApp: {
      getFolderById(id) {
        assert.equal(id, 'folder-1');
        return folder;
      },
      getFileById(id) {
        return files.get(id);
      },
    },
    session: {
      getEffectiveUser() {
        return editors[0];
      },
    },
    spreadsheetApp: {
      ProtectionType: { SHEET: 'SHEET' },
      create(name) {
        const id = `sheet-${created.length + 1}`;
        const spreadsheet = new FakeSpreadsheet(id, name, editors);
        created.push(spreadsheet);
        files.set(id, {
          getId() {
            return id;
          },
          moveTo(targetFolder) {
            assert.equal(targetFolder.getId(), 'folder-1');
            if (!folderFilesByName.has(name)) {
              folderFilesByName.set(name, []);
            }
            folderFilesByName.get(name).push({ getId: () => id });
          },
        });
        return spreadsheet;
      },
      openById(id) {
        const match = created.find((item) => item.id === id);
        if (!match) {
          throw new Error('missing spreadsheet ' + id);
        }
        return match;
      },
    },
  };
}

test('DEV bootstrap creates workbooks, stores IDs, initializes sheets, and seeds raw headers', () => {
  const properties = createPropertyStore({});
  const services = createServices();

  const result = DevWorkbookBootstrap.bootstrap(
    'folder-1',
    {},
    properties,
    services,
  );

  assert.equal(result.environment, 'DEV');
  assert.equal(result.targetSpreadsheetId, 'sheet-1');
  assert.equal(result.controlSpreadsheetId, 'sheet-2');
  assert.equal(properties.getProperty('CXP_ENV'), 'DEV');
  assert.equal(properties.getProperty('CXP_DEV_TARGET_SPREADSHEET_ID'), 'sheet-1');
  assert.equal(properties.getProperty('CXP_DEV_CONTROL_SPREADSHEET_ID'), 'sheet-2');
  assert.equal(properties.getProperty('CXP_DEV_BOOTSTRAP_FOLDER_ID'), 'folder-1');
  assert.equal(result.seededRawSheets.length, 5);
  assert.equal(result.seededControlSheets.length, 7);
  assert.ok(services.created[0].getSheetByName('_RAW_AHT'));
  assert.ok(services.created[0].getSheetByName('_CALC_STAFF'));
  assert.ok(services.created[1].getSheetByName('RUN_LOG'));
  assert.deepEqual(
    services.created[0].getSheetByName('_RAW_AHT').values[0],
    SchemaRegistry.getSchema('AHT - Raw').requiredHeaders,
  );
  assert.deepEqual(
    services.created[1].getSheetByName('RUN_LOG').values[0],
    RunLogger.HEADERS,
  );
  assert.deepEqual(
    services.created[1].getSheetByName('ERROR_LOG').values[0],
    ErrorLogger.HEADERS,
  );
  assert.equal(
    services.created[1].getSheetByName('SCHEMA_REGISTRY').values.length,
    SchemaRegistry.listSchemas().length + 1,
  );
  assert.equal(services.created[0].getName(), DevWorkbookBootstrap.TARGET_WORKBOOK_NAME);
  assert.equal(services.created[1].getName(), DevWorkbookBootstrap.CONTROL_WORKBOOK_NAME);
  for (const required of SheetNames.TARGET.raw) {
    assert.ok(services.created[0].getSheetByName(required));
  }
});

test('DEV bootstrap refuses existing IDs without forceReplace', () => {
  const properties = createPropertyStore({
    CXP_DEV_TARGET_SPREADSHEET_ID: 'existing',
  });
  assert.throws(
    () => DevWorkbookBootstrap.bootstrap('folder-1', {}, properties, createServices()),
    /already set/,
  );
});

test('DEV bootstrap refuses PROD environment', () => {
  const properties = createPropertyStore({ CXP_ENV: 'PROD' });
  assert.throws(
    () => DevWorkbookBootstrap.bootstrap('folder-1', {}, properties, createServices()),
    /refuses CXP_ENV=PROD/,
  );
});

test('DEV bootstrap reads folder id from Script Property when argument omitted', () => {
  const properties = createPropertyStore({
    CXP_DEV_BOOTSTRAP_FOLDER_ID: 'folder-1',
  });
  const services = createServices();
  const result = DevWorkbookBootstrap.bootstrap(
    null,
    { forceReplace: false },
    properties,
    services,
  );
  assert.equal(result.folderId, 'folder-1');
  assert.equal(result.targetSpreadsheetId, 'sheet-1');
});

test('registerCxpDevWorkbookIds writes Script Properties from IDs or URLs', () => {
  const properties = createPropertyStore({});
  const services = createServices();
  const created = DevWorkbookBootstrap.bootstrap('folder-1', {}, properties, services);

  const targetUrl =
    'https://docs.google.com/spreadsheets/d/' +
    created.targetSpreadsheetId +
    '/edit#gid=0';

  const result = DevWorkbookBootstrap.registerWorkbookIds(
    targetUrl,
    created.controlSpreadsheetId,
    {},
    properties,
    services,
  );

  assert.equal(result.targetSpreadsheetId, created.targetSpreadsheetId);
  assert.equal(result.controlSpreadsheetId, created.controlSpreadsheetId);
  assert.equal(properties.getProperty('CXP_ENV'), 'DEV');
  assert.equal(
    properties.getProperty('CXP_DEV_TARGET_SPREADSHEET_ID'),
    created.targetSpreadsheetId,
  );
  assert.equal(
    properties.getProperty('CXP_DEV_CONTROL_SPREADSHEET_ID'),
    created.controlSpreadsheetId,
  );
});

test('registerCxpDevWorkbookIds can initialize and seed existing workbooks', () => {
  const properties = createPropertyStore({});
  const services = createServices();
  const target = services.spreadsheetApp.create('bare-target');
  const control = services.spreadsheetApp.create('bare-control');

  const result = DevWorkbookBootstrap.registerWorkbookIds(
    target.getId(),
    control.getId(),
    { initializeAndSeed: true },
    properties,
    services,
  );

  assert.equal(result.seededRawSheets.length, 5);
  assert.equal(result.seededControlSheets.length, 7);
});

test('registerWorkbooksFromFolder discovers bootstrap workbooks and sets Script Properties', () => {
  const properties = createPropertyStore({
    CXP_DEV_BOOTSTRAP_FOLDER_ID: 'folder-1',
  });
  const services = createServices();
  DevWorkbookBootstrap.bootstrap('folder-1', { forceReplace: true }, properties, services);

  properties.setProperty('CXP_DEV_TARGET_SPREADSHEET_ID', '');
  properties.setProperty('CXP_DEV_CONTROL_SPREADSHEET_ID', '');

  const result = DevWorkbookBootstrap.registerWorkbooksFromFolder(
    null,
    { initializeAndSeed: true },
    properties,
    services,
  );

  assert.equal(result.targetSpreadsheetId, 'sheet-1');
  assert.equal(result.controlSpreadsheetId, 'sheet-2');
  assert.equal(properties.getProperty('CXP_DEV_TARGET_SPREADSHEET_ID'), 'sheet-1');
  assert.equal(properties.getProperty('CXP_DEV_CONTROL_SPREADSHEET_ID'), 'sheet-2');
  assert.equal(properties.getProperty('CXP_DEV_BOOTSTRAP_FOLDER_ID'), 'folder-1');
});
