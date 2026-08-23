var Cxp06UatEvidence = (function () {
  'use strict';

  var ALLOWED_FIELDS = Object.freeze([
    'scenario',
    'environment',
    'startedAtUtc',
    'endedAtUtc',
    'elapsedMs',
    'runId',
    'terminalState',
    'stageRowCounts',
    'rawRowCounts',
    'stageFormulaCount',
    'rawFormulaCount',
    'fileLedgerResult',
    'backupSheetNames',
    'backupSheetCount',
    'rollbackStatus',
    'backupCleanupStatus',
    'sanitizedErrorCode',
    'sanitizedWarningCode',
    'runtimeIndicator',
  ]);

  function sanitize(rawRecord) {
    var source = rawRecord || {};
    var sanitized = {};

    ALLOWED_FIELDS.forEach(function (field) {
      if (field === 'scenario') {
        sanitized.scenario = source.scenario || source.case || null;
      } else if (Object.hasOwn(source, field) && source[field] !== undefined) {
        sanitized[field] = source[field];
      } else {
        sanitized[field] = null;
      }
    });

    return Object.freeze(sanitized);
  }

  return Object.freeze({
    ALLOWED_FIELDS: ALLOWED_FIELDS,
    sanitize: sanitize,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp06UatEvidence;
}
