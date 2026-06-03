import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import type { ListingContent } from '@amazon-ai-ops/shared-types';

export interface ParseListingContentOptions {
  fieldMappingsDir?: string;
  fieldMapping?: Record<string, string[]>;
}

const DEFAULT_FIELD_ALIASES: Record<string, string[]> = {
  asin: ['asin', 'ASIN'],
  title: ['title', 'Title', '标题'],
  bullets: ['bullets', 'Bullet Points', 'Bullets', '五点', '卖点'],
  aPlus: ['aPlus', 'A+', 'A Plus', 'A+ 页面'],
  imageCopy: ['imageCopy', 'Image Copy', '图片文案'],
  backendTerms: ['backendTerms', 'Backend Search Terms', '后台搜索词'],
};

export function parseListingContent(
  filePath: string,
  options: ParseListingContentOptions = {},
): ListingContent {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath, { type: 'file' });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
  const row = rows.find((item) => Object.values(item).some((value) => String(value ?? '').trim()));
  if (!row) {
    throw new Error('Listing file has no data rows');
  }

  const fieldAliases = buildFieldAliases(options);
  const listing = {
    asin: textField(row, 'asin', fieldAliases),
    title: textField(row, 'title', fieldAliases),
    bullets: splitBullets(textField(row, 'bullets', fieldAliases)),
    aPlus: textField(row, 'aPlus', fieldAliases),
    imageCopy: textField(row, 'imageCopy', fieldAliases),
    backendTerms: textField(row, 'backendTerms', fieldAliases),
  };

  if (!listing.asin || !listing.title) {
    throw new Error('Listing file must include ASIN and title');
  }

  return listing;
}

function textField(row: Record<string, unknown>, canonical: string, fieldAliases: Record<string, string[]>): string {
  const value = lookup(row, canonical, fieldAliases);
  return String(value ?? '').trim();
}

function splitBullets(value: string): string[] {
  return value
    .split(/\r?\n|[|；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function lookup(row: Record<string, unknown>, canonical: string, fieldAliases: Record<string, string[]>): unknown {
  const aliases = fieldAliases[canonical] ?? [canonical];
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) {
      return row[alias];
    }
  }

  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliases.has(normalizeHeader(key))) {
      return value;
    }
  }

  return undefined;
}

function buildFieldAliases(options: ParseListingContentOptions): Record<string, string[]> {
  return mergeAliases(
    DEFAULT_FIELD_ALIASES,
    loadMappingFromDir(options.fieldMappingsDir),
    options.fieldMapping,
  );
}

function loadMappingFromDir(fieldMappingsDir?: string): Record<string, string[]> | undefined {
  if (!fieldMappingsDir) return undefined;
  const filePath = path.join(fieldMappingsDir, 'listing-content-mapping.json');
  if (!fs.existsSync(filePath)) return undefined;

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  const mapping: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (Array.isArray(value)) {
      mapping[key] = value.map((item) => String(item));
    }
  }
  return mapping;
}

function mergeAliases(...mappings: Array<Record<string, string[]> | undefined>): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const mapping of mappings) {
    if (!mapping) continue;
    for (const [key, aliases] of Object.entries(mapping)) {
      merged[key] = Array.from(new Set([...(merged[key] ?? []), ...aliases, key]));
    }
  }
  return merged;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[\s_\-()（）]/g, '');
}
