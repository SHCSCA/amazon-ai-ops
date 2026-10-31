import { TextDecoder } from 'node:util';
import { checkReportCoordinate, checkReportRange } from './report-sheet-budget';
import { rejectReport, type ReportResourceLimits } from './report-resource-policy';

function xmlValue(value: string): string {
  return value.replace(/&([^;&]{0,32});|&/g, (_raw, name: string | undefined) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (name && named[name]) return named[name];
    if (name && /^#(?:[0-9]{1,7}|x[0-9a-fA-F]{1,6})$/.test(name)) {
      const code = name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code);
    }
    return rejectReport('xml-entity', 'REPORT_ARCHIVE_INVALID');
  });
}
function attributes(value: string, limits: ReportResourceLimits): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  let cursor = 0, count = 0;
  while (cursor < value.length) {
    const whitespace = /^\s+/.exec(value.slice(cursor));
    if (!whitespace) rejectReport('xml-attribute', 'REPORT_ARCHIVE_INVALID');
    cursor += whitespace[0].length;
    if (cursor === value.length) break;
    const match = /^([A-Za-z_][\w.:-]*)\s*=\s*(["'])([\s\S]*?)\2/.exec(value.slice(cursor));
    if (!match || Object.prototype.hasOwnProperty.call(result, match[1]) || ++count > limits.maxXmlAttributes) rejectReport('xml-attribute', 'REPORT_ARCHIVE_INVALID');
    if (match[3].length > limits.maxCellTextChars) rejectReport('xml-attribute-text');
    if (match[3].includes('<')) rejectReport('xml-attribute', 'REPORT_ARCHIVE_INVALID');
    result[match[1]] = xmlValue(match[3]); cursor += match[0].length;
  }
  return result;
}
export function checkReportOoxml(content: ReadonlyMap<string, Buffer>, limits: ReportResourceLimits): void {
  let tokens = 0, cells = 0, expandedCells = 0, sheets = 0, xmlBytes = 0, structuralItems = 0, workbookParts = 0;
  const sheetIds: string[] = [], relationships = new Map<string, string>();
  for (const [name, bytes] of content) {
    if (/^xl\/(?:worksheets\/.*|workbook)\.bin$/i.test(name)) rejectReport('ooxml-binary-sheet', 'REPORT_FORMAT_UNSUPPORTED');
    if (!/\.(?:xml|rels|vml)$/i.test(name)) continue;
    xmlBytes += bytes.length;
    if (xmlBytes > limits.maxTextBytes) rejectReport('xml-total-text');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { rejectReport('xml-encoding', 'REPORT_FORMAT_UNSUPPORTED'); }
    if (text.includes('\0')) rejectReport('xml-characters', 'REPORT_ARCHIVE_INVALID');
    const stack: string[] = [];
    let cursor = 0, row = 0, column = 0, cellText = 0;
    let minRow = Infinity, minColumn = Infinity, maxRow = 0, maxColumn = 0;
    const worksheet = /^xl\/worksheets\/[^/]+\.xml$/i.test(name);
    const consumeText = (value: string, raw = false) => {
      const decoded = raw ? value : xmlValue(value);
      if (stack.some(tag => ['c', 'si'].includes(tag.split(':').at(-1)!))) {
        cellText += decoded.length;
        if (cellText > limits.maxCellTextChars) rejectReport('xml-cell-text');
      }
    };
    while (cursor < text.length) {
      if (++tokens > limits.maxXmlTokens) rejectReport('xml-tokens');
      if (text[cursor] !== '<') {
        const next = text.indexOf('<', cursor), end = next < 0 ? text.length : next;
        consumeText(text.slice(cursor, end)); cursor = end; continue;
      }
      if (text.startsWith('<!--', cursor)) {
        const end = text.indexOf('-->', cursor + 4);
        if (end < 0) rejectReport('xml-comment', 'REPORT_ARCHIVE_INVALID');
        if (text.slice(cursor + 4, end).includes('<')) rejectReport('xml-opaque-markup', 'REPORT_FORMAT_UNSUPPORTED');
        cursor = end + 3; continue;
      }
      if (text.startsWith('<![CDATA[', cursor)) {
        const end = text.indexOf(']]>', cursor + 9);
        if (end < 0) rejectReport('xml-cdata', 'REPORT_ARCHIVE_INVALID');
        // 底层使用部分正则解析，拒绝可被再次当成结构的嵌套字面标签。
        if (text.slice(cursor + 9, end).includes('<')) rejectReport('xml-opaque-markup', 'REPORT_FORMAT_UNSUPPORTED');
        consumeText(text.slice(cursor + 9, end), true); cursor = end + 3; continue;
      }
      if (text.startsWith('<?', cursor)) {
        const end = text.indexOf('?>', cursor + 2);
        if (end < 0 || /encoding\s*=\s*["'](?!utf-8["'])/i.test(text.slice(cursor, end))) rejectReport('xml-encoding', 'REPORT_FORMAT_UNSUPPORTED');
        if (text.slice(cursor + 2, end).includes('<') || end - cursor > limits.maxCellTextChars) rejectReport('xml-processing-instruction', 'REPORT_FORMAT_UNSUPPORTED');
        cursor = end + 2; continue;
      }
      if (text.startsWith('<!', cursor)) rejectReport('xml-declaration', 'REPORT_ARCHIVE_INVALID');
      let end = cursor + 1, quote = '';
      for (; end < text.length; end++) {
        const character = text[end];
        if (quote) { if (character === quote) quote = ''; }
        else if (character === '"' || character === "'") quote = character;
        else if (character === '>') break;
      }
      if (end === text.length) rejectReport('xml-tag', 'REPORT_ARCHIVE_INVALID');
      const body = text.slice(cursor + 1, end), closing = body.startsWith('/'), selfClosing = body.endsWith('/');
      const match = /^\/?([A-Za-z_][\w.:-]*)([\s\S]*?)\/?$/.exec(body);
      if (!match) rejectReport('xml-tag', 'REPORT_ARCHIVE_INVALID');
      const tag = match[1], local = tag.split(':').at(-1)!;
      if (closing) {
        if (match[2].trim() || stack.pop() !== tag) rejectReport('xml-nesting', 'REPORT_ARCHIVE_INVALID');
      } else {
        const attrs = attributes(match[2], limits);
        if (match[2].length > limits.maxCellTextChars * limits.maxXmlAttributes) rejectReport('xml-attributes-text');
        if (stack.length === 0 && ['workbook', 'worksheet', 'Relationships'].includes(local)) {
          const namespace = attrs[tag.includes(':') ? 'xmlns:' + tag.split(':')[0] : 'xmlns'];
          const expected = local === 'Relationships' ? 'http://schemas.openxmlformats.org/package/2006/relationships'
            : 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
          if (namespace !== expected) rejectReport('xml-namespace', 'REPORT_FORMAT_UNSUPPORTED');
        }
        if (['si', 'xf', 'font', 'fill', 'border', 'numFmt'].includes(local) && ++structuralItems > limits.maxCells) rejectReport('xml-structure-items');
        if (name === '[Content_Types].xml' && local === 'Override'
          && /^application\/vnd\.ms-excel\./i.test(attrs.ContentType) && !attrs.ContentType.endsWith('+xml')) rejectReport('binary-content-type', 'REPORT_FORMAT_UNSUPPORTED');
        if (name === '[Content_Types].xml' && local === 'Override') {
          if (/spreadsheetml\.sheet\.main\+xml$/.test(attrs.ContentType)) {
            if (attrs.PartName !== '/xl/workbook.xml' || ++workbookParts > 1) rejectReport('workbook-content-type', 'REPORT_FORMAT_UNSUPPORTED');
          } else if (/\.(?:main|binary)\b/i.test(attrs.ContentType) && /(?:excel|spreadsheet)/i.test(attrs.ContentType)) {
            rejectReport('workbook-content-type', 'REPORT_FORMAT_UNSUPPORTED');
          }
          if (attrs.ContentType?.endsWith('+xml') && !/\.xml$/.test(attrs.PartName)) rejectReport('xml-content-type', 'REPORT_FORMAT_UNSUPPORTED');
        }
        if (name === '_rels/.rels' && local === 'Relationship' && attrs.Type?.endsWith('/officeDocument')
          && (attrs.TargetMode || !['xl/workbook.xml', '/xl/workbook.xml'].includes(attrs.Target))) rejectReport('workbook-target', 'REPORT_FORMAT_UNSUPPORTED');
        if (name === 'xl/workbook.xml' && local === 'sheet') {
          if (++sheets > limits.maxSheets) rejectReport('workbook-sheets');
          if (!attrs['r:id'] || sheetIds.includes(attrs['r:id'])) rejectReport('workbook-sheet-id', 'REPORT_ARCHIVE_INVALID');
          sheetIds.push(attrs['r:id']);
        }
        if (name === 'xl/_rels/workbook.xml.rels' && local === 'Relationship') {
          if (!attrs.Id || relationships.has(attrs.Id) || !attrs.Type || !attrs.Target) rejectReport('worksheet-relationship', 'REPORT_ARCHIVE_INVALID');
          if (/\/(?:chartsheet|dialogsheet|macrosheet)$/.test(attrs.Type)) rejectReport('worksheet-type', 'REPORT_FORMAT_UNSUPPORTED');
          let target = '';
          if (attrs.Type.endsWith('/worksheet')) {
            target = attrs.Target.startsWith('/') ? attrs.Target.slice(1) : 'xl/' + attrs.Target;
            if (attrs.TargetMode || !/^xl\/worksheets\/sheet[1-9]\d*\.xml$/.test(target) || !content.has(target)) rejectReport('worksheet-target', 'REPORT_FORMAT_UNSUPPORTED');
          }
          if (/\/(?:sharedStrings|styles|theme|calcChain|sheetMetadata)$/.test(attrs.Type) && !/\.xml$/.test(attrs.Target)) rejectReport('xml-target', 'REPORT_FORMAT_UNSUPPORTED');
          relationships.set(attrs.Id, target);
        }
        if (worksheet && ['dimension', 'mergeCell', 'autoFilter', 'hyperlink', 'f'].includes(local) && attrs.ref !== undefined) {
          if (!attrs.ref) rejectReport('sheet-range', 'REPORT_ARCHIVE_INVALID');
          checkReportRange(attrs.ref, limits);
        }
        if (worksheet && local === 'f' && attrs.t && attrs.t !== 'normal') rejectReport('xml-complex-formula', 'REPORT_FORMAT_UNSUPPORTED');
        if (worksheet && local === 'hyperlink') {
          if (!attrs.ref) rejectReport('hyperlink-range', 'REPORT_ARCHIVE_INVALID');
          const [start, end = start] = attrs.ref.split(':');
          const first = checkReportCoordinate(start, limits), last = checkReportCoordinate(end, limits);
          expandedCells += (last.r - first.r + 1) * (last.c - first.c + 1);
          if (expandedCells + cells > limits.maxCells) rejectReport('hyperlink-expanded-cells');
        }
        if (worksheet && local === 'row') {
          row = attrs.r === undefined ? row + 1 : Number(attrs.r); column = 0;
          if (!Number.isSafeInteger(row) || row < 1 || row > limits.maxRows) rejectReport('xml-row');
        }
        if (worksheet && local === 'c') {
          if (++cells + expandedCells > limits.maxCells) rejectReport('xml-cells');
          let cellRow = row;
          if (attrs.r) { const coordinate = checkReportCoordinate(attrs.r, limits); column = coordinate.c; cellRow = coordinate.r; }
          else if (++column > limits.maxColumns || row < 1 || row > limits.maxRows) rejectReport('xml-cell-coordinate');
          minRow = Math.min(minRow, cellRow); maxRow = Math.max(maxRow, cellRow);
          minColumn = Math.min(minColumn, column); maxColumn = Math.max(maxColumn, column);
          if ((maxRow - minRow + 1) * (maxColumn - minColumn + 1) > limits.maxRangeCells) rejectReport('xml-cell-range');
        }
        if (local === 'c' || local === 'si') cellText = 0;
        if (!selfClosing) stack.push(tag);
        if (stack.length > limits.maxXmlDepth) rejectReport('xml-depth');
      }
      cursor = end + 1;
    }
    if (stack.length) rejectReport('xml-nesting', 'REPORT_ARCHIVE_INVALID');
  }
  if (workbookParts !== 1 || !sheets || sheetIds.some(id => !relationships.get(id))) rejectReport('workbook-sheets', 'REPORT_ARCHIVE_INVALID');
}
