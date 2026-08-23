var CleanupService = (function () {
  'use strict';

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function resolveDriveApi(injected) {
    if (injected) {
      return injected;
    }
    if (typeof Drive !== 'undefined') {
      return Drive;
    }
    throw resolveErrorCodes().create('SOURCE_TEMP_CLEANUP_FAILED', {
      details: { reason: 'drive_api_unavailable' },
    });
  }

  function removeTempFile(fileId, services) {
    if (typeof fileId !== 'string' || !fileId) {
      throw resolveErrorCodes().create('SOURCE_TEMP_CLEANUP_FAILED', {
        details: { tempFileIdPresent: false },
      });
    }
    var driveApi = resolveDriveApi((services || {}).driveApi);
    if (!driveApi.Files || typeof driveApi.Files.remove !== 'function') {
      throw resolveErrorCodes().create('SOURCE_TEMP_CLEANUP_FAILED', {
        details: { reason: 'files_remove_unavailable', tempFileIdPresent: true },
      });
    }
    try {
      driveApi.Files.remove(fileId, { supportsAllDrives: true });
    } catch (error) {
      throw resolveErrorCodes().create('SOURCE_TEMP_CLEANUP_FAILED', {
        cause: error,
        details: { tempFileIdPresent: true },
      });
    }
    return Object.freeze({ fileId: fileId, removed: true });
  }

  return Object.freeze({ removeTempFile: removeTempFile });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CleanupService;
}
