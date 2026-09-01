var TriggerController = (function () {
  'use strict';

  var INVENTORY_PROPERTY = 'CXP12_TRIGGER_INVENTORY_V1';
  var HANDLER_PREFIX = 'cxp12Trigger_';
  var KINDS = Object.freeze({
    CLEANUP: 'CLEANUP',
    HEALTH_CHECK: 'HEALTH_CHECK',
    INBOX_POLL: 'INBOX_POLL',
    STALE_DATA: 'STALE_DATA',
    WEEKLY_ROLLOVER: 'WEEKLY_ROLLOVER',
  });
  var MAINTENANCE_KINDS = Object.freeze([
    KINDS.HEALTH_CHECK,
    KINDS.STALE_DATA,
    KINDS.CLEANUP,
    KINDS.INBOX_POLL,
    KINDS.WEEKLY_ROLLOVER,
  ]);
  var FORBIDDEN_PRIMARY_INGEST_HANDLERS = Object.freeze([
    'executeIngestion',
    'runHourlyIngestion',
    'commitRawReplacement',
  ]);

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function handlerNameFor(kind) {
    return HANDLER_PREFIX + kind;
  }

  function create(ports) {
    var resolved = ports || {};

    function requireScriptApp() {
      if (
        !resolved.scriptApp ||
        typeof resolved.scriptApp.newTrigger !== 'function' ||
        typeof resolved.scriptApp.getProjectTriggers !== 'function' ||
        typeof resolved.scriptApp.deleteTrigger !== 'function'
      ) {
        throw resolveErrorCodes().create('LIFECYCLE_CONTROL_UNAVAILABLE', {
          details: { reason: 'script_app_triggers_unavailable' },
        });
      }
      return resolved.scriptApp;
    }

    function listProjectTriggers() {
      return requireScriptApp().getProjectTriggers() || [];
    }

    function listInventory() {
      var triggers = listProjectTriggers();
      var byKind = Object.create(null);
      MAINTENANCE_KINDS.forEach(function (kind) {
        byKind[kind] = 0;
      });
      var primaryIngestDetected = false;
      triggers.forEach(function (trigger) {
        var handler = typeof trigger.getHandlerFunction === 'function'
          ? trigger.getHandlerFunction()
          : '';
        MAINTENANCE_KINDS.forEach(function (kind) {
          if (handler === handlerNameFor(kind)) {
            byKind[kind] += 1;
          }
        });
        if (FORBIDDEN_PRIMARY_INGEST_HANDLERS.indexOf(handler) !== -1) {
          primaryIngestDetected = true;
        }
      });
      return Object.freeze({
        kinds: Object.freeze(MAINTENANCE_KINDS.slice()),
        counts: Object.freeze(byKind),
        primaryIngestDetected: primaryIngestDetected,
        totalMaintenance: MAINTENANCE_KINDS.reduce(function (sum, kind) {
          return sum + byKind[kind];
        }, 0),
      });
    }

    function removeMaintenanceTriggers() {
      var scriptApp = requireScriptApp();
      var removed = 0;
      listProjectTriggers().forEach(function (trigger) {
        var handler = typeof trigger.getHandlerFunction === 'function'
          ? trigger.getHandlerFunction()
          : '';
        var isMaintenance = MAINTENANCE_KINDS.some(function (kind) {
          return handler === handlerNameFor(kind);
        });
        if (isMaintenance) {
          scriptApp.deleteTrigger(trigger);
          removed += 1;
        }
      });
      if (resolved.properties && typeof resolved.properties.deleteProperty === 'function') {
        resolved.properties.deleteProperty(INVENTORY_PROPERTY);
      }
      return Object.freeze({ removed: removed });
    }

    function installMaintenanceTriggers(options) {
      var opts = options || {};
      var scriptApp = requireScriptApp();
      var kinds = Array.isArray(opts.kinds) && opts.kinds.length
        ? opts.kinds.slice()
        : MAINTENANCE_KINDS.slice();
      kinds.forEach(function (kind) {
        if (MAINTENANCE_KINDS.indexOf(kind) === -1) {
          throw resolveErrorCodes().create('LIFECYCLE_WEEK_KEY_INVALID', {
            details: { reason: 'unknown_trigger_kind', kind: kind },
          });
        }
      });
      if (opts.replace !== false) {
        removeMaintenanceTriggers();
      }
      var installed = [];
      kinds.forEach(function (kind) {
        var builder = scriptApp.newTrigger(handlerNameFor(kind)).timeBased();
        if (kind === KINDS.WEEKLY_ROLLOVER) {
          // Apps Script requires onWeekDay() with everyWeeks().
          var monday = scriptApp.WeekDay && scriptApp.WeekDay.MONDAY
            ? scriptApp.WeekDay.MONDAY
            : (opts.weekDay || null);
          if (typeof builder.everyWeeks === 'function' && typeof builder.onWeekDay === 'function' && monday) {
            builder.everyWeeks(1).onWeekDay(monday);
            if (typeof builder.atHour === 'function') {
              builder.atHour(typeof opts.rolloverHour === 'number' ? opts.rolloverHour : 6);
            }
          } else if (typeof builder.everyDays === 'function') {
            builder.everyDays(7);
          } else if (typeof builder.everyHours === 'function') {
            builder.everyHours(12);
          } else if (typeof builder.after === 'function') {
            builder.after(7 * 24 * 3600000);
          }
        } else if (typeof builder.everyHours === 'function') {
          builder.everyHours(1);
        } else if (typeof builder.after === 'function') {
          builder.after(3600000);
        }
        builder.create();
        installed.push(kind);
      });
      var inventory = listInventory();
      if (resolved.properties && typeof resolved.properties.setProperty === 'function') {
        resolved.properties.setProperty(
          INVENTORY_PROPERTY,
          JSON.stringify({
            installedAtUtc: new Date().toISOString(),
            kinds: installed,
          }),
        );
      }
      return Object.freeze({
        installed: Object.freeze(installed.slice()),
        inventory: inventory,
        primaryIngestDetected: inventory.primaryIngestDetected,
      });
    }

    return Object.freeze({
      handlerNameFor: handlerNameFor,
      installMaintenanceTriggers: installMaintenanceTriggers,
      listInventory: listInventory,
      removeMaintenanceTriggers: removeMaintenanceTriggers,
    });
  }

  return Object.freeze({
    FORBIDDEN_PRIMARY_INGEST_HANDLERS: FORBIDDEN_PRIMARY_INGEST_HANDLERS,
    HANDLER_PREFIX: HANDLER_PREFIX,
    INVENTORY_PROPERTY: INVENTORY_PROPERTY,
    KINDS: KINDS,
    MAINTENANCE_KINDS: MAINTENANCE_KINDS,
    create: create,
    handlerNameFor: handlerNameFor,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TriggerController;
}
