import React, { useEffect, useMemo, useState } from 'react';
import { ScopeText, useBusinessDataPipeline } from '../components/business-data';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { formatPercent, formatUsd } from '../formatters';
import { useScopeStore } from '../scope-store';
import {
  buildProductManagementSummaries,
  buildProductTimeline,
  type ProductTimelineItem,
} from '../product-management';
import type { AppRoute, BusinessDataPipeline } from '../types';

type ProductManagementRoutes = {
  adQuant: AppRoute;
  recommendations: AppRoute;
  keywordOpportunities: AppRoute;
  listingOptimization: AppRoute;
  operationEvents: AppRoute;
};

export function productManagementActionRoutes(): ProductManagementRoutes {
  return {
    adQuant: 'ad-quant',
    recommendations: 'recommendations',
    keywordOpportunities: 'keyword-opportunities',
    listingOptimization: 'listing-optimization',
    operationEvents: 'operation-events',
  };
}

export function productTimelineScopeLabel(scope: ProductTimelineItem['scope']): string {
  if (scope === 'global') return '全局';
  if (scope === 'ad_object') return '广告对象';
  return '产品';
}

export function productTimelineScopeTone(scope: ProductTimelineItem['scope']): 'ready' | 'pending' | 'warning' {
  if (scope === 'global') return 'pending';
  if (scope === 'ad_object') return 'warning';
  return 'ready';
}

export function buildProductManagementPageModel(input: {
  data: BusinessDataPipeline | null | undefined;
  scopeAsin?: string;
}) {
  const products = buildProductManagementSummaries({
    products: input.data?.productContext?.products || [],
    diagnostics: input.data?.quant?.diagnostics || [],
    ledgers: input.data?.productHistory?.ledgers || [],
    events: input.data?.operations?.events || [],
  });
  const requestedAsin = String(input.scopeAsin || input.data?.scope?.asin || '').trim().toUpperCase();
  const selectedProduct = products.find((item) => item.asin === requestedAsin) || products[0];
  const timeline = selectedProduct
    ? buildProductTimeline({ selectedAsin: selectedProduct.asin, events: input.data?.operations?.events || [] })
    : [];

  return {
    products,
    selectedProduct,
    timeline,
    emptyReason: products.length ? '' : '当前范围还没有产品配置或可识别 ASIN 的广告数据。',
  };
}

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

function stageLabel(stage?: string): string {
  const labels: Record<string, string> = {
    cold_start: '冷启动',
    keyword_exploration: '测词',
    stable_conversion: '稳定转化',
    scaling: '放量',
    profit_harvesting: '利润收割',
    declining_repair: '异常修复',
    unknown: '阶段待判定',
  };
  return labels[stage || 'unknown'] || stage || '阶段待判定';
}

