import * as XLSX from 'xlsx';
import { crc32, deflateRawSync } from 'node:zlib';
import { expandReportZip } from './report-zip-content';
import { REPORT_PARSE_HARD_LIMITS } from './report-resource-policy';

export interface ZipFixtureOptions {
  compression?: boolean; descriptor?: boolean; flags?: number; method?: number;
  declaredSize?: number; crcDelta?: number; trailingDeflateBytes?: boolean;
  extra?: Buffer;
}
export function zipFixture(entries: Array<[string, Buffer]>, options: ZipFixtureOptions = {}): Buffer {
  const localParts: Buffer[] = [], centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name), extra = options.extra ?? Buffer.alloc(0), method = options.method ?? (options.compression ? 8 : 0);
    let packed = options.compression ? deflateRawSync(content) : content;
    if (options.trailingDeflateBytes) packed = Buffer.concat([packed, Buffer.from('tail')]);
    const crc = (crc32(content) + (options.crcDelta ?? 0)) >>> 0;
    const flags = options.flags ?? (options.descriptor ? 8 : 0), expanded = options.declaredSize ?? content.length;
    const local = Buffer.alloc(30 + nameBytes.length + extra.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    if (!options.descriptor) { local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(expanded, 22); }
    local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(extra.length, 28); nameBytes.copy(local, 30); extra.copy(local, 30 + nameBytes.length);
    const descriptor = options.descriptor ? Buffer.alloc(16) : Buffer.alloc(0);
    if (options.descriptor) {
      descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(packed.length, 8); descriptor.writeUInt32LE(expanded, 12);
    }
    const central = Buffer.alloc(46 + nameBytes.length + extra.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(expanded, 24);
    central.writeUInt16LE(nameBytes.length, 28); central.writeUInt16LE(extra.length, 30); central.writeUInt32LE(offset, 42); nameBytes.copy(central, 46); extra.copy(central, 46 + nameBytes.length);
    localParts.push(local, packed, descriptor); centralParts.push(central);
    offset += local.length + packed.length + descriptor.length;
  }
  const directory = Buffer.concat(centralParts), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, directory, end]);
}
export function normalWorkbook(bookType: 'xlsx' | 'xls' = 'xlsx', compression = false): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['date', 'asin', 'cost'], ['2026-10-01', 'B000000001', 1]]), 'Report');
  return XLSX.write(workbook, { type: 'buffer', bookType, compression });
}
export function normalEntries(): Array<[string, Buffer]> {
  return [...expandReportZip(normalWorkbook(), REPORT_PARSE_HARD_LIMITS)].map(([name, bytes]) => [name, Buffer.from(bytes)]);
}
export function xmlMutation(part: string, change: (xml: string) => string): Buffer {
  const entries = normalEntries();
  const entry = entries.find(([name]) => name === part);
  if (!entry) throw new Error('隔离工作簿缺少待修改部件。');
  entry[1] = Buffer.from(change(entry[1].toString('utf8')));
  return zipFixture(entries);
}
