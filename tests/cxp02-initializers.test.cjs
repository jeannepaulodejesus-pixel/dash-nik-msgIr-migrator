const assert = require('node:assert/strict');
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
    this.warningOnly = true;
    this.domainEdit = true;
    this.editors = editors.slice();
    this.targetAudiences = ['audience-all-rta'];
    this.unprotectedRanges = ['A1:B2'];
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
    if (!this.editors.some((editor) => editor.getEmail() === user.getEmail())) {
      this.editors.push(user);
    }
    return this;
  }

  getEditors() {
    return this.editors.slice();
  }

  removeEditors(users) {
    const emails = new Set(users.map((user) => user.getEmail()));
    this.editors = this.editors.filter((editor) => !emails.has(editor.getEmail()));
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

  removeTargetAudience(audienceId) {
    this.targetAudiences = this.targetAudiences.filter(
      (candidate) => candidate !== audienceId,
    );
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
  constructor(name, defaultProtectionEditors) {
    this.name = name;
    this.defaultProtectionEditors = defaultProtectionEditors;
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
    if (this.protections.length > 0) {
      return this.protections[0];
    }
    const protection = new FakeProtection(this.defaultProtectionEditors);
    this.protections.push(protection);
    return protection;
  }
}

class FakeSpreadsheet {
  constructor(id, initialSheetNames, defaultProtectionEditors) {
    this.id = id;
    this.defaultProtectionEditors = defaultProtectionEditors;
    this.sheets = initialSheetNames.map(
      (name) => new FakeSheet(name, this.defaultProtectionEditors),
    );
    this.insertedSheetNames = [];
    this.timeZone = 'Etc/UTC';
  }

  getSheetByName(name) {
    return this.sheets.find((sheet) => sheet.getName() === name) || null;
  }

  getSheets() {
    return this.sheets.slice();
  }

  insertSheet(name) {
    const sheet = new FakeSheet(name, this.defaultProtectionEditors);
    this.sheets.push(sheet);
    this.insertedSheetNames.push(name);
    return sheet;
  }

  setSpreadsheetTimeZone(timeZone) {
    this.timeZone = timeZone;
  }

  getSpreadsheetTimeZone() {
    return this.timeZone;
  }
}

class FakeSpreadsheetApp {
  constructor(spreadsheets) {
    this.ProtectionType = Object.freeze({ SHEET: 'SHEET' });
    this.spreadsheets = new Map(spreadsheets.map((spreadsheet) => [spreadsheet.id, spreadsheet]));
    this.openedIds = [];
  }

  openById(id) {
    this.openedIds.push(id);
    const spreadsheet = this.spreadsheets.get(id);
    if (!spreadsheet) {
      throw new Error('Unknown fake spreadsheet: ' + id);
    }
    return spreadsheet;
  }
}

function propertyAdapter(values) {
  return {
    getProperty(name) {
      return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : null;
    },
  };
}

function buildHarness() {
  const owner = new FakeUser('owner@example.test');
  const rta = new FakeUser('rta@example.test');
  const target = new FakeSpreadsheet('dev-target-id', ['Existing Target'], [owner, rta]);
  const control = new FakeSpreadsheet('dev-control-id', ['Existing Control'], [owner, rta]);
  const spreadsheetApp = new FakeSpreadsheetApp([target, control]);
  const session = { getEffectiveUser: () => owner };
  const properties = propertyAdapter({
    CXP_ENV: 'DEV',
    CXP_DEV_TARGET_SPREADSHEET_ID: target.id,
    CXP_DEV_CONTROL_SPREADSHEET_ID: control.id,
  });

  return { control, owner, properties, session, spreadsheetApp, target };
}

const TARGET_SHEETS = [
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
  '_CALC_HANDLED',
  '_CALC_OFFERED',
  '_CALC_AHT',
  '_CALC_AUXES',
  '_CALC_STAFF',
  '_AGG_INTERVAL',
  '_AGG_FORECAST',
  '_AGG_ALLOCATION',
  'Interval View',
  'MOM',
  'Teams Update',
  'Aux Productive',
  'Allocation Export',
];

const CONTROL_SHEETS = [
  'RUN_LOG',
  'ERROR_LOG',
  'FILE_LEDGER',
  'WEEK_REGISTRY',
  'SCHEMA_REGISTRY',
  'PARITY_RESULTS',
  'SOURCE_ERROR_BASELINE',
];

// Defect caught: configuration opens one workbook twice or omits part of the required skeleton.
test('configured CXP-02 setup initializes separate target and control workbooks', () => {
  const WorkbookSetup = loadModule('../src/main/WorkbookSetup.js');
  assert.equal(
    typeof WorkbookSetup?.initializeConfiguredWorkbooks,
    'function',
    'WorkbookSetup.initializeConfiguredWorkbooks must be implemented',
  );
  const harness = buildHarness();

  const result = WorkbookSetup.initializeConfiguredWorkbooks(harness.properties, {
    spreadsheetApp: harness.spreadsheetApp,
    session: harness.session,
  });

  assert.deepEqual(harness.spreadsheetApp.openedIds, ['dev-target-id', 'dev-control-id']);
  assert.deepEqual(harness.target.insertedSheetNames, TARGET_SHEETS);
  assert.deepEqual(harness.control.insertedSheetNames, CONTROL_SHEETS);
  assert.equal(harness.target.getSpreadsheetTimeZone(), 'Etc/GMT+8');
  assert.equal(harness.control.getSpreadsheetTimeZone(), 'Etc/GMT+8');
  assert.deepEqual(result, {
    environment: 'DEV',
    target: { createdSheets: TARGET_SHEETS, existingSheets: [] },
    control: { createdSheets: CONTROL_SHEETS, existingSheets: [] },
  });
});

// Defect caught: rerunning setup duplicates sheets or clears values already loaded into managed or unrelated tabs.
test('rerunning CXP-02 initialization preserves data and creates nothing twice', () => {
  const WorkbookSetup = loadModule('../src/main/WorkbookSetup.js');
  assert.equal(typeof WorkbookSetup?.initializeConfiguredWorkbooks, 'function');
  const harness = buildHarness();

  WorkbookSetup.initializeConfiguredWorkbooks(harness.properties, {
    spreadsheetApp: harness.spreadsheetApp,
    session: harness.session,
  });
  harness.target.getSheetByName('_RAW_HANDLED').values = [['raw-sentinel']];
  harness.target.getSheetByName('Existing Target').values = [['existing-sentinel']];
  harness.control.getSheetByName('RUN_LOG').values = [['run-sentinel']];
  const targetInsertCount = harness.target.insertedSheetNames.length;
  const controlInsertCount = harness.control.insertedSheetNames.length;

  const second = WorkbookSetup.initializeConfiguredWorkbooks(harness.properties, {
    spreadsheetApp: harness.spreadsheetApp,
    session: harness.session,
  });

  assert.equal(harness.target.insertedSheetNames.length, targetInsertCount);
  assert.equal(harness.control.insertedSheetNames.length, controlInsertCount);
  assert.deepEqual(harness.target.getSheetByName('_RAW_HANDLED').values, [['raw-sentinel']]);
  assert.deepEqual(harness.target.getSheetByName('Existing Target').values, [
    ['existing-sentinel'],
  ]);
  assert.deepEqual(harness.control.getSheetByName('RUN_LOG').values, [['run-sentinel']]);
  assert.deepEqual(second, {
    environment: 'DEV',
    target: { createdSheets: [], existingSheets: TARGET_SHEETS },
    control: { createdSheets: [], existingSheets: CONTROL_SHEETS },
  });
  for (const sheetName of TARGET_SHEETS) {
    assert.equal(
      harness.target.getSheets().filter((sheet) => sheet.getName() === sheetName).length,
      1,
      sheetName + ' must exist exactly once',
    );
  }
  for (const sheetName of CONTROL_SHEETS) {
    assert.equal(
      harness.control.getSheets().filter((sheet) => sheet.getName() === sheetName).length,
      1,
      sheetName + ' must exist exactly once',
    );
  }
});

// Defect caught: backend/control tabs remain editable, report tabs are locked, or setup takes over a user-managed protection.
test('CXP-02 sheet roles protect backend and control tabs but keep report surfaces usable', () => {
  const WorkbookSetup = loadModule('../src/main/WorkbookSetup.js');
  assert.equal(typeof WorkbookSetup?.initializeConfiguredWorkbooks, 'function');
  const harness = buildHarness();

  WorkbookSetup.initializeConfiguredWorkbooks(harness.properties, {
    spreadsheetApp: harness.spreadsheetApp,
    session: harness.session,
  });
  const rawHandled = harness.target.getSheetByName('_RAW_HANDLED');

  WorkbookSetup.initializeConfiguredWorkbooks(harness.properties, {
    spreadsheetApp: harness.spreadsheetApp,
    session: harness.session,
  });

  const backendSheets = TARGET_SHEETS.filter((sheetName) => sheetName.startsWith('_'));
  const reportSheets = TARGET_SHEETS.filter((sheetName) => !sheetName.startsWith('_'));
  for (const sheetName of backendSheets.concat(CONTROL_SHEETS)) {
    const spreadsheet = CONTROL_SHEETS.includes(sheetName) ? harness.control : harness.target;
    const managed = spreadsheet
      .getSheetByName(sheetName)
      .getProtections('SHEET')
      .filter((protection) =>
        protection.getDescription().startsWith('CXP-02 managed protection:'),
      );
    assert.equal(managed.length, 1, sheetName + ' must have one managed protection');
    assert.equal(managed[0].isWarningOnly(), false);
    assert.equal(managed[0].canDomainEdit(), false);
    assert.deepEqual(managed[0].getTargetAudiences(), []);
    assert.deepEqual(managed[0].getUnprotectedRanges(), []);
    assert.deepEqual(
      managed[0].getEditors().map((editor) => editor.getEmail()),
      ['owner@example.test'],
    );
  }
  for (const sheetName of reportSheets) {
    assert.equal(
      harness.target
        .getSheetByName(sheetName)
        .getProtections('SHEET')
        .filter((protection) =>
          protection.getDescription().startsWith('CXP-02 managed protection:'),
        ).length,
      0,
      sheetName + ' must remain user-facing',
    );
  }
  assert.equal(rawHandled.getProtections('SHEET').length, 1);
  assert.equal(harness.target.getSheetByName('Existing Target').getProtections('SHEET').length, 0);

  const conflict = buildHarness();
  const existingBackend = new FakeSheet('_RAW_HANDLED', [conflict.owner, new FakeUser('rta@example.test')]);
  const unrelatedProtection = existingBackend
    .protect()
    .setDescription('Owner-managed unrelated protection');
  conflict.target.sheets.push(existingBackend);

  assert.throws(
    () =>
      WorkbookSetup.initializeConfiguredWorkbooks(conflict.properties, {
        spreadsheetApp: conflict.spreadsheetApp,
        session: conflict.session,
      }),
    /_RAW_HANDLED already has a non-CXP sheet protection/,
  );
  assert.equal(conflict.target.getSpreadsheetTimeZone(), 'Etc/UTC');
  assert.deepEqual(conflict.target.insertedSheetNames, []);
  assert.equal(unrelatedProtection.getDescription(), 'Owner-managed unrelated protection');
  assert.equal(unrelatedProtection.isWarningOnly(), true);
  assert.equal(unrelatedProtection.canDomainEdit(), true);
  assert.deepEqual(unrelatedProtection.getTargetAudiences(), ['audience-all-rta']);
  assert.deepEqual(unrelatedProtection.getUnprotectedRanges(), ['A1:B2']);
  assert.deepEqual(
    unrelatedProtection.getEditors().map((editor) => editor.getEmail()),
    ['owner@example.test', 'rta@example.test'],
  );

  const controlConflict = buildHarness();
  const existingControl = new FakeSheet('RUN_LOG', [
    controlConflict.owner,
    new FakeUser('rta@example.test'),
  ]);
  existingControl.protect().setDescription('Owner-managed control protection');
  controlConflict.control.sheets.push(existingControl);

  assert.throws(
    () =>
      WorkbookSetup.initializeConfiguredWorkbooks(controlConflict.properties, {
        spreadsheetApp: controlConflict.spreadsheetApp,
        session: controlConflict.session,
      }),
    /RUN_LOG already has a non-CXP sheet protection/,
  );
  assert.equal(controlConflict.target.getSpreadsheetTimeZone(), 'Etc/UTC');
  assert.equal(controlConflict.control.getSpreadsheetTimeZone(), 'Etc/UTC');
  assert.deepEqual(controlConflict.target.insertedSheetNames, []);
  assert.deepEqual(controlConflict.control.insertedSheetNames, []);
});

// Defect caught: invalid workbook IDs reach SpreadsheetApp, or target and control resolve to the same workbook.
test('CXP-02 setup rejects missing or identical workbook IDs before opening a spreadsheet', () => {
  const WorkbookSetup = loadModule('../src/main/WorkbookSetup.js');
  const WorkbookInitializer = loadModule('../src/main/WorkbookInitializer.js');
  const ControlWorkbookInitializer = loadModule('../src/main/ControlWorkbookInitializer.js');
  assert.equal(typeof WorkbookSetup?.initializeConfiguredWorkbooks, 'function');
  assert.equal(typeof WorkbookInitializer?.initialize, 'function');
  assert.equal(typeof ControlWorkbookInitializer?.initialize, 'function');

  for (const scenario of [
    {
      values: { CXP_ENV: 'DEV', CXP_DEV_CONTROL_SPREADSHEET_ID: 'dev-control-id' },
      message: /CXP_DEV_TARGET_SPREADSHEET_ID is required for CXP-02 initialization/,
    },
    {
      values: { CXP_ENV: 'DEV', CXP_DEV_TARGET_SPREADSHEET_ID: 'dev-target-id' },
      message: /CXP_DEV_CONTROL_SPREADSHEET_ID is required for CXP-02 initialization/,
    },
    {
      values: {
        CXP_ENV: 'DEV',
        CXP_DEV_TARGET_SPREADSHEET_ID: 'same-id',
        CXP_DEV_CONTROL_SPREADSHEET_ID: 'same-id',
      },
      message: /Target and control spreadsheet IDs must be distinct/,
    },
  ]) {
    const spreadsheetApp = new FakeSpreadsheetApp([]);
    assert.throws(
      () =>
        WorkbookSetup.initializeConfiguredWorkbooks(propertyAdapter(scenario.values), {
          spreadsheetApp,
          session: { getEffectiveUser: () => new FakeUser('owner@example.test') },
        }),
      scenario.message,
    );
    assert.deepEqual(spreadsheetApp.openedIds, []);
  }

  const harness = buildHarness();
  assert.throws(
    () =>
      WorkbookSetup.initializeConfiguredWorkbooks(harness.properties, {
        spreadsheetApp: harness.spreadsheetApp,
        session: { getEffectiveUser: () => new FakeUser('') },
      }),
    /An effective user with an email is required for CXP-02 initialization/,
  );
  assert.deepEqual(harness.spreadsheetApp.openedIds, []);
  assert.deepEqual(harness.target.insertedSheetNames, []);
  assert.deepEqual(harness.control.insertedSheetNames, []);

  const direct = buildHarness();
  assert.throws(
    () =>
      WorkbookInitializer.initialize(direct.target, {
        spreadsheetApp: direct.spreadsheetApp,
        session: { getEffectiveUser: () => new FakeUser('') },
      }),
    /An effective user with an email is required to protect backend sheets/,
  );
  assert.deepEqual(direct.target.insertedSheetNames, []);
  assert.equal(direct.target.getSpreadsheetTimeZone(), 'Etc/UTC');

  const liveFallback = buildHarness();
  const partialInjection = buildHarness();
  global.SpreadsheetApp = liveFallback.spreadsheetApp;
  global.Session = liveFallback.session;
  try {
    assert.throws(
      () =>
        WorkbookSetup.initializeConfiguredWorkbooks(partialInjection.properties, {
          spreadsheetApp: partialInjection.spreadsheetApp,
        }),
      /SpreadsheetApp and Session adapters are required for CXP-02 initialization/,
    );
  } finally {
    delete global.SpreadsheetApp;
    delete global.Session;
  }
  assert.deepEqual(partialInjection.spreadsheetApp.openedIds, []);
  assert.deepEqual(liveFallback.spreadsheetApp.openedIds, []);
  assert.deepEqual(liveFallback.target.insertedSheetNames, []);
  assert.deepEqual(liveFallback.control.insertedSheetNames, []);

  const missingOpenBoundary = buildHarness();
  assert.throws(
    () =>
      WorkbookSetup.initializeConfiguredWorkbooks(missingOpenBoundary.properties, {
        spreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
        session: missingOpenBoundary.session,
      }),
    /SpreadsheetApp adapter with openById is required for CXP-02 initialization/,
  );
  assert.deepEqual(missingOpenBoundary.target.insertedSheetNames, []);
  assert.deepEqual(missingOpenBoundary.control.insertedSheetNames, []);

  const missingProtectionType = buildHarness();
  missingProtectionType.spreadsheetApp.ProtectionType = {};
  assert.throws(
    () =>
      WorkbookSetup.initializeConfiguredWorkbooks(missingProtectionType.properties, {
        spreadsheetApp: missingProtectionType.spreadsheetApp,
        session: missingProtectionType.session,
      }),
    /SpreadsheetApp\.ProtectionType\.SHEET is required for CXP-02 initialization/,
  );
  assert.deepEqual(missingProtectionType.spreadsheetApp.openedIds, []);
  assert.deepEqual(missingProtectionType.target.insertedSheetNames, []);
  assert.deepEqual(missingProtectionType.control.insertedSheetNames, []);

  assert.throws(
    () =>
      WorkbookInitializer.initialize(missingProtectionType.target, {
        spreadsheetApp: missingProtectionType.spreadsheetApp,
        session: missingProtectionType.session,
      }),
    /SpreadsheetApp\.ProtectionType\.SHEET is required to protect backend sheets/,
  );
  assert.deepEqual(missingProtectionType.target.insertedSheetNames, []);

  const missingTimeZoneBoundary = buildHarness();
  missingTimeZoneBoundary.control.setSpreadsheetTimeZone = undefined;
  assert.throws(
    () =>
      WorkbookSetup.initializeConfiguredWorkbooks(missingTimeZoneBoundary.properties, {
        spreadsheetApp: missingTimeZoneBoundary.spreadsheetApp,
        session: missingTimeZoneBoundary.session,
      }),
    /Spreadsheet-compatible target must provide getSheetByName, insertSheet, and setSpreadsheetTimeZone/,
  );
  assert.equal(missingTimeZoneBoundary.target.getSpreadsheetTimeZone(), 'Etc/UTC');
  assert.equal(missingTimeZoneBoundary.control.getSpreadsheetTimeZone(), 'Etc/UTC');
  assert.deepEqual(missingTimeZoneBoundary.target.insertedSheetNames, []);
  assert.deepEqual(missingTimeZoneBoundary.control.insertedSheetNames, []);

  const directNull = buildHarness();
  global.SpreadsheetApp = directNull.spreadsheetApp;
  global.Session = directNull.session;
  try {
    assert.throws(
      () => WorkbookInitializer.initialize(directNull.target, null),
      /SpreadsheetApp and Session adapters are required to protect backend sheets/,
    );
    assert.throws(
      () => ControlWorkbookInitializer.initialize(directNull.control, null),
      /SpreadsheetApp and Session adapters are required to protect backend sheets/,
    );
  } finally {
    delete global.SpreadsheetApp;
    delete global.Session;
  }
  assert.deepEqual(directNull.target.insertedSheetNames, []);
  assert.deepEqual(directNull.control.insertedSheetNames, []);
});

// Defect caught: Apps Script evaluates DatasetSheets before SheetNames and executes a Node-only require fallback.
test('Apps Script evaluates DatasetSheets before SheetNames without CommonJS globals', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const context = vm.createContext({});
  const source = (relativePath) =>
    fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

  assert.doesNotThrow(() => {
    vm.runInContext(source('src/config/DatasetSheets.js'), context);
  });
  vm.runInContext(source('src/config/SheetNames.js'), context);

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.DatasetSheets.listBindings())),
    [
      { datasetName: 'Handled', rawSheetName: '_RAW_HANDLED', stagingSheetName: '_STG_HANDLED' },
      { datasetName: 'Offered', rawSheetName: '_RAW_OFFERED', stagingSheetName: '_STG_OFFERED' },
      { datasetName: 'AHT - Raw', rawSheetName: '_RAW_AHT', stagingSheetName: '_STG_AHT' },
      { datasetName: 'Auxes - Raw', rawSheetName: '_RAW_AUXES', stagingSheetName: '_STG_AUXES' },
      { datasetName: 'Staff', rawSheetName: '_RAW_STAFF', stagingSheetName: '_STG_STAFF' },
    ],
  );
});


module.exports = {
  CONTROL_SHEETS,
  FakeProtection,
  FakeSheet,
  FakeSpreadsheet,
  FakeSpreadsheetApp,
  FakeUser,
  TARGET_SHEETS,
  buildHarness,
  propertyAdapter,
};
