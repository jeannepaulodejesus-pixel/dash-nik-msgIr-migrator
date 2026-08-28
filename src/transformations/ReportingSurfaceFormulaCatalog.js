var ReportingSurfaceFormulaCatalog = (function () {
  'use strict';

  var INTERVAL_COUNT = 38;
  var HEADER_ROW = 112;
  var FIRST_DATA_ROW = 113;
  var LAST_DATA_ROW = 150;
  var TOTAL_ROW = 151;
  var MOM_STAGING_START = 13;
  var MOM_STAGING_END = 50;
  var FORECAST_ROW_CAPACITY = 50;

  var METRIC_HEADERS = Object.freeze([
    'Forecast',
    'Offered',
    'Handled',
    'Chats in SL',
    'Abandoned',
    'SL % Total',
    'SL (Time To Connect)',
    '% of Forecast Offered',
    '% of Forecast Handled',
    'Allocation',
    'Cumulative Allocation',
    'AHT (Session)',
    'AHT',
    'ACW',
    'ASA in Seconds',
    'Concurrency',
    'Scheduled',
    'Required',
    'Actual (SO)',
    'Actual vs Required',
    'Scheduled Hours',
    'Required Hours',
    'Actual',
    'Actual to Required',
    'Scheduled to Required',
  ]);

  var METRIC_COLUMNS = Object.freeze({
    Forecast: 4,
    Offered: 5,
    Handled: 6,
    'Chats in SL': 7,
    Abandoned: 8,
    'SL % Total': 9,
    'SL (Time To Connect)': 10,
    '% of Forecast Offered': 11,
    '% of Forecast Handled': 12,
    Allocation: 13,
    'Cumulative Allocation': 14,
    'AHT (Session)': 15,
    AHT: 16,
    ACW: 17,
    'ASA in Seconds': 18,
    Concurrency: 19,
    Scheduled: 20,
    Required: 21,
    'Actual (SO)': 22,
    'Actual vs Required': 23,
    'Scheduled Hours': 24,
    'Required Hours': 25,
    Actual: 26,
    'Actual to Required': 27,
    'Scheduled to Required': 28,
  });

  function colLetter(column) {
    if (column <= 26) {
      return String.fromCharCode(64 + column);
    }
    return 'A' + String.fromCharCode(64 + column - 26);
  }

  function combinedSitesSumifs(valueColumn) {
    return 'SUMIFS(\'_AGG_INTERVAL\'!' + valueColumn + ':' + valueColumn +
      ',\'_AGG_INTERVAL\'!A:A,\'Interval View\'!A' + FIRST_DATA_ROW + ':A' + LAST_DATA_ROW +
      ',\'_AGG_INTERVAL\'!B:B,\'Interval View\'!B' + FIRST_DATA_ROW + ':B' + LAST_DATA_ROW +
      ',\'_AGG_INTERVAL\'!C:C,"PH")+' +
      'SUMIFS(\'_AGG_INTERVAL\'!' + valueColumn + ':' + valueColumn +
      ',\'_AGG_INTERVAL\'!A:A,\'Interval View\'!A' + FIRST_DATA_ROW + ':A' + LAST_DATA_ROW +
      ',\'_AGG_INTERVAL\'!B:B,\'Interval View\'!B' + FIRST_DATA_ROW + ':B' + LAST_DATA_ROW +
      ',\'_AGG_INTERVAL\'!C:C,"LAS")';
  }

  function forecastTypeSumifs(typeName) {
    return 'SUMIFS(\'_AGG_FORECAST\'!E:E,' +
      '\'_AGG_FORECAST\'!A:A,\'Interval View\'!A' + FIRST_DATA_ROW + ':A' + LAST_DATA_ROW +
      ',\'_AGG_FORECAST\'!B:B,\'Interval View\'!B' + FIRST_DATA_ROW + ':B' + LAST_DATA_ROW +
      ',\'_AGG_FORECAST\'!D:D,"' + typeName + '")';
  }

  function allocationSumifs(valueColumn) {
    return 'SUMIFS(\'_AGG_ALLOCATION\'!' + valueColumn + ':' + valueColumn +
      ',\'_AGG_ALLOCATION\'!A:A,\'Interval View\'!A' + FIRST_DATA_ROW + ':A' + LAST_DATA_ROW +
      ',\'_AGG_ALLOCATION\'!B:B,\'Interval View\'!B' + FIRST_DATA_ROW + ':B' + LAST_DATA_ROW +
      ',\'_AGG_ALLOCATION\'!C:C,"PH")+' +
      'SUMIFS(\'_AGG_ALLOCATION\'!' + valueColumn + ':' + valueColumn +
      ',\'_AGG_ALLOCATION\'!A:A,\'Interval View\'!A' + FIRST_DATA_ROW + ':A' + LAST_DATA_ROW +
      ',\'_AGG_ALLOCATION\'!B:B,\'Interval View\'!B' + FIRST_DATA_ROW + ':B' + LAST_DATA_ROW +
      ',\'_AGG_ALLOCATION\'!C:C,"LAS")';
  }

  function arrayWrap(expression, blankCheckColumn) {
    var col = blankCheckColumn || 'A';
    return '=ARRAYFORMULA(IF(\'Interval View\'!' + col + FIRST_DATA_ROW + ':' + col +
      LAST_DATA_ROW + '="","",' + expression + '))';
  }

  function offeredFormula() {
    var sumExpr = combinedSitesSumifs('D');
    return arrayWrap(
      'IF(' + sumExpr + '=0,"",' + sumExpr + ')',
      'A',
    );
  }

  function handledFormula() {
    var sumExpr = combinedSitesSumifs('E');
    return '=ARRAYFORMULA(IF(\'Interval View\'!A' + FIRST_DATA_ROW + ':A' + LAST_DATA_ROW +
      '="","",' +
      'IF(ROW(\'Interval View\'!A' + FIRST_DATA_ROW + ':A' + LAST_DATA_ROW + ')>=122,' +
      'IF(' + sumExpr + '=0,"",' + sumExpr + '),' + sumExpr + ')))';
  }

  function intervalMetricFormula(columnLetter) {
    return arrayWrap(combinedSitesSumifs(columnLetter), 'A');
  }

  function ahtSessionFormula() {
    var sumExpr = combinedSitesSumifs('H');
    return arrayWrap('IF(' + sumExpr + '=0,"",' + sumExpr + '/63)', 'A');
  }

  function forecastFormula() {
    return arrayWrap('IFERROR(' + forecastTypeSumifs('Forecast') + ',0)', 'A');
  }

  function forecastTypeFormula(typeName) {
    return arrayWrap(
      'IF(' + forecastTypeSumifs(typeName) + '=0,"",' + forecastTypeSumifs(typeName) + ')',
      'A',
    );
  }

  function allocationFormula() {
    return arrayWrap(allocationSumifs('E'), 'A');
  }

  function cumulativeAllocationFormula() {
    return arrayWrap(allocationSumifs('F'), 'A');
  }

  function derivedFormula(expression) {
    return arrayWrap(expression, 'A');
  }

  function intervalAxisDateFormula() {
    return '=ARRAYFORMULA(IF(ROW(A' + FIRST_DATA_ROW + ':A' + LAST_DATA_ROW + ')-' +
      (FIRST_DATA_ROW - 1) + '>' + INTERVAL_COUNT + ',"",' +
      'IF(\'Interval View\'!$A$1="","",\'Interval View\'!$A$1+INT((ROW(A' + FIRST_DATA_ROW +
      ':A' + LAST_DATA_ROW + ')-' + (FIRST_DATA_ROW - 1) + ')/2))))';
  }

  function intervalAxisTimeFormula() {
    return '=ARRAYFORMULA(IF(ROW(B' + FIRST_DATA_ROW + ':B' + LAST_DATA_ROW + ')-' +
      (FIRST_DATA_ROW - 1) + '>' + INTERVAL_COUNT + ',"",' +
      'IF(\'Interval View\'!$A$1="","",TIME(MOD((ROW(B' + FIRST_DATA_ROW + ':B' +
      LAST_DATA_ROW + ')-' + (FIRST_DATA_ROW - 1) + '),2)*30,0,0))))';
  }

  function totalFormula(column, expression) {
    return '=' + expression;
  }

  function intervalViewFormulas() {
    return Object.freeze([
      { anchorColumn: METRIC_COLUMNS.Forecast, anchorRow: FIRST_DATA_ROW, formula: forecastFormula() },
      { anchorColumn: METRIC_COLUMNS.Offered, anchorRow: FIRST_DATA_ROW, formula: offeredFormula() },
      { anchorColumn: METRIC_COLUMNS.Handled, anchorRow: FIRST_DATA_ROW, formula: handledFormula() },
      { anchorColumn: METRIC_COLUMNS['Chats in SL'], anchorRow: FIRST_DATA_ROW, formula: intervalMetricFormula('F') },
      {
        anchorColumn: METRIC_COLUMNS.Abandoned,
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IFERROR(E' + FIRST_DATA_ROW + ':E' + LAST_DATA_ROW +
          '-F' + FIRST_DATA_ROW + ':F' + LAST_DATA_ROW + ',"")'),
      },
      {
        anchorColumn: METRIC_COLUMNS['SL % Total'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IFERROR(G' + FIRST_DATA_ROW + ':G' + LAST_DATA_ROW +
          '/E' + FIRST_DATA_ROW + ':E' + LAST_DATA_ROW + ',"")'),
      },
      { anchorColumn: METRIC_COLUMNS['SL (Time To Connect)'], anchorRow: FIRST_DATA_ROW, formula: intervalMetricFormula('G') },
      {
        anchorColumn: METRIC_COLUMNS['% of Forecast Offered'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IF(E' + FIRST_DATA_ROW + ':E' + LAST_DATA_ROW + '=0," ' +
          '",E' + FIRST_DATA_ROW + ':E' + LAST_DATA_ROW + '/D' + FIRST_DATA_ROW + ':D' +
          LAST_DATA_ROW + ')'),
      },
      {
        anchorColumn: METRIC_COLUMNS['% of Forecast Handled'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IF(F' + FIRST_DATA_ROW + ':F' + LAST_DATA_ROW + '=0," ' +
          '",F' + FIRST_DATA_ROW + ':F' + LAST_DATA_ROW + '/D' + FIRST_DATA_ROW + ':D' +
          LAST_DATA_ROW + ')'),
      },
      { anchorColumn: METRIC_COLUMNS.Allocation, anchorRow: FIRST_DATA_ROW, formula: allocationFormula() },
      { anchorColumn: METRIC_COLUMNS['Cumulative Allocation'], anchorRow: FIRST_DATA_ROW, formula: cumulativeAllocationFormula() },
      { anchorColumn: METRIC_COLUMNS['AHT (Session)'], anchorRow: FIRST_DATA_ROW, formula: ahtSessionFormula() },
      { anchorColumn: METRIC_COLUMNS.AHT, anchorRow: FIRST_DATA_ROW, formula: intervalMetricFormula('I') },
      { anchorColumn: METRIC_COLUMNS.ACW, anchorRow: FIRST_DATA_ROW, formula: intervalMetricFormula('J') },
      { anchorColumn: METRIC_COLUMNS['ASA in Seconds'], anchorRow: FIRST_DATA_ROW, formula: intervalMetricFormula('K') },
      { anchorColumn: METRIC_COLUMNS.Concurrency, anchorRow: FIRST_DATA_ROW, formula: intervalMetricFormula('L') },
      { anchorColumn: METRIC_COLUMNS.Scheduled, anchorRow: FIRST_DATA_ROW, formula: forecastTypeFormula('Scheduled') },
      { anchorColumn: METRIC_COLUMNS.Required, anchorRow: FIRST_DATA_ROW, formula: forecastTypeFormula('Required') },
      { anchorColumn: METRIC_COLUMNS['Actual (SO)'], anchorRow: FIRST_DATA_ROW, formula: forecastTypeFormula('Actual (SO)') },
      {
        anchorColumn: METRIC_COLUMNS['Actual vs Required'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IFERROR(V' + FIRST_DATA_ROW + ':V' + LAST_DATA_ROW +
          '-U' + FIRST_DATA_ROW + ':U' + LAST_DATA_ROW + ',"")'),
      },
      {
        anchorColumn: METRIC_COLUMNS['Scheduled Hours'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IFERROR((T' + FIRST_DATA_ROW + ':T' + LAST_DATA_ROW +
          '*30)/1440,"")'),
      },
      {
        anchorColumn: METRIC_COLUMNS['Required Hours'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IFERROR((U' + FIRST_DATA_ROW + ':U' + LAST_DATA_ROW +
          '*30)/1440,"")'),
      },
      {
        anchorColumn: METRIC_COLUMNS.Actual,
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IFERROR((V' + FIRST_DATA_ROW + ':V' + LAST_DATA_ROW +
          '*30)/1440,"")'),
      },
      {
        anchorColumn: METRIC_COLUMNS['Actual to Required'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IFERROR(Z' + FIRST_DATA_ROW + ':Z' + LAST_DATA_ROW +
          '/Y' + FIRST_DATA_ROW + ':Y' + LAST_DATA_ROW + ',"")'),
      },
      {
        anchorColumn: METRIC_COLUMNS['Scheduled to Required'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('T' + FIRST_DATA_ROW + ':T' + LAST_DATA_ROW +
          '/U' + FIRST_DATA_ROW + ':U' + LAST_DATA_ROW),
      },
    ]);
  }

  function intervalViewTotals() {
    return Object.freeze([
      { anchorColumn: METRIC_COLUMNS.Forecast, anchorRow: TOTAL_ROW, formula: totalFormula('D', 'SUM(D113:D150)') },
      { anchorColumn: METRIC_COLUMNS.Offered, anchorRow: TOTAL_ROW, formula: totalFormula('E', 'SUM(E113:E150)') },
      { anchorColumn: METRIC_COLUMNS.Handled, anchorRow: TOTAL_ROW, formula: totalFormula('F', 'SUM(F113:F150)') },
      { anchorColumn: METRIC_COLUMNS['Chats in SL'], anchorRow: TOTAL_ROW, formula: totalFormula('G', 'SUM(G113:G150)') },
      { anchorColumn: METRIC_COLUMNS.Abandoned, anchorRow: TOTAL_ROW, formula: totalFormula('H', 'SUM(H113:H150)') },
      { anchorColumn: METRIC_COLUMNS['SL % Total'], anchorRow: TOTAL_ROW, formula: totalFormula('I', 'G151/E151') },
      {
        anchorColumn: METRIC_COLUMNS['SL (Time To Connect)'],
        anchorRow: TOTAL_ROW,
        formula: totalFormula('J', 'AVERAGE(J113:J150)'),
      },
      {
        anchorColumn: METRIC_COLUMNS['AHT (Session)'],
        anchorRow: TOTAL_ROW,
        formula: totalFormula('O', 'IFERROR(AVERAGE(O113:O150)*63/60,"")'),
      },
      { anchorColumn: METRIC_COLUMNS.Scheduled, anchorRow: TOTAL_ROW, formula: totalFormula('T', 'SUM(T113:T150)/COUNT(T113:T150)') },
      { anchorColumn: METRIC_COLUMNS.Required, anchorRow: TOTAL_ROW, formula: totalFormula('U', 'SUM(U113:U150)/COUNT(U113:U150)') },
      { anchorColumn: METRIC_COLUMNS['Actual (SO)'], anchorRow: TOTAL_ROW, formula: totalFormula('V', 'SUM(V113:V150)/COUNT(V113:V150)') },
      {
        anchorColumn: METRIC_COLUMNS['Scheduled to Required'],
        anchorRow: TOTAL_ROW,
        formula: totalFormula('AB', 'IFERROR(T151/U151,"")'),
      },
    ]);
  }

  function momWeekHeaderFormula(columnIndex) {
    var offset = columnIndex - 2;
    return '=IF($A$1="","",$A$1+' + offset + ')';
  }

  function momForecastBridgeFormula() {
    return '=QUERY(MOM!A' + MOM_STAGING_START + ':E' + MOM_STAGING_END +
      ',"select Col1, Col2, Col3, Col4, Col5 where Col1 is not null ' +
      'label Col1 \'\', Col2 \'\', Col3 \'\', Col4 \'\', Col5 \'\'",0)';
  }

  function intervalViewSpec() {
    return Object.freeze({
      axisFormulas: Object.freeze([
        { anchorColumn: 1, anchorRow: FIRST_DATA_ROW, formula: intervalAxisDateFormula() },
        { anchorColumn: 2, anchorRow: FIRST_DATA_ROW, formula: intervalAxisTimeFormula() },
      ]),
      businessDayAnchor: Object.freeze({ column: 1, row: 1 }),
      datasetName: 'Interval View',
      firstDataRow: FIRST_DATA_ROW,
      headerRow: HEADER_ROW,
      headers: METRIC_HEADERS.slice(),
      headerStartColumn: METRIC_COLUMNS.Forecast,
      intervalCount: INTERVAL_COUNT,
      metricFormulas: intervalViewFormulas(),
      reportSheetName: 'Interval View',
      totalFormulas: intervalViewTotals(),
      totalRow: TOTAL_ROW,
    });
  }

  function momSpec() {
    return Object.freeze({
      datasetName: 'MOM',
      reportSheetName: 'MOM',
      stagingHeaders: Object.freeze(['Date', 'Interval', 'Site', 'Type', 'Value']),
      stagingHeaderRow: 12,
      stagingStartRow: MOM_STAGING_START,
      stagingEndRow: MOM_STAGING_END,
      weekHeaderFormulas: Object.freeze([
        { anchorColumn: 2, anchorRow: 4, formula: momWeekHeaderFormula(2) },
        { anchorColumn: 3, anchorRow: 4, formula: momWeekHeaderFormula(3) },
        { anchorColumn: 4, anchorRow: 4, formula: momWeekHeaderFormula(4) },
        { anchorColumn: 5, anchorRow: 4, formula: momWeekHeaderFormula(5) },
        { anchorColumn: 6, anchorRow: 4, formula: momWeekHeaderFormula(6) },
        { anchorColumn: 7, anchorRow: 4, formula: momWeekHeaderFormula(7) },
        { anchorColumn: 8, anchorRow: 4, formula: momWeekHeaderFormula(8) },
      ]),
      weekStartAnchor: Object.freeze({ column: 1, row: 1 }),
    });
  }

  function forecastBridgeSpec() {
    return Object.freeze({
      aggregationSheetName: '_AGG_FORECAST',
      bridgeFormula: momForecastBridgeFormula(),
      datasetName: 'Forecast Bridge',
      formulaAnchor: Object.freeze({ column: 1, row: 2 }),
      rowCapacity: FORECAST_ROW_CAPACITY,
    });
  }

  function list() {
    return Object.freeze([intervalViewSpec(), momSpec(), forecastBridgeSpec()]);
  }

  return Object.freeze({
    FIRST_DATA_ROW: FIRST_DATA_ROW,
    FORECAST_ROW_CAPACITY: FORECAST_ROW_CAPACITY,
    HEADER_ROW: HEADER_ROW,
    INTERVAL_COUNT: INTERVAL_COUNT,
    LAST_DATA_ROW: LAST_DATA_ROW,
    METRIC_COLUMNS: METRIC_COLUMNS,
    METRIC_HEADERS: METRIC_HEADERS,
    MOM_STAGING_END: MOM_STAGING_END,
    MOM_STAGING_START: MOM_STAGING_START,
    TOTAL_ROW: TOTAL_ROW,
    forecastBridgeSpec: forecastBridgeSpec,
    intervalViewSpec: intervalViewSpec,
    list: list,
    momSpec: momSpec,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReportingSurfaceFormulaCatalog;
}
