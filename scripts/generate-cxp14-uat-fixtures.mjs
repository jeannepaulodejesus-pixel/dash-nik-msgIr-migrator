/**
 * Generate CXP-14 hosted-UAT source bundles and the matching operator-style
 * parity export. Synthetic, non-personal values only. Large binaries stay in
 * outputs/; provenance records hashes and counts, never source rows.
 */
import crypto from 'node:crypto';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SchemaRegistry = require('../src/ingestion/SchemaRegistry.js');
const Cxp11ParityUat = require('../src/main/Cxp11UatEntrypoints.js');
const Cxp14ReleaseEvidence = require('../src/release/Cxp14ReleaseEvidence.js');
const InboxBundleRepository = require('../src/repository/InboxBundleRepository.js');
const ReportingSurfaceReferenceModel = require(
  '../src/transformations/ReportingSurfaceReferenceModel.js',
);

const HTML_PREFIX = '<head><META charset="ISO-8859-1"></head><table>';
const HTML_SUFFIX = '</table>';
const BASE_UTC = Date.UTC(2026, 8, 8, 12, 0, 0);
const INTERVAL_COUNT = 38;
const DATASET_FILES = InboxBundleRepository.DATASETS;
const WORKLOAD_PROFILES = Cxp14ReleaseEvidence.WORKLOAD_PROFILES;
const UNIT_SCALE_COUNTS = Object.freeze({
  EXPECTED_PEAK: Object.freeze({
    aht: 4, auxes: 2, handled: 3, offered: 3, staff: 1,
  }),
  DECLARED_MAXIMUM: Object.freeze({
    aht: 6, auxes: 3, handled: 5, offered: 5, staff: 2,
  }),
  PARITY: Object.freeze({
    aht: 5, auxes: 3, handled: 4, offered: 4, staff: 2,
  }),
  NEGATIVE: Object.freeze({
    aht: 2, auxes: 2, handled: 2, offered: 2, staff: 2,
  }),
});

const SITE_CYCLES = Object.freeze({
  las: Object.freeze(['LAS', 'LAS', 'LAS', 'PH']),
  mixed: Object.freeze(['PH', 'LAS', 'INT-LAS']),
  ph: Object.freeze(['PH', 'PH', 'PH', 'LAS']),
});

function pad(value, width) {
  return String(value).padStart(width, '0');
}

function formatUtcToken(ms) {
  const date = new Date(ms);
  return date.toISOString().replace(/[-:]/g, '').replace('.000', '');
}

function formatSourceDate(ms) {
  const date = new Date(ms);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
}

function formatSourceDateTime(ms) {
  const date = new Date(ms);
  let hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const meridiem = hour >= 12 ? 'PM' : 'AM';
  hour %= 12;
  if (hour === 0) hour = 12;
  return `${formatSourceDate(ms)} ${hour}:${pad(minute, 2)} ${meridiem}`;
}

