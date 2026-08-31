/**
 * Product lifecycle stages used by the product card, ad-quant summary,
 * and listing recommendations. Stages intentionally go from broad
 * exploration through steady profit and finally maturity. Legacy
 * aliases from earlier renderer copies are kept as same-label entries
 * so existing call sites do not silently drift on next render.
 */
export type ProductStageToken =
  | 'cold_start'
  | 'keyword_exploration'
  | 'stable_conversion'
  | 'scaling'
  | 'profit_harvesting'
  | 'clearance'
  | 'declining_repair'
  | 'launch'
  | 'testing'
  | 'growth'
  | 'stabilize'
  | 'harvest'
  | 'scaling_alias'
  | 'profit'
  | 'stable'
  | 'mature'
  | 'watch'
  | 'paused'
  | 'active'
  | 'unknown';

const PRODUCT_STAGE_LABELS: Readonly<Record<ProductStageToken, string>> = Object.freeze({
  cold_start: '冷启动',
  keyword_exploration: '关键词探索',
  stable_conversion: '稳定转化',
  scaling: '放量',
  scaling_alias: '放量',
  profit_harvesting: '利润收割',
  clearance: '清货',
  declining_repair: '异常修复',
  launch: '新品启动',
  testing: '测款中',
  growth: '增长期',
  stabilize: '稳定期',
  harvest: '利润收割',
  profit: '利润',
  stable: '稳健',
  mature: '成熟',
  watch: '观察',
  paused: '已暂停',
  active: '在售',
  unknown: '阶段待确认',
});

/**
 * Localize a product stage token to its Chinese label.
 *
 * Empty / unknown inputs return `阶段待确认` so the product card stays
 * readable rather than blank when an upstream pipeline omits a stage.
 */
export function localizeProductStage(value: unknown): string {
  if (value == null || value === '') return '阶段待确认';
  const token = String(value).trim().toLowerCase().replace(/-/g, '_') as ProductStageToken;
  return PRODUCT_STAGE_LABELS[token] ?? '阶段待确认';
}

export const PRODUCT_STAGE_LABEL_TABLE: Readonly<Record<ProductStageToken, string>>
  = PRODUCT_STAGE_LABELS;
