import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readReportWorkbookBytes, reportSheetRows } from './report-workbook-reader';
import { REPORT_PARSE_HARD_LIMITS, resolveReportResourceLimits, type ReportResourceLimits } from './report-resource-policy';
import { normalEntries, normalWorkbook, xmlMutation, zipFixture } from './report-resource.test-fixture';
import { LINGXING_TEMPLATE_MANIFEST } from './lingxing-template-manifest';
import { expandReportZip } from './report-zip-content';
import { inspectReportZip } from './report-zip-envelope';
import { buildNormalizedReportZip, normalizedReportZipCapacity } from './report-normalized-zip';
import { ReportParser, readRawControlTotalsBytes } from './parser';

vi.mock('xlsx', async importOriginal => {
  const actual = await importOriginal<typeof import('xlsx')>();
  return { ...actual, read: vi.fn(actual.read), utils: { ...actual.utils, sheet_to_json: vi.fn(actual.utils.sheet_to_json) } };
});
beforeEach(() => { vi.mocked(XLSX.read).mockClear(); vi.mocked(XLSX.utils.sheet_to_json).mockClear(); });
function rejected(bytes: Uint8Array, limits: Partial<ReportResourceLimits> = {}): Error {
  let failure: unknown;
  try { readReportWorkbookBytes(bytes, 'isolated.xlsx', {}, { limits }); }
  catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  expect(XLSX.read).not.toHaveBeenCalled();
  expect(XLSX.utils.sheet_to_json).not.toHaveBeenCalled();
  return failure as Error;
}

