const assert = require('node:assert/strict');
const test = require('node:test');

const Config = require('../src/config/Config.js');
const ErrorCodes = require('../src/monitoring/ErrorCodes.js');
const HealthCheck = require('../src/services/HealthCheck.js');
const PromotionChecklist = require('../src/services/PromotionChecklist.js');
const SheetNames = require('../src/config/SheetNames.js');
const TriggerController = require('../src/services/TriggerController.js');
const WeekRegistryRepository = require('../src/repository/WeekRegistryRepository.js');
const WorkbookLifecycleService = require('../src/services/WorkbookLifecycleService.js');
const Cxp12Setup = require('../src/main/Cxp12Setup.js');
const Cxp12Uat = require('../src/main/Cxp12UatEntrypoints.js');
const ControlWorkbookHeaders = require('../src/main/ControlWorkbookHeaders.js');

class FakeSheet {
  constructor(name, values = []) {
    this.name = name;
    this.values = values.map((row) => row.slice());
  }

  getName() {
    return this.name;
  }

  getLastRow() {
    return this.values.length;
  }

  getRange(row, _column, rowCount, columnCount) {
    const sheet = this;
    return {
      getValues() {
        const rows = [];
        for (let index = 0; index < rowCount; index += 1) {
          const source = sheet.values[row - 1 + index] || [];
          rows.push(source.slice(0, columnCount));
        }
        return rows;
      },
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
  constructor(id, sheetNames) {
    this.id = id;
    this.sheets = new Map();
    (sheetNames || []).forEach((name) => {
      this.sheets.set(name, new FakeSheet(name));
    });
    this.timezone = null;
  }

  getId() {
    return this.id;
  }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }

  insertSheet(name) {
    const sheet = new FakeSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }

  setSpreadsheetTimeZone(value) {
    this.timezone = value;
  }
}

function propertyStore(initial = {}) {
  const values = { ...initial };
  return {
    deleteProperty(name) {
      delete values[name];
    },
    getProperty(name) {
      return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : null;
    },
    setProperty(name, value) {
      values[name] = String(value);
    },
    _values: values,
  };
}

function createControl(id = 'control-1') {
  const spreadsheet = new FakeSpreadsheet(id, SheetNames.CONTROL.slice());
  spreadsheet.getSheetByName('WEEK_REGISTRY').values = [WeekRegistryRepository.HEADERS.slice()];
  spreadsheet.getSheetByName('RUN_LOG').values = [
    [
      'Run ID',
      'Started At UTC',
      'Ended At UTC',
      'Source Actor',
      'Source File Name',
      'Source File ID',
      'Schema Version',
      'Input Row Counts JSON',
      'Output Row Counts JSON',
      'Target Workbook ID',
      'Status',
      'Error Code',
      'State History JSON',
    ],
  ];
  return spreadsheet;
}

function createTarget(id, withRawMarker) {
  const spreadsheet = new FakeSpreadsheet(id, SheetNames.targetAll());
  if (withRawMarker) {
    spreadsheet.getSheetByName('_RAW_HANDLED').values = [
      ['Case: Case Number'],
      ['MARKER-ROW'],
    ];
  }
  return spreadsheet;
}

function buildLifecyclePorts(options = {}) {
  const properties = options.properties || propertyStore({
    CXP_ENV: 'DEV',
    CXP_DEV_CONTROL_SPREADSHEET_ID: 'control-1',
    CXP_DEV_MASTER_TEMPLATE_SPREADSHEET_ID: 'template-1',
    CXP_DEV_TARGET_SPREADSHEET_ID: options.targetId || '',
  });
  const books = options.books || new Map();
  if (!books.has('control-1')) {
    books.set('control-1', createControl('control-1'));
  }
  if (!books.has('template-1')) {
    books.set('template-1', createTarget('template-1'));
  }
  let copyCount = 0;
  return {
    books,
    clock: { now: () => new Date('2026-08-31T12:00:00.000Z') },
    drive: {
      copyFile(templateId, name) {
        assert.equal(templateId, 'template-1');
        copyCount += 1;
        const id = options.copyId || `week-copy-${copyCount}`;
        const copied = createTarget(id, options.withRawMarker === true);
        books.set(id, copied);
        return { id, name };
      },
    },
    ensureTarget(spreadsheet) {
      const created = [];
      SheetNames.targetAll().forEach((name) => {
        if (!spreadsheet.getSheetByName(name)) {
          spreadsheet.insertSheet(name);
          created.push(name);
        }
      });
      spreadsheet.setSpreadsheetTimeZone(SheetNames.BUSINESS_TIME_ZONE);
      return {
        createdSheets: Object.freeze(created),
        existingSheets: Object.freeze(
          SheetNames.targetAll().filter((name) => created.indexOf(name) === -1),
        ),
      };
    },
    isIngestionActive: options.isIngestionActive || (() => false),
    properties,
    seedBusinessContext: false,
    spreadsheetApp: {
      openById(id) {
        const book = books.get(id);
        if (!book) {
          throw new Error('missing spreadsheet ' + id);
        }
        return book;
      },
    },
  };
}

test('WeekRegistryRepository upsertes ACTIVE and archives prior week', () => {
  const control = createControl();
  const registry = WeekRegistryRepository.create(control);
  registry.upsert({
    activatedAtUtc: '2026-08-17T00:00:00.000Z',
    masterTemplateSpreadsheetId: 'template-1',
    notes: '',
    registeredAtUtc: '2026-08-17T00:00:00.000Z',
    status: 'ACTIVE',
    targetSpreadsheetId: 'week-a',
    weekKey: '2026-08-17',
  });
  registry.archiveActive('2026-08-24');
  registry.upsert({
    activatedAtUtc: '2026-08-24T00:00:00.000Z',
    masterTemplateSpreadsheetId: 'template-1',
    notes: '',
    registeredAtUtc: '2026-08-24T00:00:00.000Z',
    status: 'ACTIVE',
    targetSpreadsheetId: 'week-b',
    weekKey: '2026-08-24',
  });
  assert.equal(registry.findActive().weekKey, '2026-08-24');
  assert.equal(registry.findByWeekKey('2026-08-17').status, 'ARCHIVED');
});

test('Week Key validation accepts Monday only', () => {
  assert.equal(WorkbookLifecycleService.assertMondayWeekKey('2026-08-17'), '2026-08-17');
  assert.equal(WorkbookLifecycleService.mondayForIso('2026-08-19'), '2026-08-17');
  assert.throws(
    () => WorkbookLifecycleService.assertMondayWeekKey('2026-08-18'),
    (error) => error.code === 'LIFECYCLE_WEEK_KEY_INVALID',
  );
});

test('createOrActivate is idempotent for the same Week Key', () => {
  const ports = buildLifecyclePorts();
  const lifecycle = WorkbookLifecycleService.create(ports);
  const first = lifecycle.createOrActivateWeeklyWorkbook({ weekKey: '2026-08-17' });
  const second = lifecycle.createOrActivateWeeklyWorkbook({ weekKey: '2026-08-17' });
  assert.equal(first.created, true);
  assert.equal(first.record.status, 'ACTIVE');
  assert.equal(second.idempotent, true);
  assert.equal(second.code, 'LIFECYCLE_ALREADY_ACTIVE');
  assert.equal(
    ports.properties.getProperty('CXP_DEV_TARGET_SPREADSHEET_ID'),
    first.record.targetSpreadsheetId,
  );
});

test('ACTIVE registry mismatch fails closed', () => {
  const ports = buildLifecyclePorts({ targetId: 'wrong-target' });
  const lifecycle = WorkbookLifecycleService.create(ports);
  lifecycle.createOrActivateWeeklyWorkbook({ weekKey: '2026-08-17' });
  ports.properties.setProperty('CXP_DEV_TARGET_SPREADSHEET_ID', 'drifted');
  assert.throws(
    () => lifecycle.getActiveWeeklyWorkbook(),
    (error) => error.code === 'LIFECYCLE_ACTIVE_TARGET_MISMATCH',
  );
});

test('rollover refuses while ingestion is active', () => {
  const ports = buildLifecyclePorts({ isIngestionActive: () => true });
  const lifecycle = WorkbookLifecycleService.create(ports);
  assert.throws(
    () => lifecycle.createOrActivateWeeklyWorkbook({ weekKey: '2026-08-17' }),
    (error) => error.code === 'LIFECYCLE_ROLLOVER_LOCKED',
  );
});

test('ensure-only reinit preserves live raw data', () => {
  const ports = buildLifecyclePorts({ withRawMarker: true });
  const lifecycle = WorkbookLifecycleService.create(ports);
  const activated = lifecycle.createOrActivateWeeklyWorkbook({ weekKey: '2026-08-17' });
  const target = ports.books.get(activated.record.targetSpreadsheetId);
  target.getSheetByName('_RAW_HANDLED').values = [['Case'], ['MARKER-ROW']];
  const result = lifecycle.initializeWeekControls(activated.record.targetSpreadsheetId, {
    weekKey: '2026-08-17',
  });
  assert.equal(result.liveDataPreserved, true);
  assert.equal(result.destructive, false);
  assert.deepEqual(target.getSheetByName('_RAW_HANDLED').values[1], ['MARKER-ROW']);
});

test('HealthCheck reports missing sheets, failed run, and stale data', () => {
  const control = createControl();
  control.getSheetByName('RUN_LOG').values.push([
    'run-1',
    '2026-08-31T08:00:00.000Z',
    '2026-08-31T08:05:00.000Z',
    null,
    '',
    '',
    '1.0.0',
    '{}',
    '{}',
    'target-1',
    'FAILED_INGESTION',
    'X',
    '[]',
  ]);
  const emptyTarget = new FakeSpreadsheet('target-1', []);
  const configuration = {
    environment: 'DEV',
    targetSpreadsheetId: 'target-1',
    controlSpreadsheetId: 'control-1',
    staleDataThresholdMinutes: '30',
  };
  WeekRegistryRepository.create(control).upsert({
    activatedAtUtc: '2026-08-17T00:00:00.000Z',
    masterTemplateSpreadsheetId: 'template-1',
    notes: '',
    registeredAtUtc: '2026-08-17T00:00:00.000Z',
    status: 'ACTIVE',
    targetSpreadsheetId: 'target-1',
    weekKey: '2026-08-17',
  });

  const result = HealthCheck.evaluate(
    {
      clock: { now: () => new Date('2026-08-31T12:00:00.000Z') },
      controlSpreadsheet: control,
      targetSpreadsheet: emptyTarget,
    },
    { configuration, recalcReady: false },
  );

  assert.equal(result.healthy, false);
  assert.ok(result.codes.includes('HEALTH_MISSING_SHEETS'));
  assert.ok(result.codes.includes('HEALTH_LAST_RUN_FAILED'));
  assert.ok(result.codes.includes('HEALTH_STALE_DATA'));
  assert.ok(result.codes.includes('HEALTH_RECALC_NOT_READY'));
});

test('HealthCheck is healthy when aligned, complete, fresh, and ready', () => {
  const control = createControl();
  const target = createTarget('target-1');
  control.getSheetByName('RUN_LOG').values.push([
    'run-ok',
    '2026-08-31T11:00:00.000Z',
    '2026-08-31T11:10:00.000Z',
    null,
    '',
    '',
    '1.0.0',
    '{}',
    '{}',
    'target-1',
    'SUCCESS',
    null,
    '[]',
  ]);
  WeekRegistryRepository.create(control).upsert({
    activatedAtUtc: '2026-08-17T00:00:00.000Z',
    masterTemplateSpreadsheetId: 'template-1',
    notes: '',
    registeredAtUtc: '2026-08-17T00:00:00.000Z',
    status: 'ACTIVE',
    targetSpreadsheetId: 'target-1',
    weekKey: '2026-08-17',
  });
  const result = HealthCheck.evaluate(
    {
      clock: { now: () => new Date('2026-08-31T11:30:00.000Z') },
      controlSpreadsheet: control,
      targetSpreadsheet: target,
    },
    {
      configuration: {
        environment: 'DEV',
        targetSpreadsheetId: 'target-1',
        controlSpreadsheetId: 'control-1',
        staleDataThresholdMinutes: '90',
      },
      recalcReady: true,
    },
  );
  assert.equal(result.healthy, true);
  assert.equal(result.activeWeekKey, '2026-08-17');
  assert.equal(result.registryPropertyAligned, true);
});

test('TriggerController installs maintenance kinds only', () => {
  const triggers = [];
  const scriptApp = {
    WeekDay: { MONDAY: 'MONDAY' },
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
      const trigger = {
        handler,
        getHandlerFunction() {
          return handler;
        },
      };
      return {
        timeBased() {
          return {
            after() { return this; },
            atHour() { return this; },
            create() {
              triggers.push(trigger);
              return trigger;
            },
            everyDays() { return this; },
            everyHours() { return this; },
            everyWeeks() { return this; },
            onWeekDay() { return this; },
          };
        },
      };
    },
  };
  const controller = TriggerController.create({
    properties: propertyStore(),
    scriptApp,
  });
  const installed = controller.installMaintenanceTriggers();
  assert.equal(installed.inventory.totalMaintenance, 5);
  assert.equal(installed.primaryIngestDetected, false);
  triggers.push({
    getHandlerFunction() {
      return 'executeIngestion';
    },
  });
  assert.equal(controller.listInventory().primaryIngestDetected, true);
});

