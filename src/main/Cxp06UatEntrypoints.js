function resolveCxp06UatHarness() {
  if (typeof Cxp06UatHarness !== 'undefined') {
    return Cxp06UatHarness;
  }
  return require('../uat/Cxp06UatHarness.js');
}

function resolveCxp06UatContinuation() {
  if (typeof Cxp06UatContinuation !== 'undefined') {
    return Cxp06UatContinuation;
  }
  return require('../uat/Cxp06UatContinuation.js');
}

function hasCxp06HostedContinuationRuntime() {
  return typeof PropertiesService !== 'undefined' &&
    typeof ScriptApp !== 'undefined' &&
    typeof SpreadsheetApp !== 'undefined';
}

function logCxp06PipelineResult(label, result) {
  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    console.log(label + ' ' + JSON.stringify(result));
  }
  return result;
}

function executeLoggedCxp06Pipeline(label, work) {
  try {
    return logCxp06PipelineResult(label, work());
  } catch (error) {
    var failedStatus;
    try {
      failedStatus = resolveCxp06UatContinuation().getStatus();
    } catch (statusError) {
      failedStatus = {
        continuationScheduled: false,
        lastErrorCode: error && typeof error.code === 'string'
          ? error.code
          : 'UNKNOWN_ERROR',
        status: 'FAILED',
      };
    }
    logCxp06PipelineResult(label + '_FAILED', failedStatus);
    throw error;
  }
}

function executeCxp06UatScenario(scenario) {
  if (hasCxp06HostedContinuationRuntime()) {
    return executeLoggedCxp06Pipeline(
      'CXP06_PIPELINE_START',
      function () { return resolveCxp06UatContinuation().start(scenario); },
    );
  }
  return resolveCxp06UatHarness().execute({ scenario: scenario });
}

function cxp06UatPreflight() {
  return resolveCxp06UatHarness().execute({ scenario: 'PREFLIGHT' });
}

function cxp06UatCase1PeakSuccess() {
  return executeCxp06UatScenario('CASE1_PEAK_SUCCESS');
}

function cxp06UatCase2InvalidStage() {
  return executeCxp06UatScenario('CASE2_INVALID_STAGE');
}

function cxp06UatCase3MidCommitFailure() {
  return executeCxp06UatScenario('CASE3_MID_COMMIT_FAILURE');
}

function cxp06UatCase4HealthMismatch() {
  return executeCxp06UatScenario('CASE4_HEALTH_MISMATCH');
}

function cxp06UatCase4RollbackFailure() {
  return executeCxp06UatScenario('CASE4_ROLLBACK_FAILURE');
}

function cxp06UatCase5IncompleteBackup() {
  return executeCxp06UatScenario('CASE5_INCOMPLETE_BACKUP');
}

function cxp06UatCase5CompleteUnsuccessfulBackup() {
  return executeCxp06UatScenario('CASE5_COMPLETE_UNSUCCESSFUL_BACKUP');
}

function cxp06UatCase5SuccessfulLeftoverBackup() {
  return executeCxp06UatScenario('CASE5_SUCCESSFUL_LEFTOVER_BACKUP');
}

function cxp06UatCase5TwoCompleteUnsuccessfulBackups() {
  return executeCxp06UatScenario('CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS');
}

function cxp06UatCase5CleanupFailure() {
  return executeCxp06UatScenario('CASE5_CLEANUP_FAILURE');
}

function cxp06UatReaderVisibility() {
  return executeCxp06UatScenario('READER_VISIBILITY');
}

function continueCxp06UatPipeline() {
  return executeLoggedCxp06Pipeline(
    'CXP06_PIPELINE_CONTINUE',
    function () { return resolveCxp06UatContinuation().continueConfigured(); },
  );
}

function getCxp06UatPipelineStatus() {
  var status = resolveCxp06UatContinuation().getStatus();
  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    console.log('CXP06_STATUS ' + JSON.stringify(status));
  }
  return status;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    cxp06UatCase1PeakSuccess: cxp06UatCase1PeakSuccess,
    cxp06UatCase2InvalidStage: cxp06UatCase2InvalidStage,
    cxp06UatCase3MidCommitFailure: cxp06UatCase3MidCommitFailure,
    cxp06UatCase4HealthMismatch: cxp06UatCase4HealthMismatch,
    cxp06UatCase4RollbackFailure: cxp06UatCase4RollbackFailure,
    cxp06UatCase5CleanupFailure: cxp06UatCase5CleanupFailure,
    cxp06UatCase5CompleteUnsuccessfulBackup: cxp06UatCase5CompleteUnsuccessfulBackup,
    cxp06UatCase5IncompleteBackup: cxp06UatCase5IncompleteBackup,
    cxp06UatCase5SuccessfulLeftoverBackup: cxp06UatCase5SuccessfulLeftoverBackup,
    cxp06UatCase5TwoCompleteUnsuccessfulBackups: cxp06UatCase5TwoCompleteUnsuccessfulBackups,
    cxp06UatPreflight: cxp06UatPreflight,
    cxp06UatReaderVisibility: cxp06UatReaderVisibility,
    continueCxp06UatPipeline: continueCxp06UatPipeline,
    getCxp06UatPipelineStatus: getCxp06UatPipelineStatus,
  };
}
