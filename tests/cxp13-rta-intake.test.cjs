const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ErrorCodes = require('../src/monitoring/ErrorCodes.js');
global.ErrorCodes = ErrorCodes;
const InboxBundleRepository = require('../src/repository/InboxBundleRepository.js');
const Pipeline = require('../src/ingestion/IngestionPipelineController.js');
const RtaIntakeService = require('../src/services/RtaIntakeService.js');
const Cxp13Uat = require('../src/main/Cxp13UatEntrypoints.js');

function propertyStore(initial = {}) {
  const values = { ...initial };
  return {
    deleteProperty(key) { delete values[key]; },
    getProperty(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
    setProperty(key, value) { values[key] = String(value); },
  };
}

function file(name, id = name, updatedAtUtc = '2026-09-03T01:00:00.000Z') {
  return Object.freeze({ id, name, updatedAtUtc });
}

test('latest complete one-file delivery is selected by filename batch token', () => {
  const result = InboxBundleRepository.selectLatest([
    file('20260903T010000Z__bundle.xlsx'),
    file('20260903T020000Z__bundle.xlsx'),
  ]);
  assert.equal(result.status, 'READY');
  assert.equal(result.candidate.batchToken, '20260903T020000Z');
  assert.equal(result.candidate.packagingKind, 'multi_sheet_workbook');
  assert.deepEqual(result.candidate.datasetNames, ['Handled', 'Offered', 'AHT - Raw', 'Auxes - Raw', 'Staff']);
});

test('complete five-file delivery maps canonical datasets in stable order', () => {
  const token = '20260903T020000Z';
  const result = InboxBundleRepository.selectLatest(['staff','offered','auxes','handled','aht'].map((slug) => file(`${token}__${slug}.xls`)));
  assert.equal(result.candidate.packagingKind, 'single_dataset');
  assert.deepEqual(result.candidate.sources.map((source) => source.datasetName), ['Handled', 'Offered', 'AHT - Raw', 'Auxes - Raw', 'Staff']);
});

test('newest incomplete delivery blocks an older complete bundle', () => {
  assert.throws(() => InboxBundleRepository.selectLatest([
    file('20260903T010000Z__bundle.xlsx'),
    file('20260903T020000Z__handled.xls'),
  ]), { code: 'SOURCE_INBOX_BUNDLE_INCOMPLETE' });
});

test('mixed or duplicate packaging for one token fails as ambiguous', () => {
  assert.throws(() => InboxBundleRepository.selectLatest([
    file('20260903T020000Z__bundle.xlsx'),
    file('20260903T020000Z__handled.xls'),
  ]), { code: 'SOURCE_INBOX_BUNDLE_AMBIGUOUS' });
});

test('inbox scan fails closed after 200 files', () => {
  const files = Array.from({ length: 201 }, (_, index) => ({
    getId: () => `id-${index}`,
    getLastUpdated: () => new Date('2026-09-03T01:00:00Z'),
    getName: () => `ignored-${index}.txt`,
  }));
  let index = 0;
  const repository = InboxBundleRepository.create({ getFolderById: () => ({ getFiles: () => ({ hasNext: () => index < files.length, next: () => files[index++] }) }) }, 'folder');
  assert.throws(() => repository.getLatest(), { code: 'SOURCE_INBOX_TOO_LARGE' });
});

test('UTC batch tokens reject impossible dates', () => {
  assert.equal(InboxBundleRepository.validToken('20260229T010000Z'), false);
  assert.equal(InboxBundleRepository.validToken('20260903T010000Z'), true);
});

test('cooperative budget keeps the inherited 270s reserve boundary', () => {
  assert.equal(Pipeline.INVOCATION_BUDGET_MS, 270000);
  assert.equal(Pipeline.canStartAnotherStep(194999, 60000), true);
  assert.equal(Pipeline.canStartAnotherStep(195000, 60000), false);
  assert.equal(Pipeline.canStartAnotherStep(150000, 105000), false);
});

test('generic controller checkpoints each worker step, keeps one successor, and does not replay finalization', () => {
  const values = new Map();
  const properties = { getProperty: (key) => values.get(key) || null, setProperty: (key, value) => values.set(key, value) };
  let nextTrigger = 0;
  const triggers = [];
  const scriptApp = {
    deleteTrigger(trigger) { const index = triggers.indexOf(trigger); if (index >= 0) triggers.splice(index, 1); },
    getProjectTriggers: () => triggers.slice(),
    newTrigger(handler) { return { timeBased() { return this; }, after() { return this; }, create() { const id = `t-${++nextTrigger}`; const trigger = { getHandlerFunction: () => handler, getUniqueId: () => id }; triggers.push(trigger); return trigger; } }; },
  };
  let now = Date.parse('2026-09-03T01:00:00Z');
  const clock = { now: () => new Date(now) };
  let backupCalls = 0;
  let commitCalls = 0;
  let finalCalls = 0;
  const controller = Pipeline.create({
    handler: 'continueTest', stateKey: 'TEST_STATE',
    executorFactory: () => ({
      prepare: () => ({ checkpoint: { data: {}, request: {}, runId: 'run-1', startedAtUtc: new Date(now).toISOString() } }),
      backup: () => { backupCalls += 1; now += 1000; return { complete: backupCalls === 2, createdDatasetName: backupCalls === 1 ? 'Handled' : 'Offered' }; },
      commit: (state) => {
        commitCalls += 1; now += 1000;
        if (!state.checkpoint.data.commitProgress) return { commitProgress: { complete: true, lastCompletedDatasetName: 'Staff', nextDatasetIndex: 5 } };
        finalCalls += 1;
        return { runRecord: { endedAtUtc: new Date(now).toISOString(), runId: 'run-1', status: 'SUCCESS' } };
      },
    }),
  });
  const deps = { clock, properties, scriptApp };
  assert.equal(controller.start({ environment: 'DEV', runId: 'run-1' }, deps).status, 'QUEUED');
  assert.equal(triggers.length, 1);
  assert.equal(controller.continueRun(deps).status, 'BACKUP_PENDING');
  assert.equal(controller.continueRun(deps).status, 'COMMIT_PENDING');
  assert.equal(backupCalls, 2);
  assert.equal(controller.continueRun(deps).status, 'COMMIT_PENDING');
  assert.equal(controller.continueRun(deps).status, 'COMPLETE');
  assert.equal(triggers.length, 0);
  assert.equal(finalCalls, 1);
  assert.equal(controller.continueRun(deps).status, 'COMPLETE');
  assert.equal(finalCalls, 1);
  assert.equal(commitCalls, 2);
});

test('terminal status mapping separates success duplicate validation and processing errors', () => {
  assert.equal(RtaIntakeService.mapTerminal({ status: 'SUCCESS' }), 'SUCCESS');
  assert.equal(RtaIntakeService.mapTerminal({ status: 'FAILED_SOURCE', errorCode: 'SOURCE_DUPLICATE_SUBMISSION' }), 'DUPLICATE');
  assert.equal(RtaIntakeService.mapTerminal({ status: 'FAILED_SOURCE', errorCode: 'SCHEMA_INVALID_HEADERS' }), 'VALIDATION_FAILED');
  assert.equal(RtaIntakeService.mapTerminal({ status: 'FAILED_INGESTION', errorCode: 'INGESTION_OPERATION_FAILED' }), 'PROCESSING_ERROR');
});

test('domain authorization is fail-closed and never returns the user email', () => {
  const services = { session: { getActiveUser: () => ({ getEmail: () => 'rta@example.test' }) } };
  assert.equal(RtaIntakeService.authorize(services, { rtaAllowedDomain: 'example.test' }), true);
  assert.throws(() => RtaIntakeService.authorize(services, { rtaAllowedDomain: 'other.test' }), { code: 'INGESTION_UNAUTHORIZED_ACTOR' });
});

test('web surface uses server entrypoints, disables repeats, and polls at five seconds', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Cxp13Web.html'), 'utf8');
  assert.match(html, /cxp13GetIntakeStatus/);
  assert.match(html, /cxp13StartLatestBundle/);
  assert.match(html, /cxp13GetRunStatus/);
  assert.match(html, /setTimeout\(refreshRun,5000\)/);
  assert.match(html, /ui\.start\.disabled=busy/);
});