test('PromotionChecklist requires PROD acknowledgment', () => {
  const base = {
    controlConfigured: true,
    driveInboxConfigured: true,
    healthHealthy: true,
    localVerifyPassed: true,
    masterTemplateConfigured: true,
    registryHeadersInstalled: true,
    singleActiveWeek: true,
    targetConfigured: true,
    triggerInventoryInstalled: true,
  };
  assert.equal(
    PromotionChecklist.evaluate(Object.assign({ environment: 'UAT' }, base)).promotionReady,
    true,
  );
  const prod = PromotionChecklist.evaluate(Object.assign({ environment: 'PROD' }, base));
  assert.equal(prod.promotionReady, false);
  assert.ok(prod.missing.includes('prodAcknowledged'));
  assert.equal(
    PromotionChecklist.evaluate(
      Object.assign({ environment: 'PROD', prodAcknowledged: true }, base),
    ).promotionReady,
    true,
  );
});

test('CXP-12 setup installs final WEEK_REGISTRY headers', () => {
  const control = createControl();
  control.getSheetByName('WEEK_REGISTRY').values = [];
  const properties = propertyStore({
    CXP_ENV: 'DEV',
    CXP_DEV_CONTROL_SPREADSHEET_ID: 'control-1',
  });
  const status = Cxp12Setup.initialize(
    {
      spreadsheetApp: {
        openById() {
          return control;
        },
      },
    },
    properties,
  );
  assert.equal(status.status, 'COMPLETE');
  assert.deepEqual(
    control.getSheetByName('WEEK_REGISTRY').values[0],
    WeekRegistryRepository.HEADERS,
  );
});

