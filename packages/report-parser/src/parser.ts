import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { normalizeFieldName, mapRowFields } from './field-mapper';
import { validateBatch, cleanNumericFields } from './validators';
import type { AdDailyMetrics, LingxingReportType } from '@amazon-ai-ops/shared-types';
import type { ValidationResult } from './validators';

export interface ParseOptions {
  skipHeaderRows?: number;  // 跳过前几行表头，默认 0
  requiredFields?: string[]; // 额外必填字段
  dateFormat?: string;      // 日期格式，默认 'YYYY-MM-DD'
  reportType?: string;      // 调用方声明类型；必须与内容列语义一致
}

export interface ParseResult {
  success: boolean;
  /** Headers match the minimum advertising-report contract, even when there are zero data rows. */
  schemaValid: boolean;
  data: AdDailyMetrics[];
  validation: ValidationResult;
  sourceFile: string;
  parsedAt: string;
  totalRows: number;
  headers: string[];
}

export class ReportParser {
  /**
   * 解析 Excel 文件 (.xlsx, .xls)
   */
  parseExcel(filePath: string, options: ParseOptions = {}): ParseResult {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    return this.parseSheet(worksheet, filePath, options);
  }

  /**
   * 解析 CSV 文件
   */
  parseCSV(filePath: string, options: ParseOptions = {}): ParseResult {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const csvText = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const workbook = XLSX.read(csvText, { type: 'string' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    return this.parseSheet(worksheet, filePath, options);
  }

  /**
   * 解析 Sheet 数据
   */
  private parseSheet(worksheet: XLSX.WorkSheet, sourceFile: string, options: ParseOptions): ParseResult {
    const skipRows = options.skipHeaderRows ?? 0;
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });
    const rawHeaders = (rawRows[0] ?? [])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);
    
