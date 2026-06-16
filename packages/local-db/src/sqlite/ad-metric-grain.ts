export type AdMetricReportGrain = 'actionable' | 'breakdown' | 'all';

export type CanonicalAdMetricSummarySource =
  | 'canonical_user_search_term'
  | 'canonical_search_term'
  | 'actionable_fallback'
  | 'none';

export interface CanonicalAdMetricSelection {
  reportTypes: string[];
  summarySource: CanonicalAdMetricSummarySource;
  isApproximate: boolean;
  warning?: string;
}

export const ACTIONABLE_REPORT_TYPES = [
  'keyword',
  'product_targeting',
  'auto_targeting',
  'user_search_term',
  'search_term',
] as const;

export const BREAKDOWN_REPORT_TYPES = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
] as const;

export const CANONICAL_REPORT_TYPE_PRIORITY = [
  'user_search_term',
  'search_term',
] as const;

export const ACTIONABLE_FALLBACK_REPORT_TYPES = [
  'keyword',
  'product_targeting',
  'auto_targeting',
] as const;

const ACTIONABLE_SET = new Set<string>(ACTIONABLE_REPORT_TYPES);
const BREAKDOWN_SET = new Set<string>(BREAKDOWN_REPORT_TYPES);
const FALLBACK_SET = new Set<string>(ACTIONABLE_FALLBACK_REPORT_TYPES);

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function inList(values: readonly string[]): string {
  return values.map(sqlLiteral).join(', ');
}

function lowerColumn(column: string): string {
  return `lower(COALESCE(${column}, ''))`;
}

function sourceFilePatternForReportType(reportType: string, sourceFileColumn: string): string {
  const source = lowerColumn(sourceFileColumn);
  switch (reportType) {
    case 'keyword':
      return `${source} LIKE '%keyword%'`;
    case 'product_targeting':
      return `(${source} LIKE '%product%target%' OR ${source} LIKE '%asin%target%')`;
    case 'auto_targeting':
      return `${source} LIKE '%auto%target%'`;
    case 'user_search_term':
    case 'search_term':
      return `${source} LIKE '%search%term%'`;
    case 'campaign':
      return `${source} LIKE '%campaign%'`;
    case 'ad_group':
      return `(${source} LIKE '%ad%group%' OR ${source} LIKE '%ad_group%')`;
    case 'placement':
      return `${source} LIKE '%placement%'`;
    case 'advertised_product':
      return `${source} LIKE '%advertised%product%'`;
    default:
      return '0 = 1';
  }
}

function sourceFilePatterns(reportTypes: readonly string[], sourceFileColumn: string): string {
  return reportTypes.map((reportType) => sourceFilePatternForReportType(reportType, sourceFileColumn)).join(' OR ');
}

function reportTypesWhere(reportTypes: readonly string[], reportTypeColumn: string, sourceFileColumn: string): string {
  if (reportTypes.length === 0) return '0 = 1';
  const typeSql = `${reportTypeColumn} IN (${inList(reportTypes)})`;
  const sourcePatterns = sourceFilePatterns(reportTypes, sourceFileColumn);
  return `(
    ${typeSql}
    OR (
      ${reportTypeColumn} IS NULL
      AND ${sourceFileColumn} IS NOT NULL
      AND (${sourcePatterns})
    )
  )`;
}

export function adMetricReportTypesWhere(
  reportTypes: readonly string[],
  reportTypeColumn = 'report_type',
  sourceFileColumn = 'source_file',
): string {
  return reportTypesWhere(reportTypes, reportTypeColumn, sourceFileColumn);
}

export function adMetricCanonicalWhere(
  availableReportTypes: Iterable<unknown>,
  reportTypeColumn = 'report_type',
  sourceFileColumn = 'source_file',
): { whereSql: string; selection: CanonicalAdMetricSelection } {
  const selection = chooseCanonicalAdMetricReportTypes(availableReportTypes);
  return {
    whereSql: selection.reportTypes.length > 0
      ? reportTypesWhere(selection.reportTypes, reportTypeColumn, sourceFileColumn)
      : '0 = 1',
    selection,
  };
}

export function adMetricGrainWhere(
  grain: AdMetricReportGrain,
  reportTypeColumn = 'report_type',
  sourceFileColumn = 'source_file',
): string {
  if (grain === 'all') return '1 = 1';
  if (grain === 'actionable') return reportTypesWhere(ACTIONABLE_REPORT_TYPES, reportTypeColumn, sourceFileColumn);
  return reportTypesWhere(BREAKDOWN_REPORT_TYPES, reportTypeColumn, sourceFileColumn);
}

export function isActionableReportType(reportType: unknown): boolean {
  return ACTIONABLE_SET.has(String(reportType || '').trim());
}

export function isBreakdownReportType(reportType: unknown): boolean {
  return BREAKDOWN_SET.has(String(reportType || '').trim());
}

export function inferAdMetricReportType(reportType: unknown, sourceFile?: unknown): string {
  const normalized = String(reportType || '').trim();
  if (normalized) return normalized;

  const source = String(sourceFile || '').toLowerCase();
  if (!source) return '';
  if (source.includes('user') && source.includes('search') && source.includes('term')) return 'user_search_term';
  if (source.includes('search') && source.includes('term')) return 'search_term';
  if (source.includes('product') && source.includes('target')) return 'product_targeting';
  if (source.includes('asin') && source.includes('target')) return 'product_targeting';
  if (source.includes('auto') && source.includes('target')) return 'auto_targeting';
  if (source.includes('keyword')) return 'keyword';
  if (source.includes('advertised') && source.includes('product')) return 'advertised_product';
  if ((source.includes('ad') && source.includes('group')) || source.includes('ad_group')) return 'ad_group';
  if (source.includes('placement')) return 'placement';
  if (source.includes('campaign')) return 'campaign';
  return '';
}

export function chooseCanonicalAdMetricReportTypes(availableReportTypes: Iterable<unknown>): CanonicalAdMetricSelection {
  const available = new Set(
    Array.from(availableReportTypes)
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );

  if (available.has('user_search_term')) {
    return {
      reportTypes: ['user_search_term'],
      summarySource: 'canonical_user_search_term',
      isApproximate: false,
    };
  }

  if (available.has('search_term')) {
    return {
      reportTypes: ['search_term'],
      summarySource: 'canonical_search_term',
      isApproximate: false,
    };
  }

  const fallbackTypes = ACTIONABLE_FALLBACK_REPORT_TYPES.filter((reportType) => available.has(reportType));
  if (fallbackTypes.length > 0) {
    return {
      reportTypes: fallbackTypes,
      summarySource: 'actionable_fallback',
      isApproximate: true,
      warning: '当前范围没有搜索词权威总表，汇总使用关键词、商品投放和自动投放的可行动报表近似计算；不要再与广告活动、广告组或广告位报表相加。',
    };
  }

  return {
    reportTypes: [],
    summarySource: 'none',
    isApproximate: false,
    warning: '当前范围没有可用于广告量化汇总的报表行。',
  };
}

export function actionableFallbackReportTypes(availableReportTypes: Iterable<unknown>): string[] {
  const available = new Set(
    Array.from(availableReportTypes)
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
  return ACTIONABLE_FALLBACK_REPORT_TYPES.filter((reportType) => available.has(reportType) && FALLBACK_SET.has(reportType));
}
