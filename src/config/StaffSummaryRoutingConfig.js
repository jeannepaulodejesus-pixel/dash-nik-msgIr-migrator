var StaffSummaryRoutingConfig = (function () {
  'use strict';

  var TOTAL_BUCKETS = 48;
  var DEFAULT_INPUT = Object.freeze({
    version: 1,
    totalBuckets: TOTAL_BUCKETS,
    rules: Object.freeze([
      Object.freeze({
        startBucket: 0,
        endBucketExclusive: 8,
        queSite: 'CNX-Que',
        lasSite: 'CNX-CR1',
      }),
      Object.freeze({
        startBucket: 8,
        endBucketExclusive: 48,
        queSite: 'INT-Que',
        lasSite: 'INT-LAS',
      }),
    ]),
  });

  function requireSite(value, field, ruleIndex) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(
        'Staff summary routing rule ' + ruleIndex + ' requires ' + field + '.',
      );
    }
    return value.trim();
  }

  function validate(input) {
    if (!input || typeof input !== 'object' || !Array.isArray(input.rules)) {
      throw new Error('Staff summary routing configuration requires rules.');
    }
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new Error('Staff summary routing version must be a positive integer.');
    }
    if (input.totalBuckets !== TOTAL_BUCKETS) {
      throw new Error('Staff summary routing must cover exactly 48 buckets.');
    }
    var rules = input.rules.map(function (rule, index) {
      if (
        !rule ||
        !Number.isInteger(rule.startBucket) ||
        !Number.isInteger(rule.endBucketExclusive) ||
        rule.startBucket < 0 ||
        rule.endBucketExclusive > TOTAL_BUCKETS ||
        rule.startBucket >= rule.endBucketExclusive
      ) {
        throw new Error('Staff summary routing rule ' + index + ' has invalid bounds.');
      }
      return Object.freeze({
        startBucket: rule.startBucket,
        endBucketExclusive: rule.endBucketExclusive,
        queSite: requireSite(rule.queSite, 'queSite', index),
        lasSite: requireSite(rule.lasSite, 'lasSite', index),
      });
    }).sort(function (left, right) {
      return left.startBucket - right.startBucket;
    });
    var nextBucket = 0;
    rules.forEach(function (rule) {
      if (rule.startBucket !== nextBucket) {
        throw new Error('Staff summary routing rules must be contiguous and non-overlapping.');
      }
      nextBucket = rule.endBucketExclusive;
    });
    if (nextBucket !== TOTAL_BUCKETS) {
      throw new Error('Staff summary routing rules must cover all 48 buckets.');
    }
    return Object.freeze({
      version: input.version,
      totalBuckets: TOTAL_BUCKETS,
      rules: Object.freeze(rules),
    });
  }

  var DEFAULT_CONFIG = validate(DEFAULT_INPUT);

  function get() {
    return DEFAULT_CONFIG;
  }

  function forBucket(bucketIndex, config) {
    if (!Number.isInteger(bucketIndex) || bucketIndex < 0 || bucketIndex >= TOTAL_BUCKETS) {
      throw new Error('Staff summary bucket index is out of range.');
    }
    var resolved = config ? validate(config) : DEFAULT_CONFIG;
    var match = resolved.rules.find(function (rule) {
      return bucketIndex >= rule.startBucket && bucketIndex < rule.endBucketExclusive;
    });
    if (!match) {
      throw new Error('Staff summary routing has no rule for bucket ' + bucketIndex + '.');
    }
    return match;
  }

  return Object.freeze({
    TOTAL_BUCKETS: TOTAL_BUCKETS,
    forBucket: forBucket,
    get: get,
    validate: validate,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StaffSummaryRoutingConfig;
}
