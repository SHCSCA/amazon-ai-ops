import type { OperationScope, RecommendationView } from './types';

export const PREVIEW_SCENARIO_IDS = [
  'missing-scope',
  'missing-reports',
  'pending-import',
  'diagnosis-ready',
  'mixed-recommendations',
  'missing-readback-evidence',
  'delivery-ready',
] as const;

export type PreviewScenarioId = (typeof PREVIEW_SCENARIO_IDS)[number];

export interface PreviewScenarioContract {
  id: PreviewScenarioId;
  scopeReady: boolean;
  reportsCollected: boolean;
  reportsImported: boolean;
  diagnosisReady: boolean;
  recommendationState: 'blocked' | 'none' | 'mixed' | 'approved';
  readbackEvidenceReady: boolean;
  deliveryReady: boolean;
}

export const PREVIEW_SCENARIOS: Record<PreviewScenarioId, PreviewScenarioContract> = {
  'missing-scope': {
    id: 'missing-scope',
    scopeReady: false,
    reportsCollected: false,
    reportsImported: false,
    diagnosisReady: false,
    recommendationState: 'blocked',
    readbackEvidenceReady: false,
    deliveryReady: false,
  },
  'missing-reports': {
    id: 'missing-reports',
    scopeReady: true,
    reportsCollected: false,
    reportsImported: false,
    diagnosisReady: false,
    recommendationState: 'blocked',
    readbackEvidenceReady: false,
    deliveryReady: false,
  },
  'pending-import': {
    id: 'pending-import',
    scopeReady: true,
    reportsCollected: true,
    reportsImported: false,
    diagnosisReady: false,
    recommendationState: 'blocked',
    readbackEvidenceReady: false,
    deliveryReady: false,
  },
  'diagnosis-ready': {
    id: 'diagnosis-ready',
    scopeReady: true,
    reportsCollected: true,
    reportsImported: true,
    diagnosisReady: true,
    recommendationState: 'none',
    readbackEvidenceReady: false,
    deliveryReady: false,
  },
  'mixed-recommendations': {
    id: 'mixed-recommendations',
    scopeReady: true,
    reportsCollected: true,
    reportsImported: true,
    diagnosisReady: true,
    recommendationState: 'mixed',
    readbackEvidenceReady: false,
    deliveryReady: false,
  },
  'missing-readback-evidence': {
    id: 'missing-readback-evidence',
    scopeReady: true,
    reportsCollected: true,
    reportsImported: true,
    diagnosisReady: true,
    recommendationState: 'approved',
    readbackEvidenceReady: false,
    deliveryReady: false,
  },
  'delivery-ready': {
    id: 'delivery-ready',
    scopeReady: true,
    reportsCollected: true,
    reportsImported: true,
    diagnosisReady: true,
    recommendationState: 'approved',
    readbackEvidenceReady: true,
    deliveryReady: true,
  },
};

const DEFAULT_PREVIEW_SCENARIO: PreviewScenarioId = 'diagnosis-ready';

export interface PreviewBootstrapInput {
  dev: boolean;
  hostname: string;
  search: string;
}

export interface PreviewBootstrapResolution {
  enabled: boolean;
  scenarioId?: PreviewScenarioId;
  warning?: string;
}

export function resolvePreviewBootstrap(input: PreviewBootstrapInput): PreviewBootstrapResolution {
  const isLocalHost = input.hostname === 'localhost' || input.hostname === '127.0.0.1';
  if (!input.dev || !isLocalHost) return { enabled: false };

  const parameters = new URLSearchParams(input.search);
  if (parameters.get('preview') !== '1') return { enabled: false };

  const requestedScenario = parameters.get('scenario');
  if (!requestedScenario) return { enabled: true, scenarioId: DEFAULT_PREVIEW_SCENARIO };
  if ((PREVIEW_SCENARIO_IDS as readonly string[]).includes(requestedScenario)) {
    return { enabled: true, scenarioId: requestedScenario as PreviewScenarioId };
  }

  return {
    enabled: true,
    scenarioId: DEFAULT_PREVIEW_SCENARIO,
    warning: `未知预览场景 ${requestedScenario}；已回退到 ${DEFAULT_PREVIEW_SCENARIO}。`,
  };
}

