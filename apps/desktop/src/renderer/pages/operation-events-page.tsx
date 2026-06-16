import React, { useEffect, useMemo, useState } from 'react';
import { useScopeStore } from '../scope-store';
import { toUserFacingError } from '../user-facing-error';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import type { AppRoute, OperationEventView } from '../types';

const EVENT_TYPE_LABELS: Record<string, string> = {
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

const IMPACT_LABELS: Record<string, string> = {
  conversion_up: '预期转化上升',
  conversion_down: '预期转化下降',
  traffic_up: '预期流量上升',
  traffic_down: '预期流量下降',
  acos_up: '可能推高 ACOS',
  acos_down: '可能降低 ACOS',
  unknown: '影响待观察',
};

const EVENT_USAGE_HINTS: Record<string, string> = {
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

const EVENT_PRESETS = [
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

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

function emptyDraft(scope: ReturnType<typeof useScopeStore.getState>['scope']) {
  return {
    eventDate: scope.dateTo || scope.dateFrom,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin || '',
    campaignName: '',
    adGroupName: '',
    eventType: 'coupon',
    impactExpectation: 'unknown',
    title: '',
    notes: '',
    evidencePath: '',
  };
}

function formatEventType(type: string): string {
  return EVENT_TYPE_LABELS[type] || type;
}

function formatImpact(impact?: string): string {
  if (!impact) return '影响待观察';
  return IMPACT_LABELS[impact] || impact;
}

function formatEventScope(event: OperationEventView): string {
  const parts = [
    event.campaignName ? `Campaign: ${event.campaignName}` : '',
    event.adGroupName ? `Ad group: ${event.adGroupName}` : '',
    event.asin ? `ASIN: ${event.asin}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' / ') : '全店/全范围';
}

export function OperationEventsPage() {
  const { scope } = useScopeStore();
  const [events, setEvents] = useState<OperationEventView[]>([]);
  const [draft, setDraft] = useState(() => emptyDraft(scope));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const eventsByDate = useMemo(() => {
    const groups = new Map<string, OperationEventView[]>();
    for (const event of events) {
      const rows = groups.get(event.eventDate) || [];
      rows.push(event);
      groups.set(event.eventDate, rows);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [events]);

  const selectedTypeHint = EVENT_USAGE_HINTS[draft.eventType] || EVENT_USAGE_HINTS.manual_note;
  const specificEventCount = events.filter((event) => event.asin || event.campaignName || event.adGroupName).length;

  function applyPreset(preset: (typeof EVENT_PRESETS)[number]) {
    setDraft({
      ...draft,
      eventType: preset.eventType,
      impactExpectation: preset.impactExpectation,
      title: preset.title,
      notes: preset.notes,
    });
  }

  async function loadEvents() {
    setLoading(true);
    setError('');
    try {
      const rows = await (window as any).electronAPI.listOperationEvents({
        ...scope,
        limit: 300,
      });
      setEvents(Array.isArray(rows) ? rows : []);
    } catch (caught) {
      setError(toUserFacingError(caught, '读取运营事件失败'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setDraft(emptyDraft(scope));
    loadEvents();
  }, [scope.dateFrom, scope.dateTo, scope.storeName, scope.marketplaceCode, scope.asin]);

  async function saveEvent() {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await (window as any).electronAPI.createOperationEvent({
        ...draft,
        asin: draft.asin || undefined,
        campaignName: draft.campaignName || undefined,
        adGroupName: draft.adGroupName || undefined,
        notes: draft.notes || undefined,
        evidencePath: draft.evidencePath || undefined,
      });
      setDraft(emptyDraft(scope));
      setMessage('运营事件已记录，会进入广告量化和 AI 诊断上下文。');
      await loadEvents();
    } catch (caught) {
      setError(toUserFacingError(caught, '保存运营事件失败'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent(id: number) {
    setError('');
    setMessage('');
    try {
      await (window as any).electronAPI.deleteOperationEvent(id);
      setMessage('运营事件已删除。');
      await loadEvents();
    } catch (caught) {
      setError(toUserFacingError(caught, '删除运营事件失败'));
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="数据与量化"
        title="运营事件"
        description="记录折扣、BD、大促、价格、Listing、库存和站外动作。AI 分析广告波动时会读取这些上下文，避免只看广告数据误判。"
        primaryTask="补齐广告数据上下文"
        nextAction={events.length ? '进入广告量化' : '先记录关键事件'}
      />

      <div className="business-stack">
        <Panel title="当前范围与作用" tone="success">
          <div className="business-split">
            <div>
              <div className="business-scope-line">
                {scope.dateFrom} 至 {scope.dateTo} / {scope.storeName} / {scope.marketplaceCode} / USD
              </div>
              <p className="muted-line">
                当前范围内的事件会进入广告量化、AI 阶段判断和动态阈值建议。第一版由运营手动维护，后续可接入领星/亚马逊活动、价格和库存数据。
              </p>
            </div>
            <StatusPill tone={events.length ? 'ready' : 'pending'}>
              当前事件 {events.length}
            </StatusPill>
          </div>
        </Panel>

        <div className="page-grid operation-context-grid">
          <Panel title="AI 与规则如何使用这些事件">
            <div className="operation-impact-grid">
              <div>
                <span>广告量化</span>
                <strong>解释阈值变化</strong>
                <p>规则仍先按 ACOS、点击、花费和订单算风险；事件用于解释为什么今天的阈值可能要更保守或更宽松。</p>
              </div>
              <div>
                <span>DeepSeek / AI</span>
                <strong>判断产品推广阶段</strong>
                <p>AI 会把每日广告事实、活动事件、价格和 Listing 变化一起看，区分冷启动、测词、放量、稳定和异常修复。</p>
              </div>
              <div>
                <span>执行边界</span>
                <strong>只影响建议，不自动执行</strong>
                <p>事件不会直接改广告。所有降价、否词、暂停或放量仍必须走建议、审批、执行和 readback。</p>
              </div>
            </div>
          </Panel>

          <Panel title="当前事件覆盖">
            <div className="operation-summary-grid">
              <div>
                <span>总事件</span>
                <strong>{events.length}</strong>
              </div>
              <div>
                <span>绑定对象</span>
                <strong>{specificEventCount}</strong>
              </div>
              <div>
                <span>全范围事件</span>
                <strong>{Math.max(0, events.length - specificEventCount)}</strong>
              </div>
            </div>
            <div className="action-row">
              <button className="secondary-button" onClick={() => navigate('ad-quant')} type="button">
                查看广告量化
              </button>
              <button className="primary-button" onClick={() => navigate('recommendations')} type="button">
                生成 AI+规则建议
              </button>
            </div>
          </Panel>
        </div>

        <Panel title="新增运营事件">
          <div className="quick-template-row" aria-label="运营事件快速模板">
            {EVENT_PRESETS.map((preset) => (
              <button
                className="secondary-button compact-button"
                key={preset.label}
                onClick={() => applyPreset(preset)}
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="form-grid form-grid-four">
            <label>
              事件日期
              <input
                type="date"
                value={draft.eventDate}
                onChange={(event) => setDraft({ ...draft, eventDate: event.target.value })}
              />
            </label>
            <label>
              店铺
              <input
                value={draft.storeName}
                onChange={(event) => setDraft({ ...draft, storeName: event.target.value })}
              />
            </label>
            <label>
              站点
              <input
                value={draft.marketplaceCode}
                onChange={(event) => setDraft({ ...draft, marketplaceCode: event.target.value })}
              />
            </label>
            <label>
              ASIN
              <input
                placeholder="可选；留空表示全店/全范围"
                value={draft.asin}
                onChange={(event) => setDraft({ ...draft, asin: event.target.value })}
              />
            </label>
            <label>
              广告活动
              <input
                placeholder="可选；用于绑定具体 campaign"
                value={draft.campaignName}
                onChange={(event) => setDraft({ ...draft, campaignName: event.target.value })}
              />
            </label>
            <label>
              广告组
              <input
                placeholder="可选；用于绑定具体 ad group"
                value={draft.adGroupName}
                onChange={(event) => setDraft({ ...draft, adGroupName: event.target.value })}
              />
            </label>
            <label>
              事件类型
              <select
                value={draft.eventType}
                onChange={(event) => setDraft({ ...draft, eventType: event.target.value })}
              >
                {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              预期影响
              <select
                value={draft.impactExpectation}
                onChange={(event) => setDraft({ ...draft, impactExpectation: event.target.value })}
              >
                {Object.entries(IMPACT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="form-span-two">
              事件标题
              <input
                placeholder="例如：10% Coupon 开始、大促报名、主图更新"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <label className="form-span-two">
              证据路径
              <input
                placeholder="可选：截图、活动页面或本地证明文件路径"
                value={draft.evidencePath}
                onChange={(event) => setDraft({ ...draft, evidencePath: event.target.value })}
              />
            </label>
            <label className="form-span-four">
              备注
              <textarea
                placeholder="说明活动力度、价格、库存、Listing 调整点或需要 AI 注意的背景"
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              />
            </label>
          </div>
          <div className="operation-hint">
            <strong>{formatEventType(draft.eventType)}</strong>
            <p>{selectedTypeHint}</p>
          </div>
          <div className="action-row">
            <button
              className="primary-button"
              disabled={saving || !draft.eventDate || !draft.storeName || !draft.marketplaceCode || !draft.title}
              onClick={saveEvent}
              type="button"
            >
              {saving ? '正在保存...' : '记录事件'}
            </button>
            <button className="secondary-button" onClick={loadEvents} type="button">刷新</button>
          </div>
          {message && <p className="ready-line">{message}</p>}
          {error && <p className="blocked-line">{error}</p>}
        </Panel>

        <Panel title="事件时间线" tone={events.length ? 'default' : 'warning'}>
          {loading && <p className="muted-line">正在读取运营事件...</p>}
          {!loading && eventsByDate.length === 0 && (
            <p className="muted-line">当前范围还没有运营事件。若近期做过折扣、BD、价格、Listing 或库存动作，应先记录，否则 AI 只能看广告表格。</p>
          )}
          <div className="event-timeline">
            {eventsByDate.map(([date, rows]) => (
              <div className="event-day" key={date}>
                <div className="event-day-date">{date}</div>
                <div className="event-cards">
                  {rows.map((event) => (
                    <article className="event-card" key={event.id}>
                      <div className="event-card-title">
                        <strong>{event.title}</strong>
                        <StatusPill tone="pending">{formatEventType(event.eventType)}</StatusPill>
                      </div>
                      <p>{formatImpact(event.impactExpectation)} / {formatEventScope(event)}</p>
                      {event.notes && <p className="muted-line">{event.notes}</p>}
                      {event.evidencePath && <p className="mono-line">{event.evidencePath}</p>}
                      <div className="action-row">
                        <button className="secondary-button compact-button" onClick={() => deleteEvent(event.id)} type="button">删除</button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