describe('实际 ZIP 字节在 SheetJS 之前拒绝', () => {
  it.each([[7, 9], [1, 1], [8, 5], [1, 6]])('按实际时间元数据消费拒绝 flags=%s length=%s', (flags, length) => {
    const extra = Buffer.alloc(4 + length); extra.writeUInt16LE(0x5455); extra.writeUInt16LE(length, 2); extra[4] = flags;
    rejected(zipFixture(normalEntries(), { extra }));
  });
  it('实际小压缩大展开不能依靠虚假目录尺寸绕过输出预算', () => {
    const bytes = zipFixture([['bomb.xml', Buffer.from('a'.repeat(8192))]], { compression: true, declaredSize: 1 });
    expect(rejected(bytes, { maxZipEntryBytes: 1024 }).message).toContain('REPORT_RESOURCE_LIMIT');
  });
  it('逐项累计实际展开字节并限制剩余输出空间', () => {
    const bytes = zipFixture([['first.xml', Buffer.from('a'.repeat(200))], ['second.xml', Buffer.from('b'.repeat(200))]], { compression: true });
    expect(rejected(bytes, { maxZipTotalBytes: 300 }).message).toContain('REPORT_RESOURCE_LIMIT');
  });
  it('实际膨胀比不能只凭声明尺寸通过', () => {
    expect(rejected(zipFixture([['data.xml', Buffer.from('a'.repeat(200))]], { compression: true }), { maxZipExpansionRatio: 2 }).message).toContain('REPORT_RESOURCE_LIMIT');
  });
  it.each([
    ['CRC', () => zipFixture(normalEntries(), { crcDelta: 1 })],
    ['extra deflate tail', () => zipFixture(normalEntries(), { compression: true, trailingDeflateBytes: true })],
    ['encrypted', () => zipFixture(normalEntries(), { flags: 1 })],
    ['unknown method', () => zipFixture(normalEntries(), { method: 99 })],
    ['duplicate name', () => { const entries = normalEntries(); return zipFixture([...entries, entries[0]]); }],
    ['canonical duplicate', () => { const entries = normalEntries(); return zipFixture([...entries, [entries[0][0].toUpperCase(), entries[0][1]]]); }],
    ...['META-INF/manifest.xml', 'meta-inf/MANIFEST.XML', 'objectdata.xml', 'OBJECTDATA.XML', 'Index/Document.iwa',
      'Root Entry/META-INF/manifest.xml', 'root entry/objectdata.xml', 'Root Entry/xl/workbook.xml'].map(name =>
      [name + ' dispatch/alias', () => zipFixture([...normalEntries(), [name, Buffer.from('<untrusted/>')]])] as const),
    ['path traversal', () => zipFixture([['../part.xml', Buffer.from('x')]])],
    ['non-ASCII name view', () => zipFixture([...normalEntries(), ['xl/附加.xml', Buffer.from('<x/>')]])],
    ['long path', () => zipFixture([[('a'.repeat(513)) + '.xml', Buffer.from('<x/>')]])],
    ['deep directory path', () => zipFixture([[Array.from({ length: 17 }, () => 'a').join('/') + '/part.xml', Buffer.from('<x/>')]])],
    ['STORE descriptor with zero local lengths', () => zipFixture(normalEntries(), { descriptor: true })],
    ['archive trailing bytes', () => Buffer.concat([normalWorkbook(), Buffer.from('trailing')])],
    ['local/CD CRC mismatch', () => { const bytes = zipFixture(normalEntries()); bytes.writeUInt32LE(1, 14); return bytes; }],
    ['local/CD size mismatch', () => { const bytes = zipFixture(normalEntries()); bytes.writeUInt32LE(1, 22); return bytes; }],
    ['local/CD flags mismatch', () => { const bytes = zipFixture(normalEntries()); bytes.writeUInt16LE(8, 6); return bytes; }],
    ['local/CD name mismatch', () => { const bytes = zipFixture(normalEntries()); bytes[30] ^= 1; return bytes; }],
    ['descriptor mismatch', () => { const bytes = zipFixture(normalEntries(), { compression: true, descriptor: true }); const nameLength = bytes.readUInt16LE(26); const packedLength = bytes.readUInt32LE(bytes.readUInt32LE(bytes.length - 6) + 20); bytes.writeUInt32LE(1, 30 + nameLength + packedLength + 4); return bytes; }],
    ['overlap', () => { const bytes = zipFixture(normalEntries()); const central = bytes.readUInt32LE(bytes.length - 6); const second = central + 46 + bytes.readUInt16LE(central + 28); bytes.writeUInt32LE(0, second + 42); return bytes; }],
    ['ZIP64', () => { const bytes = normalWorkbook(); bytes.writeUInt16LE(0xffff, bytes.length - 12); return bytes; }],
    ['split archive', () => { const bytes = normalWorkbook(); bytes.writeUInt16LE(1, bytes.length - 18); return bytes; }],
    ['EOCD comment length', () => { const bytes = normalWorkbook(); bytes.writeUInt16LE(1, bytes.length - 2); return bytes; }],
    ['EOCD signature in comment', () => { const bytes = normalWorkbook(), comment = Buffer.alloc(32); comment.writeUInt32LE(0x06054b50, 4); bytes.writeUInt16LE(comment.length, bytes.length - 2); return Buffer.concat([bytes, comment]); }],
  ] as const)('拒绝 %s', (_name, create) => { rejected(create()); });
  it('拒绝超出条目数预算', () => { rejected(zipFixture(normalEntries()), { maxZipEntries: 1 }); });
  it('合成父目录也共用节点预算', () => { rejected(zipFixture(normalEntries()), { maxZipDirectoryNodes: 1 }); });
});

