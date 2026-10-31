import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readReportWorkbookBytes } from './report-workbook-reader';
import { REPORT_PARSE_HARD_LIMITS } from './report-resource-policy';
import { normalWorkbook } from './report-resource.test-fixture';

vi.mock('xlsx', async importOriginal => {
  const actual = await importOriginal<typeof import('xlsx')>();
  return { ...actual, read: vi.fn(actual.read), utils: { ...actual.utils, sheet_to_json: vi.fn(actual.utils.sheet_to_json) } };
});
beforeEach(() => { vi.mocked(XLSX.read).mockClear(); vi.mocked(XLSX.utils.sheet_to_json).mockClear(); });
function workbookEntry(bytes: Buffer): number {
  const offset = bytes.indexOf(Buffer.from('Workbook\0', 'utf16le'));
  if (offset < 0) throw new Error('隔离 XLS 缺少 Workbook 目录项。');
  return offset;
}
function rawWorkbook(): Buffer {
  return Buffer.from(XLSX.CFB.read(normalWorkbook('xls'), { type: 'buffer' }).FileIndex.find((entry: { name: string }) => entry.name === 'Workbook')!.content!);
}
function record(bytes: Buffer, id: number): number {
  for (let offset = 0; offset + 4 <= bytes.length; offset += 4 + bytes.readUInt16LE(offset + 2)) {
    if (bytes.readUInt16LE(offset) === id) return offset + 4;
  }
  throw new Error('隔离 BIFF 缺少待修改记录。');
}
describe('真实 XLS reader 在第三方分配前执行容器和 BIFF 预算', () => {
  it.each(['EncryptedPackage', 'eNcRyPtEdPaCkAgE'])('CFB 根目录 %s 不能触发未审加密分派', name => {
    const bytes = normalWorkbook('xls'), root = (bytes.readUInt32LE(48) + 1) * 512;
    bytes.fill(0, root, root + 64);
    const encoded = Buffer.from(name + '\0', 'utf16le');
    encoded.copy(bytes, root); bytes.writeUInt16LE(encoded.length, root + 64);
    const reader = vi.mocked(XLSX.read), actual = reader.getMockImplementation()!;
    reader.mockImplementation(() => { throw new Error('隔离断言禁止调用未审加密解析器。'); });
    try {
      expect(() => readReportWorkbookBytes(bytes, 'isolated.xls')).toThrow();
      expect(XLSX.read).not.toHaveBeenCalled(); expect(XLSX.utils.sheet_to_json).not.toHaveBeenCalled();
    } finally { reader.mockImplementation(actual); }
  });
  it.each([
    ['stream declared size', () => { const bytes = normalWorkbook('xls'); bytes.writeUInt32LE(REPORT_PARSE_HARD_LIMITS.maxZipEntryBytes + 1, workbookEntry(bytes) + 120); return bytes; }],
    ['64-bit huge stream', () => { const bytes = normalWorkbook('xls'); bytes.writeUInt32LE(1, workbookEntry(bytes) + 124); return bytes; }],
    ['directory loop', () => { const bytes = normalWorkbook('xls'); const root = (bytes.readUInt32LE(48) + 1) * 512; bytes.writeUInt32LE(0, root + 76); return bytes; }],
    ['FAT loop', () => { const bytes = normalWorkbook('xls'); const directory = bytes.readUInt32LE(48), fat = (bytes.readUInt32LE(76) + 1) * 512; bytes.writeUInt32LE(directory, fat + directory * 4); return bytes; }],
    ['miniFAT loop', () => { const bytes = normalWorkbook('xls'); const first = bytes.readUInt32LE(workbookEntry(bytes) + 116), fat = (bytes.readUInt32LE(60) + 1) * 512; bytes.writeUInt32LE(first, fat + first * 4); return bytes; }],
    ['unowned cyclic sector', () => { const original = normalWorkbook('xls'), bytes = Buffer.concat([original, Buffer.alloc(512)]); const sector = original.length / 512 - 1, fat = (bytes.readUInt32LE(76) + 1) * 512; bytes.writeUInt32LE(sector, fat + sector * 4); return bytes; }],
    ['BIFF dimensions', () => { const bytes = rawWorkbook(); bytes.writeUInt32LE(REPORT_PARSE_HARD_LIMITS.maxRows + 1, record(bytes, 0x200) + 4); return bytes; }],
    ['SST declared count', () => { const bytes = rawWorkbook(); bytes.writeUInt32LE(REPORT_PARSE_HARD_LIMITS.maxCells + 1, record(bytes, 0xfc) + 4); return bytes; }],
    ['truncated BIFF record', () => rawWorkbook().subarray(0, 19)],
  ] as const)('%s 不能进入 XLSX.read', (_name, create) => {
    expect(() => readReportWorkbookBytes(create(), 'isolated.xls')).toThrow();
    expect(XLSX.read).not.toHaveBeenCalled(); expect(XLSX.utils.sheet_to_json).not.toHaveBeenCalled();
  });
  it('普通 XLS 与常见 Summary 属性仍通过真实第三方 reader', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['ASIN', 'Title'], ['B000000001', 'isolated']]), 'Report');
    workbook.Props = { Title: 'isolated', Author: 'isolated', Company: 'isolated' };
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' });
    expect(readReportWorkbookBytes(bytes, 'isolated.xls').SheetNames).toEqual(['Report']);
    expect(XLSX.read).toHaveBeenCalledTimes(1);
  });
});
