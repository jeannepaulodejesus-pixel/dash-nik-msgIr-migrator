var HandledOfferedFormulaCatalog = (function () {
  'use strict';

  var ROW_CAPACITY = 10000;
  var AHT_ROW_CAPACITY = 15000;

  function resolveSchemaRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return require('../ingestion/SchemaRegistry.js');
  }

  function acceptDateFormula(sessionRange) {
    return '=ARRAYFORMULA(LET(' +
      'session,' + sessionRange + ',' +
      'acceptIso,XLOOKUP(session,\'_RAW_AHT\'!B2:B15001,\'_RAW_AHT\'!F2:F15001,""),' +
      'acceptUtc,IF(acceptIso="",,DATEVALUE(LEFT(acceptIso,10))+' +
        'TIMEVALUE(MID(acceptIso,12,8))),' +
      'IF(session="",,IF(acceptIso="",,INT(acceptUtc-8/24)))))';
  }

  function intervalFormula(sessionRange) {
    return '=ARRAYFORMULA(LET(' +
      'session,' + sessionRange + ',' +
      'acceptIso,XLOOKUP(session,\'_RAW_AHT\'!B2:B15001,\'_RAW_AHT\'!F2:F15001,""),' +
      'acceptUtc,IF(acceptIso="",,DATEVALUE(LEFT(acceptIso,10))+' +
        'TIMEVALUE(MID(acceptIso,12,8))),' +
      'IF(session="",,IF(acceptIso="",,MOD(FLOOR((acceptUtc-8/24)*48,1)/48,1)))))';
  }

  function handledIntervalFormula(sessionRange) {
    return '=ARRAYFORMULA(LET(' +
      'session,' + sessionRange + ',' +
      'forward,XLOOKUP(session,\'_RAW_AHT\'!B2:B15001,' +
        '\'_RAW_AHT\'!F2:F15001,,1,1),' +
      'acceptIso,IF(forward=0,XLOOKUP(session,\'_RAW_AHT\'!B2:B15001,' +
        '\'_RAW_AHT\'!F2:F15001,,1,-1),forward),' +
      'acceptUtc,IF(acceptIso="",,DATEVALUE(LEFT(acceptIso,10))+' +
        'TIMEVALUE(MID(acceptIso,12,8))),' +
      'IF(session="",,IFNA(IF(acceptIso="",,' +
        'MOD(FLOOR((acceptUtc-8/24)*48,1)/48,1)),""))))';
  }

  function ahtAggregateFormula(sessionRange, dateRange, valueColumn) {
    return '=ARRAYFORMULA(LET(' +
      'session,' + sessionRange + ',' +
      'ahtSession,\'_RAW_AHT\'!B2:B15001,' +
      'acceptIso,\'_RAW_AHT\'!F2:F15001,' +
      'acceptDate,IF(acceptIso="",,INT(DATEVALUE(LEFT(acceptIso,10))+' +
        'TIMEVALUE(MID(acceptIso,12,8))-8/24)),' +
      'aggregateKey,IF(ahtSession="",,ahtSession&CHAR(29)&TEXT(acceptDate,"yyyy-mm-dd")),' +
      'aggregates,QUERY({aggregateKey,\'_RAW_AHT\'!' + valueColumn + '2:' +
        valueColumn + (AHT_ROW_CAPACITY + 1) + '},' +
        '"select Col1,sum(Col2) where Col1 is not null group by Col1 ' +
        'label sum(Col2) \'\'",0),' +
      'IF(session="",,IFNA(VLOOKUP(session&CHAR(29)&TEXT(' + dateRange +
        ',"yyyy-mm-dd"),aggregates,2,FALSE),0))))';
  }

  function lookupAhtFormula(sessionRange, resultColumn) {
    return '=ARRAYFORMULA(IF(' + sessionRange + '="",,' +
      'XLOOKUP(' + sessionRange + ',\'_RAW_AHT\'!B2:B15001,' +
      '\'_RAW_AHT\'!' + resultColumn + '2:' + resultColumn + '15001,"")))';
  }

  function handledSpec() {
    var rawHeaders = resolveSchemaRegistry().getSchema('Handled').requiredHeaders;
    var sessionRange = '\'_RAW_HANDLED\'!B2:B10001';
    return Object.freeze({
      calculatedFormulas: Object.freeze([
        acceptDateFormula(sessionRange),
        handledIntervalFormula(sessionRange),
        ahtAggregateFormula(sessionRange, 'A2:A10001', 'J'),
      ]),
      calculatedHeaders: Object.freeze(['Accept Date', 'Interval', 'AHT']),
      calculationSheetName: '_CALC_HANDLED',
      copyFormula: '=ARRAYFORMULA(\'_RAW_HANDLED\'!A2:AA10001)',
      datasetName: 'Handled',
      rawHeaders: rawHeaders,
      rawSheetName: '_RAW_HANDLED',
      rowCapacity: ROW_CAPACITY,
    });
  }

  function offeredSpec() {
    var rawHeaders = resolveSchemaRegistry().getSchema('Offered').requiredHeaders;
    var sessionRange = '\'_RAW_OFFERED\'!B2:B10001';
    var caseRange = '\'_RAW_OFFERED\'!A2:A10001';
    var ownerRange = '\'_RAW_OFFERED\'!N2:N10001';
    var languageRange = '\'_RAW_OFFERED\'!L2:L10001';
    var fragmentsRange = '\'_RAW_OFFERED\'!R2:R10001';
    var handledCountFormula = '=ARRAYFORMULA(LET(' +
      'session,' + sessionRange + ',' +
      'handledSession,\'_RAW_HANDLED\'!B2:B10001,' +
      'eligible,--((\'_RAW_HANDLED\'!AA2:AA10001="English")*' +
        '(\'_RAW_HANDLED\'!M2:M10001="NA")),' +
      'counts,QUERY({handledSession,eligible},' +
        '"select Col1,sum(Col2) where Col1 is not null group by Col1 ' +
        'label sum(Col2) \'\'",0),' +
      'IF(session="",,IFNA(VLOOKUP(session,counts,2,FALSE),0))))';
    return Object.freeze({
      calculatedFormulas: Object.freeze([
        acceptDateFormula(sessionRange),
        intervalFormula(sessionRange),
        '=ARRAYFORMULA(IF(' + sessionRange + '="",,IFNA(XLOOKUP(' + sessionRange +
          ',\'_CALC_HANDLED\'!E2:E10001,\'_CALC_HANDLED\'!AB2:AB10001),"")))',
        '=ARRAYFORMULA(IF(' + sessionRange + '="",,IF(E2:E10001<91,1,0)))',
        lookupAhtFormula(sessionRange, 'M'),
        '=ARRAYFORMULA(IF(' + sessionRange + '="",,IF(G2:G10001<91,1,0)))',
        '=ARRAYFORMULA(IF(' + sessionRange + '="",,XLOOKUP(' + caseRange +
          ',\'_CALC_HANDLED\'!D2:D10001,\'_CALC_HANDLED\'!T2:T10001)))',
        '=ARRAYFORMULA(IF(' + sessionRange + '="",,--(' + ownerRange + '="NA")))',
        handledCountFormula,
        '=ARRAYFORMULA(IF(' + sessionRange + '="",,IF((' + languageRange +
          '="English")*(' + ownerRange + '="NA"),IF(' + fragmentsRange +
          '="",1,' + fragmentsRange + '),0)))',
        lookupAhtFormula(sessionRange, 'U'),
        '=ARRAYFORMULA(IF(' + sessionRange + '="",,IF(E2:E10001+K2:K10001<91,1,0)))',
        '=ARRAYFORMULA(IF(' + sessionRange + '="",,IF(J2:J10001=0,"",L2:L10001)))',
        ahtAggregateFormula(sessionRange, 'A2:A10001', 'J'),
        ahtAggregateFormula(sessionRange, 'A2:A10001', 'Q'),
      ]),
      calculatedHeaders: Object.freeze([
        'Accept Date',
        'Interval View',
        'Athlete Site',
        'SL',
        'ASA',
        'Handled SL',
        'Handled ASA',
        'Count',
        'Handled',
        'Handled Fragments',
        'Response',
        'SL Total',
        'SL Total (Session)',
        'AHT Session',
        'Active Time',
      ]),
      calculationSheetName: '_CALC_OFFERED',
      copyFormula: '=ARRAYFORMULA(\'_RAW_OFFERED\'!A2:AA10001)',
      datasetName: 'Offered',
      rawHeaders: rawHeaders,
      rawSheetName: '_RAW_OFFERED',
      rowCapacity: ROW_CAPACITY,
    });
  }

  function list() {
    return Object.freeze([handledSpec(), offeredSpec()]);
  }

  return Object.freeze({
    AHT_ROW_CAPACITY: AHT_ROW_CAPACITY,
    ROW_CAPACITY: ROW_CAPACITY,
    list: list,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HandledOfferedFormulaCatalog;
}