describe('XML 关系、坐标和文本预算', () => {
  it('hyperlink 引用的实际展开范围必须在 SheetJS 之前限额', () => {
    const bytes = xmlMutation('xl/worksheets/sheet1.xml', xml => xml.replace('</worksheet>', '<hyperlinks><hyperlink ref="A1:K12" location="local"/></hyperlinks></worksheet>'));
    rejected(bytes, { maxCells: 100 });
  });
  it.each([
    ['huge dimension', () => xmlMutation('xl/worksheets/sheet1.xml', xml => xml.replace(/<dimension[^>]*\/>/, '<dimension ref="A1:XFD1048576"/>'))],
    ['hidden far cell', () => xmlMutation('xl/worksheets/sheet1.xml', xml => xml.replace('r="A1"', 'r="XFD1048576"'))],
    ['sparse huge rectangle', () => xmlMutation('xl/worksheets/sheet1.xml', xml => xml.replace('r="A1"', 'r="IV100000"'))],
    ['DTD', () => xmlMutation('xl/workbook.xml', xml => '<!DOCTYPE workbook [<!ENTITY x "value">]>' + xml)],
    ['custom entity', () => xmlMutation('xl/workbook.xml', xml => xml.replace('Report', '&custom;'))],
    ['unsupported encoding', () => xmlMutation('xl/workbook.xml', xml => xml.replace('UTF-8', 'UTF-16'))],
    ['deep XML', () => xmlMutation('xl/worksheets/sheet1.xml', xml => xml.replace('</worksheet>', '<x>'.repeat(65) + '</x>'.repeat(65) + '</worksheet>'))],
    ['CDATA hidden structure', () => xmlMutation('xl/worksheets/sheet1.xml', xml => xml.replace('<sheetData>', '<![CDATA[<dimension ref="A1:XFD1048576"/>]]><sheetData>'))],
    ['comment hidden structure', () => xmlMutation('xl/worksheets/sheet1.xml', xml => xml.replace('<sheetData>', '<!--<dimension ref="A1:XFD1048576"/>--><sheetData>'))],
    ['workbook root Target', () => xmlMutation('_rels/.rels', xml => xml.replace('Target="xl/workbook.xml"', 'Target="xl/other.xml"'))],
    ['workbook content type path', () => xmlMutation('[Content_Types].xml', xml => xml.replace('/xl/workbook.xml', '/xl/other.xml'))],
    ['shared formula expansion', () => xmlMutation('xl/worksheets/sheet1.xml', xml => xml.replace('<v>1</v>', '<f t="shared" si="4294967295">A1+1</f><v>1</v>'))],
    ['array formula expansion', () => xmlMutation('xl/worksheets/sheet1.xml', xml => xml.replace('<v>1</v>', '<f t="array" ref="A1:C2">A1+1</f><v>1</v>'))],
    ['cell text', () => xmlMutation('xl/worksheets/sheet1.xml', xml => xml.replace('B000000001', 'x'.repeat(32768)))],
    ['shared strings text', () => { const entries = normalEntries(); entries.push(['xl/sharedStrings.xml', Buffer.from('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>' + 'x'.repeat(32768) + '</t></si></sst>')]); return zipFixture(entries); }],
    ['worksheet Target path', () => { const entries = normalEntries(); entries.find(([name]) => name === 'xl/_rels/workbook.xml.rels')![1] = Buffer.from(entries.find(([name]) => name === 'xl/_rels/workbook.xml.rels')![1].toString().replace('worksheets/sheet1.xml', 'other.xml')); entries.find(([name]) => name === 'xl/worksheets/sheet1.xml')![0] = 'xl/other.xml'; return zipFixture(entries); }],
    ['binary Target path', () => xmlMutation('xl/_rels/workbook.xml.rels', xml => xml.replace('worksheets/sheet1.xml', 'worksheets/sheet1.bin'))],
    ...['styles', 'sharedStrings', 'sheetMetadata'].map(part => [part + ' binary ContentType without relationship', () => {
      const entries = normalEntries();
      const contentTypes = entries.find(([name]) => name === '[Content_Types].xml')!;
      contentTypes[1] = Buffer.from(contentTypes[1].toString().replace('</Types>', `<Override PartName="/xl/${part}.bin" ContentType="application/vnd.ms-excel.${part}"/></Types>`));
      entries.push([`xl/${part}.bin`, Buffer.from([0xff, 0xff, 0xff, 0xff])]);
      return zipFixture(entries);
    }] as const),
  ] as const)('在 SheetJS 读取前拒绝 %s', (_name, create) => { rejected(create()); });
  it('实际 cell 数及 XML token/总文本也有独立上限', () => {
    rejected(normalWorkbook(), { maxCells: 1 });
    rejected(normalWorkbook(), { maxXmlTokens: 1 });
    rejected(normalWorkbook(), { maxTextBytes: 100 });
  });
  it('worksheet 对象转换前校验原始 !fullref，不能截断成功', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['x']]); sheet['!fullref'] = 'A1:XFD1048576';
    expect(() => reportSheetRows(sheet)).toThrow();
    expect(XLSX.utils.sheet_to_json).not.toHaveBeenCalled();
  });
  it.each(['<html><table><tr><td>x</td></tr></table></html>', '<?xml version="1.0"?><Workbook/>', 'ID;P', 'TABLE\n0,1'])('CSV 不嗅探其它结构 %s', source => {
    expect(() => readReportWorkbookBytes(Buffer.from(source), 'isolated.csv')).toThrow();
    expect(XLSX.read).not.toHaveBeenCalled();
  });
});

