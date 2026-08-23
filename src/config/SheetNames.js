var SheetNames = (function () {
  'use strict';

  var SOURCE_TIME_ZONE = 'Etc/UTC';
  var BUSINESS_TIME_ZONE = 'Etc/GMT+8';
  var SOURCE_TO_BUSINESS_OFFSET_MINUTES = -480;
  var TARGET = Object.freeze({
    staging: Object.freeze([
      '_STG_HANDLED',
      '_STG_OFFERED',
      '_STG_AHT',
      '_STG_AUXES',
      '_STG_STAFF',
    ]),
    raw: Object.freeze([
      '_RAW_HANDLED',
      '_RAW_OFFERED',
      '_RAW_AHT',
      '_RAW_AUXES',
      '_RAW_STAFF',
    ]),
    calculation: Object.freeze([
      '_CALC_HANDLED',
      '_CALC_OFFERED',
      '_CALC_AHT',
      '_CALC_AUXES',
      '_CALC_STAFF',
    ]),
    aggregation: Object.freeze([
      '_AGG_INTERVAL',
      '_AGG_FORECAST',
      '_AGG_ALLOCATION',
    ]),
    report: Object.freeze([
      'Interval View',
      'MOM',
      'Teams Update',
      'Aux Productive',
      'Allocation Export',
    ]),
  });
  var CONTROL = Object.freeze([
    'RUN_LOG',
    'ERROR_LOG',
    'FILE_LEDGER',
    'WEEK_REGISTRY',
    'SCHEMA_REGISTRY',
    'PARITY_RESULTS',
    'SOURCE_ERROR_BASELINE',
  ]);

  function targetBackend() {
    return TARGET.staging
      .concat(TARGET.raw)
      .concat(TARGET.calculation)
      .concat(TARGET.aggregation);
  }

  function targetAll() {
    return targetBackend().concat(TARGET.report);
  }

  return Object.freeze({
    BUSINESS_TIME_ZONE: BUSINESS_TIME_ZONE,
    CONTROL: CONTROL,
    SOURCE_TIME_ZONE: SOURCE_TIME_ZONE,
    SOURCE_TO_BUSINESS_OFFSET_MINUTES: SOURCE_TO_BUSINESS_OFFSET_MINUTES,
    TARGET: TARGET,
    targetAll: targetAll,
    targetBackend: targetBackend,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SheetNames;
}
