import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import type { KeywordMetric } from '@amazon-ai-ops/shared-types';

export interface ParseKeywordMetricsOptions {
  source?: KeywordMetric['source'];
  fieldMappingsDir?: string;
  fieldMapping?: Record<string, string[]>;
  maxInvalidRowRatio?: number;
}

export interface KeywordMetricParseIssue {
  row: number;
  field?: string;
  severity: 'error' | 'warning';
  message: string;
  value?: unknown;
}

export interface KeywordMetricParseDiagnostics {
  totalRows: number;
  parsedRows: number;
  invalidRows: number;
  invalidRowRatio: number;
  errors: KeywordMetricParseIssue[];
  warnings: KeywordMetricParseIssue[];
}

export interface KeywordMetricParseResult {
  metrics: KeywordMetric[];
  diagnostics: KeywordMetricParseDiagnostics;
}

const DIAGNOSTIC_EXPORT_HEADERS = ['severity', 'row', 'field', 'message', 'value'];

const DEFAULT_FIELD_ALIASES: Record<string, string[]> = {
  asin: ['asin', 'ASIN', '广告ASIN', '商品ASIN'],
  rawKeyword: ['rawKeyword', 'Search Term', 'Customer Search Term', 'Search Query', 'Keyword', 'Targeting', '搜索词', '用户搜索词', '搜索查询', '关键词', '投放'],
  impressions: ['impressions', 'Impressions', '曝光', '展现'],
  clicks: ['clicks', 'Clicks', '点击'],
  cost: ['cost', 'Spend', 'Cost', '花费', '广告花费'],
  orders: ['orders', 'Orders', 'Purchases', '订单', '购买'],
  sales: ['sales', 'Sales', '销售额', '销售'],
  acos: ['acos', 'ACOS'],
  cvr: ['cvr', 'CVR', 'Purchase Rate', '购买率', '转化率'],
};

export function parseKeywordMetrics(
  filePath: string,
  options: ParseKeywordMetricsOptions = {},
): KeywordMetric[] {
  return parseKeywordMetricsWithDiagnostics(filePath, options).metrics;
}

export function parseKeywordMetricsWithDiagnostics(
  filePath: string,
  options: ParseKeywordMetricsOptions = {},
): KeywordMetricParseResult {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath, { type: 'file' });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
  const source = options.source ?? inferKeywordMetricSource(filePath);
  const fieldAliases = buildFieldAliases(source, options);
  const nonEmptyRows = rows
    .map((row, index) => ({ row, sourceRow: index + 2 }))
    .filter(({ row }) => rowHasData(row));

  assertCriticalColumnsPresent(nonEmptyRows.map(({ row }) => row), fieldAliases);

  const errors: KeywordMetricParseIssue[] = [];
  const warnings: KeywordMetricParseIssue[] = [];
  const invalidRowNumbers = new Set<number>();
  const metrics: KeywordMetric[] = [];

  collectMissingOptionalFieldWarnings(nonEmptyRows.map(({ row }) => row), source, fieldAliases)
    .forEach((warning) => warnings.push(warning));

  for (const { row, sourceRow } of nonEmptyRows) {
    const result = mapKeywordMetricRow(row, filePath, source, sourceRow, fieldAliases);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    if (result.errors.length > 0) {
      invalidRowNumbers.add(sourceRow);
      continue;
    }
    if (result.metric) {
      metrics.push(result.metric);
    }
  }

  const invalidRows = invalidRowNumbers.size;
  const totalRows = nonEmptyRows.length;
  const invalidRowRatio = totalRows > 0 ? invalidRows / totalRows : 0;
  const maxInvalidRowRatio = options.maxInvalidRowRatio ?? 0.05;

  if (invalidRowRatio > maxInvalidRowRatio) {
    throw new Error(
      `关键词报表错误行占比 ${(invalidRowRatio * 100).toFixed(2)}%，超过 ${(maxInvalidRowRatio * 100).toFixed(2)}% 阈值。` +
      ` 首个错误：${errors[0]?.message ?? '未知错误'}`,
    );
  }

  return {
    metrics,
    diagnostics: {
      totalRows,
      parsedRows: metrics.length,
      invalidRows,
      invalidRowRatio,
      errors,
      warnings,
    },
  };
}

