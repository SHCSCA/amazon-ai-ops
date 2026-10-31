import * as fs from 'node:fs';
import * as path from 'node:path';
import { captureReportSource } from './report-parser-source';
import { getBundledResourcesPath } from './main-store-access-runtime';

export function loadFixedReportFieldMapping(kind: 'search_term' | 'sqp' | 'keyword_report' | 'manual' | 'listing'): Record<string, string[]> | undefined {
  const names = { search_term: 'search-term-report-mapping.json', sqp: 'sqp-report-mapping.json',
    keyword_report: 'lingxing-ad-report-mapping.json', listing: 'listing-content-mapping.json', manual: undefined };
  const name = names[kind];
  if (!name) return undefined;
  const file = path.join(getBundledResourcesPath(), 'field-mappings', name);
  if (!fs.existsSync(file)) return undefined;
  const snapshot = captureReportSource(file, 256 * 1024);
  const parsed = JSON.parse(new TextDecoder().decode(snapshot.bytes));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('REPORT_MAPPING_INVALID');
  const result: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (Array.isArray(value)) result[key] = value.map(item => String(item));
  }
  return result;
}
