import { inflateRawSync } from 'node:zlib';
import { inspectReportZip } from './report-zip-envelope';
import { rejectReport, type ReportResourceLimits } from './report-resource-policy';

const CRC_TABLE = Object.freeze(Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
}));
export function reportCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) crc = CRC_TABLE[(crc ^ value) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}
export function expandReportZip(bytes: Buffer, limits: ReportResourceLimits): Map<string, Buffer> {
  const entries = inspectReportZip(bytes, limits), content = new Map<string, Buffer>();
  let total = 0, compressed = 0;
  for (const entry of entries) {
    const maximum = Math.min(limits.maxZipEntryBytes, limits.maxZipTotalBytes - total);
    if (maximum < 0) rejectReport('zip-total-expanded');
    let expanded: Buffer;
    if (entry.method === 0) expanded = bytes.subarray(entry.start, entry.end);
    else {
      try {
        const result = inflateRawSync(bytes.subarray(entry.start, entry.end), { maxOutputLength: Math.max(1, maximum), info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
        if (result.engine.bytesWritten !== entry.compressedBytes) rejectReport('zip-deflate-trailing', 'REPORT_ARCHIVE_INVALID');
        expanded = result.buffer;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') rejectReport('zip-entry-expanded');
        throw error;
      }
    }
    if (expanded.length > maximum) rejectReport('zip-entry-expanded');
    total += expanded.length; compressed += entry.compressedBytes;
    if (expanded.length > entry.compressedBytes * limits.maxZipExpansionRatio
      || total > compressed * limits.maxZipExpansionRatio) rejectReport('zip-expansion-ratio');
    if (expanded.length !== entry.expandedBytes || reportCrc32(expanded) !== entry.crc) rejectReport('zip-crc-or-size', 'REPORT_ARCHIVE_INVALID');
    content.set(entry.name, expanded);
  }
  if (!content.has('[Content_Types].xml') || !content.has('xl/workbook.xml')) rejectReport('ooxml-parts', 'REPORT_FORMAT_UNSUPPORTED');
  return content;
}
