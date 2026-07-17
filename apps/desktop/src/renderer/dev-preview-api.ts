import type {
  BindRecommendationWritableTargetRequest,
  BindRecommendationWritableTargetResult,
  RecommendationReviewResolution,
  ResolveRecommendationReviewRequest,
  ResolveRecommendationReviewResult,
  WritableAdTargetBinding,
  WritableAdTargetEvidence,
} from '@amazon-ai-ops/shared-types';
import type { BusinessQuantDiagnostic, BusinessQuantTimeline, OperationScope, RecommendationView } from './types';

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

function previewDiagnosticObjectKey(diagnostic: Pick<BusinessQuantDiagnostic, 'asin' | 'campaignName' | 'adGroupName' | 'objectType' | 'objectName'>): string {
  return [
    String(diagnostic.asin || '').trim().toUpperCase(),
    String(diagnostic.campaignName || '').trim().toLowerCase(),
    String(diagnostic.adGroupName || '').trim().toLowerCase(),
    'user_search_term',
    String(diagnostic.objectType || '').trim().toLowerCase(),
    String(diagnostic.objectName || '').trim().toLowerCase(),
  ].join('|');
}

function withPreviewDiagnosticIdentity<T extends BusinessQuantDiagnostic>(diagnostic: T): T & { objectKey: string } {
  return { ...diagnostic, objectKey: previewDiagnosticObjectKey(diagnostic) };
}

