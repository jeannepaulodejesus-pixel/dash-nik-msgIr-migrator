var ReportingSurfaceTransformationService = (function () {
  'use strict';

  function resolveCatalog() {
    if (typeof ReportingSurfaceFormulaCatalog !== 'undefined') {
      return ReportingSurfaceFormulaCatalog;
    }
    return require('../transformations/ReportingSurfaceFormulaCatalog.js');
  }

  function resolveAggregationCatalog() {
    if (typeof StableAggregationFormulaCatalog !== 'undefined') {
      return StableAggregationFormulaCatalog;
    }
    return require('../transformations/StableAggregationFormulaCatalog.js');
  }

  function requireSheet(spreadsheet, name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      throw new Error('Required CXP-10 sheet is unavailable: ' + name + '.');
    }
    return sheet;
  }

  function preflight(spreadsheet) {
    if (!spreadsheet || typeof spreadsheet.getSheetByName !== 'function') {
      throw new Error('A target spreadsheet is required for CXP-10 installation.');
    }
    resolveAggregationCatalog().list().forEach(function (spec) {
      var sheet = requireSheet(spreadsheet, spec.aggregationSheetName);
      if (sheet.getLastRow() < 1) {
        throw new Error(
          'Required CXP-09 aggregation sheet is empty: ' + spec.aggregationSheetName + '.',
        );
      }
    });
    return {
      forecastBridge: resolveCatalog().forecastBridgeSpec(),
      intervalView: resolveCatalog().intervalViewSpec(),
      mom: resolveCatalog().momSpec(),
    };
  }

  function buildInstallSteps(specs) {
    var steps = [{ kind: 'PREFLIGHT', label: 'PREFLIGHT' }];
    var intervalView = specs.intervalView;
    steps.push({ kind: 'INTERVAL_HEADERS', label: 'Interval View:HEADERS' });
    intervalView.axisFormulas.forEach(function (entry, index) {
      steps.push({
        anchor: entry,
        kind: 'INTERVAL_AXIS',
        label: 'Interval View:AXIS:' + (index + 1),
      });
    });
    intervalView.metricFormulas.forEach(function (entry, index) {
      steps.push({
        anchor: entry,
        kind: 'INTERVAL_METRIC',
        label: 'Interval View:METRIC:' + (index + 1),
      });
    });
    intervalView.totalFormulas.forEach(function (entry, index) {
      steps.push({
        anchor: entry,
        kind: 'INTERVAL_TOTAL',
        label: 'Interval View:TOTAL:' + (index + 1),
      });
    });

    steps.push({ kind: 'MOM_STAGING_HEADERS', label: 'MOM:STAGING_HEADERS' });
    specs.mom.weekHeaderFormulas.forEach(function (entry, index) {
      steps.push({
        anchor: entry,
        kind: 'MOM_WEEK_HEADER',
        label: 'MOM:WEEK_HEADER:' + (index + 1),
      });
    });

    steps.push({
      anchor: specs.forecastBridge.formulaAnchor,
      bridgeFormula: specs.forecastBridge.bridgeFormula,
      kind: 'FORECAST_BRIDGE',
      label: 'Forecast Bridge:FORMULA',
      sheetName: specs.forecastBridge.aggregationSheetName,
    });
    return steps;
  }

  function installStep(spreadsheet, stepIndex) {
    var specs = preflight(spreadsheet);
    var steps = buildInstallSteps(specs);
    if (
      !Number.isInteger(stepIndex) ||
      stepIndex < 0 ||
      stepIndex >= steps.length
    ) {
      throw new Error('CXP-10 installation step index is out of range.');
    }
    var step = steps[stepIndex];
    if (step.kind === 'PREFLIGHT') {
      return Object.freeze({ label: step.label });
    }

    if (step.kind === 'INTERVAL_HEADERS') {
      var intervalSheet = requireSheet(spreadsheet, specs.intervalView.reportSheetName);
      intervalSheet.getRange(specs.intervalView.headerRow, 1, 1, 2).setValues([['Date', 'Interval']]);
      intervalSheet.getRange(
        specs.intervalView.headerRow,
        specs.intervalView.headerStartColumn,
        1,
        specs.intervalView.headers.length,
      ).setValues([specs.intervalView.headers.slice()]);
    } else if (step.kind === 'INTERVAL_AXIS' || step.kind === 'INTERVAL_METRIC') {
      var reportSheet = requireSheet(spreadsheet, specs.intervalView.reportSheetName);
      reportSheet.getRange(step.anchor.anchorRow, step.anchor.anchorColumn).setFormula(
        step.anchor.formula,
      );
    } else if (step.kind === 'INTERVAL_TOTAL') {
      var totalSheet = requireSheet(spreadsheet, specs.intervalView.reportSheetName);
      totalSheet.getRange(step.anchor.anchorRow, step.anchor.anchorColumn).setFormula(
        step.anchor.formula,
      );
    } else if (step.kind === 'MOM_STAGING_HEADERS') {
      var momSheet = requireSheet(spreadsheet, specs.mom.reportSheetName);
      momSheet.getRange(specs.mom.stagingHeaderRow, 1, 1, specs.mom.stagingHeaders.length)
        .setValues([specs.mom.stagingHeaders.slice()]);
    } else if (step.kind === 'MOM_WEEK_HEADER') {
      var momWeekSheet = requireSheet(spreadsheet, specs.mom.reportSheetName);
      momWeekSheet.getRange(step.anchor.anchorRow, step.anchor.anchorColumn).setFormula(
        step.anchor.formula,
      );
    } else if (step.kind === 'FORECAST_BRIDGE') {
      var forecastSheet = requireSheet(spreadsheet, step.sheetName);
      forecastSheet.getRange(step.anchor.row, step.anchor.column).setFormula(step.bridgeFormula);
    } else {
      throw new Error('CXP-10 installation step kind is unsupported.');
    }
    return Object.freeze({ label: step.label });
  }

  function install(spreadsheet) {
    var specs = preflight(spreadsheet);
    var steps = buildInstallSteps(specs);
    for (var stepIndex = 1; stepIndex < steps.length; stepIndex += 1) {
      installStep(spreadsheet, stepIndex);
    }
    return Object.freeze({
      formulaAnchorCount: specs.intervalView.metricFormulas.length +
        specs.intervalView.axisFormulas.length +
        specs.intervalView.totalFormulas.length +
        specs.mom.weekHeaderFormulas.length +
        1,
      metricCount: specs.intervalView.headers.length,
      reportSheetCount: 2,
    });
  }

  return Object.freeze({
    getInstallStepCount: function () {
      return buildInstallSteps({
        intervalView: resolveCatalog().intervalViewSpec(),
        mom: resolveCatalog().momSpec(),
        forecastBridge: resolveCatalog().forecastBridgeSpec(),
      }).length;
    },
    install: install,
    installStep: installStep,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReportingSurfaceTransformationService;
}
