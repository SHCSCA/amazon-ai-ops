import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { FormTable, FormTableRow, StatusPill } from '../components/ui';
import { VirtualDataTable, type VirtualDataTableColumn } from '../components/virtual-data-table';
import { ResponsiveInspector, TaskBanner, WorkbenchPanel } from '../components/workspace';
import { formatPercent, formatUsd } from '../formatters';
import { hasFormalReportCoverage, importedReportTypeCoverageCount } from '../report-coverage';
import { useScopeStore } from '../scope-store';
import { buildCostInputFromProduct, DEFAULT_COST, productCostInputHint } from './product-config-page';
import {
  buildProductManagementSummaries,
  buildProductTimeline,
  mergeProductStrategyContexts,
  normalizeProductPortfolioRows,
  type ProductManagementSummary,
  type ProductTimelineItem,
} from '../product-management';
import type { AppRoute, BusinessDataPipeline, OperationScope, ProductStrategyContextView } from '../types';
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
type ProductInspectorTab = 'detail' | 'edit' | 'daily' | 'timeline';

const PRODUCT_INSPECTOR_TABS: Array<{ key: ProductInspectorTab; label: string }> = [
  { key: 'detail', label: '概览' },
  { key: 'edit', label: '维护' },
  { key: 'daily', label: '日级' },
  { key: 'timeline', label: '事件' },
];

