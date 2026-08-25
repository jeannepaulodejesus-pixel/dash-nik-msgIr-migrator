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
        return rawEntry(binding);
      });
    }

    function rawEntry(binding) {
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

    function readDataset(group, datasetName) {
      try {
        if (!group || !group.sheetsByDataset) {
          throw new Error('A backup group is required.');
        }
        var binding = resolveDatasetSheets().listBindings().filter(function (candidate) {
          return candidate.datasetName === datasetName;
        })[0];
        var reference = binding && group.sheetsByDataset[datasetName];
        var sheet = reference && spreadsheet.getSheetByName(reference.sheetName);
        if (!binding || !sheet) {
          throw new Error('A registered backup dataset is unavailable.');
        }
        var range = sheet.getDataRange();
        return Object.freeze({
          datasetName: datasetName,
          formulas: range.getFormulas(),
          sheetName: reference.sheetName,
          values: range.getValues(),
        });
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'MIGRATION_BACKUP_FAILED');
      }
    }

    function verifyDataset(group, datasetName) {
      try {
        if (!group || group.complete !== true) {
          throw new Error('A complete backup group is required.');
        }
        var binding = resolveDatasetSheets().listBindings().filter(function (candidate) {
          return candidate.datasetName === datasetName;
        })[0];
        if (!binding) {
          throw new Error('A registered backup dataset is required.');
        }
        var entry = rawEntry(binding);
        var snapshot = readDataset(group, datasetName);
        if (
          !resolveCodec().matricesEqual(entry.values, snapshot.values) ||
          !resolveCodec().matricesEqual(entry.formulas, snapshot.formulas)
        ) {
          throw new Error('A copied backup does not match its raw source.');
        }
        return Object.freeze({
          datasetName: datasetName,
          sheetName: snapshot.sheetName,
        });
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'MIGRATION_BACKUP_FAILED');
      }
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

    function namesToCompare(options) {
      var registered = resolveDatasetSheets().listBindings();
      if (!options || options.compareDatasetNames === undefined) {
        return registered.map(function (binding) {
          return binding.datasetName;
        });
      }
      if (!Array.isArray(options.compareDatasetNames)) {
        throw resolveErrorCodes().create('MIGRATION_BACKUP_FAILED', {
          details: { reason: 'invalid_compare_dataset_names' },
        });
      }
      var allowed = Object.create(null);
      registered.forEach(function (binding) {
        allowed[binding.datasetName] = true;
      });
      options.compareDatasetNames.forEach(function (datasetName) {
        if (!allowed[datasetName]) {
          throw resolveErrorCodes().create('MIGRATION_BACKUP_FAILED', {
            details: { datasetName: datasetName, reason: 'unknown_compare_dataset' },
          });
        }
      });
      return options.compareDatasetNames;
    }

    function verifyGroup(group, options) {
      if (!group || group.complete !== true) {
        throw resolveErrorCodes().create('MIGRATION_BACKUP_FAILED', {
          details: { reason: 'backup_group_incomplete' },
        });
      }
      try {
        var compareNames = namesToCompare(options);
        var compareSet = Object.create(null);
        compareNames.forEach(function (datasetName) {
          compareSet[datasetName] = true;
        });
        var entries = rawEntries();
        var snapshots = readGroup(group);
        if (snapshots.length !== entries.length) {
          throw new Error('A copied backup does not match its raw source.');
        }
        entries.forEach(function (entry, index) {
          if (!compareSet[entry.binding.datasetName]) {
            return;
          }
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

    function createGroupStep(runId) {
      try {
        requireRunId(runId);
        var group = discoverGroups().filter(function (candidate) {
          return candidate.runId === runId;
        })[0] || null;
        if (group && group.complete) {
          return Object.freeze({
            complete: true,
            createdDatasetName: null,
            group: verifyGroup(group),
          });
        }
        var binding = resolveDatasetSheets().listBindings().filter(function (candidate) {
          return !group || !group.sheetsByDataset[candidate.datasetName];
        })[0];
        var entry = rawEntry(binding);
        var copy = entry.sheet.copyTo(spreadsheet);
        copy.setName(backupName(binding.datasetName, runId));
        copy.hideSheet();
        normalizeProtection(copy);

        group = discoverGroups().filter(function (candidate) {
          return candidate.runId === runId;
        })[0];
        var snapshot = readGroup(group).filter(function (candidate) {
          return candidate.datasetName === binding.datasetName;
        })[0];
        if (
          !snapshot ||
          !resolveCodec().matricesEqual(entry.values, snapshot.values) ||
          !resolveCodec().matricesEqual(entry.formulas, snapshot.formulas)
        ) {
          throw new Error('A copied backup does not match its raw source.');
        }
        return Object.freeze({
          complete: group.complete,
          createdDatasetName: binding.datasetName,
          group: group,
        });
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'MIGRATION_BACKUP_FAILED');
      }
    }

    function createGroup(runId) {
      requireRunId(runId);
      if (discoverGroups().some(function (group) { return group.runId === runId; })) {
        throw resolveErrorCodes().create('MIGRATION_BACKUP_FAILED', {
          details: { reason: 'backup_group_exists' },
        });
      }
      var result;
      resolveDatasetSheets().listBindings().forEach(function () {
        result = createGroupStep(runId);
      });
      return verifyGroup(result.group);
    }

    return Object.freeze({
      createGroup: createGroup,
      createGroupStep: createGroupStep,
      deleteGroup: deleteGroup,
      discoverGroups: discoverGroups,
      readDataset: readDataset,
      readGroup: readGroup,
      verifyDataset: verifyDataset,
      verifyGroup: verifyGroup,
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
