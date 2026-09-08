/** Hosted CXP-14 protection, domain, stamp, rollback, and checklist observations. No IDs or emails. */
var Cxp14HostedGates = (function () {
  'use strict';

  function resolve(name, path) {
    if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name];
    if (typeof require === 'function') return require(path);
    return null;
  }

  function check(runtime, name, fallback) {
    if (!runtime || !runtime.checks || typeof runtime.checks[name] !== 'function') return fallback === true;
    try { return runtime.checks[name]() === true; } catch (_error) { return false; }
  }

  function hosted() {
    return typeof SpreadsheetApp !== 'undefined';
  }

  function inspectStamp() {
    var stamp = resolve('Cxp14CriticalPathStamp', '../release/Cxp14CriticalPathStamp.js');
    return Boolean(stamp && stamp.pass === true && stamp.contractVersion === 1);
  }

  function inspectAllowlist() {
    var evidence = resolve('Cxp14ReleaseEvidence', '../release/Cxp14ReleaseEvidence.js');
    return Boolean(
      evidence &&
      Array.isArray(evidence.UAT_KEYS) &&
      Array.isArray(evidence.PERFORMANCE_KEYS) &&
      evidence.PERFORMANCE_KEYS.indexOf('serviceCallCounts') !== -1 &&
      evidence.UAT_KEYS.indexOf('prodAcknowledged') !== -1,
    );
  }

  function inspectDomain(configuration) {
    return Boolean(configuration && typeof configuration.rtaAllowedDomain === 'string' && configuration.rtaAllowedDomain.trim());
  }

  function inspectUnauthorized(runtime) {
    if (check(runtime, 'unauthorizedDenied', false)) return true;
    var intake = resolve('RtaIntakeService', '../services/RtaIntakeService.js');
    if (!intake || typeof intake.authorize !== 'function') return false;
    try {
      intake.authorize({ session: { getActiveUser: function () { return { getEmail: function () { return ''; } }; } } }, runtime.configuration || {});
      return false;
    } catch (error) {
      return Boolean(error && error.code === 'INGESTION_UNAUTHORIZED_ACTOR');
    }
  }

  function inspectProdForbidden(runtime) {
    return Boolean(runtime && runtime.configuration && runtime.configuration.environment !== 'PROD');
  }

  function sheetProtected(sheet, helpers, protectionType) {
    if (!sheet || typeof sheet.getProtections !== 'function') return false;
    try {
      var protections = sheet.getProtections(protectionType);
      if (!protections || !protections.length) return false;
      if (helpers && helpers.DESCRIPTION_PREFIX) {
        return protections.some(function (protection) {
          return protection && typeof protection.getDescription === 'function' &&
            String(protection.getDescription() || '').indexOf(helpers.DESCRIPTION_PREFIX) === 0;
        });
      }
      return protections.length > 0;
    } catch (_error) {
      return false;
    }
  }

  function inspectProtections(runtime) {
    if (check(runtime, 'protectionsIntact', false)) return true;
    if (!hosted() || !runtime || !runtime.configuration) return false;
    var helpers = resolve('ProtectionHelpers', '../services/ProtectionHelpers.js');
    var sheets = resolve('SheetNames', '../config/SheetNames.js');
    var spreadsheetApp = typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp : null;
    var session = typeof Session !== 'undefined' ? Session : null;
    if (!helpers || !sheets || !spreadsheetApp || typeof spreadsheetApp.openById !== 'function') return false;
    try {
      var protectionType = spreadsheetApp.ProtectionType && spreadsheetApp.ProtectionType.SHEET;
      var control = spreadsheetApp.openById(runtime.configuration.controlSpreadsheetId);
      var target = spreadsheetApp.openById(runtime.configuration.targetSpreadsheetId);
      var controlOk = sheets.CONTROL.every(function (name) {
        return sheetProtected(control.getSheetByName(name), helpers, protectionType);
      });
      var backendOk = sheets.targetBackend().every(function (name) {
        return sheetProtected(target.getSheetByName(name), helpers, protectionType);
      });
      return controlOk && backendOk;
    } catch (_error) {
      return false;
    }
  }

  function inspectTriggers(runtime) {
    if (check(runtime, 'triggersMaintenanceOnly', false)) return true;
    if (!hosted()) return false;
    var controller = resolve('TriggerController', '../services/TriggerController.js');
    if (!controller || typeof controller.create !== 'function') return false;
    try {
      var inventory = controller.create({
        properties: runtime.properties,
        scriptApp: typeof ScriptApp !== 'undefined' ? ScriptApp : null,
      }).listInventory();
      return Boolean(inventory && inventory.primaryIngestDetected !== true);
    } catch (_error) {
      return false;
    }
  }

  function inspectHealth(runtime) {
    if (check(runtime, 'healthHealthy', false)) return true;
    var pred = runtime && runtime.predecessors && runtime.predecessors.cxp12;
    if (pred && typeof pred.step04 === 'function') {
      try {
        var health = pred.step04();
        return Boolean(health && (health.pass === true || (health.health && health.health.healthy === true)));
      } catch (_error) {
        return false;
      }
    }
    return false;
  }

  function inspectActiveAligned(runtime) {
    if (check(runtime, 'activeWeekKeyAligned', false)) return true;
    var pred = runtime && runtime.predecessors && runtime.predecessors.cxp12;
    if (pred && typeof pred.step03 === 'function') {
      try {
        var aligned = pred.step03();
        return Boolean(aligned && aligned.pass === true);
      } catch (_error) {
        return false;
      }
    }
    return Boolean(runtime && runtime.configuration && runtime.configuration.environment === 'UAT');
  }

  function inspectRollback(runtime) {
    if (check(runtime, 'rollbackRehearsed', false)) return true;
    var telemetry = resolve('Cxp13IngestionTelemetry', '../ingestion/Cxp13IngestionTelemetry.js');
    if (telemetry && runtime && runtime.properties) {
      var bag = telemetry.snapshot(runtime.properties);
      if (bag && bag.lastKnownGoodPreserved === false) return false;
    }
    var pred = runtime && runtime.predecessors && runtime.predecessors.cxp13;
    if (pred && typeof pred.rollbackObserved === 'function') {
      try { return pred.rollbackObserved() === true; } catch (_error) { return false; }
    }
    if (runtime && runtime.properties && typeof runtime.properties.getProperty === 'function') {
      try {
        var raw = runtime.properties.getProperty('CXP13_UAT_EVIDENCE_V1');
        var parsed = raw ? JSON.parse(raw) : null;
        if (parsed && parsed.rollbackPreserved === true) return true;
      } catch (_error) {
        return false;
      }
    }
    return false;
  }

  function inspectCriticalPaths(runtime) {
    if (check(runtime, 'criticalPaths', false)) return true;
    return inspectStamp() && inspectAllowlist() && inspectProtections(runtime);
  }

  function inspectPermissions(runtime) {
    if (check(runtime, 'permissionsVerified', false)) return true;
    return inspectProtections(runtime) && inspectDomain(runtime.configuration) &&
      inspectUnauthorized(runtime) && inspectProdForbidden(runtime);
  }

  function inspectChecklist(runtime, evidence, peakComplete, parityPass) {
    if (check(runtime, 'deploymentChecklistComplete', false)) return true;
    var identityReady = Boolean(evidence && evidence.contractVersion && evidence.releaseVersion && evidence.sourceBundleDigest);
    return identityReady && inspectProdForbidden(runtime) && inspectActiveAligned(runtime) &&
      inspectHealth(runtime) && inspectTriggers(runtime) && peakComplete === true && parityPass === true;
  }

  return Object.freeze({
    inspectActiveAligned: inspectActiveAligned,
    inspectAllowlist: inspectAllowlist,
    inspectChecklist: inspectChecklist,
    inspectCriticalPaths: inspectCriticalPaths,
    inspectDomain: inspectDomain,
    inspectHealth: inspectHealth,
    inspectPermissions: inspectPermissions,
    inspectProdForbidden: inspectProdForbidden,
    inspectProtections: inspectProtections,
    inspectRollback: inspectRollback,
    inspectStamp: inspectStamp,
    inspectTriggers: inspectTriggers,
    inspectUnauthorized: inspectUnauthorized,
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Cxp14HostedGates;
