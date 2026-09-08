const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const checkerPath = path.resolve(__dirname, '../scripts/check-context-contract.mjs');

function checkpoint(overrides = {}) {
  const fields = {
    updated: '**Updated UTC:** 2026-09-08T00:00:00Z',
    head: '**HEAD:** abc123',
    fingerprint: 'Dirty-worktree fingerprint: clean',
    userOwned: 'User-owned paths: none',
    ...overrides,
  };
  return `# Current checkpoint

${fields.updated}

## Goal
Keep the active context recoverable.

## Scope and non-goals
Only repository context files.

## Authorization
Repository-local edits only.

## Plan state
Implemented.

## Source-anchored decisions
The approved plan is authoritative.

## Evidence and tests
Context checker tests.

## Dirty inventory and fingerprint
${fields.head}
${fields.fingerprint}
${fields.userOwned}

## Blockers and risks
None.

## Next safe action
Run the checker.
`;
}

function makeRepository(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    'AGENTS.md': '[Bootstrap](docs/ai/bootstrap.md)\n',
    'docs/ai/bootstrap.md': '[Context index](context-index.md)\n',
    'docs/ai/context-index.md':
      '| Topic | Source |\n| --- | --- |\n| Active goal | [Goal](checkpoints/current.md#goal) |\n',
    'docs/ai/checkpoints/current.md': checkpoint(),
    ...overrides,
  };
  for (const [relativePath, content] of Object.entries(files)) {
    if (content == null) continue;
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

async function loadChecker() {
  return import(pathToFileURL(checkerPath).href);
}

test('accepts a complete contract and reports byte measurements', async (t) => {
  const checker = await loadChecker();
  const root = makeRepository(t);
  const result = await checker.validateContextContract({ projectRoot: root });

  assert.deepEqual(result.violations, []);
  assert.equal(typeof result.sizes.agentsBytes, 'number');
  assert.match(checker.formatMeasurements(result.sizes), /AGENTS \d+\/4096 bytes/);
});

test('enforces every budget at the exact byte boundary', async () => {
  const checker = await loadChecker();
  const validCheckpoint = checkpoint();
  const checkpointAtLimit =
    validCheckpoint + ' '.repeat(6144 - Buffer.byteLength(validCheckpoint, 'utf8'));

  const atBoundary = checker.validateContextBudgets({
    agents: 'a'.repeat(4096),
    bootstrap: 'b'.repeat(4096),
    index: 'i'.repeat(4096),
    checkpoint: checkpointAtLimit,
  });
  assert.deepEqual(atBoundary.violations, []);

  const cases = [
    [
      { agents: 'a'.repeat(4097), bootstrap: '', index: '', checkpoint: validCheckpoint },
      'agents-budget',
    ],
    [
      {
        agents: '',
        bootstrap: 'b'.repeat(4096),
        index: 'i'.repeat(4097),
        checkpoint: validCheckpoint,
      },
      'bootstrap-index-budget',
    ],
    [{ agents: '', bootstrap: '', index: '', checkpoint: 'c'.repeat(6145) }, 'checkpoint-budget'],
  ];
  for (const [files, rule] of cases) {
    assert.ok(checker.validateContextBudgets(files).violations.some((item) => item.rule === rule));
  }
});

test('reports broken local targets and indexed headings', async (t) => {
  const checker = await loadChecker();
  const missingTargetRoot = makeRepository(t, {
    'docs/ai/bootstrap.md': '[Missing](missing.md)\n',
  });
  const missingHeadingRoot = makeRepository(t, {
    'docs/ai/context-index.md':
      '| Topic | Source |\n| --- | --- |\n| Missing | [Nope](checkpoints/current.md#not-present) |\n',
  });

  const missingTarget = await checker.validateContextContract({ projectRoot: missingTargetRoot });
  const missingHeading = await checker.validateContextContract({ projectRoot: missingHeadingRoot });
  assert.ok(missingTarget.violations.some((item) => item.rule === 'broken-local-link'));
  assert.ok(missingHeading.violations.some((item) => item.rule === 'broken-index-heading'));
});

test('reports a stale or missing active checkpoint pointer', async (t) => {
  const checker = await loadChecker();
  const staleRoot = makeRepository(t, {
    'docs/ai/context-index.md':
      '| Topic | Source |\n| --- | --- |\n| Active state | [Old](checkpoints/old.md) |\n',
    'docs/ai/checkpoints/old.md': '# Old\n',
  });
  const missingRoot = makeRepository(t, {
    'docs/ai/context-index.md': '| Topic | Source |\n| --- | --- |\n| Architecture | [Bootstrap](bootstrap.md) |\n',
  });

  const stale = await checker.validateContextContract({ projectRoot: staleRoot });
  const missing = await checker.validateContextContract({ projectRoot: missingRoot });
  assert.ok(stale.violations.some((item) => item.rule === 'stale-active-pointer'));
  assert.ok(missing.violations.some((item) => item.rule === 'missing-active-pointer'));
});

test('reports missing checkpoint sections and required fields', async (t) => {
  const checker = await loadChecker();
  const invalid = checkpoint({ head: '', fingerprint: '' }).replace('## Goal', '## Objective');
  const root = makeRepository(t, { 'docs/ai/checkpoints/current.md': invalid });
  const result = await checker.validateContextContract({ projectRoot: root });

  assert.ok(
    result.violations.some(
      (item) => item.rule === 'missing-checkpoint-heading' && item.detail === 'Goal',
    ),
  );
  assert.ok(
    result.violations.some(
      (item) => item.rule === 'missing-checkpoint-field' && item.detail === 'HEAD',
    ),
  );
  assert.ok(
    result.violations.some(
      (item) =>
        item.rule === 'missing-checkpoint-field' && item.detail === 'dirty fingerprint',
    ),
  );
});

test('rejects oversized required full reads but ignores quoted history and excluded trees', async (t) => {
  const checker = await loadChecker();
  const root = makeRepository(t, {
    'AGENTS.md': 'You must read [the manual](docs/manual.md) completely.\n',
    'docs/manual.md': 'x'.repeat(32769),
    'docs/at-limit.md': 'x'.repeat(32768),
    'docs/history.md':
      '> You must read [the manual](manual.md) completely.\n\nYou must read [at limit](at-limit.md) fully.\n',
    'vendor/instructions.md': 'You must read [the manual](../docs/manual.md) completely.\n',
  });
  const result = await checker.validateContextContract({ projectRoot: root });
  const violations = result.violations.filter((item) => item.rule === 'oversized-full-read-target');

  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, 'AGENTS.md');
});

test('CLI exits zero for a valid fixture and nonzero with concise violations', (t) => {
  const validRoot = makeRepository(t);
  const invalidRoot = makeRepository(t, { 'docs/ai/checkpoints/current.md': null });
  const valid = spawnSync(process.execPath, [checkerPath, validRoot], { encoding: 'utf8' });
  const invalid = spawnSync(process.execPath, [checkerPath, invalidRoot], { encoding: 'utf8' });

  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Context contract passed: AGENTS/);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /docs\/ai\/checkpoints\/current\.md: missing-file/);
});