export function bootstrapBrowserPreview(input: {
  dev: boolean;
  target: {
    electronAPI?: any;
    location?: { hostname: string; search: string };
  };
  username?: string;
}): PreviewBootstrapResolution {
  const resolution = resolvePreviewBootstrap({
    dev: input.dev,
    hostname: input.target.location?.hostname || '',
    search: input.target.location?.search || '',
  });
  if (resolution.enabled && !input.target.electronAPI?.getState) {
    input.target.electronAPI = createBrowserPreviewElectronApi(
      input.username || 'SHC001',
      resolution.scenarioId,
    );
  }
  return resolution;
}

const previewScope: OperationScope = {
  dateFrom: '2026-05-21',
  dateTo: '2026-06-23',
  storeName: 'FT-US-US',
  marketplaceCode: 'US',
  asin: 'B0GTTJFQTM',
  batchId: 'batch_preview_20260625',
  currency: 'USD',
};

const previewReportOptions = [
  ['campaign', '广告活动报告', 34],
  ['ad_group', '广告组报告', 220],
  ['placement', '广告位报告', 110],
  ['advertised_product', '广告（推广的商品）报告', 240],
  ['auto_targeting', '自动投放报告', 180],
  ['keyword', '关键词报告', 360],
  ['product_targeting', '商品投放报告', 270],
  ['user_search_term', '用户搜索词报告', 465],
].map(([type, label, importedRows]) => ({
  type,
  label,
  status: 'imported',
  realFileAvailable: true,
  importedRows,
}));

const previewProducts = [
  {
    id: 'preview-B0GTTJFQTM',
    asin: 'B0GTTJFQTM',
    title: 'D6',
    parent_asin: '',
    parentAsin: '',
    msku: 'D6-M',
    sku: 'D6-SKU',
    store_name: 'FT-US-US',
    marketplace_code: 'US',
    product_stage: 'keyword_exploration',
    productStage: 'keyword_exploration',
    status: 'active',
    updated_at: '2026-06-24',
    updatedAt: '2026-06-24',
    cost: {
      purchaseCost: 15.7,
      firstLegCost: 0,
      fbaFee: 6.49,
      referralFeeRate: 0.15,
      storageFee: 0,
      otherCost: 0,
      currentPrice: 49.99,
      minPrice: 33.99,
      targetNetMargin: 0.15,
      targetAcos: 0.35,
      targetTacos: 0.12,
    },
  },
  {
    id: 'preview-B0GVRW2HPY',
    asin: 'B0GVRW2HPY',
    title: 'D7',
    msku: 'D7-M',
    sku: 'D7-SKU',
    store_name: 'FT-US-US',
    marketplace_code: 'US',
    product_stage: 'scaling',
    productStage: 'scaling',
    status: 'active',
    updated_at: '2026-06-24',
    updatedAt: '2026-06-24',
    cost: { currentPrice: 49.99, targetAcos: 0.28, targetTacos: 0.1, targetNetMargin: 0.18 },
  },
  {
    id: 'preview-B0GVS5LVK2',
    asin: 'B0GVS5LVK2',
    title: 'D8',
    msku: 'D8-M',
    sku: 'D8-SKU',
    store_name: 'FT-US-US',
    marketplace_code: 'US',
    product_stage: 'declining_repair',
    productStage: 'declining_repair',
    status: 'watch',
    updated_at: '2026-06-24',
    updatedAt: '2026-06-24',
    cost: { currentPrice: 39.99, targetAcos: 0.45, targetTacos: 0.18, targetNetMargin: 0.08 },
  },
];

