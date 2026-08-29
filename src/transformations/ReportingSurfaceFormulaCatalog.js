var ReportingSurfaceFormulaCatalog = (function () {
  'use strict';

  // Band-Aid Internal View layout (sheet remains named Interval View per CXP-02).
  var INTERVAL_COUNT = 38;
  var HEADER_ROW = 16;
  var FIRST_DATA_ROW = 17;
  var LAST_DATA_ROW = 54;
  var TOTAL_ROW = 65;
  var AXIS_START_HOUR = 4;
  var HANDLED_BLANK_FROM_ROW = 26;
  var VIEW_DATE_COLUMN = 27; // AA
  var VIEW_DATE_ROW = 2;
  // Spill capacity for calendar unpivot (7 days × 48 intervals × 4 blocks).
  var FORECAST_ROW_CAPACITY = 1400;

  // Band-Aid MOM calendar (CHAT MNL + CHAT LV weekly grids).
  var MOM_TITLE_ROW = 1;
  var MOM_SECTION_ROW = 2;
  var MOM_DATE_ROW = 3;
  var MOM_DOW_ROW = 4;
  var MOM_FIRST_TIME_ROW = 5;
  var MOM_LAST_TIME_ROW = 52;
  var MOM_TIME_COUNT = 48;
  var MOM_WEEK_START_CELL = 'B3';

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

  // Band-Aid columns: A=PST datetime, B:Z = 25 metrics.
  var METRIC_COLUMNS = Object.freeze({
    Forecast: 2,
    Offered: 3,
    Handled: 4,
    'Chats in SL': 5,
    Abandoned: 6,
    'SL % Total': 7,
    'SL (Time To Connect)': 8,
    '% of Forecast Offered': 9,
    '% of Forecast Handled': 10,
    Allocation: 11,
    'Cumulative Allocation': 12,
    'AHT (Session)': 13,
    AHT: 14,
    ACW: 15,
    'ASA in Seconds': 16,
    Concurrency: 17,
    Scheduled: 18,
    Required: 19,
    'Actual (SO)': 20,
    'Actual vs Required': 21,
    'Scheduled Hours': 22,
    'Required Hours': 23,
    Actual: 24,
    'Actual to Required': 25,
    'Scheduled to Required': 26,
  });

  function colLetter(column) {
    if (column <= 26) {
      return String.fromCharCode(64 + column);
    }
    if (column <= 52) {
      return 'A' + String.fromCharCode(64 + column - 26);
    }
    var first = Math.floor((column - 1) / 26);
    var second = ((column - 1) % 26) + 1;
    return String.fromCharCode(64 + first) + String.fromCharCode(64 + second);
  }

  function axisDateCriteria() {
    return 'INT(\'Interval View\'!A' + FIRST_DATA_ROW + ':A' + LAST_DATA_ROW + ')';
  }

  function axisTimeCriteria() {
    return 'MOD(\'Interval View\'!A' + FIRST_DATA_ROW + ':A' + LAST_DATA_ROW + ',1)';
  }

  function combinedSitesSumifs(valueColumn) {
    return 'SUMIFS(\'_AGG_INTERVAL\'!' + valueColumn + ':' + valueColumn +
      ',\'_AGG_INTERVAL\'!A:A,' + axisDateCriteria() +
      ',\'_AGG_INTERVAL\'!B:B,' + axisTimeCriteria() +
      ',\'_AGG_INTERVAL\'!C:C,"PH")+' +
      'SUMIFS(\'_AGG_INTERVAL\'!' + valueColumn + ':' + valueColumn +
      ',\'_AGG_INTERVAL\'!A:A,' + axisDateCriteria() +
      ',\'_AGG_INTERVAL\'!B:B,' + axisTimeCriteria() +
      ',\'_AGG_INTERVAL\'!C:C,"LAS")';
  }

  function forecastTypeSumifs(typeName) {
    return 'SUMIFS(\'_AGG_FORECAST\'!E:E,' +
      '\'_AGG_FORECAST\'!A:A,' + axisDateCriteria() +
      ',\'_AGG_FORECAST\'!B:B,' + axisTimeCriteria() +
      ',\'_AGG_FORECAST\'!D:D,"' + typeName + '")';
  }

  function allocationSumifs(valueColumn) {
    return 'SUMIFS(\'_AGG_ALLOCATION\'!' + valueColumn + ':' + valueColumn +
      ',\'_AGG_ALLOCATION\'!A:A,' + axisDateCriteria() +
      ',\'_AGG_ALLOCATION\'!B:B,' + axisTimeCriteria() +
      ',\'_AGG_ALLOCATION\'!C:C,"PH")+' +
      'SUMIFS(\'_AGG_ALLOCATION\'!' + valueColumn + ':' + valueColumn +
      ',\'_AGG_ALLOCATION\'!A:A,' + axisDateCriteria() +
      ',\'_AGG_ALLOCATION\'!B:B,' + axisTimeCriteria() +
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
      'IF(ROW(\'Interval View\'!A' + FIRST_DATA_ROW + ':A' + LAST_DATA_ROW + ')>=' +
      HANDLED_BLANK_FROM_ROW + ',' +
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

  // Band-Aid: 38 half-hours from View Date AA2 + 04:00 through 22:30.
  function intervalAxisPstFormula() {
    return '=IF($AA$2="","",SEQUENCE(' + INTERVAL_COUNT + ',1,$AA$2+TIME(' +
      AXIS_START_HOUR + ',0,0),TIME(0,30,0)))';
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
        formula: derivedFormula('IFERROR(C' + FIRST_DATA_ROW + ':C' + LAST_DATA_ROW +
          '-D' + FIRST_DATA_ROW + ':D' + LAST_DATA_ROW + ',"")'),
      },
      {
        anchorColumn: METRIC_COLUMNS['SL % Total'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IFERROR(E' + FIRST_DATA_ROW + ':E' + LAST_DATA_ROW +
          '/C' + FIRST_DATA_ROW + ':C' + LAST_DATA_ROW + ',"")'),
      },
      { anchorColumn: METRIC_COLUMNS['SL (Time To Connect)'], anchorRow: FIRST_DATA_ROW, formula: intervalMetricFormula('G') },
      {
        anchorColumn: METRIC_COLUMNS['% of Forecast Offered'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IF(C' + FIRST_DATA_ROW + ':C' + LAST_DATA_ROW + '=0," ' +
          '",C' + FIRST_DATA_ROW + ':C' + LAST_DATA_ROW + '/IF(OR(B' + FIRST_DATA_ROW +
          ':B' + LAST_DATA_ROW + '=0,B' + FIRST_DATA_ROW + ':B' + LAST_DATA_ROW +
          '=""),1,B' + FIRST_DATA_ROW + ':B' + LAST_DATA_ROW + '))'),
      },
      {
        anchorColumn: METRIC_COLUMNS['% of Forecast Handled'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IF(D' + FIRST_DATA_ROW + ':D' + LAST_DATA_ROW + '=0," ' +
          '",D' + FIRST_DATA_ROW + ':D' + LAST_DATA_ROW + '/IF(OR(B' + FIRST_DATA_ROW +
          ':B' + LAST_DATA_ROW + '=0,B' + FIRST_DATA_ROW + ':B' + LAST_DATA_ROW +
          '=""),1,B' + FIRST_DATA_ROW + ':B' + LAST_DATA_ROW + '))'),
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
        formula: derivedFormula('IFERROR(T' + FIRST_DATA_ROW + ':T' + LAST_DATA_ROW +
          '-S' + FIRST_DATA_ROW + ':S' + LAST_DATA_ROW + ',"")'),
      },
      {
        anchorColumn: METRIC_COLUMNS['Scheduled Hours'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IF(OR(R' + FIRST_DATA_ROW + ':R' + LAST_DATA_ROW +
          '="",R' + FIRST_DATA_ROW + ':R' + LAST_DATA_ROW + '=0),"",' +
          '(R' + FIRST_DATA_ROW + ':R' + LAST_DATA_ROW + '*30)/1440)'),
      },
      {
        anchorColumn: METRIC_COLUMNS['Required Hours'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IF(OR(S' + FIRST_DATA_ROW + ':S' + LAST_DATA_ROW +
          '="",S' + FIRST_DATA_ROW + ':S' + LAST_DATA_ROW + '=0),"",' +
          '(S' + FIRST_DATA_ROW + ':S' + LAST_DATA_ROW + '*30)/1440)'),
      },
      {
        anchorColumn: METRIC_COLUMNS.Actual,
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IF(OR(T' + FIRST_DATA_ROW + ':T' + LAST_DATA_ROW +
          '="",T' + FIRST_DATA_ROW + ':T' + LAST_DATA_ROW + '=0),"",' +
          '(T' + FIRST_DATA_ROW + ':T' + LAST_DATA_ROW + '*30)/1440)'),
      },
      {
        anchorColumn: METRIC_COLUMNS['Actual to Required'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IF(OR(X' + FIRST_DATA_ROW + ':X' + LAST_DATA_ROW +
          '="",W' + FIRST_DATA_ROW + ':W' + LAST_DATA_ROW + '="",W' + FIRST_DATA_ROW +
          ':W' + LAST_DATA_ROW + '=0),"",IFERROR(X' + FIRST_DATA_ROW + ':X' +
          LAST_DATA_ROW + '/W' + FIRST_DATA_ROW + ':W' + LAST_DATA_ROW + ',""))'),
      },
      {
        anchorColumn: METRIC_COLUMNS['Scheduled to Required'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('R' + FIRST_DATA_ROW + ':R' + LAST_DATA_ROW +
          '/S' + FIRST_DATA_ROW + ':S' + LAST_DATA_ROW),
      },
    ]);
  }

  function intervalViewTotals() {
    return Object.freeze([
      {
        anchorColumn: METRIC_COLUMNS.Forecast,
        anchorRow: TOTAL_ROW,
        formula: totalFormula('B', 'IF(COUNT(B17:B54)=0,"",SUM(B17:B54))'),
      },
      { anchorColumn: METRIC_COLUMNS.Offered, anchorRow: TOTAL_ROW, formula: totalFormula('C', 'SUM(C17:C54)') },
      { anchorColumn: METRIC_COLUMNS.Handled, anchorRow: TOTAL_ROW, formula: totalFormula('D', 'SUM(D17:D54)') },
      { anchorColumn: METRIC_COLUMNS['Chats in SL'], anchorRow: TOTAL_ROW, formula: totalFormula('E', 'SUM(E17:E54)') },
      { anchorColumn: METRIC_COLUMNS.Abandoned, anchorRow: TOTAL_ROW, formula: totalFormula('F', 'SUM(F17:F54)') },
      { anchorColumn: METRIC_COLUMNS['SL % Total'], anchorRow: TOTAL_ROW, formula: totalFormula('G', 'IFERROR(E65/C65,"")') },
      {
        anchorColumn: METRIC_COLUMNS['SL (Time To Connect)'],
        anchorRow: TOTAL_ROW,
        formula: totalFormula('H', 'AVERAGE(H17:H54)'),
      },
      {
        anchorColumn: METRIC_COLUMNS['AHT (Session)'],
        anchorRow: TOTAL_ROW,
        formula: totalFormula('M', 'IFERROR(AVERAGE(M17:M54)*63/60,"")'),
      },
      {
        anchorColumn: METRIC_COLUMNS.Scheduled,
        anchorRow: TOTAL_ROW,
        formula: totalFormula('R', 'IF(COUNT(R17:R54)=0,"",AVERAGE(R17:R54))'),
      },
      {
        anchorColumn: METRIC_COLUMNS.Required,
        anchorRow: TOTAL_ROW,
        formula: totalFormula('S', 'IF(COUNT(S17:S54)=0,"",AVERAGE(S17:S54))'),
      },
      {
        anchorColumn: METRIC_COLUMNS['Actual (SO)'],
        anchorRow: TOTAL_ROW,
        formula: totalFormula('T', 'IF(COUNT(T17:T54)=0,"",AVERAGE(T17:T54))'),
      },
      {
        anchorColumn: METRIC_COLUMNS['Scheduled to Required'],
        anchorRow: TOTAL_ROW,
        formula: totalFormula('Z', 'IFERROR(R65/S65,"")'),
      },
    ]);
  }

  function momDayNameFormula(dateCellA1) {
    return '=TEXT(' + dateCellA1 + ',"ddd")';
  }

  function momTimeAxisFormula() {
    return '=SEQUENCE(' + MOM_TIME_COUNT + ',1,0,TIME(0,30,0))';
  }

  // Unpivot Band-Aid calendar blocks into Date/Interval/Site/Type/Value for _AGG_FORECAST.
  // PH = CHAT MNL, LAS = CHAT LV. Forecast AHT grids are RTA-visible only (not bridged).
  function momForecastBridgeFormula() {
    return '=LET(' +
      'times,MOM!$A$5:$A$52,' +
      'datesMnl,MOM!$B$3:$H$3,' +
      'reqMnl,MOM!$B$5:$H$52,' +
      'volMnl,MOM!$J$5:$P$52,' +
      'datesLv,MOM!$Z$3:$AF$3,' +
      'reqLv,MOM!$Z$5:$AF$52,' +
      'volLv,MOM!$AH$5:$AN$52,' +
      'nDates,COLUMNS(datesMnl),' +
      'nTimes,ROWS(times),' +
      'n,nDates*nTimes,' +
      'block,LAMBDA(dates,vals,site,type,' +
        'MAKEARRAY(n,5,LAMBDA(r,c,' +
          'LET(i,INT((r-1)/nTimes),j,MOD(r-1,nTimes),' +
          'CHOOSE(c,' +
            'INDEX(dates,1,i+1),' +
            'INDEX(times,j+1,1),' +
            'site,' +
            'type,' +
            'INDEX(vals,j+1,i+1)' +
          '))' +
        '))' +
      '),' +
      'raw,VSTACK(' +
        'block(datesMnl,volMnl,"PH","Forecast"),' +
        'block(datesMnl,reqMnl,"PH","Required"),' +
        'block(datesLv,volLv,"LAS","Forecast"),' +
        'block(datesLv,reqLv,"LAS","Required")' +
      '),' +
      'FILTER(raw,INDEX(raw,0,1)<>"",INDEX(raw,0,5)<>"")' +
    ')';
  }

  function intervalViewSpec() {
    return Object.freeze({
      axisFormulas: Object.freeze([
        { anchorColumn: 1, anchorRow: FIRST_DATA_ROW, formula: intervalAxisPstFormula() },
      ]),
      businessDayAnchor: Object.freeze({ column: VIEW_DATE_COLUMN, row: VIEW_DATE_ROW }),
      datasetName: 'Interval View',
      firstDataRow: FIRST_DATA_ROW,
      headerRow: HEADER_ROW,
      headers: METRIC_HEADERS.slice(),
      headerStartColumn: METRIC_COLUMNS.Forecast,
      intervalCount: INTERVAL_COUNT,
      metricFormulas: intervalViewFormulas(),
      pstHeader: 'PST',
      reportSheetName: 'Interval View',
      sectionLabels: Object.freeze([
        Object.freeze({ column: 1, label: 'Operational Metrics' }),
        Object.freeze({ column: 18, label: 'Staffing' }),
      ]),
      sectionRow: 15,
      totalFormulas: intervalViewTotals(),
      totalLabel: 'Grand Total',
      totalRow: TOTAL_ROW,
      viewDateLabel: 'View Date',
    });
  }

  function buildMomDayNameFormulas(startColumn) {
    var formulas = [];
    var offset;
    for (offset = 0; offset < 7; offset += 1) {
      var column = startColumn + offset;
      var dateCell = colLetter(column) + MOM_DATE_ROW;
      formulas.push(Object.freeze({
        anchorColumn: column,
        anchorRow: MOM_DOW_ROW,
        formula: momDayNameFormula(dateCell),
      }));
    }
    return Object.freeze(formulas);
  }

  function momSpec() {
    // Band-Aid skeleton: CHAT MNL (A:X) + CHAT LV (Y:AV), 48 half-hour rows.
    // Band-Aid shared C3:H3 advances as =B3+1, =C3+1, …
    var mnlDateFormulas = Object.freeze([
      Object.freeze({ anchorColumn: 3, anchorRow: MOM_DATE_ROW, formula: '=B3+1' }),
      Object.freeze({ anchorColumn: 4, anchorRow: MOM_DATE_ROW, formula: '=C3+1' }),
      Object.freeze({ anchorColumn: 5, anchorRow: MOM_DATE_ROW, formula: '=D3+1' }),
      Object.freeze({ anchorColumn: 6, anchorRow: MOM_DATE_ROW, formula: '=E3+1' }),
      Object.freeze({ anchorColumn: 7, anchorRow: MOM_DATE_ROW, formula: '=F3+1' }),
      Object.freeze({ anchorColumn: 8, anchorRow: MOM_DATE_ROW, formula: '=G3+1' }),
    ]);
    var mirrorDateCols = Object.freeze([
      10, 11, 12, 13, 14, 15, 16,
      18, 19, 20, 21, 22, 23, 24,
      26, 27, 28, 29, 30, 31, 32,
      34, 35, 36, 37, 38, 39, 40,
      42, 43, 44, 45, 46, 47, 48,
    ]);
    var mirrorDateFormulas = Object.freeze(mirrorDateCols.map(function (column, index) {
      var sourceColumn = 2 + (index % 7);
      return Object.freeze({
        anchorColumn: column,
        anchorRow: MOM_DATE_ROW,
        formula: '=$' + colLetter(sourceColumn) + '$' + MOM_DATE_ROW,
      });
    }));
    var dayNameStartColumns = Object.freeze([2, 10, 18, 26, 34, 42]);
    var dayNameFormulas = [];
    dayNameStartColumns.forEach(function (startColumn) {
      buildMomDayNameFormulas(startColumn).forEach(function (entry) {
        dayNameFormulas.push(entry);
      });
    });

    return Object.freeze({
      datasetName: 'MOM',
      reportSheetName: 'MOM',
      titleMnl: 'CHAT MNL',
      titleLv: 'CHAT LV',
      sectionLabels: Object.freeze([
        Object.freeze({ column: 1, label: 'Required FTE at Plan' }),
        Object.freeze({ column: 9, label: 'Forecasted Volume' }),
        Object.freeze({ column: 17, label: 'Forecast AHT' }),
        Object.freeze({ column: 25, label: 'Required FTE at Plan' }),
        Object.freeze({ column: 33, label: 'Forecasted Volume' }),
        Object.freeze({ column: 41, label: 'Forecast AHT' }),
      ]),
      pstLabels: Object.freeze([1, 9, 17, 25, 33, 41]),
      timeLabels: Object.freeze([1, 9, 17, 25, 33, 41]),
      timeAxisFormula: momTimeAxisFormula(),
      timeAxisColumns: Object.freeze([1, 9, 17, 25, 33, 41]),
      firstTimeRow: MOM_FIRST_TIME_ROW,
      lastTimeRow: MOM_LAST_TIME_ROW,
      timeCount: MOM_TIME_COUNT,
      weekStartAnchor: Object.freeze({ column: 2, row: MOM_DATE_ROW }),
      weekDateFormulas: Object.freeze(mnlDateFormulas.concat(mirrorDateFormulas.slice())),
      dayNameFormulas: Object.freeze(dayNameFormulas),
      // Metric input grids (manual): col start for 7 day columns
      inputBlocks: Object.freeze([
        Object.freeze({
          site: 'PH',
          type: 'Required',
          dateStartColumn: 2,
          valueStartColumn: 2,
          label: 'Required FTE at Plan (MNL)',
        }),
        Object.freeze({
          site: 'PH',
          type: 'Forecast',
          dateStartColumn: 2,
          valueStartColumn: 10,
          label: 'Forecasted Volume (MNL)',
        }),
        Object.freeze({
          site: 'LAS',
          type: 'Required',
          dateStartColumn: 26,
          valueStartColumn: 26,
          label: 'Required FTE at Plan (LV)',
        }),
        Object.freeze({
          site: 'LAS',
          type: 'Forecast',
          dateStartColumn: 26,
          valueStartColumn: 34,
          label: 'Forecasted Volume (LV)',
        }),
      ]),
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
    AXIS_START_HOUR: AXIS_START_HOUR,
    FIRST_DATA_ROW: FIRST_DATA_ROW,
    FORECAST_ROW_CAPACITY: FORECAST_ROW_CAPACITY,
    HANDLED_BLANK_FROM_ROW: HANDLED_BLANK_FROM_ROW,
    HEADER_ROW: HEADER_ROW,
    INTERVAL_COUNT: INTERVAL_COUNT,
    LAST_DATA_ROW: LAST_DATA_ROW,
    METRIC_COLUMNS: METRIC_COLUMNS,
    METRIC_HEADERS: METRIC_HEADERS,
    MOM_DATE_ROW: MOM_DATE_ROW,
    MOM_DOW_ROW: MOM_DOW_ROW,
    MOM_FIRST_TIME_ROW: MOM_FIRST_TIME_ROW,
    MOM_LAST_TIME_ROW: MOM_LAST_TIME_ROW,
    MOM_SECTION_ROW: MOM_SECTION_ROW,
    MOM_TIME_COUNT: MOM_TIME_COUNT,
    MOM_TITLE_ROW: MOM_TITLE_ROW,
    MOM_WEEK_START_CELL: MOM_WEEK_START_CELL,
    TOTAL_ROW: TOTAL_ROW,
    VIEW_DATE_COLUMN: VIEW_DATE_COLUMN,
    VIEW_DATE_ROW: VIEW_DATE_ROW,
    forecastBridgeSpec: forecastBridgeSpec,
    intervalViewSpec: intervalViewSpec,
    list: list,
    momSpec: momSpec,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReportingSurfaceFormulaCatalog;
}
