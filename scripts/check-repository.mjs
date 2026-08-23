import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CREDENTIAL_FILENAMES = new Set([
  '.clasp.json',
  '.clasprc.json',
  '.env',
  'service-account.json',
]);

const SECRET_PATTERNS = Object.freeze([
  {
    rule: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    rule: 'google-api-key',
    pattern: /AIza[0-9A-Za-z_-]{35}/,
  },
  {
    rule: 'github-token',
    pattern: /gh(?:p|o|u|s|r)_[0-9A-Za-z]{36,}/,
  },
  {
    rule: 'slack-token',
    pattern: /xox(?:a|b|p|r|s)-[0-9A-Za-z-]{10,}/,
  },
  {
    rule: 'google-resource-url',
    pattern:
      /https:\/\/(?:docs|drive)\.google\.com\/(?:[^\s"']*\/)?d\/[0-9A-Za-z_-]{20,}/,
  },
]);

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.toml',
  '.txt',
  '.yaml',
  '.yml',
]);

const EXCLUDED_DIRECTORIES = new Set(['.git', 'coverage', 'node_modules']);

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/');
}

export function findGuardrailViolations(files) {
  const violations = [];

  for (const file of files) {
    const normalizedPath = normalizePath(file.path);
    const filename = path.posix.basename(normalizedPath).toLowerCase();

    if (CREDENTIAL_FILENAMES.has(filename) || filename.startsWith('.env.')) {
      violations.push({ path: normalizedPath, rule: 'credential-file' });
      continue;
    }

    for (const secretPattern of SECRET_PATTERNS) {
      if (secretPattern.pattern.test(file.content)) {
        violations.push({ path: normalizedPath, rule: secretPattern.rule });
      }
    }
  }

  return violations;
}

async function listWorkingTreeFiles(projectRoot) {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: projectRoot, encoding: 'utf8' },
  );

  if (result.status === 0) {
    return result.stdout.split('\0').filter(Boolean);
  }

  const files = [];

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push(path.relative(projectRoot, absolutePath));
      }
    }
  }

  await walk(projectRoot);
  return files;
}

function isTextFile(filePath) {
  const filename = path.basename(filePath).toLowerCase();
  return CREDENTIAL_FILENAMES.has(filename) || TEXT_EXTENSIONS.has(path.extname(filename));
}

export async function collectRepositoryFiles(projectRoot = process.cwd()) {
  const paths = await listWorkingTreeFiles(projectRoot);
  const files = [];

  for (const relativePath of paths.filter(isTextFile)) {
    files.push({
      path: normalizePath(relativePath),
      content: await readFile(path.join(projectRoot, relativePath), 'utf8'),
    });
  }

  return files;
}

async function main() {
  const files = await collectRepositoryFiles();
  const violations = findGuardrailViolations(files);

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.path}: blocked by ${violation.rule}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Repository guardrails passed (${files.length} text files scanned).`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
