function resolveCxp06UatHarness() {
  if (typeof Cxp06UatHarness !== 'undefined') {
    return Cxp06UatHarness;
  }
  return require('../uat/Cxp06UatHarness.js');
}

function cxp06UatPreflight() {
  return resolveCxp06UatHarness().execute({ scenario: 'PREFLIGHT' });
}

function cxp06UatCase1PeakSuccess() {
  return resolveCxp06UatHarness().execute({ scenario: 'CASE1_PEAK_SUCCESS' });
}

function cxp06UatCase2InvalidStage() {
  return resolveCxp06UatHarness().execute({ scenario: 'CASE2_INVALID_STAGE' });
}

function cxp06UatCase3MidCommitFailure() {
  return resolveCxp06UatHarness().execute({ scenario: 'CASE3_MID_COMMIT_FAILURE' });
}

function cxp06UatCase4HealthMismatch() {
  return resolveCxp06UatHarness().execute({ scenario: 'CASE4_HEALTH_MISMATCH' });
}

function cxp06UatCase4RollbackFailure() {
  return resolveCxp06UatHarness().execute({ scenario: 'CASE4_ROLLBACK_FAILURE' });
}

function cxp06UatCase5IncompleteBackup() {
  return resolveCxp06UatHarness().execute({ scenario: 'CASE5_INCOMPLETE_BACKUP' });
}

function cxp06UatCase5CompleteUnsuccessfulBackup() {
  return resolveCxp06UatHarness().execute({ scenario: 'CASE5_COMPLETE_UNSUCCESSFUL_BACKUP' });
}

function cxp06UatCase5SuccessfulLeftoverBackup() {
  return resolveCxp06UatHarness().execute({ scenario: 'CASE5_SUCCESSFUL_LEFTOVER_BACKUP' });
}

function cxp06UatCase5TwoCompleteUnsuccessfulBackups() {
  return resolveCxp06UatHarness().execute({ scenario: 'CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS' });
}

function cxp06UatCase5CleanupFailure() {
  return resolveCxp06UatHarness().execute({ scenario: 'CASE5_CLEANUP_FAILURE' });
}

function cxp06UatReaderVisibility() {
  return resolveCxp06UatHarness().execute({ scenario: 'READER_VISIBILITY' });
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
  };
}