function intervalUtc(index, hourOffset) {
  return BASE_UTC + hourOffset * 3600000 + (index % INTERVAL_COUNT) * 30 * 60000;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeXml(value) {
  return escapeHtml(value).replace(/'/g, '&apos;');
}

function columnLetter(index) {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function sha256Prefix(bufferOrText, encoding) {
  const hash = crypto.createHash('sha256');
  if (encoding) hash.update(bufferOrText, encoding);
  else hash.update(bufferOrText);
  return `sha256:${hash.digest('hex')}`;
}

export function contentFingerprint(bytes) {
  return sha256Prefix(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
}

export function bundleFingerprint(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('bundleFingerprint requires at least one source');
  }
  if (sources.length === 1) return sources[0].contentFingerprint;
  const parts = sources.map((source) => {
    if (!source.datasetName || !source.contentFingerprint) {
      throw new Error('bundleFingerprint sources need datasetName and contentFingerprint');
    }
    return `${source.datasetName}\u0000${source.contentFingerprint}`;
  }).sort();
  return sha256Prefix(parts.join('\n'), 'utf8');
}

function countsFor(profileName, scale) {
  if (scale === 'unit') {
    return { ...UNIT_SCALE_COUNTS[profileName] };
  }
  if (profileName === 'PARITY') {
    return {
      aht: 70, auxes: 30, handled: 50, offered: 50, staff: 10,
    };
  }
  if (profileName === 'NEGATIVE') {
    return { ...UNIT_SCALE_COUNTS.NEGATIVE };
  }
  const profile = WORKLOAD_PROFILES[profileName];
  return {
    aht: profile.aht,
    auxes: profile.auxes,
    handled: profile.handled,
    offered: profile.offered,
    staff: profile.staff,
  };
}

function totalRows(counts) {
  return counts.handled + counts.offered + counts.aht + counts.auxes + counts.staff;
}

function countForSchema(schemaName, counts) {
  if (schemaName === 'Handled') return counts.handled;
  if (schemaName === 'Offered') return counts.offered;
  if (schemaName === 'AHT - Raw') return counts.aht;
  if (schemaName === 'Auxes - Raw') return counts.auxes;
  return counts.staff;
}

function buildCell(column, index, options) {
  const seed = options.seed || 'SYN';
  const site = SITE_CYCLES[options.siteBias || 'mixed'][index % SITE_CYCLES[options.siteBias || 'mixed'].length];
  const hourOffset = options.hourOffset || 0;
  const stamp = intervalUtc(index, hourOffset);
  const key = `${seed}-${pad(index + 1, 5)}`;
  if (options.overrides && Object.prototype.hasOwnProperty.call(options.overrides, column.name)) {
    return options.overrides[column.name];
  }
  if (column.type === 'date_time') {
    if (column.name === 'Status End Date' || column.name === 'End Time' || column.name === 'Close Date' || column.name === 'Chat Exit Time') {
      return formatSourceDateTime(stamp + 15 * 60000);
    }
    return formatSourceDateTime(stamp);
  }
  if (column.type === 'date') return formatSourceDate(stamp);
  if (column.type === 'number') {
    if (/Capacity|Occupancy|Count|Units/.test(column.name)) return String(1 + (index % 3));
    if (/Duration|Time|Answer|Resolution/.test(column.name)) return String(10 + (index % 50));
    return '1';
  }
  switch (column.name) {
    case 'Case: Case Number':
      return `C-${key}`;
    case 'Messaging Session Name':
    case 'Work Item: Name':
      return `MS-${key}`;
    case 'Agent Work ID':
      return `AW-${key}`;
    case 'User Presence ID':
      return `UP-${key}`;
    case 'Consumer Email':
      return `synthetic.${seed.toLowerCase()}.${pad(index + 1, 5)}@example.invalid`;
    case 'Name':
    case 'Athlete Display Name':
    case 'User: Full Name':
      return `Synthetic Athlete ${seed} ${pad(index + 1, 5)}`;
    case 'Initial Athlete Site':
    case 'Athlete Site':
      return site;
    case 'Initial Queue':
    case 'Queue':
    case 'Queue: Name':
      return site === 'LAS' || site === 'INT-LAS' ? 'CNX Messaging' : 'INT Messaging';
    case 'Initial Athlete BPO':
      return site === 'PH' ? 'INT' : 'CNX';
    case 'Initial Queue LOB':
    case 'Case Business Unit':
    case 'Case: BU':
      return 'Messaging';
    case 'Athlete Profile':
      return 'Messaging';
    case 'Language':
    case 'Case Language':
      return index % 5 === 0 ? 'Spanish' : 'English';
    case 'Country':
      return 'US';
    case 'Status':
      return 'Completed';
    case 'Related Case Resolution':
      return 'Resolved';
    case 'Related Case Purpose':
      return 'Support';
    case 'Messaging Channel: Channel Name':
      return 'Messaging';
    case 'Service Presence Status: Status Name':
      return 'Available';
    case 'Initial Queue Level':
      return 'L1';
    case 'Initial Queue CS Owner':
    case 'Initial Athlete CS Owner':
    case 'Case: Athlete CS Owner':
    case 'Case: Queue CS Owner':
    case 'Athlete CS Owner':
      return 'NA';
    case 'Service Level Met':
      return index % 4 === 0 ? '0' : '1';
    case 'Is Internal':
    case 'Is Transfer':
    case 'Is Away':
    case 'Chat Bot Transferred to Athlete':
      return '0';
    case 'Is My BPO':
      return '1';
    default:
      return `${column.name}-${seed}-${index + 1}`;
  }
}

export function buildRecord(schema, index, options = {}) {
  return schema.columns.map((column) => buildCell(column, index, options));
}

export function recordsToObjects(schema, rows) {
  return rows.map((row) => {
    const record = {};
    schema.requiredHeaders.forEach((header, index) => {
      record[header] = row[index];
    });
    return record;
  });
}

function htmlRow(tag, cells) {
  return `<tr>${cells.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join('')}</tr>`;
}

export function renderHtmlTable(headers, rows) {
  return `${HTML_PREFIX}${htmlRow('th', headers)}${rows.map((row) => htmlRow('td', row)).join('')}${HTML_SUFFIX}`;
}

async function writeLatin1File(filePath, writer) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const hash = crypto.createHash('sha256');
  const stream = fs.createWriteStream(filePath);
  async function write(text) {
    const buf = Buffer.from(text, 'latin1');
    hash.update(buf);
    if (!stream.write(buf) && stream.writableNeedDrain) {
      await once(stream, 'drain');
    }
  }
  await writer(write);
  await new Promise((resolve, reject) => {
    stream.end((error) => (error ? reject(error) : resolve()));
  });
  const stat = await fs.promises.stat(filePath);
  return {
    fingerprint: `sha256:${hash.digest('hex')}`,
    sizeBytes: stat.size,
  };
}

async function writeHtmlDataset(filePath, schema, rowCount, options) {
  return writeLatin1File(filePath, async (write) => {
    await write(HTML_PREFIX);
    await write(htmlRow('th', schema.requiredHeaders));
    for (let index = 0; index < rowCount; index += 1) {
      await write(htmlRow('td', buildRecord(schema, index, options)));
    }
    await write(HTML_SUFFIX);
  });
}

function crc32(buffer) {
  let crc = ~0;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (~crc) >>> 0;
}

function u16(value) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value);
  return buf;
}

