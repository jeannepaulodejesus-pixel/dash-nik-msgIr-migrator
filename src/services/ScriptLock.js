var ScriptLock = (function () {
  'use strict';

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function resolveLockService(lockService) {
    if (lockService && typeof lockService.getScriptLock === 'function') {
      return lockService;
    }
    if (
      typeof LockService !== 'undefined' &&
      LockService &&
      typeof LockService.getScriptLock === 'function'
    ) {
      return LockService;
    }
    throw resolveErrorCodes().create('INGESTION_INVALID_RUN_METADATA', {
      details: { field: 'lockService' },
    });
  }

  function withLock(lockService, timeoutMs, beforeRelease, work) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0) {
      throw resolveErrorCodes().create('INGESTION_INVALID_RUN_METADATA', {
        details: { field: 'lockTimeoutMs' },
      });
    }
    if (typeof work !== 'function') {
      throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
        details: { operation: 'lockedWork' },
      });
    }

    var lock = resolveLockService(lockService).getScriptLock();
    if (
      !lock ||
      typeof lock.tryLock !== 'function' ||
      typeof lock.releaseLock !== 'function'
    ) {
      throw resolveErrorCodes().create('INGESTION_INVALID_RUN_METADATA', {
        details: { field: 'scriptLock' },
      });
    }
    var acquired = lock.tryLock(timeoutMs) === true;
    if (acquired && typeof lock.hasLock === 'function') {
      acquired = lock.hasLock() === true;
    }
    if (!acquired) {
      throw resolveErrorCodes().create('INGESTION_LOCK_TIMEOUT', {
        details: { timeoutMs: timeoutMs },
      });
    }

    try {
      return work();
    } finally {
      try {
        if (typeof beforeRelease === 'function') {
          beforeRelease();
        }
      } finally {
        lock.releaseLock();
      }
    }
  }

  return Object.freeze({ withLock: withLock });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScriptLock;
}
