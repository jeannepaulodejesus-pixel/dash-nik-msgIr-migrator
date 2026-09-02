var RunStatusRepository = (function () {
  'use strict';
  var RUN_HEADERS = Object.freeze(['Run ID','Started At UTC','Ended At UTC','Source Actor','Source File Name','Source File ID','Schema Version','Input Row Counts JSON','Output Row Counts JSON','Target Workbook ID','Status','Error Code','State History JSON']);
  var ERROR_HEADERS = Object.freeze(['Run ID','Error At UTC','State','Failure State','Category','Error Code','Message','Details JSON']);
  function same(left, right) { return left.length === right.length && left.every(function (v, i) { return v === right[i]; }); }
  function rows(spreadsheet, name, headers) {
    var sheet = spreadsheet && spreadsheet.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 1) return [];
    if (!same(sheet.getRange(1, 1, 1, headers.length).getValues()[0], headers)) throw new Error(name + ' headers do not match the status contract.');
    return sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  }
  function details(value) { try { return JSON.parse(value || '{}'); } catch (_error) { return {}; } }
  function create(spreadsheet) {
    return Object.freeze({
      findRun: function (runId) {
        var runRows = rows(spreadsheet, 'RUN_LOG', RUN_HEADERS);
        for (var i = runRows.length - 1; i >= 0; i -= 1) {
          if (String(runRows[i][0]) !== String(runId)) continue;
          var error = null;
          var errorRows = rows(spreadsheet, 'ERROR_LOG', ERROR_HEADERS);
          for (var j = errorRows.length - 1; j >= 0; j -= 1) {
            if (String(errorRows[j][0]) === String(runId)) {
              error = Object.freeze({ category: errorRows[j][4] || null, code: errorRows[j][5] || null, details: Object.freeze(details(errorRows[j][7])) });
              break;
            }
          }
          return Object.freeze({ endedAtUtc: runRows[i][2] || null, error: error, errorCode: runRows[i][11] || null, runId: runRows[i][0], startedAtUtc: runRows[i][1] || null, status: runRows[i][10] || null });
        }
        return null;
      },
      latestSuccess: function () {
        var runRows = rows(spreadsheet, 'RUN_LOG', RUN_HEADERS);
        for (var i = runRows.length - 1; i >= 0; i -= 1) if (runRows[i][10] === 'SUCCESS') return Object.freeze({ endedAtUtc: runRows[i][2], runId: runRows[i][0] });
        return null;
      },
    });
  }
  return Object.freeze({ create: create });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RunStatusRepository;
