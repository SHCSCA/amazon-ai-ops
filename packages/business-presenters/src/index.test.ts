import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_LABEL_TABLE,
  COLLECTION_REPORT_LABEL_TABLE,
  DECISION_ACTION_LABEL_TABLE,
  DEFAULT_STATUS_LABEL,
  OBJECT_TYPE_LABEL_TABLE,
  PRODUCT_STAGE_LABEL_TABLE,
  QUANT_STATUS_LABEL_TABLE,
  RECOMMENDATION_SOURCE_LABEL_TABLE,
  REPORT_STATUS_LABEL_TABLE,
  STATUS_LABEL_TABLE,
  adObjectTableRow,
  businessGroupLabel,
  businessGroupPath,
  businessGroupTransitions,
  classifyHealth,
  formattedChangeValue,
  isSupportedCurrency,
  localizeAction,
  localizeAgreement,
  localizeCollectionReportType,
  localizeDecisionAction,
  localizeMatchType,
  localizeObjectType,
  localizeProductStage,
  localizeQuantStatus,
  localizeRecommendationSource,
  localizeReportStatus,
  localizeStatus,
  money,
  normalizeBusinessGroupPath,
  normalizeToken,
  percent,
  recommendationTableRow,
  targetingTypeLabel,
  usdCurrency,
} from './index';

describe('normalizeToken', () => {
  it('folds camelCase to snake_case lowercase', () => {
    expect(normalizeToken('ExactMatch')).toBe('exact_match');
    expect(normalizeToken('adjustKeywordBid')).toBe('adjust_keyword_bid');
  });

  it('folds kebab and spaces to underscores', () => {
    expect(normalizeToken('broad-match')).toBe('broad_match');
    expect(normalizeToken('Close Match')).toBe('close_match');
  });

  it('returns empty for nullish or whitespace input', () => {
    expect(normalizeToken(null)).toBe('');
    expect(normalizeToken(undefined)).toBe('');
    expect(normalizeToken('   ')).toBe('');
  });

  it('trims leading and trailing separators', () => {
    expect(normalizeToken('__hello__')).toBe('hello');
  });
});

describe('money', () => {
  it('formats finite numbers in USD by default', () => {
    expect(money(1234.5)).toBe('$1,234.50');
    expect(money(0)).toBe('$0.00');
    expect(money(-2.5)).toBe('-$2.50');
  });

  it('returns em-dash for non-finite values', () => {
    expect(money(NaN)).toBe('—');
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
  });

  it('falls back to the raw value when non-numeric', () => {
    expect(money('abc')).toBe('abc');
  });

  it('accepts other supported currencies', () => {
    expect(money(99, 'EUR')).toBe('€99.00');
  });
});

describe('percent', () => {
  it('treats small values as fractions', () => {
    expect(percent(0.25)).toBe('25%');
    expect(percent(0.245)).toBe('24.5%');
  });

  it('treats large values as percent', () => {
    expect(percent(25)).toBe('25%');
    expect(percent(24.5)).toBe('24.5%');
  });

  it('returns em-dash for non-finite values', () => {
    expect(percent(NaN)).toBe('—');
    expect(percent(null)).toBe('—');
  });

  it('strips trailing .0', () => {
    expect(percent(0.1)).toBe('10%');
    expect(percent(10)).toBe('10%');
  });
});

