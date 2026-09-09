/** One-wave CXP-14 hosted UAT orchestration. Never polls continuations. */
var Cxp14UatOrchestrator = (function () {
  'use strict';

  var RELEASE_VERSION_KEY = 'CXP14_RELEASE_VERSION';
  var SOURCE_BUNDLE_DIGEST_KEY = 'CXP14_SOURCE_BUNDLE_DIGEST';
  var NEXT_ACTION = 're-run this CXP-14 step';

  function resolve(name, path) {
    if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name];
    if (typeof require === 'function') return require(path);
    throw new Error('A required CXP-14 orchestrator dependency is unavailable.');
  }
  function output(step, pass, details) {
    var evidence = resolve('Cxp14ReleaseEvidence', '../release/Cxp14ReleaseEvidence.js');
    var result = evidence.deepFreeze(Object.assign({ pass: pass === true, step: step }, details || {}));
    if (typeof console !== 'undefined' && typeof console.log === 'function') console.log('CXP14_UAT ' + step + ' ' + JSON.stringify(result));
    return result;
  }
  function identityMissing(evidence) {
    return ['contractVersion', 'releaseVersion', 'sourceBundleDigest'].filter(function (key) {
      return !evidence || !Object.prototype.hasOwnProperty.call(evidence, key);
    });
  }
  function releaseIdentity(evidence) {
    return {
      contractVersion: evidence.contractVersion,
      releaseVersion: evidence.releaseVersion,
      sourceBundleDigest: evidence.sourceBundleDigest,
    };
  }
  function persistGate(runtime, key, observed) {
    var evidence = runtime.readEvidence();
    if (observed !== true || identityMissing(evidence).length > 0) return false;
    var patch = {};
    patch[key] = true;
    runtime.recordEvidence(patch);
    return true;
  }
  function check(runtime, name, fallback) {
    if (!runtime.checks || typeof runtime.checks[name] !== 'function') return fallback === true;
    try { return runtime.checks[name]() === true; } catch (_error) { return false; }
  }
  function invoke(fn) {
    if (typeof fn !== 'function') return null;
    try { return fn.apply(null, Array.prototype.slice.call(arguments, 1)); } catch (error) {
      return { error: true, code: error && error.code ? String(error.code) : 'INGESTION_OPERATION_FAILED' };
    }
  }
  function queued(step, extra) {
    return output(step, false, Object.assign({ nextAction: NEXT_ACTION, status: 'QUEUED' }, extra || {}));
  }
  function digestOf(value) {
    return resolve('Cxp14RunTelemetry', '../release/Cxp14RunTelemetry.js').digestFromFingerprint(value);
  }
  function hosted() { return typeof SpreadsheetApp !== 'undefined'; }
  function hostedPredecessors() {
    if (!hosted()) return {};
    function load(name, path) { return resolve(name, path); }
    return {
      cxp11: {
        getSetupStatus: function () { return load('Cxp11Setup', './Cxp11Setup.js').getStatus(); },
        initialize: function () { return load('Cxp11Setup', './Cxp11Setup.js').initializeConfigured(); },
        getParityStatus: function () { return load('Cxp11ParityRun', './Cxp11ParityRun.js').getStatus(); },
        startParity: function (folderId) { return load('Cxp11ParityRun', './Cxp11ParityRun.js').start(folderId); },
      },
      cxp12: {
        getSetupStatus: function () { return load('Cxp12Setup', './Cxp12Setup.js').getStatus(); },
        step01: function () { return load('Cxp12Uat', './Cxp12UatEntrypoints.js').installRegistry(); },
        step02: function () { return load('Cxp12Uat', './Cxp12UatEntrypoints.js').createOrActivateWeek(); },
        step03: function () { return load('Cxp12Uat', './Cxp12UatEntrypoints.js').alignActiveTarget(); },
        step04: function () { return load('Cxp12Uat', './Cxp12UatEntrypoints.js').healthCheck(); },
      },
      cxp13: {
        getSetupStatus: function () { return load('Cxp13Setup', './Cxp13Setup.js').getStatus(); },
        discover: function () { return load('Cxp13Uat', './Cxp13UatEntrypoints.js').step03(); },
        start: function () { return load('Cxp13Uat', './Cxp13UatEntrypoints.js').step04(); },
        reconcile: function () { return load('Cxp13Uat', './Cxp13UatEntrypoints.js').step05(); },
        getIntakeStatus: function () { return load('RtaIntakeService', '../services/RtaIntakeService.js').getIntakeStatus(); },
        getRunStatus: function () { return load('RtaIntakeService', '../services/RtaIntakeService.js').getRunStatus(null); },
        step00: function () { return load('Cxp13Uat', './Cxp13UatEntrypoints.js').step00(); },
        step01: function () { return load('Cxp13Uat', './Cxp13UatEntrypoints.js').step01(); },
        step02: function () { return load('Cxp13Uat', './Cxp13UatEntrypoints.js').step02(); },
        step08: function () { return load('Cxp13Uat', './Cxp13UatEntrypoints.js').step08(); },
      },
    };
  }
  function latestLedgerDigest(runtime) {
    var pred = runtime.predecessors || {};
    if (typeof pred.findLatestSuccess === 'function') {
      var found = invoke(pred.findLatestSuccess);
      return digestOf(found && (found.fingerprint || found.sourceBundleDigest));
    }
    if (!hosted() || !runtime.configuration || !runtime.configuration.controlSpreadsheetId) return null;
    try {
      var control = SpreadsheetApp.openById(runtime.configuration.controlSpreadsheetId);
      var latest = resolve('FileLedgerRepository', '../repository/FileLedgerRepository.js').create(control).findLatestSuccess();
      return digestOf(latest && latest.fingerprint);
    } catch (_error) {
      return null;
    }
  }
  function buildIdentity(runtime) {
    var contract = resolve('Cxp14ReleaseEvidence', '../release/Cxp14ReleaseEvidence.js');
    var releaseVersion = runtime.properties.getProperty(RELEASE_VERSION_KEY);
    var digest = latestLedgerDigest(runtime) || digestOf(runtime.properties.getProperty(SOURCE_BUNDLE_DIGEST_KEY));
    var missing = [];
    if (!releaseVersion) missing.push('releaseVersion');
    if (!digest) missing.push('sourceBundleDigest');
    return {
      complete: missing.length === 0,
      missing: missing,
      patch: missing.length === 0 ? {
        contractVersion: contract.CONTRACT_VERSION,
        releaseVersion: releaseVersion,
        sourceBundleDigest: digest,
      } : null,
    };
  }
  function uniqueMissing(values) {
    var seen = Object.create(null);
    return (values || []).filter(function (key) {
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    }).sort();
  }
  function hasPredecessors(runtime) {
    return Boolean(runtime.predecessors && (runtime.predecessors.cxp11 || runtime.predecessors.cxp12 || runtime.predecessors.cxp13));
  }
  function configGaps(runtime) {
    var config = runtime.configuration || {};
    var missing = [];
    if (config.environment !== 'UAT') missing.push('environment');
    if (!hosted() && !hasPredecessors(runtime)) return missing;
    if (!config.controlSpreadsheetId) missing.push('controlSpreadsheetId');
    if (!config.targetSpreadsheetId) missing.push('targetSpreadsheetId');
    if (!config.driveInboxFolderId) missing.push('driveInboxFolderId');
    if (!config.rtaAllowedDomain) missing.push('rtaAllowedDomain');
    return missing;
  }
  function setupComplete(status) {
    return Boolean(status && (status.status === 'COMPLETE' || status.status === 'ACTIVE'));
  }
  function setupRunning(status) {
    return Boolean(status && (status.status === 'RUNNING' || status.continuationScheduled === true));
  }
  function driveCxp11Wave(runtime) {
    var cxp11 = runtime.predecessors && runtime.predecessors.cxp11;
    if (!cxp11) return { status: 'COMPLETE' };
    var setup = invoke(cxp11.getSetupStatus) || {};
    if (setupComplete(setup)) return { status: 'COMPLETE' };
    if (setupRunning(setup)) return { status: 'QUEUED', missing: ['cxp11Setup'] };
    if (typeof cxp11.initialize !== 'function') return { status: 'FAILED', missing: ['cxp11Setup'] };
    var started = invoke(cxp11.initialize);
    if (started && started.error) return { status: 'FAILED', missing: ['cxp11Setup'], code: started.code };
    if (setupComplete(started)) return { status: 'COMPLETE' };
    if (setupRunning(started)) return { status: 'QUEUED', missing: ['cxp11Setup'] };
    setup = invoke(cxp11.getSetupStatus) || {};
    if (setupComplete(setup)) return { status: 'COMPLETE' };
    if (setupRunning(setup)) return { status: 'QUEUED', missing: ['cxp11Setup'] };
    return { status: 'FAILED', missing: ['cxp11Setup'] };
  }
  function driveCxp12Wave(runtime) {
    var cxp12 = runtime.predecessors && runtime.predecessors.cxp12;
    if (!cxp12) return { status: 'COMPLETE' };
    var setup = invoke(cxp12.getSetupStatus) || {};
    if (!setupComplete(setup)) {
      invoke(cxp12.step01);
      setup = invoke(cxp12.getSetupStatus) || {};
      if (setupRunning(setup)) return { status: 'QUEUED', missing: ['cxp12Setup'] };
      if (!setupComplete(setup)) return { status: 'FAILED', missing: ['cxp12Setup'] };
    }
    var aligned = invoke(cxp12.step03);
    if (aligned && aligned.pass === true) return { status: 'COMPLETE' };
    invoke(cxp12.step02);
    aligned = invoke(cxp12.step03);
    if (aligned && aligned.pass === true) return { status: 'COMPLETE' };
    if (aligned && aligned.error) return { status: 'FAILED', missing: ['cxp12ActiveWeek'], code: aligned.code };
    if (typeof cxp12.step02 !== 'function') return { status: 'FAILED', missing: ['cxp12ActiveWeek'] };
    return { status: 'QUEUED', missing: ['cxp12ActiveWeek'] };
  }
  function predecessorGaps(runtime) {
    var pred = runtime.predecessors || {};
    var missing = [];
    if (pred.cxp11 && !setupComplete(invoke(pred.cxp11.getSetupStatus))) missing.push('cxp11Setup');
    if (pred.cxp12) {
      if (!setupComplete(invoke(pred.cxp12.getSetupStatus))) missing.push('cxp12Setup');
      else {
        var aligned = invoke(pred.cxp12.step03);
        if (!aligned || aligned.pass !== true) missing.push('cxp12ActiveWeek');
      }
    }
    return missing;
  }
  function activePipeline(status) {
    return Boolean(status && [
      'QUEUED', 'PROCESSING', 'RUNNING', 'PREPARING', 'BACKUP_PENDING', 'BACKING_UP',
      'COMMIT_PENDING', 'COMMITTING', 'HEALTH_PENDING', 'HEALTH_CHECKING',
      'ROLLBACK_PENDING', 'ROLLING_BACK',
    ].indexOf(status) !== -1);
  }
  function folders() {
    return resolve('Cxp14UatFixtureFolders', '../release/Cxp14UatFixtureFolders.js');
  }
  function recordedCount(runtime, repository, evidence) {
    if (!repository || typeof repository.reconcile !== 'function' || identityMissing(evidence).length > 0) return 0;
    try {
      var reconciliation = repository.reconcile(releaseIdentity(evidence));
      return reconciliation && Number.isInteger(reconciliation.recordedRunCount) ? reconciliation.recordedRunCount : 0;
    } catch (_error) {
      return 0;
    }
  }
  function discoveryOutcome(result) {
    if (!result || result.error !== true) return null;
    if (result.code === 'SOURCE_INBOX_BUNDLE_INCOMPLETE') return 'DISCOVERY_INCOMPLETE';
    if (result.code === 'SOURCE_INBOX_BUNDLE_AMBIGUOUS') return 'DISCOVERY_AMBIGUOUS';
    return null;
  }
  function classifyObservation(intake, run) {
    var discovery = discoveryOutcome(intake) || discoveryOutcome(run);
    if (discovery) return discovery;
    var status = run && run.status || intake && intake.status;
    if (status === 'VALIDATION_FAILED' || status === 'DUPLICATE' || status === 'PROCESSING_ERROR' || status === 'SUCCESS') {
      return status;
    }
    return null;
  }
  function retargetSlot(runtime, slot, kind) {
    var module = folders();
    var catalog = module.load(runtime.properties);
    if (!catalog || !slot) return { fixtureSlot: slot || null, ok: true, retargeted: false };
    var env = runtime.configuration && runtime.configuration.environment;
    if (!env || env === 'PROD') return { missing: Object.freeze(['environment']), ok: false };
    var folderId = module.folderIdFor(catalog, slot);
    if (!folderId) return { missing: Object.freeze(['fixtureFolder']), ok: false };
    var run = runtime.predecessors && runtime.predecessors.cxp13 ? invoke(runtime.predecessors.cxp13.getRunStatus) : null;
    if (run && run.error !== true && activePipeline(run.status)) {
      return { fixtureSlot: slot, ok: true, retargeted: false };
    }
    var changed = kind === 'parityExport'
      ? module.retargetParityExport(runtime.properties, env, folderId)
      : module.retargetInbox(runtime.properties, env, folderId);
    if (!changed) return { missing: Object.freeze(['fixtureFolder']), ok: false };
    var patch = {};
    if (kind === 'parityExport') patch.legacyParityExportFolderId = folderId;
    else patch.driveInboxFolderId = folderId;
    runtime.configuration = Object.assign({}, runtime.configuration || {}, patch);
    return { fixtureSlot: slot, ok: true, retargeted: true };
  }
  function recordFromTelemetry(runtime, profile, repository) {
    var evidence = runtime.readEvidence();
    var telemetry = resolve('Cxp13IngestionTelemetry', '../ingestion/Cxp13IngestionTelemetry.js').snapshot(runtime.properties);
    var cxp13 = runtime.predecessors && runtime.predecessors.cxp13;
    var run = cxp13 ? invoke(cxp13.getRunStatus) : null;
    var intake = cxp13 ? invoke(cxp13.getIntakeStatus) : null;
    var telemetryDigest = digestOf(telemetry.sourceBundleDigest);
    var runDigest = digestOf(run && run.sourceBundleDigest);
    var currentRun = Boolean(run && intake && run.runId && intake.runId && String(run.runId) === String(intake.runId));
    var sameRunToken = Boolean(currentRun && telemetry.runToken &&
      (String(telemetry.runToken) === String(run.runId) || String(telemetry.runToken) === String(run.batchToken)));
    if ((!telemetry.rowCounts || !telemetry.rowCounts.total) && run && run.status === 'SUCCESS' &&
        run.rowCounts && run.rowCounts.total > 0 && sameRunToken && telemetryDigest && (!runDigest || runDigest === telemetryDigest)) {
      telemetry = Object.assign({}, telemetry, { rowCounts: Object.assign({}, run.rowCounts) });
    }
    var harvest = resolve('Cxp14RunTelemetry', '../release/Cxp14RunTelemetry.js').harvest({
      activeWeekKeyAligned: Boolean(run && run.health && run.health.healthy) || check(runtime, 'activeWeekKeyAligned', false),
      endedAtUtc: run && run.endedAtUtc || telemetry.invocations.length && telemetry.invocations[telemetry.invocations.length - 1].endedAtUtc,
      healthResult: run && run.health && run.health.healthy === true ? 'HEALTHY' : null,
      identity: {
        contractVersion: evidence.contractVersion,
        releaseVersion: evidence.releaseVersion,
      },
      packagingKind: run && run.packagingKind || telemetry.packagingKind,
      profile: profile,
      sourceBundleDigest: telemetry.sourceBundleDigest,
      startedAtUtc: run && run.startedAtUtc || (telemetry.invocations[0] && telemetry.invocations[0].startedAtUtc),
      status: run && run.status === 'SUCCESS' ? 'SUCCESS' : null,
      telemetry: telemetry,
      terminalRunState: run && run.status === 'SUCCESS' ? 'SUCCESS' : null,
    });
    if (!harvest.eligible) return { recorded: false, missing: harvest.missing, status: 'NOT_RECORDED' };
    try {
      var result = repository.record(releaseIdentity(evidence), harvest.submission);
      return Object.assign({ recorded: true }, result);
    } catch (_error) {
      return { recorded: false, missing: ['performanceRecord'], status: 'NOT_RECORDED' };
    }
  }
  function driveCxp13Wave(runtime, slot) {
    var pointed = retargetSlot(runtime, slot, 'inbox');
    if (!pointed.ok) return { fixtureSlot: slot || null, missing: pointed.missing, status: 'NOT_RECORDED' };
    var cxp13 = runtime.predecessors && runtime.predecessors.cxp13;
    if (!cxp13) return { fixtureSlot: pointed.fixtureSlot || slot || null, status: 'IDLE' };
    var intake = invoke(cxp13.getIntakeStatus) || invoke(cxp13.discover);
    var discovery = discoveryOutcome(intake);
    if (discovery) return { fixtureSlot: pointed.fixtureSlot || slot || null, observation: discovery, status: discovery };
    if (intake && intake.auditActionRequired === true) {
      return {
        fixtureSlot: pointed.fixtureSlot || slot || null,
        missing: Object.freeze(['failureAudit']),
        observation: intake.status || 'PROCESSING_ERROR',
        status: 'NOT_RECORDED',
      };
    }
    if (intake && activePipeline(intake.status)) return { fixtureSlot: pointed.fixtureSlot || slot || null, status: 'QUEUED' };
    if (intake && (intake.status === 'READY' || intake.pass === true) && typeof cxp13.start === 'function') {
      var started = invoke(cxp13.start);
      if (started && (started.status === 'QUEUED' || started.pass === true || activePipeline(started.status))) {
        return { fixtureSlot: pointed.fixtureSlot || slot || null, status: 'QUEUED' };
      }
      if (started && started.error) {
        var startedDiscovery = discoveryOutcome(started);
        if (startedDiscovery) {
          return { fixtureSlot: pointed.fixtureSlot || slot || null, observation: startedDiscovery, status: startedDiscovery };
        }
        return { fixtureSlot: pointed.fixtureSlot || slot || null, missing: Object.freeze(['inboxBundle']), status: 'NOT_RECORDED' };
      }
    }
    var run = invoke(cxp13.getRunStatus) || invoke(cxp13.reconcile);
    if (run && activePipeline(run.status)) return { fixtureSlot: pointed.fixtureSlot || slot || null, status: 'QUEUED' };
    var observation = classifyObservation(intake, run);
    if (observation) return { fixtureSlot: pointed.fixtureSlot || slot || null, observation: observation, status: observation };
    if (cxp13.discover && (!intake || intake.pass !== true) && (!run || run.status === 'IDLE' || run.status === 'READY')) {
      var discovered = invoke(cxp13.discover);
      var discoveredOutcome = discoveryOutcome(discovered);
      if (discoveredOutcome) {
        return { fixtureSlot: pointed.fixtureSlot || slot || null, observation: discoveredOutcome, status: discoveredOutcome };
      }
      if (!discovered || discovered.pass !== true) {
        return { fixtureSlot: pointed.fixtureSlot || slot || null, missing: Object.freeze(['inboxBundle']), status: 'NOT_RECORDED' };
      }
      return { fixtureSlot: pointed.fixtureSlot || slot || null, status: 'QUEUED' };
    }
    return { fixtureSlot: pointed.fixtureSlot || slot || null, status: 'IDLE' };
  }
  function driveIntake(runtime, profile, repository, evidenceKey, stepName, slot) {
    var evidence = runtime.readEvidence();
    if (identityMissing(evidence).length > 0) {
      return output(stepName, false, {
        missing: identityMissing(evidence).concat([evidenceKey]).sort(),
        recordedRunCount: 0,
        requiredRunCount: repository.requiredRunCount || 3,
        status: 'NOT_RECORDED',
      });
    }
    var already = repository.reconcile(releaseIdentity(evidence));
    if (already.status === 'COMPLETE') {
      persistGate(runtime, evidenceKey, true);
      return output(stepName, true, {
        missing: Object.freeze([]),
        recordedRunCount: already.recordedRunCount,
        requiredRunCount: already.requiredRunCount,
        status: already.status,
      });
    }
    var wave = driveCxp13Wave(runtime, slot);
    if (wave.status === 'QUEUED') return queued(stepName, { fixtureSlot: wave.fixtureSlot || slot || null, status: 'QUEUED' });
    if (wave.observation === 'SUCCESS' || wave.status === 'SUCCESS') {
      var harvested = recordFromTelemetry(runtime, profile, repository);
      if (!harvested || harvested.recorded !== true) {
        return output(stepName, false, {
          fixtureSlot: wave.fixtureSlot || slot || null,
          missing: Object.freeze(uniqueMissing((harvested && harvested.missing) || ['performanceRecord'])),
          observation: 'SUCCESS',
          recordedRunCount: already.recordedRunCount,
          requiredRunCount: already.requiredRunCount,
          status: 'NOT_RECORDED',
        });
      }
    } else if (wave.missing && wave.missing.length) {
      return output(stepName, false, {
        fixtureSlot: wave.fixtureSlot || slot || null,
        missing: wave.missing,
        observation: wave.observation || null,
        recordedRunCount: already.recordedRunCount,
        requiredRunCount: already.requiredRunCount,
        status: 'NOT_RECORDED',
      });
    } else if (wave.observation) {
      return output(stepName, false, {
        fixtureSlot: wave.fixtureSlot || slot || null,
        missing: already.missing,
        observation: wave.observation,
        recordedRunCount: already.recordedRunCount,
        requiredRunCount: already.requiredRunCount,
        status: wave.observation,
      });
    } else if (wave.status === 'IDLE') {
      return output(stepName, false, {
        fixtureSlot: wave.fixtureSlot || slot || null,
        missing: Object.freeze(['inboxBundle']),
        recordedRunCount: already.recordedRunCount,
        requiredRunCount: already.requiredRunCount,
        status: 'NOT_RECORDED',
      });
    }
    var reconciliation = repository.reconcile(releaseIdentity(evidence));
    if (reconciliation.status === 'COMPLETE') persistGate(runtime, evidenceKey, true);
    return output(stepName, reconciliation.status === 'COMPLETE', {
      fixtureSlot: wave.fixtureSlot || slot || null,
      missing: reconciliation.missing,
      recordedRunCount: reconciliation.recordedRunCount,
      requiredRunCount: reconciliation.requiredRunCount,
      status: reconciliation.status,
    });
  }
  function step00(runtime) {
    var cxp12Wave = driveCxp12Wave(runtime);
    if (cxp12Wave.status === 'QUEUED') {
      return queued('CXP14UatStep00VerifyPrerequisites', { missing: Object.freeze(uniqueMissing(cxp12Wave.missing || ['cxp12ActiveWeek'])) });
    }
    var cxp11Wave = driveCxp11Wave(runtime);
    if (cxp11Wave.status === 'QUEUED') {
      return queued('CXP14UatStep00VerifyPrerequisites', { missing: Object.freeze(uniqueMissing(cxp11Wave.missing || ['cxp11Setup'])) });
    }
    var current = runtime.readEvidence();
    var identity = buildIdentity(runtime);
    if (identityMissing(current).length > 0) {
      if (!identity.complete) {
        return output('CXP14UatStep00VerifyPrerequisites', false, {
          environment: 'UAT',
          missing: Object.freeze(uniqueMissing(identity.missing.concat(['prerequisites']))),
        });
      }
      runtime.recordEvidence(identity.patch);
      current = runtime.readEvidence();
    }
    var missing = [];
    var observed;
    if (typeof runtime.checks.prerequisites === 'function') {
      observed = check(runtime, 'prerequisites', false);
      if (!observed) missing.push('prerequisites');
    } else if (hasPredecessors(runtime)) {
      missing = uniqueMissing(configGaps(runtime).concat(predecessorGaps(runtime)).concat(cxp12Wave.missing || []).concat(cxp11Wave.missing || []));
      observed = missing.length === 0;
    } else {
      observed = current.prerequisites === true;
      if (!observed) missing.push('prerequisites');
    }
    var pass = persistGate(runtime, 'prerequisites', observed);
    return output('CXP14UatStep00VerifyPrerequisites', pass, {
      environment: 'UAT',
      missing: Object.freeze(pass ? [] : uniqueMissing(identityMissing(runtime.readEvidence()).concat(missing.length ? missing : ['prerequisites']))),
    });
  }
  function step01(runtime) {
    var evidence = runtime.readEvidence();
    var status = runtime.setup.initialize({
      clock: runtime.clock,
      maxStepsPerInvocation: runtime.maxStepsPerInvocation,
      properties: runtime.properties,
      scriptApp: runtime.scriptApp,
      stepRunner: runtime.stepRunner,
    });
    if (status.status === 'RUNNING' || status.continuationScheduled === true) {
      return output('CXP14UatStep01InstallReleaseReadiness', false, {
        continuationScheduled: status.continuationScheduled === true,
        missing: identityMissing(evidence).concat(['setup']).sort(),
        setupStatus: status.status,
        status: 'QUEUED',
        nextAction: NEXT_ACTION,
      });
    }
    var observed = status.status === 'COMPLETE';
    var pass = persistGate(runtime, 'setup', observed);
    return output('CXP14UatStep01InstallReleaseReadiness', pass, {
      continuationScheduled: false,
      missing: pass ? Object.freeze([]) : identityMissing(evidence).concat(observed === true ? [] : ['setup']).sort(),
      setupStatus: status.status,
    });
  }
  function step02(runtime) {
    var gates = resolve('Cxp14HostedGates', '../release/Cxp14HostedGates.js');
    var evidence = runtime.readEvidence();
    var observed = check(runtime, 'criticalPaths', evidence.criticalPaths) || gates.inspectCriticalPaths(runtime);
    var pass = persistGate(runtime, 'criticalPaths', observed);
    return output('CXP14UatStep02InspectCriticalPaths', pass, {
      missing: pass ? Object.freeze([]) : identityMissing(evidence).concat(observed === true ? [] : ['criticalPaths']).sort(),
    });
  }
  function step03(runtime) {
    var evidence = runtime.readEvidence();
    var slot = folders().selectPeakSlot(recordedCount(runtime, runtime.performanceRepository, evidence));
    return driveIntake(runtime, 'EXPECTED_PEAK', runtime.performanceRepository, 'expectedPeak', 'CXP14UatStep03BenchmarkExpectedPeak', slot);
  }
  function step04(runtime) {
    var evidence = runtime.readEvidence();
    if (typeof runtime.checks.declaredMaximum === 'function' || evidence.declaredMaximum === true) {
      var observed = check(runtime, 'declaredMaximum', evidence.declaredMaximum);
      if (persistGate(runtime, 'declaredMaximum', observed)) {
        return output('CXP14UatStep04StressDeclaredMaximum', true, { status: 'COMPLETE' });
      }
      if (identityMissing(evidence).length > 0) {
        return output('CXP14UatStep04StressDeclaredMaximum', false, {
          missing: identityMissing(evidence).concat(['declaredMaximum']).sort(),
          status: 'NOT_RECORDED',
        });
      }
    }
    if (runtime.jobs && typeof runtime.jobs.startDeclaredMaximum === 'function') {
      var started = runtime.jobs.startDeclaredMaximum();
      var status = started && typeof started.status === 'string' && ['QUEUED', 'RUNNING', 'COMPLETE', 'FAILED'].indexOf(started.status) !== -1 ? started.status : 'QUEUED';
      if (status === 'QUEUED' || status === 'RUNNING') return queued('CXP14UatStep04StressDeclaredMaximum', { status: status });
    }
    return driveIntake(
      runtime,
      'DECLARED_MAXIMUM',
      runtime.declaredMaximumRepository,
      'declaredMaximum',
      'CXP14UatStep04StressDeclaredMaximum',
      'declaredMaximum',
    );
  }
  function step05(runtime) {
    var evidence = runtime.readEvidence();
    var gates = resolve('Cxp14HostedGates', '../release/Cxp14HostedGates.js');
    var module = folders();
    var catalog = module.load(runtime.properties);
    if (typeof runtime.checks.failureRecovery === 'function' || !catalog || !runtime.predecessors || !runtime.predecessors.cxp13) {
      var observed = check(runtime, 'failureRecovery', evidence.failureRecovery);
      if (!observed && runtime.predecessors && runtime.predecessors.cxp13) {
        var run = invoke(runtime.predecessors.cxp13.getRunStatus) || invoke(runtime.predecessors.cxp13.reconcile);
        var terminal = Boolean(run && (run.status === 'VALIDATION_FAILED' || run.status === 'DUPLICATE' || run.status === 'PROCESSING_ERROR' || run.status === 'SUCCESS'));
        observed = terminal && gates.inspectRollback(runtime);
      }
      if (!observed) observed = gates.inspectRollback(runtime) && check(runtime, 'failureRecovery', false);
      var pass = persistGate(runtime, 'failureRecovery', observed);
      return output('CXP14UatStep05VerifyFailureRecovery', pass, {
        missing: pass ? Object.freeze([]) : identityMissing(evidence).concat(observed === true ? [] : ['failureRecovery']).sort(),
      });
    }
    var progress = module.loadNegativeProgress(runtime.properties);
    if (progress.observedCount >= module.NEGATIVE_SLOTS.length) {
      var recovered = gates.inspectRollback(runtime);
      var complete = persistGate(runtime, 'failureRecovery', recovered);
      return output('CXP14UatStep05VerifyFailureRecovery', complete, {
        missing: complete ? Object.freeze([]) : identityMissing(evidence).concat(recovered === true ? [] : ['failureRecovery']).sort(),
        observedCount: progress.observedCount,
        requiredCount: module.NEGATIVE_SLOTS.length,
      });
    }
    var slot = module.selectNegativeSlot(progress.observedCount);
    var expected = module.expectedOutcome(slot);
    var wave = driveCxp13Wave(runtime, slot);
    if (wave.status === 'QUEUED') {
      return queued('CXP14UatStep05VerifyFailureRecovery', {
        fixtureSlot: slot,
        observedCount: progress.observedCount,
        requiredCount: module.NEGATIVE_SLOTS.length,
      });
    }
    if (wave.observation && wave.observation === expected) {
      progress = module.saveNegativeProgress(runtime.properties, {
        lastOutcome: wave.observation,
        lastSlot: slot,
        observedCount: progress.observedCount + 1,
      });
      if (progress.observedCount >= module.NEGATIVE_SLOTS.length) {
        var rollbackOk = gates.inspectRollback(runtime);
        var done = persistGate(runtime, 'failureRecovery', rollbackOk);
        return output('CXP14UatStep05VerifyFailureRecovery', done, {
          fixtureSlot: slot,
          missing: done ? Object.freeze([]) : identityMissing(evidence).concat(rollbackOk === true ? [] : ['failureRecovery']).sort(),
          observedCount: progress.observedCount,
          requiredCount: module.NEGATIVE_SLOTS.length,
        });
      }
      return output('CXP14UatStep05VerifyFailureRecovery', false, {
        fixtureSlot: slot,
        missing: Object.freeze(['failureRecovery']),
        nextAction: NEXT_ACTION,
        observedCount: progress.observedCount,
        requiredCount: module.NEGATIVE_SLOTS.length,
        status: 'NOT_RECORDED',
      });
    }
    return output('CXP14UatStep05VerifyFailureRecovery', false, {
      fixtureSlot: slot,
      missing: Object.freeze(wave.missing && wave.missing.length ? wave.missing : ['failureRecovery']),
      observedCount: progress.observedCount,
      requiredCount: module.NEGATIVE_SLOTS.length,
      status: 'NOT_RECORDED',
    });
  }
  function step06(runtime) {
    var evidence = runtime.readEvidence();
    var observed;
    if (typeof runtime.checks.lifecycleStatus === 'function') observed = check(runtime, 'lifecycleStatus', false);
    else if (runtime.predecessors && runtime.predecessors.cxp12 && runtime.predecessors.cxp13) {
      var health = invoke(runtime.predecessors.cxp12.step04);
      var promotion = invoke(runtime.predecessors.cxp13.step08);
      if (promotion && promotion.pass === true && health && health.pass === true) observed = true;
      else {
        invoke(runtime.predecessors.cxp13.step00);
        invoke(runtime.predecessors.cxp13.step01);
        invoke(runtime.predecessors.cxp13.discover);
        var started = invoke(runtime.predecessors.cxp13.start);
        if (started && (started.status === 'QUEUED' || activePipeline(started.status))) {
          return queued('CXP14UatStep06VerifyLifecycleAndStatus');
        }
        invoke(runtime.predecessors.cxp13.reconcile);
        promotion = invoke(runtime.predecessors.cxp13.step08);
        health = health || invoke(runtime.predecessors.cxp12.step04);
        observed = Boolean(health && health.pass === true && promotion && promotion.pass === true);
      }
    } else observed = evidence.lifecycleStatus === true;
    var pass = persistGate(runtime, 'lifecycleStatus', observed);
    return output('CXP14UatStep06VerifyLifecycleAndStatus', pass, {
      missing: pass ? Object.freeze([]) : identityMissing(evidence).concat(observed === true ? [] : ['lifecycleStatus']).sort(),
    });
  }
  function step07(runtime) {
    var evidence = runtime.readEvidence();
    var observed;
    if (typeof runtime.checks.finalParity === 'function') observed = check(runtime, 'finalParity', false);
    else if (runtime.predecessors && runtime.predecessors.cxp11) {
      var module = folders();
      var catalog = module.load(runtime.properties);
      var phase = module.loadParityPhase(runtime.properties);
      var status = invoke(runtime.predecessors.cxp11.getParityStatus);
      if (status && (status.runState === 'COMPLETE' || status.status === 'COMPLETE') && status.summary && status.summary.pass === true) {
        if (catalog) module.saveParityPhase(runtime.properties, 'COMPLETE');
        observed = true;
      } else if (status && activePipeline(status.runState || status.status)) {
        return queued('CXP14UatStep07RunFinalParityAndValidation', { parityPhase: phase });
      } else if (catalog && phase === 'SOURCE' && runtime.predecessors.cxp13) {
        var sourceWave = driveCxp13Wave(runtime, 'paritySource');
        if (sourceWave.status === 'QUEUED') {
          return queued('CXP14UatStep07RunFinalParityAndValidation', {
            fixtureSlot: 'paritySource',
            parityPhase: 'SOURCE',
          });
        }
        if (sourceWave.observation === 'SUCCESS' || sourceWave.observation === 'DUPLICATE') {
          module.saveParityPhase(runtime.properties, 'EXPORT');
          phase = 'EXPORT';
        } else {
          return output('CXP14UatStep07RunFinalParityAndValidation', false, {
            fixtureSlot: 'paritySource',
            missing: Object.freeze(sourceWave.missing && sourceWave.missing.length ? sourceWave.missing : ['inboxBundle']),
            parityPhase: 'SOURCE',
            status: 'NOT_RECORDED',
          });
        }
      }
      if (!observed) {
        var exportFolderId = catalog ? module.folderIdFor(catalog, 'parityExport') : null;
        if (catalog) retargetSlot(runtime, 'parityExport', 'parityExport');
        var started = invoke(runtime.predecessors.cxp11.startParity, exportFolderId);
        if (started && (started.runState === 'COMPLETE' || started.status === 'COMPLETE') && started.summary && started.summary.pass === true) {
          if (catalog) module.saveParityPhase(runtime.properties, 'COMPLETE');
          observed = true;
        } else {
          if (catalog) module.saveParityPhase(runtime.properties, 'EXPORT');
          return queued('CXP14UatStep07RunFinalParityAndValidation', { parityPhase: 'EXPORT' });
        }
      }
    } else observed = evidence.finalParity === true;
    var pass = persistGate(runtime, 'finalParity', observed);
    return output('CXP14UatStep07RunFinalParityAndValidation', pass, {
      missing: pass ? Object.freeze([]) : identityMissing(evidence).concat(observed === true ? [] : ['finalParity']).sort(),
    });
  }
  function step08(runtime) {
    var gates = resolve('Cxp14HostedGates', '../release/Cxp14HostedGates.js');
    var evidence = runtime.readEvidence();
    var peakComplete = false;
    if (identityMissing(evidence).length === 0) {
      try { peakComplete = runtime.performanceRepository.reconcile(releaseIdentity(evidence)).status === 'COMPLETE'; }
      catch (_error) { peakComplete = false; }
    }
    var observations = {
      criticalPaths: gates.inspectCriticalPaths(runtime) || evidence.criticalPaths === true,
      declaredMaximum: evidence.declaredMaximum === true || check(runtime, 'declaredMaximum', false),
      deploymentChecklistComplete: gates.inspectChecklist(runtime, evidence, peakComplete, evidence.finalParity === true),
      expectedPeak: peakComplete,
      failureRecovery: evidence.failureRecovery === true || gates.inspectRollback(runtime),
      finalParity: evidence.finalParity === true,
      lifecycleStatus: evidence.lifecycleStatus === true,
      permissionsVerified: gates.inspectPermissions(runtime),
      prerequisites: evidence.prerequisites === true,
      rollbackRehearsed: gates.inspectRollback(runtime),
      setup: evidence.setup === true,
    };
    Object.keys(observations).forEach(function (key) {
      if (observations[key] === true) persistGate(runtime, key, true);
    });
    var evaluated = Object.assign({}, runtime.readEvidence() || {});
    if (identityMissing(evaluated).length > 0 || !peakComplete) evaluated.expectedPeak = false;
    var promotion = resolve('Cxp14ReleaseEvidence', '../release/Cxp14ReleaseEvidence.js').evaluatePromotion(evaluated);
    return output('CXP14UatStep08PromotionGate', promotion.promotionReady, {
      missing: promotion.missing,
      promotionReady: promotion.promotionReady,
    });
  }

  return Object.freeze({
    NEXT_ACTION: NEXT_ACTION,
    RELEASE_VERSION_KEY: RELEASE_VERSION_KEY,
    SOURCE_BUNDLE_DIGEST_KEY: SOURCE_BUNDLE_DIGEST_KEY,
    hostedPredecessors: hostedPredecessors,
    step00: step00,
    step01: step01,
    step02: step02,
    step03: step03,
    step04: step04,
    step05: step05,
    step06: step06,
    step07: step07,
    step08: step08,
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Cxp14UatOrchestrator;
