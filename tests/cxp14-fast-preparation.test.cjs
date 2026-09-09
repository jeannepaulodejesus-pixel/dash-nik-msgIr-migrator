const assert = require('node:assert/strict');
const test = require('node:test');

const DatasetSheets = require('../src/config/DatasetSheets.js');
const Cxp13Runtime = require('../src/ingestion/Cxp13Runtime.js');

test('CXP14 initial single-dataset preparation gates duplicates before conversion and parses only the current dataset', () => {
  const datasetNames = DatasetSheets.listBindings().map((binding) => binding.datasetName);
  const currentDataset = datasetNames[0];
  const calls = [];
  const sourceFiles = datasetNames.map((datasetName) => ({
    contentFingerprint: `sha256:${datasetName}`,
    datasetName,
    fileId: `file-${datasetName}`,
    format: 'xlsx',
    lastUpdatedUtc: '2026-09-10T00:00:00.000Z',
    sizeBytes: 100,
  }));
  const payload = {
    datasetName: currentDataset,
    headers: ['id', 'value'],
    records: [[1, 'row']],
    rowCount: 1,
  };
  const runtime = {
    operations: {
      validateFile() {
        calls.push('validateFile');
        return { fingerprint: 'sha256:bundle', sourceFiles };
      },
      checkDuplicate() {
        calls.push('checkDuplicate');
        assert.deepEqual(calls, ['validateFile', 'checkDuplicate']);
        return { fingerprint: 'sha256:bundle', sourceFiles };
      },
      prepareSingleDataset(context, checkpointData, datasetName) {
        calls.push(`prepareSingleDataset:${datasetName}`);
        assert.equal(datasetName, currentDataset);
        assert.equal(checkpointData.fingerprint, 'sha256:bundle');
        assert.deepEqual(checkpointData.sourceFiles, sourceFiles);
        return { payload };
      },
      stageChunk(context) {
        calls.push('stageChunk');
        assert.deepEqual(context.operationResults.validateSchema.datasetNames, datasetNames);
        assert.deepEqual(context.operationResults.validateSchema.payloads, [payload]);
        return { complete: true, prepareCursor: null, workUnitDurationMs: 1 };
      },
    },
    request: {
      inputRowCounts: {},
      outputRowCounts: {},
      schemaVersion: '1.0.0',
      sourceActor: 'domain-user',
      sourceFileId: 'inbox:cxp14-fast-preparation',
      sourceFileName: 'cxp13-inbox-bundle',
      targetWorkbookId: 'target',
    },
    runServices: { generateRunId: () => 'run-cxp14-fast-preparation' },
  };
  const state = { packagingKind: 'single_dataset', runId: 'run-cxp14-fast-preparation' };
  const executor = Cxp13Runtime.executorFactory(state, {
    clock: { now: () => new Date('2026-09-10T00:00:00.000Z') },
    runtimeFactory: () => runtime,
  });

  const result = executor.prepare(state);

  assert.equal(result.complete, true);
  assert.deepEqual(calls, [
    'validateFile',
    'checkDuplicate',
    `prepareSingleDataset:${currentDataset}`,
    'stageChunk',
  ]);
  assert.deepEqual(result.checkpoint.data.rowCounts, { [currentDataset]: 1 });
  assert.deepEqual(result.checkpoint.data.sourceFiles, sourceFiles);
});
