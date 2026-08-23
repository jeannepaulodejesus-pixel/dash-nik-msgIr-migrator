import { constants as fsConstants } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function buildClaspConfig(scriptId) {
  const normalizedScriptId = typeof scriptId === 'string' ? scriptId.trim() : '';

  if (!normalizedScriptId) {
    throw new Error('CXP_CLASP_SCRIPT_ID is required.');
  }

  return {
    scriptId: normalizedScriptId,
    rootDir: 'src',
  };
}

export async function writeClaspConfig({ scriptId, projectRoot = process.cwd() }) {
  const target = path.join(projectRoot, '.clasp.json');
  const content = `${JSON.stringify(buildClaspConfig(scriptId), null, 2)}\n`;

  try {
    await writeFile(target, content, {
      encoding: 'utf8',
      flag: fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      mode: 0o600,
    });
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw new Error('Refusing to overwrite existing .clasp.json.', { cause: error });
    }
    throw error;
  }

  return target;
}

async function main() {
  const target = await writeClaspConfig({
    scriptId: process.env.CXP_CLASP_SCRIPT_ID,
  });
  console.log(`Created ${path.relative(process.cwd(), target)} for a local clasp target.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
