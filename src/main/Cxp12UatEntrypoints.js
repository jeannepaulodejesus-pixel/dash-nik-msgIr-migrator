/**
 * CXP-12 hosted UAT helpers for docs/cxp12-uat-runbook.md.
 *
 * Editor entrypoints (parameterless):
 *   CXP12UatStep00VerifyPrerequisites
 *   CXP12UatStep01InstallRegistry
 *   CXP12UatStep02CreateOrActivateWeek
 *   CXP12UatStep03AlignActiveTarget
 *   CXP12UatStep04HealthCheck
 *   CXP12UatStep05TriggerInventory
 *   CXP12UatStep06WeeklyRollover
 *   CXP12UatStep07ReinitSafety
 *   CXP12UatStep08PromotionGate
 */
var Cxp12Uat = (function () {
  'use strict';

  var FIXTURE_WEEK_KEY = '2026-08-17';
  var FIXTURE_NEXT_WEEK_KEY = '2026-08-24';
  /** Reserved disposable cell on `_RAW_HANDLED` (AX1) — always writable for UAT. */
  var UAT_MARKER_VALUE = 'CXP12-UAT-MARKER';
  var UAT_MARKER_ROW = 1;
  var UAT_MARKER_COL = 50;

  function seedUatRawMarker(sheet) {
    if (!sheet || typeof sheet.getRange !== 'function') {
      return false;
    }
    sheet.getRange(UAT_MARKER_ROW, UAT_MARKER_COL).setValue(UAT_MARKER_VALUE);
    return true;
  }

  function readUatRawMarker(sheet) {
    if (!sheet || typeof sheet.getRange !== 'function') {
      return null;
    }
    return String(sheet.getRange(UAT_MARKER_ROW, UAT_MARKER_COL).getValue() || '');
  }

  function resolveConfig() {
    if (typeof Config !== 'undefined') {
      return Config;
    }
    return require('../config/Config.js');
  }

  function resolveSetup() {
    if (typeof Cxp12Setup !== 'undefined') {
      return Cxp12Setup;
    }
    return require('./Cxp12Setup.js');
  }

  function resolveLifecycle() {
    if (typeof WorkbookLifecycleService !== 'undefined') {
      return WorkbookLifecycleService;
    }
    return require('../services/WorkbookLifecycleService.js');
  }

  function resolveHealthCheck() {
    if (typeof HealthCheck !== 'undefined') {
      return HealthCheck;
    }
    return require('../services/HealthCheck.js');
  }

  function resolveTriggers() {
    if (typeof TriggerController !== 'undefined') {
      return TriggerController;
    }
    return require('../services/TriggerController.js');
  }

  function resolvePromotion() {
    if (typeof PromotionChecklist !== 'undefined') {
      return PromotionChecklist;
    }
    return require('../services/PromotionChecklist.js');
  }

  function resolveWeekRegistry() {
    if (typeof WeekRegistryRepository !== 'undefined') {
      return WeekRegistryRepository;
    }
    return require('../repository/WeekRegistryRepository.js');
  }

  function uatLog(tag, payload) {
    var line = 'CXP12_UAT ' + tag + ' ' + JSON.stringify(payload || {});
    if (typeof console !== 'undefined' && typeof console.log === 'function') {
      console.log(line);
    }
    if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
      Logger.log(line);
    }
  }

  function resolveHostedProperties(properties) {
    if (properties && typeof properties.getProperty === 'function') {
      return properties;
    }
    if (
      typeof PropertiesService !== 'undefined' &&
      PropertiesService &&
      typeof PropertiesService.getScriptProperties === 'function'
    ) {
      return PropertiesService.getScriptProperties();
    }
    return null;
  }

  function resolveHostedLifecyclePorts(ports) {
    var resolved = ports || {};
    if (resolved.lifecyclePorts) {
      return resolved.lifecyclePorts;
    }
    if (resolved.drive || resolved.spreadsheetApp || resolved.ensureTarget) {
      return resolved;
    }
    if (typeof SpreadsheetApp === 'undefined' || typeof DriveApp === 'undefined') {
      return resolved;
    }
    return {
      clock: { now: function () { return new Date(); } },
      drive: {
        copyFile: function (templateId, name) {
          var file = DriveApp.getFileById(templateId);
          return { id: file.makeCopy(name).getId() };
        },
      },
      lockService: typeof LockService !== 'undefined' ? LockService : null,
      properties: resolveHostedProperties(resolved.properties),
      // Hosted Apps Script must supply Session + SpreadsheetApp for CXP-02 protections.
      protectionServices: {
        session: typeof Session !== 'undefined' ? Session : null,
        spreadsheetApp: SpreadsheetApp,
      },
      seedBusinessContext: false,
      session: typeof Session !== 'undefined' ? Session : null,
      spreadsheetApp: SpreadsheetApp,
    };
  }

  function resolveHostedTriggerPorts(ports) {
    var resolved = ports || {};
    if (resolved.triggerPorts) {
      return resolved.triggerPorts;
    }
    if (resolved.scriptApp) {
      return resolved;
    }
    if (typeof ScriptApp === 'undefined') {
      return resolved;
    }
    return {
      properties: resolveHostedProperties(resolved.properties),
      scriptApp: ScriptApp,
    };
  }

  function resolveHostedHealthPorts(ports) {
    var resolved = ports || {};
    if (resolved.healthPorts) {
      return resolved.healthPorts;
    }
    if (resolved.controlSpreadsheet || resolved.targetSpreadsheet) {
      return resolved;
    }
    if (typeof SpreadsheetApp === 'undefined') {
      return resolved;
    }
    return {
      clock: { now: function () { return new Date(); } },
      properties: resolveHostedProperties(resolved.properties),
      spreadsheetApp: SpreadsheetApp,
    };
  }

  function defaultPorts(ports) {
    var resolved = ports || {};
    if (!resolved.properties) {
      resolved = Object.assign({}, resolved, {
        properties: resolveHostedProperties(null),
      });
    }
    return resolved;
  }

  function seedRecentSuccessRun(controlSpreadsheet) {
    if (!controlSpreadsheet) {
      return false;
    }
    var sheet = controlSpreadsheet.getSheetByName('RUN_LOG');
    if (!sheet) {
      return false;
    }
    var now = new Date().toISOString();
    var row = [
      'cxp12-uat-success',
      now,
      now,
      null,
      '',
      '',
      '1.0.0',
      '{}',
      '{}',
      '',
      'SUCCESS',
      null,
      '[]',
    ];
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, row.length).setValues([[
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
      ]]);
    }
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    return true;
  }

  function loadConfiguration(ports) {
    return resolveConfig().load(ports.properties);
  }

  function verifyPrerequisites(ports) {
    var resolved = defaultPorts(ports);
    var configuration = loadConfiguration(resolved);
    var result = Object.freeze({
      controlConfigured: Boolean(configuration.controlSpreadsheetId),
      environment: configuration.environment,
      masterTemplateConfigured: Boolean(configuration.masterTemplateSpreadsheetId),
      prodForbidden: configuration.environment !== 'PROD',
      targetConfigured: Boolean(configuration.targetSpreadsheetId),
      upstream: Object.freeze({
        cxp02: resolved.upstream && resolved.upstream.cxp02 !== false,
        cxp04: resolved.upstream && resolved.upstream.cxp04 !== false,
        cxp06: resolved.upstream && resolved.upstream.cxp06 !== false,
        cxp10: resolved.upstream && resolved.upstream.cxp10 !== false,
      }),
    });
    var pass = result.controlConfigured &&
      result.masterTemplateConfigured &&
      result.prodForbidden &&
      result.upstream.cxp02 &&
      result.upstream.cxp04 &&
      result.upstream.cxp06 &&
      result.upstream.cxp10;
    var output = Object.freeze(Object.assign({ pass: pass }, result));
    uatLog('CXP12UatStep00.result', {
      controlConfigured: output.controlConfigured,
      environment: output.environment,
      masterTemplateConfigured: output.masterTemplateConfigured,
      pass: output.pass,
    });
    return output;
  }

  function installRegistry(ports) {
    var resolved = defaultPorts(ports);
    var setup = resolveSetup();
    var services = resolved.services || {
      spreadsheetApp: typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp : null,
    };
    var status = setup.initialize(services, resolved.properties);
    var result = Object.freeze({
      pass: status.status === setup.SETUP_STATES.COMPLETE && status.nextStep === status.stepCount,
      status: status,
    });
    uatLog('CXP12UatStep01.result', { pass: result.pass, status: result.status.status });
    return result;
  }

  function createOrActivateWeek(ports, weekKey) {
    var resolved = defaultPorts(ports);
    var lifecycle = resolveLifecycle().create(resolveHostedLifecyclePorts(resolved));
    var key = weekKey || FIXTURE_WEEK_KEY;
    var first = lifecycle.createOrActivateWeeklyWorkbook({ weekKey: key });
    var second = lifecycle.createOrActivateWeeklyWorkbook({ weekKey: key });
    var result = Object.freeze({
      firstCreated: first.created === true,
      idempotent: second.idempotent === true || second.code === 'LIFECYCLE_ALREADY_ACTIVE',
      pass: Boolean(first.record && first.record.status === 'ACTIVE') &&
        (second.idempotent === true || second.code === 'LIFECYCLE_ALREADY_ACTIVE'),
      weekKey: key,
    });
    uatLog('CXP12UatStep02.result', {
      idempotent: result.idempotent,
      pass: result.pass,
      weekKey: result.weekKey,
    });
    return result;
  }

  function alignActiveTarget(ports) {
    var resolved = defaultPorts(ports);
    var lifecycle = resolveLifecycle().create(resolveHostedLifecyclePorts(resolved));
    var aligned = lifecycle.alignActiveTarget();
    var snapshot = lifecycle.getActiveWeeklyWorkbook();
    var result = Object.freeze({
      pass: aligned.aligned === true && snapshot.aligned === true,
      registryPropertyAligned: snapshot.aligned === true,
      weekKey: snapshot.weekKey,
    });
    uatLog('CXP12UatStep03.result', {
      pass: result.pass,
      registryPropertyAligned: result.registryPropertyAligned,
      weekKey: result.weekKey,
    });
    return result;
  }

  function healthCheck(ports) {
    var resolved = defaultPorts(ports);
    var healthPorts = resolveHostedHealthPorts(resolved);
    var configuration = (resolved.healthOptions && resolved.healthOptions.configuration) ||
      loadConfiguration(resolved);
    if (
      healthPorts.spreadsheetApp &&
      configuration.controlSpreadsheetId &&
      !healthPorts.controlSpreadsheet
    ) {
      healthPorts = Object.assign({}, healthPorts, {
        controlSpreadsheet: healthPorts.spreadsheetApp.openById(
          configuration.controlSpreadsheetId,
        ),
      });
    }
    if (
      healthPorts.spreadsheetApp &&
      configuration.targetSpreadsheetId &&
      !healthPorts.targetSpreadsheet
    ) {
      healthPorts = Object.assign({}, healthPorts, {
        targetSpreadsheet: healthPorts.spreadsheetApp.openById(
          configuration.targetSpreadsheetId,
        ),
      });
    }
    if (healthPorts.controlSpreadsheet && resolved.skipSuccessSeed !== true) {
      seedRecentSuccessRun(healthPorts.controlSpreadsheet);
    }
    var baseline = resolveHealthCheck().evaluate(healthPorts, Object.assign({
      configuration: configuration,
      recalcReady: true,
    }, resolved.healthOptions || {}));
    var faultCodes = Object.freeze({
      failedRun: resolved.faultHealth && resolved.faultHealth.failedRun
        ? resolved.faultHealth.failedRun.codes
        : null,
      missingSheets: resolved.faultHealth && resolved.faultHealth.missingSheets
        ? resolved.faultHealth.missingSheets.codes
        : null,
      stale: resolved.faultHealth && resolved.faultHealth.stale
        ? resolved.faultHealth.stale.codes
        : null,
    });
    var faultsOk = true;
    if (faultCodes.missingSheets) {
      faultsOk = faultsOk && faultCodes.missingSheets.indexOf('HEALTH_MISSING_SHEETS') !== -1;
    }
    if (faultCodes.failedRun) {
      faultsOk = faultsOk && faultCodes.failedRun.indexOf('HEALTH_LAST_RUN_FAILED') !== -1;
    }
    if (faultCodes.stale) {
      faultsOk = faultsOk && faultCodes.stale.indexOf('HEALTH_STALE_DATA') !== -1;
    }
    var result = Object.freeze({
      baselineHealthy: baseline.healthy === true,
      codes: baseline.codes,
      faultCodes: faultCodes,
      pass: baseline.healthy === true && faultsOk,
    });
    uatLog('CXP12UatStep04.result', {
      baselineHealthy: result.baselineHealthy,
      codes: result.codes,
      pass: result.pass,
    });
    return result;
  }

  function triggerInventory(ports) {
    var resolved = defaultPorts(ports);
    var controller = resolveTriggers().create(resolveHostedTriggerPorts(resolved));
    var installed = controller.installMaintenanceTriggers({
      kinds: resolveTriggers().MAINTENANCE_KINDS.slice(),
      replace: true,
    });
    var inventory = controller.listInventory();
    var result = Object.freeze({
      kinds: inventory.kinds,
      pass: inventory.primaryIngestDetected !== true && inventory.totalMaintenance >= 5,
      primaryIngestDetected: inventory.primaryIngestDetected,
      totalMaintenance: inventory.totalMaintenance,
    });
    uatLog('CXP12UatStep05.result', {
      pass: result.pass,
      primaryIngestDetected: result.primaryIngestDetected,
      totalMaintenance: result.totalMaintenance,
    });
    return result;
  }

  function weeklyRollover(ports) {
    var resolved = defaultPorts(ports);
    var lifecyclePorts = resolveHostedLifecyclePorts(resolved);
    var lifecycle = resolveLifecycle().create(lifecyclePorts);
    var firstKey = resolved.weekKey || FIXTURE_WEEK_KEY;
    var nextKey = resolved.nextWeekKey || FIXTURE_NEXT_WEEK_KEY;
    lifecycle.createOrActivateWeeklyWorkbook({ weekKey: firstKey });

    var configuration = loadConfiguration(resolved);
    var control = lifecyclePorts.controlSpreadsheet;
    if (!control && lifecyclePorts.spreadsheetApp && configuration.controlSpreadsheetId) {
      control = lifecyclePorts.spreadsheetApp.openById(configuration.controlSpreadsheetId);
    }
    var firstRecord = control
      ? resolveWeekRegistry().create(control).findByWeekKey(firstKey)
      : null;
    if (
      firstRecord &&
      lifecyclePorts.spreadsheetApp &&
      typeof resolved.readRawMarker !== 'function'
    ) {
      var firstBook = lifecyclePorts.spreadsheetApp.openById(firstRecord.targetSpreadsheetId);
      seedUatRawMarker(firstBook.getSheetByName('_RAW_HANDLED'));
    }

    var markerPreserved = true;
    if (typeof resolved.readRawMarker === 'function') {
      markerPreserved = resolved.readRawMarker(firstKey) ===
        (resolved.rawMarkerValue || UAT_MARKER_VALUE);
    }

    if (resolved.forceIngestionActive === true) {
      try {
        resolveLifecycle().create(Object.assign({}, lifecyclePorts, {
          isIngestionActive: function () { return true; },
        })).createOrActivateWeeklyWorkbook({ weekKey: nextKey });
        return Object.freeze({ pass: false, reason: 'expected_rollover_locked' });
      } catch (error) {
        if (!(error && error.code === 'LIFECYCLE_ROLLOVER_LOCKED')) {
          throw error;
        }
      }
    }

    var next = lifecycle.createOrActivateWeeklyWorkbook({ weekKey: nextKey });
    var active = lifecycle.getActiveWeeklyWorkbook();
    var prior = control
      ? resolveWeekRegistry().create(control).findByWeekKey(firstKey)
      : null;
    if (typeof resolved.readRawMarker === 'function') {
      markerPreserved = resolved.readRawMarker(firstKey) ===
        (resolved.rawMarkerValue || UAT_MARKER_VALUE);
    } else if (prior && lifecyclePorts.spreadsheetApp) {
      var archived = lifecyclePorts.spreadsheetApp.openById(prior.targetSpreadsheetId);
      markerPreserved = readUatRawMarker(archived.getSheetByName('_RAW_HANDLED')) ===
        UAT_MARKER_VALUE;
    }

    var result = Object.freeze({
      activeWeekKey: active.weekKey,
      markerPreserved: markerPreserved,
      pass: next.weekKey === nextKey &&
        active.weekKey === nextKey &&
        prior && prior.status === 'ARCHIVED' &&
        markerPreserved,
      priorStatus: prior ? prior.status : null,
    });
    uatLog('CXP12UatStep06.result', {
      activeWeekKey: result.activeWeekKey,
      markerPreserved: result.markerPreserved,
      pass: result.pass,
      priorStatus: result.priorStatus,
    });
    return result;
  }

  function reinitSafety(ports) {
    var resolved = defaultPorts(ports);
    var lifecyclePorts = resolveHostedLifecyclePorts(resolved);
    var lifecycle = resolveLifecycle().create(lifecyclePorts);
    var configuration = loadConfiguration(resolved);
    var targetId = configuration.targetSpreadsheetId;
    if (!targetId) {
      throw new Error('Active target spreadsheet is required for reinit safety.');
    }
    if (lifecyclePorts.spreadsheetApp && typeof resolved.readActiveRawMarker !== 'function') {
      var target = lifecyclePorts.spreadsheetApp.openById(targetId);
      seedUatRawMarker(target.getSheetByName('_RAW_HANDLED'));
    }
    var beforeMarker = typeof resolved.readActiveRawMarker === 'function'
      ? resolved.readActiveRawMarker()
      : UAT_MARKER_VALUE;
    if (
      typeof resolved.readActiveRawMarker !== 'function' &&
      lifecyclePorts.spreadsheetApp
    ) {
      beforeMarker = readUatRawMarker(
        lifecyclePorts.spreadsheetApp.openById(targetId).getSheetByName('_RAW_HANDLED'),
      );
    }
    var init = lifecycle.initializeWeekControls(targetId, {
      weekKey: resolved.weekKey || FIXTURE_NEXT_WEEK_KEY,
    });
    var afterMarker = beforeMarker;
    if (typeof resolved.readActiveRawMarker === 'function') {
      afterMarker = resolved.readActiveRawMarker();
    } else if (lifecyclePorts.spreadsheetApp) {
      afterMarker = readUatRawMarker(
        lifecyclePorts.spreadsheetApp
          .openById(targetId)
          .getSheetByName('_RAW_HANDLED'),
      );
    }
    var result = Object.freeze({
      liveDataPreserved: init.liveDataPreserved === true && beforeMarker === afterMarker,
      pass: init.liveDataPreserved === true &&
        init.destructive !== true &&
        beforeMarker === afterMarker,
      refusedDestructive: init.code === 'LIFECYCLE_INIT_REFUSED_LIVE_DATA' ||
        init.destructive !== true,
    });
    uatLog('CXP12UatStep07.result', {
      liveDataPreserved: result.liveDataPreserved,
      pass: result.pass,
    });
    return result;
  }

  function evaluateHostedHealth(ports) {
    var resolved = defaultPorts(ports);
    var healthPorts = resolveHostedHealthPorts(resolved);
    var configuration = (resolved.healthOptions && resolved.healthOptions.configuration) ||
      loadConfiguration(resolved);
    if (
      healthPorts.spreadsheetApp &&
      configuration.controlSpreadsheetId &&
      !healthPorts.controlSpreadsheet
    ) {
      healthPorts = Object.assign({}, healthPorts, {
        controlSpreadsheet: healthPorts.spreadsheetApp.openById(
          configuration.controlSpreadsheetId,
        ),
      });
    }
    if (
      healthPorts.spreadsheetApp &&
      configuration.targetSpreadsheetId &&
      !healthPorts.targetSpreadsheet
    ) {
      healthPorts = Object.assign({}, healthPorts, {
        targetSpreadsheet: healthPorts.spreadsheetApp.openById(
          configuration.targetSpreadsheetId,
        ),
      });
    }
    if (healthPorts.controlSpreadsheet && resolved.skipSuccessSeed !== true) {
      seedRecentSuccessRun(healthPorts.controlSpreadsheet);
    }
    return resolveHealthCheck().evaluate(healthPorts, Object.assign({
      configuration: configuration,
      recalcReady: true,
    }, resolved.healthOptions || {}));
  }

  function promotionGate(ports) {
    var resolved = defaultPorts(ports);
    var prerequisites = resolved.prerequisites || verifyPrerequisites(resolved);
    var setup = resolveSetup().getStatus(resolved.properties);
    var health = resolved.health || evaluateHostedHealth(resolved);
    var inventory = resolved.inventory ||
      resolveTriggers().create(resolveHostedTriggerPorts(resolved)).listInventory();
    var checklist = resolvePromotion().evaluate({
      controlConfigured: prerequisites.controlConfigured,
      driveInboxConfigured: resolved.driveInboxConfigured !== false,
      environment: prerequisites.environment,
      healthHealthy: health.healthy === true,
      localVerifyPassed: resolved.localVerifyPassed !== false,
      masterTemplateConfigured: prerequisites.masterTemplateConfigured,
      prodAcknowledged: resolved.prodAcknowledged === true,
      registryHeadersInstalled: setup.status === resolveSetup().SETUP_STATES.COMPLETE,
      singleActiveWeek: resolved.singleActiveWeek !== false,
      targetConfigured: prerequisites.targetConfigured || true,
      triggerInventoryInstalled: inventory.totalMaintenance > 0 &&
        inventory.primaryIngestDetected !== true,
    });
    var result = Object.freeze({
      checklist: checklist,
      pass: checklist.promotionReady === true,
      promotionReady: checklist.promotionReady === true,
    });
    uatLog('CXP12UatStep08.result', {
      missing: checklist.missing,
      pass: result.pass,
      promotionReady: result.promotionReady,
    });
    return result;
  }

  function diagnoseRunbookChecks(ports) {
    var resolved = defaultPorts(ports);
    return Object.freeze({
      health: evaluateHostedHealth(resolved),
      prerequisites: verifyPrerequisites(resolved),
      setup: resolveSetup().getStatus(resolved.properties),
      triggers: resolveTriggers().create(resolveHostedTriggerPorts(resolved)).listInventory(),
    });
  }

  return Object.freeze({
    FIXTURE_NEXT_WEEK_KEY: FIXTURE_NEXT_WEEK_KEY,
    FIXTURE_WEEK_KEY: FIXTURE_WEEK_KEY,
    alignActiveTarget: alignActiveTarget,
    createOrActivateWeek: createOrActivateWeek,
    diagnoseRunbookChecks: diagnoseRunbookChecks,
    healthCheck: healthCheck,
    installRegistry: installRegistry,
    promotionGate: promotionGate,
    reinitSafety: reinitSafety,
    triggerInventory: triggerInventory,
    verifyPrerequisites: verifyPrerequisites,
    weeklyRollover: weeklyRollover,
  });
})();