test('parameterless setup, web, continuation, and UAT entrypoints remain declared', () => {
  const files = ['Cxp13Setup.js', 'Cxp13WebEntrypoints.js', 'Cxp13UatEntrypoints.js'].map((name) => fs.readFileSync(path.join(__dirname, '..', 'src', 'main', name), 'utf8')).join('\n');
  ['initializeCxp13Intake','getCxp13IntakeSetupStatus','resetCxp13IntakeSetupState','doGet','cxp13GetIntakeStatus','cxp13StartLatestBundle','cxp13GetRunStatus','continueCxp13Ingestion'].forEach((name) => assert.match(files, new RegExp(`function ${name}\\(`)));
  for (let step = 0; step <= 8; step += 1) assert.match(files, new RegExp(`function CXP13UatStep0${step}`));
});

test('hosted UAT evidence recorder rejects missing input and consumes validated pending evidence', () => {
  const properties = propertyStore();
  assert.throws(() => Cxp13Uat.recordPending({ properties }), { code: 'CXP13_UAT_EVIDENCE_INVALID' });
  properties.setProperty(Cxp13Uat.PENDING_EVIDENCE_KEY, JSON.stringify({
    concurrency: true,
    duplicate: true,
    invalid: true,
    maxInvocationMs: 269999,
    multiInvocation: true,
    noTimeout: true,
    permissionsVerified: true,
    rollbackPreserved: true,
  }));
  const recorded = Cxp13Uat.recordPending({ properties });
  assert.equal(recorded.recorded, true);
  assert.equal(properties.getProperty(Cxp13Uat.PENDING_EVIDENCE_KEY), null);
  const gate = Cxp13Uat.step07({ properties });
  assert.equal(gate.pass, true);
  assert.deepEqual(gate.missing, []);
});

test('hosted UAT gate reports bounded missing predicates and rejects the 270000 ms boundary', () => {
  const properties = propertyStore();
  Cxp13Uat.recordNegative({ properties }, {
    concurrency: true,
    duplicate: true,
    invalid: true,
    maxInvocationMs: 270000,
    multiInvocation: true,
    noTimeout: false,
    permissionsVerified: false,
    rollbackPreserved: true,
  });
  const gate = Cxp13Uat.step07({ properties });
  assert.equal(gate.pass, false);
  assert.deepEqual(gate.missing, ['noTimeout', 'invocationUnder270000Ms']);
  const promotion = Cxp13Uat.step08({ properties });
  assert.equal(promotion.pass, false);
  assert.equal(promotion.missing.includes('permissionsVerified'), true);
});
