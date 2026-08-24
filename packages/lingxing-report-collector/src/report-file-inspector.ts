import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import type { LingxingReportType } from '@amazon-ai-ops/shared-types';

const COLUMN_ALIASES = {
  date: ['日期', '日期范围', '数据日期', 'date', 'reportdate'],
  metric: [
    '展现量', '展示量', '曝光量', 'impressions',
    '点击', '点击量', 'clicks',
    '花费', '花费金额', '消耗', '花费本币', 'cost', 'spend',
    '订单', '订单数', '广告订单', 'orders',
    '销售额', '广告销售额本币', 'sales', 'revenue',
  ],
  campaign: ['广告活动', '广告活动名称', 'campaign', 'campaignname'],
  adGroup: ['广告组', '广告组名称', 'adgroup', 'adgroupname'],
  placement: ['广告位', '广告位名称', '投放位置', 'placement', 'placementname'],
  advertisedProduct: [
    '推广的商品', '推广商品', '广告商品', '广告asin', '推广asin',
    'advertisedproduct', 'advertisedasin', 'advertisedsku', 'asin',
  ],
  autoTargeting: [
    '自动投放', '自动定向', '自动投放类型', '自动投放组',
    'autotargeting', 'autotarget', 'autotargetinggroup',
  ],
  keyword: ['关键词', '投放关键词', 'keyword', 'keywordtext'],
  productTargeting: [
    '商品投放', '商品定位', 'asin投放', '投放表达式',
    'producttargeting', 'targetingexpression',
  ],
  searchTerm: [
    '用户搜索词', '客户搜索词', '搜索词',
    'searchterm', 'customersearchterm', 'searchquery',
  ],
} as const;

const ALL_HEADER_ALIASES = Object.values(COLUMN_ALIASES).flat();
const GENERIC_TARGETING_HEADERS = ['投放', 'targeting', 'target'] as const;
const AUTO_TARGETING_PROVIDER_VALUES = new Set([
  '紧密匹配',
  '宽泛匹配',
  '同类商品',
  '关联商品',
  'closematch',
  'loosematch',
  'substitutes',
  'complements',
].map(normalizeHeader));
const PRODUCT_TARGETING_PROVIDER_VALUE = /^商品\s*[:：]\s*["“”]?B0[A-Z0-9]{8}["“”]?$/i;

export interface ReportContentInspection {
  readable: boolean;
  matched: boolean;
  matchedTokens: string[];
  sampledText: string;
  headers?: string[];
  inferredReportType?: LingxingReportType;
  errorMessage?: string;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-()/（）【】[\]{}:：,，.。]+/g, '');
}

function hasAlias(headers: ReadonlySet<string>, aliases: readonly string[]): boolean {
  return aliases.some((alias) => headers.has(normalizeHeader(alias)));
}

function matchingHeaders(headers: readonly string[], aliases: readonly string[]): string[] {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  return headers.filter((header) => normalizedAliases.has(normalizeHeader(header)));
}

function readWorkbookRows(filePath: string): unknown[][] {
  // XLSX handles CSV, XLS and XLSX through the same row model and correctly
  // preserves quoted CSV headers. Reading only the first sheet is deliberate:
  // Lingxing exports one report per workbook.
  const extension = path.extname(filePath).toLowerCase();
  const workbook = extension === '.csv' || extension === '.txt' || extension === '.tsv'
    ? XLSX.read(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''), { type: 'string' })
    : XLSX.readFile(filePath, { cellDates: false, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const worksheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  }).slice(0, 12);
}

function selectSemanticHeaderRow(
  rows: readonly unknown[][],
): { headers: string[]; rowIndex: number } {
  let best: { headers: string[]; rowIndex: number; score: number } = {
    headers: [],
    rowIndex: -1,
    score: 0,
  };
  const known = new Set(ALL_HEADER_ALIASES.map(normalizeHeader));
  for (const [rowIndex, row] of rows.entries()) {
    const headers = row
      .slice(0, 80)
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);
    const score = headers.reduce(
      (total, header) => total + (known.has(normalizeHeader(header)) ? 1 : 0),
      0,
    );
    if (score > best.score) best = { headers, rowIndex, score };
  }
  return { headers: best.headers, rowIndex: best.rowIndex };
}

function inferGenericAutoTargetingFromRows(
  rows: readonly unknown[][],
  headers: readonly string[],
  headerRowIndex: number,
): LingxingReportType | undefined {
  const genericTargetingHeaders = new Set(GENERIC_TARGETING_HEADERS.map(normalizeHeader));
  const targetingColumnIndex = headers.findIndex((header) => (
    genericTargetingHeaders.has(normalizeHeader(header))
  ));
  if (targetingColumnIndex < 0 || headerRowIndex < 0) return undefined;

  const values = rows
    .slice(headerRowIndex + 1)
    .map((row) => normalizeHeader(row[targetingColumnIndex]))
    .filter(Boolean);
  if (values.length === 0) return undefined;
  return values.every((value) => AUTO_TARGETING_PROVIDER_VALUES.has(value))
    ? 'auto_targeting'
    : undefined;
}