const previewDiagnostics = ([
  {
    campaignName: 'D6-精准-核心长尾',
    adGroupName: 'SP-01',
    asin: 'B0GTTJFQTM',
    objectType: 'search_term',
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
] satisfies BusinessQuantDiagnostic[]).map((diagnostic) => withPreviewDiagnosticIdentity(diagnostic));

function buildPreviewTimelines(diagnostics: BusinessQuantDiagnostic[]): BusinessQuantTimeline[] {
  return diagnostics.map((diagnostic, index) => ({
    objectKey: String(diagnostic.objectKey || ''),
    objectType: diagnostic.objectType === 'target' || diagnostic.objectType === 'ad_group' || diagnostic.objectType === 'campaign'
      ? diagnostic.objectType
      : 'search_term',
    objectName: diagnostic.objectName || '未命名对象',
    asin: diagnostic.asin,
    campaignName: diagnostic.campaignName,
    adGroupName: diagnostic.adGroupName,
    dateFrom: previewScope.dateFrom,
    dateTo: previewScope.dateTo,
    daysActive: 34,
    lifecycleStage: diagnostic.lifecycleStage || 'testing',
    quantStatus: diagnostic.quantStatus || 'watch',
    recommendedAction: diagnostic.recommendedAction || '复核',
    recommendedValue: diagnostic.recommendedValue || '保持',
    trend: { spend: 'up', sales: index % 2 ? 'down' : 'up' },
    totals: {
      impressions: 800 + index * 20,
      clicks: diagnostic.clicks,
      cost: diagnostic.spend,
      orders: diagnostic.orders,
      sales: diagnostic.sales,
      acos: diagnostic.acos,
      cpc: diagnostic.cpc,
      cvr: diagnostic.cvr,
      currency: 'USD',
    },
    thresholds: { targetAcos: 0.35 },
    reasons: ['浏览器预览数据，不写入数据库'],
    reviewRequired: true,
  }));
}

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

function previewFixtures(scenario: PreviewScenarioContract) {
  if (scenario.id !== 'diagnosis-ready') {
    return {
      diagnostics: previewDiagnostics,
      timelines: buildPreviewTimelines(previewDiagnostics),
      events: previewEvents,
      products: previewProducts,
    };
  }

  const diagnostics = Array.from({ length: 120 }, (_, index) => {
    const source = previewDiagnostics[index % previewDiagnostics.length];
    const diagnostic = {
      ...source,
      campaignName: `${source.campaignName}-${String(index + 1).padStart(3, '0')}`,
      objectName: `${source.objectName} ${String(index + 1).padStart(3, '0')}`,
    };
    return withPreviewDiagnosticIdentity(diagnostic);
  });

  return {
    diagnostics,
    timelines: buildPreviewTimelines(diagnostics),
    events: Array.from({ length: 120 }, (_, index) => {
      const source = previewEvents[index % previewEvents.length];
      return {
        ...source,
        id: `preview-event-${index + 1}`,
        title: `${source.title} ${String(index + 1).padStart(3, '0')}`,
      };
    }),
    products: Array.from({ length: 120 }, (_, index) => {
      const source = previewProducts[index % previewProducts.length];
      if (index < previewProducts.length) return source;
      const asin = `B0P${String(index + 1).padStart(7, '0')}`;
      return {
        ...source,
        id: `preview-${asin}`,
        asin,
        title: `${source.title} ${String(index + 1).padStart(3, '0')}`,
        msku: `PREVIEW-${String(index + 1).padStart(3, '0')}`,
        sku: `PREVIEW-SKU-${String(index + 1).padStart(3, '0')}`,
      };
    }),
  };
}

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

function previewBatchOptions(scenario: PreviewScenarioContract) {
  if (!scenario.reportsCollected) return [];
  return [{
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
    importedReportTypeCount: scenario.reportsImported ? 8 : 0,
    importedRowCount: scenario.reportsImported ? 1879 : 0,
    missingReportLabels: [],
  }];
}

function previewPipeline(
  scenario: PreviewScenarioContract,
  fixtures = previewFixtures(scenario),
) {
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
      availableBatches: previewBatchOptions(scenario),
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
      highRiskCount: scenario.diagnosisReady ? fixtures.diagnostics.length : 0,
      adObjectTimelines: scenario.diagnosisReady ? fixtures.timelines : [],
      diagnostics: scenario.diagnosisReady ? fixtures.diagnostics : [],
      blockers: scenario.diagnosisReady ? [] : ['预览场景：诊断尚未就绪'],
    },
    operations: { events: fixtures.events, eventCount: fixtures.events.length, notes: [] },
    productContext: { products: fixtures.products, productCount: fixtures.products.length, notes: [] },
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
        events: fixtures.events,
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

function previewReadinessGates(scenario: PreviewScenarioContract) {
  const recommendationsReady = scenario.recommendationState === 'mixed'
    || scenario.recommendationState === 'approved';
  const steps = [
    { id: 'scope', label: '工作范围', ok: scenario.scopeReady },
    { id: 'reports', label: '真实报表布局', ok: scenario.reportsCollected },
    { id: 'import', label: '导入状态', ok: scenario.reportsImported },
    { id: 'diagnosis', label: '广告诊断', ok: scenario.diagnosisReady },
    { id: 'recommendations', label: '建议与审批', ok: recommendationsReady },
    { id: 'readback', label: '结果核对', ok: scenario.readbackEvidenceReady },
    { id: 'workflow', label: '页面流程', ok: scenario.deliveryReady },
  ];

  return steps.map((step) => ({
    id: `preview-${step.id}`,
    name: `开发预览·${step.label}`,
    ok: step.ok,
    status: step.ok ? 'passed' : 'needs_work',
    message: step.ok
      ? `${step.label}预览状态已具备。`
      : `${step.label}预览状态尚未具备。`,
  }));
}

export function createBrowserPreviewElectronApi(
  username: string,
  scenarioId: PreviewScenarioId = DEFAULT_PREVIEW_SCENARIO,
) {
  const scenario = PREVIEW_SCENARIOS[scenarioId];
  const fixtures = previewFixtures(scenario);
  const recommendationSource = ['mixed', 'approved'].includes(scenario.recommendationState)
    ? previewDiagnostics
    : [];
  const recommendations: RecommendationView[] = recommendationSource.map((diagnostic, index) => ({
    id: 10_001 + index,
    entityType: diagnostic.objectType,
    entityId: `${diagnostic.campaignName}_${diagnostic.adGroupName}_${diagnostic.objectName}`,
    entityName: diagnostic.objectName,
    actionType: 'lower_bid',
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
  const readbackStagePreview = scenario.recommendationState === 'approved';
  const previewAiEvidenceId = 'preview:ai-diagnosis:1';
  const previewAiDiagnosisRuns = readbackStagePreview ? [{
    id: 'preview-ai-run-1',
    success: true,
    createdAt: '2026-06-24T09:30:00.000Z',
    diagnosis: {
      source: 'ai',
      lifecycleStage: 'stable_conversion',
      lifecycleStageRequiresReview: false,
      lifecycleStageEvidenceRefs: [previewAiEvidenceId],
    },
    insights: ['预览 AI 诊断已形成，只用于验证结果核对与交付布局。'],
    evidencePackPreview: [{
      evidenceId: previewAiEvidenceId,
      type: 'metric',
      label: '预览广告诊断证据',
    }],
  }] : [];
  const previewGates = previewReadinessGates(scenario);
  const previewPassedGateCount = previewGates.filter((gate) => gate.ok).length;
  const firstMissingPreviewGate = previewGates.find((gate) => !gate.ok);

  return {
    getState: async () => ({
      isLoggedIn: true,
      currentStore: username || 'SHC001',
      loginSession: { erpSessionReused: true, adsEntryMode: 'browser-preview', adsTitle: '浏览器预览模式' },
    }),
    browserLogout: async () => true,
    getOperationScope: async () => scenario.scopeReady ? previewScope : null,
    saveOperationScope: async () => scenario.scopeReady ? previewScope : null,
    getBusinessUiDataPipeline: async () => previewPipeline(scenario, fixtures),
    getBusinessBatchOptions: async () => clonePreviewSnapshot(previewBatchOptions(scenario)),
    getProducts: async () => clonePreviewSnapshot(fixtures.products),
    saveProductConfig: async (input: unknown) => ({ ok: true, input }),
    bulkUpdateProductTargetAcos: async (input: any) => ({
      success: true,
      targetAcos: Number(input?.targetAcos || 0),
      updatedCount: Array.isArray(input?.products) ? input.products.length : 0,
      products: Array.isArray(input?.products) ? input.products : [],
    }),
    listOperationEvents: async () => clonePreviewSnapshot(fixtures.events),
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
    resolveRecommendationReview: async (
      input: ResolveRecommendationReviewRequest,
    ): Promise<ResolveRecommendationReviewResult> => {
      const recommendation = recommendations.find((row) => row.id === input.recommendationId);
      if (!recommendation) throw new Error('预览复核被阻断：建议不存在，请刷新后重试。');
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== recommendation.revision) {
        throw new Error('预览复核状态冲突：建议版本已变化，请刷新后重试。');
      }
      if (recommendation.status !== 'needs_review') {
        throw new Error(`预览复核被阻断：建议当前状态 ${recommendation.status} 不能确认复核。`);
      }
      if (recommendation.actionType !== 'lower_bid' || recommendation.evidence?.quantReviewRequired !== true) {
        throw new Error('预览复核被阻断：当前建议不是受控的规则量化降价复核。');
      }

      const normalized = (value: unknown) => String(value ?? '').trim();
      const scope = input.scope;
      const scopeMatches = normalized(scope?.dateFrom) === previewScope.dateFrom
        && normalized(scope?.dateTo) === previewScope.dateTo
        && normalized(scope?.storeName) === previewScope.storeName
        && normalized(scope?.marketplaceCode) === previewScope.marketplaceCode
        && normalized(scope?.asin).toUpperCase() === normalized(recommendation.evidence?.asin).toUpperCase()
        && normalized(scope?.batchId) === normalized(recommendation.evidence?.batchId);
      if (!scopeMatches) {
        throw new Error('预览复核被阻断：建议与当前锁定范围或批次不一致，请刷新后重试。');
      }

      const reviewedBy = normalized(input.review?.reviewedBy);
      const rationale = normalized(input.review?.rationale);
      const candidate = input.review?.writableTarget;
      const entityType = normalized(candidate?.entityType) as WritableAdTargetEvidence['entityType'];
      const entityId = normalized(candidate?.entityId);
      const sourceFile = normalized(candidate?.sourceFile);
      const sourceRow = Number(candidate?.sourceRow);
      const identitySource = normalized(candidate?.identitySource) as WritableAdTargetEvidence['identitySource'];
      const identityProofPath = normalized(candidate?.identityProofPath);
      const verificationNote = normalized(candidate?.verificationNote);
      const writableTypes = new Set(['keyword', 'auto_targeting', 'product_targeting']);
      const normalizedSourceFile = sourceFile.replace(/\\/g, '/').toLowerCase();
      const reportTypeByFile = new Map(previewReportOptions.map((report) => [
        `d:/preview/reports/${report.type}.xlsx`,
        report.type,
      ]));
      const candidateComplete = reviewedBy
        && rationale
        && writableTypes.has(entityType)
        && entityId
        && entityId !== normalized(recommendation.entityId)
        && reportTypeByFile.get(normalizedSourceFile) === entityType
        && Number.isInteger(sourceRow)
        && sourceRow > 0
        && ['ads_ui', 'ads_api'].includes(identitySource)
        && identityProofPath
        && verificationNote;
      if (!candidateComplete) {
        throw new Error('预览复核被阻断：无法把当前证据唯一绑定到经身份核验的 Ads 可写对象。');
      }

      const reviewedAt = new Date().toISOString();
      const writableTarget: WritableAdTargetEvidence = {
        entityType,
        entityId,
        entityName: recommendation.entityName,
        campaignName: normalized(recommendation.evidence?.campaignName),
        adGroupName: normalized(recommendation.evidence?.adGroupName),
        metricDate: normalized(recommendation.evidence?.date),
        sourceFile,
        sourceRow,
        identitySource,
        verifiedBy: reviewedBy,
        verifiedAt: reviewedAt,
        verificationNote,
        identityProofPath,
      };
      const fromRevision = recommendation.revision;
      const resolution: RecommendationReviewResolution = {
        schemaVersion: 1,
        fromStatus: 'needs_review',
        fromRevision,
        resolvedRevision: fromRevision + 1,
        reviewedBy,
        reviewedAt,
        rationale,
        resolvedBlockers: ['quant_review_required'],
        scope: clonePreviewSnapshot(scope),
        metricSource: {
          batchId: normalized(recommendation.evidence?.batchId),
          sourceFiles: [...(recommendation.evidence?.sourceFiles || [])],
          sourceRow: Number(recommendation.evidence?.sourceRow),
        },
        writableTarget,
      };
      recommendation.status = 'pending';
      recommendation.revision += 1;
      recommendation.evidence = {
        ...recommendation.evidence,
        writableTarget,
        reviewResolution: resolution,
      };
      return clonePreviewSnapshot({
        ok: true,
        recommendationId: recommendation.id,
        previousStatus: 'needs_review',
        status: 'pending',
        revision: recommendation.revision,
        reviewedAt,
        resolvedBlockers: ['quant_review_required'],
      });
    },
    bindRecommendationWritableTarget: async (
      input: BindRecommendationWritableTargetRequest,
    ): Promise<BindRecommendationWritableTargetResult> => {
      const recommendation = recommendations.find((row) => row.id === input.recommendationId);
      if (!recommendation) throw new Error('预览 Ads 对象核验被阻断：建议不存在，请刷新后重试。');
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== recommendation.revision) {
        throw new Error('预览 Ads 对象核验状态冲突：建议版本已变化，请刷新后重试。');
      }
      if (recommendation.status !== 'pending') {
        throw new Error(`预览 Ads 对象核验被阻断：建议当前状态 ${recommendation.status} 不能绑定对象。`);
      }
      if (recommendation.actionType !== 'lower_bid' || recommendation.evidence?.quantReviewRequired === true) {
        throw new Error('预览 Ads 对象核验被阻断：当前入口仅支持无需量化复核的降低竞价建议。');
      }
      if (recommendation.evidence?.writableTarget || recommendation.evidence?.writableTargetBinding) {
        throw new Error('预览 Ads 对象核验被阻断：当前建议已经存在不可覆盖的对象绑定。');
      }

      const normalized = (value: unknown) => String(value ?? '').trim();
      const scope = input.scope;
      const scopeMatches = normalized(scope?.dateFrom) === previewScope.dateFrom
        && normalized(scope?.dateTo) === previewScope.dateTo
        && normalized(scope?.storeName) === previewScope.storeName
        && normalized(scope?.marketplaceCode) === previewScope.marketplaceCode
        && normalized(scope?.asin).toUpperCase() === normalized(recommendation.evidence?.asin).toUpperCase()
        && normalized(scope?.batchId) === normalized(recommendation.evidence?.batchId);
      if (!scopeMatches) {
        throw new Error('预览 Ads 对象核验被阻断：建议与当前锁定范围或批次不一致，请刷新后重试。');
      }

      const boundBy = normalized(input.binding?.boundBy);
      const note = normalized(input.binding?.note);
      const candidate = input.binding?.writableTarget;
      const entityType = normalized(candidate?.entityType) as WritableAdTargetEvidence['entityType'];
      const entityId = normalized(candidate?.entityId);
      const sourceFile = normalized(candidate?.sourceFile);
      const sourceRow = Number(candidate?.sourceRow);
      const identitySource = normalized(candidate?.identitySource) as WritableAdTargetEvidence['identitySource'];
      const identityProofPath = normalized(candidate?.identityProofPath);
      const verificationNote = normalized(candidate?.verificationNote);
      const normalizedSourceFile = sourceFile.replace(/\\/g, '/').toLowerCase();
      const reportTypeByFile = new Map(previewReportOptions.map((report) => [
        `d:/preview/reports/${report.type}.xlsx`,
        report.type,
      ]));
      const candidateComplete = boundBy
        && note
        && ['keyword', 'auto_targeting', 'product_targeting'].includes(entityType)
        && entityId
        && entityId.toLowerCase() !== normalized(recommendation.entityId).toLowerCase()
        && reportTypeByFile.get(normalizedSourceFile) === entityType
        && Number.isInteger(sourceRow)
        && sourceRow > 0
        && ['ads_ui', 'ads_api'].includes(identitySource)
        && identityProofPath
        && verificationNote;
      if (!candidateComplete) {
        throw new Error('预览 Ads 对象核验被阻断：无法把当前证据唯一绑定到经身份核验的 Ads 可写对象。');
      }

      const boundAt = new Date().toISOString();
      const writableTarget: WritableAdTargetEvidence = {
        entityType,
        entityId,
        entityName: recommendation.entityName,
        campaignName: normalized(recommendation.evidence?.campaignName),
        adGroupName: normalized(recommendation.evidence?.adGroupName),
        metricDate: normalized(recommendation.evidence?.date),
        sourceFile,
        sourceRow,
        identitySource,
        verifiedBy: boundBy,
        verifiedAt: boundAt,
        verificationNote,
        identityProofPath,
      };
      const fromRevision = recommendation.revision;
      const binding: WritableAdTargetBinding = {
        schemaVersion: 1,
        fromRevision,
        boundRevision: fromRevision + 1,
        boundBy,
        boundAt,
        note,
        scope: clonePreviewSnapshot(scope),
        metricSource: {
          batchId: normalized(recommendation.evidence?.batchId),
          sourceFiles: [...(recommendation.evidence?.sourceFiles || [])],
          sourceRow: Number(recommendation.evidence?.sourceRow),
        },
        writableTarget,
      };
      recommendation.revision += 1;
      recommendation.evidence = {
        ...recommendation.evidence,
        writableTarget,
        writableTargetBinding: binding,
      };
      return clonePreviewSnapshot({
        ok: true,
        recommendationId: recommendation.id,
        status: 'pending',
        revision: recommendation.revision,
        boundAt,
      });
    },
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
      const binding = recommendation.evidence?.writableTargetBinding;
      const resolution = recommendation.evidence?.reviewResolution;
      const currentBinding = Boolean(binding)
        && binding?.schemaVersion === 1
        && binding.fromRevision + 1 === binding.boundRevision
        && binding.boundRevision === recommendation.revision;
      const currentResolution = Boolean(resolution)
        && resolution?.schemaVersion === 1
        && resolution.fromRevision + 1 === resolution.resolvedRevision
        && resolution.resolvedRevision === recommendation.revision;
      if (!recommendation.evidence?.writableTarget || (!currentBinding && !currentResolution)) {
        throw new Error('预览审批被阻断：必须先核验唯一 Ads 可写对象并重新读取权威版本。');
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
    getBusinessKeywordOpportunities: async () => scenario.diagnosisReady ? fixtures.timelines.map((item, index) => ({
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
    getSettings: async () => ({
      ai: { provider: 'deepseek', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com' },
      aiKeyConfigured: readbackStagePreview,
      aiBaseUrl: 'https://api.deepseek.com',
      aiProvider: 'deepseek',
      aiModel: 'deepseek-v4-flash',
      aiLastTestBaseUrl: readbackStagePreview ? 'https://api.deepseek.com' : '',
      aiLastTestModel: readbackStagePreview ? 'deepseek-v4-flash' : '',
      aiLastTestStatus: readbackStagePreview ? 'available' : 'untested',
    }),
    listAiDiagnosisRuns: async () => clonePreviewSnapshot(previewAiDiagnosisRuns),
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
      gates: clonePreviewSnapshot(previewGates),
      gatesSummary: {
        total: previewGates.length,
        passed: previewPassedGateCount,
        failed: previewGates.length - previewPassedGateCount,
      },
      missing: scenario.deliveryReady
        ? ['真实交付仍需当前 Windows 包、真实 Ads 回读、manifest 与安全门。']
        : [firstMissingPreviewGate?.message || '开发预览页面流程尚未走通。'],
      actionItems: scenario.deliveryReady
        ? ['退出开发预览后运行真实最终验收。']
        : [`先补齐${firstMissingPreviewGate?.name || '当前预览步骤'}。`],
      message: scenario.deliveryReady
        ? '仅开发预览已走通；不可视为 APP_READY。'
        : '开发预览场景尚未走通；不可视为 APP_READY。',
    }),
    getDeliveryEvidenceStatus: async () => ({
      listing: {
        readReady: readbackStagePreview,
        draftReady: readbackStagePreview,
        contentCount: readbackStagePreview ? 1 : 0,
        fullContentCount: readbackStagePreview ? 1 : 0,
        draftCount: readbackStagePreview ? 1 : 0,
        aiDraftCount: readbackStagePreview ? 1 : 0,
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
