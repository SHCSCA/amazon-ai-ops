import * as XLSX from 'xlsx';
import { AD_SOURCE_METRIC_BITS } from '@amazon-ai-ops/shared-types';
import { normalizeFieldName } from './field-mapper';
import { sourceMetricMaskForRow } from './validators';

export function sourceMetricMaskForWorksheetRow(
  row: Record<string, unknown>, worksheet: XLSX.WorkSheet, sourceRow: number,
): number {
  let mask = sourceMetricMaskForRow(row);
  let locatedMask = 0;
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  for (let column = range.s.c; column <= range.e.c; column++) {
    const header = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: column })];
    const field = normalizeFieldName(String(header?.v ?? '')).toLowerCase();
    const bit = AD_SOURCE_METRIC_BITS[field as keyof typeof AD_SOURCE_METRIC_BITS];
    if (!bit) continue;
    locatedMask |= bit;
    const cell = worksheet[XLSX.utils.encode_cell({ r: sourceRow - 1, c: column })];
    // 单元格单位与公式不能在转换成数字时丢失，未知格式不认证来源。
    const format = String(cell?.z ?? 'General');
    const formatted = String(cell?.w ?? '');
    const foreignCurrency = /[\p{Sc}]/u.test((format + formatted).replace(/\$/g, ''));
    const count = field === 'impressions' || field === 'clicks' || field === 'orders';
    const simpleFormat = format === 'General' || /^[0#?,.\s$()+;\-\\"]+$/.test(format);
    if (!cell || cell.f || foreignCurrency || /%/.test(format + formatted)
      || (count && /\$/.test(format + formatted)) || !simpleFormat) mask &= ~bit;
  }
  return mask & locatedMask;
}