const previewDiagnostics = [
  {
    campaignName: 'D6-精准-核心长尾',
    adGroupName: 'SP-01',
    asin: 'B0GTTJFQTM',
    objectType: 'keyword',
    objectName: 'door lock bedroom',
    spend: 111.54,
    sales: 49.99,
    orders: 1,
    clicks: 98,
    acos: 2.231,
    cvr: 0.0102,
    cpc: 1.14,
    quantStatus: 'waste',
    lifecycleStage: 'testing',
    severity: 'high',
    recommendedAction: '降价或否定',
    diagnosis: '花费偏高且转化不足',
    suggestedDirection: '先复核再降价',
  },
  {
    campaignName: 'D6-手动精准',
    adGroupName: 'SP-02',
    asin: 'B0GTTJFQTM',
    objectType: 'search_term',
    objectName: 'smart lock',
    spend: 39.68,
    sales: 99.98,
    orders: 2,
    clicks: 45,
    acos: 0.397,
    cvr: 0.044,
    cpc: 0.88,
    quantStatus: 'watch',
    lifecycleStage: 'testing',
    severity: 'medium',
    recommendedAction: '观察',
    diagnosis: '有订单但 ACOS 偏高',
    suggestedDirection: '观察',
  },
];

const previewTimelines = Array.from({ length: 34 }, (_, index) => ({
  objectKey: `preview-${index}`,
  objectType: index % 2 ? 'search_term' : 'keyword',
  objectName: index % 2 ? 'door lock bedroom' : 'smart lock',
  asin: 'B0GTTJFQTM',
  campaignName: index % 2 ? 'D6-精准-核心长尾' : 'D6-手动精准',
  adGroupName: 'SP-01',
  dateFrom: previewScope.dateFrom,
  dateTo: previewScope.dateTo,
  daysActive: 34,
  lifecycleStage: 'testing',
  quantStatus: index % 5 === 0 ? 'waste' : index % 3 === 0 ? 'scale' : 'watch',
  recommendedAction: '复核',
  recommendedValue: '保持',
  trend: { spend: 'up', sales: index % 2 ? 'down' : 'up' },
  totals: {
    impressions: 800 + index * 20,
    clicks: 10 + index,
    cost: 5 + index,
    orders: index % 4,
    sales: (index % 4) * 49.99,
    acos: index % 4 ? 0.45 : 0,
    cpc: 1.2,
    cvr: 0.04,
    currency: 'USD',
  },
  thresholds: { targetAcos: 0.35 },
  reasons: ['浏览器预览数据，不写入数据库'],
  reviewRequired: true,
}));

const previewEvents = [
  {
    id: 'preview-event-1',
    eventDate: '2026-06-18',
    eventType: 'listing_change',
    title: 'Listing 标题优化',
    description: '补充核心词和场景词',
    asin: 'B0GTTJFQTM',
    impact: 'watch',
    createdAt: '2026-06-18T09:00:00Z',
  },
];

