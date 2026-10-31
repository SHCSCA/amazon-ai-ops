import { rejectReport, type ReportResourceLimits } from './report-resource-policy';

export interface ReportZipEntry {
  readonly name: string; readonly start: number; readonly end: number;
  readonly compressedBytes: number; readonly expandedBytes: number; readonly crc: number; readonly method: number;
}
export function inspectReportZip(bytes: Buffer, limits: ReportResourceLimits): ReportZipEntry[] {
  const invalid = (): never => rejectReport('zip-envelope', 'REPORT_ARCHIVE_INVALID');
  if (bytes.length < 22) invalid();
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) {
      eocd = offset; break;
    }
  }
  if (eocd < 0 || bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) !== eocd
    || bytes.readUInt16LE(eocd + 4) || bytes.readUInt16LE(eocd + 6)) invalid();
  const count = bytes.readUInt16LE(eocd + 10), size = bytes.readUInt32LE(eocd + 12), start = bytes.readUInt32LE(eocd + 16);
  if (!count || count === 0xffff || size === 0xffffffff || start === 0xffffffff
    || count !== bytes.readUInt16LE(eocd + 8) || start + size !== eocd) invalid();
  if (count > limits.maxZipEntries) rejectReport('zip-entries');
  const entries: ReportZipEntry[] = [], names = new Set<string>(), directories = new Set<string>(), intervals: Array<[number, number]> = [];
  let cursor = start;
  const checkExtra = (offset: number, length: number) => {
    const end = offset + length;
    while (offset < end) {
      if (offset + 4 > end) invalid();
      const tag = bytes.readUInt16LE(offset), itemLength = bytes.readUInt16LE(offset + 2);
      if (tag === 1 || offset + 4 + itemLength > end) invalid();
      if (tag === 0x5455) {
        if (![1, 5, 9, 13].includes(itemLength)) invalid();
        const flags = bytes[offset + 4];
        const consumed = 1 + (flags & 1 ? 4 : 0) + (itemLength > 5 && flags & 2 ? 4 : 0) + (itemLength > 5 && flags & 4 ? 4 : 0);
        if (flags & ~7 || consumed > itemLength) invalid();
      }
      offset += 4 + itemLength;
    }
  };
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > eocd || bytes.readUInt32LE(cursor) !== 0x02014b50) invalid();
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16), compressedBytes = bytes.readUInt32LE(cursor + 20), expandedBytes = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    if (nameLength > limits.maxZipPathBytes) rejectReport('zip-path-bytes');
    const local = bytes.readUInt32LE(cursor + 42), next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > eocd || !nameLength || flags & ~0x080e || flags & 1 || ![0, 8].includes(method)
      || bytes.readUInt16LE(cursor + 34) || compressedBytes === 0xffffffff || expandedBytes === 0xffffffff || local === 0xffffffff) invalid();
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    const canonical = name.normalize('NFKC').toLowerCase(), parts = name.split('/');
    if (!Buffer.from(name, 'utf8').equals(nameBytes) || name !== name.normalize('NFKC') || /[\x00-\x1f\\:]/.test(name) || name.startsWith('/')
      || parts.some((part, partIndex) => part === '..' || part === '.' || (!part && partIndex !== parts.length - 1)) || names.has(canonical)) invalid();
    // CFB 的 local 名称按单字节读取；只接纳双方视图严格相同的内部路径。
    if (/[^\x20-\x7e]/.test(name)) rejectReport('zip-path-encoding', 'REPORT_FORMAT_UNSUPPORTED');
    if (parts.length > limits.maxZipPathDepth) rejectReport('zip-path-depth');
    for (let parent = 1; parent < parts.length; parent++) directories.add(parts.slice(0, parent).join('/').toLowerCase());
    if (directories.size > limits.maxZipDirectoryNodes) rejectReport('zip-directory-nodes');
    if (canonical === 'root entry' || canonical.startsWith('root entry/')
      || ['meta-inf/manifest.xml', 'objectdata.xml', 'index/document.iwa'].includes(canonical)) rejectReport('zip-format-dispatch', 'REPORT_FORMAT_UNSUPPORTED');
    if (/\.(?:bin|xlsb)$/i.test(name)) rejectReport('zip-binary-part', 'REPORT_FORMAT_UNSUPPORTED');
    names.add(canonical);
    checkExtra(cursor + 46 + nameLength, extraLength);
    if (local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50
      || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) invalid();
    const localNameLength = bytes.readUInt16LE(local + 26), localExtraLength = bytes.readUInt16LE(local + 28);
    const dataStart = local + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressedBytes;
    if (dataStart > start || dataEnd > start || localNameLength !== nameLength
      || !bytes.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes)) invalid();
    checkExtra(local + 30 + localNameLength, localExtraLength);
    const localCrc = bytes.readUInt32LE(local + 14), localCompressed = bytes.readUInt32LE(local + 18), localExpanded = bytes.readUInt32LE(local + 22);
    if (method === 0 && (flags & 6)) invalid();
    if (method === 0 && flags & 8 && (localCompressed !== compressedBytes || localExpanded !== expandedBytes)) rejectReport('zip-store-descriptor-view', 'REPORT_FORMAT_UNSUPPORTED');
    let recordEnd = dataEnd;
    if (flags & 8) {
      if ((localCrc && localCrc !== crc) || (localCompressed && localCompressed !== compressedBytes) || (localExpanded && localExpanded !== expandedBytes)) invalid();
      let descriptor = dataEnd;
      if (descriptor + 4 <= start && bytes.readUInt32LE(descriptor) === 0x08074b50) descriptor += 4;
      if (descriptor + 12 > start || bytes.readUInt32LE(descriptor) !== crc
        || bytes.readUInt32LE(descriptor + 4) !== compressedBytes || bytes.readUInt32LE(descriptor + 8) !== expandedBytes) invalid();
      recordEnd = descriptor + 12;
    } else if (localCrc !== crc || localCompressed !== compressedBytes || localExpanded !== expandedBytes) invalid();
    if (expandedBytes > limits.maxZipEntryBytes) rejectReport('zip-entry-declared');
    intervals.push([local, recordEnd]);
    entries.push({ name, start: dataStart, end: dataEnd, compressedBytes, expandedBytes, crc, method });
    cursor = next;
  }
  if (cursor !== eocd) invalid();
  intervals.sort((a, b) => a[0] - b[0]);
  // 拒绝未声明数据与重叠记录，避免底层解析器走不同字节流。
  if (intervals[0][0] !== 0 || intervals.at(-1)![1] !== start
    || intervals.some((value, index) => index > 0 && value[0] !== intervals[index - 1][1])) invalid();
  return entries;
}
