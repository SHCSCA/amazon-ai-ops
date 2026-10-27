
import { useScopeStore } from '../scope-store';

import { PAGE_HEADER_TITLES } from '../page-header-copy';
import type { AppRoute, OperationEventView } from '../types';

export const OPERATION_EVENT_PAGE_COPY = {
  title: PAGE_HEADER_TITLES.operationEvents,
  description: '把 Coupon、BD、大促、调价、库存、Listing 和站外动作挂载进 LLM 推理上下文，AI 解释广告波动时会读取这些时间轴标记，避免只看广告表格误判。',
  primaryTask: '把关键运营动作标记进 LLM 上下文',
  timelinePanelTitle: '运营事件时间轴',
  newEventPanelTitle: '新增运营事件',
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  coupon: 'Coupon / 折扣券',
  deal: 'Deal / 促销活动',
  bd: 'BD 秒杀',
  ld: 'LD 秒杀',
  promotion: '大促 / 活动',
  price_change: '价格调整',
  listing_change: 'Listing 修改',
  external_traffic: '站外流量',
  offsite_promotion: '站外推广',
  inventory: '库存变化',
  inventory_issue: '库存异常',
  review_change: '评分 / Review 变化',
  note: '人工备注',
  manual_note: '人工备注',
};

export const IMPACT_LABELS: Record<string, string> = {
  conversion_up: '预期转化上升',
  conversion_down: '预期转化下降',
  traffic_up: '预期流量上升',
  traffic_down: '预期流量下降',
  acos_up: '可能推高 ACOS',
  acos_down: '可能降低 ACOS',
  unknown: '影响待观察',
};

export const EVENT_USAGE_HINTS: Record<string, string> = {
  coupon: '优惠券通常会抬高转化预期。AI 会允许短期测试花费，但会重点检查 Coupon 期间是否仍然无订单或 ACOS 失控。',
  deal: '促销活动会改变正常转化基线。AI 会把 Deal 窗口和普通日期拆开解释，避免误判是否应该加价或降价。',
  bd: 'BD/秒杀会改变流量和转化基线。AI 会把活动日单独解释，避免把活动流量误判为自然稳定放量。',
  ld: 'LD/秒杀适合标记短期流量峰值。后续复盘会比较活动前、中、后的点击、订单和 ACOS。',
  promotion: '大促会放大曝光和预算消耗。AI 会结合阶段判断是放量窗口、测词窗口，还是高风险消耗。',
  price_change: '价格变化会直接影响 CVR 和 ACOS。调价当天前后的广告阈值不能用同一套解释。',
  listing_change: 'Listing 修改会影响点击率和转化率。AI 会把标题、主图、五点或 backend terms 的变化纳入广告波动解释。',
  external_traffic: '站外流量可能带来非广告归因波动。AI 会降低对单日转化异常的误判。',
  offsite_promotion: '站外推广可能带来非广告归因波动。AI 会降低对单日转化异常的误判。',
  inventory: '库存变化会影响广告扩量空间。AI 会把库存充足、低库存或补货窗口作为动作风险背景。',
  inventory_issue: '库存异常会使广告表现失真。AI 会避免在缺货、断货、低库存期间给出激进加价或扩量建议。',
  review_change: '评分和 Review 变化会改变转化基础。AI 会检查转化下滑是否可能来自口碑变化，而不是关键词本身。',
  note: '人工备注用于记录其他影响广告判断的信息，会作为 AI 背景，但不会直接触发执行动作。',
  manual_note: '人工备注用于记录其他影响广告判断的信息，会作为 AI 背景，但不会直接触发执行动作。',
};

