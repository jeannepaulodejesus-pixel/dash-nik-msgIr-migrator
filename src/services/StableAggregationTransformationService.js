var StableAggregationTransformationService = (function () {
  'use strict';

  function resolveCatalog() {
    if (typeof StableAggregationFormulaCatalog !== 'undefined') {
      return StableAggregationFormulaCatalog;
    }
    return require('../transformations/StableAggregationFormulaCatalog.js');
  }

  function resolveHandledOfferedCatalog() {
    if (typeof HandledOfferedFormulaCatalog !== 'undefined') {
      return HandledOfferedFormulaCatalog;
    }
    return require('../transformations/HandledOfferedFormulaCatalog.js');
  }

  function resolveAhtAuxesStaffCatalog() {
    if (typeof AhtAuxesStaffFormulaCatalog !== 'undefined') {
      return AhtAuxesStaffFormulaCatalog;
    }
    return require('../transformations/AhtAuxesStaffFormulaCatalog.js');
  }

  function arraysEqual(left, right) {
    return left.length === right.length && left.every(function (value, index) {
      return value === right[index];
    });
  }

  function requireSheet(spreadsheet, name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      throw new Error('Required CXP-09 sheet is unavailable: ' + name + '.');
    }
    return sheet;
  }

  function requireHeaders(sheet, sheetName, expectedHeaders) {
    var actualHeaders = sheet.getRange(
      1,
      1,
      1,
      expectedHeaders.length,
    ).getValues()[0];
    if (!arraysEqual(actualHeaders, expectedHeaders)) {
      throw new Error(
        sheetName + ' headers do not match the CXP-09 aggregation contract.',
      );
    }
  }

  function requireCalcSheet(spreadsheet, sheetName) {
    var sheet = requireSheet(spreadsheet, sheetName);
    if (sheet.getLastRow() < 1) {
      throw new Error('Required CXP-09 calculation sheet is empty: ' + sheetName + '.');
    }
    return sheet;
  }

  function preflight(spreadsheet, specs) {
    if (!spreadsheet || typeof spreadsheet.getSheetByName !== 'function') {
      throw new Error('A target spreadsheet is required for CXP-09 installation.');
    }
    resolveHandledOfferedCatalog().list().forEach(function (calcSpec) {
      requireCalcSheet(spreadsheet, calcSpec.calculationSheetName);
    });
    resolveAhtAuxesStaffCatalog().list().forEach(function (calcSpec) {
      requireCalcSheet(spreadsheet, calcSpec.calculationSheetName);
    });
    return specs.map(function (spec) {
      spec.requiredCalcSheets.forEach(function (calcSheetName) {
        requireCalcSheet(spreadsheet, calcSheetName);
      });
      var aggregationSheet = requireSheet(spreadsheet, spec.aggregationSheetName);
      return { aggregationSheet: aggregationSheet, spec: spec };
    });
  }

  function ensureCapacity(sheet, requiredRows, requiredColumns) {
    var currentRows = sheet.getMaxRows();
    var currentColumns = sheet.getMaxColumns();
    if (currentRows < requiredRows) {
      sheet.insertRowsAfter(currentRows, requiredRows - currentRows);
    }
    if (currentColumns < requiredColumns) {
      sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
    }
  }

  function clearOwnedContent(sheet, spec) {
    if (spec.preserveBody === true) {
      var cleanup = spec.legacyFormulaCleanup;
      if (!cleanup) {
        return;
      }
      var anchor = sheet.getRange(cleanup.row, cleanup.column);
      if (
        typeof anchor.getFormula === 'function' &&
        anchor.getFormula() === cleanup.formula
      ) {
        anchor.clearContent();
      }
      return;
    }
    sheet.getDataRange().clearContent();
  }

  function buildInstallSteps(specs) {
    var steps = [{ kind: 'PREFLIGHT', label: 'PREFLIGHT' }];
    specs.forEach(function (spec, specIndex) {
      var prefix = spec.datasetName + ':';
      steps.push({
        kind: 'ENSURE_CAPACITY',
        label: prefix + 'ENSURE_CAPACITY',
        specIndex: specIndex,
      });
      steps.push({
        kind: 'CLEAR',
        label: prefix + 'CLEAR',
        specIndex: specIndex,
      });
      steps.push({
        kind: 'HEADERS',
        label: prefix + 'HEADERS',
        specIndex: specIndex,
      });
      spec.aggregationFormulas.forEach(function (_formula, formulaIndex) {
        steps.push({
          formulaIndex: formulaIndex,
          kind: 'AGGREGATION_FORMULA',
          label: prefix + 'FORMULA:' + (formulaIndex + 1),
          specIndex: specIndex,
        });
      });
    });
    return steps;
  }

  function getInstallStepCount() {
    return buildInstallSteps(resolveCatalog().list()).length;
  }

  function installStep(spreadsheet, stepIndex) {
    var specs = resolveCatalog().list();
    var steps = buildInstallSteps(specs);
    if (
      !Number.isInteger(stepIndex) ||
      stepIndex < 0 ||
      stepIndex >= steps.length
    ) {
      throw new Error('CXP-09 installation step index is out of range.');
    }
    var step = steps[stepIndex];
    if (step.kind === 'PREFLIGHT') {
      preflight(spreadsheet, specs);
      return Object.freeze({ label: step.label });
    }

    var spec = specs[step.specIndex];
    var sheet = requireSheet(spreadsheet, spec.aggregationSheetName);
    if (step.kind === 'ENSURE_CAPACITY') {
      ensureCapacity(sheet, spec.rowCapacity + 1, spec.headers.length);
    } else if (step.kind === 'CLEAR') {
      clearOwnedContent(sheet, spec);
    } else if (step.kind === 'HEADERS') {
      sheet.getRange(1, 1, 1, spec.headers.length).setValues([spec.headers.slice()]);
    } else if (step.kind === 'AGGREGATION_FORMULA') {
      sheet.getRange(2, spec.formulaAnchors[step.formulaIndex]).setFormula(
        spec.aggregationFormulas[step.formulaIndex],
      );
    } else {
      throw new Error('CXP-09 installation step kind is unsupported.');
    }
    return Object.freeze({ label: step.label });
  }

  function install(spreadsheet) {
    var specs = resolveCatalog().list();
    var entries = preflight(spreadsheet, specs);
    var formulaAnchorCount = 0;
    entries.forEach(function (entry) {
      var spec = entry.spec;
      var sheet = entry.aggregationSheet;
      ensureCapacity(sheet, spec.rowCapacity + 1, spec.headers.length);
      clearOwnedContent(sheet, spec);
      sheet.getRange(1, 1, 1, spec.headers.length).setValues([spec.headers.slice()]);
      spec.aggregationFormulas.forEach(function (formula, formulaIndex) {
        sheet.getRange(2, spec.formulaAnchors[formulaIndex]).setFormula(formula);
        formulaAnchorCount += 1;
      });
    });
    return Object.freeze({
      datasetCount: entries.length,
      formulaAnchorCount: formulaAnchorCount,
      rowCapacity: resolveCatalog().ROW_CAPACITY,
    });
  }

  return Object.freeze({
    getInstallStepCount: getInstallStepCount,
    install: install,
    installStep: installStep,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StableAggregationTransformationService;
}
