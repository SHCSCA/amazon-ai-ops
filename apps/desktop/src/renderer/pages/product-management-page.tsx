import React, { useEffect, useMemo, useState } from 'react';
import { ScopeText, useBusinessDataPipeline } from '../components/business-data';
import { OperatorTaskPanel } from '../components/operator-task-panel';
import { FormTable, FormTableRow, KpiCard, PageHeader, Panel, StatusPill } from '../components/ui';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import { formatPercent, formatUsd } from '../formatters';
import { useScopeStore } from '../scope-store';
import { buildCostInputFromProduct, DEFAULT_COST, productCostInputHint } from './product-config-page';
import {
  buildProductManagementSummaries,
  buildProductTimeline,
  type ProductTimelineItem,
} from '../product-management';
import type { AppRoute, BusinessDataPipeline, OperationScope } from '../types';
import { toUserFacingError } from '../user-facing-error';

type ProductManagementRoutes = {
  adQuant: AppRoute;
  recommendations: AppRoute;
  keywordOpportunities: AppRoute;
  listingOptimization: AppRoute;
  operationEvents: AppRoute;
  productConfig: AppRoute;
};

export function productManagementActionRoutes(): ProductManagementRoutes {
  return {
    adQuant: 'ad-quant',
    recommendations: 'recommendations',
    keywordOpportunities: 'keyword-opportunities',
    listingOptimization: 'listing-optimization',
    operationEvents: 'operation-events',
    productConfig: 'product-config',
  };
}

type ProductStage = 'cold_start' | 'keyword_exploration' | 'stable_conversion' | 'scaling' | 'profit_harvesting' | 'declining_repair';

const STAGE_OPTIONS: Array<{ value: ProductStage; label: string }> = [
  { value: 'cold_start', label: '冷启动' },
  { value: 'keyword_exploration', label: '测词期' },
  { value: 'stable_conversion', label: '稳定转化' },
  { value: 'scaling', label: '放量期' },
  { value: 'profit_harvesting', label: '利润收割' },
  { value: 'declining_repair', label: '异常修复' },
];

export const PRODUCT_QUICK_COST_FIELDS = [
  { key: 'purchaseCost', label: '采购成本', placeholder: '例如 103.00' },
  { key: 'fbaFee', label: 'FBA 费用', placeholder: '例如 6.00' },
  { key: 'minPrice', label: '最低可接受售价', placeholder: '例如 39.99' },
] as const;

export const PRODUCT_QUICK_TARGET_FIELDS = [
  { key: 'targetAcos', label: '目标 ACOS', placeholder: '例如 0.35' },
  { key: 'targetTacos', label: '目标 TACOS', placeholder: '例如 0.12' },
  { key: 'targetNetMargin', label: '目标净利率', placeholder: '例如 0.15' },
] as const;

function buildDraftFromProduct(product: any, scopeAsin?: string) {
  return {
    asin: product?.asin || scopeAsin || '',
    parentAsin: product?.parentAsin || product?.parent_asin || '',
    msku: product?.msku || '',
    sku: product?.sku || '',
    title: product?.title || '',
    productStage: (product?.productStage || product?.product_stage || 'keyword_exploration') as ProductStage,
    status: product?.status || 'active',
  };
}

function toNumber(value: string | number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
  const canonicalAsin = String(input.scopeAsin || '').trim().toUpperCase();
  const requestedAsin = canonicalAsin || String(input.data?.scope?.asin || '').trim().toUpperCase();
  const products = buildProductManagementSummaries({
    products: input.data?.productContext?.products || [],
    diagnostics: input.data?.quant?.diagnostics || [],
    ledgers: input.data?.productHistory?.ledgers || [],
    events: input.data?.operations?.events || [],
    canonicalSummary: input.data?.quant && canonicalAsin
      ? {
          asin: canonicalAsin,
          cost: input.data.quant.totalSpend,
          sales: input.data.quant.totalSales,
          orders: input.data.quant.totalOrders,
          clicks: input.data.quant.totalClicks,
        }
      : undefined,
  });
  const selectedProduct = requestedAsin
    ? products.find((item) => item.asin === requestedAsin)
    : undefined;
  const timeline = selectedProduct
    ? buildProductTimeline({ selectedAsin: selectedProduct.asin, events: input.data?.operations?.events || [] })
    : [];
  const selectedLedger = selectedProduct
    ? (input.data?.productHistory?.ledgers || []).find((ledger) => ledger.asin.toUpperCase() === selectedProduct.asin.toUpperCase())
    : undefined;

  return {
    products,
    selectedProduct,
    selectedDailyRows: selectedLedger?.daily || [],
    timeline,
    emptyReason: products.length ? '' : '当前范围还没有产品配置或可识别 ASIN 的广告数据。',
  };
}

