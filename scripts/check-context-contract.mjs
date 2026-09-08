import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTEXT_LIMITS = Object.freeze({
  agentsBytes: 4096,
  bootstrapAndIndexBytes: 8192,
  checkpointBytes: 6144,
  fullReadTargetBytes: 32768,
});

export const CONTEXT_PATHS = Object.freeze({
  agents: 'AGENTS.md',
  bootstrap: 'docs/ai/bootstrap.md',
  index: 'docs/ai/context-index.md',
  checkpoint: 'docs/ai/checkpoints/current.md',
});

export const REQUIRED_CHECKPOINT_HEADINGS = Object.freeze([
  'Goal',
  'Scope and non-goals',
  'Authorization',
  'Plan state',
  'Source-anchored decisions',
  'Evidence and tests',
  'Dirty inventory and fingerprint',
  'Blockers and risks',
  'Next safe action',
]);

export const REQUIRED_CHECKPOINT_FIELDS = Object.freeze(['Updated UTC', 'HEAD']);

const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.next',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'outputs',
  'vendor',
]);

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/');
}

function byteLength(content) {
  return Buffer.byteLength(content, 'utf8');
}

function violation(filePath, rule, detail) {
  return { path: normalizePath(filePath), rule, ...(detail ? { detail } : {}) };
}

export function normalizeMarkdownHeading(value) {
  return headingAnchor(value);
}

function headingAnchor(value) {
  // JavaScript does not support character-class intersection consistently.
  return value
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

function markdownHeadings(content) {
  const headings = new Set();
  let inFence = false;

  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) headings.add(headingAnchor(match[1]));
  }

  return headings;
}

export function validateContextBudgets(files, limits = CONTEXT_LIMITS) {
  const sizes = {
    agentsBytes: files.agents == null ? null : byteLength(files.agents),
    bootstrapBytes: files.bootstrap == null ? null : byteLength(files.bootstrap),
    indexBytes: files.index == null ? null : byteLength(files.index),
    checkpointBytes: files.checkpoint == null ? null : byteLength(files.checkpoint),
  };
  sizes.bootstrapAndIndexBytes =
    sizes.bootstrapBytes == null || sizes.indexBytes == null
      ? null
      : sizes.bootstrapBytes + sizes.indexBytes;

  const violations = [];
  if (sizes.agentsBytes != null && sizes.agentsBytes > limits.agentsBytes) {
    violations.push(violation(CONTEXT_PATHS.agents, 'agents-budget', `${sizes.agentsBytes} > ${limits.agentsBytes} bytes`));
  }
  if (
    sizes.bootstrapAndIndexBytes != null &&
    sizes.bootstrapAndIndexBytes > limits.bootstrapAndIndexBytes
  ) {
    violations.push(
      violation(
        `${CONTEXT_PATHS.bootstrap} + ${CONTEXT_PATHS.index}`,
        'bootstrap-index-budget',
        `${sizes.bootstrapAndIndexBytes} > ${limits.bootstrapAndIndexBytes} bytes`,
      ),
    );
  }
  if (sizes.checkpointBytes != null && sizes.checkpointBytes > limits.checkpointBytes) {
    violations.push(
      violation(
        CONTEXT_PATHS.checkpoint,
        'checkpoint-budget',
        `${sizes.checkpointBytes} > ${limits.checkpointBytes} bytes`,
      ),
    );
  }

  return { sizes, violations };
}

