var WorkbookLifecycleService = (function () {
  'use strict';

  var DEFAULT_LOCK_TIMEOUT_MS = 5000;
  var CONTRACT_VERSION = '1.0.0';
  var DAY_MS = 86400000;

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function resolveConfig() {
    if (typeof Config !== 'undefined') {
      return Config;
    }
    return require('../config/Config.js');
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

  function resolveBusinessContext() {
    if (typeof BusinessContextService !== 'undefined') {
      return BusinessContextService;
    }
    return require('./BusinessContextService.js');
  }

  function resolveWorkbookSkeleton() {
    if (typeof WorkbookSkeleton !== 'undefined') {
      return WorkbookSkeleton;
    }
    return require('./WorkbookSkeleton.js');
  }

  function resolveScriptLock() {
    if (typeof ScriptLock !== 'undefined') {
      return ScriptLock;
    }
    return require('./ScriptLock.js');
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function isoFromUtc(utc) {
    var date = new Date(utc);
    return date.getUTCFullYear() + '-' +
      pad2(date.getUTCMonth() + 1) + '-' +
      pad2(date.getUTCDate());
  }

  function parseIsoDateOnly(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }
    var parts = value.split('-').map(Number);
    var utc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    var date = new Date(utc);
    if (
      date.getUTCFullYear() !== parts[0] ||
      date.getUTCMonth() !== parts[1] - 1 ||
      date.getUTCDate() !== parts[2]
    ) {
      return null;
    }
    return Object.freeze({ iso: value, utc: utc });
  }

  function mondayForIso(isoDate) {
    var parsed = parseIsoDateOnly(isoDate);
    if (!parsed) {
      throw resolveErrorCodes().create('LIFECYCLE_WEEK_KEY_INVALID', {
        details: { value: isoDate },
      });
    }
    var dayOfWeek = new Date(parsed.utc).getUTCDay();
    var daysSinceMonday = (dayOfWeek + 6) % 7;
    return isoFromUtc(parsed.utc - daysSinceMonday * DAY_MS);
  }

  function assertMondayWeekKey(weekKey) {
    var parsed = parseIsoDateOnly(weekKey);
    if (!parsed) {
      throw resolveErrorCodes().create('LIFECYCLE_WEEK_KEY_INVALID', {
        details: { value: weekKey },
      });
    }
    if (new Date(parsed.utc).getUTCDay() !== 1) {
      throw resolveErrorCodes().create('LIFECYCLE_WEEK_KEY_INVALID', {
        details: { reason: 'not_monday', value: weekKey },
      });
    }
    return weekKey;
  }

  function resolveWeekKey(input) {
    if (input && typeof input.weekKey === 'string') {
      return assertMondayWeekKey(input.weekKey.trim());
    }
    if (input && typeof input.businessDay === 'string') {
      return assertMondayWeekKey(mondayForIso(input.businessDay.trim()));
    }
    throw resolveErrorCodes().create('LIFECYCLE_WEEK_KEY_INVALID', {
      details: { reason: 'missing_week_key_or_business_day' },
    });
  }

  function nowIso(ports) {
    var value = ports.clock && typeof ports.clock.now === 'function'
      ? ports.clock.now()
      : new Date();
    var date = value instanceof Date ? value : new Date(value);
    return date.toISOString();
  }

  function requireTemplateId(configuration) {
    if (!configuration.masterTemplateSpreadsheetId) {
      throw resolveErrorCodes().create('LIFECYCLE_TEMPLATE_NOT_CONFIGURED');
    }
    return configuration.masterTemplateSpreadsheetId;
  }

  function setTargetProperty(ports, configuration, targetId) {
    var key = resolveConfig().propertyKey(
      configuration.environment,
      resolveConfig().CONFIGURATION_KEYS.targetSpreadsheetId,
    );
    if (!ports.properties || typeof ports.properties.setProperty !== 'function') {
      throw resolveErrorCodes().create('LIFECYCLE_ACTIVE_TARGET_MISMATCH', {
        details: { reason: 'properties_unavailable' },
      });
    }
    ports.properties.setProperty(key, targetId);
  }

  function copyTemplate(ports, templateId, weekKey) {
    if (!ports.drive || typeof ports.drive.copyFile !== 'function') {
      throw resolveErrorCodes().create('LIFECYCLE_TEMPLATE_UNREADABLE', {
        details: { reason: 'drive_copy_unavailable' },
      });
    }
    try {
      var copied = ports.drive.copyFile(templateId, 'CXP Weekly ' + weekKey);
      if (!copied || !copied.id) {
        throw new Error('copy returned no id');
      }
      return copied.id;
    } catch (error) {
      throw resolveErrorCodes().create('LIFECYCLE_TEMPLATE_UNREADABLE', {
        cause: error,
        details: { reason: 'copy_failed' },
      });
    }
  }

  function openSpreadsheet(ports, spreadsheetId) {
    if (!ports.spreadsheetApp || typeof ports.spreadsheetApp.openById !== 'function') {
      throw resolveErrorCodes().create('LIFECYCLE_TEMPLATE_UNREADABLE', {
        details: { reason: 'spreadsheet_app_unavailable' },
      });
    }
    try {
      return ports.spreadsheetApp.openById(spreadsheetId);
    } catch (error) {
      throw resolveErrorCodes().create('LIFECYCLE_TEMPLATE_UNREADABLE', {
        cause: error,
        details: { reason: 'open_failed' },
      });
    }
  }

  function ensureSkeleton(ports, spreadsheet) {
    if (typeof ports.ensureTarget === 'function') {
      return ports.ensureTarget(spreadsheet);
    }
    var sheetNames = resolveSheetNames();
    var skeleton = resolveWorkbookSkeleton();
    var services = ports.protectionServices || {
      session: ports.session || null,
      spreadsheetApp: ports.spreadsheetApp || null,
    };
    return skeleton.initialize(
      spreadsheet,
      sheetNames.targetAll(),
      sheetNames.BUSINESS_TIME_ZONE,
      sheetNames.targetBackend(),
      services,
    );
  }

  function seedWeekControls(ports, spreadsheet, weekKey) {
    if (ports.seedBusinessContext === false) {
      return null;
    }
    var businessContext = resolveBusinessContext();
    if (typeof businessContext.write !== 'function') {
      return null;
    }
    try {
      return businessContext.write(spreadsheet, {
        businessDay: weekKey,
        staffDay: weekKey,
      });
    } catch (error) {
      // Report sheets may be absent on a bare template; ensure-only lifecycle continues.
      return Object.freeze({
        skipped: true,
        reason: error && error.code ? error.code : 'BUSINESS_CONTEXT_SKIPPED',
      });
    }
  }

  function hasLiveRawData(spreadsheet) {
    var sheetNames = resolveSheetNames();
    for (var index = 0; index < sheetNames.TARGET.raw.length; index += 1) {
      var sheet = spreadsheet.getSheetByName(sheetNames.TARGET.raw[index]);
      if (sheet && typeof sheet.getLastRow === 'function' && sheet.getLastRow() > 1) {
        return true;
      }
    }
    return false;
  }

  function create(ports) {
    var resolvedPorts = ports || {};

    function withOptionalLock(work) {
      if (!resolvedPorts.lockService) {
        return work();
      }
      return resolveScriptLock().withLock(
        resolvedPorts.lockService,
        resolvedPorts.lockTimeoutMs || DEFAULT_LOCK_TIMEOUT_MS,
        null,
        work,
      );
    }

    function refuseIfLocked() {
      if (typeof resolvedPorts.isIngestionActive === 'function' &&
          resolvedPorts.isIngestionActive() === true) {
        throw resolveErrorCodes().create('LIFECYCLE_ROLLOVER_LOCKED');
      }
    }

    function getActiveWeeklyWorkbook(configuration) {
      var config = configuration || resolveConfig().load(resolvedPorts.properties);
      var control = openSpreadsheet(resolvedPorts, config.controlSpreadsheetId);
      var registry = resolveWeekRegistry().create(control);
      var active = registry.findActive();
      var aligned = Boolean(
        active &&
        config.targetSpreadsheetId &&
        active.targetSpreadsheetId === config.targetSpreadsheetId,
      );
      if (active && config.targetSpreadsheetId && !aligned) {
        throw resolveErrorCodes().create('LIFECYCLE_ACTIVE_TARGET_MISMATCH', {
          details: { weekKey: active.weekKey },
        });
      }
      return Object.freeze({
        active: active,
        aligned: aligned,
        environment: config.environment,
        weekKey: active ? active.weekKey : null,
      });
    }

    function initializeWeekControls(spreadsheetId, options) {
      var opts = options || {};
      var spreadsheet = openSpreadsheet(resolvedPorts, spreadsheetId);
      if (opts.allowDestructive !== true && hasLiveRawData(spreadsheet)) {
        if (opts.forceDestructive === true) {
          throw resolveErrorCodes().create('LIFECYCLE_INIT_REFUSED_LIVE_DATA');
        }
        var ensured = ensureSkeleton(resolvedPorts, spreadsheet);
        return Object.freeze({
          code: 'LIFECYCLE_INIT_REFUSED_LIVE_DATA',
          createdSheets: ensured.createdSheets,
          destructive: false,
          existingSheets: ensured.existingSheets,
          liveDataPreserved: true,
        });
      }
      var result = ensureSkeleton(resolvedPorts, spreadsheet);
      var context = null;
      if (opts.weekKey) {
        context = seedWeekControls(resolvedPorts, spreadsheet, assertMondayWeekKey(opts.weekKey));
      }
      return Object.freeze({
        businessContext: context,
        createdSheets: result.createdSheets,
        destructive: false,
        existingSheets: result.existingSheets,
        liveDataPreserved: true,
      });
    }

    function createOrActivateWeeklyWorkbook(input, configuration) {
      return withOptionalLock(function () {
        refuseIfLocked();
        var config = configuration || resolveConfig().load(resolvedPorts.properties);
        if (!config.controlSpreadsheetId) {
          throw resolveErrorCodes().create('LIFECYCLE_CONTROL_UNAVAILABLE', {
            details: { reason: 'control_not_configured' },
          });
        }
        var weekKey = resolveWeekKey(input || {});
        var templateId = requireTemplateId(config);
        var control = openSpreadsheet(resolvedPorts, config.controlSpreadsheetId);
        var registry = resolveWeekRegistry().create(control);
        var existing = registry.findByWeekKey(weekKey);
        var statuses = resolveWeekRegistry().STATUSES;

        if (
          existing &&
          (existing.status === statuses.ACTIVE || existing.status === statuses.FAILED) &&
          existing.targetSpreadsheetId
        ) {
          try {
            openSpreadsheet(resolvedPorts, existing.targetSpreadsheetId);
          } catch (error) {
            existing = null;
          }
        }

        if (existing && existing.status === statuses.ACTIVE) {
          setTargetProperty(resolvedPorts, config, existing.targetSpreadsheetId);
          return Object.freeze({
            code: 'LIFECYCLE_ALREADY_ACTIVE',
            created: false,
            idempotent: true,
            record: existing,
            weekKey: weekKey,
          });
        }

        var targetId;
        var created = false;
        if (existing && existing.status === statuses.FAILED && existing.targetSpreadsheetId) {
          targetId = existing.targetSpreadsheetId;
        } else {
          targetId = copyTemplate(resolvedPorts, templateId, weekKey);
          created = true;
        }

        var target = openSpreadsheet(resolvedPorts, targetId);
        ensureSkeleton(resolvedPorts, target);
        seedWeekControls(resolvedPorts, target, weekKey);

        var timestamp = nowIso(resolvedPorts);
        registry.archiveActive(weekKey, 'archived_on_activate:' + weekKey);
        if (existing && existing.status === statuses.ACTIVE && existing.weekKey === weekKey) {
          registry.setStatus(weekKey, statuses.SUPERSEDED, 'superseded_same_week', existing.activatedAtUtc);
        }

        var record = registry.upsert({
          activatedAtUtc: timestamp,
          masterTemplateSpreadsheetId: templateId,
          notes: created ? 'created_from_template' : 'reactivated',
          registeredAtUtc: existing && existing.registeredAtUtc
            ? existing.registeredAtUtc
            : timestamp,
          status: statuses.ACTIVE,
          targetSpreadsheetId: targetId,
          weekKey: weekKey,
        });
        setTargetProperty(resolvedPorts, config, targetId);

        return Object.freeze({
          created: created,
          idempotent: false,
          record: record,
          weekKey: weekKey,
        });
      });
    }

    function archiveWeeklyWorkbook(weekKey, configuration) {
      return withOptionalLock(function () {
        var config = configuration || resolveConfig().load(resolvedPorts.properties);
        var control = openSpreadsheet(resolvedPorts, config.controlSpreadsheetId);
        var registry = resolveWeekRegistry().create(control);
        var key = assertMondayWeekKey(weekKey);
        var active = registry.findActive();
        if (active && active.weekKey === key &&
            config.targetSpreadsheetId === active.targetSpreadsheetId) {
          throw resolveErrorCodes().create('LIFECYCLE_ACTIVE_TARGET_MISMATCH', {
            details: { reason: 'cannot_archive_configured_active', weekKey: key },
          });
        }
        return registry.setStatus(
          key,
          resolveWeekRegistry().STATUSES.ARCHIVED,
          'manual_archive',
        );
      });
    }

    function alignActiveTarget(configuration) {
      var config = configuration || resolveConfig().load(resolvedPorts.properties);
      var snapshot = getActiveWeeklyWorkbook(config);
      if (!snapshot.active) {
        throw resolveErrorCodes().create('LIFECYCLE_ACTIVE_TARGET_MISMATCH', {
          details: { reason: 'no_active_row' },
        });
      }
      setTargetProperty(resolvedPorts, config, snapshot.active.targetSpreadsheetId);
      return Object.freeze({
        aligned: true,
        weekKey: snapshot.active.weekKey,
      });
    }

    return Object.freeze({
      alignActiveTarget: alignActiveTarget,
      archiveWeeklyWorkbook: archiveWeeklyWorkbook,
      createOrActivateWeeklyWorkbook: createOrActivateWeeklyWorkbook,
      getActiveWeeklyWorkbook: getActiveWeeklyWorkbook,
      initializeWeekControls: initializeWeekControls,
      resolveWeekKey: resolveWeekKey,
    });
  }

  return Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    assertMondayWeekKey: assertMondayWeekKey,
    create: create,
    mondayForIso: mondayForIso,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorkbookLifecycleService;
}
