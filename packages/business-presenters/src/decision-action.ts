/**
 * Decision action taxonomy for the appraisal queue and policy workbench.
 * Includes the higher-level composite actions (new campaign, archive,
 * budget shifts) that the upstream action catalog emits alongside the
 * leaf-level bid/pause/negative actions defined in `action.ts`.
 */
export type DecisionActionToken =
  | 'set_keyword_bid'
  | 'lower_bid'
  | 'raise_bid'
  | 'bid_change'
  | 'adjust_keyword_bid'
  | 'keyword_bid_adjustment'
  | 'adjust_campaign_budget'
  | 'increase_campaign_budget'
  | 'decrease_campaign_budget'
  | 'budget_change'
  | 'placement_adjustment'
  | 'pause'
  | 'pause_keyword'
  | 'pause_target'
  | 'resume_target'
  | 'enable_keyword'
  | 'negative_exact'
  | 'negative_phrase'
  | 'negative_keyword'
  | 'add_negative_broad'
  | 'add_negative_exact'
  | 'add_negative_phrase'
  | 'add_negative_keyword'
  | 'archive_campaign'
  | 'create_campaign';

const DECISION_ACTION_LABELS: Readonly<Record<DecisionActionToken, string>> = Object.freeze({
  set_keyword_bid: '调整关键词竞价',
  lower_bid: '降低出价',
  raise_bid: '提高出价',
  bid_change: '调整关键词竞价',
  adjust_keyword_bid: '调整关键词竞价',
  keyword_bid_adjustment: '调整关键词竞价',
  adjust_campaign_budget: '调整活动预算',
  increase_campaign_budget: '提高活动预算',
  decrease_campaign_budget: '降低活动预算',
  budget_change: '调整日预算',
  placement_adjustment: '调整广告位系数',
  pause: '暂停投放',
  pause_keyword: '暂停关键词',
  pause_target: '暂停投放对象',
  resume_target: '恢复投放对象',
  enable_keyword: '启用关键词',
  negative_exact: '添加否定精准',
  negative_phrase: '添加否定词组',
  negative_keyword: '添加否定词',
  add_negative_broad: '添加广泛否定',
  add_negative_exact: '添加精准否定',
  add_negative_phrase: '添加词组否定',
  add_negative_keyword: '添加否定词',
  archive_campaign: '归档广告活动',
  create_campaign: '新建广告活动',
});

/**
 * Localize a decision action token to its Chinese label.
 *
 * Empty / null inputs return `待确认动作` so the appraisal queue keeps
 * its leading-column readability for not-yet-loaded recommendations.
 * Unknown tokens fall back to the raw underscored value (rather than a
 * silent placeholder) so operators can spot unexpected catalog additions.
 */
export function localizeDecisionAction(value: unknown): string {
  if (value == null) return '待确认动作';
  const normalized = String(value).trim();
  if (!normalized) return '待确认动作';
  const token = normalized.toLowerCase().replace(/-/g, '_') as DecisionActionToken;
  return DECISION_ACTION_LABELS[token] ?? normalized.replace(/_/g, ' ');
}

export const DECISION_ACTION_LABEL_TABLE: Readonly<Record<DecisionActionToken, string>>
  = DECISION_ACTION_LABELS;