export function validateCheckpoint(content, checkpointPath = CONTEXT_PATHS.checkpoint) {
  if (content == null) return [violation(checkpointPath, 'missing-file')];

  const violations = [];
  const levelTwoHeadings = new Set(
    [...content.matchAll(/^##\s+(.+?)\s*#*\s*$/gm)].map((match) => match[1].trim()),
  );

  for (const heading of REQUIRED_CHECKPOINT_HEADINGS) {
    if (!levelTwoHeadings.has(heading)) {
      violations.push(violation(checkpointPath, 'missing-checkpoint-heading', heading));
    }
  }

  for (const field of REQUIRED_CHECKPOINT_FIELDS) {
    const fieldPattern = new RegExp(
      `^(?:\\*\\*)?${escapeRegExp(field)}:(?:\\*\\*)?\\s*\\S.*$`,
      'm',
    );
    if (!fieldPattern.test(content)) {
      violations.push(violation(checkpointPath, 'missing-checkpoint-field', field));
    }
  }

  const dirtyState = extractSection(content, 'Dirty inventory and fingerprint');
  if (dirtyState && !/\bfingerprint\b/i.test(dirtyState)) {
    violations.push(violation(checkpointPath, 'missing-checkpoint-field', 'dirty fingerprint'));
  }
  if (dirtyState && !/\buser-owned (?:paths|changes)\b/i.test(dirtyState)) {
    violations.push(violation(checkpointPath, 'missing-checkpoint-field', 'user-owned paths'));
  }

  return violations;
}

function extractSection(content, heading) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return '';
  const endOffset = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
  return lines.slice(start + 1, end).join('\n');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function localMarkdownLinks(content) {
  return [...content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().replace(/^<|>$/g, ''))
    .filter((target) => target && !/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target));
}

function indexTableLinks(content) {
  const links = [];
  let inFence = false;

  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line.trimStart().startsWith('|')) continue;
    for (const target of localMarkdownLinks(line)) {
      if (target.includes('#')) links.push(target);
    }
  }
  return links;
}

export function validateActiveCheckpointPointer(
  content,
  indexPath = CONTEXT_PATHS.index,
) {
  if (content == null) return [];

  const activeRows = content
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.trimStart().startsWith('|') &&
        /\b(?:active|current|recovery|resumable)\b/i.test(line) &&
        localMarkdownLinks(line).some((target) => /(?:^|\/)checkpoints?\//i.test(target)),
    );
  if (activeRows.length === 0) {
    return [violation(indexPath, 'missing-active-pointer')];
  }

  const hasCurrentPointer = activeRows.some((line) =>
    localMarkdownLinks(line).some(
      (target) => target.split(/[?#]/, 1)[0].replaceAll('\\', '/') === 'checkpoints/current.md',
    ),
  );
  return hasCurrentPointer ? [] : [violation(indexPath, 'stale-active-pointer')];
}

async function pathIsFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function resolveLocalTarget(projectRoot, sourcePath, target) {
  const [encodedFile, encodedAnchor = ''] = target.split('#', 2);
  let decodedFile;
  let decodedAnchor;
  try {
    decodedFile = decodeURIComponent(encodedFile.split('?')[0]);
    decodedAnchor = decodeURIComponent(encodedAnchor);
  } catch {
    return undefined;
  }

  const absolutePath = path.resolve(projectRoot, path.dirname(sourcePath), decodedFile);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return undefined;
  return { absolutePath, relativePath: normalizePath(relativePath), anchor: decodedAnchor };
}

export async function validateMarkdownLinks({ projectRoot, contextFiles }) {
  const violations = [];
  const checkedTargets = new Map();

  for (const [key, sourcePath] of Object.entries(CONTEXT_PATHS)) {
    const content = contextFiles[key];
    if (content == null) continue;

    for (const target of localMarkdownLinks(content)) {
      const resolved = resolveLocalTarget(projectRoot, sourcePath, target);
      if (!resolved || !(await pathIsFile(resolved.absolutePath))) {
        violations.push(violation(sourcePath, 'broken-local-link', target));
      }
    }
  }

  const indexContent = contextFiles.index;
  if (indexContent != null) {
    for (const target of indexTableLinks(indexContent)) {
      const resolved = resolveLocalTarget(projectRoot, CONTEXT_PATHS.index, target);
      if (!resolved || !(await pathIsFile(resolved.absolutePath))) continue;

      const cacheKey = resolved.absolutePath;
      let headings = checkedTargets.get(cacheKey);
      if (!headings) {
        headings = markdownHeadings(await readFile(resolved.absolutePath, 'utf8'));
        checkedTargets.set(cacheKey, headings);
      }
      if (!headings.has(headingAnchor(resolved.anchor))) {
        violations.push(violation(CONTEXT_PATHS.index, 'broken-index-heading', target));
      }
    }
  }

  return violations;
}

async function listMarkdownFiles(projectRoot) {
  const files = [];

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolutePath);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') files.push(absolutePath);
    }
  }

  await walk(projectRoot);
  return files.sort();
}

function instructionalLines(content) {
  const lines = [];
  let inFence = false;
  let inComment = false;

  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine;
    if (line.includes('<!--')) inComment = true;
    if (!inComment && /^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    if (inFence || /^\s*>/.test(line)) continue;
    line = line.replace(/^\s*(?:[-*+] |\d+[.)] )/, '').trim();
    if (line) lines.push(line);
  }
  return lines;
}

