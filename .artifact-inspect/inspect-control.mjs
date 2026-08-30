import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = 'C:/Users/djean/Downloads/Nike_IR_Msg/MSG Intraday EOD 0817.xlsx';
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
for (const request of [
  { kind: 'computedStyle', sheetId: 'Interval View', range: 'B97:AB109', maxChars: 18000 },
  { kind: 'region', sheetId: 'Interval View', range: 'B97:AB109', maxChars: 10000 },
]) {
  const result = await workbook.inspect(request);
  process.stdout.write(result.ndjson + '\n');
}
const preview = await workbook.render({
  sheetName: 'Interval View',
  range: 'B102:AB151',
  scale: 1,
  format: 'png',
});
await fs.writeFile('.artifact-inspect/interval-view.png', new Uint8Array(await preview.arrayBuffer()));