type ProductManagementPageModel = ReturnType<typeof buildProductManagementPageModel>;
type ProductManagementTaskFeedbackTone = 'ready' | 'pending' | 'warning' | 'blocked';

interface ProductManagementActionButtonInput {
  active: boolean;
  baseClassName: string;
  label: string;
  busyLabel: string;
  disabled?: boolean;
  groupBusy?: boolean;
}

export interface ProductManagementActionButtonView {
  ariaBusy?: true;
  className: string;
  disabled: boolean;
  label: string;
  showSpinner: boolean;
}

export function productManagementActionButtonView({
  active,
  baseClassName,
  label,
  busyLabel,
  disabled = false,
  groupBusy = false,
}: ProductManagementActionButtonInput): ProductManagementActionButtonView {
  return {
    ariaBusy: active ? true : undefined,
    className: [baseClassName, active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(disabled || active || groupBusy),
    label: active ? busyLabel : label,
    showSpinner: active,
  };
}

export function buildCredentialSandboxSummary(scope: Pick<OperationScope, 'dateFrom' | 'dateTo' | 'storeName' | 'marketplaceCode'>) {
  const period = String(scope.dateTo || scope.dateFrom || 'local').slice(0, 7) || 'local';
  const marketplace = String(scope.marketplaceCode || 'LOCAL').trim().toUpperCase() || 'LOCAL';
  const sandboxId = `#FL-${marketplace}-${period}`;

  return {
    label: '凭证映射通过',
    status: 'Main 托管',
    sandboxId,
    scopeLine: `${marketplace} / ${period} / UI 不作明文留存`,
    detail: 'login-credentials 已托管至 Main 物理加密区；Renderer 只接收状态和通道 ID，不保存账号或密码明文。',
  };
}

export function buildProductManagementTaskState(input: {
  model: ProductManagementPageModel;
  loading: boolean;
  error?: string | null;
  saving: boolean;
  saveMessage?: string;
  saveError?: string;
  importedRows: number;
  hasImportedMetrics: boolean;
}) {
  const routes = productManagementActionRoutes();
  const selected = input.model.selectedProduct;
  const productCount = input.model.products.length;

  let title = '先选择一个产品';
  let detail = '点击下方产品卡片后会写入全局 ASIN，后续广告量化、优化建议、运营事件、关键词和 Listing 都按该产品读取数据库。';
  let primaryActionLabel = productCount ? '补齐产品配置' : '补齐产品配置';
  let primaryRoute: AppRoute = routes.productConfig;
  let primaryActionDisabled = false;
  let primaryActionBusy = false;
  let primaryBusyLabel = '读取中...';
  let feedbackLabel = productCount ? '未锁定产品上下文' : '缺少产品配置';
  let feedbackDetail = productCount ? '先点选一个产品，避免后续页面误用第一条 ASIN。' : input.model.emptyReason;
  let feedbackTone: ProductManagementTaskFeedbackTone = 'warning';
  let secondaryActions: Array<{ label: string; route: AppRoute; disabled?: boolean }> = [
    { label: '指标核验入库', route: 'data-import-validation' },
  ];

  if (input.loading) {
    title = '正在读取产品上下文';
    detail = '正在读取产品、广告指标、日级账本和运营事件，读取完成后再锁定产品。';
    primaryActionLabel = '读取中...';
    primaryRoute = routes.productConfig;
    primaryActionDisabled = true;
    primaryActionBusy = true;
    feedbackLabel = '读取产品数据';
    feedbackDetail = '请等待当前数据管道返回，按钮已锁定防止重复操作。';
    feedbackTone = 'pending';
    secondaryActions = [];
  } else if (input.error) {
    title = '产品数据读取失败';
    detail = '产品管理依赖当前范围、产品配置、广告指标和运营事件；先处理读取错误后再继续。';
    primaryActionLabel = '回到工作范围';
    primaryRoute = 'operation-scope';
    feedbackLabel = '读取失败';
    feedbackDetail = input.error;
    feedbackTone = 'blocked';
    secondaryActions = [{ label: '指标核验入库', route: 'data-import-validation' }];
  } else if (!productCount) {
    title = '先补齐产品配置';
    detail = '当前范围没有可识别产品。先建立 ASIN、标题、SKU、成本和目标阈值，再进入广告量化。';
    primaryActionLabel = '补齐产品配置';
    primaryRoute = routes.productConfig;
    secondaryActions = [{ label: '指标核验入库', route: 'data-import-validation' }];
  } else if (selected && !input.hasImportedMetrics) {
    title = `当前产品：${selected.title}`;
    detail = `${selected.asin} 已锁定为产品上下文；当前缺少导入广告指标，先完成真实报表入库后再运行 AI。`;
    primaryActionLabel = '先导入广告指标';
    primaryRoute = 'data-import-validation';
    feedbackLabel = '缺少导入指标';
    feedbackDetail = `当前产品只有 ${input.importedRows} 行广告指标，AI 量化和优化建议暂不作为主动作。`;
    feedbackTone = 'warning';
    secondaryActions = [
      { label: '维护运营事件', route: routes.operationEvents },
      { label: '打开完整配置', route: routes.productConfig },
    ];
  } else if (selected) {
    title = `当前产品：${selected.title}`;
    detail = `${selected.asin} 已作为广告量化、优化建议、运营事件、关键词和 Listing 的共享上下文。`;
    primaryActionLabel = '进入 AI 量化';
    primaryRoute = routes.adQuant;
    feedbackLabel = '已锁定产品上下文';
    feedbackDetail = `${input.importedRows} 行广告指标可用于当前产品分析。`;
    feedbackTone = 'ready';
    secondaryActions = [
      { label: '维护运营事件', route: routes.operationEvents },
      { label: '关键词机会', route: routes.keywordOpportunities },
      { label: 'Listing 优化', route: routes.listingOptimization },
    ];
  }

  if (input.saving) {
    feedbackLabel = '正在保存产品信息';
    feedbackDetail = '保存成功后会同步当前 ASIN 到全局范围。';
    feedbackTone = 'pending';
  } else if (input.saveError) {
    feedbackLabel = '保存失败';
    feedbackDetail = input.saveError;
    feedbackTone = 'blocked';
  } else if (input.saveMessage) {
    feedbackLabel = '产品信息已保存';
    feedbackDetail = input.saveMessage;
    feedbackTone = 'ready';
  }

  return {
    title,
    detail,
    primaryActionLabel,
    primaryRoute,
    primaryActionDisabled,
    primaryActionBusy,
    primaryBusyLabel,
    feedbackLabel,
    feedbackDetail,
    feedbackTone,
    secondaryActions,
  };
}

export function buildProductManagementOptionView(input: {
  selected: boolean;
  productTitle: string;
  asin: string;
  hasImportedMetrics: boolean;
  dailyDays: number;
}) {
  const className = [
    'product-management-option',
    input.selected ? 'product-management-option-active product-management-option-locked' : '',
  ].filter(Boolean).join(' ');
  const actionTag = input.selected ? '已锁定' : '点击锁定';
  const statusLine = input.selected
    ? `${input.productTitle} / ${input.asin} 已锁定，工具栏已解冻，后续页面按 ${input.asin} 读取数据库。${input.hasImportedMetrics ? `日级 ${input.dailyDays} 天可用于产品分析。` : '当前缺少导入指标，先去指标核验入库。'}`
    : `点击锁定 ${input.productTitle} / ${input.asin}，后续页面会按该产品读取数据库。`;

  return {
    className,
    ariaPressed: input.selected,
    actionTag,
    statusLine,
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
  const selectedContext = useMemo(() => (
    (data?.productContext?.products || []).find((product) => selected?.asin && product.asin.toUpperCase() === selected.asin.toUpperCase())
  ), [data?.productContext?.products, selected?.asin]);
  const [draft, setDraft] = useState(() => buildDraftFromProduct(selectedContext || selected, scope.asin));
  const [cost, setCost] = useState(DEFAULT_COST);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const importedRows = data?.quant?.importedRows ?? 0;
  const hasImportedMetrics = Boolean(data?.quant?.hasImportedMetrics && importedRows > 0);
  const credentialSandbox = useMemo(
    () => buildCredentialSandboxSummary(scope),
    [scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName],
  );
  const taskState = useMemo(
    () => buildProductManagementTaskState({
      model,
      loading,
      error,
      saving,
      saveMessage,
      saveError,
      importedRows,
      hasImportedMetrics,
    }),
    [error, hasImportedMetrics, importedRows, loading, model, saveError, saveMessage, saving],
  );
  const productActionBusy = saving;
  const saveProductButton = productManagementActionButtonView({
    active: saving,
    baseClassName: 'primary-button',
    busyLabel: '保存中...',
    disabled: !draft.asin.trim(),
    label: '保存产品信息',
  });
  const openConfigButton = productManagementActionButtonView({
    active: false,
    baseClassName: 'secondary-button',
    busyLabel: '处理中...',
    groupBusy: productActionBusy,
    label: '打开完整配置',
  });
  const selectedOptionFeedback = useMemo(
    () => selected
      ? buildProductManagementOptionView({
          selected: true,
          productTitle: selected.title,
          asin: selected.asin,
          hasImportedMetrics,
          dailyDays: model.selectedDailyRows.length,
        })
      : null,
    [hasImportedMetrics, model.selectedDailyRows.length, selected],
  );

  useEffect(() => {
    if (!selectedAsin && scope.asin) setSelectedAsin(scope.asin);
  }, [scope.asin, selectedAsin]);

  useEffect(() => {
    setDraft(buildDraftFromProduct(selectedContext || selected, selected?.asin || scope.asin));
    setCost(buildCostInputFromProduct(selectedContext || {}));
    setSaveMessage('');
    setSaveError('');
  }, [scope.asin, selected, selectedContext]);

  function selectProduct(asin: string) {
    setSelectedAsin(asin);
    setScope({ asin, currency: 'USD' });
  }

  function clearProduct() {
    setSelectedAsin('');
    setScope({ asin: undefined, currency: 'USD' });
  }

  function updateCost(key: keyof typeof cost, value: string) {
    setCost((current) => ({ ...current, [key]: toNumber(value) }));
  }

  async function saveProduct() {
    setSaving(true);
    setSaveMessage('');
    setSaveError('');
    try {
      if (!draft.asin.trim()) throw new Error('请填写 ASIN。');
      const result = await (window as any).electronAPI?.saveProductConfig?.({
        product: {
          ...draft,
          asin: draft.asin.trim().toUpperCase(),
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
        },
        cost,
      });
      if (!result?.success) throw new Error('保存接口没有返回成功状态。');
      const nextAsin = draft.asin.trim().toUpperCase();
      setSelectedAsin(nextAsin);
      setScope({ asin: nextAsin, currency: 'USD' });
      setSaveMessage('产品信息已保存，当前工作台已切换到该产品。');
      window.dispatchEvent(new Event('business-ui:data-updated'));
    } catch (caught) {
      setSaveError(toUserFacingError(caught, '保存产品信息失败。'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="运营总览"
        title={PAGE_HEADER_TITLES.productManagement}
        description="先选择产品，再关联广告数据、运营事件、AI 量化、关键词和 Listing。"
        primaryTask="按产品管理运营上下文"
        nextAction={selected ? '查看产品详情' : '补齐产品配置'}
      />

      <div className="business-stack">
        <OperatorTaskPanel
          eyebrow="产品作战台"
          title={taskState.title}
          detail={taskState.detail}
          primaryAction={{
            label: taskState.primaryActionLabel,
            disabled: taskState.primaryActionDisabled,
            busy: taskState.primaryActionBusy,
            busyLabel: taskState.primaryBusyLabel,
            onClick: () => navigate(taskState.primaryRoute),
          }}
          secondaryActions={taskState.secondaryActions.map((action) => ({
            label: action.label,
            disabled: action.disabled,
            onClick: () => navigate(action.route),
          }))}
        >
          <div className="kpi-row kpi-row--task" aria-label="产品管理任务摘要">
            <KpiCard
              label="产品池"
              value={`${model.products.length} 个`}
              detail={selected ? '已锁定当前产品' : '等待选择 ASIN'}
              tone={selected ? 'ready' : 'pending'}
            />
            <KpiCard
              label="当前产品"
              value={selected ? selected.title : '未锁定'}
              detail={selected ? selected.asin : '避免默认取第一条'}
              tone={selected ? 'ready' : 'warning'}
            />
            <KpiCard
              label="入库指标"
              value={`${importedRows} 行`}
              detail={hasImportedMetrics ? '可进入量化' : '先导入真实报表'}
              tone={hasImportedMetrics ? 'ready' : 'blocked'}
            />
            <KpiCard
              label="日级账本"
              value={`${model.selectedDailyRows.length} 天`}
              detail="按产品查看趋势"
              tone={model.selectedDailyRows.length ? 'ready' : 'pending'}
            />
          </div>
          <div className="dashboard-task-metrics" aria-label="产品管理凭证摘要">
            <span
              aria-describedby="product-management-credential-sandbox-popover"
              aria-label={`${credentialSandbox.label}，${credentialSandbox.status}，${credentialSandbox.detail}`}
              className="credential-sandbox-chip"
              tabIndex={0}
            >
              <span aria-hidden="true" className="credential-sandbox-chip-dot" />
              <span>{credentialSandbox.label}</span>
              <strong>{credentialSandbox.status}</strong>
              <span
                className="credential-sandbox-popover"
                id="product-management-credential-sandbox-popover"
                role="tooltip"
              >
                <strong>Main Sandboxed ID: {credentialSandbox.sandboxId}</strong>
                <span>{credentialSandbox.detail}</span>
                <small>{credentialSandbox.scopeLine}</small>
              </span>
            </span>
          </div>
          <div
            aria-live="polite"
            className={`product-management-task-feedback product-management-task-feedback-${taskState.feedbackTone}`}
            role="status"
          >
            <span>{taskState.feedbackLabel}</span>
            <strong>{taskState.feedbackDetail}</strong>
          </div>
        </OperatorTaskPanel>

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
              {model.products.map((product) => {
                const isProductSelected = selected?.asin === product.asin;
                const optionView = buildProductManagementOptionView({
                  selected: isProductSelected,
                  productTitle: product.title,
                  asin: product.asin,
                  hasImportedMetrics,
                  dailyDays: isProductSelected ? model.selectedDailyRows.length : 0,
                });

                return (
                  <button
                    aria-label={optionView.statusLine}
                    aria-pressed={optionView.ariaPressed}
                    className={optionView.className}
                    key={product.asin}
                    onClick={() => selectProduct(product.asin)}
                    type="button"
                  >
                    <span className="product-management-option-header">
                      <strong>{product.title}</strong>
                      <span
                        aria-hidden="true"
                        className={`product-management-option-lock ${isProductSelected ? 'product-management-option-lock-ready' : ''}`}
                      >
                        {optionView.actionTag}
                      </span>
                    </span>
                    <span>{product.asin} / {product.skuLine}</span>
                    <span>{stageLabel(product.stage)} / {product.status || '状态未配置'} / 事件 {product.eventCount}</span>
                    <span>
                      花费 {formatUsd(product.cost)} / 销售 {formatUsd(product.sales)} / 订单 {product.orders} / ACOS {formatPercent(product.acos * 100)}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="muted-line">{model.emptyReason}</p>
          )}
          <p aria-live="polite" className="product-management-selection-live" role="status">
            {selectedOptionFeedback?.statusLine || '尚未锁定产品；点击产品卡片后工具栏会解冻。'}
          </p>
        </Panel>

        <Panel title="产品信息维护" tone={draft.asin ? 'default' : 'warning'}>
          <FormTable>
            <FormTableRow label="ASIN" required hint="全局产品上下文的主键；保存后广告量化、优化建议、运营事件、关键词和 Listing 都会沿用该 ASIN。">
              <input value={draft.asin} onChange={(event) => setDraft({ ...draft, asin: event.target.value })} placeholder="例如 B0..." />
            </FormTableRow>
            <FormTableRow label="标题" hint="用于运营识别，不自动提交到 Amazon 或领星。">
              <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="产品标题" />
            </FormTableRow>
            <FormTableRow label="MSKU / SKU" hint="本地识别字段，可与 ERP 或 Amazon 后台对齐。">
              <div className="inline-input-grid">
                <input value={draft.msku} onChange={(event) => setDraft({ ...draft, msku: event.target.value })} placeholder="MSKU" />
                <input value={draft.sku} onChange={(event) => setDraft({ ...draft, sku: event.target.value })} placeholder="SKU" />
              </div>
            </FormTableRow>
            <FormTableRow label="阶段 / 状态" required hint="阶段和状态会参与 AI 阶段判断、动态阈值和建议风险解释。">
              <div className="inline-input-grid">
                <select value={draft.productStage} onChange={(event) => setDraft({ ...draft, productStage: event.target.value as ProductStage })}>
                  {STAGE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
                <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                  <option value="active">正常运营</option>
                  <option value="paused">暂停推广</option>
                  <option value="clearance">清货</option>
                  <option value="watch">观察</option>
                </select>
              </div>
            </FormTableRow>
            <FormTableRow label="成本与售价" hint={productCostInputHint(cost)}>
              <div className="inline-input-grid inline-input-grid-3">
                {PRODUCT_QUICK_COST_FIELDS.map((field) => (
                  <span className="inline-field" key={field.key}>
                    <span className="inline-field-label">{field.label}</span>
                    <input
                      aria-label={field.label}
                      type="number"
                      step="0.01"
                      value={cost[field.key]}
                      onChange={(event) => updateCost(field.key, event.target.value)}
                      placeholder={field.placeholder}
                    />
                  </span>
                ))}
              </div>
            </FormTableRow>
            <FormTableRow label="广告目标" hint="目标 ACOS/TACOS 和净利率会作为产品级阈值约束。">
              <div className="inline-input-grid inline-input-grid-3">
                {PRODUCT_QUICK_TARGET_FIELDS.map((field) => (
                  <span className="inline-field" key={field.key}>
                    <span className="inline-field-label">{field.label}</span>
                    <input
                      aria-label={field.label}
                      type="number"
                      step="0.01"
                      value={cost[field.key]}
                      onChange={(event) => updateCost(field.key, event.target.value)}
                      placeholder={field.placeholder}
                    />
                  </span>
                ))}
              </div>
            </FormTableRow>
          </FormTable>
          <div className="action-row">
            <button aria-busy={saveProductButton.ariaBusy} className={saveProductButton.className} disabled={saveProductButton.disabled} onClick={saveProduct} type="button">
              {saveProductButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
              <span>{saveProductButton.label}</span>
            </button>
            <button aria-busy={openConfigButton.ariaBusy} className={openConfigButton.className} disabled={openConfigButton.disabled} onClick={() => navigate(routes.productConfig)} type="button">
              {openConfigButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
              <span>{openConfigButton.label}</span>
            </button>
          </div>
          {saveMessage && <p className="ready-line">{saveMessage}</p>}
          {saveError && <p className="blocked-line">{saveError}</p>}
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
                <button className="primary-button" disabled={!hasImportedMetrics} onClick={() => navigate(routes.adQuant)} type="button">进入 AI 量化</button>
              </div>
            </Panel>

            <Panel title="按天广告数据" tone={model.selectedDailyRows.length ? 'success' : 'warning'}>
              {model.selectedDailyRows.length ? (
                <div className="table-wrap">
                  <table className="business-table">
                    <thead>
                      <tr>
                        <th>日期</th>
                        <th>花费</th>
                        <th>销售</th>
                        <th>订单</th>
                        <th>点击</th>
                        <th>ACOS</th>
                        <th>CVR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.selectedDailyRows.map((row) => (
                        <tr key={row.date}>
                          <td>{row.date}</td>
                          <td>{formatUsd(row.cost)}</td>
                          <td>{formatUsd(row.sales)}</td>
                          <td>{row.orders}</td>
                          <td>{row.clicks}</td>
                          <td>{formatPercent(row.acos * 100)}</td>
                          <td>{formatPercent(row.cvr * 100)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted-line">
                  当前产品范围还没有可回查的日级广告指标。请先完成完整 8 类报表采集并导入 DB，再运行 AI 量化和优化建议。
                </p>
              )}
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