export function ProductManagementPage() {
  const { data, loading, error, scope } = useBusinessDataPipeline();
  const { setScope } = useScopeStore();
  const [selectedAsin, setSelectedAsin] = useState(scope.asin || '');
  const model = useMemo(
    () => buildProductManagementPageModel({ data, scopeAsin: selectedAsin || scope.asin }),
    [data, scope.asin, selectedAsin],
  );
  const routes = productManagementActionRoutes();
  const selected = model.selectedProduct;

  useEffect(() => {
    if (!selectedAsin && scope.asin) setSelectedAsin(scope.asin);
  }, [scope.asin, selectedAsin]);

  function selectProduct(asin: string) {
    setSelectedAsin(asin);
    setScope({ asin, currency: 'USD' });
  }

  function clearProduct() {
    setSelectedAsin('');
    setScope({ asin: undefined, currency: 'USD' });
  }

  return (
    <div>
      <PageHeader
        eyebrow="运营总览"
        title="产品管理"
        description="先选择产品，再关联广告数据、运营事件、AI 量化、关键词和 Listing。"
        primaryTask="按产品管理运营上下文"
        nextAction={selected ? '查看产品详情' : '补齐产品配置'}
      />

      <div className="business-stack">
        <Panel title="当前产品范围" tone={selected ? 'success' : 'warning'}>
          <div className="business-split">
            <div>
              <div className="business-scope-line"><ScopeText scope={scope} /></div>
              <p className="muted-line">
                选中产品后会同步当前 ASIN，广告量化、优化建议、运营事件、关键词机会和 Listing 会沿用该产品上下文。
              </p>
            </div>
            <div className="business-pill-row business-pill-row-right">
              <StatusPill tone={selected ? 'ready' : 'warning'}>
                {selected ? `${selected.title} / ${selected.asin}` : '全部产品'}
              </StatusPill>
              {selected && (
                <button className="secondary-button compact-button" onClick={clearProduct} type="button">
                  查看全部产品
                </button>
              )}
            </div>
          </div>
          {loading && <p className="muted-line">正在读取产品、广告数据和运营事件...</p>}
          {error && <p className="blocked-line">{error}</p>}
        </Panel>

        <Panel title="产品列表" tone={model.products.length ? 'default' : 'warning'}>
          {model.products.length ? (
            <div className="product-management-grid">
              {model.products.map((product) => (
                <button
                  className={`product-management-option ${selected?.asin === product.asin ? 'product-management-option-active' : ''}`}
                  key={product.asin}
                  onClick={() => selectProduct(product.asin)}
                  type="button"
                >
                  <strong>{product.title}</strong>
                  <span>{product.asin} / {product.skuLine}</span>
                  <span>{stageLabel(product.stage)} / {product.status || '状态未配置'} / 事件 {product.eventCount}</span>
                  <span>
                    花费 {formatUsd(product.cost)} / 销售 {formatUsd(product.sales)} / 订单 {product.orders} / ACOS {formatPercent(product.acos * 100)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted-line">{model.emptyReason}</p>
          )}
        </Panel>

        {selected && (
          <>
            <Panel title="产品详情" tone="success">
              <div className="context-summary-grid">
                <div><span>产品</span><strong>{selected.title}</strong><p>{selected.asin} / {selected.skuLine}</p></div>
                <div><span>阶段</span><strong>{stageLabel(selected.stage)}</strong><p>{selected.status || '状态未配置'}</p></div>
                <div>
                  <span>广告表现</span>
                  <strong>{formatUsd(selected.cost)} / {selected.orders} 单</strong>
                  <p>销售 {formatUsd(selected.sales)} / ACOS {formatPercent(selected.acos * 100)}</p>
                </div>
                <div>
                  <span>风险</span>
                  <strong>{selected.highRiskCount} 个高风险对象</strong>
                  <p>诊断 {selected.diagnosticCount} / 事件 {selected.eventCount}</p>
                </div>
              </div>
              <div className="action-row">
                <button className="secondary-button" onClick={() => navigate(routes.operationEvents)} type="button">维护运营事件</button>
                <button className="secondary-button" onClick={() => navigate(routes.keywordOpportunities)} type="button">关键词机会</button>
                <button className="secondary-button" onClick={() => navigate(routes.listingOptimization)} type="button">Listing 优化</button>
                <button className="primary-button" onClick={() => navigate(routes.adQuant)} type="button">进入 AI 量化</button>
              </div>
            </Panel>

            <Panel title="产品运营时间线" tone={model.timeline.length ? 'success' : 'warning'}>
              {model.timeline.length ? (
                <div className="event-timeline">
                  {model.timeline.map((item) => (
                    <article className="event-card product-management-event" key={`${item.event.id}-${item.scope}`}>
                      <div className="event-card-title">
                        <strong>{item.event.eventDate} / {item.event.title}</strong>
                        <StatusPill tone={productTimelineScopeTone(item.scope)}>
                          {productTimelineScopeLabel(item.scope)}
                        </StatusPill>
                      </div>
                      <p>{item.event.eventType} / {item.event.impactExpectation || '影响待观察'}</p>
                      {item.event.notes && <p className="muted-line">{item.event.notes}</p>}
                      {item.event.evidencePath && <p className="mono-line">{item.event.evidencePath}</p>}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted-line">
                  当前产品还没有产品事件或全局事件。记录 Coupon、BD、调价、Listing 或库存变化后，AI 量化会使用这些背景。
                </p>
              )}
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
