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
    steps.push({ kind: 'INTERVAL_CHROME', label: 'Interval View:CHROME' });
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

    steps.push({ kind: 'MOM_CALENDAR', label: 'MOM:CALENDAR' });
    specs.mom.weekDateFormulas.forEach(function (entry, index) {
      if (!entry.formula) {
        return;
      }
      steps.push({
        anchor: entry,
        kind: 'MOM_WEEK_DATE',
        label: 'MOM:WEEK_DATE:' + (index + 1),
      });
    });
    specs.mom.dayNameFormulas.forEach(function (entry, index) {
      steps.push({
        anchor: entry,
        kind: 'MOM_DAY_NAME',
        label: 'MOM:DAY_NAME:' + (index + 1),
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

  function installMomCalendar(momSheet, mom) {
    // MOM contains RTA-owned manual inputs. Reinstalling report chrome must not
    // clear the whole sheet or the six input grids.
    momSheet.getRange(1, 1).setValue(mom.titleMnl);
    momSheet.getRange(1, 25).setValue(mom.titleLv);
    mom.sectionLabels.forEach(function (entry) {
      momSheet.getRange(2, entry.column).setValue(entry.label);
    });
    mom.pstLabels.forEach(function (column) {
      momSheet.getRange(3, column).setValue('PST');
    });
    mom.timeLabels.forEach(function (column) {
      momSheet.getRange(4, column).setValue('Time');
    });
    mom.timeAxisColumns.forEach(function (column) {
      momSheet.getRange(mom.firstTimeRow, column).setFormula(mom.timeAxisFormula);
    });
  }

  function installIntervalChrome(intervalSheet, intervalView) {
    var allocationTargetRange = intervalSheet.getRange(97, 4);
    var allocationTargetFormula = typeof allocationTargetRange.getFormula === 'function'
      ? allocationTargetRange.getFormula()
      : '';
    var allocationTargetValue = typeof allocationTargetRange.getValue === 'function'
      ? allocationTargetRange.getValue()
      : '';
    // Retire the v1 CXP-10 surface before rendering v2. This was an installer-
    // owned range, not an RTA input surface. AA2 remains outside both clears.
    intervalSheet.getRange(15, 1, 51, 29).clearContent();
    // V2 owns only the verified operational block.
    intervalSheet.getRange(97, 2, 55, 27).clearContent();
    if (allocationTargetFormula) {
      intervalSheet.getRange(97, 4).setFormula(allocationTargetFormula);
    } else if (allocationTargetValue !== '') {
      intervalSheet.getRange(97, 4).setValue(allocationTargetValue);
    }
    intervalSheet.getRange(97, 5).setFormula('=IF(D97="","",D97-0.05)');
    intervalSheet.getRange(97, 6).setFormula('=IF(D97="","",D97+0.05)');
    intervalSheet.getRange(1, intervalView.businessDayAnchor.column).setValue(
      intervalView.viewDateLabel,
    );
    intervalSheet.getRange(1, 3).setValue('Date');
    intervalSheet.getRange(2, 3).setFormula('=$AA$2');
    intervalSheet.getRange(102, 11).setValue('INT - MESSAGING');
    intervalSheet.getRange(103, 3).setValue('Legend');
    intervalSheet.getRange(104, 3).setValue('SL%');
    intervalSheet.getRange(104, 4, 1, 6).setValues([[
      '<75%', '75%-78%', '78.1%-79.9%', '80%-85%', '85%-90%', '>90%',
    ]]);
    intervalSheet.getRange(105, 4, 1, 6).setValues([[
      'Loss', 'Miss', 'Close', 'GREAT!', 'High', 'V-High',
    ]]);
    intervalSheet.getRange(106, 3).setValue('Concurrency');
    intervalSheet.getRange(106, 4, 1, 5).setValues([[
      '1.0-1.4', '1.4-1.6', '1.6-2.0', '2.0-2.4', '>2.4',
    ]]);
    intervalSheet.getRange(107, 3).setValue('Allocation');
    intervalSheet.getRange(107, 4, 1, 3).setValues([['+/- 5%', 'Under-Take', 'Over-Take']]);
    intervalSheet.getRange(108, 4, 1, 3).setValues([['Within', '< 5%', '> 5%']]);
    intervalSheet.getRange(109, 3).setValue('ASA');
    intervalSheet.getRange(109, 4, 1, 3).setValues([['0-45', '45-90', '>90']]);
    intervalSheet.getRange(103, 11, 1, 14).setValues([[
      'SL%', '', 'Volume %', '', 'AHT Fragment', '', 'ASA in seconds', '',
      'Concurrency', '', 'Allocation', '', 'Allocation +/-', '',
    ]]);
    [
      [104, 11, '=I151'], [104, 13, '=K151'], [104, 15, '=P151'],
      [104, 17, '=R151'], [104, 19, '=S151'], [104, 21, '=N151'],
      [104, 23, '=U104-D97'],
    ].forEach(function (entry) {
      intervalSheet.getRange(entry[0], entry[1]).setFormula(entry[2]);
    });
    intervalView.sectionLabels.forEach(function (entry) {
      intervalSheet.getRange(intervalView.sectionRow, entry.column).setValue(entry.label);
    });
    intervalSheet.getRange(intervalView.totalRow, 3).setValue(intervalView.totalLabel);
  }

  function getIntervalPresentationContract() {
    return Object.freeze({
      hiddenColumns: Object.freeze([2]),
      merges: Object.freeze([
        'K102:X102', 'C103:I103', 'C104:C105', 'C107:C108',
        'K103:L103', 'K104:L109', 'M103:N103', 'M104:N109',
        'O103:P103', 'O104:P109', 'Q103:R103', 'Q104:R109',
        'S103:T103', 'S104:T109', 'U103:V103', 'U104:V109',
        'W103:X103', 'W104:X109', 'C111:S111', 'T111:AB111',
      ]),
      numberFormats: Object.freeze([
        Object.freeze({ range: 'C113:C150', pattern: 'h:mm AM/PM' }),
        Object.freeze({ range: 'D113:G151', pattern: '0' }),
        Object.freeze({ range: 'I113:N151', pattern: '0.00%' }),
        Object.freeze({ range: 'O113:S151', pattern: '0.00' }),
        Object.freeze({ range: 'T113:W151', pattern: '0' }),
        Object.freeze({ range: 'X113:Z151', pattern: '[h]:mm:ss' }),
        Object.freeze({ range: 'AA113:AB151', pattern: '0.00%' }),
        Object.freeze({ range: 'AA2', pattern: 'm/d/yyyy' }),
        Object.freeze({ range: 'C2', pattern: 'm/d/yyyy' }),
      ]),
    });
  }

  function applyIntervalConditionalFormatting(intervalSheet) {
    if (
      typeof SpreadsheetApp === 'undefined' ||
      typeof SpreadsheetApp.newConditionalFormatRule !== 'function' ||
      typeof intervalSheet.setConditionalFormatRules !== 'function'
    ) {
      return;
    }
    var retained = typeof intervalSheet.getConditionalFormatRules === 'function'
      ? intervalSheet.getConditionalFormatRules().filter(function (rule) {
        if (!rule || typeof rule.getRanges !== 'function') return true;
        return !rule.getRanges().some(function (range) {
          var firstRow = range.getRow();
          var lastRow = firstRow + range.getNumRows() - 1;
          var firstColumn = range.getColumn();
          var lastColumn = firstColumn + range.getNumColumns() - 1;
          return firstRow <= 151 && lastRow >= 97 && firstColumn <= 28 && lastColumn >= 2;
        });
      })
      : [];
    var rules = retained.slice();
    function add(rangeA1, method, values, background, fontColor) {
      var builder = SpreadsheetApp.newConditionalFormatRule();
      builder = builder[method].apply(builder, values);
      builder = builder.setBackground(background).setRanges([intervalSheet.getRange(rangeA1)]);
      if (fontColor) builder = builder.setFontColor(fontColor);
      rules.push(builder.build());
    }
    function addFormula(rangeA1, formula, background, fontColor) {
      var builder = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(formula)
        .setBackground(background)
        .setRanges([intervalSheet.getRange(rangeA1)]);
      if (fontColor) builder = builder.setFontColor(fontColor);
      rules.push(builder.build());
    }
    add('I113:I151', 'whenNumberLessThan', [0.75], '#F8696B', '#000000');
    add('I113:I151', 'whenNumberBetween', [0.75, 0.78], '#FFC7CE', '#9C0006');
    add('I113:I151', 'whenNumberBetween', [0.780001, 0.799999], '#F4B183', '#000000');
    add('I113:I151', 'whenNumberBetween', [0.8, 0.85], '#C6EFCE', '#006100');
    add('I113:I151', 'whenNumberBetween', [0.850001, 0.9], '#70AD47', '#FFFFFF');
    add('I113:I151', 'whenNumberGreaterThan', [0.9], '#4472C4', '#FFFFFF');
    add('K113:K151', 'whenNumberLessThan', [1.1], '#63BE7B', '#000000');
    add('K113:K151', 'whenNumberBetween', [1.1, 1.299999], '#FFEB84', '#000000');
    add('K113:K151', 'whenNumberGreaterThanOrEqualTo', [1.3], '#F8696B', '#000000');
    ['M113:M151', 'N113:N151'].forEach(function (rangeA1) {
      var column = rangeA1.charAt(0);
      addFormula(rangeA1, '=AND(' + column + '113<>"",' + column + '113<$E$97)',
        '#FFEB84', '#000000');
      addFormula(rangeA1, '=AND(' + column + '113<>"",' + column + '113>=$E$97,' +
        column + '113<=$F$97)', '#63BE7B', '#000000');
      addFormula(rangeA1, '=AND(' + column + '113<>"",' + column + '113>$F$97)',
        '#F8696B', '#000000');
    });
    add('R113:R151', 'whenNumberLessThanOrEqualTo', [45], '#63BE7B', '#000000');
    add('R113:R151', 'whenNumberBetween', [45.000001, 90], '#FFEB84', '#000000');
    add('R113:R151', 'whenNumberGreaterThan', [90], '#F8696B', '#000000');
    add('S113:S151', 'whenNumberBetween', [1, 1.4], '#63BE7B', '#000000');
    add('S113:S151', 'whenNumberBetween', [1.400001, 1.6], '#A9D18E', '#000000');
    add('S113:S151', 'whenNumberBetween', [1.600001, 2], '#FFEB84', '#000000');
    add('S113:S151', 'whenNumberBetween', [2.000001, 2.4], '#F4B183', '#000000');
    add('S113:S151', 'whenNumberGreaterThan', [2.4], '#F8696B', '#000000');
    ['AA113:AA151', 'AB113:AB151'].forEach(function (rangeA1) {
      add(rangeA1, 'whenNumberLessThan', [0.85], '#F8696B', '#000000');
      add(rangeA1, 'whenNumberBetween', [0.85, 0.999999], '#FFEB84', '#000000');
      add(rangeA1, 'whenNumberGreaterThanOrEqualTo', [1], '#63BE7B', '#000000');
    });
    intervalSheet.setConditionalFormatRules(rules);
  }

  function applyIntervalPresentation(intervalSheet) {
    function setNumberFormat(a1, pattern) {
      var range = intervalSheet.getRange(a1);
      if (typeof range.setNumberFormat === 'function') range.setNumberFormat(pattern);
    }
    var presentation = getIntervalPresentationContract();
    presentation.merges.forEach(function (a1) {
      var range = intervalSheet.getRange(a1);
      if (typeof range.breakApart === 'function') range.breakApart();
      if (typeof range.merge === 'function') range.merge();
    });
    if (typeof intervalSheet.setHiddenGridlines === 'function') {
      intervalSheet.setHiddenGridlines(true);
    }
    if (typeof intervalSheet.hideColumns === 'function') intervalSheet.hideColumns(2);
    if (typeof intervalSheet.setColumnWidth === 'function') {
      intervalSheet.setColumnWidth(1, 16);
      intervalSheet.setColumnWidth(2, 252);
      intervalSheet.setColumnWidth(3, 119);
      intervalSheet.setColumnWidths(4, 4, 104);
      intervalSheet.setColumnWidths(8, 21, 119);
    }
    if (typeof intervalSheet.setRowHeight === 'function') {
      intervalSheet.setRowHeight(97, 72);
      intervalSheet.setRowHeight(112, 41);
      intervalSheet.setRowHeights(113, 37, 20);
      intervalSheet.setRowHeight(150, 21);
      intervalSheet.setRowHeight(151, 21);
    }
    var full = intervalSheet.getRange('C102:AB151');
    if (typeof full.setFontFamily === 'function') full.setFontFamily('Aptos Narrow');
    var header = intervalSheet.getRange('B112:AB112');
    if (typeof header.setBackground === 'function') header.setBackground('#4472C4');
    if (typeof header.setFontColor === 'function') header.setFontColor('#FFFFFF');
    if (typeof header.setFontWeight === 'function') header.setFontWeight('bold');
    if (typeof header.setHorizontalAlignment === 'function') header.setHorizontalAlignment('center');
    if (typeof header.setVerticalAlignment === 'function') header.setVerticalAlignment('middle');
    if (typeof header.setWrap === 'function') header.setWrap(true);
    var body = intervalSheet.getRange('C113:AB150');
    if (typeof body.setHorizontalAlignment === 'function') body.setHorizontalAlignment('center');
    if (typeof body.setVerticalAlignment === 'function') body.setVerticalAlignment('middle');
    if (typeof body.setBorder === 'function') {
      body.setBorder(true, true, true, true, true, true, '#B7C9E2', null);
    }
    presentation.numberFormats.forEach(function (entry) {
      setNumberFormat(entry.range, entry.pattern);
    });
    var total = intervalSheet.getRange('C151:AB151');
    if (typeof total.setFontWeight === 'function') total.setFontWeight('bold');
    if (typeof total.setBorder === 'function') {
      var doubleBorder = typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.BorderStyle
        ? SpreadsheetApp.BorderStyle.DOUBLE
        : null;
      total.setBorder(true, null, true, null, null, null, '#203864', doubleBorder);
    }
    var section = intervalSheet.getRange('C111:AB111');
    if (typeof section.setBackground === 'function') section.setBackground('#D9E2F3');
    if (typeof section.setFontWeight === 'function') section.setFontWeight('bold');
    var title = intervalSheet.getRange('K102:X102');
    if (typeof title.setBackground === 'function') title.setBackground('#203864');
    if (typeof title.setFontColor === 'function') title.setFontColor('#FFFFFF');
    if (typeof title.setFontWeight === 'function') title.setFontWeight('bold');
    if (typeof title.setHorizontalAlignment === 'function') title.setHorizontalAlignment('center');
    var cards = intervalSheet.getRange('K104:X109');
    if (typeof cards.setFontSize === 'function') cards.setFontSize(20);
    if (typeof cards.setFontWeight === 'function') cards.setFontWeight('bold');
    if (typeof cards.setHorizontalAlignment === 'function') cards.setHorizontalAlignment('center');
    applyIntervalConditionalFormatting(intervalSheet);
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

    if (step.kind === 'INTERVAL_CHROME') {
      installIntervalChrome(
        requireSheet(spreadsheet, specs.intervalView.reportSheetName),
        specs.intervalView,
      );
      applyIntervalPresentation(
        requireSheet(spreadsheet, specs.intervalView.reportSheetName),
      );
    } else if (step.kind === 'INTERVAL_HEADERS') {
      var intervalSheet = requireSheet(spreadsheet, specs.intervalView.reportSheetName);
      intervalSheet.getRange(specs.intervalView.headerRow, 2).setValue('Remarks');
      intervalSheet.getRange(specs.intervalView.headerRow, 3).setValue(
        specs.intervalView.pstHeader,
      );
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
    } else if (step.kind === 'MOM_CALENDAR') {
      installMomCalendar(
        requireSheet(spreadsheet, specs.mom.reportSheetName),
        specs.mom,
      );
    } else if (step.kind === 'MOM_WEEK_DATE' || step.kind === 'MOM_DAY_NAME') {
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
        specs.mom.weekDateFormulas.length +
        specs.mom.dayNameFormulas.length +
        specs.mom.timeAxisColumns.length +
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
    getIntervalPresentationContract: getIntervalPresentationContract,
    install: install,
    installStep: installStep,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReportingSurfaceTransformationService;
}
