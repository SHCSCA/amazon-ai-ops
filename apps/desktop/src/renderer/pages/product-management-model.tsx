

import { localizeProductStage } from '@amazon-ai-ops/business-presenters';

import { buildProductManagementSummaries, buildProductTimeline, mergeProductStrategyContexts, type ProductTimelineItem } from '../product-management';
import type { AppRoute, BusinessDataPipeline, OperationScope, ProductStrategyContextView } from '../types';

export type ProductManagementRoutes = {
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

export type ProductStage = 'cold_start' | 'keyword_exploration' | 'stable_conversion' | 'scaling' | 'profit_harvesting' | 'declining_repair';

export type ProductInspectorTab = 'detail' | 'edit' | 'daily' | 'timeline';

export const PRODUCT_INSPECTOR_TABS: Array<{ key: ProductInspectorTab; label: string }> = [
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

export const STAGE_OPTIONS: Array<{ value: ProductStage; label: string }> = [
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

export function buildDraftFromProduct(product: any, scopeAsin?: string) {
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

export function toNumber(value: string | number): number {
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

export type ProductManagementPageModel = ReturnType<typeof buildProductManagementPageModel>;

export type ProductManagementTaskFeedbackTone = 'ready' | 'pending' | 'warning' | 'blocked';

export interface ProductManagementActionButtonInput {
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
    detail: 'login-credentials 已托管至 Main 系统加密区；Renderer 只接收账号标识与非秘密状态，不接收或回填已保存密码。',
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

export function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

export function stageLabel(stage?: string): string {
  return localizeProductStage(stage);
}
