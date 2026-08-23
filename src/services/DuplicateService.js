var DuplicateService = (function () {
  'use strict';

  function resolveDriveService() {
    if (typeof DriveService !== 'undefined') {
      return DriveService;
    }
    return require('./DriveService.js');
  }

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function resolveUtilities(services) {
    if (services && services.utilities) {
      return services.utilities;
    }
    if (typeof Utilities !== 'undefined') {
      return Utilities;
    }
    throw resolveErrorCodes().create('INGESTION_INVALID_RUN_METADATA', {
      details: { field: 'Utilities' },
    });
  }

  function computeFingerprint(sources, services) {
    if (!Array.isArray(sources) || sources.length === 0) {
      throw resolveErrorCodes().create('SOURCE_INCOMPLETE_BUNDLE', {
        details: { sourceCount: Array.isArray(sources) ? sources.length : null },
      });
    }
    if (sources.length === 1) {
      return sources[0].contentFingerprint;
    }
    var parts = sources.map(function (source) {
      if (typeof source.datasetName !== 'string' || !source.datasetName) {
        throw resolveErrorCodes().create('SOURCE_INCOMPLETE_BUNDLE', {
          details: { reason: 'dataset_name_missing' },
        });
      }
      return source.datasetName + '\u0000' + source.contentFingerprint;
    }).sort();
    return resolveDriveService().computeSha256(parts.join('\n'), resolveUtilities(services));
  }

  function requireRepository(repository) {
    if (
      !repository ||
      typeof repository.findSuccessfulByFingerprint !== 'function' ||
      typeof repository.append !== 'function'
    ) {
      throw resolveErrorCodes().create('INGESTION_FILE_LEDGER_UNAVAILABLE', {
        details: { reason: 'ledger_repository_incomplete' },
      });
    }
    return repository;
  }

  function recordFor(input, result, originalSuccessfulRunId) {
    return Object.freeze({
      checkedAtUtc: input.checkedAtUtc,
      datasetNames: Object.freeze((input.datasetNames || []).slice().sort()),
      fingerprint: input.fingerprint,
      fingerprintAlgorithm: 'SHA-256',
      originalSuccessfulRunId: originalSuccessfulRunId || null,
      result: result,
      runId: input.runId,
      schemaVersion: input.schemaVersion,
      sourceFileIds: Object.freeze((input.sourceFiles || []).map(function (source) {
        return source.fileId;
      })),
      sourceFileNames: Object.freeze((input.sourceFiles || []).map(function (source) {
        return source.fileName;
      })),
    });
  }

  function check(input, repository) {
    var ledger = requireRepository(repository);
    var original = ledger.findSuccessfulByFingerprint(input.fingerprint);
    if (!original) {
      return Object.freeze({ isDuplicate: false, originalSuccessfulRunId: null });
    }
    var duplicateRecord = recordFor(input, 'DUPLICATE', original.runId);
    ledger.append([duplicateRecord]);
    var result = Object.freeze({
      fingerprint: input.fingerprint,
      isDuplicate: true,
      originalSuccessfulRunId: original.runId,
    });
    var error = resolveErrorCodes().create('SOURCE_DUPLICATE_SUBMISSION', {
      details: {
        fingerprint: input.fingerprint,
        originalSuccessfulRunId: original.runId,
      },
    });
    error.duplicateResult = result;
    throw error;
  }

  function recordSuccessful(input, repository) {
    var record = recordFor(input, 'SUCCESS', null);
    requireRepository(repository).append([record]);
    return record;
  }

  return Object.freeze({
    check: check,
    computeFingerprint: computeFingerprint,
    recordSuccessful: recordSuccessful,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DuplicateService;
}
