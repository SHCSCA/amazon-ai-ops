import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { assertLegacyXlsBudget } from './report-xls-budget';
import { normalWorkbook } from './report-resource.test-fixture';
import { REPORT_PARSE_HARD_LIMITS, resolveReportResourceLimits, type ReportResourceLimits } from './report-resource-policy';

const FREE = 0xffffffff, END = 0xfffffffe;
function rawWorkbook(bytes = normalWorkbook('xls')): Buffer {
  return Buffer.from(XLSX.CFB.read(bytes, { type: 'buffer' }).FileIndex.find((entry: { name: string }) => entry.name === 'Workbook')!.content!);
}
function records(bytes: Buffer): Array<{ id: number; offset: number; size: number }> {
  const result = [];
  for (let offset = 0; offset + 4 <= bytes.length;) {
    const id = bytes.readUInt16LE(offset), size = bytes.readUInt16LE(offset + 2);
    if (!id) break;
    result.push({ id, offset, size }); offset += 4 + size;
  }
  return result;
}
function mutateRecord(id: number, mutate: (data: Buffer) => void): Buffer {
  const bytes = rawWorkbook(), record = records(bytes).find(item => item.id === id)!;
  mutate(bytes.subarray(record.offset + 4, record.offset + 4 + record.size)); return bytes;
}
function directoryOffset(bytes: Buffer): number { return (bytes.readUInt32LE(48) + 1) * 512; }
function fatOffset(bytes: Buffer): number { return (bytes.readUInt32LE(76) + 1) * 512; }
function invalid(bytes: Uint8Array, limits: Partial<ReportResourceLimits> = {}): void {
  expect(() => assertLegacyXlsBudget(bytes, resolveReportResourceLimits(limits))).toThrow(/REPORT_(ARCHIVE_INVALID|RESOURCE_LIMIT|FORMAT_UNSUPPORTED)/);
}
function accepted(bytes: Uint8Array): void {
  try { assertLegacyXlsBudget(bytes, REPORT_PARSE_HARD_LIMITS); }
  catch (error) { throw new Error(`隔离正常 XLS 被拒绝：${JSON.stringify(error)}`, { cause: error }); }
}
function biffRecord(id: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4); head.writeUInt16LE(id, 0); head.writeUInt16LE(payload.length, 2); return Buffer.concat([head, payload]);
}
function replaceSst(parts: Buffer[]): Buffer {
  const original = rawWorkbook(), inventory = records(original), sst = inventory.find(item => item.id === 0xfc)!;
  const replacement = Buffer.concat(parts.map((part, index) => biffRecord(index ? 0x003c : 0x00fc, part)));
  const delta = replacement.length - sst.size - 4;
  const result = Buffer.concat([original.subarray(0, sst.offset), replacement, original.subarray(sst.offset + 4 + sst.size)]);
  for (const record of inventory.filter(item => item.id === 0x85)) result.writeUInt32LE(original.readUInt32LE(record.offset + 4) + delta, record.offset + 4);
  return result;
}
function smallSst(count = 3, flags = 0, suffix = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(11); header.writeUInt32LE(1, 0); header.writeUInt32LE(1, 4); header.writeUInt16LE(count, 8); header[10] = flags;
  return Buffer.concat([header, Buffer.from('abc'), suffix]);
}
function workbookWithProperties(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['日期', '金额'], ['2026-10-31', 12]]), '报表');
  workbook.Props = { Title: '隔离报表', Author: '测试', Company: '测试单位', Category: '业务报表', CreatedDate: new Date('2026-10-31T00:00:00Z') };
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xls' });
}
function mutateProperty(mutate: (bytes: Buffer) => void): Buffer {
  const cfb = XLSX.CFB.read(workbookWithProperties(), { type: 'buffer' });
  const entry = cfb.FileIndex.find((item: { name: string }) => item.name === '\u0005SummaryInformation')!;
  const value = Buffer.from(entry.content!); mutate(value);
  XLSX.CFB.utils.cfb_add(cfb, '/\u0005SummaryInformation', value);
  return XLSX.CFB.write(cfb, { type: 'buffer' }) as Buffer;
}
function versionFour(): Buffer {
  const raw = rawWorkbook(), bytes = Buffer.alloc(4 * 4096), header = bytes.subarray(0, 4096);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header); header.writeUInt16LE(0x3e, 24); header.writeUInt16LE(4, 26);
  header.writeUInt16LE(0xfffe, 28); header.writeUInt16LE(12, 30); header.writeUInt16LE(6, 32);
  header.writeUInt32LE(1, 40); header.writeUInt32LE(1, 44); header.writeUInt32LE(1, 48); header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(END, 60); header.writeUInt32LE(END, 68); header.fill(0xff, 76, 512); header.writeUInt32LE(0, 76);
  bytes.fill(0xff, 4096, 8192); bytes.writeUInt32LE(0xfffffffd, 4096); bytes.writeUInt32LE(END, 4100); bytes.writeUInt32LE(END, 4104);
  const directory = bytes.subarray(8192, 12288);
  for (let offset = 0; offset < directory.length; offset += 128) directory.fill(0xff, offset + 68, offset + 80);
  for (const [index, name, type] of [[0, 'Root Entry', 5], [1, 'Workbook', 2]] as const) {
    const entry = directory.subarray(index * 128, (index + 1) * 128), encoded = Buffer.from(`${name}\0`, 'utf16le');
    encoded.copy(entry); entry.writeUInt16LE(encoded.length, 64); entry[66] = type; entry[67] = 1;
    entry.writeUInt32LE(index ? 2 : END, 116); entry.writeUInt32LE(index ? 4096 : 0, 120);
    if (!index) entry.writeUInt32LE(1, 76);
  }
  raw.copy(bytes, 12288); return bytes;
}