export const EVENT_PRESETS = [
  {
    label: 'Coupon/折扣',
    eventType: 'coupon',
    impactExpectation: 'conversion_up',
    title: 'Coupon 开始',
    notes: '填写折扣力度、开始/结束时间、是否只覆盖当前 ASIN。',
  },
  {
    label: 'BD/秒杀',
    eventType: 'bd',
    impactExpectation: 'traffic_up',
    title: 'BD 活动开始',
    notes: '填写活动价、活动时段、库存准备和报名 ASIN。',
  },
  {
    label: '大促',
    eventType: 'promotion',
    impactExpectation: 'traffic_up',
    title: '大促活动窗口',
    notes: '填写活动类型、预算策略、是否允许短期 ACOS 上浮。',
  },
  {
    label: 'Deal/促销',
    eventType: 'deal',
    impactExpectation: 'conversion_up',
    title: 'Deal 促销开始',
    notes: '填写活动类型、活动价、持续时间、关联 ASIN 和预算策略。',
  },
  {
    label: '调价',
    eventType: 'price_change',
    impactExpectation: 'conversion_down',
    title: '产品价格调整',
    notes: '填写原价、新价、生效时间；AI 会复核调价前后 CVR/ACOS。',
  },
  {
    label: '库存异常',
    eventType: 'inventory_issue',
    impactExpectation: 'conversion_down',
    title: '库存异常或断货风险',
    notes: '填写可售库存、预计补货时间；避免 AI 给出扩量建议。',
  },
  {
    label: 'Listing 修改',
    eventType: 'listing_change',
    impactExpectation: 'unknown',
    title: 'Listing 内容修改',
    notes: '填写标题、主图、五点、A+ 或 backend terms 的具体变化。',
  },
];

export function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

export type OperationEventViewMode = 'product' | 'global' | 'all';

export function defaultOperationEventViewMode(scopeAsin?: string): OperationEventViewMode {
  return normalizeAsin(scopeAsin) ? 'product' : 'all';
}

export function filterOperationEventsForView(
  events: OperationEventView[],
  mode: OperationEventViewMode,
  selectedAsin?: string,
): OperationEventView[] {
  const asin = normalizeAsin(selectedAsin);
  return (events || []).filter((event) => {
    const eventAsin = normalizeAsin(event.asin);
    const hasAdObject = Boolean(event.campaignName || event.adGroupName);
    const isGlobal = !eventAsin && !hasAdObject;
    if (mode === 'global') return isGlobal;
    if (mode === 'product') return isGlobal || Boolean(asin && eventAsin === asin);
    return true;
  });
}

export function buildOperationEventDraftForScope(
  scope: ReturnType<typeof useScopeStore.getState>['scope'],
  mode: OperationEventViewMode,
) {
  return {
    eventDate: scope.dateTo || scope.dateFrom,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: mode === 'product' ? scope.asin || '' : '',
    campaignName: '',
    adGroupName: '',
    eventType: 'coupon',
    impactExpectation: 'unknown',
    title: '',
    notes: '',
    evidencePath: '',
  };
}

export function operationEventScopeLabel(event: OperationEventView, selectedAsin?: string): string {
  const eventAsin = normalizeAsin(event.asin);
  const hasAdObject = Boolean(event.campaignName || event.adGroupName);
  if (!eventAsin && !hasAdObject) return '全局';
  if (hasAdObject) return '广告对象';
  if (eventAsin && eventAsin === normalizeAsin(selectedAsin)) return '产品';
  return '其他产品';
}

export function operationEventCardClassName(eventId: number, recentSavedEventId?: number | null): string {
  return eventId === recentSavedEventId ? 'event-card event-card-just-saved' : 'event-card';
}

export function operationEventTimelineCardView(
  event: OperationEventView,
  selectedAsin?: string,
  recentSavedEventId?: number | null,
) {
  const scopeLabel = operationEventScopeLabel(event, selectedAsin);
  const impactLabel = formatImpact(event.impactExpectation);
  const eventAsin = normalizeAsin(event.asin);
  const contextTarget = scopeLabel === '产品' && eventAsin
    ? `产品 ${eventAsin}`
    : scopeLabel === '广告对象'
      ? formatEventScope(event)
      : '全店/全范围';

  return {
    ariaLabel: `${event.title}，${scopeLabel}事件，${impactLabel}，将进入 AI 上下文`,
    className: [
      operationEventCardClassName(event.id, recentSavedEventId),
      'event-card-ai-context-ready',
    ].join(' '),
    contextDetail: `已绑定${contextTarget}，${impactLabel}，广告表现和 AI 诊断会读取。`,
    contextLabel: 'AI 上下文',
    scopeLabel,
  };
}

