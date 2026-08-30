var StableAggregationFormulaCatalog = (function () {
  'use strict';

  var ROW_CAPACITY = 50;
  var OFFERED_LAST_ROW = 10001;
  var AHT_LAST_ROW = 15001;

  function offeredVolumeQuery() {
    return '=QUERY({' +
      '\'_CALC_OFFERED\'!A2:A' + OFFERED_LAST_ROW + ',' +
      '\'_CALC_OFFERED\'!B2:B' + OFFERED_LAST_ROW + ',' +
      '\'_CALC_OFFERED\'!C2:C' + OFFERED_LAST_ROW + ',' +
      '\'_CALC_OFFERED\'!H2:H' + OFFERED_LAST_ROW + ',' +
      '\'_CALC_OFFERED\'!I2:I' + OFFERED_LAST_ROW + ',' +
      '\'_CALC_OFFERED\'!L2:L' + OFFERED_LAST_ROW + ',' +
      '\'_CALC_OFFERED\'!D2:D' + OFFERED_LAST_ROW + ',' +
      '\'_CALC_OFFERED\'!N2:N' + OFFERED_LAST_ROW +
      '},"select Col1, Col2, Col3, sum(Col4), sum(Col5), sum(Col6), avg(Col7), avg(Col8) ' +
      'where Col1 is not null group by Col1, Col2, Col3 ' +
      'label sum(Col4) \'\', sum(Col5) \'\', sum(Col6) \'\', avg(Col7) \'\', avg(Col8) \'\'",0)';
  }

  function ahtMetricLookupFormula(metricExpr) {
    var lastRow = AHT_LAST_ROW;
    return '=ARRAYFORMULA(IF(A2:A' + ROW_CAPACITY + '="","",' +
      'LET(' +
        'calcDate,\'_CALC_AHT\'!A2:A' + lastRow + ',' +
        'aggKey,IF(calcDate="","",TEXT(calcDate,"yyyy-mm-dd")&CHAR(29)&' +
          'TEXT(\'_CALC_AHT\'!B2:B' + lastRow + ',"hh:mm")&CHAR(29)&' +
          '\'_CALC_AHT\'!J2:J' + lastRow + '),' +
        'metric,IF(calcDate="","",' + metricExpr + '),' +
        'agg,QUERY({aggKey,metric},' +
          '"select Col1, avg(Col2) where Col1 is not null group by Col1 ' +
          'label avg(Col2) \'\'",0),' +
        'rowKey,TEXT(A2:A' + ROW_CAPACITY + ',"yyyy-mm-dd")&CHAR(29)&' +
          'TEXT(B2:B' + ROW_CAPACITY + ',"hh:mm")&CHAR(29)&C2:C' + ROW_CAPACITY + ',' +
        'IFNA(VLOOKUP(rowKey,agg,2,FALSE),"")' +
      ')' +
    '))';
  }

  function ahtMetricCountLookupFormula(metricExpr) {
    var rowEnd = ROW_CAPACITY + 1;
    return '=ARRAYFORMULA(IF(A2:A' + rowEnd + '="","",' +
      'LET(' +
        'calcDate,\'_CALC_AHT\'!A2:A' + AHT_LAST_ROW + ',' +
        'aggKey,IF(calcDate="","",TEXT(calcDate,"yyyy-mm-dd")&CHAR(29)&' +
          'TEXT(\'_CALC_AHT\'!B2:B' + AHT_LAST_ROW + ',"hh:mm")&CHAR(29)&' +
          '\'_CALC_AHT\'!J2:J' + AHT_LAST_ROW + '),' +
        'metric,' + metricExpr + ',' +
        'agg,QUERY({aggKey,metric},' +
          '"select Col1, count(Col2) where Col1 is not null group by Col1 ' +
          'label count(Col2) \'\'",0),' +
        'rowKey,TEXT(A2:A' + rowEnd + ',"yyyy-mm-dd")&CHAR(29)&' +
          'TEXT(B2:B' + rowEnd + ',"hh:mm")&CHAR(29)&C2:C' + rowEnd + ',' +
        'IFNA(VLOOKUP(rowKey,agg,2,FALSE),0)' +
      ')' +
    '))';
  }

  function offeredMetricCountFormula(metricRange) {
    var rowEnd = ROW_CAPACITY + 1;
    return '=ARRAYFORMULA(IF(A2:A' + rowEnd + '="","",' +
      'LET(' +
        'calcDate,\'_CALC_OFFERED\'!A2:A' + OFFERED_LAST_ROW + ',' +
        'aggKey,IF(calcDate="","",TEXT(calcDate,"yyyy-mm-dd")&CHAR(29)&' +
          'TEXT(\'_CALC_OFFERED\'!B2:B' + OFFERED_LAST_ROW + ',"hh:mm")&CHAR(29)&' +
          '\'_CALC_OFFERED\'!C2:C' + OFFERED_LAST_ROW + '),' +
        'metric,\'_CALC_OFFERED\'!' + metricRange + '2:' + metricRange + OFFERED_LAST_ROW + ',' +
        'agg,QUERY({aggKey,metric},' +
          '"select Col1, count(Col2) where Col1 is not null group by Col1 ' +
          'label count(Col2) \'\'",0),' +
        'rowKey,TEXT(A2:A' + rowEnd + ',"yyyy-mm-dd")&CHAR(29)&' +
          'TEXT(B2:B' + rowEnd + ',"hh:mm")&CHAR(29)&C2:C' + rowEnd + ',' +
        'IFNA(VLOOKUP(rowKey,agg,2,FALSE),0)' +
      ')' +
    '))';
  }

  function ahtTimingLookupFormulas() {
    var lastRow = AHT_LAST_ROW;
    var calc = '\'_CALC_AHT\'!';
    return Object.freeze([
      ahtMetricLookupFormula(calc + 'Q2:Q' + lastRow),
      ahtMetricLookupFormula(calc + 'R2:R' + lastRow),
      // ASA Total (calc col E) is ARRAYFORMULA-sourced; QUERY avg errors on it — sum raw STA + TTFR.
      ahtMetricLookupFormula(calc + 'T2:T' + lastRow + '+' + calc + 'AB2:AB' + lastRow),
      ahtMetricLookupFormula(calc + 'F2:F' + lastRow),
    ]);
  }

  function allocationCountQuery() {
    return '=QUERY({' +
      '\'_CALC_OFFERED\'!A2:A' + OFFERED_LAST_ROW + ',' +
      '\'_CALC_OFFERED\'!B2:B' + OFFERED_LAST_ROW + ',' +
      '\'_CALC_OFFERED\'!C2:C' + OFFERED_LAST_ROW + ',' +
      '\'_CALC_OFFERED\'!AL2:AL' + OFFERED_LAST_ROW + ',' +
      '\'_CALC_OFFERED\'!H2:H' + OFFERED_LAST_ROW +
      '},"select Col1, Col2, Col3, Col4, sum(Col5) ' +
      'where Col1 is not null group by Col1, Col2, Col3, Col4 ' +
      'label sum(Col5) \'\'",0)';
  }

  function allocationShareFormula() {
    var rowEnd = ROW_CAPACITY + 1;
    return '=MAP(A2:A' + rowEnd + ',B2:B' + rowEnd + ',C2:C' + rowEnd + ',E2:E' + rowEnd + ',' +
      'LAMBDA(date,interval,site,count,' +
        'IF(date="","",IF(count=0,"",count/SUMIFS($E$2:$E$' + rowEnd +
          ',$A$2:$A$' + rowEnd + ',date,$B$2:$B$' + rowEnd + ',interval,$C$2:$C$' +
          rowEnd + ',site)))' +
      '))';
  }

  function intervalSpec() {
    return Object.freeze({
      aggregationFormulas: Object.freeze([
        offeredVolumeQuery(),
      ].concat(ahtTimingLookupFormulas()).concat([
        offeredMetricCountFormula('D'),
        offeredMetricCountFormula('N'),
        ahtMetricCountLookupFormula("'_CALC_AHT'!Q2:Q" + AHT_LAST_ROW),
        ahtMetricCountLookupFormula("'_CALC_AHT'!R2:R" + AHT_LAST_ROW),
        ahtMetricCountLookupFormula("'_CALC_AHT'!T2:T" + AHT_LAST_ROW +
          "+'_CALC_AHT'!AB2:AB" + AHT_LAST_ROW),
        ahtMetricCountLookupFormula("'_CALC_AHT'!F2:F" + AHT_LAST_ROW),
      ])),
      aggregationSheetName: '_AGG_INTERVAL',
      datasetName: 'Interval Metrics',
      formulaAnchors: Object.freeze([1, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]),
      headers: Object.freeze([
        'Date',
        'Interval',
        'Site',
        'Offered',
        'Handled',
        'Chats in SL',
        'SL TTC',
        'AHT (Session)',
        'AHT',
        'ACW',
        'ASA',
        'Concurrency',
        'SL TTC Count',
        'AHT (Session) Count',
        'AHT Count',
        'ACW Count',
        'ASA Count',
        'Concurrency Count',
      ]),
      requiredCalcSheets: Object.freeze([
        '_CALC_OFFERED',
        '_CALC_AHT',
      ]),
      rowCapacity: ROW_CAPACITY,
    });
  }

  // _AGG_FORECAST holds operator-maintained MOM/forecast values, not generated
  // QUERY output. The prior A2 QUERY read A2:E51 while spilling into the same
  // range, which produced #REF! on install. Install only seeds headers and row
  // capacity; parity/UAT writes fixture rows via loadParityFixture.
  function forecastSpec() {
    return Object.freeze({
      aggregationFormulas: Object.freeze([]),
      aggregationSheetName: '_AGG_FORECAST',
      datasetName: 'Forecast',
      formulaAnchors: Object.freeze([]),
      headers: Object.freeze([
        'Date',
        'Interval',
        'Site',
        'Type',
        'Value',
      ]),
      // CXP-10 exclusively owns the A2 spill bridge. CXP-09 owns the schema
      // and removes only its legacy self-referential QUERY during migration.
      legacyFormulaCleanup: Object.freeze({
        column: 1,
        formula: forecastInputQuery(),
        row: 2,
      }),
      preserveBody: true,
      requiredCalcSheets: Object.freeze([]),
      rowCapacity: ROW_CAPACITY,
    });
  }

  function allocationSpec() {
    return Object.freeze({
      aggregationFormulas: Object.freeze([
        allocationCountQuery(),
        allocationShareFormula(),
      ]),
      aggregationSheetName: '_AGG_ALLOCATION',
      datasetName: 'Allocation',
      formulaAnchors: Object.freeze([1, 6]),
      headers: Object.freeze([
        'Date',
        'Interval',
        'Site',
        'BPO',
        'Offered Count',
        'Allocation Share',
      ]),
      requiredCalcSheets: Object.freeze([
        '_CALC_OFFERED',
      ]),
      rowCapacity: ROW_CAPACITY,
    });
  }

  function list() {
    return Object.freeze([intervalSpec(), forecastSpec(), allocationSpec()]);
  }

  return Object.freeze({
    AHT_LAST_ROW: AHT_LAST_ROW,
    OFFERED_LAST_ROW: OFFERED_LAST_ROW,
    ROW_CAPACITY: ROW_CAPACITY,
    list: list,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StableAggregationFormulaCatalog;
}