    // 转换为 JSON
    const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
      defval: '',  // 默认值为空字符串
    });

    if (jsonData.length === 0) {
      const reportType = resolveSemanticReportType(rawHeaders, options.reportType);
      const schemaValid = isAdvertisingReportSchema(rawHeaders, options.requiredFields)
        && reportType !== undefined;
      return {
        success: schemaValid,
        schemaValid,
        data: [],
        validation: { valid: true, errors: [], validCount: 0, invalidCount: 0 },
        sourceFile,
        parsedAt: new Date().toISOString(),
        totalRows: 0,
        headers: rawHeaders,
      };
    }

    // 跳过表头行
    const dataRows = jsonData.slice(skipRows);
    
    // 获取表头
    const headers = Object.keys(dataRows[0] || {});
    const reportType = resolveSemanticReportType(headers, options.reportType);
    const schemaValid = isAdvertisingReportSchema(headers, options.requiredFields)
      && reportType !== undefined;

    // 字段名标准化，并在任何过滤前固定原始 Excel 行号。
    const candidateRows = dataRows.map((rawRow, index) => ({
      rawRow,
      mappedRow: mapRowFields(rawRow),
      sourceRow: index + skipRows + 2,
    }));
    const importRows = candidateRows.filter(({ rawRow, mappedRow }) => (
      !isLingxingPausedZeroActivityPlaceholder(rawRow, mappedRow)
    ));
    const mappedRows = importRows.map(({ mappedRow }) => mappedRow);

    // 数据校验
    const validation = validateBatch(mappedRows);
    const invalidRows = new Set(validation.errors.map((error) => error.row));
    const normalizedRows = importRows.map(({ mappedRow, sourceRow }) => ({
      row: cleanNumericFields(mappedRow),
      sourceRow,
    }));

    // 转换为 AdDailyMetrics
    const metrics: AdDailyMetrics[] = normalizedRows.map(({ row, sourceRow }) => {
      return this.mapToAdMetrics(row, sourceFile, reportType, sourceRow);
    }).filter((m, index) => (
      !invalidRows.has(index)
      && m.date
      && (m.asin || m.campaignName || m.adGroupName || m.targeting || m.searchTerm)
    )); // 无效行绝不进入导入候选；Main 仍会对整文件 validation fail closed。

    return {
      success: schemaValid && validation.valid && metrics.length > 0,
      schemaValid,
      data: schemaValid ? metrics : [],
      validation,
      sourceFile,
      parsedAt: new Date().toISOString(),
      totalRows: dataRows.length,
      headers,
    };
  }

  /**
   * 将行数据映射为 AdDailyMetrics
   */
  private mapToAdMetrics(
    row: Record<string, any>,
    sourceFile: string,
    reportType: LingxingReportType | undefined,
    sourceRow: number,
  ): AdDailyMetrics {
    // 尝试从多个可能的字段名中取值
    const getValue = (field: string): any => {
      const lowerField = field.toLowerCase();
      for (const key of Object.keys(row)) {
        if (key.toLowerCase() === lowerField) {
          return row[key];
        }
      }
      return row[field] ?? '';
    };

    const date = this.parseDate(getValue('date'));
    const impressions = Number(getValue('impressions')) || 0;
    const clicks = Number(getValue('clicks')) || 0;
    const cost = Number(getValue('cost')) || 0;
    const orders = Number(getValue('orders')) || 0;
    const sales = Number(getValue('sales')) || 0;
    
    // 计算派生字段
    const acos = sales > 0 ? cost / sales : 0;
    const cpc = clicks > 0 ? cost / clicks : 0;
    const cvr = clicks > 0 ? orders / clicks : 0;
    return {
      date,
      storeName: String(getValue('storeName') || getValue('店铺') || 'unknown'),
      marketplaceCode: String(getValue('marketplaceCode') || getValue('站点') || 'US'),
      portfolioName: String(getValue('portfolioName') || getValue('广告组合') || ''),
      asin: String(getValue('asin') || getValue('ASIN') || ''),
      msku: String(getValue('msku') || getValue('MSKU') || ''),
      campaignName: String(getValue('campaignName') || getValue('广告活动') || ''),
      adGroupName: String(getValue('adGroupName') || getValue('广告组') || ''),
      targeting: String(getValue('targeting') || getValue('关键词') || ''),
      searchTerm: String(getValue('searchTerm') || getValue('搜索词') || ''),
      matchType: (String(getValue('matchType') || getValue('匹配方式') || 'exact') as 'broad' | 'phrase' | 'exact' | 'auto'),
      impressions,
      clicks,
      cost,
      orders,
      sales,
      currency: 'USD',
      acos,
      cpc,
      cvr,
      sourceFile,
      sourceRow,
      reportType,
    };
  }

  /**
   * 解析日期字段
   */
  private parseDate(value: any): string {
    if (!value) return '';
    
    // 如果已经是 YYYY-MM-DD 格式
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value.substring(0, 10);
    }
    
    // Excel 日期序列号
    if (typeof value === 'number') {
      const date = XLSX.SSF.parse_date_code(value);
      if (date) {
        return `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
      }
    }
    
    // 尝试解析其他日期格式
    if (typeof value === 'string') {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        return d.toISOString().substring(0, 10);
      }
    }
    
    return String(value).substring(0, 10);
  }

  /**
   * 检测文件类型并解析
   */
  autoParse(filePath: string, options: ParseOptions = {}): ParseResult {
    const ext = path.extname(filePath).toLowerCase();
    
    switch (ext) {
      case '.xlsx':
      case '.xls':
        return this.parseExcel(filePath, options);
      case '.csv':
        return this.parseCSV(filePath, options);
      default:
        throw new Error(`Unsupported file format: ${ext}`);
    }
  }
}

const IMPORTED_METRIC_FIELDS = [
  'impressions',
  'clicks',
  'cost',
  'orders',
  'sales',
  'acos',
  'cpc',
  'cvr',
] as const;

function normalizedCellText(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim();
}

function isStrictZeroMetric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value === 0;
  if (typeof value !== 'string') return false;
  const candidate = value.normalize('NFKC').trim();
  return candidate === '--'
    || /^[+-]?(?:[$¥￥])?(?:0+(?:\.0*)?|\.0+)%?$/.test(candidate);
}

function isLingxingPausedZeroActivityPlaceholder(
  rawRow: Record<string, any>,
  mappedRow: Record<string, any>,
): boolean {
  const status = Object.entries(rawRow).find(([key]) => (
    normalizedCellText(key) === '有效状态'
  ))?.[1];

  return normalizedCellText(status).toLowerCase() === 'paused'
    && normalizedCellText(mappedRow.date) === ''
    && normalizedCellText(mappedRow.storeName) === ''
    && normalizedCellText(mappedRow.marketplaceCode) === ''
    && normalizedCellText(mappedRow.campaignName) !== ''
    && IMPORTED_METRIC_FIELDS.every((field) => (
      Object.prototype.hasOwnProperty.call(mappedRow, field)
      && isStrictZeroMetric(mappedRow[field])
    ));
}

function isAdvertisingReportSchema(
  headers: readonly string[],
  extraRequiredFields: readonly string[] | undefined,
): boolean {
  const canonical = new Set(headers.map((header) => normalizeFieldName(header)));
  const required = ['date', ...(extraRequiredFields ?? []).map((field) => normalizeFieldName(field))];
  const hasIdentity = ['asin', 'campaignName', 'adGroupName', 'targeting', 'searchTerm']
    .some((field) => canonical.has(field));
  const hasMetric = ['impressions', 'clicks', 'cost', 'orders', 'sales']
    .some((field) => canonical.has(field));
  return required.every((field) => canonical.has(field)) && hasIdentity && hasMetric;
}

const REPORT_COLUMN_ALIASES = {
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

function normalizeReportHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-()/（）【】[\]{}:：,，.。]+/g, '');
}

function headerSetHas(headers: ReadonlySet<string>, aliases: readonly string[]): boolean {
  return aliases.some((alias) => headers.has(normalizeReportHeader(alias)));
}

function inferSemanticReportType(headers: readonly string[]): LingxingReportType | undefined {
  const normalized = new Set(headers.map(normalizeReportHeader).filter(Boolean));
  if (headerSetHas(normalized, REPORT_COLUMN_ALIASES.searchTerm)) return 'user_search_term';
  if (headerSetHas(normalized, REPORT_COLUMN_ALIASES.placement)) return 'placement';
  if (headerSetHas(normalized, REPORT_COLUMN_ALIASES.autoTargeting)) return 'auto_targeting';
  if (headerSetHas(normalized, REPORT_COLUMN_ALIASES.productTargeting)) return 'product_targeting';
  if (headerSetHas(normalized, REPORT_COLUMN_ALIASES.keyword)) return 'keyword';
  if (headerSetHas(normalized, REPORT_COLUMN_ALIASES.advertisedProduct)) return 'advertised_product';
  if (headerSetHas(normalized, REPORT_COLUMN_ALIASES.adGroup)) return 'ad_group';
  if (headerSetHas(normalized, REPORT_COLUMN_ALIASES.campaign)) return 'campaign';
  return undefined;
}

function resolveSemanticReportType(
  headers: readonly string[],
  declaredReportType: string | undefined,
): LingxingReportType | undefined {
  const inferred = inferSemanticReportType(headers);
  if (!declaredReportType) return inferred;
  return inferred === declaredReportType ? inferred : undefined;
}