function inferGenericProductTargetingFromRows(
  rows: readonly unknown[][],
  headers: readonly string[],
  headerRowIndex: number,
): LingxingReportType | undefined {
  const genericTargetingHeaders = new Set(GENERIC_TARGETING_HEADERS.map(normalizeHeader));
  const targetingColumnIndex = headers.findIndex((header) => (
    genericTargetingHeaders.has(normalizeHeader(header))
  ));
  if (targetingColumnIndex < 0 || headerRowIndex < 0) return undefined;

  const values = rows
    .slice(headerRowIndex + 1)
    .map((row) => String(row[targetingColumnIndex] ?? '').trim())
    .filter(Boolean);
  if (values.length === 0) return undefined;
  return values.every((value) => PRODUCT_TARGETING_PROVIDER_VALUE.test(value))
    ? 'product_targeting'
    : undefined;
}

/**
 * Infer one Lingxing report type from column semantics only. Filenames,
 * workbook titles and data cell values are intentionally excluded.
 */
export function inferLingxingReportTypeFromHeaders(
  rawHeaders: readonly string[],
): LingxingReportType | undefined {
  const headers = new Set(rawHeaders.map(normalizeHeader).filter(Boolean));
  const hasDate = hasAlias(headers, COLUMN_ALIASES.date);
  const hasMetric = hasAlias(headers, COLUMN_ALIASES.metric);
  if (!hasDate || !hasMetric) return undefined;

  // Choose the most granular dimension first. Lower-level reports normally
  // retain campaign/ad-group columns, so those parent columns cannot identify
  // a report when a more specific semantic column is present.
  if (hasAlias(headers, COLUMN_ALIASES.searchTerm)) return 'user_search_term';
  if (hasAlias(headers, COLUMN_ALIASES.placement)) return 'placement';
  if (hasAlias(headers, COLUMN_ALIASES.autoTargeting)) return 'auto_targeting';
  if (hasAlias(headers, COLUMN_ALIASES.productTargeting)) return 'product_targeting';
  if (hasAlias(headers, COLUMN_ALIASES.keyword)) return 'keyword';
  if (hasAlias(headers, COLUMN_ALIASES.advertisedProduct)) return 'advertised_product';
  if (hasAlias(headers, COLUMN_ALIASES.adGroup)) return 'ad_group';
  if (hasAlias(headers, COLUMN_ALIASES.campaign)) return 'campaign';
  return undefined;
}

function aliasesForReportType(reportType: LingxingReportType): readonly string[] {
  switch (reportType) {
    case 'campaign': return COLUMN_ALIASES.campaign;
    case 'ad_group': return COLUMN_ALIASES.adGroup;
    case 'placement': return COLUMN_ALIASES.placement;
    case 'advertised_product': return COLUMN_ALIASES.advertisedProduct;
    case 'auto_targeting': return COLUMN_ALIASES.autoTargeting;
    case 'keyword': return COLUMN_ALIASES.keyword;
    case 'product_targeting': return COLUMN_ALIASES.productTargeting;
    case 'user_search_term': return COLUMN_ALIASES.searchTerm;
  }
}

export function inspectReportFileContent(
  filePath: string,
  expectedReportType: LingxingReportType,
): ReportContentInspection {
  try {
    if (!fs.existsSync(filePath)) throw new Error('file does not exist');
    const rows = readWorkbookRows(filePath);
    const { headers, rowIndex: headerRowIndex } = selectSemanticHeaderRow(rows);
    const headerReportType = inferLingxingReportTypeFromHeaders(headers);
    const genericAutoTargetingType = inferGenericAutoTargetingFromRows(
      rows,
      headers,
      headerRowIndex,
    );
    const genericProductTargetingType = inferGenericProductTargetingFromRows(
      rows,
      headers,
      headerRowIndex,
    );
    const genericTargetingType = genericAutoTargetingType ?? genericProductTargetingType;
    const inferredReportType = genericTargetingType
      && (!headerReportType || headerReportType === 'campaign' || headerReportType === 'ad_group')
      ? genericTargetingType
      : headerReportType;
    const sampledText = rows
      .flatMap((row) => row.slice(0, 40))
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
      .join(' | ');
    const matchedTokens = matchingHeaders(
      headers,
      (expectedReportType === 'auto_targeting' && inferredReportType === 'auto_targeting')
        || (expectedReportType === 'product_targeting' && inferredReportType === 'product_targeting')
        ? [...aliasesForReportType(expectedReportType), ...GENERIC_TARGETING_HEADERS]
        : aliasesForReportType(expectedReportType),
    );
    return {
      readable: true,
      matched: inferredReportType === expectedReportType,
      matchedTokens,
      sampledText,
      headers,
      ...(inferredReportType ? { inferredReportType } : {}),
    };
  } catch (error) {
    return {
      readable: false,
      matched: false,
      matchedTokens: [],
      sampledText: '',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