export function productInspectorTabTarget(
  current: ProductInspectorTab,
  key: string,
): ProductInspectorTab {
  const currentIndex = PRODUCT_INSPECTOR_TABS.findIndex((item) => item.key === current);
  if (key === 'Home') return PRODUCT_INSPECTOR_TABS[0].key;
  if (key === 'End') return PRODUCT_INSPECTOR_TABS[PRODUCT_INSPECTOR_TABS.length - 1].key;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return current;
  const delta = key === 'ArrowRight' ? 1 : -1;
  const nextIndex = (currentIndex + delta + PRODUCT_INSPECTOR_TABS.length) % PRODUCT_INSPECTOR_TABS.length;
  return PRODUCT_INSPECTOR_TABS[nextIndex].key;
}

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
  authoritativeData?: BusinessDataPipeline | null;
  supplementalProducts?: ProductStrategyContextView[];
}) {
  const canonicalAsin = String(input.scopeAsin || '').trim().toUpperCase();
  const requestedAsin = canonicalAsin || String(input.data?.scope?.asin || '').trim().toUpperCase();
  const authoritativeCandidate = input.authoritativeData || input.data;
  const authoritativeAsin = String(authoritativeCandidate?.scope?.asin || '').trim().toUpperCase();
  const selectedAuthority = requestedAsin && authoritativeAsin === requestedAsin
    ? authoritativeCandidate
    : undefined;
  const productContexts = mergeProductStrategyContexts(
    input.data?.productContext?.products || [],
    input.supplementalProducts || [],
  );
  const products = buildProductManagementSummaries({
    products: productContexts,
    diagnostics: input.data?.quant?.diagnostics || [],
    ledgers: input.data?.productHistory?.ledgers || [],
    events: input.data?.operations?.events || [],
    canonicalSummary: selectedAuthority?.quant && canonicalAsin
      ? {
          asin: requestedAsin,
          cost: selectedAuthority.quant.totalSpend,
          sales: selectedAuthority.quant.totalSales,
          orders: selectedAuthority.quant.totalOrders,
          clicks: selectedAuthority.quant.totalClicks,
        }
      : undefined,
  });
  const selectedProduct = requestedAsin
    ? products.find((item) => item.asin === requestedAsin)
    : undefined;
  const timeline = selectedProduct
    ? buildProductTimeline({
        selectedAsin: selectedProduct.asin,
        events: selectedAuthority?.operations?.events || input.data?.operations?.events || [],
      })
    : [];
  const selectedLedger = selectedProduct
    ? (selectedAuthority?.productHistory?.ledgers || input.data?.productHistory?.ledgers || [])
        .find((ledger) => ledger.asin.toUpperCase() === selectedProduct.asin.toUpperCase())
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
  importedReportTypeCount?: number;
  formalDataReady?: boolean;
}) {
  const routes = productManagementActionRoutes();
  const selected = input.model.selectedProduct;
  const productCount = input.model.products.length;
  const importedReportTypeCount = Math.max(0, Number(input.importedReportTypeCount ?? 8));
  const formalDataReady = input.formalDataReady ?? (input.hasImportedMetrics && importedReportTypeCount >= 8);

  let title = '先查看并锁定一个产品';
  let detail = '选择产品行只打开详情；确认后使用显式“锁定”动作，广告表现、优化建议、运营事件、关键词和 Listing 才会按该 ASIN 读取数据库。';
  let primaryActionLabel = productCount ? '补齐产品配置' : '补齐产品配置';
  let primaryRoute: AppRoute = routes.productConfig;
  let primaryActionDisabled = false;
  let primaryActionBusy = false;
  let primaryBusyLabel = '读取中...';
  let feedbackLabel = productCount ? '未锁定产品上下文' : '缺少产品配置';
  let feedbackDetail = productCount ? '查看产品不会改变全局范围；锁定前后都能明确看到当前 ASIN。' : input.model.emptyReason;
  let feedbackTone: ProductManagementTaskFeedbackTone = 'warning';
  let secondaryActions: Array<{ label: string; route: AppRoute; disabled?: boolean }> = [
    { label: '导入校验', route: 'data-import-validation' },
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
    detail = '产品工作台依赖当前范围、产品配置、广告指标和运营事件；先处理读取错误后再继续。';
    primaryActionLabel = '回到工作范围';
    primaryRoute = 'operation-scope';
    feedbackLabel = '读取失败';
    feedbackDetail = input.error;
    feedbackTone = 'blocked';
    secondaryActions = [{ label: '导入校验', route: 'data-import-validation' }];
  } else if (!productCount) {
    title = '先补齐产品配置';
    detail = '当前范围没有可识别产品。先建立 ASIN、标题、SKU、成本和目标阈值，再进入广告表现。';
    primaryActionLabel = '补齐产品配置';
    primaryRoute = routes.productConfig;
    secondaryActions = [{ label: '导入校验', route: 'data-import-validation' }];
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
  } else if (selected && !formalDataReady) {
    title = `当前产品：${selected.title}`;
    detail = `${selected.asin} 已锁定为产品上下文；当前仅 ${importedReportTypeCount}/8 类逐类入库，正式数据门未闭合。`;
    primaryActionLabel = '补齐逐类入库';
    primaryRoute = 'data-import-validation';
    feedbackLabel = '正式数据门未闭合';
    feedbackDetail = `${input.importedRows} 行指标来自 ${importedReportTypeCount}/8 类报表；补齐 8 类前不把 AI 量化作为主动作。`;
    feedbackTone = 'warning';
    secondaryActions = [
      { label: '维护运营事件', route: routes.operationEvents },
      { label: '打开完整配置', route: routes.productConfig },
    ];
  } else if (selected) {
    title = `当前产品：${selected.title}`;
    detail = `${selected.asin} 已作为广告表现、优化建议、运营事件、关键词和 Listing 的共享上下文。`;
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
    feedbackDetail = '保存只更新本地产品配置；全局 ASIN 仅由显式锁定动作更新。';
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
    ? `${input.productTitle} / ${input.asin} 已锁定，工具栏已解冻，后续页面按 ${input.asin} 读取数据库。${input.hasImportedMetrics ? `日级 ${input.dailyDays} 天可用于产品分析。` : '当前缺少导入指标，先去导入校验。'}`
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
  const {
    data: portfolioData,
    loading: portfolioLoading,
    error: portfolioError,
  } = useBusinessDataPipeline({ mode: 'portfolio' });
  const { setScope } = useScopeStore();
  const lockedAsin = String(scope.asin || '').trim().toUpperCase();
  const [focusedAsin, setFocusedAsin] = useState('');
  const [inspectorTab, setInspectorTab] = useState<ProductInspectorTab>('detail');
  const [configuredProducts, setConfiguredProducts] = useState<ProductStrategyContextView[]>([]);
  const [configuredProductsLoading, setConfiguredProductsLoading] = useState(true);
  const [configuredProductsError, setConfiguredProductsError] = useState('');
  const [productPoolReloadToken, setProductPoolReloadToken] = useState(0);
  const productSearchRef = useRef<HTMLInputElement | null>(null);
  const queueData = portfolioData || data;
  const supplementalProducts = useMemo(() => mergeProductStrategyContexts(
    data?.productContext?.products || [],
    configuredProducts,
  ), [configuredProducts, data?.productContext?.products]);
  const model = useMemo(() => buildProductManagementPageModel({
    data: queueData,
    scopeAsin: focusedAsin,
    authoritativeData: data,
    supplementalProducts,
  }), [data, focusedAsin, queueData, supplementalProducts]);
  const lockedModel = useMemo(() => buildProductManagementPageModel({
    data: queueData,
    scopeAsin: lockedAsin,
    authoritativeData: data,
    supplementalProducts,
  }), [data, lockedAsin, queueData, supplementalProducts]);
  const routes = productManagementActionRoutes();
  const selected = model.selectedProduct;
  const lockedProduct = lockedModel.selectedProduct;
  const focusedIsLocked = Boolean(selected && selected.asin === lockedAsin);
  const productContexts = useMemo(() => mergeProductStrategyContexts(
    queueData?.productContext?.products || [],
    supplementalProducts,
  ), [queueData?.productContext?.products, supplementalProducts]);
  const selectedContext = useMemo(() => (
    productContexts.find((product) => selected?.asin && product.asin.toUpperCase() === selected.asin.toUpperCase())
  ), [productContexts, selected?.asin]);
  const [draft, setDraft] = useState(() => buildDraftFromProduct(undefined, scope.asin));
  const [cost, setCost] = useState(DEFAULT_COST);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const importedRows = data?.quant?.importedRows ?? 0;
  const hasImportedMetrics = Boolean(data?.quant?.hasImportedMetrics && importedRows > 0);
  const importedReportTypeCount = importedReportTypeCoverageCount(data?.collection);
  const formalDataReady = Boolean(hasImportedMetrics && hasFormalReportCoverage(data?.collection));
  const queueLoading = Boolean((portfolioLoading && !portfolioData) || (configuredProductsLoading && !queueData));
  const queueError = portfolioError || configuredProductsError;
  const taskState = useMemo(
    () => buildProductManagementTaskState({
      model: lockedModel,
      loading: lockedAsin ? loading : queueLoading,
      error,
      saving,
      saveMessage,
      saveError,
      importedRows,
      hasImportedMetrics,
      importedReportTypeCount,
      formalDataReady,
    }),
    [error, formalDataReady, hasImportedMetrics, importedReportTypeCount, importedRows, loading, lockedAsin, lockedModel, queueLoading, saveError, saveMessage, saving],
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
  const lockedOptionFeedback = useMemo(
    () => lockedProduct
      ? buildProductManagementOptionView({
          selected: true,
          productTitle: lockedProduct.title,
          asin: lockedProduct.asin,
          hasImportedMetrics,
          dailyDays: lockedModel.selectedDailyRows.length,
        })
      : null,
    [hasImportedMetrics, lockedModel.selectedDailyRows.length, lockedProduct],
  );
  const visibleProducts = useMemo(() => {
    const query = productSearch.trim().toUpperCase();
    if (!query) return model.products;
    return model.products.filter((product) => [
      product.asin,
      product.title,
      product.skuLine,
      stageLabel(product.stage),
      product.status || '',
    ].some((value) => String(value || '').toUpperCase().includes(query)));
  }, [model.products, productSearch]);

  useEffect(() => {
    if (!selected) return;
    setDraft(buildDraftFromProduct(selectedContext || selected, selected.asin));
    setCost(buildCostInputFromProduct(selectedContext || {}));
    setSaveMessage('');
    setSaveError('');
  }, [selected, selectedContext]);

  useEffect(() => {
    const refresh = () => setProductPoolReloadToken((current) => current + 1);
    window.addEventListener('business-ui:data-updated', refresh);
    return () => window.removeEventListener('business-ui:data-updated', refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadConfiguredProducts() {
      setConfiguredProductsLoading(true);
      setConfiguredProductsError('');
      try {
        const rows = await (window as any).electronAPI?.getProducts?.();
        if (cancelled) return;
        setConfiguredProducts(normalizeProductPortfolioRows(rows, scope));
      } catch (caught) {
        if (!cancelled) {
          setConfiguredProductsError(toUserFacingError(caught, '读取完整产品配置池失败。'));
        }
      } finally {
        if (!cancelled) setConfiguredProductsLoading(false);
      }
    }
    void loadConfiguredProducts();
    return () => {
      cancelled = true;
    };
  }, [productPoolReloadToken, scope.marketplaceCode, scope.storeName]);

  function lockProduct(asin: string) {
    setScope({ asin, currency: 'USD' });
  }

  function openProductInspector(asin: string, panel: ProductInspectorTab = 'detail') {
    setFocusedAsin(asin);
    setInspectorTab(panel);
  }

  function clearLockedProduct() {
    setScope({ asin: undefined, currency: 'USD' });
  }

  function closeProductInspector() {
    if (saving) return;
    setFocusedAsin('');
    setInspectorTab('detail');
  }

  function selectInspectorTab(nextTab: ProductInspectorTab) {
    setInspectorTab(nextTab);
    window.requestAnimationFrame?.(() => {
      document.getElementById(`product-inspector-tab-${nextTab}`)?.focus();
    });
  }

  function handleInspectorTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, currentTab: ProductInspectorTab) {
    const nextTab = productInspectorTabTarget(currentTab, event.key);
    if (nextTab === currentTab) return;
    event.preventDefault();
    selectInspectorTab(nextTab);
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
      setFocusedAsin(nextAsin);
      setSaveMessage(nextAsin === lockedAsin
        ? '产品信息已保存；当前锁定产品保持不变。'
        : '产品信息已保存；尚未改变全局产品范围，如需切换请使用“锁定为当前产品”。');
      window.dispatchEvent(new Event('business-ui:data-updated'));
    } catch (caught) {
      setSaveError(toUserFacingError(caught, '保存产品信息失败。'));
    } finally {
      setSaving(false);
    }
  }

  const columns = useMemo<Array<VirtualDataTableColumn<ProductManagementSummary>>>(() => [
    {
      key: 'product',
      header: '产品',
      width: 'minmax(250px, 1.5fr)',
      sticky: 'left',
      cell: (product) => (
        <div>
          <strong>{product.title}</strong>
          <p>{product.asin} / {product.skuLine}</p>
        </div>
      ),
    },
    {
      key: 'stage',
      header: '阶段 / 配置',
      width: 'minmax(150px, 0.8fr)',
      cell: (product) => (
        <div>
          <StatusPill tone={product.configured ? 'ready' : 'warning'}>
            {product.configured ? '已配置' : '待补齐'}
          </StatusPill>
          <p>{stageLabel(product.stage)}{product.targetAcos !== undefined ? ` / 目标 ${formatPercent(product.targetAcos * 100)}` : ''}</p>
        </div>
      ),
    },
    {
      key: 'performance',
      header: '广告表现',
      width: 'minmax(190px, 1fr)',
      cell: (product) => (
        <div>
          <strong>{formatUsd(product.cost)} / ACOS {formatPercent(product.acos * 100)}</strong>
          <p>销售 {formatUsd(product.sales)} / 订单 {product.orders}</p>
        </div>
      ),
    },
    {
      key: 'readiness',
      header: '数据 / 风险',
      width: 'minmax(175px, 0.9fr)',
      cell: (product) => (
        <div>
          <strong>{product.activeDays ? `${product.activeDays} 个活跃日` : '暂无日级指标'}</strong>
          <p>{product.lastMetricDate || '日期待导入'} / {product.highRiskCount ? `${product.highRiskCount} 个高风险` : `${product.eventCount} 个事件`}</p>
        </div>
      ),
    },
    {
      key: 'context',
      header: '运营上下文',
      width: 'minmax(145px, 0.7fr)',
      cell: (product) => {
        const isLocked = product.asin === lockedAsin;
        return (
          <div className="product-management-row-actions">
            <StatusPill tone={isLocked ? 'ready' : 'pending'}>{isLocked ? '当前已锁定' : '仅查看'}</StatusPill>
            <button
              aria-pressed={isLocked}
              className="secondary-button compact-button"
              disabled={isLocked || saving}
              onClick={(event) => {
                event.stopPropagation();
                lockProduct(product.asin);
              }}
              onKeyDown={(event) => event.stopPropagation()}
              type="button"
            >
              {isLocked ? '已锁定' : '锁定'}
            </button>
          </div>
        );
      },
    },
  ], [lockedAsin, saving]);

  const selectionStatus = selected && !focusedIsLocked
    ? `正在查看 ${selected.title} / ${selected.asin}，没有改变全局产品范围。${lockedProduct ? `当前锁定产品仍为 ${lockedProduct.asin}。` : '当前尚未锁定产品。'}`
    : lockedOptionFeedback?.statusLine || '尚未锁定产品；选择产品行只会打开详情，只有“锁定”动作才会改变全局 ASIN。';

  return (
    <div className="business-stack product-management-page-stack">
      <TaskBanner
        compact
        description={taskState.detail}
        meta={taskState.feedbackDetail}
        primaryAction={{
          label: taskState.primaryActionLabel,
          onClick: () => navigate(taskState.primaryRoute),
          disabled: taskState.primaryActionDisabled,
          busy: taskState.primaryActionBusy,
          busyLabel: taskState.primaryBusyLabel,
        }}
        secondaryActions={taskState.secondaryActions.slice(0, 2).map((action) => ({
          label: action.label,
          onClick: () => navigate(action.route),
          disabled: action.disabled,
        }))}
        status={taskState.feedbackLabel}
        title={taskState.title}
        tone={taskState.feedbackTone === 'ready' ? 'confirmed' : taskState.feedbackTone === 'blocked' ? 'blocked' : 'attention'}
      />

      <div className="business-stack product-management-workspace" data-workspace-work-surface>
        <div data-workspace-queue="products">
          <WorkbenchPanel
            className="product-management-queue"
            description={`${model.products.length} 个产品 · 选择行只查看详情，锁定按钮才会改变全局 ASIN。`}
            status={lockedProduct ? `已锁定 ${lockedProduct.asin}` : '未锁定产品'}
            title="产品对象队列"
            toolbar={(
              <>
                <label className="product-management-search">
                  <span>搜索产品</span>
                  <input
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="ASIN / 标题 / SKU / 阶段"
                    ref={productSearchRef}
                    value={productSearch}
                  />
                </label>
                <button className="secondary-button compact-button" disabled={saving} onClick={() => navigate(routes.productConfig)} type="button">批量配置</button>
                <button className="secondary-button compact-button" disabled={!lockedAsin || saving} onClick={clearLockedProduct} type="button">取消锁定</button>
              </>
            )}
            footer={(
              <>
                <p aria-live="polite" className="product-management-selection-live" role="status">{selectionStatus}</p>
                {queueError && <p className="warning-line">{queueError} 已保留其他只读产品数据。</p>}
              </>
            )}
          >
            <VirtualDataTable
              className="product-management-list-wrap"
              columns={columns}
              emptyMessage={model.products.length ? '没有匹配的产品。' : model.emptyReason}
              estimateSize={54}
              getRowKey={(product) => product.productKey}
              loading={queueLoading}
              minWidth="900px"
              onRowSelect={(product) => {
                if (!saving) openProductInspector(product.asin);
              }}
              overscan={8}
              rowAriaLabel={(product) => `${product.title}，ASIN ${product.asin}；按 Enter 或空格查看详情，锁定需使用行内锁定按钮`}
              rowClassName={(product) => product.asin === lockedAsin ? 'product-management-table-row-selected' : undefined}
              rows={visibleProducts}
              selectedRowKey={focusedAsin || null}
            />
          </WorkbenchPanel>
        </div>

        <ResponsiveInspector
          busy={saving}
          description={selected
            ? `${selected.asin} / ${selected.skuLine} · ${focusedIsLocked ? '当前已锁定' : '当前仅查看，尚未改变全局产品范围'}`
            : '选择产品后查看详情'}
          dismissDisabled={saving}
          onClose={closeProductInspector}
          open={Boolean(selected && focusedAsin)}
          resolveFocusReturnTarget={(trigger) => trigger?.isConnected === false ? productSearchRef.current : trigger || productSearchRef.current}
          title={selected?.title || '产品详情'}
        >
          {selected && (
            <div className="product-management-modal-body">
              <div aria-label="产品详情页签" className="product-management-modal-tabs" role="tablist">
                {PRODUCT_INSPECTOR_TABS.map((tab) => {
                  const active = inspectorTab === tab.key;
                  return (
                    <button
                      aria-controls={`product-inspector-panel-${tab.key}`}
                      aria-selected={active}
                      className={active ? 'primary-button compact-button' : 'secondary-button compact-button'}
                      disabled={saving}
                      id={`product-inspector-tab-${tab.key}`}
                      key={tab.key}
                      onClick={() => selectInspectorTab(tab.key)}
                      onKeyDown={(event) => handleInspectorTabKeyDown(event, tab.key)}
                      role="tab"
                      tabIndex={active ? 0 : -1}
                      type="button"
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div
                aria-labelledby={`product-inspector-tab-${inspectorTab}`}
                id={`product-inspector-panel-${inspectorTab}`}
                role="tabpanel"
                tabIndex={0}
              >
                {inspectorTab === 'detail' && (
                  <div className="product-management-current-card product-management-modal-summary">
                    <div className="product-management-current-head">
                      <div>
                        <span>查看产品</span>
                        <strong>{selected.title}</strong>
                        <p>{selected.asin} / {selected.skuLine}</p>
                      </div>
                      <StatusPill tone={focusedIsLocked ? 'ready' : 'pending'}>{focusedIsLocked ? '已锁定' : '仅查看'}</StatusPill>
                    </div>
                    <div className="product-management-current-metrics">
                      <div><span>阶段</span><strong>{stageLabel(selected.stage)}</strong></div>
                      <div><span>花费</span><strong>{formatUsd(selected.cost)}</strong></div>
                      <div><span>销售</span><strong>{formatUsd(selected.sales)}</strong></div>
                      <div><span>ACOS</span><strong>{formatPercent(selected.acos * 100)}</strong></div>
                      <div><span>订单</span><strong>{selected.orders}</strong></div>
                      <div><span>风险</span><strong>{selected.highRiskCount}</strong></div>
                    </div>
                    <p className="muted-line">
                      {formalDataReady
                        ? '正式 8/8 报表门已闭合；只有锁定该产品后，广告表现和建议才会读取该 ASIN。'
                        : `正式数据门尚未闭合：当前 ${importedReportTypeCount}/8 类逐类入库，AI 量化保持阻断。`}
                    </p>
                  </div>
                )}

                {inspectorTab === 'edit' && (
                  <>
                    <FormTable>
                      <FormTableRow label="ASIN" required hint="产品配置主键；保存只更新本地配置，显式锁定后其他页面才会沿用该 ASIN。">
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
                    {saveMessage && <p className="ready-line">{saveMessage}</p>}
                    {saveError && <p className="blocked-line">{saveError}</p>}
                  </>
                )}

                {inspectorTab === 'daily' && (
                  model.selectedDailyRows.length ? (
                    <div className="table-wrap product-management-detail-table">
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
                      当前产品还没有可回查的日级广告指标。请先完成完整 8 类报表采集并导入 DB。
                    </p>
                  )
                )}

                {inspectorTab === 'timeline' && (
                  model.timeline.length ? (
                    <div className="event-timeline product-management-timeline">
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
                      当前产品还没有产品事件或全局事件。记录 Coupon、BD、调价、Listing 或库存变化后，AI 会使用这些背景。
                    </p>
                  )
                )}
              </div>

              <footer className="product-config-modal-footer">
                {inspectorTab === 'edit' ? (
                  <>
                    <button aria-busy={openConfigButton.ariaBusy} className={openConfigButton.className} disabled={openConfigButton.disabled} onClick={() => navigate(routes.productConfig)} type="button">
                      {openConfigButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                      <span>{openConfigButton.label}</span>
                    </button>
                    <button aria-busy={saveProductButton.ariaBusy} className={saveProductButton.className} disabled={saveProductButton.disabled} onClick={saveProduct} type="button">
                      {saveProductButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                      <span>{saveProductButton.label}</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button className="secondary-button" onClick={() => selectInspectorTab('edit')} type="button">维护信息</button>
                    {focusedIsLocked ? (
                      <button className="primary-button" onClick={() => navigate(formalDataReady ? routes.adQuant : 'data-import-validation')} type="button">
                        {formalDataReady ? '进入广告表现' : '补齐逐类入库'}
                      </button>
                    ) : (
                      <button className="primary-button" onClick={() => lockProduct(selected.asin)} type="button">锁定为当前产品</button>
                    )}
                  </>
                )}
              </footer>
            </div>
          )}
        </ResponsiveInspector>
      </div>
    </div>
  );
}