function u32(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value);
  return buf;
}

function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  entries.forEach((entry) => {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data);
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
      name, data,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  });
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralDir.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...locals, centralDir, eocd]);
}

function sheetXml(headers, rows, formulaCell) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
  ];
  function emitRow(r, cells, formulas = {}) {
    const parts = [`<row r="${r}">`];
    cells.forEach((value, index) => {
      const ref = `${columnLetter(index)}${r}`;
      if (formulas[ref]) {
        parts.push(`<c r="${ref}"><f>${escapeXml(formulas[ref])}</f><v>2</v></c>`);
        return;
      }
      parts.push(`<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`);
    });
    parts.push('</row>');
    lines.push(parts.join(''));
  }
  emitRow(1, headers);
  rows.forEach((row, index) => emitRow(index + 2, row, formulaCell && index === 0 ? formulaCell : {}));
  lines.push('</sheetData></worksheet>');
  return lines.join('');
}

export function buildXlsxWorkbook(sheetTables, options = {}) {
  const sheets = SchemaRegistry.listSchemas().map((schema, index) => {
    const table = sheetTables[schema.name] || [
      schema.requiredHeaders.slice(),
      buildRecord(schema, 0, { seed: 'XLSX' }),
    ];
    const formulaCell = options.formulaSheet === schema.name ? { A2: '1+1' } : undefined;
    return {
      name: schema.name,
      path: `xl/worksheets/sheet${index + 1}.xml`,
      xml: sheetXml(table[0], table.slice(1), formulaCell),
    };
  });
  const workbook = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>',
    ...sheets.map((sheet, index) =>
      `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`),
    '</sheets></workbook>',
  ].join('');
  const workbookRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...sheets.map((sheet, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`),
    '</Relationships>',
  ].join('');
  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    ...sheets.map((sheet) =>
      `<Override PartName="/${sheet.path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`),
    '</Types>',
  ].join('');
  const rootRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    '</Relationships>',
  ].join('');
  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    ...sheets.map((sheet) => ({ name: sheet.path, data: sheet.xml })),
  ]);
}

async function writeFiveFileBundle(directory, token, counts, options) {
  await fs.promises.mkdir(directory, { recursive: true });
  const sources = [];
  const files = [];
  for (const entry of DATASET_FILES) {
    const schema = SchemaRegistry.getSchema(entry.datasetName);
    const fileName = `${token}__${entry.slug}.xls`;
    const filePath = path.join(directory, fileName);
    const written = await writeHtmlDataset(
      filePath,
      schema,
      countForSchema(entry.datasetName, counts),
      options,
    );
    sources.push({
      contentFingerprint: written.fingerprint,
      datasetName: entry.datasetName,
    });
    files.push({
      datasetName: entry.datasetName,
      fileName,
      sizeBytes: written.sizeBytes,
      sha256: written.fingerprint,
    });
  }
  return {
    files,
    fingerprint: bundleFingerprint(sources),
    packagingKind: 'single_dataset',
    sources,
    token,
  };
}

function headerPermutation(headers) {
  return headers.slice(1).concat(headers.slice(0, 1));
}

async function writeMutatedHandledBundle(directory, token, counts, options, mutateHeaders, mutateRows) {
  await fs.promises.mkdir(directory, { recursive: true });
  const sources = [];
  const files = [];
  for (const entry of DATASET_FILES) {
    const schema = SchemaRegistry.getSchema(entry.datasetName);
    const fileName = `${token}__${entry.slug}.xls`;
    const filePath = path.join(directory, fileName);
    const rowCount = countForSchema(entry.datasetName, counts);
    let headers = schema.requiredHeaders.slice();
    const rows = [];
    for (let index = 0; index < rowCount; index += 1) {
      rows.push(buildRecord(schema, index, options));
    }
    if (entry.datasetName === 'Handled') {
      if (mutateRows) mutateRows(rows, headers);
      if (mutateHeaders) headers = mutateHeaders(headers);
    }
    const body = renderHtmlTable(headers, rows);
    const written = await writeLatin1File(filePath, async (write) => {
      await write(body);
    });
    sources.push({
      contentFingerprint: written.fingerprint,
      datasetName: entry.datasetName,
    });
    files.push({
      datasetName: entry.datasetName,
      fileName,
      sizeBytes: written.sizeBytes,
      sha256: written.fingerprint,
    });
  }
  return {
    files,
    fingerprint: bundleFingerprint(sources),
    packagingKind: 'single_dataset',
    token,
  };
}

