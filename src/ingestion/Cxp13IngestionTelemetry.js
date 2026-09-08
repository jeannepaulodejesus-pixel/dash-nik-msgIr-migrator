/** Privacy-bounded CXP-13 ingestion telemetry. No IDs, emails, filenames, or rows. */
var Cxp13IngestionTelemetry = (function () {
  'use strict';

  var KEY = 'CXP13_INGESTION_TELEMETRY_V1';
  var VERSION = 1;
  var HARD_TIMEOUT_MS = 270000;
  var CALL_KEYS = Object.freeze(['drive', 'flush', 'lock', 'properties', 'spreadsheet', 'trigger']);
  var PHASE_DURATION_KEYS = Object.freeze([
    'backup', 'cleanup', 'commit', 'healthReadback', 'parity', 'preparation',
    'recalculation', 'rollback',
  ]);
  var ROW_KEYS = Object.freeze(['aht', 'auxes', 'handled', 'offered', 'staff', 'total']);
  var PHASE_MAP = Object.freeze({
    BACKING_UP: 'backup',
    BACKUP_PENDING: 'backup',
    COMMITTING: 'commit',
    COMMIT_PENDING: 'commit',
    PREPARING: 'preparation',
    QUEUED: 'preparation',
  });

  function emptyCounts(keys) {
    var result = {};
    keys.forEach(function (key) { result[key] = 0; });
    return result;
  }

  function empty(runToken) {
    return {
      chunkCount: 1,
      contentionCount: 0,
      continuationCount: 0,
      currentInvocationStartedAtUtc: null,
      currentInvocationStartedMs: null,
      invocations: [],
      lastKnownGoodPreserved: true,
      noQuotaFailure: true,
      packagingKind: null,
      phaseDurations: emptyCounts(PHASE_DURATION_KEYS),
      phaseStartedAtUtc: null,
      phaseStartedKey: null,
      rowCounts: emptyCounts(ROW_KEYS),
      runToken: runToken || null,
      serviceCallCounts: emptyCounts(CALL_KEYS),
      sourceBundleDigest: null,
      timedOut: false,
      version: VERSION,
      watchdogRecoveryCount: 0,
    };
  }

  function load(properties) {
    if (!properties || typeof properties.getProperty !== 'function') return empty(null);
    var raw = properties.getProperty(KEY);
    if (!raw) return empty(null);
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== VERSION) return empty(null);
      return parsed;
    } catch (_error) {
      return empty(null);
    }
  }

  function save(properties, bag) {
    if (!properties || typeof properties.setProperty !== 'function') return bag;
    properties.setProperty(KEY, JSON.stringify(bag));
    return bag;
  }

  function mutate(properties, mutator) {
    var bag = load(properties);
    mutator(bag);
    return save(properties, bag);
  }

  function increment(properties, kind, amount) {
    return mutate(properties, function (bag) {
      if (CALL_KEYS.indexOf(kind) === -1) return;
      bag.serviceCallCounts[kind] += Number.isInteger(amount) && amount > 0 ? amount : 1;
    });
  }

  function reset(properties, seed) {
    var bag = empty(seed && seed.runToken || null);
    if (seed) {
      if (seed.packagingKind) bag.packagingKind = seed.packagingKind;
      if (seed.sourceBundleDigest) bag.sourceBundleDigest = seed.sourceBundleDigest;
    }
    return save(properties, bag);
  }

  function closePhase(bag, nowIso) {
    if (!bag.phaseStartedKey || !bag.phaseStartedAtUtc) return;
    var elapsed = Date.parse(nowIso) - Date.parse(bag.phaseStartedAtUtc);
    if (Number.isFinite(elapsed) && elapsed > 0 && PHASE_DURATION_KEYS.indexOf(bag.phaseStartedKey) !== -1) {
      bag.phaseDurations[bag.phaseStartedKey] += elapsed;
    }
    bag.phaseStartedAtUtc = null;
    bag.phaseStartedKey = null;
  }

  function notePhase(properties, status, nowIso) {
    return mutate(properties, function (bag) {
      var key = PHASE_MAP[status] || null;
      if (bag.phaseStartedKey === key) return;
      closePhase(bag, nowIso);
      if (key) {
        bag.phaseStartedAtUtc = nowIso;
        bag.phaseStartedKey = key;
      }
    });
  }

  function beginInvocation(properties, nowIso, nowMs) {
    return mutate(properties, function (bag) {
      if (bag.currentInvocationStartedMs != null) {
        var elapsed = nowMs - bag.currentInvocationStartedMs;
        if (elapsed >= HARD_TIMEOUT_MS) {
          bag.timedOut = true;
          bag.watchdogRecoveryCount += 1;
          bag.invocations.push({
            durationMs: elapsed,
            endedAtUtc: nowIso,
            startedAtUtc: bag.currentInvocationStartedAtUtc,
          });
        }
      }
      bag.currentInvocationStartedAtUtc = nowIso;
      bag.currentInvocationStartedMs = nowMs;
    });
  }

  function endInvocation(properties, nowIso, nowMs) {
    return mutate(properties, function (bag) {
      if (bag.currentInvocationStartedMs == null) return;
      var duration = nowMs - bag.currentInvocationStartedMs;
      bag.invocations.push({
        durationMs: duration,
        endedAtUtc: nowIso,
        startedAtUtc: bag.currentInvocationStartedAtUtc,
      });
      if (duration >= HARD_TIMEOUT_MS) bag.timedOut = true;
      bag.currentInvocationStartedAtUtc = null;
      bag.currentInvocationStartedMs = null;
    });
  }

  function noteContinuation(properties) {
    return mutate(properties, function (bag) {
      if (bag.invocations.length > 0) bag.continuationCount += 1;
    });
  }

  function noteContention(properties) {
    return mutate(properties, function (bag) { bag.contentionCount += 1; });
  }

  function noteChunk(properties, count) {
    return mutate(properties, function (bag) {
      var next = Number.isInteger(count) && count > 0 ? count : bag.chunkCount + 1;
      if (next > bag.chunkCount) bag.chunkCount = next;
    });
  }

  function mapRowCounts(datasetCounts) {
    var mapped = emptyCounts(ROW_KEYS);
    if (!datasetCounts) return mapped;
    var aliases = Object.create(null);
    aliases.Handled = 'handled';
    aliases.handled = 'handled';
    aliases.Offered = 'offered';
    aliases.offered = 'offered';
    aliases.AHT = 'aht';
    aliases.aht = 'aht';
    aliases['AHT - Raw'] = 'aht';
    aliases.Auxes = 'auxes';
    aliases.auxes = 'auxes';
    aliases['Auxes - Raw'] = 'auxes';
    aliases.Staff = 'staff';
    aliases.staff = 'staff';
    aliases.total = 'total';
    Object.keys(datasetCounts).forEach(function (key) {
      var dest = aliases[key];
      if (dest && Number.isInteger(datasetCounts[key]) && datasetCounts[key] >= 0) mapped[dest] = datasetCounts[key];
    });
    mapped.total = mapped.aht + mapped.auxes + mapped.handled + mapped.offered + mapped.staff;
    return mapped;
  }

  function noteRowCounts(properties, counts) {
    return mutate(properties, function (bag) {
      var mapped = mapRowCounts(counts);
      ROW_KEYS.forEach(function (key) {
        if (Number.isInteger(mapped[key]) && mapped[key] >= 0) bag.rowCounts[key] = mapped[key];
      });
    });
  }

  function noteDigest(properties, digest) {
    return mutate(properties, function (bag) { bag.sourceBundleDigest = digest || bag.sourceBundleDigest; });
  }

  function noteLastKnownGood(properties, preserved) {
    return mutate(properties, function (bag) {
      if (preserved === false) bag.lastKnownGoodPreserved = false;
    });
  }

  function noteQuotaFailure(properties) {
    return mutate(properties, function (bag) { bag.noQuotaFailure = false; });
  }

  function snapshot(properties) {
    return JSON.parse(JSON.stringify(load(properties)));
  }

  return Object.freeze({
    CALL_KEYS: CALL_KEYS,
    HARD_TIMEOUT_MS: HARD_TIMEOUT_MS,
    KEY: KEY,
    PHASE_DURATION_KEYS: PHASE_DURATION_KEYS,
    ROW_KEYS: ROW_KEYS,
    VERSION: VERSION,
    beginInvocation: beginInvocation,
    empty: empty,
    endInvocation: endInvocation,
    increment: increment,
    load: load,
    mapRowCounts: mapRowCounts,
    noteChunk: noteChunk,
    noteContention: noteContention,
    noteContinuation: noteContinuation,
    noteDigest: noteDigest,
    noteLastKnownGood: noteLastKnownGood,
    notePhase: notePhase,
    noteQuotaFailure: noteQuotaFailure,
    noteRowCounts: noteRowCounts,
    reset: reset,
    snapshot: snapshot,
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Cxp13IngestionTelemetry;