describe('localizeMatchType', () => {
  it('maps every known variant to the Chinese label', () => {
    expect(localizeMatchType('exact')).toBe('精准匹配');
    expect(localizeMatchType('phrase')).toBe('词组匹配');
    expect(localizeMatchType('broad')).toBe('广泛匹配');
    expect(localizeMatchType('close_match')).toBe('紧密匹配');
    expect(localizeMatchType('auto_targeting')).toBe('自动投放');
    expect(localizeMatchType('product_targeting')).toBe('商品投放');
    expect(localizeMatchType('substitutes')).toBe('替代商品');
    expect(localizeMatchType('loose_match')).toBe('宽泛匹配');
  });

  it('normalizes upstream casings', () => {
    expect(localizeMatchType('Exact')).toBe('精准匹配');
    expect(localizeMatchType('close-Match')).toBe('紧密匹配');
    expect(localizeMatchType('ProductTargeting')).toBe('商品投放');
  });

  it('accepts the legacy hyphen and bare alias tokens', () => {
    expect(localizeMatchType('close-match')).toBe('紧密匹配');
    expect(localizeMatchType('loose-match')).toBe('宽泛匹配');
    expect(localizeMatchType('auto')).toBe('自动投放');
  });

  it('returns the explicit fallback for empty / unknown inputs', () => {
    expect(localizeMatchType('')).toBe('不适用');
    expect(localizeMatchType(undefined)).toBe('不适用');
    expect(localizeMatchType('mystery')).toBe('其他投放方式');
  });
});

describe('localizeObjectType', () => {
  it('maps known object types', () => {
    expect(OBJECT_TYPE_LABEL_TABLE.campaign).toBe('广告活动');
    expect(OBJECT_TYPE_LABEL_TABLE.ad_group).toBe('广告组');
    expect(OBJECT_TYPE_LABEL_TABLE.keyword).toBe('关键词');
  });

  it('returns the Chinese fallback for unknown / empty tokens', () => {
    expect(localizeObjectType('campaign')).toBe('广告活动');
    expect(localizeObjectType('Campaign')).toBe('广告活动');
    expect(localizeObjectType('')).toBe('其他对象');
    expect(localizeObjectType('weird_type')).toBe('其他对象');
  });
});

describe('localizeAction', () => {
  it('maps known actions', () => {
    expect(localizeAction('budget_change')).toBe('调整日预算');
    expect(localizeAction('pause')).toBe('暂停投放');
    expect(localizeAction('negative_exact')).toBe('添加否定精准');
    expect(localizeAction('negative_phrase')).toBe('添加否定词组');
    expect(localizeAction('placement_adjustment')).toBe('调整广告位系数');
  });

  it('maps bid aliases to the keyword label by default', () => {
    expect(localizeAction('bid_change')).toBe('调整关键词竞价');
    expect(localizeAction('adjust_keyword_bid')).toBe('调整关键词竞价');
    expect(localizeAction('keyword_bid_adjustment')).toBe('调整关键词竞价');
  });

  it('maps bid aliases by entity type for auto / product targeting', () => {
    expect(localizeAction('bid_change', undefined, 'auto_targeting')).toBe('调整自动投放竞价');
    expect(localizeAction('bid_change', undefined, 'product_targeting')).toBe('调整商品投放竞价');
  });

  it('uses the fallback or "人工复核" when unknown', () => {
    expect(localizeAction('mystery_action', '保留人工复核')).toBe('保留人工复核');
    expect(localizeAction('mystery_action')).toBe('人工复核');
    expect(localizeAction('', '已手动确认')).toBe('已手动确认');
  });
});

describe('localizeStatus', () => {
  it('maps the known statuses', () => {
    expect(STATUS_LABEL_TABLE.waiting_approval).toBe('待判断');
    expect(STATUS_LABEL_TABLE.pending_review).toBe('待判断');
    expect(STATUS_LABEL_TABLE.pending_approval).toBe('待审批');
    expect(STATUS_LABEL_TABLE.approved).toBe('许可已签发');
    expect(STATUS_LABEL_TABLE.executed).toBe('已执行');
    expect(STATUS_LABEL_TABLE.rejected).toBe('已拒绝');
    expect(STATUS_LABEL_TABLE.superseded).toBe('已替代');
  });

  it('returns the default label for empty / unknown', () => {
    expect(localizeStatus('')).toBe(DEFAULT_STATUS_LABEL);
    expect(localizeStatus(undefined)).toBe(DEFAULT_STATUS_LABEL);
    expect(localizeStatus('mystery_status')).toBe(DEFAULT_STATUS_LABEL);
  });

  it('normalizes upstream casings', () => {
    expect(localizeStatus('WaitingApproval')).toBe('待判断');
    expect(localizeStatus('PENDING-APPROVAL')).toBe('待审批');
  });
});