async function copyDirectory(sourceDir, targetDir) {
  await fs.promises.mkdir(targetDir, { recursive: true });
  const names = await fs.promises.readdir(sourceDir);
  for (const name of names) {
    await fs.promises.copyFile(path.join(sourceDir, name), path.join(targetDir, name));
  }
}

function wb0817Errors() {
  return Cxp11ParityUat.FIXTURE.legacyErrors.slice();
}

function operatorMetrics(counts, businessDate) {
  const offered = counts.offered;
  const handled = counts.handled;
  const chatsInSl = Math.max(0, handled - 1);
  const forecast = Math.max(offered, 1);
  const scheduled = 4;
  const required = 4;
  const actualSo = 3;
  const values = {
    Forecast: String(forecast),
    Offered: String(offered),
    Handled: String(handled),
    'Chats in SL': String(chatsInSl),
    Abandoned: String(Math.max(0, offered - handled)),
    'SL % Total': offered ? String(chatsInSl / offered) : '0',
    'SL (Time To Connect)': '45',
    '% of Forecast Offered': String(offered / forecast),
    '% of Forecast Handled': String(handled / forecast),
    Allocation: '0.5',
    'Cumulative Allocation': '0.5',
    'AHT (Session)': '180',
    AHT: '3',
    ACW: '0.5',
    'ASA in Seconds': '40',
    Concurrency: '1.1',
    Scheduled: String(scheduled),
    Required: String(required),
    'Actual (SO)': String(actualSo),
    'Actual vs Required': String(actualSo - required),
    'Scheduled Hours': String((scheduled * 30) / 1440),
    'Required Hours': String((required * 30) / 1440),
    Actual: String((actualSo * 30) / 1440),
    'Actual to Required': String(actualSo / required),
    'Scheduled to Required': String(scheduled / required),
  };
  return ReportingSurfaceReferenceModel.METRIC_ORDER.map((metric) => ({
    aggregationIdentity: 'INTERVAL_VIEW',
    businessDate,
    intervalStart: '04:00',
    metric,
    queueOrLob: 'ALL',
    site: 'ALL',
    value: values[metric],
  }));
}

async function writeParityExport(exportDir, sourceBundle, sourceRecords, counts) {
  await fs.promises.mkdir(exportDir, { recursive: true });
  const built = Cxp11ParityUat.buildBundleFiles({
    acquisitionTimestampUtc: '2026-09-08T22:00:00Z',
    datasets: sourceRecords,
    legacyErrors: wb0817Errors(),
    legacyMetrics: operatorMetrics(counts, '2026-09-08'),
    sourceBundleFingerprint: sourceBundle.fingerprint,
  });
  await fs.promises.writeFile(path.join(exportDir, 'manifest.json'), built.manifestText);
  for (const [fileName, text] of Object.entries(built.files)) {
    await fs.promises.writeFile(path.join(exportDir, fileName), text);
  }
  const manifest = JSON.parse(built.manifestText);
  return {
    fileCount: 1 + Object.keys(built.files).length,
    files: manifest.files,
    fingerprint: sourceBundle.fingerprint,
    metricCount: ReportingSurfaceReferenceModel.METRIC_ORDER.length,
  };
}

function catalogEntry(input) {
  return {
    expectedOutcome: input.expectedOutcome,
    fingerprint: input.bundle.fingerprint,
    id: input.id,
    packagingKind: input.bundle.packagingKind,
    profile: input.profile,
    purpose: input.purpose,
    relativeDir: input.relativeDir,
    rowCounts: input.rowCounts,
    token: input.bundle.token,
    totalRows: input.rowCounts ? totalRows(input.rowCounts) : null,
  };
}

