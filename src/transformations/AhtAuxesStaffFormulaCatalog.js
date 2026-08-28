var AhtAuxesStaffFormulaCatalog = (function () {
  'use strict';

  var AHT_ROW_CAPACITY = 15000;
  var AUXES_ROW_CAPACITY = 7500;
  var STAFF_ROW_CAPACITY = 2000;
  var STAFF_SUMMARY_SITES = Object.freeze({
    earlyQue: 'CNX-Que',
    earlyLas: 'CNX-CR1',
    lateQue: 'INT-Que',
    lateLas: 'INT-LAS',
    earlyBucketCount: 8,
  });

  function resolveSchemaRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return require('../ingestion/SchemaRegistry.js');
  }

  function columnLetter(index) {
    var n = index;
    var letters = '';
    while (n > 0) {
      var rem = (n - 1) % 26;
      letters = String.fromCharCode(65 + rem) + letters;
      n = Math.floor((n - 1) / 26);
    }
    return letters;
  }

  function halfHourHeaders() {
    var headers = [];
    var index;
    for (index = 0; index < 48; index += 1) {
      var totalMinutes = index * 30;
      var hour24 = Math.floor(totalMinutes / 60);
      var minute = totalMinutes % 60 === 0 ? '00' : '30';
      var hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
      var suffix = hour24 < 12 ? 'AM' : 'PM';
      headers.push(hour12 + ':' + minute + ' ' + suffix);
    }
    return Object.freeze(headers);
  }

  function parseIsoUtc(range) {
    return 'IF(' + range + '="",,DATEVALUE(LEFT(' + range +
      ',10))+TIMEVALUE(MID(' + range + ',12,8)))';
  }

  function ahtSpec() {
    var rawHeaders = resolveSchemaRegistry().getSchema('AHT - Raw').requiredHeaders;
    var lastRow = AHT_ROW_CAPACITY + 1;
    var acceptIso = '\'_RAW_AHT\'!F2:F' + lastRow;
    var requestIso = '\'_RAW_AHT\'!D2:D' + lastRow;
    var keyRange = '\'_RAW_AHT\'!A2:A' + lastRow;
    var siteRange = '\'_RAW_AHT\'!C2:C' + lastRow;
    var speedRange = '\'_RAW_AHT\'!M2:M' + lastRow;
    var responseRange = '\'_RAW_AHT\'!U2:U' + lastRow;
    var handleRange = '\'_RAW_AHT\'!J2:J' + lastRow;
    var activeRange = '\'_RAW_AHT\'!Q2:Q' + lastRow;
    var acceptUtc = parseIsoUtc('acceptIso');
    var requestUtc = parseIsoUtc('requestIso');
    var intervalExpr = 'MOD(FLOOR((acceptUtc-8/24)*48,1)/48,1)';
    var ccFormula = '=ARRAYFORMULA(LET(' +
      'acceptIso,' + acceptIso + ',' +
      'acceptUtc,' + acceptUtc + ',' +
      'interval,IF(acceptIso="",,' + intervalExpr + '),' +
      'site,' + siteRange + ',' +
      'handle,' + handleRange + ',' +
      'active,' + activeRange + ',' +
      'aggregateKey,IF(acceptIso="",,TEXT(interval,"hh:mm")&CHAR(29)&site),' +
      'handleAgg,QUERY({aggregateKey,handle},' +
        '"select Col1,sum(Col2) where Col1 is not null group by Col1 ' +
        'label sum(Col2) \'\'",0),' +
      'activeAgg,QUERY({aggregateKey,active},' +
        '"select Col1,sum(Col2) where Col1 is not null group by Col1 ' +
        'label sum(Col2) \'\'",0),' +
      'handleTotal,IFNA(VLOOKUP(aggregateKey,handleAgg,2,FALSE),0),' +
      'activeTotal,IFNA(VLOOKUP(aggregateKey,activeAgg,2,FALSE),0),' +
      'IF(acceptIso="",,IFERROR(handleTotal/activeTotal,""))))';
    return Object.freeze({
      calculatedFormulas: Object.freeze([
        '=ARRAYFORMULA(LET(' +
          'acceptIso,' + acceptIso + ',' +
          'acceptUtc,' + acceptUtc + ',' +
          'IF(acceptIso="",,INT(acceptUtc-8/24))))',
        '=ARRAYFORMULA(LET(' +
          'acceptIso,' + acceptIso + ',' +
          'acceptUtc,' + acceptUtc + ',' +
          'IF(acceptIso="",,' + intervalExpr + ')))',
        '=ARRAYFORMULA(IF(' + keyRange + '="",,--(' + requestIso + '<>"")))',
        '=ARRAYFORMULA(IF(' + keyRange + '="",,IF(' + speedRange + '<91,1,0)))',
        '=ARRAYFORMULA(IF(' + keyRange + '="",,' + speedRange + '+' + responseRange + '))',
        ccFormula,
        '=ARRAYFORMULA(LET(' +
          'requestIso,' + requestIso + ',' +
          'requestUtc,' + requestUtc + ',' +
          'IF(requestIso="",,MOD(FLOOR((requestUtc-8/24)*48,1)/48,1))))',
      ]),
      calculatedHeaders: Object.freeze([
        'Date',
        'Interval',
        'Count',
        'Service Level',
        'ASA Total',
        'CC',
        'Request Interval',
      ]),
      calculationSheetName: '_CALC_AHT',
      copyFormula: '=ARRAYFORMULA(\'_RAW_AHT\'!A2:AA' + lastRow + ')',
      datasetName: 'AHT - Raw',
      rawHeaders: rawHeaders,
      rawSheetName: '_RAW_AHT',
      rowCapacity: AHT_ROW_CAPACITY,
    });
  }

  function auxesSpec() {
    var rawHeaders = resolveSchemaRegistry().getSchema('Auxes - Raw').requiredHeaders;
    var lastRow = AUXES_ROW_CAPACITY + 1;
    var startIso = '\'_RAW_AUXES\'!C2:C' + lastRow;
    var statusRange = '\'_RAW_AUXES\'!X2:X' + lastRow;
    var hoursRange = '\'_RAW_AUXES\'!U2:U' + lastRow;
    var keyRange = '\'_RAW_AUXES\'!A2:A' + lastRow;
    var startUtc = parseIsoUtc('startIso');
    return Object.freeze({
      calculatedFormulas: Object.freeze([
        '=ARRAYFORMULA(LET(' +
          'startIso,' + startIso + ',' +
          'startUtc,' + startUtc + ',' +
          'IF(startIso="",,INT(startUtc-8/24))))',
        '=ARRAYFORMULA(LET(' +
          'startIso,' + startIso + ',' +
          'startUtc,' + startUtc + ',' +
          'IF(startIso="",,MOD(FLOOR((startUtc-8/24)*48,1)/48,1))))',
        '=ARRAYFORMULA(IF(' + keyRange + '="",,IF(' + statusRange +
          '="Available - Messaging",' + hoursRange + ',0)))',
        '=ARRAYFORMULA(IF(' + keyRange + '="",,IF(' + statusRange +
          '="Concluding",' + hoursRange + ',0)))',
      ]),
      calculatedHeaders: Object.freeze([
        'Date',
        'Interval',
        'Available Messaging in Hours',
        'Concluding in Hours',
      ]),
      calculationSheetName: '_CALC_AUXES',
      copyFormula: '=ARRAYFORMULA(\'_RAW_AUXES\'!A2:X' + lastRow + ')',
      datasetName: 'Auxes - Raw',
      rawHeaders: rawHeaders,
      rawSheetName: '_RAW_AUXES',
      rowCapacity: AUXES_ROW_CAPACITY,
    });
  }

  function staffOverlapFormula(bucketIndex) {
    var lastRow = STAFF_ROW_CAPACITY + 1;
    var bucketStart = bucketIndex + '/48';
    var bucketEnd = (bucketIndex + 1) + '/48';
    return '=ARRAYFORMULA(LET(' +
      'day,$BE$1,' +
      'startIso,\'_RAW_STAFF\'!A2:A' + lastRow + ',' +
      'endIso,\'_RAW_STAFF\'!B2:B' + lastRow + ',' +
      'start,IF(startIso="",,' + parseIsoUtc('startIso') + '-8/24),' +
      'end,IF(endIso="",,' + parseIsoUtc('endIso') + '-8/24),' +
      'IF(startIso="",,MAX(0,MIN(end,day+' + bucketEnd +
        ')-MAX(start,day+' + bucketStart + ')))))';
  }

  function staffSummaryFormula(bucketIndex, site) {
    var lastRow = STAFF_ROW_CAPACITY + 1;
    var overlapColumn = columnLetter(bucketIndex + 1);
    // Athlete Site is the 4th raw column after 48 calculated columns (col 52 = AZ).
    return '=SUMIF(\'_CALC_STAFF\'!AZ2:AZ' + lastRow + ',"' + site + '",' +
      '\'_CALC_STAFF\'!' + overlapColumn + '2:' + overlapColumn + lastRow +
      ')*(1440/30)';
  }

  function staffSpec() {
    var rawHeaders = resolveSchemaRegistry().getSchema('Staff').requiredHeaders;
    var lastRow = STAFF_ROW_CAPACITY + 1;
    var headers = halfHourHeaders();
    var formulas = headers.map(function (_name, index) {
      return staffOverlapFormula(index);
    });
    var summaryFormulas = [];
    var bucketIndex;
    for (bucketIndex = 0; bucketIndex < 48; bucketIndex += 1) {
      var queSite = bucketIndex < STAFF_SUMMARY_SITES.earlyBucketCount
        ? STAFF_SUMMARY_SITES.earlyQue
        : STAFF_SUMMARY_SITES.lateQue;
      var lasSite = bucketIndex < STAFF_SUMMARY_SITES.earlyBucketCount
        ? STAFF_SUMMARY_SITES.earlyLas
        : STAFF_SUMMARY_SITES.lateLas;
      // Excel BE = Que, BF = LAS/CR1; place after the 53-column table at BC:BD.
      summaryFormulas.push({
        column: 55,
        formula: staffSummaryFormula(bucketIndex, queSite),
        row: bucketIndex + 3,
      });
      summaryFormulas.push({
        column: 56,
        formula: staffSummaryFormula(bucketIndex, lasSite),
        row: bucketIndex + 3,
      });
    }
    return Object.freeze({
      businessDayCell: Object.freeze({ column: 57, row: 1 }),
      calculatedFormulas: Object.freeze(formulas),
      calculatedHeaders: headers,
      calculationSheetName: '_CALC_STAFF',
      copyFormula: '=ARRAYFORMULA(\'_RAW_STAFF\'!A2:E' + lastRow + ')',
      datasetName: 'Staff',
      rawHeaders: rawHeaders,
      rawSheetName: '_RAW_STAFF',
      requiredColumns: 57,
      rowCapacity: STAFF_ROW_CAPACITY,
      summaryFormulas: Object.freeze(summaryFormulas),
      summaryHeaders: Object.freeze([
        Object.freeze({ column: 55, row: 2, value: 'Que Summary' }),
        Object.freeze({ column: 56, row: 2, value: 'LAS Summary' }),
        Object.freeze({ column: 57, row: 2, value: 'Business Day' }),
      ]),
    });
  }

  function list() {
    return Object.freeze([ahtSpec(), auxesSpec(), staffSpec()]);
  }

  return Object.freeze({
    AHT_ROW_CAPACITY: AHT_ROW_CAPACITY,
    AUXES_ROW_CAPACITY: AUXES_ROW_CAPACITY,
    STAFF_ROW_CAPACITY: STAFF_ROW_CAPACITY,
    STAFF_SUMMARY_SITES: STAFF_SUMMARY_SITES,
    halfHourHeaders: halfHourHeaders,
    list: list,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AhtAuxesStaffFormulaCatalog;
}
