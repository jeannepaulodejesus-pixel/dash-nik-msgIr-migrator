var AhtAuxesStaffTransformationService = (function () {
  'use strict';

  function resolveCatalog() {
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
      throw new Error('Required CXP-08 sheet is unavailable: ' + name + '.');
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
        sheetName + ' headers do not match the active CXP-03 schema.',
      );
    }
  }

  function preflight(spreadsheet, specs) {
    if (!spreadsheet || typeof spreadsheet.getSheetByName !== 'function') {
      throw new Error('A target spreadsheet is required for CXP-08 installation.');
    }
    return specs.map(function (spec) {
      var rawSheet = requireSheet(spreadsheet, spec.rawSheetName);
      var calculationSheet = requireSheet(spreadsheet, spec.calculationSheetName);
      requireHeaders(rawSheet, spec.rawSheetName, spec.rawHeaders);
      return { calculationSheet: calculationSheet, spec: spec };
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

  function requiredColumnsFor(spec) {
    var tableColumns = spec.calculatedHeaders.length + spec.rawHeaders.length;
    return Math.max(tableColumns, spec.requiredColumns || tableColumns);
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
      spec.calculatedFormulas.forEach(function (_formula, formulaIndex) {
        steps.push({
          formulaIndex: formulaIndex,
          kind: 'CALCULATED_FORMULA',
          label: prefix + 'FORMULA:' + spec.calculatedHeaders[formulaIndex],
          specIndex: specIndex,
        });
      });
      steps.push({
        kind: 'RAW_COPY',
        label: prefix + 'RAW_COPY',
        specIndex: specIndex,
      });
      if (spec.summaryHeaders && spec.summaryHeaders.length) {
        steps.push({
          kind: 'SUMMARY_HEADERS',
          label: prefix + 'SUMMARY_HEADERS',
          specIndex: specIndex,
        });
      }
      if (spec.summaryFormulas && spec.summaryFormulas.length) {
        steps.push({
          kind: 'SUMMARY_FORMULAS',
          label: prefix + 'SUMMARY_FORMULAS',
          specIndex: specIndex,
        });
      }
    });
    return steps;
  }

  function getInstallStepCount() {
    return buildInstallSteps(resolveCatalog().list()).length;
  }

  function writeSummaryHeaders(sheet, spec) {
    spec.summaryHeaders.forEach(function (header) {
      sheet.getRange(header.row, header.column).setValues([[header.value]]);
    });
  }

  function writeSummaryFormulas(sheet, spec) {
    spec.summaryFormulas.forEach(function (entry) {
      sheet.getRange(entry.row, entry.column).setFormula(entry.formula);
    });
  }

  function clearOwnedContent(sheet, spec) {
    var rowCount = spec.rowCapacity + 1;
    var columnCount = requiredColumnsFor(spec);
    var anchor = spec.businessDayCell;
    if (!anchor) {
      sheet.getRange(1, 1, rowCount, columnCount).clearContent();
      return;
    }
    if (anchor.column > 1) {
      sheet.getRange(1, 1, 1, anchor.column - 1).clearContent();
    }
    if (anchor.column < columnCount) {
      sheet.getRange(
        1,
        anchor.column + 1,
        1,
        columnCount - anchor.column,
      ).clearContent();
    }
    if (rowCount > 1) {
      sheet.getRange(2, 1, rowCount - 1, columnCount).clearContent();
    }
  }

  function installStep(spreadsheet, stepIndex) {
    var specs = resolveCatalog().list();
    var steps = buildInstallSteps(specs);
    if (
      !Number.isInteger(stepIndex) ||
      stepIndex < 0 ||
      stepIndex >= steps.length
    ) {
      throw new Error('CXP-08 installation step index is out of range.');
    }
    var step = steps[stepIndex];
    if (step.kind === 'PREFLIGHT') {
      preflight(spreadsheet, specs);
      return Object.freeze({ label: step.label });
    }

    var spec = specs[step.specIndex];
    var sheet = requireSheet(spreadsheet, spec.calculationSheetName);
    var headers = spec.calculatedHeaders.concat(spec.rawHeaders);
    if (step.kind === 'ENSURE_CAPACITY') {
      ensureCapacity(sheet, spec.rowCapacity + 1, requiredColumnsFor(spec));
    } else if (step.kind === 'CLEAR') {
      clearOwnedContent(sheet, spec);
    } else if (step.kind === 'HEADERS') {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else if (step.kind === 'CALCULATED_FORMULA') {
      sheet.getRange(2, step.formulaIndex + 1).setFormula(
        spec.calculatedFormulas[step.formulaIndex],
      );
    } else if (step.kind === 'RAW_COPY') {
      sheet.getRange(2, spec.calculatedHeaders.length + 1).setFormula(
        spec.copyFormula,
      );
    } else if (step.kind === 'SUMMARY_HEADERS') {
      writeSummaryHeaders(sheet, spec);
    } else if (step.kind === 'SUMMARY_FORMULAS') {
      writeSummaryFormulas(sheet, spec);
    } else {
      throw new Error('CXP-08 installation step kind is unsupported.');
    }
    return Object.freeze({ label: step.label });
  }

  function install(spreadsheet) {
    var specs = resolveCatalog().list();
    var entries = preflight(spreadsheet, specs);
    var formulaAnchorCount = 0;
    entries.forEach(function (entry) {
      var spec = entry.spec;
      var sheet = entry.calculationSheet;
      var headers = spec.calculatedHeaders.concat(spec.rawHeaders);
      ensureCapacity(sheet, spec.rowCapacity + 1, requiredColumnsFor(spec));
      clearOwnedContent(sheet, spec);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(
        2,
        1,
        1,
        spec.calculatedFormulas.length,
      ).setFormulas([spec.calculatedFormulas]);
      sheet.getRange(2, spec.calculatedHeaders.length + 1).setFormula(spec.copyFormula);
      formulaAnchorCount += spec.calculatedFormulas.length + 1;
      if (spec.summaryHeaders && spec.summaryHeaders.length) {
        writeSummaryHeaders(sheet, spec);
      }
      if (spec.summaryFormulas && spec.summaryFormulas.length) {
        writeSummaryFormulas(sheet, spec);
        formulaAnchorCount += spec.summaryFormulas.length;
      }
    });
    return Object.freeze({
      datasetCount: entries.length,
      formulaAnchorCount: formulaAnchorCount,
      rowCapacity: {
        aht: resolveCatalog().AHT_ROW_CAPACITY,
        auxes: resolveCatalog().AUXES_ROW_CAPACITY,
        staff: resolveCatalog().STAFF_ROW_CAPACITY,
      },
    });
  }

  return Object.freeze({
    getInstallStepCount: getInstallStepCount,
    install: install,
    installStep: installStep,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AhtAuxesStaffTransformationService;
}
