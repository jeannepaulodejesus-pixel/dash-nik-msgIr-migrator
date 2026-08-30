var ReportingSurfaceFormulaCatalog = (function () {
  'use strict';

  // Verified WB0817 operational surface. Keep metric semantics separate from
  // presentation styling, which the transformation service applies natively.
  var INTERVAL_COUNT = 38;
  var HEADER_ROW = 112;
  var FIRST_DATA_ROW = 113;
  var LAST_DATA_ROW = 150;
  var TOTAL_ROW = 151;
  var AXIS_START_HOUR = 4;
  var HANDLED_BLANK_FROM_ROW = 122;
  var VIEW_DATE_COLUMN = 27; // AA
  var VIEW_DATE_ROW = 2;
  // Report lookup keys are derived inside MAP from AA2 + the PST axis. No
  // visible helper columns are allowed on the operational surface.
  var DATE_KEY_COLUMN = null;
  var INTERVAL_KEY_COLUMN = null;
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

  // Control columns: B=Remarks, C=PST, D:AB = 25 metrics.
  var METRIC_COLUMNS = Object.freeze({
    Forecast: 4, Offered: 5, Handled: 6, 'Chats in SL': 7, Abandoned: 8,
    'SL % Total': 9, 'SL (Time To Connect)': 10,
    '% of Forecast Offered': 11, '% of Forecast Handled': 12,
    Allocation: 13, 'Cumulative Allocation': 14, 'AHT (Session)': 15,
    AHT: 16, ACW: 17, 'ASA in Seconds': 18, Concurrency: 19,
    Scheduled: 20, Required: 21, 'Actual (SO)': 22,
    'Actual vs Required': 23, 'Scheduled Hours': 24,
    'Required Hours': 25, Actual: 26, 'Actual to Required': 27,
    'Scheduled to Required': 28,
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

  // MAP forces per-row lookup. The date comes from the operator-owned AA2
  // anchor; the exact time fraction is derived by index to avoid float drift.
  function mapLookup(innerExpression) {
    return '=MAP(\'Interval View\'!C' + FIRST_DATA_ROW + ':C' + LAST_DATA_ROW +
      ',SEQUENCE(' + INTERVAL_COUNT + '),LAMBDA(pst,i,IF(OR($AA$2="",pst=""),"",' +
      'LET(d,INT($AA$2),t,(' + AXIS_START_HOUR + '*60+(i-1)*30)/1440,' +
      innerExpression + '))))';
  }

  function combinedSitesSumifs(valueColumn) {
    return 'SUMPRODUCT((INT(\'_AGG_INTERVAL\'!$A$2:$A$51)=INT(d))*' +
      '(ROUND(\'_AGG_INTERVAL\'!$B$2:$B$51*1440)=ROUND(t*1440))*' +
      '((\'_AGG_INTERVAL\'!$C$2:$C$51="PH")+' +
      '(\'_AGG_INTERVAL\'!$C$2:$C$51="LAS"))*' +
      'N(\'_AGG_INTERVAL\'!$' + valueColumn + '$2:$' + valueColumn + '$51))';
  }

  function combinedSitesMatchCount() {
    return 'SUMPRODUCT((INT(\'_AGG_INTERVAL\'!$A$2:$A$51)=INT(d))*' +
      '(ROUND(\'_AGG_INTERVAL\'!$B$2:$B$51*1440)=ROUND(t*1440))*' +
      '((\'_AGG_INTERVAL\'!$C$2:$C$51="PH")+' +
      '(\'_AGG_INTERVAL\'!$C$2:$C$51="LAS")))';
  }

  function allSitesWeightedAverage(valueColumn, countColumn) {
    return 'IFERROR(SUMPRODUCT((INT(\'_AGG_INTERVAL\'!$A$2:$A$51)=INT(d))*' +
      '(ROUND(\'_AGG_INTERVAL\'!$B$2:$B$51*1440)=ROUND(t*1440))*N(\'_AGG_INTERVAL\'!$' + valueColumn +
      '$2:$' + valueColumn + '$51)*N(\'_AGG_INTERVAL\'!$' + countColumn + '$2:$' +
      countColumn + '$51))/SUMPRODUCT((INT(\'_AGG_INTERVAL\'!$A$2:$A$51)=INT(d))*' +
      '(ROUND(\'_AGG_INTERVAL\'!$B$2:$B$51*1440)=ROUND(t*1440))*' +
      'N(\'_AGG_INTERVAL\'!$' + countColumn + '$2:$' + countColumn + '$51)),"")';
  }

  function forecastTypeSumifs(typeName) {
    return 'SUMIFS(\'_AGG_FORECAST\'!E:E,' +
      '\'_AGG_FORECAST\'!A:A,d' +
      ',\'_AGG_FORECAST\'!B:B,t' +
      ',\'_AGG_FORECAST\'!D:D,"' + typeName + '")';
  }

  function allocationRatio(cumulative) {
    var intervalMatch = cumulative
      ? '(ROUND(\'_AGG_ALLOCATION\'!$B$2:$B$51*1440)<=ROUND(t*1440))'
      : '(ROUND(\'_AGG_ALLOCATION\'!$B$2:$B$51*1440)=ROUND(t*1440))';
    var baseMatch = '(INT(\'_AGG_ALLOCATION\'!$A$2:$A$51)=INT(d))*' + intervalMatch;
    var numerator = 'SUMPRODUCT(' + baseMatch +
      '*(\'_AGG_ALLOCATION\'!$D$2:$D$51="INT")*N(\'_AGG_ALLOCATION\'!$E$2:$E$51))';
    var denominator = 'SUMPRODUCT(' + baseMatch +
      '*N(\'_AGG_ALLOCATION\'!$E$2:$E$51))';
    return 'IFERROR(' + numerator + '/' + denominator + ',"")';
  }

  function arrayWrap(expression, blankCheckColumn) {
    var col = blankCheckColumn || 'A';
    return '=ARRAYFORMULA(IF(\'Interval View\'!' + col + FIRST_DATA_ROW + ':' + col +
      LAST_DATA_ROW + '="","",' + expression + '))';
  }

  function offeredFormula() {
    var sumExpr = combinedSitesSumifs('D');
    return mapLookup('IF(' + sumExpr + '=0,"",' + sumExpr + ')');
  }

  function handledFormula() {
    var sumExpr = combinedSitesSumifs('E');
    var blankFromIndex = HANDLED_BLANK_FROM_ROW - FIRST_DATA_ROW + 1;
    return mapLookup('LET(s,' + sumExpr + ',IF(i>=' + blankFromIndex +
      ',IF(s=0,"",s),s))');
  }

  function summedIntervalMetricFormula(columnLetter) {
    var sumExpr = combinedSitesSumifs(columnLetter);
    return mapLookup('IF(' + combinedSitesMatchCount() + '=0,"",' + sumExpr + ')');
  }

  function intervalMetricFormula(columnLetter, countColumnLetter) {
    var avgExpr = allSitesWeightedAverage(columnLetter, countColumnLetter);
    return mapLookup(avgExpr);
  }

  function ahtSessionFormula() {
    var avgExpr = allSitesWeightedAverage('H', 'N');
    return mapLookup('LET(v,' + avgExpr + ',IF(ISNUMBER(v),v/63,""))');
  }

  function forecastFormula() {
    return mapLookup('IFERROR(' + forecastTypeSumifs('Forecast') + ',0)');
  }

  function forecastTypeFormula(typeName) {
    return mapLookup(
      'IF(' + forecastTypeSumifs(typeName) + '=0,"",' + forecastTypeSumifs(typeName) + ')',
    );
  }

  function allocationFormula() {
    return mapLookup(allocationRatio(false));
  }

  function cumulativeAllocationFormula() {
    return mapLookup(allocationRatio(true));
  }

  function derivedFormula(expression) {
    return arrayWrap(expression, 'C');
  }

  // Control-compatible time-only PST axis. AA2 supplies the business date.
  function intervalAxisPstFormula() {
    return '=IF($AA$2="","",SEQUENCE(' + INTERVAL_COUNT + ',1,TIME(' +
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
      { anchorColumn: METRIC_COLUMNS['Chats in SL'], anchorRow: FIRST_DATA_ROW, formula: summedIntervalMetricFormula('F') },
      {
        anchorColumn: METRIC_COLUMNS.Abandoned,
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IF(E' + FIRST_DATA_ROW + ':E' + LAST_DATA_ROW +
          '="","",IFERROR(E' + FIRST_DATA_ROW + ':E' + LAST_DATA_ROW +
          '-F' + FIRST_DATA_ROW + ':F' + LAST_DATA_ROW + ',""))'),
      },
      {
        anchorColumn: METRIC_COLUMNS['SL % Total'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IFERROR(G' + FIRST_DATA_ROW + ':G' + LAST_DATA_ROW +
          '/E' + FIRST_DATA_ROW + ':E' + LAST_DATA_ROW + ',"")'),
      },
      { anchorColumn: METRIC_COLUMNS['SL (Time To Connect)'], anchorRow: FIRST_DATA_ROW, formula: intervalMetricFormula('G', 'M') },
      {
        anchorColumn: METRIC_COLUMNS['% of Forecast Offered'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IF(E' + FIRST_DATA_ROW + ':E' + LAST_DATA_ROW + '=0," ' +
          '",E' + FIRST_DATA_ROW + ':E' + LAST_DATA_ROW + '/IF(((D' + FIRST_DATA_ROW +
          ':D' + LAST_DATA_ROW + '=0)+(D' + FIRST_DATA_ROW + ':D' + LAST_DATA_ROW +
          '=""))>0,1,D' + FIRST_DATA_ROW + ':D' + LAST_DATA_ROW + '))'),
      },
      {
        anchorColumn: METRIC_COLUMNS['% of Forecast Handled'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IF(F' + FIRST_DATA_ROW + ':F' + LAST_DATA_ROW + '=0," ' +
          '",F' + FIRST_DATA_ROW + ':F' + LAST_DATA_ROW + '/IF(((D' + FIRST_DATA_ROW +
          ':D' + LAST_DATA_ROW + '=0)+(D' + FIRST_DATA_ROW + ':D' + LAST_DATA_ROW +
          '=""))>0,1,D' + FIRST_DATA_ROW + ':D' + LAST_DATA_ROW + '))'),
      },
      { anchorColumn: METRIC_COLUMNS.Allocation, anchorRow: FIRST_DATA_ROW, formula: allocationFormula() },
      { anchorColumn: METRIC_COLUMNS['Cumulative Allocation'], anchorRow: FIRST_DATA_ROW, formula: cumulativeAllocationFormula() },
      { anchorColumn: METRIC_COLUMNS['AHT (Session)'], anchorRow: FIRST_DATA_ROW, formula: ahtSessionFormula() },
      { anchorColumn: METRIC_COLUMNS.AHT, anchorRow: FIRST_DATA_ROW, formula: intervalMetricFormula('I', 'O') },
      { anchorColumn: METRIC_COLUMNS.ACW, anchorRow: FIRST_DATA_ROW, formula: intervalMetricFormula('J', 'P') },
      { anchorColumn: METRIC_COLUMNS['ASA in Seconds'], anchorRow: FIRST_DATA_ROW, formula: intervalMetricFormula('K', 'Q') },
      { anchorColumn: METRIC_COLUMNS.Concurrency, anchorRow: FIRST_DATA_ROW, formula: intervalMetricFormula('L', 'R') },
      { anchorColumn: METRIC_COLUMNS.Scheduled, anchorRow: FIRST_DATA_ROW, formula: forecastTypeFormula('Scheduled') },
      { anchorColumn: METRIC_COLUMNS.Required, anchorRow: FIRST_DATA_ROW, formula: forecastTypeFormula('Required') },
      { anchorColumn: METRIC_COLUMNS['Actual (SO)'], anchorRow: FIRST_DATA_ROW, formula: forecastTypeFormula('Actual (SO)') },
      {
        anchorColumn: METRIC_COLUMNS['Actual vs Required'],
        anchorRow: FIRST_DATA_ROW,
        // Band-Aid: blank when Required is blank (blank-blank otherwise becomes 0).
        formula: derivedFormula('IF(U' + FIRST_DATA_ROW + ':U' + LAST_DATA_ROW +
          '="","",V' + FIRST_DATA_ROW + ':V' + LAST_DATA_ROW +
          '-U' + FIRST_DATA_ROW + ':U' + LAST_DATA_ROW + ')'),
      },
      {
        anchorColumn: METRIC_COLUMNS['Scheduled Hours'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IF(((T' + FIRST_DATA_ROW + ':T' + LAST_DATA_ROW +
          '="")+(T' + FIRST_DATA_ROW + ':T' + LAST_DATA_ROW + '=0))>0,"",' +
          '(T' + FIRST_DATA_ROW + ':T' + LAST_DATA_ROW + '*30)/1440)'),
      },
      {
        anchorColumn: METRIC_COLUMNS['Required Hours'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IF(((U' + FIRST_DATA_ROW + ':U' + LAST_DATA_ROW +
          '="")+(U' + FIRST_DATA_ROW + ':U' + LAST_DATA_ROW + '=0))>0,"",' +
          '(U' + FIRST_DATA_ROW + ':U' + LAST_DATA_ROW + '*30)/1440)'),
      },
      {
        anchorColumn: METRIC_COLUMNS.Actual,
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IF(((V' + FIRST_DATA_ROW + ':V' + LAST_DATA_ROW +
          '="")+(V' + FIRST_DATA_ROW + ':V' + LAST_DATA_ROW + '=0))>0,"",' +
          '(V' + FIRST_DATA_ROW + ':V' + LAST_DATA_ROW + '*30)/1440)'),
      },
      {
        anchorColumn: METRIC_COLUMNS['Actual to Required'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IF(((Z' + FIRST_DATA_ROW + ':Z' + LAST_DATA_ROW +
          '="")+(Y' + FIRST_DATA_ROW + ':Y' + LAST_DATA_ROW + '="")+(Y' + FIRST_DATA_ROW +
          ':Y' + LAST_DATA_ROW + '=0))>0,"",IFERROR(Z' + FIRST_DATA_ROW + ':Z' +
          LAST_DATA_ROW + '/Y' + FIRST_DATA_ROW + ':Y' + LAST_DATA_ROW + ',""))'),
      },
      {
        anchorColumn: METRIC_COLUMNS['Scheduled to Required'],
        anchorRow: FIRST_DATA_ROW,
        formula: derivedFormula('IF(((U' + FIRST_DATA_ROW + ':U' + LAST_DATA_ROW +
          '="")+(U' + FIRST_DATA_ROW + ':U' + LAST_DATA_ROW + '=0))>0,"",IFERROR(T' +
          FIRST_DATA_ROW + ':T' + LAST_DATA_ROW + '/U' + FIRST_DATA_ROW + ':U' +
          LAST_DATA_ROW + ',""))'),
      },
    ]);
  }

  function intervalViewTotals() {
    return Object.freeze([
      { anchorColumn: 4, anchorRow: TOTAL_ROW, formula: '=SUM(D113:D150)' },
      { anchorColumn: 5, anchorRow: TOTAL_ROW, formula: '=SUM(E113:E150)' },
      { anchorColumn: 6, anchorRow: TOTAL_ROW, formula: '=SUM(F113:F150)' },
      { anchorColumn: 7, anchorRow: TOTAL_ROW, formula: '=SUM(G113:G150)' },
      { anchorColumn: 8, anchorRow: TOTAL_ROW, formula: '=SUM(H113:H150)' },
      { anchorColumn: 9, anchorRow: TOTAL_ROW, formula: '=IFERROR(G151/E151,"")' },
      { anchorColumn: 10, anchorRow: TOTAL_ROW, formula: '=IFERROR(AVERAGE(J113:J150),"")' },
      { anchorColumn: 11, anchorRow: TOTAL_ROW, formula: '=IFERROR(E151/D151,"")' },
      { anchorColumn: 12, anchorRow: TOTAL_ROW, formula: '=IFERROR(F151/D151,"")' },
      { anchorColumn: 13, anchorRow: TOTAL_ROW, formula: '=IFERROR(SUM(M113:M150),"")' },
      { anchorColumn: 14, anchorRow: TOTAL_ROW, formula: '=IFERROR(M151,"")' },
      { anchorColumn: 15, anchorRow: TOTAL_ROW, formula: '=IFERROR(AVERAGE(O113:O150)*63/60,"")' },
      { anchorColumn: 16, anchorRow: TOTAL_ROW, formula: '=IFERROR(AVERAGE(P113:P150),"")' },
      { anchorColumn: 17, anchorRow: TOTAL_ROW, formula: '=IFERROR(AVERAGE(Q113:Q150),"")' },
      { anchorColumn: 18, anchorRow: TOTAL_ROW, formula: '=IFERROR(AVERAGE(R113:R150),"")' },
      { anchorColumn: 19, anchorRow: TOTAL_ROW, formula: '=IFERROR(AVERAGE(S113:S150),"")' },
      { anchorColumn: 20, anchorRow: TOTAL_ROW, formula: '=IFERROR(AVERAGE(T113:T150),"")' },
      { anchorColumn: 21, anchorRow: TOTAL_ROW, formula: '=IFERROR(AVERAGE(U113:U150),"")' },
      { anchorColumn: 22, anchorRow: TOTAL_ROW, formula: '=IFERROR(AVERAGE(V113:V150),"")' },
      { anchorColumn: 23, anchorRow: TOTAL_ROW, formula: '=IFERROR(V151-U151,"")' },
      { anchorColumn: 24, anchorRow: TOTAL_ROW, formula: '=SUM(X113:X150)' },
      { anchorColumn: 25, anchorRow: TOTAL_ROW, formula: '=SUM(Y113:Y150)' },
      { anchorColumn: 26, anchorRow: TOTAL_ROW, formula: '=SUM(Z113:Z150)' },
      { anchorColumn: 27, anchorRow: TOTAL_ROW, formula: '=IFERROR(Z151/Y151,"")' },
      { anchorColumn: 28, anchorRow: TOTAL_ROW, formula: '=IFERROR(X151/Y151,"")' },
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
      'IFNA(FILTER(raw,INDEX(raw,0,1)<>"",INDEX(raw,0,5)<>""),"")' +
    ')';
  }

  function intervalViewSpec() {
    return Object.freeze({
      axisFormulas: Object.freeze([
        { anchorColumn: 3, anchorRow: FIRST_DATA_ROW, formula: intervalAxisPstFormula() },
      ]),
      businessDayAnchor: Object.freeze({ column: VIEW_DATE_COLUMN, row: VIEW_DATE_ROW }),
      datasetName: 'Interval View',
      dateKeyColumn: DATE_KEY_COLUMN,
      firstDataRow: FIRST_DATA_ROW,
      headerRow: HEADER_ROW,
      headers: METRIC_HEADERS.slice(),
      headerStartColumn: METRIC_COLUMNS.Forecast,
      intervalCount: INTERVAL_COUNT,
      intervalKeyColumn: INTERVAL_KEY_COLUMN,
      lastDataRow: LAST_DATA_ROW,
      metricLineage: Object.freeze({
        controlWorkbook: 'MSG Intraday EOD 0817.xlsx',
        sourceSha256: 'CD8F8EC6F68FBEC85841CD64C251616FCECD0AD67DE4714EFB244F648548E65A',
      }),
      metricFormulas: intervalViewFormulas(),
      ownedRange: 'B97:AB151',
      pstHeader: 'PST',
      reportSheetName: 'Interval View',
      sectionLabels: Object.freeze([
        Object.freeze({ column: 3, label: 'Operational Metrics' }),
        Object.freeze({ column: 20, label: 'Staffing' }),
      ]),
      sectionRow: 111,
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
    DATE_KEY_COLUMN: DATE_KEY_COLUMN,
    FIRST_DATA_ROW: FIRST_DATA_ROW,
    FORECAST_ROW_CAPACITY: FORECAST_ROW_CAPACITY,
    HANDLED_BLANK_FROM_ROW: HANDLED_BLANK_FROM_ROW,
    HEADER_ROW: HEADER_ROW,
    INTERVAL_COUNT: INTERVAL_COUNT,
    INTERVAL_KEY_COLUMN: INTERVAL_KEY_COLUMN,
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
