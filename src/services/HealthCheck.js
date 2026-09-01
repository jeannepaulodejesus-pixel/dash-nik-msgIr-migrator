var HealthCheck = (function () {
  'use strict';

  var DEFAULT_STALE_THRESHOLD_MINUTES = 90;
  var TERMINAL_FAILURE_PREFIX = 'FAILED_';

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function resolveSheetNames() {
    if (typeof SheetNames !== 'undefined') {
      return SheetNames;
    }
    return require('../config/SheetNames.js');
  }

  function resolveWeekRegistry() {
    if (typeof WeekRegistryRepository !== 'undefined') {
      return WeekRegistryRepository;
    }
    return require('../repository/WeekRegistryRepository.js');
  }

  function resolveConfig() {
    if (typeof Config !== 'undefined') {
      return Config;
    }
    return require('../config/Config.js');
  }

  function parseThreshold(raw) {
    if (raw === null || raw === undefined || raw === '') {
      return DEFAULT_STALE_THRESHOLD_MINUTES;
    }
    var value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      return DEFAULT_STALE_THRESHOLD_MINUTES;
    }
    return value;
  }

  function listMissingSheets(spreadsheet) {
    var required = resolveSheetNames().targetAll();
    var missing = [];
    for (var index = 0; index < required.length; index += 1) {
      if (!spreadsheet.getSheetByName(required[index])) {
        missing.push(required[index]);
      }
    }
    return missing;
  }

  function readLastRun(controlSpreadsheet) {
    var sheet = controlSpreadsheet.getSheetByName('RUN_LOG');
    if (!sheet || sheet.getLastRow() < 2) {
      return null;
    }
    var width = 13;
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
    if (!rows.length) {
      return null;
    }
    var last = rows[rows.length - 1];
    return Object.freeze({
      endedAtUtc: last[2] || null,
      runId: last[0] || null,
      status: last[10] || null,
    });
  }

  function ageMinutes(endedAtUtc, now) {
    if (!endedAtUtc) {
      return null;
    }
    var ended = new Date(endedAtUtc);
    if (Number.isNaN(ended.getTime())) {
      return null;
    }
    return Math.floor((now.getTime() - ended.getTime()) / 60000);
  }

  function evaluate(ports, options) {
    var resolved = ports || {};
    var opts = options || {};
    var config = opts.configuration || resolveConfig().load(resolved.properties);
    var now = resolved.clock && typeof resolved.clock.now === 'function'
      ? resolved.clock.now()
      : new Date();
    var nowDate = now instanceof Date ? now : new Date(now);
    var codes = [];
    var control = resolved.controlSpreadsheet;
    var target = resolved.targetSpreadsheet;
    var threshold = parseThreshold(
      opts.staleDataThresholdMinutes !== undefined
        ? opts.staleDataThresholdMinutes
        : config.staleDataThresholdMinutes,
    );

    if (!control && resolved.spreadsheetApp && config.controlSpreadsheetId) {
      control = resolved.spreadsheetApp.openById(config.controlSpreadsheetId);
    }
    if (!target && resolved.spreadsheetApp && config.targetSpreadsheetId) {
      target = resolved.spreadsheetApp.openById(config.targetSpreadsheetId);
    }

    var active = null;
    var aligned = false;
    if (control) {
      try {
        active = resolveWeekRegistry().create(control).findActive();
      } catch (error) {
        codes.push('LIFECYCLE_CONTROL_UNAVAILABLE');
      }
    } else {
      codes.push('LIFECYCLE_CONTROL_UNAVAILABLE');
    }

    if (active && config.targetSpreadsheetId) {
      aligned = active.targetSpreadsheetId === config.targetSpreadsheetId;
      if (!aligned) {
        codes.push('LIFECYCLE_ACTIVE_TARGET_MISMATCH');
      }
    } else if (active && !config.targetSpreadsheetId) {
      codes.push('LIFECYCLE_ACTIVE_TARGET_MISMATCH');
    }

    var missingSheets = [];
    if (target) {
      missingSheets = listMissingSheets(target);
      if (missingSheets.length > 0) {
        codes.push('HEALTH_MISSING_SHEETS');
      }
    } else {
      codes.push('HEALTH_MISSING_SHEETS');
      missingSheets = resolveSheetNames().targetAll().slice();
    }

    var lastRun = control ? readLastRun(control) : null;
    var lastRunState = lastRun && lastRun.status ? lastRun.status : 'NONE';
    var lastSuccessAgeMinutes = null;
    var stale = false;
    if (lastRun && typeof lastRunState === 'string' &&
        lastRunState.indexOf(TERMINAL_FAILURE_PREFIX) === 0) {
      codes.push('HEALTH_LAST_RUN_FAILED');
    }
    if (lastRun && lastRunState === 'SUCCESS') {
      lastSuccessAgeMinutes = ageMinutes(lastRun.endedAtUtc, nowDate);
      if (lastSuccessAgeMinutes !== null && lastSuccessAgeMinutes > threshold) {
        stale = true;
        codes.push('HEALTH_STALE_DATA');
      }
    } else {
      // No successful terminal run in the latest row — treat as stale freshness.
      stale = true;
      codes.push('HEALTH_STALE_DATA');
    }

    var recalcReady = opts.recalcReady;
    if (recalcReady === undefined) {
      recalcReady = typeof resolved.recalcReady === 'boolean'
        ? resolved.recalcReady
        : missingSheets.length === 0;
    }
    if (recalcReady !== true) {
      codes.push('HEALTH_RECALC_NOT_READY');
    }

    var uniqueCodes = [];
    codes.forEach(function (code) {
      if (uniqueCodes.indexOf(code) === -1) {
        uniqueCodes.push(code);
      }
    });

    return Object.freeze({
      activeWeekKey: active ? active.weekKey : null,
      codes: Object.freeze(uniqueCodes.slice()),
      healthy: uniqueCodes.length === 0,
      lastRunState: lastRunState,
      lastSuccessAgeMinutes: lastSuccessAgeMinutes,
      missingSheets: Object.freeze(missingSheets.slice()),
      recalcReady: recalcReady === true,
      registryPropertyAligned: aligned,
      stale: stale === true,
      staleThresholdMinutes: threshold,
    });
  }

  return Object.freeze({
    DEFAULT_STALE_THRESHOLD_MINUTES: DEFAULT_STALE_THRESHOLD_MINUTES,
    evaluate: evaluate,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HealthCheck;
}
