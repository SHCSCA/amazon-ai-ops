import { TextDecoder } from 'node:util';
import { rejectReport, type ReportResourceLimits } from './report-resource-policy';

export function inspectReportText(bytes: Uint8Array, sourceName: string, limits: ReportResourceLimits): string {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { rejectReport('text-encoding', 'REPORT_FORMAT_UNSUPPORTED'); }
  if (bytes.byteLength > limits.maxTextBytes || text.includes('\0')) rejectReport('text-bytes');
  if (/^(?:<|ID;|TABLE\b|\{\\rtf)/i.test(text.trimStart())) rejectReport('text-format', 'REPORT_FORMAT_UNSUPPORTED');
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') { if (quoted && text[index + 1] === '"') index++; else quoted = !quoted; }
    if (!quoted && (character === '\n' || character === '\r')) break;
    if (!quoted && character in counts) counts[character]++;
  }
  const delimiter = /\.tsv$/i.test(sourceName) ? '\t' : Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  let row = 1, columns = 1, maximumColumns = 1, cells = 0, characters = 0, fieldStarted = false, afterQuote = false;
  quoted = false;
  const endField = () => {
    if (++cells > limits.maxCells || characters > limits.maxCellTextChars) rejectReport('text-cells');
    characters = 0; fieldStarted = false; afterQuote = false;
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { characters++; index++; }
        else { quoted = false; afterQuote = true; }
      } else characters++;
    } else if (character === '"') {
      if (afterQuote) rejectReport('text-quotes', 'REPORT_ARCHIVE_INVALID');
      if (fieldStarted) characters++;
      else { quoted = true; fieldStarted = true; }
    } else if (character === delimiter) {
      endField(); columns++; maximumColumns = Math.max(maximumColumns, columns);
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index++;
      endField();
      if (index + 1 < text.length) row++;
      columns = 1;
    } else {
      if (afterQuote && !/\s/.test(character)) rejectReport('text-quotes', 'REPORT_ARCHIVE_INVALID');
      characters++; fieldStarted = true;
    }
    if (characters > limits.maxCellTextChars || row > limits.maxRows || columns > limits.maxColumns
      || row * maximumColumns > limits.maxRangeCells) rejectReport('text-dimensions');
  }
  if (quoted) rejectReport('text-quotes', 'REPORT_ARCHIVE_INVALID');
  endField();
  return text;
}

export function reportTextRows(text: string, sourceName: string): Array<Array<string | number | undefined>> {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quote = false;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '"') { if (quote && text[index + 1] === '"') index++; else quote = !quote; }
    if (!quote && /[\r\n]/.test(text[index])) break;
    if (!quote && text[index] in counts) counts[text[index]]++;
  }
  const delimiter = /\.tsv$/i.test(sourceName) ? '\t' : Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const rows: Array<Array<string | number | undefined>> = [], row: Array<string | number | undefined> = [];
  let value = '', fieldStarted = false; quote = false;
  const field = () => {
    const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ? Number(value) : NaN;
    row.push(value === '' ? undefined : Number.isFinite(numeric) ? numeric : value); value = ''; fieldStarted = false;
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quote && text[index + 1] === '"') { value += '"'; index++; }
      else if (quote) quote = false;
      else if (!fieldStarted) { quote = true; fieldStarted = true; }
      else value += character;
    } else if (!quote && character === delimiter) field();
    else if (!quote && /[\r\n]/.test(character)) {
      if (character === '\r' && text[index + 1] === '\n') index++;
      field(); rows.push(row.splice(0));
    } else { value += character; fieldStarted = true; }
  }
  if (value || row.length) { field(); rows.push(row); }
  return rows;
}
