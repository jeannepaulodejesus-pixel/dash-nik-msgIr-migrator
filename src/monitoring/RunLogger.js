(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.RunLogger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var HEADERS = Object.freeze([
    'Run ID',
    'Started At UTC',
    'Ended At UTC',
    'Source Actor',
    'Source File Name',
    'Source File ID',
    'Schema Version',
    'Input Row Counts JSON',
    'Output Row Counts JSON',
    'Target Workbook ID',
    'Status',
    'Error Code',
    'State History JSON'
  ]);

  function cloneJsonValue(value, fallback) {
    if (value === undefined || value === null) {
      return fallback;
    }

    return JSON.parse(JSON.stringify(value));
  }

  function createRecord(values) {
    var source = values || {};

    return Object.freeze({
      runId: source.runId || '',
      startedAtUtc: source.startedAtUtc || '',
      endedAtUtc: source.endedAtUtc || '',
      sourceActor: source.sourceActor === undefined ? null : source.sourceActor,
      sourceFileName: source.sourceFileName || '',
      sourceFileId: source.sourceFileId || '',
      schemaVersion: source.schemaVersion || '',
      inputRowCounts: cloneJsonValue(source.inputRowCounts, {}),
      outputRowCounts: cloneJsonValue(source.outputRowCounts, {}),
      targetWorkbookId: source.targetWorkbookId || '',
      status: source.status || '',
      errorCode: source.errorCode === undefined ? null : source.errorCode,
      stateHistory: cloneJsonValue(source.stateHistory, [])
    });
  }

  function toRows(records) {
    return (records || []).map(function (record) {
      return [
        record.runId,
        record.startedAtUtc,
        record.endedAtUtc,
        record.sourceActor,
        record.sourceFileName,
        record.sourceFileId,
        record.schemaVersion,
        JSON.stringify(record.inputRowCounts || {}),
        JSON.stringify(record.outputRowCounts || {}),
        record.targetWorkbookId,
        record.status,
        record.errorCode,
        JSON.stringify(record.stateHistory || [])
      ];
    });
  }

  return Object.freeze({
    HEADERS: HEADERS,
    createRecord: createRecord,
    toRows: toRows
  });
});