describe('currency helpers', () => {
  it('exposes USD as the default', () => {
    expect(usdCurrency).toBe('USD');
  });

  it('narrows string values to the Currency union', () => {
    expect(isSupportedCurrency('USD')).toBe(true);
    expect(isSupportedCurrency('EUR')).toBe(true);
    expect(isSupportedCurrency('XYZ')).toBe(false);
    expect(isSupportedCurrency(null)).toBe(false);
  });
});

describe('object-labels', () => {
  it('strips leading 关键词 / 搜索词 / 广告组 prefixes', () => {
    expect(targetingTypeLabel({ objectType: 'keyword', matchType: 'exact' }, 'objectType')).toBe('精准匹配');
    expect(targetingTypeLabel({ objectType: 'search_term', matchType: 'phrase' }, 'objectType')).toBe('词组匹配');
  });

  it('falls back to 自动投放 for auto_targeting without a sub-mode', () => {
    expect(targetingTypeLabel({ objectType: 'auto_targeting' }, 'objectType')).toBe('自动投放');
    expect(targetingTypeLabel({ objectType: 'auto_targeting', matchType: 'loose_match' }, 'objectType')).toBe('宽泛匹配');
  });

  it('returns 商品投放 for product_targeting regardless of matchType', () => {
    expect(targetingTypeLabel({ objectType: 'product_targeting', matchType: 'exact' }, 'objectType')).toBe('商品投放');
  });

  it('returns 不适用 for unknown grains', () => {
    expect(targetingTypeLabel({ objectType: 'campaign' }, 'objectType')).toBe('不适用');
  });

  it('formats percent and currency units consistently with money/percent', () => {
    expect(formattedChangeValue(0.25, { unit: 'percent' })).toBe('25%');
    expect(formattedChangeValue(1.49, { unit: 'currency' })).toBe('$1.49');
    expect(formattedChangeValue(72, { actionType: 'budget_change' })).toBe('$72.00');
    expect(formattedChangeValue(0.05, { actionType: 'placement_adjustment' })).toBe('5%');
    expect(formattedChangeValue(null, { unit: 'currency' })).toBe('—');
    expect(formattedChangeValue(undefined, {})).toBe('—');
  });

  it('falls back to raw string for unknown units', () => {
    expect(formattedChangeValue('已否定', { actionType: 'pause' })).toBe('已否定');
  });
});

describe('businessGroupPath / businessGroupLabel', () => {
  it('builds the canonical campaign path', () => {
    expect(businessGroupPath({ campaignName: 'LM02-Brand' })).toEqual([
      { key: 'campaign:LM02-Brand', level: 'campaign', label: '广告活动:LM02-Brand' },
    ]);
  });

  it('appends an ad-group segment when meaningful', () => {
    expect(businessGroupPath({
      campaignName: 'LM02-Generic',
      adGroupName: 'Generic-Phrase',
      entityType: 'keyword',
    })).toEqual([
      { key: 'campaign:LM02-Generic', level: 'campaign', label: '广告活动:LM02-Generic' },
      { key: 'ad-group:LM02-Generic:Generic-Phrase', level: 'ad-group', label: '广告组:Generic-Phrase' },
    ]);
  });

  it('omits the ad-group segment for campaign / placement levels', () => {
    expect(businessGroupPath({
      campaignName: 'LM02-Brand',
      adGroupName: 'Generic-Phrase',
      entityType: 'campaign',
    })).toEqual([
      { key: 'campaign:LM02-Brand', level: 'campaign', label: '广告活动:LM02-Brand' },
    ]);
    expect(businessGroupPath({
      campaignName: 'LM02-Brand',
      adGroupName: 'top',
      entityType: 'placement',
    })).toEqual([
      { key: 'campaign:LM02-Brand', level: 'campaign', label: '广告活动:LM02-Brand' },
    ]);
  });

  it('renders a flat label', () => {
    expect(businessGroupLabel({
      campaignName: 'LM02-Generic',
      adGroupName: 'Generic-Phrase',
      entityType: 'keyword',
    })).toBe('广告活动:LM02-Generic · 广告组:Generic-Phrase');
  });
});

