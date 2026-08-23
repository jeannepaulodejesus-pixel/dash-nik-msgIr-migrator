var BackupRepository = (function () {
  'use strict';

  var NAME_PREFIX = '_CXP06_BAK_';
  var PROTECTION_PREFIX = 'CXP-06 backup protection:';
  var TOKEN_BY_DATASET = Object.freeze({
    'AHT - Raw': 'AHT',
    'Auxes - Raw': 'AUXES',
    Handled: 'HANDLED',
    Offered: 'OFFERED',
    Staff: 'STAFF',
  });
  var DATASET_BY_TOKEN = Object.freeze({
    AHT: 'AHT - Raw',
    AUXES: 'Auxes - Raw',
    HANDLED: 'Handled',
    OFFERED: 'Offered',
    STAFF: 'Staff',
  });

  function resolveDatasetSheets() {
    if (typeof DatasetSheets !== 'undefined') {
      return DatasetSheets;
    }
    return require('../config/DatasetSheets.js');
  }

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function resolveCodec() {
    if (typeof SheetValueCodec !== 'undefined') {
      return SheetValueCodec;
    }
    return require('../services/SheetValueCodec.js');
  }

  function editorEmail(editor) {
    return editor && typeof editor.getEmail === 'function' ? editor.getEmail() : '';
  }

  function backupName(datasetName, runId) {
    return NAME_PREFIX + TOKEN_BY_DATASET[datasetName] + '_' + runId;
  }

  function requireRunId(runId) {
    if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(runId)) {
      throw new Error('Backup run ID contains unsupported sheet-name characters.');
    }
    resolveDatasetSheets().listBindings().forEach(function (binding) {
      if (backupName(binding.datasetName, runId).length > 100) {
        throw new Error('Backup run ID exceeds the sheet-name limit.');
      }
    });
  }

  function create(spreadsheet, services) {
    var dependencies = services || {};

    function protectionContext() {
      if (
        !dependencies.spreadsheetApp ||
        !dependencies.spreadsheetApp.ProtectionType ||
        dependencies.spreadsheetApp.ProtectionType.SHEET === undefined ||
        !dependencies.session ||
        typeof dependencies.session.getEffectiveUser !== 'function'
      ) {
        throw new Error('Backup protection services are unavailable.');
      }
      var effectiveUser = dependencies.session.getEffectiveUser();
      var effectiveEmail = editorEmail(effectiveUser);
      if (!effectiveUser || !effectiveEmail) {
        throw new Error('Backup protection requires an effective user email.');
      }
      return {
        effectiveEmail: effectiveEmail,
        effectiveUser: effectiveUser,
        type: dependencies.spreadsheetApp.ProtectionType.SHEET,
      };
    }

    function rawEntries() {
      if (
        !spreadsheet ||
        typeof spreadsheet.getSheetByName !== 'function' ||
        typeof spreadsheet.getSheets !== 'function'
      ) {
        throw new Error('Target spreadsheet is unavailable.');
      }
      return resolveDatasetSheets().listBindings().map(function (binding) {
        var sheet = spreadsheet.getSheetByName(binding.rawSheetName);
        if (!sheet) {
          throw new Error('A required raw sheet is unavailable for backup.');
        }
        var range = sheet.getDataRange();
        var formulas = range.getFormulas();
        if (formulas.some(function (row) {
          return row.some(function (formula) { return Boolean(formula); });
        })) {
          throw new Error('Raw formulas are not eligible for backup.');
        }
        return {
          binding: binding,
          formulas: formulas,
          sheet: sheet,
          values: range.getValues(),
        };
      });
    }

    function normalizeProtection(sheet) {
      var context = protectionContext();
      var existing = sheet.getProtections(context.type);
      existing.forEach(function (protection) {
        if (typeof protection.canEdit === 'function' && !protection.canEdit()) {
          throw new Error('Copied backup protection cannot be normalized.');
        }
        protection.remove();
      });
      var protection = sheet.protect().setDescription(
        PROTECTION_PREFIX + ' ' + sheet.getName(),
      );
      protection.setWarningOnly(false);
      protection.addEditor(context.effectiveUser);
      var otherEditors = protection.getEditors().filter(function (editor) {
        return editorEmail(editor) !== context.effectiveEmail;
      });
      if (otherEditors.length > 0) {
        protection.removeEditors(otherEditors);
      }
      if (typeof protection.getTargetAudiences === 'function') {
        protection.getTargetAudiences().forEach(function (audienceId) {
          protection.removeTargetAudience(audienceId);
        });
      }
      if (protection.canDomainEdit()) {
        protection.setDomainEdit(false);
      }
      protection.setUnprotectedRanges([]);
    }

    function sheetReference(sheet, datasetName, token) {
      var reference = {
        datasetName: datasetName,
        sheetId: typeof sheet.getSheetId === 'function' ? sheet.getSheetId() : null,
        sheetName: sheet.getName(),
        token: token,
      };
      Object.defineProperties(reference, {
        getName: { value: function () { return sheet.getName(); } },
        getProtections: { value: function (type) { return sheet.getProtections(type); } },
        hidden: { get: function () { return sheet.hidden === undefined ? true : sheet.hidden; } },
      });
      return Object.freeze(reference);
    }

    function discoverGroups() {
      try {
        var groupsByRunId = Object.create(null);
        spreadsheet.getSheets().forEach(function (sheet) {
          var name = sheet.getName();
          if (name.indexOf(NAME_PREFIX) !== 0) {
            return;
          }
          var match = /^_CXP06_BAK_(HANDLED|OFFERED|AHT|AUXES|STAFF)_([A-Za-z0-9_-]+)$/.exec(name);
          if (!match) {
            throw new Error('A malformed CXP-06 backup sheet name was found.');
          }
          var token = match[1];
          var runId = match[2];
          var datasetName = DATASET_BY_TOKEN[token];
          var group = groupsByRunId[runId] || {
            runId: runId,
            sheetsByDataset: {},
            token: runId,
          };
          if (group.sheetsByDataset[datasetName]) {
            throw new Error('A duplicate backup dataset token was found.');
          }
          group.sheetsByDataset[datasetName] = sheetReference(sheet, datasetName, token);
          groupsByRunId[runId] = group;
        });
        return Object.freeze(Object.keys(groupsByRunId).sort().map(function (runId) {
          var group = groupsByRunId[runId];
          return Object.freeze({
            complete: Object.keys(group.sheetsByDataset).length === 5,
            runId: group.runId,
            sheetsByDataset: Object.freeze(group.sheetsByDataset),
            token: group.token,
          });
        }));
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'MIGRATION_RECOVERY_FAILED');
      }
    }

    function readGroup(group) {
      if (!group || !group.sheetsByDataset) {
        throw resolveErrorCodes().create('MIGRATION_RECOVERY_FAILED', {
          details: { reason: 'backup_group_unavailable' },
        });
      }
      return Object.freeze(resolveDatasetSheets().listBindings().filter(function (binding) {
        return Boolean(group.sheetsByDataset[binding.datasetName]);
      }).map(function (binding) {
        var reference = group.sheetsByDataset[binding.datasetName];
        var sheet = spreadsheet.getSheetByName(reference.sheetName);
        if (!sheet) {
          throw resolveErrorCodes().create('MIGRATION_RECOVERY_FAILED', {
            details: { datasetName: binding.datasetName, reason: 'backup_sheet_missing' },
          });
        }
        var range = sheet.getDataRange();
        return Object.freeze({
          datasetName: binding.datasetName,
          formulas: range.getFormulas(),
          sheetName: reference.sheetName,
          values: range.getValues(),
        });
      }));
    }

    function deleteGroup(group) {
      if (!group || !group.sheetsByDataset || typeof spreadsheet.deleteSheet !== 'function') {
        throw resolveErrorCodes().create('MIGRATION_RECOVERY_FAILED', {
          details: { reason: 'backup_group_unavailable' },
        });
      }
      resolveDatasetSheets().listBindings().forEach(function (binding) {
        var reference = group.sheetsByDataset[binding.datasetName];
        if (!reference) {
          return;
        }
        var sheet = spreadsheet.getSheetByName(reference.sheetName);
        if (sheet) {
          spreadsheet.deleteSheet(sheet);
        }
      });
      return Object.freeze({ deletedCount: Object.keys(group.sheetsByDataset).length });
    }

    function createGroup(runId) {
      try {
        requireRunId(runId);
        if (discoverGroups().some(function (group) { return group.runId === runId; })) {
          throw new Error('A backup group already exists for this run.');
        }
        var entries = rawEntries();
        entries.forEach(function (entry) {
          var copy = entry.sheet.copyTo(spreadsheet);
          copy.setName(backupName(entry.binding.datasetName, runId));
          copy.hideSheet();
          normalizeProtection(copy);
        });
        var group = discoverGroups().filter(function (candidate) {
          return candidate.runId === runId;
        })[0];
        if (!group || !group.complete) {
          throw new Error('The backup group is incomplete.');
        }
        var snapshots = readGroup(group);
        entries.forEach(function (entry, index) {
          if (
            !resolveCodec().matricesEqual(entry.values, snapshots[index].values) ||
            !resolveCodec().matricesEqual(entry.formulas, snapshots[index].formulas)
          ) {
            throw new Error('A copied backup does not match its raw source.');
          }
        });
        return group;
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'MIGRATION_BACKUP_FAILED');
      }
    }

    return Object.freeze({
      createGroup: createGroup,
      deleteGroup: deleteGroup,
      discoverGroups: discoverGroups,
      readGroup: readGroup,
    });
  }

  return Object.freeze({
    NAME_PREFIX: NAME_PREFIX,
    PROTECTION_PREFIX: PROTECTION_PREFIX,
    create: create,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BackupRepository;
}