function CXP12UatStep00VerifyPrerequisites() {
  return Cxp12Uat.verifyPrerequisites();
}
function CXP12UatStep01InstallRegistry() {
  return Cxp12Uat.installRegistry();
}
function CXP12UatStep02CreateOrActivateWeek() {
  return Cxp12Uat.createOrActivateWeek();
}
function CXP12UatStep03AlignActiveTarget() {
  return Cxp12Uat.alignActiveTarget();
}
function CXP12UatStep04HealthCheck() {
  return Cxp12Uat.healthCheck();
}
function CXP12UatStep05TriggerInventory() {
  return Cxp12Uat.triggerInventory();
}
function CXP12UatStep06WeeklyRollover() {
  return Cxp12Uat.weeklyRollover();
}
function CXP12UatStep07ReinitSafety() {
  return Cxp12Uat.reinitSafety();
}
function CXP12UatStep08PromotionGate() {
  return Cxp12Uat.promotionGate();
}
function diagnoseCxp12RunbookChecks() {
  return Cxp12Uat.diagnoseRunbookChecks();
}
function createOrActivateWeeklyWorkbook(weekKeyOrBusinessDay) {
  var lifecycle = WorkbookLifecycleService.create({
    clock: { now: function () { return new Date(); } },
    drive: {
      copyFile: function (templateId, name) {
        var file = DriveApp.getFileById(templateId);
        return { id: file.makeCopy(name).getId() };
      },
    },
    lockService: LockService,
    properties: PropertiesService.getScriptProperties(),
    protectionServices: {
      session: typeof Session !== 'undefined' ? Session : null,
      spreadsheetApp: SpreadsheetApp,
    },
    session: typeof Session !== 'undefined' ? Session : null,
    spreadsheetApp: SpreadsheetApp,
  });
  if (typeof weekKeyOrBusinessDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(weekKeyOrBusinessDay)) {
    try {
      return lifecycle.createOrActivateWeeklyWorkbook({ weekKey: weekKeyOrBusinessDay });
    } catch (error) {
      if (error && error.code === 'LIFECYCLE_WEEK_KEY_INVALID') {
        return lifecycle.createOrActivateWeeklyWorkbook({ businessDay: weekKeyOrBusinessDay });
      }
      throw error;
    }
  }
  return lifecycle.createOrActivateWeeklyWorkbook({});
}
function getActiveWeeklyWorkbook() {
  return WorkbookLifecycleService.create({
    properties: PropertiesService.getScriptProperties(),
    spreadsheetApp: SpreadsheetApp,
  }).getActiveWeeklyWorkbook();
}
function runCxp12HealthCheck() {
  return HealthCheck.evaluate({
    properties: PropertiesService.getScriptProperties(),
    spreadsheetApp: SpreadsheetApp,
  });
}
function installCxp12MaintenanceTriggers() {
  return TriggerController.create({
    properties: PropertiesService.getScriptProperties(),
    scriptApp: ScriptApp,
  }).installMaintenanceTriggers();
}
function listCxp12MaintenanceTriggers() {
  return TriggerController.create({
    properties: PropertiesService.getScriptProperties(),
    scriptApp: ScriptApp,
  }).listInventory();
}

// Maintenance trigger handlers (no primary ingest).
function cxp12Trigger_HEALTH_CHECK() {
  runCxp12HealthCheck();
}
function cxp12Trigger_STALE_DATA() {
  runCxp12HealthCheck();
}
function cxp12Trigger_CLEANUP() {
  listCxp12MaintenanceTriggers();
}
function cxp12Trigger_INBOX_POLL() {
  listCxp12MaintenanceTriggers();
}
function cxp12Trigger_WEEKLY_ROLLOVER() {
  var today = new Date();
  var iso = today.toISOString().slice(0, 10);
  createOrActivateWeeklyWorkbook(iso);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp12Uat;
}