export function operationEventInlineSaveLabel(saving: boolean): string {
  return saving ? '正在保存...' : '保存到上下文';
}

export interface OperationEventInlineSaveButtonInput {
  baseClassName: string;
  canSave: boolean;
  saving: boolean;
}

export interface OperationEventInlineSaveButtonView {
  ariaBusy?: true;
  className: string;
  disabled: boolean;
  label: string;
  showSpinner: boolean;
}

export function operationEventInlineSaveButtonView(input: OperationEventInlineSaveButtonInput): OperationEventInlineSaveButtonView {
  return {
    ariaBusy: input.saving ? true : undefined,
    className: [input.baseClassName, input.saving ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: input.saving || !input.canSave,
    label: input.saving ? '保存中...' : '保存到上下文',
    showSpinner: input.saving,
  };
}

export function operationEventRefreshButtonView(loading: boolean): OperationEventInlineSaveButtonView {
  return {
    ariaBusy: loading ? true : undefined,
    className: ['secondary-button', loading ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: loading,
    label: loading ? '刷新中...' : '刷新',
    showSpinner: loading,
  };
}

export function operationEventRowDeleteButtonView(input: {
  eventId: number;
  deletingEventId?: number | null;
}): OperationEventInlineSaveButtonView {
  const active = input.deletingEventId === input.eventId;
  const locked = input.deletingEventId != null;
  return {
    ariaBusy: active ? true : undefined,
    className: ['secondary-button compact-button', active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: locked,
    label: active ? '归档中...' : '归档',
    showSpinner: active,
  };
}

export function operationEventFormClassName(recentlyCleared: boolean): string {
  return recentlyCleared ? 'operation-event-form operation-event-form-cleared' : 'operation-event-form';
}

export function buildOperationEventTaskState(input: {
  visibleEventCount: number;
  totalEventCount: number;
  specificEventCount: number;
  viewMode: OperationEventViewMode;
  selectedAsin?: string;
  canSave: boolean;
  saving: boolean;
}) {
  const scopeText = input.viewMode === 'product' && normalizeAsin(input.selectedAsin)
    ? `当前产品 ${normalizeAsin(input.selectedAsin)}`
    : input.viewMode === 'global'
      ? '全店/全范围'
      : '全部事件';
  return {
    title: input.visibleEventCount
      ? `${scopeText}已有 ${input.visibleEventCount} 条运营事件`
      : `${scopeText}还缺运营事件上下文`,
    detail: input.visibleEventCount
      ? `其中 ${input.specificEventCount} 条绑定产品或广告对象；AI 会在广告表现和建议解释时读取这些事件。`
      : `先为${scopeText}记录 Coupon、BD、调价、库存或 Listing 变化，避免 AI 只看广告表格误判波动原因。`,
    primaryActionLabel: input.saving ? '正在保存...' : '记录事件',
    primaryActionBusy: input.saving,
    primaryActionBusyLabel: '正在保存...',
    primaryActionDisabled: input.saving,
    secondaryActionLabel: '查看广告表现',
  };
}

export function normalizeAsin(value?: string): string {
  return String(value || '').trim().toUpperCase();
}

export function formatEventType(type: string): string {
  return EVENT_TYPE_LABELS[type] || type;
}

export function formatImpact(impact?: string): string {
  if (!impact) return '影响待观察';
  return IMPACT_LABELS[impact] || impact;
}

export function formatEventScope(event: OperationEventView): string {
  const parts = [
    event.campaignName ? `Campaign: ${event.campaignName}` : '',
    event.adGroupName ? `Ad group: ${event.adGroupName}` : '',
    event.asin ? `ASIN: ${event.asin}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' / ') : '全店/全范围';
}