function mapKeywordMetricRow(
  row: Record<string, unknown>,
  sourceFile: string,
  source: KeywordMetric['source'],
  sourceRow: number,
  fieldAliases: Record<string, string[]>,
): { metric: KeywordMetric | null; errors: KeywordMetricParseIssue[]; warnings: KeywordMetricParseIssue[] } {
  const errors: KeywordMetricParseIssue[] = [];
  const warnings: KeywordMetricParseIssue[] = [];
  const requiredNumericFields = requiredNumericFieldsForSource(source);
  const warningOnlyFields = warningOnlyFieldsForSource(source);
  const rawKeyword = textField(row, 'rawKeyword', fieldAliases);
  if (!rawKeyword) {
    errors.push({
      row: sourceRow,
      field: 'rawKeyword',
      severity: 'error',
      message: '关键字段缺失：rawKeyword，请检查字段映射',
      value: lookup(row, 'rawKeyword', fieldAliases),
    });
    return { metric: null, errors, warnings };
  }
  for (const field of warningOnlyFields) {
    const value = lookup(row, field, fieldAliases);
    if (value === undefined || value === null || value === '') {
      warnings.push({
        row: sourceRow,
        field,
        severity: 'warning',
        message: `非关键字段单元格缺失，可由基础字段推导或按 0 处理：${field}`,
        value,
      });
    }
  }

  const impressions = numberField(row, 'impressions', fieldAliases, sourceRow, errors, warnings, requiredNumericFields.has('impressions'));
  const clicks = numberField(row, 'clicks', fieldAliases, sourceRow, errors, warnings, requiredNumericFields.has('clicks'));
  const cost = numberField(row, 'cost', fieldAliases, sourceRow, errors, warnings, requiredNumericFields.has('cost'));
  const orders = numberField(row, 'orders', fieldAliases, sourceRow, errors, warnings, requiredNumericFields.has('orders'));
  const sales = numberField(row, 'sales', fieldAliases, sourceRow, errors, warnings, requiredNumericFields.has('sales'));
  const acos = numberField(row, 'acos', fieldAliases, sourceRow, errors, warnings, false) || (sales > 0 ? cost / sales : 0);
  const cvr = numberField(row, 'cvr', fieldAliases, sourceRow, errors, warnings, false) || (clicks > 0 ? orders / clicks : 0);

  return {
    metric: {
      asin: textField(row, 'asin', fieldAliases) || undefined,
      rawKeyword,
      normalizedKeyword: normalizeKeyword(rawKeyword),
      source,
      impressions,
      clicks,
      cost,
      orders,
      sales,
      acos,
      cvr,
      sourceFile,
      sourceRow,
    },
    errors,
    warnings,
  };
}

function textField(row: Record<string, unknown>, canonical: string, fieldAliases: Record<string, string[]>): string {
  const value = lookup(row, canonical, fieldAliases);
  return String(value ?? '').trim();
}

function numberField(
  row: Record<string, unknown>,
  canonical: string,
  fieldAliases: Record<string, string[]>,
  sourceRow: number,
  errors: KeywordMetricParseIssue[],
  warnings: KeywordMetricParseIssue[],
  requiredForRow: boolean,
): number {
  const value = lookup(row, canonical, fieldAliases);
  if (value === undefined || value === null || value === '') {
    if (requiredForRow) {
      warnings.push({
        row: sourceRow,
        field: canonical,
        severity: 'warning',
        message: `非关键字段单元格缺失，已按 0 处理：${canonical}`,
        value,
      });
    }
    return 0;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    const issue: KeywordMetricParseIssue = {
      row: sourceRow,
      field: canonical,
      severity: requiredForRow ? 'error' : 'warning',
      message: `${requiredForRow ? '核心数值字段清洗失败' : '可选数值字段无法解析，已按 0 处理'}：${canonical}`,
      value,
    };
    if (requiredForRow) {
      errors.push(issue);
    } else {
      warnings.push(issue);
    }
    return 0;
  }
  const cleaned = String(value ?? '')
    .replace(/[%,$¥￥，,\s]/g, '')
    .trim();
  if (!cleaned) {
    const issue: KeywordMetricParseIssue = {
      row: sourceRow,
      field: canonical,
      severity: requiredForRow ? 'error' : 'warning',
      message: `${requiredForRow ? '核心数值字段清洗失败' : '可选数值字段无法解析，已按 0 处理'}：${canonical}`,
      value,
    };
    if (requiredForRow) {
      errors.push(issue);
    } else {
      warnings.push(issue);
    }
    return 0;
  }
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    const issue: KeywordMetricParseIssue = {
      row: sourceRow,
      field: canonical,
      severity: requiredForRow ? 'error' : 'warning',
      message: `${requiredForRow ? '核心数值字段清洗失败' : '可选数值字段无法解析，已按 0 处理'}：${canonical}`,
      value,
    };
    if (requiredForRow) {
      errors.push(issue);
    } else {
      warnings.push(issue);
    }
    return 0;
  }
  return String(value ?? '').includes('%') ? parsed / 100 : parsed;
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

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[\s_\-()（）]/g, '');
}

