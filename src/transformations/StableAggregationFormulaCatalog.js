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

  function ahtTimingQuery() {
    return '=QUERY({' +
      '\'_CALC_AHT\'!A2:A' + AHT_LAST_ROW + ',' +
      '\'_CALC_AHT\'!B2:B' + AHT_LAST_ROW + ',' +
      '\'_CALC_AHT\'!J2:J' + AHT_LAST_ROW + ',' +
      '\'_CALC_AHT\'!Q2:Q' + AHT_LAST_ROW + ',' +
      '\'_CALC_AHT\'!R2:R' + AHT_LAST_ROW + ',' +
      '\'_CALC_AHT\'!E2:E' + AHT_LAST_ROW + ',' +
      '\'_CALC_AHT\'!F2:F' + AHT_LAST_ROW +
      '},"select Col1, Col2, Col3, avg(Col4), avg(Col5), avg(Col6), avg(Col7) ' +
      'where Col1 is not null group by Col1, Col2, Col3 ' +
      'label avg(Col4) \'\', avg(Col5) \'\', avg(Col6) \'\', avg(Col7) \'\'",0)';
  }

  function forecastInputQuery() {
    return '=QUERY(A2:E' + (ROW_CAPACITY + 1) +
      ',"select Col1, Col2, Col3, Col4, Col5 where Col1 is not null",0)';
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
    return '=ARRAYFORMULA(IF(A2:A' + ROW_CAPACITY + '="","",' +
      'IF(E2:E' + ROW_CAPACITY + '=0,"",E2:E' + ROW_CAPACITY + '/SUMIFS(E:E,A:A,A2:A' +
      ROW_CAPACITY + ',B:B,B2:B' + ROW_CAPACITY + ',C:C,C2:C' + ROW_CAPACITY + ')))';
  }

  function intervalSpec() {
    return Object.freeze({
      aggregationFormulas: Object.freeze([
        offeredVolumeQuery(),
        ahtTimingQuery(),
      ]),
      aggregationSheetName: '_AGG_INTERVAL',
      datasetName: 'Interval Metrics',
      formulaAnchors: Object.freeze([1, 9]),
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
      ]),
      requiredCalcSheets: Object.freeze([
        '_CALC_OFFERED',
        '_CALC_AHT',
      ]),
      rowCapacity: ROW_CAPACITY,
    });
  }

  function forecastSpec() {
    return Object.freeze({
      aggregationFormulas: Object.freeze([
        forecastInputQuery(),
      ]),
      aggregationSheetName: '_AGG_FORECAST',
      datasetName: 'Forecast',
      formulaAnchors: Object.freeze([1]),
      headers: Object.freeze([
        'Date',
        'Interval',
        'Site',
        'Type',
        'Value',
      ]),
      requiredCalcSheets: Object.freeze([
        '_CALC_STAFF',
      ]),
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
