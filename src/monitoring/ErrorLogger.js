(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.ErrorLogger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var HEADERS = Object.freeze([
    'Run ID',
    'Error At UTC',
    'State',
    'Failure State',
    'Category',
    'Error Code',
    'Message',
    'Details JSON'
  ]);

  function cloneJsonValue(value) {
    if (value === undefined || value === null) {
      return {};
    }

    return JSON.parse(JSON.stringify(value));
  }

  function createRecord(values) {
    var source = values || {};

    return Object.freeze({
      runId: source.runId || '',
      atUtc: source.atUtc || '',
      state: source.state || '',
      failureState: source.failureState || '',
      category: source.category || '',
      errorCode: source.errorCode || '',
      message: source.message || '',
      details: cloneJsonValue(source.details)
    });
  }

  function toRows(records) {
    return (records || []).map(function (record) {
      return [
        record.runId,
        record.atUtc,
        record.state,
        record.failureState,
        record.category,
        record.errorCode,
        record.message,
        JSON.stringify(record.details || {})
      ];
    });
  }

  return Object.freeze({
    HEADERS: HEADERS,
    createRecord: createRecord,
    toRows: toRows
  });
});
