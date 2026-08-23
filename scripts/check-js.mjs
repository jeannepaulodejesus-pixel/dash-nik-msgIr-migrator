import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const EXCLUDED_DIRECTORIES = new Set(['.git', 'coverage', 'node_modules']);
const JAVASCRIPT_EXTENSIONS = new Set(['.cjs', '.js', '.mjs']);

async function listJavaScriptFiles(projectRoot) {
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
      } else if (entry.isFile() && JAVASCRIPT_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(absolutePath);
      }
    }
  }

  await walk(projectRoot);
  return files.sort();
}

const projectRoot = process.cwd();
const files = await listJavaScriptFiles(projectRoot);
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    failed = true;
    console.error(result.stderr || result.stdout);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`JavaScript syntax check passed (${files.length} files).`);
}
