/**
 * CXP-11 pure comparison core.
 *
 * Key construction, DEC-025 interval alignment, closed-interval selection,
 * value normalization, tolerance evaluation, classification, and summary
 * aggregation. Nothing here reads Drive, Properties, or SpreadsheetApp; all
 * inputs arrive as plain records from the adapter and repository boundaries.
 */
var ParityComparator = (function () {
  'use strict';

  var BLANK = '\u0000BLANK';
  var SPACE = '\u0000SPACE';

  function resolveContracts() {
    if (typeof ParityContracts !== 'undefined') {
      return ParityContracts;
    }
    return require('./ParityContracts.js');
  }

  function resolveDigest() {
    if (typeof ParityDigest !== 'undefined') {
      return ParityDigest;
    }
    return require('./ParityDigest.js');
  }

  function isoDateToDays(isoDate) {
    var parts = String(isoDate).slice(0, 10).split('-');
    var utc = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (Number.isNaN(utc)) {
      return null;
    }
    return Math.round(utc / 86400000);
  }

  function daysToIsoDate(days) {
    var date = new Date(days * 86400000);
    return date.getUTCFullYear() +
      '-' + String(date.getUTCMonth() + 1).padStart(2, '0') +
      '-' + String(date.getUTCDate()).padStart(2, '0');
  }

  function intervalToMinutes(intervalStart) {
    var match = String(intervalStart).trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      return null;
    }
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function minutesToInterval(minutes) {
    var normalized = ((minutes % 1440) + 1440) % 1440;
    return String(Math.floor(normalized / 60)).padStart(2, '0') +
      ':' + String(normalized % 60).padStart(2, '0');
  }

  /** Absolute minutes so DEC-025 shifts can cross the calendar boundary. */
  function absoluteMinutes(businessDate, intervalStart) {
    var days = isoDateToDays(businessDate);
    var minutes = intervalToMinutes(intervalStart);
    if (days === null || minutes === null) {
      return null;
    }
    return days * 1440 + minutes;
  }

  function fromAbsoluteMinutes(total) {
    var days = Math.floor(total / 1440);
    return {
      businessDate: daysToIsoDate(days),
      intervalStart: minutesToInterval(total - days * 1440),
    };
  }

  function grainKey(grain) {
    return [
      grain.businessDate,
      grain.intervalStart,
      grain.site || '',
      grain.queueOrLob || '',
    ].join('\u001d');
  }

  function metricKey(grain, metric, aggregationIdentity) {
    return grainKey(grain) + '\u001d' + metric + '\u001d' + (aggregationIdentity || '');
  }

  function looksNumeric(text) {
    return /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text);
  }

  /**
   * Blanks, single-space legacy fallbacks, and error tokens are preserved as
   * distinct sentinels so blank-vs-zero and blank-vs-error never compare equal.
   */
  function normalizeValue(raw, contracts) {
    if (raw === null || raw === undefined) {
      return BLANK;
    }
    if (typeof raw === 'number') {
      return Number.isFinite(raw) ? raw : String(raw);
    }
    var text = String(raw);
    if (text === '') {
      return BLANK;
    }
    if (text.trim() === '') {
      return SPACE;
    }
    if (contracts.isErrorToken(text)) {
      return text.trim().toUpperCase();
    }
    var trimmed = text.trim();
    if (looksNumeric(trimmed)) {
      return Number(trimmed);
    }
    return trimmed;
  }

  function displayValue(normalized) {
    if (normalized === BLANK) {
      return '';
    }
    if (normalized === SPACE) {
      return ' ';
    }
    return normalized;
  }

  function create(services) {
    var dependencies = services || {};
    var contracts = dependencies.contracts || resolveContracts();
    var digest = dependencies.digest || resolveDigest();

    function nowIso() {
      if (dependencies.clock && typeof dependencies.clock.now === 'function') {
        var value = dependencies.clock.now();
        var date = value instanceof Date ? value : new Date(value);
        if (!Number.isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
      return new Date().toISOString();
    }

    /** Fixed-PST acquisition checkpoint in absolute minutes (DEC-025, no DST). */
    function checkpointMinutes(acquisitionTimestampUtc) {
      var date = new Date(acquisitionTimestampUtc);
      if (Number.isNaN(date.getTime())) {
        return null;
      }
      var shifted = new Date(
        date.getTime() + contracts.LEGACY_INTERVAL_SHIFT_MINUTES * 60000,
      );
      return Math.floor(shifted.getTime() / 60000);
    }

    function alignLegacyGrain(grain) {
      var total = absoluteMinutes(grain.businessDate, grain.intervalStart);
      if (total === null) {
        return null;
      }
      var shifted = fromAbsoluteMinutes(
        total + contracts.LEGACY_INTERVAL_SHIFT_MINUTES,
      );
      return {
        businessDate: shifted.businessDate,
        intervalStart: shifted.intervalStart,
        queueOrLob: grain.queueOrLob || '',
        site: grain.site || '',
      };
    }

    /** Only intervals whose right boundary is at or before the checkpoint. */
    function isClosedInterval(grain, checkpoint) {
      var total = absoluteMinutes(grain.businessDate, grain.intervalStart);
      if (total === null || checkpoint === null) {
        return false;
      }
      return total + contracts.INTERVAL_MINUTES <= checkpoint;
    }

    function comparisonId(parts) {
      return digest.shortHash(digest.joinFields(parts));
    }

    function makeComparison(fields) {
      var classification = fields.classification;
      return Object.freeze({
        aggregationIdentity: fields.aggregationIdentity || '',
        businessDate: fields.businessDate || '',
        chunkId: fields.chunkId,
        classification: classification,
        comparedAtUtc: fields.comparedAtUtc,
        comparisonId: fields.comparisonId,
        dataset: fields.dataset || '',
        delta: fields.delta === undefined ? '' : fields.delta,
        intervalStart: fields.intervalStart || '',
        lineage: fields.lineage,
        metricName: fields.metricName || '',
        phase: fields.phase,
        queueOrLob: fields.queueOrLob || '',
        resolutionStatus: contracts.resolutionFor(classification),
        runId: fields.runId,
        site: fields.site || '',
        sourceValue: fields.sourceValue === undefined ? '' : fields.sourceValue,
        targetValue: fields.targetValue === undefined ? '' : fields.targetValue,
        tolerance: fields.tolerance === undefined ? '' : fields.tolerance,
      });
    }

    function recordKey(record, keyFields, headers) {
      if (keyFields.length > 0) {
        return keyFields.map(function (field) {
          return String(record[field] === undefined ? '' : record[field]);
        }).join('\u001d');
      }
      return headers.map(function (header) {
        return String(record[header] === undefined ? '' : record[header]);
      }).join('\u001d');
    }

    function rowDigest(record, headers) {
      return digest.digestFields(headers.map(function (header) {
        return record[header] === undefined ? '' : record[header];
      }));
    }

    function indexRecords(records, keyFields, headers) {
      var index = Object.create(null);
      (records || []).forEach(function (record) {
        index[recordKey(record, keyFields, headers)] = record;
      });
      return index;
    }

    /**
     * Compares one bounded batch of a normalized source table. Values are never
     * persisted: only dataset, field, and hashed record/value identities.
     */
    function compareSourceTableChunk(request) {
      var legacy = request.legacy;
      var headers = legacy.headers.slice();
      var keyFields = legacy.keyFields.slice();
      var migratedRows = (request.migrated && request.migrated.rows) || [];
      var migratedIndex = indexRecords(migratedRows, keyFields, headers);
      var batchSize = request.batchSize || contracts.SOURCE_TABLE_BATCH_ROWS;
      var offset = request.offset || 0;
      var end = Math.min(offset + batchSize, legacy.rows.length);
      var chunkId = contracts.RUN_STATES.sourceTables + ':' + legacy.datasetName + ':' + offset;
      var comparedAtUtc = nowIso();
      var comparisons = [];

      if (
        request.migrated &&
        Array.isArray(request.migrated.headers) &&
        request.migrated.headers.join('\u001d') !== headers.join('\u001d')
      ) {
        comparisons.push(makeComparison({
          chunkId: chunkId,
          classification: contracts.CLASSIFICATIONS.invalidInput,
          comparedAtUtc: comparedAtUtc,
          comparisonId: comparisonId([request.runId, chunkId, 'HEADER_CONTRACT']),
          dataset: legacy.datasetName,
          lineage: JSON.stringify({
            reason: 'migrated_header_contract_mismatch',
            reference: contracts.LINEAGE_REFERENCES.metricLineage,
          }),
          metricName: 'HEADER_CONTRACT',
          phase: contracts.RUN_STATES.sourceTables,
          runId: request.runId,
        }));
      }

      var rowIndex;
      for (rowIndex = offset; rowIndex < end; rowIndex += 1) {
        var legacyRow = legacy.rows[rowIndex];
        var key = recordKey(legacyRow, keyFields, headers);
        var identity = digest.shortHash(key);
        var migratedRow = migratedIndex[key];
        if (!migratedRow) {
          comparisons.push(makeComparison({
            aggregationIdentity: identity,
            chunkId: chunkId,
            classification: contracts.CLASSIFICATIONS.missingTarget,
            comparedAtUtc: comparedAtUtc,
            comparisonId: comparisonId([request.runId, legacy.datasetName, identity, 'RECORD']),
            dataset: legacy.datasetName,
            lineage: JSON.stringify({
              dataset: legacy.datasetName,
              reference: contracts.LINEAGE_REFERENCES.metricLineage,
              rowIndex: rowIndex,
            }),
            metricName: 'RECORD',
            phase: contracts.RUN_STATES.sourceTables,
            runId: request.runId,
            sourceValue: rowDigest(legacyRow, headers),
          }));
          continue;
        }
        var fieldDiffs = [];
        headers.forEach(function (header) {
          var left = normalizeValue(legacyRow[header], contracts);
          var right = normalizeValue(migratedRow[header], contracts);
          if (left !== right) {
            fieldDiffs.push({ field: header, left: left, right: right });
          }
        });
        if (fieldDiffs.length === 0) {
          comparisons.push(makeComparison({
            aggregationIdentity: identity,
            chunkId: chunkId,
            classification: contracts.CLASSIFICATIONS.match,
            comparedAtUtc: comparedAtUtc,
            comparisonId: comparisonId([request.runId, legacy.datasetName, identity, 'RECORD']),
            dataset: legacy.datasetName,
            lineage: JSON.stringify({
              dataset: legacy.datasetName,
              fieldCount: headers.length,
              reference: contracts.LINEAGE_REFERENCES.metricLineage,
            }),
            metricName: 'RECORD',
            phase: contracts.RUN_STATES.sourceTables,
            runId: request.runId,
            sourceValue: rowDigest(legacyRow, headers),
            targetValue: rowDigest(migratedRow, headers),
            tolerance: 0,
          }));
          continue;
        }
        fieldDiffs.forEach(function (diff) {
          var expectedSourceError = contracts.isErrorToken(String(displayValue(diff.left)));
          comparisons.push(makeComparison({
            aggregationIdentity: identity,
            chunkId: chunkId,
            classification: expectedSourceError
              ? contracts.CLASSIFICATIONS.expectedSourceError
              : contracts.CLASSIFICATIONS.migrationDefect,
            comparedAtUtc: comparedAtUtc,
            comparisonId: comparisonId([
              request.runId,
              legacy.datasetName,
              identity,
              diff.field,
            ]),
            dataset: legacy.datasetName,
            lineage: JSON.stringify({
              dataset: legacy.datasetName,
              field: diff.field,
              reference: expectedSourceError
                ? contracts.LINEAGE_REFERENCES.sourceErrorBaseline
                : contracts.LINEAGE_REFERENCES.metricLineage,
            }),
            metricName: diff.field,
            phase: contracts.RUN_STATES.sourceTables,
            runId: request.runId,
            sourceValue: digest.shortHash(String(displayValue(diff.left))),
            targetValue: digest.shortHash(String(displayValue(diff.right))),
            tolerance: 0,
          }));
        });
      }

      var done = end >= legacy.rows.length;
      if (done) {
        var legacyKeys = Object.create(null);
        legacy.rows.forEach(function (row) {
          legacyKeys[recordKey(row, keyFields, headers)] = true;
        });
        Object.keys(migratedIndex).forEach(function (migratedKey) {
          if (legacyKeys[migratedKey]) {
            return;
          }
          var extraIdentity = digest.shortHash(migratedKey);
          comparisons.push(makeComparison({
            aggregationIdentity: extraIdentity,
            chunkId: chunkId,
            classification: contracts.CLASSIFICATIONS.missingSource,
            comparedAtUtc: comparedAtUtc,
            comparisonId: comparisonId([
              request.runId,
              legacy.datasetName,
              extraIdentity,
              'RECORD',
            ]),
            dataset: legacy.datasetName,
            lineage: JSON.stringify({
              dataset: legacy.datasetName,
              reference: contracts.LINEAGE_REFERENCES.metricLineage,
            }),
            metricName: 'RECORD',
            phase: contracts.RUN_STATES.sourceTables,
            runId: request.runId,
            targetValue: rowDigest(migratedIndex[migratedKey], headers),
          }));
        });
      }

      return Object.freeze({
        chunkId: chunkId,
        comparisons: Object.freeze(comparisons),
        done: done,
        nextOffset: end,
      });
    }

    function toMetricGrain(record) {
      return {
        businessDate: record.businessDate,
        intervalStart: record.intervalStart,
        queueOrLob: record.queueOrLob || '',
        site: record.site || '',
      };
    }

    function evaluateMetric(metric, left, right) {
      var tolerance = contracts.toleranceFor(metric);
      if (typeof left === 'number' && typeof right === 'number') {
        var delta = right - left;
        return {
          delta: delta,
          match: Math.abs(delta) <= (tolerance || 0),
          tolerance: tolerance === null ? 0 : tolerance,
        };
      }
      return {
        delta: '',
        match: left === right,
        tolerance: tolerance === null ? 0 : tolerance,
      };
    }

    /**
     * Compares one bounded batch of metrics on DEC-025-aligned, closed intervals
     * against the CXP-09/CXP-10 metric outputs.
     */
    function compareMetricChunk(request) {
      var metricNames = request.metricNames.slice();
      var checkpoint = checkpointMinutes(request.acquisitionTimestampUtc);
      var chunkId = contracts.RUN_STATES.metrics + ':' + (request.metricIndex || 0);
      var comparedAtUtc = nowIso();
      var comparisons = [];
      var selected = Object.create(null);

      var migratedIndex = Object.create(null);
      (request.migratedMetrics || []).forEach(function (record) {
        migratedIndex[metricKey(
          toMetricGrain(record),
          record.metric,
          record.aggregationIdentity,
        )] = record;
      });

      (request.legacyMetrics || []).forEach(function (record) {
        if (metricNames.indexOf(record.metric) === -1) {
          return;
        }
        var rawGrain = toMetricGrain(record);
        var aligned = alignLegacyGrain(rawGrain);
        if (!aligned) {
          comparisons.push(makeComparison({
            aggregationIdentity: record.aggregationIdentity,
            businessDate: record.businessDate,
            chunkId: chunkId,
            classification: contracts.CLASSIFICATIONS.invalidInput,
            comparedAtUtc: comparedAtUtc,
            comparisonId: comparisonId([request.runId, 'METRIC_KEY', record.metric,
              record.businessDate, record.intervalStart]),
            intervalStart: record.intervalStart,
            lineage: JSON.stringify({ reason: 'unparseable_legacy_grain' }),
            metricName: record.metric,
            phase: contracts.RUN_STATES.metrics,
            queueOrLob: record.queueOrLob,
            runId: request.runId,
            site: record.site,
          }));
          return;
        }
        if (!isClosedInterval(aligned, checkpoint)) {
          return;
        }
        var alignedKey = metricKey(aligned, record.metric, record.aggregationIdentity);
        selected[alignedKey] = true;
        var migrated = migratedIndex[alignedKey];
        var left = normalizeValue(record.value, contracts);
        var identityParts = [
          request.runId,
          record.metric,
          aligned.businessDate,
          aligned.intervalStart,
          aligned.site,
          aligned.queueOrLob,
          record.aggregationIdentity,
        ];

        if (!migrated) {
          comparisons.push(makeComparison({
            aggregationIdentity: record.aggregationIdentity,
            businessDate: aligned.businessDate,
            chunkId: chunkId,
            classification: contracts.CLASSIFICATIONS.missingTarget,
            comparedAtUtc: comparedAtUtc,
            comparisonId: comparisonId(identityParts),
            intervalStart: aligned.intervalStart,
            lineage: JSON.stringify({
              alignmentMinutes: contracts.LEGACY_INTERVAL_SHIFT_MINUTES,
              reference: contracts.LINEAGE_REFERENCES.metricLineage,
            }),
            metricName: record.metric,
            phase: contracts.RUN_STATES.metrics,
            queueOrLob: aligned.queueOrLob,
            runId: request.runId,
            site: aligned.site,
            sourceValue: displayValue(left),
          }));
          return;
        }

        var right = normalizeValue(migrated.value, contracts);
        var evaluation = evaluateMetric(record.metric, left, right);
        var classification = contracts.CLASSIFICATIONS.match;
        var lineage = {
          alignmentMinutes: contracts.LEGACY_INTERVAL_SHIFT_MINUTES,
          reference: contracts.LINEAGE_REFERENCES.metricLineage,
        };
        if (!evaluation.match) {
          var unaligned = migratedIndex[
            metricKey(rawGrain, record.metric, record.aggregationIdentity)
          ];
          var unalignedMatch = unaligned
            ? evaluateMetric(
              record.metric,
              left,
              normalizeValue(unaligned.value, contracts),
            ).match
            : false;
          if (contracts.isErrorToken(String(displayValue(left)))) {
            classification = contracts.CLASSIFICATIONS.expectedSourceError;
            lineage.reference = contracts.LINEAGE_REFERENCES.sourceErrorBaseline;
          } else if (unalignedMatch) {
            // The only approved variance: legacy keys unshifted by DEC-025.
            classification = contracts.CLASSIFICATIONS.approvedExpectedVariance;
            lineage.decision = contracts.LINEAGE_REFERENCES.dec025;
          } else {
            classification = contracts.CLASSIFICATIONS.migrationDefect;
          }
        }

        comparisons.push(makeComparison({
          aggregationIdentity: record.aggregationIdentity,
          businessDate: aligned.businessDate,
          chunkId: chunkId,
          classification: classification,
          comparedAtUtc: comparedAtUtc,
          comparisonId: comparisonId(identityParts),
          delta: evaluation.delta,
          intervalStart: aligned.intervalStart,
          lineage: JSON.stringify(lineage),
          metricName: record.metric,
          phase: contracts.RUN_STATES.metrics,
          queueOrLob: aligned.queueOrLob,
          runId: request.runId,
          site: aligned.site,
          sourceValue: displayValue(left),
          targetValue: displayValue(right),
          tolerance: evaluation.tolerance,
        }));
      });

      (request.migratedMetrics || []).forEach(function (record) {
        if (metricNames.indexOf(record.metric) === -1) {
          return;
        }
        var grain = toMetricGrain(record);
        var key = metricKey(grain, record.metric, record.aggregationIdentity);
        if (selected[key] || !isClosedInterval(grain, checkpoint)) {
          return;
        }
        comparisons.push(makeComparison({
          aggregationIdentity: record.aggregationIdentity,
          businessDate: record.businessDate,
          chunkId: chunkId,
          classification: contracts.CLASSIFICATIONS.missingSource,
          comparedAtUtc: comparedAtUtc,
          comparisonId: comparisonId([
            request.runId,
            record.metric,
            record.businessDate,
            record.intervalStart,
            record.site,
            record.queueOrLob,
            record.aggregationIdentity,
          ]),
          intervalStart: record.intervalStart,
          lineage: JSON.stringify({
            alignmentMinutes: contracts.LEGACY_INTERVAL_SHIFT_MINUTES,
            reference: contracts.LINEAGE_REFERENCES.metricLineage,
          }),
          metricName: record.metric,
          phase: contracts.RUN_STATES.metrics,
          queueOrLob: record.queueOrLob,
          runId: request.runId,
          site: record.site,
          targetValue: displayValue(normalizeValue(record.value, contracts)),
        }));
      });

      return Object.freeze({
        chunkId: chunkId,
        checkpointMinutes: checkpoint,
        comparisons: Object.freeze(comparisons),
      });
    }

    function baselineKey(worksheet, errorToken) {
      return String(worksheet) + '\u001d' + String(errorToken).toUpperCase();
    }

    /**
     * Classifies observed legacy errors against the installed WB0817 baseline and
     * asserts the authoritative total.
     */
    function classifyLegacyErrors(request) {
      var chunkId = contracts.RUN_STATES.errorClassification + ':0';
      var comparedAtUtc = nowIso();
      var comparisons = [];
      var expectedByKey = Object.create(null);
      var expectedTotal = 0;

      (request.baselineRecords || []).forEach(function (record) {
        var key = baselineKey(record.worksheet, record.errorType);
        expectedByKey[key] = (expectedByKey[key] || 0) + Number(record.expectedCount || 0);
        expectedTotal += Number(record.expectedCount || 0);
      });

      var observedByKey = Object.create(null);
      var observedTotal = 0;
      (request.legacyErrors || []).forEach(function (record) {
        var key = baselineKey(record.worksheet, record.errorToken);
        observedByKey[key] = (observedByKey[key] || 0) + record.observedCount;
        observedTotal += record.observedCount;
      });

      Object.keys(observedByKey).forEach(function (key) {
        var parts = key.split('\u001d');
        var expected = expectedByKey[key];
        var observed = observedByKey[key];
        var classification;
        if (expected === undefined) {
          classification = contracts.CLASSIFICATIONS.missingSource;
        } else if (observed === expected) {
          classification = contracts.CLASSIFICATIONS.expectedSourceError;
        } else {
          classification = contracts.CLASSIFICATIONS.migrationDefect;
        }
        comparisons.push(makeComparison({
          aggregationIdentity: digest.shortHash(key),
          chunkId: chunkId,
          classification: classification,
          comparedAtUtc: comparedAtUtc,
          comparisonId: comparisonId([request.runId, 'ERROR', key]),
          dataset: parts[0],
          delta: expected === undefined ? '' : observed - expected,
          lineage: JSON.stringify({
            baselineVersion: contracts.BASELINE_VERSION,
            reference: contracts.LINEAGE_REFERENCES.sourceErrorBaseline,
          }),
          metricName: parts[1],
          phase: contracts.RUN_STATES.errorClassification,
          runId: request.runId,
          sourceValue: observed,
          targetValue: expected === undefined ? '' : expected,
          tolerance: 0,
        }));
      });

      Object.keys(expectedByKey).forEach(function (key) {
        if (observedByKey[key] !== undefined) {
          return;
        }
        var parts = key.split('\u001d');
        comparisons.push(makeComparison({
          aggregationIdentity: digest.shortHash(key),
          chunkId: chunkId,
          classification: contracts.CLASSIFICATIONS.missingTarget,
          comparedAtUtc: comparedAtUtc,
          comparisonId: comparisonId([request.runId, 'ERROR', key]),
          dataset: parts[0],
          delta: -expectedByKey[key],
          lineage: JSON.stringify({
            baselineVersion: contracts.BASELINE_VERSION,
            reference: contracts.LINEAGE_REFERENCES.sourceErrorBaseline,
          }),
          metricName: parts[1],
          phase: contracts.RUN_STATES.errorClassification,
          runId: request.runId,
          targetValue: expectedByKey[key],
          tolerance: 0,
        }));
      });

      comparisons.push(makeComparison({
        chunkId: chunkId,
        classification: observedTotal === expectedTotal
          ? contracts.CLASSIFICATIONS.expectedSourceError
          : contracts.CLASSIFICATIONS.migrationDefect,
        comparedAtUtc: comparedAtUtc,
        comparisonId: comparisonId([request.runId, 'ERROR', 'BASELINE_TOTAL']),
        dataset: contracts.BASELINE_VERSION,
        delta: observedTotal - expectedTotal,
        lineage: JSON.stringify({
          baselineVersion: contracts.BASELINE_VERSION,
          controlWorkbookSha256: contracts.CONTROL_WORKBOOK_SHA256,
          reference: contracts.LINEAGE_REFERENCES.sourceErrorBaseline,
        }),
        metricName: 'BASELINE_TOTAL',
        phase: contracts.RUN_STATES.errorClassification,
        runId: request.runId,
        sourceValue: observedTotal,
        targetValue: expectedTotal,
        tolerance: 0,
      }));

      return Object.freeze({
        chunkId: chunkId,
        comparisons: Object.freeze(comparisons),
        expectedTotal: expectedTotal,
        observedTotal: observedTotal,
      });
    }

    function emptyCounters() {
      return {
        APPROVED_EXPECTED_VARIANCE: 0,
        EXPECTED_SOURCE_ERROR: 0,
        INVALID_INPUT: 0,
        MATCH: 0,
        MIGRATION_DEFECT: 0,
        MISSING_SOURCE: 0,
        MISSING_TARGET: 0,
      };
    }

    function accumulate(counters, comparisons) {
      var totals = counters || emptyCounters();
      (comparisons || []).forEach(function (comparison) {
        if (totals[comparison.classification] === undefined) {
          totals[comparison.classification] = 0;
        }
        totals[comparison.classification] += 1;
      });
      return totals;
    }

    function summarize(counters) {
      var totals = counters || emptyCounters();
      var comparisonCount = Object.keys(totals).reduce(function (sum, key) {
        return sum + totals[key];
      }, 0);
      var defectCount = contracts.DEFECT_CLASSIFICATIONS.reduce(function (sum, key) {
        return sum + (totals[key] || 0);
      }, 0);
      return Object.freeze({
        byClassification: Object.freeze(Object.assign({}, totals)),
        comparisonCount: comparisonCount,
        defectCount: defectCount,
        pass: defectCount === 0 && comparisonCount > 0,
      });
    }

    return Object.freeze({
      accumulate: accumulate,
      alignLegacyGrain: alignLegacyGrain,
      checkpointMinutes: checkpointMinutes,
      classifyLegacyErrors: classifyLegacyErrors,
      compareMetricChunk: compareMetricChunk,
      compareSourceTableChunk: compareSourceTableChunk,
      emptyCounters: emptyCounters,
      isClosedInterval: isClosedInterval,
      normalizeValue: function (value) { return normalizeValue(value, contracts); },
      summarize: summarize,
    });
  }

  return Object.freeze({
    BLANK: BLANK,
    SPACE: SPACE,
    create: create,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ParityComparator;
}