const previewDailyHistory = Array.from({ length: 34 }, (_, index) => {
  const date = new Date(`${previewScope.dateFrom}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  const cost = Number((12 + (index % 6) * 3.4 + (index > 22 ? 8 : 0)).toFixed(2));
  const orders = index % 5 === 0 ? 0 : index % 4;
  const sales = Number((orders * 49.99).toFixed(2));
  const clicks = 8 + (index % 9) * 3;
  return {
    date: date.toISOString().slice(0, 10),
    impressions: 680 + index * 18,
    clicks,
    cost,
    orders,
    sales,
    acos: sales > 0 ? cost / sales : 0,
    cpc: clicks > 0 ? cost / clicks : 0,
    cvr: clicks > 0 ? orders / clicks : 0,
    currency: 'USD',
  };
});

function previewPipeline(scenario: PreviewScenarioContract) {
  const reportOptions = scenario.reportsCollected
    ? previewReportOptions.map((item) => ({
        ...item,
        status: scenario.reportsImported ? 'imported' : 'downloaded',
        importedRows: scenario.reportsImported ? item.importedRows : 0,
      }))
    : previewReportOptions.map((item) => ({
        ...item,
        status: 'missing',
        realFileAvailable: false,
        importedRows: 0,
      }));
  const importedRows = scenario.reportsImported ? 1879 : 0;
  const reportBlockers = scenario.scopeReady
    ? (scenario.reportsCollected ? [] : ['预览场景：尚未采集真实报表'])
    : ['预览场景：尚未确认运营范围'];

  return {
    scope: scenario.scopeReady ? previewScope : null,
    generatedAt: new Date().toISOString(),
    collection: {
      status: scenario.reportsCollected ? 'ready' : 'blocked',
      latestBatch: scenario.reportsCollected ? {
        id: previewScope.batchId,
        status: scenario.reportsImported ? 'ready' : 'downloaded',
        dateStart: previewScope.dateFrom,
        dateEnd: previewScope.dateTo,
        storeName: previewScope.storeName,
        marketplaceCode: previewScope.marketplaceCode,
        downloadDir: 'D:/preview/reports',
        manifestPath: 'D:/preview/manifest.json',
        completedAt: '2026-06-24T09:00:00Z',
      } : null,
      sourceBatchIds: scenario.reportsCollected ? [previewScope.batchId] : [],
      availableBatches: scenario.reportsCollected ? [{
        id: previewScope.batchId,
        status: 'ready',
        dateStart: previewScope.dateFrom,
        dateEnd: previewScope.dateTo,
        storeName: previewScope.storeName,
        marketplaceCode: previewScope.marketplaceCode,
        downloadDir: 'D:/preview/reports',
        manifestPath: 'D:/preview/manifest.json',
        totalFileRecords: 8,
        realReportFileCount: 8,
        importedRowCount: importedRows,
        missingReportLabels: [],
      }] : [],
      reportOptions,
      realReportFiles: scenario.reportsCollected ? reportOptions.map((item) => ({
        id: `preview-file-${item.type}`,
        reportType: item.type,
        displayName: item.label,
        status: scenario.reportsImported ? 'imported' : 'downloaded',
        filePath: `D:/preview/reports/${item.type}.xlsx`,
        folderPath: 'D:/preview/reports',
        fileName: `${item.type}.xlsx`,
        fileSizeBytes: 1024,
        importedRows: item.importedRows,
      })) : [],
      evidencePaths: scenario.reportsCollected
        ? [{ label: '浏览器预览报表目录', path: 'D:/preview/reports', kind: 'folder' }]
        : [],
      fileAudit: {
        totalFileRecords: scenario.reportsCollected ? 8 : 0,
        downloadedFileRecords: scenario.reportsCollected ? 8 : 0,
        existingFileRecords: scenario.reportsCollected ? 8 : 0,
        realReportFileCount: scenario.reportsCollected ? 8 : 0,
        importedRowCount: importedRows,
        rejectedEvidenceFileCount: 0,
        missingReportLabels: [],
        downloadDir: 'D:/preview/reports',
        manifestPath: 'D:/preview/manifest.json',
      },
      blockers: reportBlockers,
      audit: {
        databaseReady: scenario.reportsImported,
        acceptedExtensions: ['.xlsx', '.xls', '.csv'],
        rejectedEvidenceExtensions: ['.json', '.png', '.html'],
        notes: ['浏览器预览数据只用于 UI 验证，不会写入本地数据库。'],
      },
    },
    quant: {
      hasImportedMetrics: scenario.reportsImported,
      importedRows,
      canonicalRows: importedRows,
      actionableRows: scenario.diagnosisReady ? 1621 : 0,
      breakdownRows: scenario.diagnosisReady ? 34 : 0,
      summarySource: scenario.reportsImported ? 'browser-preview' : 'none',
      totalSpend: scenario.reportsImported ? 784.31 : 0,
      totalSales: scenario.reportsImported ? 1289.68 : 0,
      totalOrders: scenario.reportsImported ? 25 : 0,
      totalClicks: scenario.reportsImported ? 495 : 0,
      totalImpressions: scenario.reportsImported ? 27199 : 0,
      acos: scenario.reportsImported ? 0.6081 : 0,
      cvr: scenario.reportsImported ? 0.0505 : 0,
      cpc: scenario.reportsImported ? 1.58 : 0,
      wastedSpend: scenario.reportsImported ? 403.47 : 0,
      highRiskCount: scenario.diagnosisReady ? previewDiagnostics.length : 0,
      adObjectTimelines: scenario.diagnosisReady ? previewTimelines : [],
      diagnostics: scenario.diagnosisReady ? previewDiagnostics : [],
      blockers: scenario.diagnosisReady ? [] : ['预览场景：诊断尚未就绪'],
    },
    operations: { events: previewEvents, eventCount: previewEvents.length, notes: [] },
    productContext: { products: previewProducts, productCount: previewProducts.length, notes: [] },
    productHistory: {
      ledgers: scenario.reportsImported ? [{
        asin: 'B0GTTJFQTM',
        storeName: previewScope.storeName,
        marketplaceCode: previewScope.marketplaceCode,
        dateFrom: previewScope.dateFrom,
        dateTo: previewScope.dateTo,
        activeDays: previewDailyHistory.length,
        firstMetricDate: previewDailyHistory[0]?.date,
        lastMetricDate: previewDailyHistory[previewDailyHistory.length - 1]?.date,
        inferredStage: 'testing',
        stageReasons: ['浏览器预览日级广告账本，用于验证 UI，不写入数据库。'],
        daily: previewDailyHistory,
        totals: {
          impressions: previewDailyHistory.reduce((sum, day) => sum + day.impressions, 0),
          clicks: previewDailyHistory.reduce((sum, day) => sum + day.clicks, 0),
          cost: previewDailyHistory.reduce((sum, day) => sum + day.cost, 0),
          orders: previewDailyHistory.reduce((sum, day) => sum + day.orders, 0),
          sales: previewDailyHistory.reduce((sum, day) => sum + day.sales, 0),
          acos: 0.608,
          cpc: 1.58,
          cvr: 0.0505,
          currency: 'USD',
        },
        events: previewEvents,
        product: {
          productStage: 'keyword_exploration',
          targetAcos: 0.35,
          targetTacos: 0.12,
          targetNetMargin: 0.15,
          minPrice: 33.99,
        },
      }] : [],
    },
  };
}

function clonePreviewSnapshot<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => clonePreviewSnapshot(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clonePreviewSnapshot(item)]),
    ) as T;
  }
  return value;
}

export function createBrowserPreviewElectronApi(
  username: string,
  scenarioId: PreviewScenarioId = DEFAULT_PREVIEW_SCENARIO,
) {
  const scenario = PREVIEW_SCENARIOS[scenarioId];
  const recommendationSource = ['mixed', 'approved'].includes(scenario.recommendationState)
    ? previewDiagnostics
    : [];
  const recommendations: RecommendationView[] = recommendationSource.map((diagnostic, index) => ({
    id: 10_001 + index,
    entityType: diagnostic.objectType,
    entityName: diagnostic.objectName,
    actionType: index === 0 ? 'lower_bid' : 'raise_bid',
    currentValue: index === 0 ? '1.20' : '0.88',
    recommendedValue: index === 0 ? '0.95' : '1.02',
    reason: diagnostic.diagnosis,
    acos: diagnostic.acos,
    clicks: diagnostic.clicks,
    cost: diagnostic.spend,
    riskLevel: index === 0 ? 'low' : diagnostic.severity,
    status: scenario.recommendationState === 'approved'
      ? (index === 0 ? 'approved' : 'rejected')
      : (index === 0 ? 'pending' : 'needs_review'),
    revision: 0,
    confidence: index === 0 ? 0.86 : 0.72,
    evidence: {
      impressions: index === 0 ? 6_840 : 3_920,
      clicks: diagnostic.clicks,
      cost: diagnostic.spend,
      orders: diagnostic.orders,
      sales: diagnostic.sales,
      acos: diagnostic.acos,
      cpc: diagnostic.cpc,
      cvr: diagnostic.cvr,
      currency: 'USD',
      batchId: previewScope.batchId,
      date: previewScope.dateTo,
      asin: diagnostic.asin,
      campaignName: diagnostic.campaignName,
      adGroupName: diagnostic.adGroupName,
      targeting: diagnostic.objectName,
      matchType: diagnostic.objectType,
      sourceFiles: [
        index === 0
          ? 'D:/preview/reports/keyword.xlsx'
          : 'D:/preview/reports/user_search_term.xlsx',
      ],
      sourceRow: 42 + index,
      explanationSource: 'ai',
      aiModel: 'preview-contract-model',
      aiStrategySource: 'ai',
      aiStrategySummary: index === 0
        ? 'AI 与规则一致建议降低出价，保留人工批准门。'
        : 'AI 建议谨慎提价，规则要求先人工复核。',
      aiMainProblems: [diagnostic.diagnosis],
      aiEvidenceRefs: [`preview:metric:${index + 1}`, `preview:timeline:${index + 1}`],
      aiEvidenceDetails: [
        {
          evidenceId: `preview:metric:${index + 1}`,
          type: 'metric',
          label: `${diagnostic.objectName} 广告指标`,
          dateRange: `${previewScope.dateFrom} 至 ${previewScope.dateTo}`,
          batchId: previewScope.batchId,
          reportType: index === 0 ? 'keyword' : 'user_search_term',
          sourceFile: index === 0
            ? 'D:/preview/reports/keyword.xlsx'
            : 'D:/preview/reports/user_search_term.xlsx',
          sourceRow: 42 + index,
          storeName: previewScope.storeName,
          marketplaceCode: previewScope.marketplaceCode,
          asin: diagnostic.asin,
          campaignName: diagnostic.campaignName,
          adGroupName: diagnostic.adGroupName,
          entityType: diagnostic.objectType,
          entityName: diagnostic.objectName,
          metrics: {
            impressions: index === 0 ? 6_840 : 3_920,
            clicks: diagnostic.clicks,
            cost: diagnostic.spend,
            orders: diagnostic.orders,
            sales: diagnostic.sales,
            acos: diagnostic.acos,
            cpc: diagnostic.cpc,
            cvr: diagnostic.cvr,
            currency: 'USD',
          },
        },
        {
          evidenceId: `preview:timeline:${index + 1}`,
          type: 'timeline',
          label: `${diagnostic.objectName} 生命周期`,
          dateRange: `${previewScope.dateFrom} 至 ${previewScope.dateTo}`,
          batchId: previewScope.batchId,
          storeName: previewScope.storeName,
          marketplaceCode: previewScope.marketplaceCode,
          asin: diagnostic.asin,
          campaignName: diagnostic.campaignName,
          adGroupName: diagnostic.adGroupName,
          entityType: diagnostic.objectType,
          entityName: diagnostic.objectName,
          timeline: {
            activeDays: 34,
            firstMetricDate: previewScope.dateFrom,
            lastMetricDate: previewScope.dateTo,
            inferredStage: diagnostic.lifecycleStage,
            stageReasons: [diagnostic.diagnosis],
          },
        },
      ],
      aiEvidenceSufficiency: {
        level: 'high',
        metricEvidenceCount: 1,
        sampleDays: 34,
        totalClicks: diagnostic.clicks,
        totalCost: diagnostic.spend,
        totalOrders: diagnostic.orders,
        canUseForFormalActions: true,
        blockers: [],
        warnings: index === 0 ? [] : ['预览建议需要人工复核'],
      },
      decisionAgreement: index === 0 ? 'aligned' : 'conflict',
      decisionSource: 'rule_ai',
      decisionReasons: [diagnostic.diagnosis, diagnostic.suggestedDirection],
      decisionRiskWarnings: index === 0 ? [] : ['AI 与规则结论存在差异'],
      decisionRequiresReview: index !== 0,
      quantStatus: diagnostic.quantStatus as 'waste' | 'watch',
      quantLifecycleStage: diagnostic.lifecycleStage,
      quantSeverity: diagnostic.severity as 'high' | 'medium',
      quantReasons: [diagnostic.diagnosis],
      quantThresholds: { targetAcos: 0.35 },
      quantReviewRequired: index !== 0,
      ...(scenario.recommendationState === 'approved' ? {
        approvalDecision: {
          decision: index === 0 ? 'approved' as const : 'rejected' as const,
          approvedBy: index === 0 ? 'Preview Approver' : undefined,
          rejectedBy: index === 0 ? undefined : 'Preview Reviewer',
          decidedAt: '2026-06-24T10:00:00.000Z',
          note: index === 0 ? '预览批准历史，仅用于界面验证。' : '预览拒绝历史，仅用于界面验证。',
          batchId: previewScope.batchId,
          sourceBatchId: previewScope.batchId,
          metricDate: previewScope.dateTo,
          sourceRow: 42 + index,
          sourceFiles: [
            index === 0
              ? 'D:/preview/reports/keyword.xlsx'
              : 'D:/preview/reports/user_search_term.xlsx',
          ],
          scope: {
            dateFrom: previewScope.dateFrom,
            dateTo: previewScope.dateTo,
            storeName: previewScope.storeName,
            marketplaceCode: previewScope.marketplaceCode,
            asin: diagnostic.asin,
          },
        },
      } : {}),
    },
  }));

  return {
    getState: async () => ({
      isLoggedIn: true,
      currentStore: username || 'SHC001',
      loginSession: { erpSessionReused: true, adsEntryMode: 'browser-preview', adsTitle: '浏览器预览模式' },
    }),
    browserLogout: async () => true,
    getOperationScope: async () => scenario.scopeReady ? previewScope : null,
    saveOperationScope: async () => scenario.scopeReady ? previewScope : null,
    getBusinessUiDataPipeline: async () => previewPipeline(scenario),
    getProducts: async () => previewProducts,
    saveProductConfig: async (input: unknown) => ({ ok: true, input }),
    listOperationEvents: async () => previewEvents,
    createOperationEvent: async (input: unknown) => ({ id: 'preview-event-new', input }),
    deleteOperationEvent: async () => ({ ok: true }),
    getRecommendations: async (filter?: { status?: string }) => clonePreviewSnapshot(
      filter?.status
        ? recommendations.filter((recommendation) => recommendation.status === filter.status)
        : recommendations,
    ),
    generateRecommendations: async () => clonePreviewSnapshot({
      generated: recommendations.length,
      recommendations,
    }),
    approveRecommendation: async (input: {
      id: number;
      expectedRevision: number;
      decision?: { approvedBy?: string; note?: string };
    }) => {
      const recommendation = recommendations.find((row) => row.id === input.id);
      if (!recommendation) throw new Error('预览建议不存在，请刷新后重试。');
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== recommendation.revision) {
        throw new Error('预览审批状态冲突：建议版本已变化，请刷新后重试。');
      }
      if (recommendation.status !== 'pending') {
        throw new Error(`预览审批被阻断：建议当前状态 ${recommendation.status} 不允许批准。`);
      }
      if (!String(input.decision?.approvedBy || '').trim()) {
        throw new Error('预览审批被阻断：批准前必须填写审批人。');
      }
      recommendation.status = 'approved';
      recommendation.revision += 1;
      recommendation.evidence = {
        ...recommendation.evidence,
        approvalDecision: {
          ...input.decision,
          decision: 'approved',
          decidedAt: new Date().toISOString(),
        },
      };
      return { ok: true };
    },
    rejectRecommendation: async (input: {
      id: number;
      expectedRevision: number;
      decision?: { rejectedBy?: string; note?: string };
    }) => {
      const recommendation = recommendations.find((row) => row.id === input.id);
      if (!recommendation) throw new Error('预览建议不存在，请刷新后重试。');
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== recommendation.revision) {
        throw new Error('预览审批状态冲突：建议版本已变化，请刷新后重试。');
      }
      if (recommendation.status !== 'pending' && recommendation.status !== 'needs_review') {
        throw new Error(`预览审批被阻断：建议当前状态 ${recommendation.status} 不允许拒绝。`);
      }
      if (!String(input.decision?.rejectedBy || '').trim()) {
        throw new Error('预览审批被阻断：拒绝前必须填写处理人。');
      }
      if (!String(input.decision?.note || '').trim()) {
        throw new Error('预览审批被阻断：拒绝前必须填写拒绝原因。');
      }
      recommendation.status = 'rejected';
      recommendation.revision += 1;
      recommendation.evidence = {
        ...recommendation.evidence,
        approvalDecision: {
          ...input.decision,
          decision: 'rejected',
          decidedAt: new Date().toISOString(),
        },
      };
      return { ok: true };
    },
    getBusinessKeywordOpportunities: async () => scenario.diagnosisReady ? previewTimelines.map((item, index) => ({
        asin: item.asin,
        portfolioName: '预览组合',
        keyword: item.objectName,
        entityType: item.objectType,
        campaignName: item.campaignName,
        adGroupName: item.adGroupName,
        coverageStatus: index % 3 === 0 ? '未覆盖' : index % 3 === 1 ? '已覆盖' : '需补入 Listing',
        spend: item.totals.cost,
        sales: item.totals.sales,
        orders: item.totals.orders,
        clicks: item.totals.clicks,
        acos: item.totals.acos,
        opportunityLevel: index % 4 === 0 ? 'high' : index % 4 === 1 ? 'medium' : 'low',
        recommendedPlacement: index % 2 ? '五点' : '标题',
        risk: item.totals.orders > 0 ? '可带入 Listing 覆盖复核' : '有点击未出单，先复核投放风险',
        sourceFile: `D:/preview/reports/${item.objectType}.xlsx`,
      })) : [],
    getRuleConfig: async () => ({ targetAcos: 0.35, highAcosThreshold: 0.4, minSpend: 10, noOrderClickThreshold: 30 }),
    getSettings: async () => ({ ai: { provider: 'deepseek', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com' } }),
    getDeliveryReadiness: async () => ({
      available: scenario.deliveryReady,
      path: null,
      exists: false,
      status: scenario.deliveryReady ? 'PREVIEW_ONLY_READY' : 'PREVIEW_ONLY_BLOCKED',
      appReady: false,
      manifestDriven: false,
      previewOnly: true,
      previewReady: scenario.deliveryReady,
      previewScenarioId: scenario.id,
      gates: [],
      gatesSummary: { total: 0, passed: 0, failed: 0 },
      missing: ['开发预览不能替代真实报表、回读、安装包和 manifest 验收。'],
      actionItems: ['退出开发预览后运行真实最终验收。'],
      message: scenario.deliveryReady
        ? '仅开发预览已走通；不可视为 APP_READY。'
        : '开发预览场景尚未走通；不可视为 APP_READY。',
    }),
    getDeliveryEvidenceStatus: async () => ({
      listing: {
        readReady: false,
        draftReady: false,
        contentCount: 0,
        fullContentCount: 0,
        draftCount: 0,
        aiDraftCount: 0,
        ruleFallbackDraftCount: 0,
      },
      readback: {
        verifiedCount: scenario.readbackEvidenceReady ? 1 : 0,
        latestStatus: scenario.readbackEvidenceReady ? 'preview-only-verified' : 'preview-only-missing',
      },
      package: {
        installerAvailable: false,
      },
      preview: {
        previewOnly: true,
        scenarioId: scenario.id,
        workflowComplete: scenario.deliveryReady,
        message: scenario.deliveryReady
          ? '仅开发预览已走通；不可视为 APP_READY。'
          : '开发预览场景尚未走通；不可视为 APP_READY。',
      },
    }),
    getScheduledTasks: async () => [{ name: 'daily-import-preview', enabled: true, cron: '0 9 * * *', lastStatus: 'success' }],
    setTaskEnabled: async () => ({ ok: true }),
    runTaskNow: async () => ({ ok: true }),
    openReportPath: async () => true,
    exportDataReconciliation: async () => ({ ok: true, path: 'D:/preview/reconciliation.xlsx' }),
  };
}