function operatorGuide(outputDir) {
  return [
    '# CXP-14 UAT fixture drop order',
    '',
    'Synthetic, non-personal HTML-table `.xls` five-file bundles for the CXP-13 Inbox.',
    'Drop **one subdirectory at a time**. The newest UTC token in the Inbox is authoritative.',
    '',
    '1. `expected-peak-01`, then `02`, then `03` after each prior run reaches `SUCCESS`.',
    '2. `declared-maximum` after the three expected-peak runs.',
    '3. Each folder under `negatives/` independently, restoring last-known-good between cases.',
    '4. Ingest `parity/source`, copy its provenance fingerprint into FILE_LEDGER comparison,',
    '   then place the eight files from `parity/export` in `CXP_UAT_LEGACY_PARITY_EXPORT_FOLDER_ID`.',
    '',
    'The parity export is an operator-recalculated **contract package** built from the same',
    'synthetic source bytes. It is not a production weekly Excel dump and contains no personal',
    'rows. A hosted real weekly run must ingest the approved real bundle first, then copy that',
    'successful FILE_LEDGER fingerprint into `manifest.sourceBundleFingerprint`. Never use the',
    'CXP-11 placeholder `sha256:cxp11syntheticbundle…` on a real export.',
    '',
    `Local output: ${outputDir}`,
  ].join('\n');
}

