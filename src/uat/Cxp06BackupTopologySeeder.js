var Cxp06BackupTopologySeeder = (function () {
  'use strict';

  var SCENARIO_TOKENS = Object.freeze({
    CASE5_COMPLETE_UNSUCCESSFUL_BACKUP: 'UNFIN',
    CASE5_INCOMPLETE_BACKUP: 'INC',
    CASE5_SUCCESSFUL_LEFTOVER_BACKUP: 'SUCCESS',
    CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS: 'AMBIG',
  });
  var DATASET_ORDER = Object.freeze([
    'Handled',
    'Offered',
    'AHT - Raw',
    'Auxes - Raw',
    'Staff',
  ]);

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function fail(reason) {
    throw resolveErrorCodes().create('UAT_BACKUP_TOPOLOGY_SEED_FAILED', {
      details: { reason: reason },
    });
  }

  function requireServices(services) {
    if (
      !services ||
      !services.backupRepository ||
      typeof services.backupRepository.createGroup !== 'function' ||
      typeof services.backupRepository.discoverGroups !== 'function' ||
      !services.ledgerRepository ||
      typeof services.ledgerRepository.append !== 'function' ||
      typeof services.ledgerRepository.findSuccessfulByRunId !== 'function' ||
      !services.targetSpreadsheet ||
      typeof services.targetSpreadsheet.deleteSheet !== 'function' ||
      typeof services.targetSpreadsheet.getSheetByName !== 'function' ||
      typeof services.now !== 'function' ||
      typeof services.uniqueToken !== 'function'
    ) {
      fail('seeder_services_incomplete');
    }
    return services;
  }

  function create(services) {
    var dependencies = services || {};

    function nextRunId(scenario, usedRunIds) {
      var token;
      try {
        token = dependencies.uniqueToken();
      } catch (error) {
        fail('invalid_unique_token');
      }
      if (
        typeof token !== 'string' ||
        token.length === 0 ||
        token.length > 48 ||
        !/^[A-Za-z0-9_-]+$/.test(token)
      ) {
        fail('invalid_unique_token');
      }
      var runId = 'UATSEED_' + SCENARIO_TOKENS[scenario] + '_' + token;
      if (usedRunIds.indexOf(runId) !== -1) {
        fail('duplicate_seed_run_id');
      }
      usedRunIds.push(runId);
      return runId;
    }

    function createGroup(scenario, usedRunIds) {
      var runId = nextRunId(scenario, usedRunIds);
      var group;
      try {
        group = dependencies.backupRepository.createGroup(runId);
      } catch (error) {
        fail('backup_group_creation_failed');
      }
      if (!group || group.complete !== true || group.runId !== runId || !group.sheetsByDataset) {
        fail('backup_group_creation_failed');
      }
      return group;
    }

    function groupSheetNames(group) {
      return DATASET_ORDER.map(function (datasetName) {
        var reference = group.sheetsByDataset[datasetName];
        return reference && reference.sheetName;
      }).filter(Boolean);
    }

    function reduceToIncompleteGroup(group) {
      DATASET_ORDER.slice(1).forEach(function (datasetName) {
        var reference = group.sheetsByDataset[datasetName];
        var sheet = reference && dependencies.targetSpreadsheet.getSheetByName(
          reference.sheetName,
        );
        if (!sheet) {
          fail('backup_sheet_missing');
        }
        try {
          dependencies.targetSpreadsheet.deleteSheet(sheet);
        } catch (error) {
          fail('backup_sheet_delete_failed');
        }
      });
      return [group.sheetsByDataset.Handled.sheetName];
    }

    function markSuccessful(group) {
      var record = {
        checkedAtUtc: (function () {
          var value = dependencies.now();
          return (value instanceof Date ? value : new Date(value)).toISOString();
        })(),
        datasetNames: [],
        fingerprint: 'uat-seed:' + group.runId,
        fingerprintAlgorithm: 'UAT-SEED',
        result: 'SUCCESS',
        runId: group.runId,
        schemaVersion: '1.0.0',
        sourceFileIds: [],
        sourceFileNames: [],
      };
      try {
        dependencies.ledgerRepository.append([record]);
        var confirmed = dependencies.ledgerRepository.findSuccessfulByRunId(group.runId);
        if (!confirmed || confirmed.runId !== group.runId || confirmed.result !== 'SUCCESS') {
          fail('ledger_confirmation_failed');
        }
      } catch (error) {
        fail('ledger_confirmation_failed');
      }
    }

    function seed(scenario) {
      if (!Object.hasOwn(SCENARIO_TOKENS, scenario)) {
        fail('unsupported_scenario');
      }
      requireServices(dependencies);

      var existing;
      try {
        existing = dependencies.backupRepository.discoverGroups();
      } catch (error) {
        fail('backup_discovery_failed');
      }
      if (!Array.isArray(existing)) {
        fail('backup_discovery_failed');
      }
      if (existing.length > 0) {
        fail('existing_backup_topology');
      }

      var groups = [];
      var usedRunIds = [];
      groups.push(createGroup(scenario, usedRunIds));
      if (scenario === 'CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS') {
        groups.push(createGroup(scenario, usedRunIds));
      }

      var sheetNames = groups.reduce(function (names, group) {
        return names.concat(groupSheetNames(group));
      }, []);
      if (scenario === 'CASE5_INCOMPLETE_BACKUP') {
        sheetNames = reduceToIncompleteGroup(groups[0]);
      } else if (scenario === 'CASE5_SUCCESSFUL_LEFTOVER_BACKUP') {
        markSuccessful(groups[0]);
      }

      return Object.freeze({
        groupCount: groups.length,
        runIds: Object.freeze(groups.map(function (group) { return group.runId; })),
        scenario: scenario,
        sheetNames: Object.freeze(sheetNames.slice()),
      });
    }

    return Object.freeze({ seed: seed });
  }

  return Object.freeze({ create: create });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp06BackupTopologySeeder;
}
