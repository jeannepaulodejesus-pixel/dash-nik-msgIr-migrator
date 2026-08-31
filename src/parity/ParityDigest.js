/**
 * SHA-256 helper shared by the CXP-11 export adapter, comparator, and run
 * engine. Apps Script uses Utilities.computeDigest; Node test runs fall back to
 * node:crypto. No service is captured at module load.
 */
var ParityDigest = (function () {
  'use strict';

  var SHORT_HASH_LENGTH = 16;

  function hexFromSignedBytes(bytes) {
    var hex = '';
    var index;
    for (index = 0; index < bytes.length; index += 1) {
      hex += ((Number(bytes[index]) + 256) % 256).toString(16).padStart(2, '0');
    }
    return hex;
  }

  function appsScriptDigest(text) {
    if (
      typeof Utilities === 'undefined' ||
      !Utilities ||
      typeof Utilities.computeDigest !== 'function' ||
      !Utilities.DigestAlgorithm ||
      !Utilities.DigestAlgorithm.SHA_256
    ) {
      return null;
    }
    return hexFromSignedBytes(
      Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        text,
        Utilities.Charset.UTF_8,
      ),
    );
  }

  function sha256Hex(value) {
    var text = value === null || value === undefined ? '' : String(value);
    var hosted = appsScriptDigest(text);
    if (hosted) {
      return hosted;
    }
    return require('node:crypto')
      .createHash('sha256')
      .update(text, 'utf8')
      .digest('hex');
  }

  function shortHash(value) {
    return sha256Hex(value).slice(0, SHORT_HASH_LENGTH);
  }

  /** Canonical joined digest input; the unit separator cannot appear in CSV cells. */
  function joinFields(fields) {
    return (fields || []).map(function (field) {
      return field === null || field === undefined ? '' : String(field);
    }).join('\u001d');
  }

  function digestFields(fields) {
    return sha256Hex(joinFields(fields));
  }

  return Object.freeze({
    SHORT_HASH_LENGTH: SHORT_HASH_LENGTH,
    digestFields: digestFields,
    joinFields: joinFields,
    sha256Hex: sha256Hex,
    shortHash: shortHash,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ParityDigest;
}
