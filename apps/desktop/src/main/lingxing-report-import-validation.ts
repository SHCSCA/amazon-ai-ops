import type { ParseResult } from '@amazon-ai-ops/report-parser';

export interface LingxingImportWindow {
  dateStart: string;
  dateEnd: string;
  sourceName: string;
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Final fail-closed boundary before parsed Lingxing rows reach the authority DB.
 * Filenames are only collection hints; every metric date and every source value
 * must independently satisfy the parser and the exact requested batch window.
 */
export function assertLingxingParsedReportImportable(
  parsed: Pick<ParseResult, 'schemaValid' | 'totalRows' | 'data' | 'validation'>,
  window: LingxingImportWindow,
): void {
  if (!isIsoCalendarDate(window.dateStart) || !isIsoCalendarDate(window.dateEnd) || window.dateStart > window.dateEnd) {
    throw new Error(`采集日期窗无效：${window.dateStart} 至 ${window.dateEnd}。`);
  }
  if (!parsed.schemaValid) {
    throw new Error(`真实报表表头不符合广告报表契约：${window.sourceName}。`);
  }
  if (!parsed.validation.valid) {
    const first = parsed.validation.errors[0];
    const location = first ? `第 ${first.row + 2} 行 ${first.field}` : '未知字段';
    throw new Error(`真实报表包含无效数据（${location}）：${window.sourceName}。`);
  }
  if (parsed.totalRows > 0 && parsed.data.length === 0) {
    throw new Error(`真实报表包含数据行但未解析出有效广告指标：${window.sourceName}。`);
  }
  const invalidDate = parsed.data.find((metric) => (
    !isIsoCalendarDate(metric.date)
    || metric.date < window.dateStart
    || metric.date > window.dateEnd
  ));
  if (invalidDate) {
    throw new Error(
      `真实报表指标日期 ${invalidDate.date || '无效'} 不在采集日期窗 ${window.dateStart} 至 ${window.dateEnd}：${window.sourceName}。`,
    );
  }
}