describe('businessGroupTransitions', () => {
  it('returns the new segments for each row relative to the previous', () => {
    const rows = [
      { campaignName: 'A', adGroupName: 'AG-1', entityType: 'keyword' },
      { campaignName: 'A', adGroupName: 'AG-1', entityType: 'keyword' },
      { campaignName: 'A', adGroupName: 'AG-2', entityType: 'keyword' },
      { campaignName: 'B', adGroupName: 'AG-1', entityType: 'keyword' },
    ];
    const transitions = businessGroupTransitions(rows);
    expect(transitions[0].groups).toHaveLength(2);
    expect(transitions[1].groups).toEqual([]);
    expect(transitions[2].groups.map((g) => g.label)).toEqual(['广告组:AG-2']);
    expect(transitions[3].groups.map((g) => g.label)).toEqual(['广告活动:B', '广告组:AG-1']);
  });

  it('handles empty / non-array input', () => {
    expect(businessGroupTransitions(undefined as unknown as never[])).toEqual([]);
  });
});

describe('normalizeBusinessGroupPath', () => {
  it('wraps a string into a single group-level segment', () => {
    expect(normalizeBusinessGroupPath('LM02-Brand')).toEqual([
      { key: 'LM02-Brand', level: 'group', label: 'LM02-Brand' },
    ]);
  });

  it('drops entries without a key or label', () => {
    expect(normalizeBusinessGroupPath([{ key: '', label: '' }, { key: 'x', label: 'X' }])).toEqual([
      { key: 'x', level: 'group', label: 'X' },
    ]);
  });

  it('preserves explicit level discriminators', () => {
    expect(normalizeBusinessGroupPath([
      { key: 'c', label: '广告活动:C', level: 'campaign' },
      { key: 'g', label: '广告组:G', level: 'ad-group' },
    ])).toEqual([
      { key: 'c', level: 'campaign', label: '广告活动:C' },
      { key: 'g', level: 'ad-group', label: '广告组:G' },
    ]);
  });

  it('returns empty for falsy input', () => {
    expect(normalizeBusinessGroupPath(undefined)).toEqual([]);
    expect(normalizeBusinessGroupPath(null)).toEqual([]);
    expect(normalizeBusinessGroupPath('')).toEqual([]);
  });
});

describe('adObjectTableRow', () => {
  it('decorates a typical keyword row', () => {
    const row = adObjectTableRow({
      objectKey: 'ST|B0D|Gen-Ex|gw',
      objectName: 'gate latch outdoor',
      objectType: 'keyword',
      matchType: 'exact',
      campaignName: 'LM02-Generic',
      adGroupName: 'Generic-Exact',
      spend: 60.04,
      acos: 0.245,
      severity: 'low',
    });
    expect(row.id).toBe('ST|B0D|Gen-Ex|gw');
    expect(row.campaign).toBe('LM02-Generic');
    expect(row.adGroup).toBe('Generic-Exact');
    expect(row.level).toBe('关键词');
    expect(row.object).toBe('gate latch outdoor');
    expect(row.targetingType).toBe('精准匹配');
    expect(row.spendLabel).toBe('$60.04');
    expect(row.acosLabel).toBe('24.5%');
    expect(row.health).toBe('正常');
  });

  it('treats a null acos as 无订单', () => {
    const row = adObjectTableRow({ objectType: 'search_term', acos: null });
    expect(row.acosLabel).toBe('无订单');
  });

  it('collapses campaign-level rows to 活动级', () => {
    const row = adObjectTableRow({
      objectType: 'campaign',
      objectName: 'LM02-Brand',
      campaignName: 'LM02-Brand',
    });
    expect(row.campaign).toBe('LM02-Brand');
    expect(row.adGroup).toBe('活动级');
    expect(row.level).toBe('广告活动');
  });

  it('classifies all known severities', () => {
    expect(classifyHealth('critical')).toBe('高风险');
    expect(classifyHealth('high')).toBe('高风险');
    expect(classifyHealth('medium')).toBe('需观察');
    expect(classifyHealth('low')).toBe('正常');
    expect(classifyHealth('healthy')).toBe('正常');
    expect(classifyHealth('normal')).toBe('正常');
    expect(classifyHealth(undefined)).toBe('待核验');
    expect(classifyHealth('mystery')).toBe('待核验');
  });

  it('strips the keyword prefix and trailing match type decoration', () => {
    const row = adObjectTableRow({
      objectType: 'keyword',
      objectName: '关键词 gate latch · exact',
    });
    expect(row.object).toBe('gate latch');
  });
});