function rowHasData(row: Record<string, unknown>): boolean {
  return Object.values(row).some((value) => String(value ?? '').trim() !== '');
}

function hasFieldInRows(rows: Array<Record<string, unknown>>, canonical: string, fieldAliases: Record<string, string[]>): boolean {
  return rows.some((row) => lookup(row, canonical, fieldAliases) !== undefined);
}

function assertCriticalColumnsPresent(rows: Array<Record<string, unknown>>, fieldAliases: Record<string, string[]>): void {
  if (rows.length === 0) {
    throw new Error('关键词报表没有可解析的数据行');
  }
  if (!hasFieldInRows(rows, 'rawKeyword', fieldAliases)) {
    throw new Error('关键词报表缺少关键字段 rawKeyword，请在字段映射中补充搜索词/关键词列');
  }
}

function collectMissingOptionalFieldWarnings(
  rows: Array<Record<string, unknown>>,
  source: KeywordMetric['source'],
  fieldAliases: Record<string, string[]>,
): KeywordMetricParseIssue[] {
  return Array.from(new Set([...requiredNumericFieldsForSource(source), ...warningOnlyFieldsForSource(source)]))
    .filter((field) => !hasFieldInRows(rows, field, fieldAliases))
    .map((field) => ({
      row: 0,
      field,
      severity: 'warning' as const,
      message: `非关键字段缺失，已按 0 处理：${field}`,
    }));
}

function requiredNumericFieldsForSource(source: KeywordMetric['source']): Set<string> {
  if (source === 'sqp') {
    return new Set(['impressions', 'clicks', 'orders', 'sales']);
  }
  if (source === 'manual') {
    return new Set(['impressions', 'clicks', 'orders', 'sales']);
  }
  return new Set(['impressions', 'clicks', 'cost', 'orders', 'sales']);
}

function warningOnlyFieldsForSource(source: KeywordMetric['source']): Set<string> {
  if (source === 'sqp') {
    return new Set(['cvr']);
  }
  return new Set();
}

function normalizeKeyword(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function inferKeywordMetricSource(filePath: string): KeywordMetric['source'] {
  const basename = path.basename(filePath).toLowerCase();
  if (basename.includes('sqp') || basename.includes('query')) return 'sqp';
  if (basename.includes('keyword')) return 'keyword_report';
  if (basename.includes('search')) return 'search_term';
  return 'manual';
}

function buildFieldAliases(
  source: KeywordMetric['source'],
  options: ParseKeywordMetricsOptions,
): Record<string, string[]> {
  return mergeAliases(
    DEFAULT_FIELD_ALIASES,
    loadMappingFromDir(source, options.fieldMappingsDir),
    options.fieldMapping,
  );
}

export function keywordMetricDiagnosticsToCsv(diagnostics: KeywordMetricParseDiagnostics): string {
  const rows = [...diagnostics.errors, ...diagnostics.warnings]
    .sort((left, right) => left.row - right.row || left.severity.localeCompare(right.severity))
    .map((issue) => [
      issue.severity,
      issue.row,
      issue.field ?? '',
      issue.message,
      issue.value ?? '',
    ].map(formatCsvCell).join(','));
  return [DIAGNOSTIC_EXPORT_HEADERS.join(','), ...rows].join('\n');
}

function formatCsvCell(value: unknown): string {
  return `"${sanitizeSpreadsheetCell(value).replace(/"/g, '""')}"`;
}

function sanitizeSpreadsheetCell(value: unknown): string {
  const raw = String(value ?? '');
  const trimmed = raw.replace(/^[\s\t\r\n]+/, '');
  return /^[=+\-@]/.test(trimmed) ? `'${raw}` : raw;
}

function loadMappingFromDir(
  source: KeywordMetric['source'],
  fieldMappingsDir?: string,
): Record<string, string[]> | undefined {
  if (!fieldMappingsDir) return undefined;

  const filenameBySource: Record<KeywordMetric['source'], string | undefined> = {
    search_term: 'search-term-report-mapping.json',
    sqp: 'sqp-report-mapping.json',
    keyword_report: 'lingxing-ad-report-mapping.json',
    manual: undefined,
  };
  const filename = filenameBySource[source];
  if (!filename) return undefined;

  const filePath = path.join(fieldMappingsDir, filename);
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

function mergeAliases(
  ...mappings: Array<Record<string, string[]> | undefined>
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const mapping of mappings) {
    if (!mapping) continue;
    for (const [key, aliases] of Object.entries(mapping)) {
      merged[key] = Array.from(new Set([...(merged[key] ?? []), ...aliases, key]));
    }
  }
  return merged;
}
