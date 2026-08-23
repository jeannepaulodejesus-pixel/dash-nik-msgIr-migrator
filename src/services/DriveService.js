var DriveService = (function () {
  'use strict';

  var MIME_TYPES = Object.freeze({
    GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet',
    HTML: 'text/html',
    XLS: 'application/vnd.ms-excel',
    XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  var FORMATS = Object.freeze({
    HTML_TABLE: 'html_table',
    XLSX: 'xlsx',
  });

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function resolveService(injected, globalName) {
    if (injected) {
      return injected;
    }
    if (typeof globalThis !== 'undefined' && globalThis[globalName]) {
      return globalThis[globalName];
    }
    throw resolveErrorCodes().create('INGESTION_INVALID_RUN_METADATA', {
      details: { field: globalName },
    });
  }

  function unsignedByte(value) {
    return (Number(value) + 256) % 256;
  }

  function beginsWith(bytes, signature) {
    return signature.every(function (value, index) {
      return unsignedByte(bytes[index]) === value;
    });
  }

  function leadingText(bytes) {
    return bytes
      .slice(0, 128)
      .map(function (value) { return String.fromCharCode(unsignedByte(value)); })
      .join('')
      .replace(/^\uFEFF/, '')
      .trimStart()
      .toLowerCase();
  }

  function detectFormat(bytes, mimeType, fileName) {
    var isZip = beginsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    if (
      isZip &&
      (mimeType === MIME_TYPES.XLSX || /\.xlsx$/i.test(fileName || ''))
    ) {
      return FORMATS.XLSX;
    }

    var prefix = leadingText(bytes);
    if (
      prefix.indexOf('<head') === 0 ||
      prefix.indexOf('<html') === 0 ||
      prefix.indexOf('<!doctype html') === 0
    ) {
      return FORMATS.HTML_TABLE;
    }

    throw resolveErrorCodes().create('SOURCE_UNSUPPORTED_FORMAT', {
      details: { fileIdPresent: true, mimeType: mimeType || '' },
    });
  }

  function toHex(bytes) {
    return bytes.map(function (value) {
      return unsignedByte(value).toString(16).padStart(2, '0');
    }).join('');
  }

  function computeSha256(bytes, utilities) {
    if (
      !utilities ||
      !utilities.DigestAlgorithm ||
      !utilities.DigestAlgorithm.SHA_256 ||
      typeof utilities.computeDigest !== 'function'
    ) {
      throw resolveErrorCodes().create('INGESTION_INVALID_RUN_METADATA', {
        details: { field: 'Utilities.computeDigest' },
      });
    }
    return 'sha256:' + toHex(
      utilities.computeDigest(utilities.DigestAlgorithm.SHA_256, bytes),
    );
  }

  function readFile(fileId, services) {
    if (typeof fileId !== 'string' || !fileId.trim()) {
      throw resolveErrorCodes().create('SOURCE_FILE_NOT_FOUND', {
        details: { fileIdPresent: false },
      });
    }

    var dependencies = services || {};
    var driveApp = resolveService(dependencies.driveApp, 'DriveApp');
    var utilities = resolveService(dependencies.utilities, 'Utilities');
    var file;
    try {
      file = driveApp.getFileById(fileId);
    } catch (error) {
      throw resolveErrorCodes().create('SOURCE_FILE_NOT_FOUND', {
        cause: error,
        details: { fileIdPresent: true },
      });
    }

    var blob = file.getBlob();
    var bytes = Object.freeze(Array.prototype.slice.call(blob.getBytes()));
    var fileName = file.getName();
    var mimeType = file.getMimeType() || blob.getContentType() || '';
    var lastUpdated = file.getLastUpdated();

    return Object.freeze({
      blob: blob,
      bytes: bytes,
      contentFingerprint: computeSha256(bytes, utilities),
      fileId: file.getId(),
      fileName: fileName,
      format: detectFormat(bytes, mimeType, fileName),
      lastUpdatedUtc: lastUpdated instanceof Date
        ? lastUpdated.toISOString()
        : new Date(lastUpdated).toISOString(),
      mimeType: mimeType,
      sizeBytes: file.getSize(),
    });
  }

  function publicMetadata(source) {
    return Object.freeze({
      contentFingerprint: source.contentFingerprint,
      fileId: source.fileId,
      fileName: source.fileName,
      format: source.format,
      lastUpdatedUtc: source.lastUpdatedUtc,
      mimeType: source.mimeType,
      sizeBytes: source.sizeBytes,
    });
  }

  return Object.freeze({
    FORMATS: FORMATS,
    MIME_TYPES: MIME_TYPES,
    computeSha256: computeSha256,
    detectFormat: detectFormat,
    publicMetadata: publicMetadata,
    readFile: readFile,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DriveService;
}