describe('recommendationTableRow', () => {
  it('decorates a typical keyword bid recommendation', () => {
    const row = recommendationTableRow({
      id: 'REC-001',
      entityType: 'keyword',
      objectName: 'gate latch outdoor',
      matchType: 'exact',
      campaignName: 'LM02-Generic',
      adGroupName: 'Generic-Exact',
      actionType: 'adjust_keyword_bid',
      currentValue: 0.76,
      recommendedValue: 0.9,
      unit: 'currency',
      reason: '订单稳定但预算耗尽',
      status: 'pending_approval',
    });
    expect(row.campaign).toBe('LM02-Generic');
    expect(row.adGroup).toBe('Generic-Exact');
    expect(row.level).toBe('关键词');
    expect(row.object).toBe('gate latch outdoor');
    expect(row.targetingType).toBe('精准匹配');
    expect(row.action).toBe('调整关键词竞价');
    expect(row.beforeLabel).toBe('$0.76');
    expect(row.afterLabel).toBe('$0.90');
    expect(row.change).toBe('$0.76 → $0.90');
    expect(row.basis).toBe('订单稳定但预算耗尽');
    expect(row.statusLabel).toBe('待审批');
  });

  it('maps an auto_targeting bid to the auto-target label', () => {
    const row = recommendationTableRow({
      entityType: 'auto_targeting',
      objectName: 'substitutes',
      actionType: 'bid_change',
      currentValue: 0.91,
      recommendedValue: 0.84,
      unit: 'currency',
    });
    expect(row.action).toBe('调整自动投放竞价');
    expect(row.targetingType).toBe('替代商品');
  });

  it('falls back to a generic basis string when the upstream reason is empty', () => {
    const row = recommendationTableRow({ entityType: 'keyword' });
    expect(row.basis).toBe('等待补充业务依据');
  });

  it('renders the canonical waiting_approval → 待判断 label', () => {
    const row = recommendationTableRow({ status: 'waiting_approval' });
    expect(row.statusLabel).toBe('待判断');
  });

  it('renders paused / negative actions', () => {
    const paused = recommendationTableRow({
      entityType: 'keyword',
      actionType: 'pause',
      currentValue: '启用',
      recommendedValue: '暂停',
    });
    expect(paused.action).toBe('暂停投放');
    expect(paused.beforeLabel).toBe('启用');
    expect(paused.afterLabel).toBe('暂停');

    const negative = recommendationTableRow({
      entityType: 'search_term',
      actionType: 'negative_phrase',
      currentValue: '投放中',
      recommendedValue: '已否定',
    });
    expect(negative.action).toBe('添加否定词组');
  });
});

