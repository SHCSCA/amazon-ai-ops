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

// 关键字段：解析时必须有值
const REQUIRED_FIELDS = ['date', 'storeName', 'asin', 'campaignName'];

// 数值字段：必须是数字
const NUMERIC_FIELDS = ['impressions', 'clicks', 'cost', 'orders', 'sales', 'acos', 'cpc', 'cvr'];

// 数值字段名可能的变体
const NUMERIC_FIELD_ALIASES: Record<string, string[]> = {
  impressions: ['展现量', '展示量'],
  clicks: ['点击量', '点击'],
  cost: ['花费', '花费金额', '消耗'],
  orders: ['订单数', '转化数'],
  sales: ['销售额', '销售'],
  acos: ['ACOS'],
  cpc: ['CPC', '平均点击成本'],
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
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[¥$,，￥%\s]/g, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

export function validateMetrics(row: Record<string, any>, rowIndex: number): ValidationError[] {
  const errors: ValidationError[] = [];

  // 检查必填字段
  for (const field of REQUIRED_FIELDS) {
    const hasField = Object.keys(row).some(k => k.toLowerCase() === field.toLowerCase());
    if (!hasField || row[field] === null || row[field] === undefined || row[field] === '') {
      errors.push({
        field,
        message: `Missing required field: ${field}`,
        row: rowIndex,
        value: row[field],
      });
    }
  }

  // 检查数值字段
  for (const [key, value] of Object.entries(row)) {
    if (isNumericField(key) && value !== null && value !== undefined && value !== '') {
      const parsed = parseNumeric(value);
      if (isNaN(parsed)) {
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