export async function generateCxp14UatFixtures(options = {}) {
  const scale = options.scale === 'unit' ? 'unit' : 'full';
  const outputDir = path.resolve(options.outputDir);
  await fs.promises.mkdir(outputDir, { recursive: true });
  const peakCounts = countsFor('EXPECTED_PEAK', scale);
  const maxCounts = countsFor('DECLARED_MAXIMUM', scale);
  const parityCounts = countsFor('PARITY', scale);
  const negativeCounts = countsFor('NEGATIVE', scale);
  const catalog = [];

  const peakSpecs = [
    { hourOffset: 0, id: 'expected-peak-01', seed: 'P1', siteBias: 'ph', token: '20260908T120000Z' },
    { hourOffset: 1, id: 'expected-peak-02', seed: 'P2', siteBias: 'las', token: '20260908T130000Z' },
    { hourOffset: 2, id: 'expected-peak-03', seed: 'P3', siteBias: 'mixed', token: '20260908T140000Z' },
  ];
  const peakBundles = [];
  for (const spec of peakSpecs) {
    const relativeDir = spec.id;
    const bundle = await writeFiveFileBundle(
      path.join(outputDir, relativeDir),
      spec.token,
      peakCounts,
      spec,
    );
    peakBundles.push(bundle);
    catalog.push(catalogEntry({
      bundle,
      expectedOutcome: 'SUCCESS',
      id: spec.id,
      profile: 'EXPECTED_PEAK',
      purpose: 'Independent expected-peak ingestion (cold/warm/repeat).',
      relativeDir,
      rowCounts: peakCounts,
    }));
  }

  const maxBundle = await writeFiveFileBundle(
    path.join(outputDir, 'declared-maximum'),
    '20260908T150000Z',
    maxCounts,
    { hourOffset: 3, seed: 'MAX', siteBias: 'mixed' },
  );
  catalog.push(catalogEntry({
    bundle: maxBundle,
    expectedOutcome: 'SUCCESS',
    id: 'declared-maximum',
    profile: 'DECLARED_MAXIMUM',
    purpose: 'Schema-envelope stress ingestion.',
    relativeDir: 'declared-maximum',
    rowCounts: maxCounts,
  }));

  const duplicateSameDir = path.join(outputDir, 'negatives', 'duplicate-same-name');
  await copyDirectory(path.join(outputDir, 'expected-peak-01'), duplicateSameDir);
  catalog.push(catalogEntry({
    bundle: { ...peakBundles[0], token: peakBundles[0].token },
    expectedOutcome: 'DUPLICATE',
    id: 'duplicate-same-name',
    profile: 'NEGATIVE',
    purpose: 'Resubmit identical bytes and filenames after SUCCESS.',
    relativeDir: 'negatives/duplicate-same-name',
    rowCounts: peakCounts,
  }));

  const duplicateDifferentDir = path.join(outputDir, 'negatives', 'duplicate-different-name');
  await fs.promises.mkdir(duplicateDifferentDir, { recursive: true });
  const renamedToken = '20260908T121500Z';
  for (const entry of DATASET_FILES) {
    const fromName = `${peakBundles[0].token}__${entry.slug}.xls`;
    const toName = `${renamedToken}__${entry.slug}.xls`;
    await fs.promises.copyFile(
      path.join(outputDir, 'expected-peak-01', fromName),
      path.join(duplicateDifferentDir, toName),
    );
  }
  catalog.push(catalogEntry({
    bundle: {
      fingerprint: peakBundles[0].fingerprint,
      packagingKind: 'single_dataset',
      token: renamedToken,
    },
    expectedOutcome: 'DUPLICATE',
    id: 'duplicate-different-name',
    profile: 'NEGATIVE',
    purpose: 'Same original bytes under a different UTC token/filename.',
    relativeDir: 'negatives/duplicate-different-name',
    rowCounts: peakCounts,
  }));

  const negativeSpecs = [
    {
      expectedOutcome: 'VALIDATION_FAILED',
      id: 'missing-header',
      mutateHeaders: (headers) => headers.map((header, index) =>
        index === 0 ? 'Case Number (INVALID HEADER)' : header),
      purpose: 'Required Handled header replaced; schema must fail closed.',
      token: '20260908T170000Z',
    },
    {
      expectedOutcome: 'SUCCESS',
      id: 'reordered-headers',
      mutateHeaders: headerPermutation,
      purpose: 'Valid reordered Handled headers; CXP-03 must normalize and accept.',
      token: '20260908T170100Z',
    },
    {
      expectedOutcome: 'VALIDATION_FAILED',
      id: 'unexpected-header',
      mutateHeaders: (headers) => headers.concat(['Unexpected Critical Column']),
      purpose: 'Unapproved extra Handled header.',
      token: '20260908T170200Z',
    },
    {
      expectedOutcome: 'VALIDATION_FAILED',
      id: 'invalid-date',
      mutateRows: (rows, headers) => {
        const created = headers.indexOf('Created Date');
        rows[0][created] = '13/40/2026';
      },
      purpose: 'Invalid calendar date in Handled Created Date.',
      token: '20260908T170300Z',
    },
    {
      expectedOutcome: 'VALIDATION_FAILED',
      id: 'invalid-interval',
      mutateRows: (rows, headers) => {
        const start = headers.indexOf('Start Time');
        rows[0][start] = '9/8/2026 13:61 PM';
      },
      purpose: 'Unparseable Handled Start Time interval.',
      token: '20260908T170400Z',
    },
    {
      expectedOutcome: 'INGEST_THEN_DOMAIN_REJECT',
      id: 'invalid-site',
      mutateRows: (rows, headers) => {
        const site = headers.indexOf('Initial Athlete Site');
        rows.forEach((row) => {
          row[site] = 'NOT-A-SITE';
        });
      },
      purpose: 'Non-catalog site values for reporting/domain failure coverage.',
      token: '20260908T170500Z',
    },
    {
      expectedOutcome: 'INGEST_THEN_DOMAIN_REJECT',
      id: 'invalid-queue',
      mutateRows: (rows, headers) => {
        const queue = headers.indexOf('Initial Queue');
        rows.forEach((row) => {
          row[queue] = 'NOT-A-QUEUE';
        });
      },
      purpose: 'Non-catalog queue values for reporting/domain failure coverage.',
      token: '20260908T170600Z',
    },
    {
      expectedOutcome: 'VALIDATION_FAILED',
      id: 'duplicate-key',
      mutateRows: (rows, headers) => {
        const session = headers.indexOf('Messaging Session Name');
        const caseNumber = headers.indexOf('Case: Case Number');
        rows[1][session] = rows[0][session];
        rows[1][caseNumber] = 'C-DIVERGENT-KEY';
      },
      purpose: 'Divergent Handled rows sharing Messaging Session Name.',
      token: '20260908T170700Z',
    },
  ];

  for (const spec of negativeSpecs) {
    const relativeDir = path.join('negatives', spec.id);
    const bundle = await writeMutatedHandledBundle(
      path.join(outputDir, relativeDir),
      spec.token,
      negativeCounts,
      { seed: spec.id.replace(/-/g, '').slice(0, 6).toUpperCase(), siteBias: 'ph' },
      spec.mutateHeaders,
      spec.mutateRows,
    );
    catalog.push(catalogEntry({
      bundle,
      expectedOutcome: spec.expectedOutcome,
      id: spec.id,
      profile: 'NEGATIVE',
      purpose: spec.purpose,
      relativeDir: relativeDir.replaceAll('\\', '/'),
      rowCounts: negativeCounts,
    }));
  }

  const emptyDir = path.join(outputDir, 'negatives', 'empty-dataset');
  await fs.promises.mkdir(emptyDir, { recursive: true });
  const emptySources = [];
  for (const entry of DATASET_FILES) {
    const schema = SchemaRegistry.getSchema(entry.datasetName);
    const fileName = `20260908T170800Z__${entry.slug}.xls`;
    const rows = entry.datasetName === 'Handled' ? [] : [buildRecord(schema, 0, { seed: 'EMPTY' })];
    const body = renderHtmlTable(schema.requiredHeaders, rows);
    const written = await writeLatin1File(path.join(emptyDir, fileName), async (write) => {
      await write(body);
    });
    emptySources.push({
      contentFingerprint: written.fingerprint,
      datasetName: entry.datasetName,
    });
  }
  catalog.push(catalogEntry({
    bundle: {
      fingerprint: bundleFingerprint(emptySources),
      packagingKind: 'single_dataset',
      token: '20260908T170800Z',
    },
    expectedOutcome: 'VALIDATION_FAILED',
    id: 'empty-dataset',
    profile: 'NEGATIVE',
    purpose: 'Handled file has headers and no data rows.',
    relativeDir: 'negatives/empty-dataset',
    rowCounts: { ...negativeCounts, handled: 0 },
  }));

  const missingDir = path.join(outputDir, 'negatives', 'missing-dataset');
  await fs.promises.mkdir(missingDir, { recursive: true });
  for (const entry of DATASET_FILES.filter((item) => item.slug !== 'staff')) {
    const schema = SchemaRegistry.getSchema(entry.datasetName);
    const fileName = `20260908T170900Z__${entry.slug}.xls`;
    const body = renderHtmlTable(
      schema.requiredHeaders,
      [buildRecord(schema, 0, { seed: 'MISS' })],
    );
    await writeLatin1File(path.join(missingDir, fileName), async (write) => {
      await write(body);
    });
  }
  catalog.push({
    expectedOutcome: 'SOURCE_INBOX_BUNDLE_INCOMPLETE',
    fingerprint: null,
    id: 'missing-dataset',
    packagingKind: 'single_dataset',
    profile: 'NEGATIVE',
    purpose: 'Newest token omits Staff so discovery refuses the incomplete group.',
    relativeDir: 'negatives/missing-dataset',
    rowCounts: null,
    token: '20260908T170900Z',
    totalRows: null,
  });

  const incompleteDir = path.join(outputDir, 'negatives', 'incomplete-newest');
  await fs.promises.mkdir(incompleteDir, { recursive: true });
  for (const slug of ['handled', 'offered']) {
    const datasetName = slug === 'handled' ? 'Handled' : 'Offered';
    const schema = SchemaRegistry.getSchema(datasetName);
    const fileName = `20260908T180000Z__${slug}.xls`;
    const body = renderHtmlTable(
      schema.requiredHeaders,
      [buildRecord(schema, 0, { seed: 'NEW' })],
    );
    await writeLatin1File(path.join(incompleteDir, fileName), async (write) => {
      await write(body);
    });
  }
  catalog.push({
    expectedOutcome: 'SOURCE_INBOX_BUNDLE_INCOMPLETE',
    fingerprint: null,
    id: 'incomplete-newest',
    packagingKind: 'single_dataset',
    profile: 'NEGATIVE',
    purpose: 'Newer incomplete token must block older complete Inbox candidates.',
    relativeDir: 'negatives/incomplete-newest',
    rowCounts: null,
    token: '20260908T180000Z',
    totalRows: null,
  });

  const formulaDir = path.join(outputDir, 'negatives', 'formula-xlsx');
  await fs.promises.mkdir(formulaDir, { recursive: true });
  const formulaBytes = buildXlsxWorkbook({}, { formulaSheet: 'Staff' });
  const formulaName = '20260908T171000Z__bundle.xlsx';
  await fs.promises.writeFile(path.join(formulaDir, formulaName), formulaBytes);
  catalog.push(catalogEntry({
    bundle: {
      fingerprint: contentFingerprint(formulaBytes),
      packagingKind: 'multi_sheet_workbook',
      token: '20260908T171000Z',
    },
    expectedOutcome: 'VALIDATION_FAILED',
    id: 'formula-xlsx',
    profile: 'NEGATIVE',
    purpose: 'Complete XLSX bundle with a leading formula cell; XlsxAdapter must reject.',
    relativeDir: 'negatives/formula-xlsx',
    rowCounts: {
      aht: 1, auxes: 1, handled: 1, offered: 1, staff: 1,
    },
  }));

  const mixedDir = path.join(outputDir, 'negatives', 'mixed-packaging');
  await fs.promises.mkdir(mixedDir, { recursive: true });
  const mixedToken = '20260908T171100Z';
  const mixedXlsx = buildXlsxWorkbook({}, {});
  await fs.promises.writeFile(path.join(mixedDir, `${mixedToken}__bundle.xlsx`), mixedXlsx);
  for (const entry of DATASET_FILES) {
    const schema = SchemaRegistry.getSchema(entry.datasetName);
    const body = renderHtmlTable(
      schema.requiredHeaders,
      [buildRecord(schema, 0, { seed: 'MIX' })],
    );
    await writeLatin1File(
      path.join(mixedDir, `${mixedToken}__${entry.slug}.xls`),
      async (write) => {
        await write(body);
      },
    );
  }
  catalog.push({
    expectedOutcome: 'SOURCE_INBOX_BUNDLE_AMBIGUOUS',
    fingerprint: null,
    id: 'mixed-packaging',
    packagingKind: 'mixed',
    profile: 'NEGATIVE',
    purpose: 'Same token contains both a workbook bundle and five-file members.',
    relativeDir: 'negatives/mixed-packaging',
    rowCounts: null,
    token: mixedToken,
    totalRows: null,
  });

  const paritySourceDir = path.join(outputDir, 'parity', 'source');
  const parityBundle = await writeFiveFileBundle(
    paritySourceDir,
    '20260908T160000Z',
    parityCounts,
    { hourOffset: 0, seed: 'PARITY', siteBias: 'mixed' },
  );
  const sourceRecords = {};
  for (const entry of DATASET_FILES) {
    const schema = SchemaRegistry.getSchema(entry.datasetName);
    const rows = [];
    const rowCount = countForSchema(entry.datasetName, parityCounts);
    for (let index = 0; index < rowCount; index += 1) {
      rows.push(buildRecord(schema, index, { hourOffset: 0, seed: 'PARITY', siteBias: 'mixed' }));
    }
    sourceRecords[entry.datasetName] = recordsToObjects(schema, rows);
  }
  const exportSummary = await writeParityExport(
    path.join(outputDir, 'parity', 'export'),
    parityBundle,
    sourceRecords,
    parityCounts,
  );
  catalog.push(catalogEntry({
    bundle: parityBundle,
    expectedOutcome: 'SUCCESS_THEN_PARITY',
    id: 'parity-source',
    profile: 'PARITY',
    purpose: 'Accepted synthetic source whose FILE_LEDGER fingerprint the export must match.',
    relativeDir: 'parity/source',
    rowCounts: parityCounts,
  }));
  catalog.push({
    expectedOutcome: 'PARITY_SOURCE_IDENTITY_MATCH',
    fingerprint: parityBundle.fingerprint,
    id: 'parity-export',
    packagingKind: 'legacy_export_v1',
    profile: 'PARITY',
    purpose: 'Operator-recalculated contract export with sourceBundleFingerprint equal to parity-source.',
    relativeDir: 'parity/export',
    rowCounts: parityCounts,
    token: null,
    totalRows: totalRows(parityCounts),
    export: exportSummary,
  });

  const provenance = {
    catalog,
    generatedAtUtc: new Date().toISOString(),
    notes: [
      'All payloads are synthetic and non-personal.',
      'Peak fingerprints must be distinct; duplicate-* fixtures reuse expected-peak-01 bytes.',
      'parity/export.sourceBundleFingerprint equals parity/source bundle fingerprint.',
      'A real weekly Excel recalculation stays outside the repository; copy its successful FILE_LEDGER fingerprint into the live manifest.',
    ],
    scale,
    workloadProfiles: {
      DECLARED_MAXIMUM: WORKLOAD_PROFILES.DECLARED_MAXIMUM,
      EXPECTED_PEAK: WORKLOAD_PROFILES.EXPECTED_PEAK,
    },
  };
  await fs.promises.writeFile(
    path.join(outputDir, 'provenance.json'),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  await fs.promises.writeFile(
    path.join(outputDir, 'OPERATOR.md'),
    `${operatorGuide(outputDir)}\n`,
  );
  return { catalog, outputDir, provenance };
}

function parseArgs(argv) {
  const args = { scale: 'full' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--scale') args.scale = argv[index + 1];
    if (value === '--out') args.outputDir = argv[index + 1];
  }
  return args;
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = args.outputDir || path.resolve('outputs', `cxp14-uat-fixtures-${formatUtcToken(Date.now())}`);
  const result = await generateCxp14UatFixtures({ outputDir, scale: args.scale });
  const peaks = result.catalog.filter((entry) => entry.profile === 'EXPECTED_PEAK');
  const fingerprints = new Set(peaks.map((entry) => entry.fingerprint));
  if (fingerprints.size !== 3) {
    throw new Error('expected three distinct expected-peak fingerprints');
  }
  const paritySource = result.catalog.find((entry) => entry.id === 'parity-source');
  const parityExport = result.catalog.find((entry) => entry.id === 'parity-export');
  if (paritySource.fingerprint !== parityExport.fingerprint) {
    throw new Error('parity export fingerprint does not match the accepted source bundle');
  }
  process.stdout.write(`${JSON.stringify({
    outputDir: result.outputDir,
    peakFingerprints: peaks.map((entry) => entry.fingerprint),
    parityFingerprint: paritySource.fingerprint,
    scale: result.provenance.scale,
  }, null, 2)}\n`);
}

export {
  DATASET_FILES,
  HTML_PREFIX,
  UNIT_SCALE_COUNTS,
  WORKLOAD_PROFILES,
  countsFor,
  formatUtcToken,
  totalRows,
};