describe('localizeDecisionAction', () => {
  it('maps every decision action token to its Chinese label', () => {
    expect(DECISION_ACTION_LABEL_TABLE.archive_campaign).toBe('归档广告活动');
    expect(DECISION_ACTION_LABEL_TABLE.create_campaign).toBe('新建广告活动');
    expect(DECISION_ACTION_LABEL_TABLE.pause_keyword).toBe('暂停关键词');
    expect(DECISION_ACTION_LABEL_TABLE.pause_target).toBe('暂停投放对象');
    expect(DECISION_ACTION_LABEL_TABLE.resume_target).toBe('恢复投放对象');
    expect(DECISION_ACTION_LABEL_TABLE.add_negative_broad).toBe('添加广泛否定');
    expect(DECISION_ACTION_LABEL_TABLE.add_negative_keyword).toBe('添加否定词');
  });

  it('collapses bid aliases onto the keyword-bid label', () => {
    expect(localizeDecisionAction('lower_bid')).toBe('降低出价');
    expect(localizeDecisionAction('raise_bid')).toBe('提高出价');
    expect(localizeDecisionAction('bid_change')).toBe('调整关键词竞价');
    expect(localizeDecisionAction('adjust_keyword_bid')).toBe('调整关键词竞价');
    expect(localizeDecisionAction('set_keyword_bid')).toBe('调整关键词竞价');
  });

  it('returns the awaiting-action marker for empty / null inputs', () => {
    expect(localizeDecisionAction('')).toBe('待确认动作');
    expect(localizeDecisionAction(null)).toBe('待确认动作');
    expect(localizeDecisionAction(undefined)).toBe('待确认动作');
  });

  it('falls back to the underscored raw token for unknown values', () => {
    expect(localizeDecisionAction('mystery_action')).toBe('mystery action');
  });
});

describe('localizeCollectionReportType', () => {
  it('maps every eight-type catalog token to its Chinese label', () => {
    expect(COLLECTION_REPORT_LABEL_TABLE.campaign).toBe('广告活动报告');
    expect(COLLECTION_REPORT_LABEL_TABLE.ad_group).toBe('广告组报告');
    expect(COLLECTION_REPORT_LABEL_TABLE.placement).toBe('广告位报告');
    expect(COLLECTION_REPORT_LABEL_TABLE.auto_targeting).toBe('自动投放报告');
    expect(COLLECTION_REPORT_LABEL_TABLE.keyword).toBe('关键词报告');
    expect(COLLECTION_REPORT_LABEL_TABLE.user_search_term).toBe('用户搜索词报告');
  });

  it('normalizes case for incoming report tokens', () => {
    expect(localizeCollectionReportType('CAMPAIGN')).toBe('广告活动报告');
    expect(localizeCollectionReportType('Ad_Group')).toBe('广告组报告');
  });

  it('returns the awaiting-type marker for empty / unknown inputs', () => {
    expect(localizeCollectionReportType('')).toBe('未知报表类型');
    expect(localizeCollectionReportType(null)).toBe('未知报表类型');
    expect(localizeCollectionReportType('mystery')).toBe('未知报表类型');
  });
});

describe('localizeProductStage', () => {
  it('maps every lifecycle stage to its Chinese label', () => {
    expect(PRODUCT_STAGE_LABEL_TABLE.keyword_exploration).toBe('关键词探索');
    expect(PRODUCT_STAGE_LABEL_TABLE.scaling).toBe('放量');
    expect(PRODUCT_STAGE_LABEL_TABLE.profit_harvesting).toBe('利润收割');
    expect(PRODUCT_STAGE_LABEL_TABLE.mature).toBe('成熟');
  });

  it('accepts the legacy hyphen form', () => {
    expect(localizeProductStage('keyword-exploration')).toBe('关键词探索');
    expect(localizeProductStage('Scaling')).toBe('放量');
  });

  it('keeps the legacy renderer aliases at the same label', () => {
    expect(localizeProductStage('cold_start')).toBe('冷启动');
    expect(localizeProductStage('stable_conversion')).toBe('稳定转化');
    expect(localizeProductStage('clearance')).toBe('清货');
    expect(localizeProductStage('declining_repair')).toBe('异常修复');
    expect(localizeProductStage('growth')).toBe('增长期');
    expect(localizeProductStage('launch')).toBe('新品启动');
    expect(localizeProductStage('harvest')).toBe('利润收割');
    expect(localizeProductStage('active')).toBe('在售');
  });

  it('returns the awaiting-stage marker for empty / unknown inputs', () => {
    expect(localizeProductStage('')).toBe('阶段待确认');
    expect(localizeProductStage(undefined)).toBe('阶段待确认');
    expect(localizeProductStage('unknown_stage')).toBe('阶段待确认');
  });
});

