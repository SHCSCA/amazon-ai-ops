import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { normalizeFieldName, mapRowFields } from './field-mapper';
import { validateBatch, cleanNumericFields } from './validators';
import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import type { ValidationResult } from './validators';

export interface ParseOptions {
  skipHeaderRows?: number;  // 跳过前几行表头，默认 0
  requiredFields?: string[]; // 额外必填字段
  dateFormat?: string;      // 日期格式，默认 'YYYY-MM-DD'
  reportType?: string;      // 调用方已知报表类型，优先于文件名推断
}

function inferReportType(sourceFile: string): string | undefined {
  const baseName = path.basename(sourceFile).toLowerCase();
  const candidates = [
    'advertised_product',
    'product_targeting',
    'auto_targeting',
    'user_search_term',
    'search_term',
    'ad_group',
    'placement',
    'campaign',
    'keyword',
  ];
  return candidates.find((candidate) => baseName.includes(candidate));
}

export interface ParseResult {
  success: boolean;
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
    
    // 转换为 JSON
    const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
      defval: '',  // 默认值为空字符串
    });

    if (jsonData.length === 0) {
      return {
        success: false,
        data: [],
        validation: { valid: true, errors: [], validCount: 0, invalidCount: 0 },
        sourceFile,
        parsedAt: new Date().toISOString(),
        totalRows: 0,
        headers: [],
      };
    }

    // 跳过表头行
    const dataRows = jsonData.slice(skipRows);
    
    // 获取表头
    const headers = Object.keys(dataRows[0] || {});

    // 字段名标准化
    const normalizedRows = dataRows.map(row => {
      const mapped = mapRowFields(row);
      return cleanNumericFields(mapped);
    });

    // 数据校验
    const validation = validateBatch(normalizedRows);

    // 转换为 AdDailyMetrics
    const metrics: AdDailyMetrics[] = normalizedRows.map((row, index) => {
      return this.mapToAdMetrics(row, sourceFile, options, index + skipRows + 2);
    }).filter(m => m.date && (m.asin || m.campaignName || m.adGroupName || m.targeting || m.searchTerm)); // 过滤无效行

    return {
      success: validation.validCount > 0,
      data: metrics,
      validation,
      sourceFile,
      parsedAt: new Date().toISOString(),
      totalRows: metrics.length,
      headers,
    };
  }

  /**
   * 将行数据映射为 AdDailyMetrics
   */
  private mapToAdMetrics(row: Record<string, any>, sourceFile: string, options: ParseOptions, sourceRow: number): AdDailyMetrics {
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
      searchTerm: String(getValue('searchTerm') || getValue('搜索词') || getValue('targeting') || ''),
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
      reportType: options.reportType || inferReportType(sourceFile),
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
