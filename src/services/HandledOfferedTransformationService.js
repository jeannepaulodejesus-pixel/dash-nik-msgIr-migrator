var HandledOfferedTransformationService = (function () {
  'use strict';

  function resolveCatalog() {
    if (typeof HandledOfferedFormulaCatalog !== 'undefined') {
      return HandledOfferedFormulaCatalog;
    }
    return require('../transformations/HandledOfferedFormulaCatalog.js');
  }

  function resolveSchemaRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return require('../ingestion/SchemaRegistry.js');
  }

  function arraysEqual(left, right) {
    return left.length === right.length && left.every(function (value, index) {
      return value === right[index];
    });
  }

  function requireSheet(spreadsheet, name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      throw new Error('Required CXP-07 sheet is unavailable: ' + name + '.');
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
      throw new Error('A target spreadsheet is required for CXP-07 installation.');
    }
    requireHeaders(
      requireSheet(spreadsheet, '_RAW_AHT'),
      '_RAW_AHT',
      resolveSchemaRegistry().getSchema('AHT - Raw').requiredHeaders,
    );
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
      throw new Error('CXP-07 installation step index is out of range.');
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
      ensureCapacity(sheet, spec.rowCapacity + 1, headers.length);
    } else if (step.kind === 'CLEAR') {
      sheet.getDataRange().clearContent();
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
    } else {
      throw new Error('CXP-07 installation step kind is unsupported.');
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
      ensureCapacity(sheet, spec.rowCapacity + 1, headers.length);
      sheet.getDataRange().clearContent();
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(
        2,
        1,
        1,
        spec.calculatedFormulas.length,
      ).setFormulas([spec.calculatedFormulas]);
      sheet.getRange(2, spec.calculatedHeaders.length + 1).setFormula(spec.copyFormula);
      formulaAnchorCount += spec.calculatedFormulas.length + 1;
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
  module.exports = HandledOfferedTransformationService;
}