describe('localizeAgreement', () => {
  it('maps every agreement token to its Chinese label', () => {
    expect(AGREEMENT_LABEL_TABLE.aligned).toBe('规则+AI 一致');
    expect(AGREEMENT_LABEL_TABLE.rule_only).toBe('规则独立建议');
    expect(AGREEMENT_LABEL_TABLE.ai_only).toBe('AI 独立洞察');
    expect(AGREEMENT_LABEL_TABLE.conflict).toBe('规则/AI 冲突');
  });

  it('folds case + returns fallback for unknown inputs', () => {
    expect(localizeAgreement('ALIGNED')).toBe('规则+AI 一致');
    expect(localizeAgreement('')).toBe('未知一致性');
    expect(localizeAgreement('unknown_alignment')).toBe('unknown_alignment');
  });
});

describe('localizeRecommendationSource', () => {
  it('maps every source token to its Chinese label', () => {
    expect(RECOMMENDATION_SOURCE_LABEL_TABLE.rule_ai).toBe('规则+AI 合并');
    expect(RECOMMENDATION_SOURCE_LABEL_TABLE.rule).toBe('规则');
    expect(RECOMMENDATION_SOURCE_LABEL_TABLE.ai).toBe('AI');
  });

  it('folds case + returns fallback for unknown inputs', () => {
    expect(localizeRecommendationSource('Rule_AI')).toBe('规则+AI 合并');
    expect(localizeRecommendationSource(null)).toBe('未知来源');
    expect(localizeRecommendationSource('unknown_source')).toBe('unknown_source');
  });
});

describe('localizeReportStatus', () => {
  it('maps every report lifecycle token to its Chinese label', () => {
    expect(REPORT_STATUS_LABEL_TABLE.missing).toBe('缺少真实文件');
    expect(REPORT_STATUS_LABEL_TABLE.ready).toBe('可下载');
    expect(REPORT_STATUS_LABEL_TABLE.downloaded).toBe('已下载待入库');
    expect(REPORT_STATUS_LABEL_TABLE.imported).toBe('已入库');
    expect(REPORT_STATUS_LABEL_TABLE.import_failed).toBe('导入失败');
    expect(REPORT_STATUS_LABEL_TABLE.failed).toBe('失败');
  });

  it('returns fallback for empty / unknown inputs', () => {
    expect(localizeReportStatus('')).toBe('状态待同步');
    expect(localizeReportStatus('UNKNOWN')).toBe('状态待同步');
  });
});

describe('localizeQuantStatus', () => {
  it('maps every quant status token to its Chinese label', () => {
    expect(QUANT_STATUS_LABEL_TABLE.healthy).toBe('健康');
    expect(QUANT_STATUS_LABEL_TABLE.watch).toBe('观察');
    expect(QUANT_STATUS_LABEL_TABLE.waste).toBe('浪费风险');
    expect(QUANT_STATUS_LABEL_TABLE.scale).toBe('可扩量');
    expect(QUANT_STATUS_LABEL_TABLE.blocked).toBe('样本不足');
  });

  it('returns fallback for empty / unknown inputs', () => {
    expect(localizeQuantStatus('')).toBe('样本不足');
    expect(localizeQuantStatus(undefined)).toBe('样本不足');
  });
});