test('control header seed uses final CXP-12 WEEK_REGISTRY headers', () => {
  assert.deepEqual(
    ControlWorkbookHeaders.WEEK_REGISTRY_HEADERS,
    WeekRegistryRepository.HEADERS,
  );
  assert.equal(ControlWorkbookHeaders.WEEK_REGISTRY_HEADERS.includes('Activated At UTC'), true);
});

test('Config loads optional stale threshold key', () => {
  const config = Config.load(propertyStore({
    CXP_ENV: 'DEV',
    CXP_DEV_TARGET_SPREADSHEET_ID: 't',
    CXP_DEV_STALE_DATA_THRESHOLD_MINUTES: '120',
  }));
  assert.equal(config.staleDataThresholdMinutes, '120');
});

test('CXP12 UAT succession helpers pass with injected ports', () => {
  const ports = buildLifecyclePorts({ withRawMarker: true });
  const books = ports.books;
  const control = books.get('control-1');

  const prerequisites = Cxp12Uat.verifyPrerequisites({
    properties: ports.properties,
    upstream: { cxp02: true, cxp04: true, cxp06: true, cxp10: true },
  });
  assert.equal(prerequisites.pass, true);

  const install = Cxp12Uat.installRegistry({
    properties: ports.properties,
    services: {
      spreadsheetApp: ports.spreadsheetApp,
    },
  });
  assert.equal(install.pass, true);

  const created = Cxp12Uat.createOrActivateWeek({
    lifecyclePorts: ports,
    properties: ports.properties,
  });
  assert.equal(created.pass, true);

  const aligned = Cxp12Uat.alignActiveTarget({
    lifecyclePorts: ports,
    properties: ports.properties,
  });
  assert.equal(aligned.pass, true);

  const targetId = ports.properties.getProperty('CXP_DEV_TARGET_SPREADSHEET_ID');
  const target = books.get(targetId);
  target.getSheetByName('_RAW_HANDLED').values = [['Case'], ['MARKER-ROW']];
  control.getSheetByName('RUN_LOG').values.push([
    'run-ok',
    '2026-08-31T11:00:00.000Z',
    '2026-08-31T11:10:00.000Z',
    null,
    '',
    '',
    '1.0.0',
    '{}',
    '{}',
    targetId,
    'SUCCESS',
    null,
    '[]',
  ]);

  const healthy = HealthCheck.evaluate(
    {
      clock: ports.clock,
      controlSpreadsheet: control,
      targetSpreadsheet: target,
    },
    {
      configuration: Config.load(ports.properties),
      recalcReady: true,
    },
  );
  const health = Cxp12Uat.healthCheck({
    healthPorts: {
      clock: ports.clock,
      controlSpreadsheet: control,
      targetSpreadsheet: target,
    },
    healthOptions: {
      configuration: Config.load(ports.properties),
      recalcReady: true,
    },
    faultHealth: {
      failedRun: { codes: ['HEALTH_LAST_RUN_FAILED'] },
      missingSheets: { codes: ['HEALTH_MISSING_SHEETS'] },
      stale: { codes: ['HEALTH_STALE_DATA'] },
    },
  });
  assert.equal(healthy.healthy, true);
  assert.equal(health.pass, true);

  const triggers = [];
  const triggerPorts = {
    properties: propertyStore(),
    scriptApp: {
      WeekDay: { MONDAY: 'MONDAY' },
      deleteTrigger(trigger) {
        const index = triggers.indexOf(trigger);
        if (index >= 0) triggers.splice(index, 1);
      },
      getProjectTriggers() {
        return triggers.slice();
      },
      newTrigger(handler) {
        const trigger = { getHandlerFunction() { return handler; } };
        return {
          timeBased() {
            return {
              after() { return this; },
              atHour() { return this; },
              create() { triggers.push(trigger); return trigger; },
              everyDays() { return this; },
              everyHours() { return this; },
              everyWeeks() { return this; },
              onWeekDay() { return this; },
            };
          },
        };
      },
    },
  };
  const inventory = Cxp12Uat.triggerInventory({ triggerPorts });
  assert.equal(inventory.pass, true);

  const firstTargetId = targetId;
  books.get(firstTargetId).getSheetByName('_RAW_HANDLED').values = [['Case'], ['MARKER-ROW']];
  const rollover = Cxp12Uat.weeklyRollover({
    lifecyclePorts: ports,
    properties: ports.properties,
    rawMarkerValue: 'MARKER-ROW',
    readRawMarker(weekKey) {
      const row = WeekRegistryRepository.create(control).findByWeekKey(weekKey);
      if (!row) return null;
      const book = books.get(row.targetSpreadsheetId);
      return book.getSheetByName('_RAW_HANDLED').values[1][0];
    },
    forceIngestionActive: true,
  });
  assert.equal(rollover.pass, true);
  assert.equal(rollover.priorStatus, 'ARCHIVED');

  const reinit = Cxp12Uat.reinitSafety({
    lifecyclePorts: ports,
    properties: ports.properties,
    rawMarkerValue: 'MARKER-ROW',
    readActiveRawMarker() {
      const activeId = ports.properties.getProperty('CXP_DEV_TARGET_SPREADSHEET_ID');
      return books.get(activeId).getSheetByName('_RAW_HANDLED').values[1]
        ? books.get(activeId).getSheetByName('_RAW_HANDLED').values[1][0]
        : null;
    },
  });
  // New week copy may not have marker; seed one for the active book.
  const activeId = ports.properties.getProperty('CXP_DEV_TARGET_SPREADSHEET_ID');
  books.get(activeId).getSheetByName('_RAW_HANDLED').values = [['Case'], ['MARKER-ROW']];
  const reinit2 = Cxp12Uat.reinitSafety({
    lifecyclePorts: ports,
    properties: ports.properties,
    rawMarkerValue: 'MARKER-ROW',
    readActiveRawMarker() {
      return books.get(ports.properties.getProperty('CXP_DEV_TARGET_SPREADSHEET_ID'))
        .getSheetByName('_RAW_HANDLED').values[1][0];
    },
  });
  assert.equal(reinit2.pass, true);

  const gate = Cxp12Uat.promotionGate({
    properties: ports.properties,
    prerequisites,
    health: healthy,
    inventory: inventory,
    localVerifyPassed: true,
    driveInboxConfigured: true,
    singleActiveWeek: true,
  });
  assert.equal(gate.promotionReady, true);
  assert.ok(ErrorCodes.get('LIFECYCLE_ACTIVE_TARGET_MISMATCH'));
});
