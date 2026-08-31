/**
 * CXP-11 control-workbook installer.
 *
 * Installs the final PARITY_RESULTS and SOURCE_ERROR_BASELINE schemas, seeds the
 * WB0817 source-error baseline, verifies the authoritative totals, and confirms
 * managed protection. Steps are small, ordered, and idempotent so the setup
 * state machine can checkpoint and resume between any two of them.
 */
var ParityValidationInstallService = (function () {
  'use strict';

  function resolveParityResultsRepository() {
    if (typeof ParityResultsRepository !== 'undefined') {
      return ParityResultsRepository;
    }
    return require('../repository/ParityResultsRepository.js');
  }

  function resolveSourceErrorBaselineRepository() {
    if (typeof SourceErrorBaselineRepository !== 'undefined') {
      return SourceErrorBaselineRepository;
    }
    return require('../repository/SourceErrorBaselineRepository.js');
  }

  function resolveBaseline() {
    if (typeof SourceErrorBaseline !== 'undefined') {
      return SourceErrorBaseline;
    }
    return require('../parity/SourceErrorBaseline.js');
  }

  function resolveProtectionHelpers() {
    if (typeof ProtectionHelpers !== 'undefined') {
      return ProtectionHelpers;
    }
    return require('./ProtectionHelpers.js');
  }

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function protectionServices(services) {
    if (services && services.spreadsheetApp && services.session) {
      return services;
    }
    if (
      typeof SpreadsheetApp !== 'undefined' &&
      typeof Session !== 'undefined'
    ) {
      return { session: Session, spreadsheetApp: SpreadsheetApp };
    }
    return null;
  }

  function ensureProtection(spreadsheet, sheetName, services) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      throw resolveErrorCodes().create('PARITY_RESULTS_SCHEMA_MISMATCH', {
        details: { sheetName: sheetName },
      });
    }
    var resolved = protectionServices(services);
    var helpers = resolveProtectionHelpers();
    if (!resolved || typeof sheet.getProtections !== 'function') {
      return Object.freeze({ protectionEnsured: false, sheetName: sheetName });
    }
    var validated = helpers.validateServices(resolved, 'to protect CXP-11 control sheets');
    helpers.assertManagedProtectionAvailable(sheet, validated.protectionType);
    helpers.ensureManagedProtection(sheet, resolved);
    return Object.freeze({ protectionEnsured: true, sheetName: sheetName });
  }

  var STEPS = Object.freeze([
    Object.freeze({
      label: 'INSTALL_PARITY_RESULTS_SCHEMA',
      run: function (spreadsheet) {
        return resolveParityResultsRepository()
          .create(spreadsheet)
          .installHeaders({ overwrite: true });
      },
    }),
    Object.freeze({
      label: 'INSTALL_SOURCE_ERROR_BASELINE_SCHEMA',
      run: function (spreadsheet) {
        return resolveSourceErrorBaselineRepository()
          .create(spreadsheet)
          .installHeaders({ overwrite: true });
      },
    }),
    Object.freeze({
      label: 'SEED_WB0817_SOURCE_ERROR_BASELINE',
      run: function (spreadsheet) {
        return resolveSourceErrorBaselineRepository()
          .create(spreadsheet)
          .install(resolveBaseline().listRecords());
      },
    }),
    Object.freeze({
      label: 'VERIFY_WB0817_BASELINE_TOTALS',
      run: function (spreadsheet) {
        return resolveSourceErrorBaselineRepository()
          .create(spreadsheet)
          .verifyInstalled();
      },
    }),
    Object.freeze({
      label: 'PROTECT_PARITY_RESULTS',
      run: function (spreadsheet, services) {
        return ensureProtection(
          spreadsheet,
          resolveParityResultsRepository().SHEET_NAME,
          services,
        );
      },
    }),
    Object.freeze({
      label: 'PROTECT_SOURCE_ERROR_BASELINE',
      run: function (spreadsheet, services) {
        return ensureProtection(
          spreadsheet,
          resolveSourceErrorBaselineRepository().SHEET_NAME,
          services,
        );
      },
    }),
  ]);

  function getInstallStepCount() {
    return STEPS.length;
  }

  function listInstallStepLabels() {
    return STEPS.map(function (step) { return step.label; });
  }

  function installStep(spreadsheet, stepIndex, services) {
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= STEPS.length) {
      throw new Error('The CXP-11 install step index is outside the contract.');
    }
    var step = STEPS[stepIndex];
    return Object.freeze({
      detail: step.run(spreadsheet, services),
      label: step.label,
      stepIndex: stepIndex,
    });
  }

  function install(spreadsheet, services) {
    var results = STEPS.map(function (step, index) {
      return installStep(spreadsheet, index, services);
    });
    return Object.freeze({ stepCount: results.length, steps: Object.freeze(results) });
  }

  /** Read-only contract inspection used by the runbook diagnostic and Step 02. */
  function inspect(spreadsheet, services) {
    var resultsRepository = resolveParityResultsRepository();
    var baselineRepository = resolveSourceErrorBaselineRepository();
    var report = {
      parityResults: { present: false, schemaOk: false },
      sourceErrorBaseline: { present: false, schemaOk: false },
    };

    var resultsSheet = spreadsheet.getSheetByName(resultsRepository.SHEET_NAME);
    report.parityResults.present = Boolean(resultsSheet);
    if (resultsSheet) {
      try {
        resultsRepository.create(spreadsheet).ensureHeaders();
        report.parityResults.schemaOk = true;
      } catch (error) {
        report.parityResults.schemaError = error && error.code ? error.code : 'UNKNOWN';
      }
      report.parityResults.headerCount = resultsRepository.HEADERS.length;
    }

    var baselineSheet = spreadsheet.getSheetByName(baselineRepository.SHEET_NAME);
    report.sourceErrorBaseline.present = Boolean(baselineSheet);
    if (baselineSheet) {
      try {
        baselineRepository.create(spreadsheet).ensureHeaders();
        report.sourceErrorBaseline.schemaOk = true;
      } catch (error) {
        report.sourceErrorBaseline.schemaError = error && error.code ? error.code : 'UNKNOWN';
      }
      try {
        var verified = baselineRepository.create(spreadsheet).verifyInstalled();
        report.sourceErrorBaseline.recordCount = verified.recordCount;
        report.sourceErrorBaseline.totalsOk = verified.verification.pass;
        report.sourceErrorBaseline.actualTotal = verified.verification.actualTotal;
        report.sourceErrorBaseline.expectedTotal = verified.verification.expectedTotal;
        report.sourceErrorBaseline.actualByType = verified.verification.actualByType;
      } catch (error) {
        report.sourceErrorBaseline.totalsOk = false;
        report.sourceErrorBaseline.totalsError = error && error.code ? error.code : 'UNKNOWN';
      }
    }

    var resolved = protectionServices(services);
    [
      { key: 'parityResults', sheet: resultsSheet },
      { key: 'sourceErrorBaseline', sheet: baselineSheet },
    ].forEach(function (entry) {
      if (!entry.sheet || !resolved || typeof entry.sheet.getProtections !== 'function') {
        report[entry.key].protectionOk = null;
        return;
      }
      try {
        var validated = resolveProtectionHelpers()
          .validateServices(resolved, 'to inspect CXP-11 control protections');
        resolveProtectionHelpers()
          .assertManagedProtectionAvailable(entry.sheet, validated.protectionType);
        report[entry.key].protectionOk = true;
      } catch (error) {
        report[entry.key].protectionOk = false;
      }
    });

    return Object.freeze(report);
  }

  return Object.freeze({
    getInstallStepCount: getInstallStepCount,
    inspect: inspect,
    install: install,
    installStep: installStep,
    listInstallStepLabels: listInstallStepLabels,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ParityValidationInstallService;
}
