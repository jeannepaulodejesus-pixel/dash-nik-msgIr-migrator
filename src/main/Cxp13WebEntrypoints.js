function resolveRtaIntakeService() {
  if (typeof RtaIntakeService !== 'undefined') return RtaIntakeService;
  return require('../services/RtaIntakeService.js');
}
function doGet() {
  if (typeof HtmlService === 'undefined') throw new Error('HtmlService is required.');
  return HtmlService.createHtmlOutputFromFile('Cxp13Web')
    .setTitle('RTA Intake Status')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}
function cxp13GetIntakeStatus() { return resolveRtaIntakeService().getIntakeStatus(); }
function cxp13StartLatestBundle(expectedBatchToken) { return resolveRtaIntakeService().startLatest(expectedBatchToken); }
function cxp13GetRunStatus(runId) { return resolveRtaIntakeService().getRunStatus(runId); }
function continueCxp13Ingestion() { return resolveRtaIntakeService().continueRun(); }

if (typeof module !== 'undefined' && module.exports) module.exports = {
  continueCxp13Ingestion: continueCxp13Ingestion,
  cxp13GetIntakeStatus: cxp13GetIntakeStatus,
  cxp13GetRunStatus: cxp13GetRunStatus,
  cxp13StartLatestBundle: cxp13StartLatestBundle,
  doGet: doGet,
};