describe('CFB 与 BIFF8 声明在解释之前受限', () => {
  it('保留普通小扇区、raw BIFF8、非 Buffer 视图以及大扇区 XLS', () => {
    const normal = normalWorkbook('xls'), wrapped = new Uint8Array(normal.length + 8); wrapped.set(normal, 4);
    for (const bytes of [normal, rawWorkbook(), wrapped.subarray(4, -4), versionFour()]) {
      accepted(bytes);
    }
  });
  it('保留实际普通扇区 Workbook 以及共享字符串 XLS', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(Array.from({ length: 500 }, (_, index) => [index, `行${index}`])), '数据');
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xls', bookSST: true });
    accepted(bytes);
  });
  it('保留实际超过 109 个 FAT 的正常 DIFAT 工作簿并拒绝其链循环', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(Array.from({ length: 1000 }, (_, index) => [`${index}:${'数'.repeat(4000)}`])), '隔离大报表');
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xls', bookSST: true });
    expect(bytes.readUInt32LE(44)).toBeGreaterThan(109); accepted(bytes);
    const mutated = Buffer.from(bytes), first = bytes.readUInt32LE(68);
    mutated.writeUInt32LE(first, (first + 1) * 512 + 508); invalid(mutated);
  });
  it('保留普通标题、作者、公司与日期属性，声明仍不能越过自身属性片段', () => {
    accepted(workbookWithProperties());
    for (const mutate of [
      (bytes: Buffer) => bytes.writeUInt32LE(0x7fffffff, 52),
      (bytes: Buffer) => bytes.writeUInt32LE(0x7fffffff, 48),
      (bytes: Buffer) => bytes.writeUInt32LE(1, 60),
      (bytes: Buffer) => { const start = 48 + bytes.readUInt32LE(68); bytes.writeUInt32LE(0x7fffffff, start + 4); },
    ]) invalid(mutateProperty(mutate));
  });
  it.each([
    ['FAT 伪大数量', (bytes: Buffer) => bytes.writeUInt32LE(0x7fffffff, 44)],
    ['MiniFAT 伪大数量', (bytes: Buffer) => bytes.writeUInt32LE(0x7fffffff, 64)],
    ['DIFAT 伪大数量', (bytes: Buffer) => bytes.writeUInt32LE(0x7fffffff, 72)],
    ['DIFAT 循环', (bytes: Buffer) => { bytes.writeUInt32LE(1, 72); bytes.writeUInt32LE(0, 68); }],
    ['FAT 地址越界', (bytes: Buffer) => bytes.writeUInt32LE(0xffffff00, 76)],
    ['重复 FAT', (bytes: Buffer) => { bytes.writeUInt32LE(2, 44); bytes.writeUInt32LE(0, 80); }],
    ['FAT 标记错误', (bytes: Buffer) => bytes.writeUInt32LE(END, fatOffset(bytes))],
    ['目录链循环', (bytes: Buffer) => { const id = bytes.readUInt32LE(48); bytes.writeUInt32LE(id, fatOffset(bytes) + id * 4); }],
    ['目录扇区伪大数量', (bytes: Buffer) => bytes.writeUInt32LE(1000, 40)],
    ['MiniFAT 链循环', (bytes: Buffer) => { const id = bytes.readUInt32LE(60); bytes.writeUInt32LE(id, fatOffset(bytes) + id * 4); }],
    ['目录指针循环', (bytes: Buffer) => bytes.writeUInt32LE(1, directoryOffset(bytes) + 128 + 72)],
    ['目录指针越界', (bytes: Buffer) => bytes.writeUInt32LE(500, directoryOffset(bytes) + 76)],
    ['目录伪大 stream', (bytes: Buffer) => bytes.writeUInt32LE(0x7fffffff, directoryOffset(bytes) + 256 + 120)],
    ['64 位 stream 高字', (bytes: Buffer) => bytes.writeUInt32LE(1, directoryOffset(bytes) + 256 + 124)],
    ['mini stream 伪大尺寸', (bytes: Buffer) => bytes.writeUInt32LE(0x10000000, directoryOffset(bytes) + 120)],
    ['mini stream 短链', (bytes: Buffer) => bytes.writeUInt32LE(END, directoryOffset(bytes) + 116)],
    ['mini chain 循环', (bytes: Buffer) => { const base = (bytes.readUInt32LE(60) + 1) * 512; bytes.writeUInt32LE(1, base + 4); }],
    ['mini stream 越界', (bytes: Buffer) => bytes.writeUInt32LE(5000, directoryOffset(bytes) + 256 + 116)],
    ['mini chain 交叉引用', (bytes: Buffer) => bytes.writeUInt32LE(0, directoryOffset(bytes) + 256 + 116)],
    ['旁流别名', (bytes: Buffer) => { const entry = directoryOffset(bytes) + 128; bytes.fill(0, entry, entry + 64); const name = Buffer.from('\u0001CompObj\0', 'utf16le'); name.copy(bytes, entry); bytes.writeUInt16LE(name.length, entry + 64); }],
  ] as const)('拒绝 %s', (_label, mutate) => { const bytes = normalWorkbook('xls'); mutate(bytes); invalid(bytes); });
  it('拒绝 regular stream 的环、跨链和失配长度', () => {
    for (const change of [0, 1, 2]) { const bytes = versionFour(); bytes.writeUInt32LE(change, 4104); invalid(bytes); }
  });
  it('合法无环逆序链也要核真实 SheetJS 后缀复制量', () => {
    const bytes = normalWorkbook('xls'), original = Buffer.from(bytes), directory = directoryOffset(bytes), fat = fatOffset(bytes);
    const rootStart = bytes.readUInt32LE(directory + 116);
    expect(bytes.readUInt32LE(directory + 120)).toBeGreaterThan(1024);
    for (let index = 0; index < 3; index++) original.copy(bytes, (rootStart + 3 - index) * 512, (rootStart + 1 + index) * 512, (rootStart + 2 + index) * 512);
    bytes.writeUInt32LE(rootStart + 2, directory + 116);
    bytes.writeUInt32LE(END, fat + rootStart * 4); bytes.writeUInt32LE(rootStart, fat + (rootStart + 1) * 4); bytes.writeUInt32LE(rootStart + 1, fat + (rootStart + 2) * 4);
    accepted(bytes);
    expect(() => assertLegacyXlsBudget(normalWorkbook('xls'), resolveReportResourceLimits({ maxZipTotalBytes: 4000 }))).not.toThrow();
    expect(() => assertLegacyXlsBudget(bytes, resolveReportResourceLimits({ maxZipTotalBytes: 4000 }))).toThrow(/REPORT_RESOURCE_LIMIT/);
  });
  it('CFB.find 的所有控制字符别名均不能绕过旁流预检', () => {
    for (let prefix = 1; prefix <= 6; prefix++) {
      const bytes = normalWorkbook('xls'), entry = directoryOffset(bytes) + 128;
      bytes.fill(0, entry, entry + 64); const name = Buffer.from(`${String.fromCharCode(prefix)}CompObj\0`, 'utf16le');
      name.copy(bytes, entry); bytes.writeUInt16LE(name.length, entry + 64); invalid(bytes);
    }
  });
  it('root 与 storage 也不能被不带路径的 CompObj 查找命中', () => {
    for (const index of [0, 1]) {
      const bytes = normalWorkbook('xls'), entry = directoryOffset(bytes) + index * 128;
      bytes.fill(0, entry, entry + 64); const name = Buffer.from('\u0002CompObj\0', 'utf16le');
      name.copy(bytes, entry); bytes.writeUInt16LE(name.length, entry + 64);
      if (index) { bytes[entry + 66] = 1; bytes.writeUInt32LE(0, entry + 120); }
      invalid(bytes);
    }
  });
  it('root 保留名按底层相同大小写规则在纯前置模块拒绝', () => {
    for (const name of ['EncryptedPackage', 'ENCRYPTEDPACKAGE', 'encryptedpackage', 'eNcRyPtEdPaCkAgE']) {
      const bytes = normalWorkbook('xls'), root = directoryOffset(bytes), encoded = Buffer.from(`${name}\0`, 'utf16le');
      bytes.fill(0, root, root + 64); encoded.copy(bytes, root); bytes.writeUInt16LE(encoded.length, root + 64);
      expect(() => assertLegacyXlsBudget(bytes, REPORT_PARSE_HARD_LIMITS)).toThrow(/REPORT_FORMAT_UNSUPPORTED/);
    }
  });
  it('拒绝目录、单流和总流预算', () => {
    invalid(normalWorkbook('xls'), { maxZipEntries: 3 });
    invalid(normalWorkbook('xls'), { maxZipEntryBytes: 1024 });
    invalid(normalWorkbook('xls'), { maxZipTotalBytes: 1024 });
  });
  it.each([
    ['DIMENSIONS 大行', 0x0200, (data: Buffer) => data.writeUInt32LE(0x7fffffff, 4)],
    ['DIMENSIONS 大列', 0x0200, (data: Buffer) => data.writeUInt16LE(1000, 10)],
    ['DIMENSIONS 逆序', 0x0200, (data: Buffer) => data.writeUInt32LE(100, 0)],
    ['真实 cell 超列', 0x0204, (data: Buffer) => data.writeUInt16LE(300, 2)],
    ['cell 文本伪大', 0x0204, (data: Buffer) => data.writeUInt16LE(0x7fff, 6)],
    ['SST 伪大数量', 0x00fc, (data: Buffer) => data.writeUInt32LE(0x7fffffff, 4)],
    ['SST 负引用数', 0x00fc, (data: Buffer) => data.writeUInt32LE(0xffffffff, 0)],
    ['WriteAccess 字符声明越界', 0x005c, (data: Buffer) => data.writeUInt16LE(0xffff, 0)],
    ['sheet 指针越界', 0x0085, (data: Buffer) => data.writeUInt32LE(0x7fffffff, 0)],
    ['宏 sheet', 0x0085, (data: Buffer) => { data[5] = 1; }],
  ] as const)('拒绝 %s', (_label, id, mutate) => { invalid(mutateRecord(id, mutate)); });
  it('拒绝旧 BIFF、加密、公式、截断和孤立 Continue', () => {
    const bytes = rawWorkbook(); bytes.writeUInt16LE(0x0500, 4); invalid(bytes);
    for (const id of [0x002f, 0x0006, 0x003c]) { const mutated = rawWorkbook(); mutated.writeUInt16LE(id, 20); invalid(mutated); }
    const truncated = rawWorkbook(); truncated.writeUInt16LE(8225, 2); invalid(truncated); invalid(rawWorkbook().subarray(0, -1));
  });
  it('零填充后藏记录直接拒绝，不逐记录反复扫描零区域', () => {
    const bytes = rawWorkbook(), bof = bytes.subarray(0, 20);
    invalid(Buffer.concat([bof, Buffer.alloc(1024 * 1024), biffRecord(0x000a, Buffer.alloc(0))]));
  });
  it('实际稀疏矩形、cell 数和文本预算不能依赖 DIMENSIONS 声明', () => {
    invalid(rawWorkbook(), { maxRangeCells: 5 }); invalid(rawWorkbook(), { maxCells: 5 });
    invalid(rawWorkbook(), { maxCellTextChars: 9 }); invalid(rawWorkbook(), { maxTextBytes: 32 });
    const bytes = mutateRecord(0x0204, data => data.writeUInt16LE(65000, 0)); invalid(bytes, { maxRangeCells: 100_000 });
  });
  it('SST 连续段真实字符边界、富文本长度及尾部必须一致', () => {
    expect(() => assertLegacyXlsBudget(replaceSst([smallSst()]), REPORT_PARSE_HARD_LIMITS)).not.toThrow();
    const header = smallSst().subarray(0, 11);
    expect(() => assertLegacyXlsBudget(replaceSst([Buffer.concat([header, Buffer.from('a')]), Buffer.from([0, 98, 99])]), REPORT_PARSE_HARD_LIMITS)).not.toThrow();
    for (const parts of [
      [Buffer.concat([header, Buffer.from('a')]), Buffer.from([2, 98, 99])],
      [smallSst(300)], [smallSst(3, 8)], [smallSst(3, 4)], [smallSst(3, 0, Buffer.from([1]))],
    ]) invalid(replaceSst(parts));
  });
});
