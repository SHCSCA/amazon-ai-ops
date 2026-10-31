import { reportCrc32 } from './report-zip-content';
import { rejectReport, resolveReportResourceLimits, type ReportResourceLimits } from './report-resource-policy';

interface StoredPart { name: Buffer; bytes: Buffer; offset: number; crc: number }

export function normalizedReportZipCapacity(content: ReadonlyMap<string, Buffer>, limits: ReportResourceLimits): number {
  limits = resolveReportResourceLimits(limits);
  if (!content.size || content.size > limits.maxZipEntries) rejectReport('normalized-zip-entries');
  let capacity = 22, totalBytes = 0;
  for (const [name, bytes] of content) {
    if (typeof name !== 'string' || !/^[\x20-\x7e]+$/.test(name) || Buffer.byteLength(name) > limits.maxZipPathBytes
      || !Buffer.isBuffer(bytes) || bytes.length > limits.maxZipEntryBytes) rejectReport('normalized-zip-part');
    totalBytes += bytes.length;
    capacity += 30 + 46 + 2 * Buffer.byteLength(name) + bytes.length;
    if (!Number.isSafeInteger(capacity) || totalBytes > limits.maxZipTotalBytes || capacity > limits.maxNormalizedZipBytes
      || capacity > 0xffffffff) rejectReport('normalized-zip-capacity');
  }
  return capacity;
}

export function buildNormalizedReportZip(content: ReadonlyMap<string, Buffer>, limits: ReportResourceLimits): Buffer {
  // 容量证明先于分配；这个派生容器永远不替代原文件、摘要或来源记录。
  const capacity = normalizedReportZipCapacity(content, limits), output = Buffer.alloc(capacity), parts: StoredPart[] = [];
  let cursor = 0;
  for (const [name, bytes] of content) {
    const encoded = Buffer.from(name, 'ascii'), crc = reportCrc32(bytes), offset = cursor;
    output.writeUInt32LE(0x04034b50, cursor); output.writeUInt16LE(20, cursor + 4);
    output.writeUInt16LE(0x0021, cursor + 12);
    output.writeUInt32LE(crc, cursor + 14); output.writeUInt32LE(bytes.length, cursor + 18); output.writeUInt32LE(bytes.length, cursor + 22);
    output.writeUInt16LE(encoded.length, cursor + 26); encoded.copy(output, cursor + 30); bytes.copy(output, cursor + 30 + encoded.length);
    cursor += 30 + encoded.length + bytes.length;
    parts.push({ name: encoded, bytes, offset, crc });
  }
  const directoryStart = cursor;
  for (const part of parts) {
    output.writeUInt32LE(0x02014b50, cursor); output.writeUInt16LE(20, cursor + 4); output.writeUInt16LE(20, cursor + 6);
    output.writeUInt16LE(0x0021, cursor + 14);
    output.writeUInt32LE(part.crc, cursor + 16); output.writeUInt32LE(part.bytes.length, cursor + 20); output.writeUInt32LE(part.bytes.length, cursor + 24);
    output.writeUInt16LE(part.name.length, cursor + 28); output.writeUInt32LE(part.offset, cursor + 42); part.name.copy(output, cursor + 46);
    cursor += 46 + part.name.length;
  }
  output.writeUInt32LE(0x06054b50, cursor); output.writeUInt16LE(parts.length, cursor + 8); output.writeUInt16LE(parts.length, cursor + 10);
  output.writeUInt32LE(cursor - directoryStart, cursor + 12); output.writeUInt32LE(directoryStart, cursor + 16);
  if (cursor + 22 !== capacity) rejectReport('normalized-zip-write', 'REPORT_ARCHIVE_INVALID');
  if (output.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) !== cursor) rejectReport('normalized-zip-end-view', 'REPORT_ARCHIVE_INVALID');
  return output;
}