function isFullReadInstruction(line) {
  if (/^(?:["“']|historically\b|previously\b|formerly\b|example\b)/i.test(line)) return false;
  return (
    /\b(?:must|required to|always|shall|need to)\s+read\b.*\b(?:completely|fully|in full|entirely|from (?:start|beginning) to (?:finish|end))\b/i.test(line) ||
    /\bread\s+(?:the\s+)?(?:full|entire|whole)\s+(?:contents?\s+of\s+)?/i.test(line) ||
    /\bread\s+all\s+of\s+/i.test(line) ||
    /\b(?:whole|entire|full) file\b/i.test(line)
  );
}

function referencedPaths(line) {
  const references = new Set(localMarkdownLinks(line));
  for (const match of line.matchAll(/`([^`]+\.[A-Za-z0-9]+(?:#[^`]*)?)`/g)) references.add(match[1]);
  for (const match of line.matchAll(/(?:^|\s)((?:\.\.?\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_. -]+)+\.[A-Za-z0-9]+)(?=[\s,.;:)]|$)/g)) {
    references.add(match[1]);
  }
  return [...references];
}

export async function validateFullReadInstructions({ projectRoot, limit = CONTEXT_LIMITS.fullReadTargetBytes }) {
  const violations = [];
  for (const sourceAbsolutePath of await listMarkdownFiles(projectRoot)) {
    const sourcePath = normalizePath(path.relative(projectRoot, sourceAbsolutePath));
    const content = await readFile(sourceAbsolutePath, 'utf8');
    for (const line of instructionalLines(content)) {
      if (!isFullReadInstruction(line)) continue;
      for (const target of referencedPaths(line)) {
        const resolved = resolveLocalTarget(projectRoot, sourcePath, target);
        if (!resolved || !(await pathIsFile(resolved.absolutePath))) continue;
        const targetSize = (await stat(resolved.absolutePath)).size;
        if (targetSize > limit) {
          violations.push(
            violation(sourcePath, 'oversized-full-read-target', `${target} is ${targetSize} > ${limit} bytes`),
          );
        }
      }
    }
  }
  return violations;
}

async function readContextFiles(projectRoot) {
  const files = {};
  const violations = [];
  for (const [key, relativePath] of Object.entries(CONTEXT_PATHS)) {
    try {
      files[key] = await readFile(path.join(projectRoot, relativePath), 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      files[key] = undefined;
      violations.push(violation(relativePath, 'missing-file'));
    }
  }
  return { files, violations };
}

export async function validateContextContract({ projectRoot = process.cwd() } = {}) {
  const resolvedRoot = path.resolve(projectRoot);
  const { files, violations: fileViolations } = await readContextFiles(resolvedRoot);
  const budgetResult = validateContextBudgets(files);
  const violations = [
    ...fileViolations,
    ...budgetResult.violations,
    ...validateCheckpoint(files.checkpoint).filter(
      (item) => !(item.rule === 'missing-file' && fileViolations.some((existing) => existing.path === item.path)),
    ),
    ...validateActiveCheckpointPointer(files.index),
    ...(await validateMarkdownLinks({ projectRoot: resolvedRoot, contextFiles: files })),
    ...(await validateFullReadInstructions({ projectRoot: resolvedRoot })),
  ];

  return { projectRoot: resolvedRoot, sizes: budgetResult.sizes, violations };
}

export function formatMeasurements(sizes) {
  const measured = (value, limit) => `${value ?? 'missing'}/${limit}`;
  return [
    `AGENTS ${measured(sizes.agentsBytes, CONTEXT_LIMITS.agentsBytes)} bytes`,
    `bootstrap+index ${measured(sizes.bootstrapAndIndexBytes, CONTEXT_LIMITS.bootstrapAndIndexBytes)} bytes`,
    `checkpoint ${measured(sizes.checkpointBytes, CONTEXT_LIMITS.checkpointBytes)} bytes`,
  ].join('; ');
}

async function main() {
  const result = await validateContextContract({ projectRoot: process.argv[2] || process.cwd() });
  if (result.violations.length > 0) {
    for (const item of result.violations) {
      console.error(`${item.path}: ${item.rule}${item.detail ? ` (${item.detail})` : ''}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Context contract passed: ${formatMeasurements(result.sizes)}.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
