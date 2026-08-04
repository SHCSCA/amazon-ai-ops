import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';

export interface ValidationError {
  field: string;
  message: string;
  row: number;
  value: any;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  validCount: number;
  invalidCount: number;
}

// 关键字段：关键词/搜索词/投放报表通常没有 ASIN，不能因为缺 ASIN 丢弃真实广告明细。
const REQUIRED_FIELDS = ['date', 'storeName', 'campaignName'];

// 数值字段：必须是数字
const NUMERIC_FIELDS = ['impressions', 'clicks', 'cost', 'orders', 'sales', 'acos', 'cpc', 'cvr'];

// 数值字段名可能的变体
const NUMERIC_FIELD_ALIASES: Record<string, string[]> = {
  impressions: ['展现量', '展示量', '曝光量'],
  clicks: ['点击量', '点击'],
  cost: ['花费', '花费金额', '消耗', '花费-本币'],
  orders: ['订单数', '转化数', '广告订单'],
  sales: ['销售额', '销售', '广告销售额-本币'],
  acos: ['ACOS', 'ACoS'],
  cpc: ['CPC', 'CPC-本币', '平均点击成本'],
  cvr: ['转化率'],
};

function isNumericField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  if (NUMERIC_FIELDS.includes(lower)) return true;
  for (const aliases of Object.values(NUMERIC_FIELD_ALIASES)) {
    if (aliases.includes(fieldName)) return true;
  }
  return false;
}

function parseNumeric(value: any): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === 'string') {
    const candidate = value.trim();
    if (!candidate) return 0;
    // Currency and percent markers are accepted only at their grammatical
    // boundaries. Thousands separators must form complete three-digit groups;
    // never delete arbitrary punctuation/whitespace because that would turn
    // corrupt values such as "1$2", "1,2,3", or "12 34" into valid numbers.
    const match = candidate.match(
      /^([+-]?)([$¥￥]?)((?:\d{1,3}(?:[,，]\d{3})+|\d+)(?:\.\d*)?|\.\d+)(%?)$/,
    );
    if (!match) return Number.NaN;
    const normalized = `${match[1]}${match[3].replace(/[，,]/g, '')}`;
    const num = Number(normalized);
    return Number.isFinite(num) ? num : Number.NaN;
  }
  if (value === null || value === undefined) return 0;
  return Number.NaN;
}

function valueForField(row: Record<string, any>, field: string): any {
  const entry = Object.entries(row).find(([key]) => key.toLowerCase() === field.toLowerCase());
  return entry?.[1];
}

function isValidDateValue(value: any): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return parsed.toISOString().slice(0, 10) === trimmed;
  }
  return true;
}

export function validateMetrics(row: Record<string, any>, rowIndex: number): ValidationError[] {
  const errors: ValidationError[] = [];

  // 检查必填字段
  for (const field of REQUIRED_FIELDS) {
    const hasField = Object.keys(row).some(k => k.toLowerCase() === field.toLowerCase());
    const value = valueForField(row, field);
    if (!hasField || value === null || value === undefined || value === '') {
      errors.push({
        field,
        message: `Missing required field: ${field}`,
        row: rowIndex,
        value,
      });
    }
  }

  const dateValue = valueForField(row, 'date');
  if (dateValue !== null && dateValue !== undefined && dateValue !== '' && !isValidDateValue(dateValue)) {
    errors.push({
      field: 'date',
      message: `Invalid date value: ${dateValue}`,
      row: rowIndex,
      value: dateValue,
    });
  }

  // 检查数值字段
  for (const [key, value] of Object.entries(row)) {
    if (isNumericField(key) && value !== null && value !== undefined && value !== '') {
      const parsed = parseNumeric(value);
      if (!Number.isFinite(parsed)) {
        errors.push({
          field: key,
          message: `Invalid numeric value: ${value}`,
          row: rowIndex,
          value,
        });
      }
    }
  }

  return errors;
}

export function cleanNumericFields(row: Record<string, any>): Record<string, any> {
  const cleaned = { ...row };
  for (const key of Object.keys(cleaned)) {
    if (isNumericField(key)) {
      cleaned[key] = parseNumeric(cleaned[key]);
    }
  }
  return cleaned;
}

export function validateBatch(rows: Record<string, any>[]): ValidationResult {
  const errors: ValidationError[] = [];
  let validCount = 0;
  let invalidCount = 0;

  rows.forEach((row, index) => {
    const rowErrors = validateMetrics(row, index);
    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      invalidCount++;
    } else {
      validCount++;
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    validCount,
    invalidCount,
  };
}