describe('预算配置与异常首错', () => {
  it.each(['{"constructor":1}', '{"__proto__":1}', '{"toString":1}', '{"maxInputBytes":33554433}'])('拒绝未知或抬升的自有配置 %s', value => {
    expect(() => resolveReportResourceLimits(JSON.parse(value))).toThrow();
  });
  it('拒绝非普通对象与访问器，不执行配置 getter', () => {
    const getter = vi.fn(() => 1);
    expect(() => resolveReportResourceLimits(Object.create({ maxInputBytes: 1 }))).toThrow();
    expect(() => resolveReportResourceLimits(Object.defineProperty({}, 'maxInputBytes', { get: getter }))).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it('日志端口与备用日志失败时仍保留解析首错和两个次错', () => {
    const loggingError = new Error('logger failure'), fallbackError = new Error('console failure');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { throw fallbackError; });
    try {
      let failure: any;
      try { readReportWorkbookBytes(Buffer.from('x'), 'isolated.xlsx', {}, { logger: { warn() {}, error() { throw loggingError; } } }); }
      catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(AggregateError);
      expect(failure.errors[0].code).toBe('REPORT_FORMAT_UNSUPPORTED');
      expect(failure.cause).toBe(failure.errors[0]);
      expect(failure.errors.slice(1)).toEqual([loggingError, fallbackError]);
    } finally { consoleSpy.mockRestore(); }
  });
});

describe('正常输入兼容', () => {
  it.each([[1, 5], [7, 13]])('受限时间元数据 flags=%s length=%s 通过预检后被剥除', (flags, length) => {
    const extra = Buffer.alloc(4 + length); extra.writeUInt16LE(0x5455); extra.writeUInt16LE(length, 2); extra[4] = flags;
    expect(readReportWorkbookBytes(zipFixture(normalEntries(), { extra, compression: true }), 'isolated.xlsx').SheetNames).toEqual(['Report']);
    expect((vi.mocked(XLSX.read).mock.calls[0][0] as Buffer).readUInt16LE(28)).toBe(0);
  });
  it('底层只收到已验内容的 STORE 容器，每个 payload 与原 Map 一一一致', () => {
    const original = normalWorkbook('xlsx', true), before = Buffer.from(original);
    const expected = expandReportZip(original, REPORT_PARSE_HARD_LIMITS);
    readReportWorkbookBytes(original, 'isolated.xlsx');
    const received = Buffer.from(vi.mocked(XLSX.read).mock.calls[0][0] as Uint8Array);
    expect(received.equals(original)).toBe(false); expect(original.equals(before)).toBe(true);
    const entries = inspectReportZip(received, REPORT_PARSE_HARD_LIMITS);
    expect(entries.every(entry => entry.method === 0)).toBe(true);
    const actual = expandReportZip(received, REPORT_PARSE_HARD_LIMITS);
    expect([...actual.keys()]).toEqual([...expected.keys()]);
    for (const [name, bytes] of expected) expect(actual.get(name)?.equals(bytes)).toBe(true);
    let offset = 0;
    for (const entry of entries) {
      expect(received.readUInt16LE(offset + 6)).toBe(0);
      expect(received.readUInt16LE(offset + 28)).toBe(0);
      offset = entry.end;
    }
    expect(received.readUInt16LE(received.length - 2)).toBe(0);
  });
  it('派生容器容量超限在 Buffer 分配与第三方读取之前拒绝', () => {
    const content = new Map(normalEntries()), limits = resolveReportResourceLimits({ maxNormalizedZipBytes: 1 });
    const allocation = vi.spyOn(Buffer, 'alloc');
    try {
      expect(() => buildNormalizedReportZip(content, limits)).toThrow(/REPORT_RESOURCE_LIMIT/);
      expect(allocation).not.toHaveBeenCalled(); expect(XLSX.read).not.toHaveBeenCalled();
    } finally { allocation.mockRestore(); }
  });
  it('规范容器也自检 EOCD 字段不能形成更晚的目录签名', () => {
    const content = new Map(normalEntries()), capacity = normalizedReportZipCapacity(content, REPORT_PARSE_HARD_LIMITS);
    const write = Buffer.prototype.writeUInt32LE;
    const writeSpy = vi.spyOn(Buffer.prototype, 'writeUInt32LE').mockImplementation(function(this: Buffer, ...args: unknown[]) {
      const value = args[0] as number, offset = (args[1] ?? 0) as number;
      return write.call(this, offset === capacity - 6 ? 0x06054b50 : value, offset);
    });
    try {
      expect(() => buildNormalizedReportZip(content, REPORT_PARSE_HARD_LIMITS)).toThrow(/REPORT_ARCHIVE_INVALID/);
      expect(XLSX.read).not.toHaveBeenCalled();
    } finally { writeSpy.mockRestore(); }
  });
  it('源文件摘要、字节与内容版本 stat 保持不变，raw totals 独立读取原快照', () => {
    const directory = fs.mkdtempSync(path.join(path.resolve(os.tmpdir()), 'isolated-normalized-report-'));
    const file = path.join(directory, 'isolated.xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['日期', '广告活动', '花费'], ['2026-10-01', 'isolated', 1.25], ['2026-10-02', 'isolated', 2.5],
    ]), 'Report');
    const original = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
    fs.writeFileSync(file, original);
    const hash = createHash('sha256').update(original).digest('hex'), before = fs.statSync(file, { bigint: true });
    try {
      new ReportParser().parseExcel(file);
      expect(readRawControlTotalsBytes(original, file, { dateStart: '2026-10-01', dateEnd: '2026-10-02' }))
        .toEqual({ expectedRows: 2, expectedCost: 3.75 });
      expect(fs.readFileSync(file).equals(original)).toBe(true);
      expect(createHash('sha256').update(fs.readFileSync(file)).digest('hex')).toBe(hash);
      const after = fs.statSync(file, { bigint: true });
      for (const key of ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'] as const) expect(after[key]).toBe(before[key]);
    } finally {
      if (path.dirname(directory) !== path.resolve(os.tmpdir())) throw new Error('拒绝清理非隔离测试目录。');
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  it('仍读取普通缓存公式，来源资格仍由原合同判断', () => {
    const bytes = xmlMutation('xl/worksheets/sheet1.xml', xml => xml.replace('<v>1</v>', '<f>1+1</f><v>1</v>'));
    expect(readReportWorkbookBytes(bytes, 'isolated.xlsx').Sheets.Report.C2.f).toBe('1+1');
  });
  it.each(LINGXING_TEMPLATE_MANIFEST.map(template => [template.reportType, template.headers] as const))('登记模板 %s 的正常列规模可读取', (_type, headers) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[...headers]]), 'Report');
    for (const compression of [false, true]) {
      const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression });
      expect(readReportWorkbookBytes(bytes, 'isolated.xlsx').SheetNames).toEqual(['Report']);
    }
  });
  it.each([false, true])('接受正常压缩模式 %s', compression => {
    expect(readReportWorkbookBytes(normalWorkbook('xlsx', compression), 'isolated.xlsx').SheetNames).toEqual(['Report']);
  });
  it('接受严格一致的 data descriptor', () => {
    expect(readReportWorkbookBytes(zipFixture(normalEntries(), { compression: true, descriptor: true }), 'isolated.xlsx').SheetNames).toEqual(['Report']);
  });
  it('接受正常 XLS 与带引号换行 CSV', () => {
    expect(readReportWorkbookBytes(normalWorkbook('xls'), 'isolated.xls').SheetNames).toEqual(['Report']);
    const book = readReportWorkbookBytes(Buffer.from('name,value\n"two\nlines",1\n'), 'isolated.csv');
    expect(reportSheetRows(book.Sheets.Sheet1, { header: 1 })).toEqual([['name', 'value'], ['two\nlines', 1]]);
  });
  it.each([
    ['isolated.tsv', '\tvalue\nitem\t1\n', [['', 'value'], ['item', 1]]],
    ['isolated.csv', 'Дата,value\n2026-10-01,1\n', [['Дата', 'value'], ['2026-10-01', 1]]],
  ] as const)('文本 %s 不因首个字节碰撞而被误判 XLS', (sourceName, text, expected) => {
    const book = readReportWorkbookBytes(Buffer.from(text), sourceName);
    expect(reportSheetRows(book.Sheets.Sheet1, { header: 1, defval: '' })).toEqual(expected);
    expect(XLSX.read).not.toHaveBeenCalled();
  });
  it('默认硬上限自身被冻结', () => { expect(Object.isFrozen(REPORT_PARSE_HARD_LIMITS)).toBe(true); });
});
