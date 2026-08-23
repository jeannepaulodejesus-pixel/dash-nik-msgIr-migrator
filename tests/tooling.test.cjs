const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

async function importIfPresent(relativePath) {
  try {
    return await import(pathToFileURL(path.resolve(__dirname, relativePath)).href);
  } catch (error) {
    if (error && error.code === 'ERR_MODULE_NOT_FOUND') {
      return undefined;
    }
    throw error;
  }
}

test('builds a clasp target for src and rejects blank script IDs', async () => {
  const tooling = await importIfPresent('../scripts/configure-clasp.mjs');
  assert.equal(
    typeof tooling?.buildClaspConfig,
    'function',
    'buildClaspConfig must be implemented',
  );

  assert.deepEqual(tooling.buildClaspConfig('dev-script-id'), {
    scriptId: 'dev-script-id',
    rootDir: 'src',
  });
  assert.throws(() => tooling.buildClaspConfig('  '), /CXP_CLASP_SCRIPT_ID is required/);
});

test('writes local clasp configuration once and refuses to overwrite it', async (t) => {
  const tooling = await importIfPresent('../scripts/configure-clasp.mjs');
  assert.equal(
    typeof tooling?.writeClaspConfig,
    'function',
    'writeClaspConfig must be implemented',
  );

  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cxp-clasp-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const target = await tooling.writeClaspConfig({
    projectRoot,
    scriptId: 'dev-script-id',
  });

  assert.equal(target, path.join(projectRoot, '.clasp.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), {
    scriptId: 'dev-script-id',
    rootDir: 'src',
  });
  await assert.rejects(
    tooling.writeClaspConfig({ projectRoot, scriptId: 'different-dev-id' }),
    /Refusing to overwrite existing .clasp.json/,
  );
});

test('flags tracked credential files and representative secret material', async () => {
  const guardrails = await importIfPresent('../scripts/check-repository.mjs');
  assert.equal(
    typeof guardrails?.findGuardrailViolations,
    'function',
    'findGuardrailViolations must be implemented',
  );

  const violations = guardrails.findGuardrailViolations([
    { path: '.clasp.json', content: '{"scriptId":"real-script-id"}' },
    { path: 'src/config/key.js', content: `var key = "${'AIza' + '1'.repeat(35)}";` },
    {
      path: 'src/config/private.js',
      content: ['-----BEGIN', 'PRIVATE KEY-----'].join(' '),
    },
  ]);

  assert.deepEqual(
    violations.map((violation) => violation.rule),
    ['credential-file', 'google-api-key', 'private-key'],
  );
});

test('allows configuration key names and documented placeholders without values', async () => {
  const guardrails = await importIfPresent('../scripts/check-repository.mjs');
  assert.equal(
    typeof guardrails?.findGuardrailViolations,
    'function',
    'findGuardrailViolations must be implemented',
  );

  const violations = guardrails.findGuardrailViolations([
    {
      path: 'docs/configuration.md',
      content: [
        'CXP_CLASP_SCRIPT_ID=<non-production-script-id>',
        'CXP_PROD_TARGET_SPREADSHEET_ID is set in PropertiesService.',
      ].join('\n'),
    },
    {
      path: 'src/config/Config.js',
      content: "var keyName = 'CXP_PROD_DRIVE_INBOX_FOLDER_ID';",
    },
  ]);

  assert.deepEqual(violations, []);
});
