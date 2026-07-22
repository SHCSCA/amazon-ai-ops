import type {
  ActionRecommendation,
  BindRecommendationWritableTargetRequest,
  BindRecommendationWritableTargetResult,
  RecommendationReviewResolution,
  ResolveRecommendationReviewRequest,
  ResolveRecommendationReviewResult,
  WritableAdTargetBinding,
  WritableAdTargetEvidence,
  MissionControlCapabilityAction,
  MissionControlCapabilityProjection,
  MissionControlCommandRequest,
  MissionControlCommandResponse,
  MissionControlLegacyRouteId,
  MissionControlQueryRequest,
  MissionControlQueryResponse,
  MissionControlViewId,
  MissionControlWorkspaceId,
  ProductCost,
  StoreContextEnvelope,
  StoreId,
  StoreRecord,
  StoreRuntimeConfigProjection,
  StoreRuntimeConfigRecord,
  StoreRuntimeConfigValues,
  StoreWorkspaceView,
} from '@amazon-ai-ops/shared-types';
import {
  missionControlContextKey,
  normalizeBrowserProfileId,
  normalizeMissionControlCommandRequest,
  normalizeMissionControlQueryRequest,
  normalizeStoreContextEnvelope,
  normalizeStoreId,
} from '@amazon-ai-ops/shared-types';
import {
  applyRecommendationDecision,
  assertRecommendationDecisionRevision,
  type RecommendationDecisionInput,
  type RecommendationDecisionStatus,
} from '@amazon-ai-ops/rules-engine';
import type { BusinessQuantDiagnostic, BusinessQuantTimeline, OperationScope, RecommendationView } from './types';
import {
  createMissionDomainWindowSurface,
  createPreviewDecisionDomainApi,
  createPreviewExperimentMemoryDomainSuite,
  createPreviewMissionDomainApi,
  createPreviewPolicyDomainApi,
} from './mission-control/workspaces/mission-domain-window-api';
import { createPreviewAnalysisAuthorityApi } from './mission-control/workspaces/analysis-authority-window-api';

type PreviewRecommendation = ActionRecommendation & RecommendationView;

interface PreviewRecommendationFilter {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  storeName?: string;
  marketplaceCode?: string;
  asin?: string;
  batchId?: string;
  status?: string;
  limit?: number;
}

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

function previewStore(
  storeIdInput: string,
  browserProfileIdInput: string,
  displayName: string,
  timestamp = '2026-07-22T00:00:00.000Z',
): StoreRecord {
  return {
    storeId: normalizeStoreId(storeIdInput),
    browserProfileId: normalizeBrowserProfileId(browserProfileIdInput),
    marketplace: 'US',
    currency: 'USD',
    displayName,
    status: 'active',
    businessTimezone: 'America/Los_Angeles',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function previewContext(store: StoreRecord, sessionGeneration: number): StoreContextEnvelope {
  return normalizeStoreContextEnvelope({
    storeId: store.storeId,
    browserProfileId: store.browserProfileId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: store.businessTimezone,
    businessDate: '2026-07-22',
    sessionGeneration,
  });
}

export const PREVIEW_STORES: readonly StoreRecord[] = [
  previewStore('preview-store-shc001', 'preview-profile-shc001', 'SHC001-US'),
  previewStore('preview-store-shc002', 'preview-profile-shc002', 'SHC002-US'),
] as const;

type PreviewStoreIdentity = {
  storeName: string;
  primaryAsin: string;
  secondaryAsin: string;
  tertiaryAsin: string;
  batchId: string;
  pathSegment: string;
};

function previewStoreIdentity(store: StoreRecord): PreviewStoreIdentity {
  const stableSuffix = String(store.storeId)
    .replace(/^preview-store-/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'store';
  if (stableSuffix === 'shc001') {
    return {
      storeName: 'SHC001-US',
      primaryAsin: 'B0GTTJFQTM',
      secondaryAsin: 'B0GVRW2HPY',
      tertiaryAsin: 'B0GVS5LVK2',
      batchId: 'batch_shc001_20260722',
      pathSegment: 'shc001',
    };
  }
  if (stableSuffix === 'shc002') {
    return {
      storeName: 'SHC002-US',
      primaryAsin: 'B0SHC00201',
      secondaryAsin: 'B0SHC00202',
      tertiaryAsin: 'B0SHC00203',
      batchId: 'batch_shc002_20260722',
      pathSegment: 'shc002',
    };
  }
  const compact = stableSuffix.replace(/[^a-z0-9]/g, '').toUpperCase().slice(-6).padStart(6, '0');
  return {
    storeName: `${stableSuffix.toUpperCase()}-US`,
    primaryAsin: `B0${compact}01`.slice(0, 10),
    secondaryAsin: `B0${compact}02`.slice(0, 10),
    tertiaryAsin: `B0${compact}03`.slice(0, 10),
    batchId: `batch_${stableSuffix}_20260722`,
    pathSegment: stableSuffix,
  };
}

function applyPreviewStoreIdentity<T>(value: T, identity: PreviewStoreIdentity): T {
  const replacements = new Map<string, string>([
    ['FT-US-US', identity.storeName],
    ['B0GTTJFQTM', identity.primaryAsin],
    ['B0GVRW2HPY', identity.secondaryAsin],
    ['B0GVS5LVK2', identity.tertiaryAsin],
    ['batch_preview_20260625', identity.batchId],
    ['D:/preview/', `D:/preview/${identity.pathSegment}/`],
    ['preview-event-', `preview-${identity.pathSegment}-event-`],
    ['preview-recommendation-', `preview-${identity.pathSegment}-recommendation-`],
  ]);
  const visit = (input: unknown): unknown => {
    if (typeof input === 'string') {
      let next = input;
      replacements.forEach((replacement, source) => {
        if (source === 'D:/preview/' && next.includes(replacement)) return;
        next = next.split(source).join(replacement);
      });
      return next;
    }
    if (Array.isArray(input)) return input.map((item) => visit(item));
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, item]) => [key, visit(item)]),
      );
    }
    return input;
  };
  return visit(value) as T;
}

type PreviewCapabilitySpec = readonly [
  capabilityId: string,
  workspace: MissionControlWorkspaceId,
  view: MissionControlViewId,
  action: MissionControlCapabilityAction,
  legacyRoute?: MissionControlLegacyRouteId,
];

const PREVIEW_MISSION_CAPABILITY_SPECS: readonly PreviewCapabilitySpec[] = [
  ['objects.store.view', 'objects', 'objects/products', 'view'],
  ['objects.store.create', 'objects', 'objects/products', 'create'],
  ['objects.store.update', 'objects', 'objects/products', 'update'],
  ['objects.store.archive', 'objects', 'objects/products', 'archive'],
  ['objects.store.restore', 'objects', 'objects/products', 'restore'],
  ['objects.store.switch', 'objects', 'objects/products', 'switch'],
  ['today.overview.view', 'today', 'today/overview', 'view', 'dashboard'],
  ['today.events.view', 'today', 'today/events', 'view', 'operation-events'],
  ['today.events.create', 'today', 'today/events', 'create'],
  ['today.events.update', 'today', 'today/events', 'update'],
  ['today.events.archive', 'today', 'today/events', 'archive'],
  ['today.events.restore', 'today', 'today/events', 'restore'],
  ['missions.mission.view', 'missions', 'missions/overview', 'view'],
  ['missions.mission.create', 'missions', 'missions/overview', 'create'],
  ['missions.mission.update', 'missions', 'missions/overview', 'update'],
  ['missions.mission.pause', 'missions', 'missions/overview', 'pause'],
  ['missions.mission.resume', 'missions', 'missions/overview', 'resume'],
  ['missions.mission.archive', 'missions', 'missions/overview', 'archive'],
  ['missions.mission.restore', 'missions', 'missions/overview', 'restore'],
  ['missions.checkpoint.create', 'missions', 'missions/facts', 'create'],
  ['missions.mission.delete', 'missions', 'missions/overview', 'delete'],
  ['missions.mission.facts.view', 'missions', 'missions/facts', 'view', 'ad-quant'],
  ['decisions.recommendations.view', 'decisions', 'decisions/recommendations', 'view', 'recommendations'],
  ['decisions.recommendations.create', 'decisions', 'decisions/recommendations', 'create'],
  ['decisions.recommendations.update', 'decisions', 'decisions/recommendations', 'update'],
  ['decisions.approval.view', 'decisions', 'decisions/approval', 'view', 'approval'],
  ['decisions.approval.approve', 'decisions', 'decisions/approval', 'approve'],
  ['decisions.approval.reject', 'decisions', 'decisions/approval', 'reject'],
  ['decisions.grants.issue', 'decisions', 'decisions/decided', 'approve'],
  ['decisions.grants.revoke', 'decisions', 'decisions/decided', 'reject'],
  ['decisions.decided.view', 'decisions', 'decisions/decided', 'view', 'approval'],
  ['experiments.experiment.view', 'experiments', 'experiments/ledger', 'view'],
  ['experiments.experiment.create', 'experiments', 'experiments/ledger', 'create'],
  ['experiments.experiment.update', 'experiments', 'experiments/ledger', 'update'],
  ['experiments.experiment.start', 'experiments', 'experiments/ledger', 'start'],
  ['experiments.experiment.pause', 'experiments', 'experiments/ledger', 'pause'],
  ['experiments.experiment.resume', 'experiments', 'experiments/ledger', 'resume'],
  ['experiments.experiment.complete', 'experiments', 'experiments/ledger', 'complete'],
  ['experiments.experiment.archive', 'experiments', 'experiments/ledger', 'archive'],
  ['experiments.experiment.restore', 'experiments', 'experiments/ledger', 'restore'],
  ['experiments.observation.create', 'experiments', 'experiments/ledger', 'create'],
  ['experiments.experiment.delete', 'experiments', 'experiments/ledger', 'delete'],
  ['execution.queue.view', 'execution', 'execution/live', 'view'],
  ['execution.queue.start', 'execution', 'execution/live', 'start'],
  ['execution.queue.takeover', 'execution', 'execution/live', 'takeover'],
  ['execution.queue.reconcile-unknown', 'execution', 'execution/live', 'reconcile-unknown'],
  ['execution.queue.skip', 'execution', 'execution/live', 'skip'],
  ['execution.queue.kill-switch', 'execution', 'execution/live', 'kill-switch'],
  ['execution.evidence.view', 'execution', 'execution/evidence', 'view', 'readback'],
  ['memory.timeline.view', 'memory', 'memory/timeline', 'view'],
  ['memory.timeline.create', 'memory', 'memory/timeline', 'create'],
  ['memory.timeline.correct', 'memory', 'memory/timeline', 'update'],
  ['memory.timeline.export', 'memory', 'memory/timeline', 'export'],
  ['memory.timeline.rebuild-index', 'memory', 'memory/timeline', 'rebuild-index'],
  ['objects.products.view', 'objects', 'objects/products', 'view', 'product-management'],
  ['objects.products.create', 'objects', 'objects/products', 'create'],
  ['objects.products.update', 'objects', 'objects/products', 'update'],
  ['objects.products.archive', 'objects', 'objects/products', 'archive'],
  ['objects.events.view', 'objects', 'objects/products', 'view'],
  ['objects.events.create', 'objects', 'objects/products', 'create'],
  ['objects.events.update', 'objects', 'objects/products', 'update'],
  ['objects.events.delete', 'objects', 'objects/products', 'delete'],
  ['objects.targets.view', 'objects', 'objects/targets', 'view', 'product-config'],
  ['objects.keywords.view', 'objects', 'objects/keywords', 'view', 'keyword-opportunities'],
  ['objects.listing.view', 'objects', 'objects/listing', 'view', 'listing-optimization'],
  ['objects.listing.create', 'objects', 'objects/listing', 'create'],
  ['objects.listing.update', 'objects', 'objects/listing', 'update'],
  ['objects.listing.delete', 'objects', 'objects/listing', 'delete'],
  ['collection.scope.view', 'collection', 'collection/scope', 'view', 'operation-scope'],
  ['collection.reports.view', 'collection', 'collection/reports', 'view', 'data-collection'],
  ['collection.import-check.view', 'collection', 'collection/import-check', 'view', 'data-import-validation'],
  ['policy.version.view', 'policy', 'policy/rules', 'view'],
  ['policy.policy.create', 'policy', 'policy/rules', 'create'],
  ['policy.policy.update', 'policy', 'policy/rules', 'update'],
  ['policy.policy.archive', 'policy', 'policy/rules', 'archive'],
  ['policy.policy.restore', 'policy', 'policy/rules', 'restore'],
  ['policy.version.create', 'policy', 'policy/rules', 'create'],
  ['policy.version.update', 'policy', 'policy/rules', 'update'],
  ['policy.version.enable', 'policy', 'policy/rules', 'enable'],
  ['policy.version.disable', 'policy', 'policy/rules', 'disable'],
  ['policy.runtime.mode.set', 'policy', 'policy/rules', 'update'],
  ['policy.version.publish', 'policy', 'policy/rules', 'publish'],
  ['policy.kill-switch.enable', 'policy', 'policy/rules', 'enable'],
  ['policy.kill-switch.clear', 'policy', 'policy/rules', 'disable'],
  ['settings.ai-and-local.view', 'settings', 'settings/ai-and-local', 'view', 'settings'],
  ['settings.store-config.create', 'settings', 'settings/ai-and-local', 'create'],
  ['settings.store-config.update', 'settings', 'settings/ai-and-local', 'update'],
  ['settings.store-config.archive', 'settings', 'settings/ai-and-local', 'archive'],
  ['settings.store-config.restore', 'settings', 'settings/ai-and-local', 'restore'],
  ['settings.scheduler.view', 'settings', 'settings/scheduler', 'view', 'scheduler'],
  ['settings.delivery.view', 'settings', 'settings/delivery', 'view', 'delivery'],
] as const;

export const PREVIEW_MISSION_CONTROL_CAPABILITIES: readonly MissionControlCapabilityProjection[] =
  PREVIEW_MISSION_CAPABILITY_SPECS.map(([capabilityId, workspace, view, action, legacyRoute]) => ({
    capabilityId,
    workspace,
    view,
    action,
    ...(legacyRoute ? { legacyRoute } : {}),
    state: 'PROTOTYPE_ONLY',
    blockerCode: 'DEV_PREVIEW_ONLY',
    detail: capabilityId === 'decisions.grants.issue'
      ? '仅开发预览：可演示 Evidence 锁定与整批授权，但不签发生产授权或执行真实 Ads。'
      : '仅开发预览 fixture；不代表生产服务、真实执行或真实回读已经接入。',
  }));

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

const PREVIEW_REPORT_FOLDER_ARTIFACT_ID = 'artifact:v1:00000000-0000-4000-8000-000000000101';
const PREVIEW_REPORT_MANIFEST_ARTIFACT_ID = 'artifact:v1:00000000-0000-4000-8000-000000000102';

function previewReportFileName(reportType: string): string {
  return `${reportType}.xlsx`;
}

function previewReportArtifactId(index: number): `artifact:v1:${string}` {
  return `artifact:v1:00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

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
    downloadArtifactId: PREVIEW_REPORT_FOLDER_ARTIFACT_ID,
    downloadDisplayName: '浏览器预览报表目录',
    manifestArtifactId: PREVIEW_REPORT_MANIFEST_ARTIFACT_ID,
    manifestDisplayName: '浏览器预览采集清单',
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
        downloadArtifactId: PREVIEW_REPORT_FOLDER_ARTIFACT_ID,
        downloadDisplayName: '浏览器预览报表目录',
        manifestArtifactId: PREVIEW_REPORT_MANIFEST_ARTIFACT_ID,
        manifestDisplayName: '浏览器预览采集清单',
        completedAt: '2026-06-24T09:00:00Z',
      } : null,
      sourceBatchIds: scenario.reportsCollected ? [previewScope.batchId] : [],
      availableBatches: previewBatchOptions(scenario),
      reportOptions,
      realReportFiles: scenario.reportsCollected ? reportOptions.map((item, index) => ({
        id: `preview-file-${item.type}`,
        batchId: previewScope.batchId,
        reportType: item.type,
        displayName: item.label,
        status: scenario.reportsImported ? 'imported' : 'downloaded',
        artifactId: previewReportArtifactId(index),
        sourceArtifactId: previewReportArtifactId(index),
        artifactDisplayName: previewReportFileName(String(item.type)),
        folderArtifactId: PREVIEW_REPORT_FOLDER_ARTIFACT_ID,
        folderDisplayName: '浏览器预览报表目录',
        fileName: previewReportFileName(String(item.type)),
        fileExtension: '.xlsx',
        fileSizeBytes: 1024,
        importedRows: item.importedRows,
      })) : [],
      evidenceArtifacts: scenario.reportsCollected
        ? [{
            label: '浏览器预览报表目录',
            artifactId: PREVIEW_REPORT_FOLDER_ARTIFACT_ID,
            displayName: '浏览器预览报表目录',
            kind: 'folder',
          }]
        : [],
      fileAudit: {
        totalFileRecords: scenario.reportsCollected ? 8 : 0,
        downloadedFileRecords: scenario.reportsCollected ? 8 : 0,
        existingFileRecords: scenario.reportsCollected ? 8 : 0,
        realReportFileCount: scenario.reportsCollected ? 8 : 0,
        importedRowCount: importedRows,
        rejectedEvidenceFileCount: 0,
        missingReportLabels: [],
        downloadArtifactId: PREVIEW_REPORT_FOLDER_ARTIFACT_ID,
        downloadDisplayName: '浏览器预览报表目录',
        manifestArtifactId: PREVIEW_REPORT_MANIFEST_ARTIFACT_ID,
        manifestDisplayName: '浏览器预览采集清单',
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

type PreviewVersionedProduct = {
  id: number;
  storeId: StoreId;
  marketplace_code: 'US';
  store_name: string;
  asin: string;
  asinValid: boolean;
  parent_asin: string;
  msku: string;
  sku: string;
  title: string;
  product_stage: string;
  status: string;
  created_at: string;
  updated_at: string;
  cost?: ProductCost;
  revision: string;
};

type PreviewProductState = {
  row: PreviewVersionedProduct;
  revisionVersion: number;
};

type PreviewVersionedOperationEvent = {
  id: number;
  storeId: StoreId;
  eventDate: string;
  storeName: string;
  marketplaceCode: 'US';
  asin?: string;
  asinValid: boolean;
  campaignName?: string;
  adGroupName?: string;
  eventType: string;
  title: string;
  impactExpectation?: string;
  notes?: string;
  evidenceArtifactId?: string;
  evidenceRefValid: boolean;
  archivedAt?: string;
  archiveRevision: number;
  createdAt: string;
  updatedAt: string;
  revision: string;
};

type PreviewOperationEventState = {
  row: PreviewVersionedOperationEvent;
  revisionVersion: number;
};

type PreviewAdObjectKind = 'campaign' | 'ad_group' | 'target' | 'search_term';

type PreviewAdObjectFact = {
  storeId: StoreId;
  marketplace: 'US';
  currency: 'USD';
  kind: PreviewAdObjectKind;
  objectKey: string;
  name: string;
  campaignName?: string;
  adGroupName?: string;
  asin?: string;
  firstDate?: string;
  lastDate?: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  acos: number;
  cpc: number;
  cvr: number;
  sourceRowCount: number;
  sourceFileCount: number;
  reportTypeCount: number;
};

type PreviewKeywordFact = {
  storeId: StoreId;
  marketplace: 'US';
  currency: 'USD';
  keyword: string;
  asin?: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  acos: number;
  cvr: number;
  sourceRowCount: number;
  opportunityLevel?: string;
  opportunityScore?: number;
  opportunityStatus?: string;
  evidence?: string;
  riskFlags: string[];
  recommendedSections: string[];
  lastObservedAt?: string;
};

type PreviewListingContent = {
  id: number;
  storeId: StoreId;
  storeName: string;
  marketplace: 'US';
  currency: 'USD';
  asin: string;
  title: string;
  bullets: string[];
  description: string;
  aPlus: string;
  imageCopy: string;
  backendTerms: string;
  source: string;
  versionLabel: string;
  changeSummary: string;
  createdAt: string;
  updatedAt: string;
  revision: string;
};

type PreviewListingState = {
  row: PreviewListingContent;
  revisionVersion: number;
};

type PreviewListingVersion = {
  id: number;
  listingContentId?: number;
  storeId: StoreId;
  asin: string;
  title: string;
  bullets: string[];
  description: string;
  aPlus: string;
  imageCopy: string;
  backendTerms: string;
  source: string;
  versionLabel: string;
  changeSummary: string;
  createdAt: string;
};

function previewRevision(prefix: string, id: number, version: number): string {
  const value = (BigInt(id) * 1_000_000n + BigInt(version)).toString(16).padStart(64, '0');
  return `${prefix}:${value}`;
}

function previewInputRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function previewRequiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} 必须是文本。`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} 不能为空。`);
  if (normalized.length > maxLength) throw new Error(`${label} 不能超过 ${maxLength} 个字符。`);
  return normalized;
}

function previewOptionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${label} 必须是文本。`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} 不能超过 ${maxLength} 个字符。`);
  return normalized || undefined;
}

function previewAsin(value: unknown): string {
  const asin = previewRequiredText(value, 'ASIN', 64).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(asin)) throw new Error('ASIN 包含不支持的字符。');
  return asin;
}

function previewIsoDate(value: unknown, label: string): string {
  const date = previewRequiredText(value, label, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`${label} 必须使用 YYYY-MM-DD。`);
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() !== Number(match[2]) - 1
    || parsed.getUTCDate() !== Number(match[3])
  ) throw new Error(`${label} 必须是真实日历日期。`);
  return date;
}

function previewPositiveInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} 必须是正整数。`);
  return number;
}

function previewTextArray(
  value: unknown,
  label: string,
  maxItems: number,
  maxItemLength: number,
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} 必须是文本数组。`);
  if (value.length > maxItems) throw new Error(`${label} 不能超过 ${maxItems} 项。`);
  return value.map((item, index) => {
    if (typeof item !== 'string') throw new Error(`${label}[${index}] 必须是文本。`);
    const normalized = item.trim();
    if (normalized.length > maxItemLength) {
      throw new Error(`${label}[${index}] 不能超过 ${maxItemLength} 个字符。`);
    }
    return normalized;
  }).filter(Boolean);
}

function assertPreviewIdentityHints(store: StoreRecord, input: Record<string, unknown>): void {
  const normalizedStoreName = store.displayName.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  for (const value of [input.storeName, input.store_name].filter((item) => item !== undefined)) {
    if (String(value).trim().replace(/\s+/g, ' ').toLocaleLowerCase() !== normalizedStoreName) {
      throw new Error('PREVIEW_STORE_IDENTITY_MISMATCH: storeName');
    }
  }
  for (const value of [input.marketplace, input.marketplaceCode, input.marketplace_code]
    .filter((item) => item !== undefined)) {
    if (String(value).trim().toUpperCase() !== 'US') {
      throw new Error('PREVIEW_STORE_IDENTITY_MISMATCH: marketplace');
    }
  }
  if (input.currency !== undefined && String(input.currency).trim().toUpperCase() !== 'USD') {
    throw new Error('PREVIEW_STORE_IDENTITY_MISMATCH: currency');
  }
}

const PREVIEW_COST_FIELDS = [
  'purchaseCost',
  'firstLegCost',
  'fbaFee',
  'referralFeeRate',
  'storageFee',
  'otherCost',
  'currentPrice',
  'minPrice',
  'targetNetMargin',
  'targetAcos',
  'targetTacos',
] as const;

function previewProductCost(
  productId: number,
  value: unknown,
  current?: ProductCost,
): ProductCost | undefined {
  if (value === undefined) return current ? clonePreviewSnapshot(current) : undefined;
  const input = previewInputRecord(value, '产品成本');
  if (Object.keys(input).length === 0) throw new Error('产品成本补丁不能为空。');
  const allowed = new Set<string>(PREVIEW_COST_FIELDS);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`产品成本包含不支持的字段：${unknown.join(', ')}`);
  const base: ProductCost = current ? clonePreviewSnapshot(current) : {
    productId,
    purchaseCost: 0,
    firstLegCost: 0,
    fbaFee: 0,
    referralFeeRate: 0.15,
    storageFee: 0,
    otherCost: 0,
    currentPrice: 0,
    minPrice: 0,
    targetNetMargin: 0,
    targetAcos: 0,
    targetTacos: 0,
  };
  for (const key of PREVIEW_COST_FIELDS) {
    if (input[key] === undefined) continue;
    const number = Number(input[key]);
    if (!Number.isFinite(number)) throw new Error(`${key} 必须是有限数字。`);
    if (key === 'targetNetMargin') {
      if (number < -1 || number > 1) throw new Error(`${key} 必须在 -1 到 1 之间。`);
    } else if (key === 'referralFeeRate' || key === 'targetAcos' || key === 'targetTacos') {
      if (number < 0 || number > 1) throw new Error(`${key} 必须在 0 到 1 之间。`);
    } else if (number < 0) {
      throw new Error(`${key} 不能为负数。`);
    }
    base[key] = number;
  }
  base.productId = productId;
  base.updatedAt = new Date().toISOString();
  return base;
}

function normalizedPreviewText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizedPreviewPath(value: unknown): string {
  return normalizedPreviewText(value).replace(/\\/g, '/').toLowerCase();
}

function samePreviewWritableTarget(
  left: WritableAdTargetEvidence | undefined,
  right: WritableAdTargetEvidence | undefined,
): boolean {
  if (!left || !right) return false;
  return left.entityType === right.entityType
    && normalizedPreviewText(left.entityId).toLowerCase() === normalizedPreviewText(right.entityId).toLowerCase()
    && normalizedPreviewText(left.entityName).toLowerCase() === normalizedPreviewText(right.entityName).toLowerCase()
    && normalizedPreviewText(left.campaignName).toLowerCase() === normalizedPreviewText(right.campaignName).toLowerCase()
    && normalizedPreviewText(left.adGroupName).toLowerCase() === normalizedPreviewText(right.adGroupName).toLowerCase()
    && normalizedPreviewText(left.metricDate) === normalizedPreviewText(right.metricDate)
    && normalizedPreviewPath(left.sourceFile) === normalizedPreviewPath(right.sourceFile)
    && Number(left.sourceRow) === Number(right.sourceRow)
    && left.identitySource === right.identitySource
    && normalizedPreviewText(left.verifiedBy) === normalizedPreviewText(right.verifiedBy)
    && normalizedPreviewText(left.verifiedAt) === normalizedPreviewText(right.verifiedAt)
    && normalizedPreviewText(left.verificationNote) === normalizedPreviewText(right.verificationNote)
    && normalizedPreviewPath(left.identityProofPath) === normalizedPreviewPath(right.identityProofPath);
}

function previewWritableTargetOwnershipBlockers(recommendation: PreviewRecommendation): string[] {
  const writableTarget = recommendation.evidence?.writableTarget;
  if (!writableTarget) return [];

  const blockers: string[] = [];
  const reportType = normalizedPreviewText(recommendation.evidence?.reportType).toLowerCase();
  if (!['keyword', 'auto_targeting', 'product_targeting'].includes(reportType)) {
    blockers.push(`当前建议来源报表类型 ${reportType || 'unknown'} 不能唯一映射到 Ads 可写对象`);
  } else if (writableTarget.entityType !== reportType) {
    blockers.push('核验到的 Ads 对象类型与当前建议来源不一致');
  }

  const expectedName = normalizedPreviewText(
    recommendation.evidence?.searchTerm
      || recommendation.evidence?.targeting
      || recommendation.entityName,
  ).toLowerCase();
  if (normalizedPreviewText(writableTarget.entityName).toLowerCase() !== expectedName) {
    blockers.push('核验到的 Ads 对象名称与当前建议对象不一致');
  }
  if (
    normalizedPreviewText(writableTarget.campaignName).toLowerCase()
      !== normalizedPreviewText(recommendation.evidence?.campaignName).toLowerCase()
    || normalizedPreviewText(writableTarget.adGroupName).toLowerCase()
      !== normalizedPreviewText(recommendation.evidence?.adGroupName).toLowerCase()
  ) {
    blockers.push('核验到的 Ads 对象不属于当前建议的 campaign / ad group');
  }
  if (
    !recommendation.evidence?.sourceFiles?.some(
      (sourceFile) => normalizedPreviewPath(sourceFile) === normalizedPreviewPath(writableTarget.sourceFile),
    )
    || Number(writableTarget.sourceRow) !== Number(recommendation.evidence?.sourceRow)
  ) {
    blockers.push('核验到的 Ads 对象来源行与当前建议来源权威不一致');
  }
  if (normalizedPreviewText(writableTarget.metricDate) !== normalizedPreviewText(recommendation.evidence?.date)) {
    blockers.push('核验到的 Ads 对象指标日期与当前建议不一致');
  }

  const binding = recommendation.evidence?.writableTargetBinding;
  const resolution = recommendation.evidence?.reviewResolution;
  const currentBinding = Boolean(binding)
    && binding?.schemaVersion === 1
    && binding.fromRevision + 1 === binding.boundRevision
    && binding.boundRevision === recommendation.revision
    && samePreviewWritableTarget(binding.writableTarget, writableTarget);
  const currentResolution = Boolean(resolution)
    && resolution?.schemaVersion === 1
    && resolution.fromRevision + 1 === resolution.resolvedRevision
    && resolution.resolvedRevision === recommendation.revision
    && samePreviewWritableTarget(resolution.writableTarget, writableTarget);
  if (!currentBinding && !currentResolution) {
    blockers.push('缺少当前建议版本对应的 Ads 对象绑定或复核审计');
  }

  return blockers;
}

function previewDecisionSnapshot(
  recommendation: PreviewRecommendation,
  targetStatus: RecommendationDecisionStatus,
  decision: RecommendationDecisionInput,
  decidedAt: string,
): RecommendationDecisionInput {
  return {
    ...decision,
    decision: targetStatus,
    approvedBy: targetStatus === 'approved'
      ? normalizedPreviewText(decision.approvedBy)
      : undefined,
    rejectedBy: targetStatus === 'rejected'
      ? normalizedPreviewText(decision.rejectedBy)
      : undefined,
    decidedAt,
    note: normalizedPreviewText(decision.note),
    batchId: recommendation.evidence?.batchId,
    recommendationId: recommendation.id,
    actionType: recommendation.actionType,
    portfolioName: recommendation.evidence?.portfolioName,
    campaignName: recommendation.evidence?.campaignName,
    adGroupName: recommendation.evidence?.adGroupName,
    asin: recommendation.asin,
    entityType: recommendation.entityType,
    entityName: recommendation.entityName,
    currentValue: recommendation.currentValue,
    recommendedValue: recommendation.recommendedValue,
    sourceBatchId: recommendation.evidence?.batchId,
    metricDate: recommendation.evidence?.date,
    sourceRow: recommendation.evidence?.sourceRow,
    sourceFiles: [...(recommendation.evidence?.sourceFiles || [])],
    explanationSource: recommendation.evidence?.explanationSource,
    aiModel: recommendation.evidence?.aiModel,
    aiStrategySource: recommendation.evidence?.aiStrategySource,
    aiLifecycleStage: recommendation.evidence?.aiLifecycleStage,
    aiStrategySummary: recommendation.evidence?.aiStrategySummary,
    decisionAgreement: recommendation.evidence?.decisionAgreement,
    decisionSource: recommendation.evidence?.decisionSource,
    decisionReasons: [...(recommendation.evidence?.decisionReasons || [])],
    decisionRiskWarnings: [...(recommendation.evidence?.decisionRiskWarnings || [])],
    quantReasons: [...(recommendation.evidence?.quantReasons || [])],
    quantThresholds: recommendation.evidence?.quantThresholds,
    scope: {
      dateFrom: previewScope.dateFrom,
      dateTo: previewScope.dateTo,
      storeName: previewScope.storeName,
      marketplaceCode: previewScope.marketplaceCode,
      asin: recommendation.asin,
    },
  };
}

function applyPreviewRecommendationDecision(
  recommendation: PreviewRecommendation,
  targetStatus: RecommendationDecisionStatus,
  decision: RecommendationDecisionInput,
  decidedAt = new Date().toISOString(),
): void {
  applyRecommendationDecision({
    recommendation,
    targetStatus,
    decision: previewDecisionSnapshot(recommendation, targetStatus, decision, decidedAt),
    approvalOptions: {
      allowedSourceFiles: previewReportOptions.map((report) => previewReportFileName(String(report.type))),
      writableTargetOwnershipBlockers: previewWritableTargetOwnershipBlockers(recommendation),
    },
    persist: (status, evidencePatch) => {
      recommendation.status = status;
      recommendation.revision += 1;
      recommendation.updatedAt = decidedAt;
      recommendation.evidence = {
        ...recommendation.evidence,
        ...evidencePatch,
      } as PreviewRecommendation['evidence'];
    },
  });
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
  let activePreviewScope: OperationScope = clonePreviewSnapshot(previewScope);
  let fixtures = previewFixtures(scenario);
  const recommendationSource = ['mixed', 'approved'].includes(scenario.recommendationState)
    ? previewDiagnostics
    : [];
  let recommendations: PreviewRecommendation[] = recommendationSource.map((diagnostic, index) => ({
    id: 10_001 + index,
    taskId: `preview-recommendation-${index + 1}`,
    storeName: activePreviewScope.storeName,
    marketplaceCode: activePreviewScope.marketplaceCode,
    asin: diagnostic.asin,
    msku: 'D6-M',
    entityType: diagnostic.objectType as ActionRecommendation['entityType'],
    entityId: `${diagnostic.campaignName}_${diagnostic.adGroupName}_${diagnostic.objectName}`,
    entityName: diagnostic.objectName,
    actionType: 'lower_bid',
    currentValue: index === 0 ? '1.20' : '0.88',
    recommendedValue: index === 0 ? '0.95' : '1.02',
    reason: diagnostic.diagnosis,
    acos: diagnostic.acos,
    clicks: diagnostic.clicks,
    cost: diagnostic.spend,
    riskLevel: 'APPROVAL',
    status: index === 0 ? 'pending' : 'needs_review',
    revision: 0,
    confidence: index === 0 ? 0.86 : 0.72,
    createdAt: '2026-06-24T09:00:00.000Z',
    updatedAt: '2026-06-24T09:00:00.000Z',
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
      batchId: activePreviewScope.batchId,
      date: activePreviewScope.dateTo,
      asin: diagnostic.asin,
      campaignName: diagnostic.campaignName,
      adGroupName: diagnostic.adGroupName,
      targeting: diagnostic.objectName,
      matchType: diagnostic.objectType,
      reportType: index === 0 ? 'keyword' : 'user_search_term',
      sourceFile: index === 0
        ? previewReportFileName('keyword')
        : previewReportFileName('user_search_term'),
      sourceFiles: [
        index === 0
          ? previewReportFileName('keyword')
          : previewReportFileName('user_search_term'),
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
          dateRange: `${activePreviewScope.dateFrom} 至 ${activePreviewScope.dateTo}`,
          batchId: activePreviewScope.batchId,
          reportType: index === 0 ? 'keyword' : 'user_search_term',
          sourceFile: index === 0
            ? previewReportFileName('keyword')
            : previewReportFileName('user_search_term'),
          sourceRow: 42 + index,
          storeName: activePreviewScope.storeName,
          marketplaceCode: activePreviewScope.marketplaceCode,
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
          dateRange: `${activePreviewScope.dateFrom} 至 ${activePreviewScope.dateTo}`,
          batchId: activePreviewScope.batchId,
          storeName: activePreviewScope.storeName,
          marketplaceCode: activePreviewScope.marketplaceCode,
          asin: diagnostic.asin,
          campaignName: diagnostic.campaignName,
          adGroupName: diagnostic.adGroupName,
          entityType: diagnostic.objectType,
          entityName: diagnostic.objectName,
          timeline: {
            activeDays: 34,
            firstMetricDate: activePreviewScope.dateFrom,
            lastMetricDate: activePreviewScope.dateTo,
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
    },
  } as PreviewRecommendation));
  if (scenario.recommendationState === 'approved' && recommendations.length >= 2) {
    const approved = recommendations[0];
    const boundAt = '2026-06-24T09:50:00.000Z';
    const writableTarget: WritableAdTargetEvidence = {
      entityType: 'keyword',
      entityId: 'amzn-keyword-preview-1001',
      entityName: approved.entityName,
      campaignName: approved.evidence.campaignName || '',
      adGroupName: approved.evidence.adGroupName || '',
      metricDate: approved.evidence.date || '',
      sourceFile: approved.evidence.sourceFile || approved.evidence.sourceFiles?.[0] || '',
      sourceRow: Number(approved.evidence.sourceRow),
      identitySource: 'ads_ui',
      verifiedBy: 'Preview Verifier',
      verifiedAt: boundAt,
      verificationNote: '已在 Ads UI 中逐项核对活动、广告组、关键词名称与对象 ID。',
      identityProofPath: 'D:/preview/evidence/keyword-1001.png',
    };
    const binding: WritableAdTargetBinding = {
      schemaVersion: 1,
      fromRevision: 0,
      boundRevision: 1,
      boundBy: 'Preview Verifier',
      boundAt,
      note: '预览历史通过与生产一致的对象绑定门生成。',
      scope: {
        dateFrom: activePreviewScope.dateFrom,
        dateTo: activePreviewScope.dateTo,
        storeName: activePreviewScope.storeName,
        marketplaceCode: activePreviewScope.marketplaceCode,
        asin: approved.asin,
        batchId: activePreviewScope.batchId || '',
      },
      metricSource: {
        batchId: activePreviewScope.batchId || '',
        sourceFiles: [...(approved.evidence.sourceFiles || [])],
        sourceRow: Number(approved.evidence.sourceRow),
      },
      writableTarget,
    };
    approved.revision = binding.boundRevision;
    approved.updatedAt = boundAt;
    approved.evidence = {
      ...approved.evidence,
      writableTarget,
      writableTargetBinding: binding,
    };
    applyPreviewRecommendationDecision(approved, 'approved', {
      approvedBy: 'Preview Approver',
      note: '预览批准历史，仅用于界面验证。',
    }, '2026-06-24T10:00:00.000Z');
    applyPreviewRecommendationDecision(recommendations[1], 'rejected', {
      rejectedBy: 'Preview Reviewer',
      note: '预览拒绝历史，仅用于界面验证。',
    }, '2026-06-24T10:01:00.000Z');
  }
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
  let previewStores = PREVIEW_STORES.map((store) => ({ ...store }));
  let activePreviewStoreId: StoreId | null = null;
  const previewRuntimeConfigs = new Map<StoreId, StoreRuntimeConfigProjection>();
  const defaultPreviewRuntimeValues = (): StoreRuntimeConfigValues => ({
    aiRecommendationsEnabled: true,
    collectionScheduleLocalTime: '08:00',
    collectionLookbackDays: 14,
    analysisWindowDays: 30,
    defaultTargetAcosPercent: 28,
    minimumRecommendationConfidencePercent: 72,
    evidenceRetentionDays: 365,
  });
  const buildPreviewRuntimeConfig = (
    store: StoreRecord,
    values: StoreRuntimeConfigValues,
    revision: number,
    status: 'active' | 'archived',
    occurredAt = new Date().toISOString(),
  ): StoreRuntimeConfigRecord => ({
    configId: `preview-store-config-${store.storeId}`,
    storeId: store.storeId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: store.businessTimezone,
    status,
    revision,
    values: clonePreviewSnapshot(values),
    createdAt: previewRuntimeConfigs.get(store.storeId)?.current?.createdAt ?? occurredAt,
    updatedAt: occurredAt,
    ...(status === 'archived' ? { archivedAt: occurredAt } : {}),
  });
  const initialConfigStore = previewStores[0];
  if (initialConfigStore) {
    const occurredAt = '2026-07-22T08:00:00.000Z';
    const current = buildPreviewRuntimeConfig(initialConfigStore, defaultPreviewRuntimeValues(), 1, 'active', occurredAt);
    previewRuntimeConfigs.set(initialConfigStore.storeId, {
      current,
      versions: [{ revision: 1, action: 'create', occurredAt, snapshot: clonePreviewSnapshot(current) }],
    });
  }
  let previewProductIdSequence = 0;
  let previewOperationEventIdSequence = 0;
  let previewListingIdSequence = 0;
  let previewListingVersionIdSequence = 0;
  type PreviewStoreDataset = {
    scope: OperationScope;
    fixtures: ReturnType<typeof previewFixtures>;
    recommendations: PreviewRecommendation[];
    products: PreviewProductState[];
    operationEvents: PreviewOperationEventState[];
    adObjects: PreviewAdObjectFact[];
    keywordFacts: PreviewKeywordFact[];
    listings: PreviewListingState[];
    listingVersions: PreviewListingVersion[];
  };
  const basePreviewScope = clonePreviewSnapshot(activePreviewScope);
  const baseFixtures = clonePreviewSnapshot(fixtures);
  const baseRecommendations = clonePreviewSnapshot(recommendations);
  const buildPreviewProducts = (
    store: StoreRecord,
    sourceFixtures: ReturnType<typeof previewFixtures>,
  ): PreviewProductState[] => sourceFixtures.products.slice(0, 3).map((source) => {
    const id = ++previewProductIdSequence;
    const revisionVersion = 1;
    const createdAt = '2026-07-22T08:00:00.000Z';
    const updatedAt = typeof source.updatedAt === 'string'
      ? source.updatedAt
      : createdAt;
    return {
      revisionVersion,
      row: {
        id,
        storeId: store.storeId,
        marketplace_code: 'US',
        store_name: store.displayName,
        asin: previewAsin(source.asin),
        asinValid: true,
        parent_asin: String(source.parent_asin ?? source.parentAsin ?? ''),
        msku: String(source.msku ?? ''),
        sku: String(source.sku ?? ''),
        title: String(source.title ?? ''),
        product_stage: String(source.product_stage ?? source.productStage ?? 'keyword_exploration'),
        status: source.status === 'inactive' ? 'inactive' : 'active',
        created_at: createdAt,
        updated_at: updatedAt,
        cost: previewProductCost(id, source.cost),
        revision: previewRevision('product-v1', id, revisionVersion),
      },
    };
  });
  const buildPreviewOperationEvents = (
    store: StoreRecord,
    sourceFixtures: ReturnType<typeof previewFixtures>,
  ): PreviewOperationEventState[] => sourceFixtures.events.map((source) => {
    const id = ++previewOperationEventIdSequence;
    const revisionVersion = 1;
    const createdAt = typeof source.createdAt === 'string'
      ? source.createdAt
      : '2026-07-22T08:30:00.000Z';
    return {
      revisionVersion,
      row: {
        id,
        storeId: store.storeId,
        eventDate: previewIsoDate(source.eventDate, '事件日期'),
        storeName: store.displayName,
        marketplaceCode: 'US',
        asin: source.asin ? previewAsin(source.asin) : undefined,
        asinValid: true,
        eventType: String(source.eventType || 'manual_note'),
        title: String(source.title || '开发预览运营事件'),
        impactExpectation: typeof source.impact === 'string' ? source.impact : 'unknown',
        notes: typeof source.description === 'string' ? source.description : undefined,
        evidenceRefValid: true,
        archiveRevision: 0,
        createdAt,
        updatedAt: createdAt,
        revision: previewRevision('operation-event-v1', id, revisionVersion),
      },
    };
  });
  const buildPreviewAdObjects = (
    store: StoreRecord,
    identity: PreviewStoreIdentity,
  ): PreviewAdObjectFact[] => {
    const campaignName = `${identity.storeName} Core Campaign`;
    const adGroupName = `${identity.pathSegment}-Exact-Ad-Group`;
    const targetName = `${identity.pathSegment} smart lock`;
    const searchTermName = `${identity.pathSegment} bedroom lock`;
    const common = {
      storeId: store.storeId,
      marketplace: 'US' as const,
      currency: 'USD' as const,
      asin: identity.primaryAsin,
      firstDate: '2026-07-01',
      lastDate: '2026-07-22',
      impressions: 6_840,
      clicks: 98,
      spend: 111.54,
      orders: 5,
      sales: 249.95,
      acos: 111.54 / 249.95,
      cpc: 111.54 / 98,
      cvr: 5 / 98,
      sourceRowCount: 34,
      sourceFileCount: 2,
      reportTypeCount: 2,
    };
    const objectKey = (
      kind: PreviewAdObjectKind,
      campaign: string | undefined,
      adGroup: string | undefined,
      name: string,
    ) => [kind, campaign ?? '', adGroup ?? '', name].map(encodeURIComponent).join('/');
    return [
      {
        ...common,
        kind: 'campaign',
        objectKey: objectKey('campaign', campaignName, undefined, campaignName),
        name: campaignName,
        campaignName,
      },
      {
        ...common,
        kind: 'ad_group',
        objectKey: objectKey('ad_group', campaignName, adGroupName, adGroupName),
        name: adGroupName,
        campaignName,
        adGroupName,
      },
      {
        ...common,
        kind: 'target',
        objectKey: objectKey('target', campaignName, adGroupName, targetName),
        name: targetName,
        campaignName,
        adGroupName,
      },
      {
        ...common,
        kind: 'search_term',
        objectKey: objectKey('search_term', campaignName, adGroupName, searchTermName),
        name: searchTermName,
        campaignName,
        adGroupName,
      },
    ];
  };
  const buildPreviewKeywordFacts = (
    store: StoreRecord,
    identity: PreviewStoreIdentity,
  ): PreviewKeywordFact[] => [
    {
      storeId: store.storeId,
      marketplace: 'US',
      currency: 'USD',
      keyword: `${identity.pathSegment} smart lock`,
      asin: identity.primaryAsin,
      impressions: 3_920,
      clicks: 45,
      spend: 39.68,
      orders: 4,
      sales: 199.96,
      acos: 39.68 / 199.96,
      cvr: 4 / 45,
      sourceRowCount: 28,
      opportunityLevel: 'high',
      opportunityScore: 0.91,
      opportunityStatus: 'pending',
      evidence: '开发预览中的店铺隔离指标与机会合并结果。',
      riskFlags: [],
      recommendedSections: ['title', 'bullet'],
      lastObservedAt: '2026-07-22T08:45:00.000Z',
    },
    {
      storeId: store.storeId,
      marketplace: 'US',
      currency: 'USD',
      keyword: `${identity.pathSegment} bedroom lock`,
      asin: identity.secondaryAsin,
      impressions: 1_460,
      clicks: 21,
      spend: 24.2,
      orders: 1,
      sales: 49.99,
      acos: 24.2 / 49.99,
      cvr: 1 / 21,
      sourceRowCount: 16,
      opportunityLevel: 'medium',
      opportunityScore: 0.63,
      opportunityStatus: 'pending',
      evidence: '开发预览事实，不代表真实报表入库成功。',
      riskFlags: ['preview-only'],
      recommendedSections: ['backend_terms'],
      lastObservedAt: '2026-07-22T08:45:00.000Z',
    },
  ];
  const buildPreviewListings = (
    store: StoreRecord,
    identity: PreviewStoreIdentity,
  ): { listings: PreviewListingState[]; listingVersions: PreviewListingVersion[] } => {
    const id = ++previewListingIdSequence;
    const revisionVersion = 1;
    const createdAt = '2026-07-22T08:50:00.000Z';
    const row: PreviewListingContent = {
      id,
      storeId: store.storeId,
      storeName: store.displayName,
      marketplace: 'US',
      currency: 'USD',
      asin: identity.primaryAsin,
      title: `${identity.storeName} Preview Listing`,
      bullets: ['开发预览内容仅用于验证当前店铺界面。'],
      description: '此内容不会自动提交 Amazon，也不代表真实 Listing 已采集。',
      aPlus: '',
      imageCopy: '',
      backendTerms: `${identity.pathSegment} smart lock`,
      source: 'manual',
      versionLabel: 'preview-v1',
      changeSummary: '初始化当前店铺开发预览内容。',
      createdAt,
      updatedAt: createdAt,
      revision: previewRevision('listing-content-v1', id, revisionVersion),
    };
    return {
      listings: [{ row, revisionVersion }],
      listingVersions: [{
        id: ++previewListingVersionIdSequence,
        listingContentId: id,
        storeId: store.storeId,
        asin: row.asin,
        title: row.title,
        bullets: [...row.bullets],
        description: row.description,
        aPlus: row.aPlus,
        imageCopy: row.imageCopy,
        backendTerms: row.backendTerms,
        source: row.source,
        versionLabel: row.versionLabel,
        changeSummary: row.changeSummary,
        createdAt,
      }],
    };
  };
  const previewDatasets = new Map<StoreId, PreviewStoreDataset>(
    previewStores.map((store) => {
      const identity = previewStoreIdentity(store);
      const storeFixtures = applyPreviewStoreIdentity(baseFixtures, identity);
      const listingDataset = buildPreviewListings(store, identity);
      return [store.storeId, {
        scope: applyPreviewStoreIdentity(basePreviewScope, identity),
        fixtures: storeFixtures,
        recommendations: applyPreviewStoreIdentity(baseRecommendations, identity),
        products: buildPreviewProducts(store, storeFixtures),
        operationEvents: buildPreviewOperationEvents(store, storeFixtures),
        adObjects: buildPreviewAdObjects(store, identity),
        keywordFacts: scenario.diagnosisReady ? buildPreviewKeywordFacts(store, identity) : [],
        ...listingDataset,
      }];
    }),
  );
  const activatePreviewDataset = (store: StoreRecord) => {
    let dataset = previewDatasets.get(store.storeId);
    if (!dataset) {
      const identity = previewStoreIdentity(store);
      const storeFixtures = applyPreviewStoreIdentity(baseFixtures, identity);
      const listingDataset = buildPreviewListings(store, identity);
      dataset = {
        scope: applyPreviewStoreIdentity(basePreviewScope, identity),
        fixtures: storeFixtures,
        recommendations: applyPreviewStoreIdentity(baseRecommendations, identity),
        products: buildPreviewProducts(store, storeFixtures),
        operationEvents: buildPreviewOperationEvents(store, storeFixtures),
        adObjects: buildPreviewAdObjects(store, identity),
        keywordFacts: scenario.diagnosisReady ? buildPreviewKeywordFacts(store, identity) : [],
        ...listingDataset,
      };
      previewDatasets.set(store.storeId, dataset);
    }
    activePreviewScope = dataset.scope;
    fixtures = dataset.fixtures;
    recommendations = dataset.recommendations;
    return dataset;
  };
  const previewGenerations = new Map<StoreId, number>(
    previewStores.map((store) => [store.storeId, 0]),
  );
  const storeContextListeners = new Set<(view: StoreWorkspaceView) => void>();
  const storeRecordListeners = new Set<(store: StoreRecord) => void>();

  const currentPreviewContext = (): StoreContextEnvelope | null => {
    if (!activePreviewStoreId) return null;
    const store = previewStores.find((row) => row.storeId === activePreviewStoreId);
    if (!store || store.status !== 'active') return null;
    return previewContext(store, previewGenerations.get(store.storeId) ?? 0);
  };
  const requirePreviewStore = (storeIdInput: unknown): StoreRecord => {
    const storeId = normalizeStoreId(storeIdInput);
    const store = previewStores.find((row) => row.storeId === storeId);
    if (!store) throw new Error(`PREVIEW_STORE_NOT_FOUND:${storeId}`);
    return store;
  };
  const previewView = (store: StoreRecord, context: StoreContextEnvelope): StoreWorkspaceView => ({
    store: clonePreviewSnapshot(store),
    context: clonePreviewSnapshot(context),
    connections: [],
    sessions: [],
  });
  const requirePreviewMissionAuthority = (submitted: StoreContextEnvelope) => {
    const authoritative = currentPreviewContext();
    if (!authoritative) throw new Error('PREVIEW_EXPLICIT_STORE_SELECTION_REQUIRED');
    if (missionControlContextKey(authoritative) !== missionControlContextKey(submitted)) {
      throw new Error('PREVIEW_MISSION_CONTROL_STORE_CONTEXT_MISMATCH');
    }
    return authoritative;
  };
  const requirePreviewDatasetAuthority = (submitted: StoreContextEnvelope) => {
    const authoritative = requirePreviewMissionAuthority(submitted);
    const store = requirePreviewStore(authoritative.storeId);
    const dataset = previewDatasets.get(store.storeId) ?? activatePreviewDataset(store);
    return { authoritative, store, dataset };
  };
  const publicPreviewProduct = (state: PreviewProductState): PreviewVersionedProduct =>
    clonePreviewSnapshot(state.row);
  const requirePreviewProductState = (dataset: PreviewStoreDataset, idInput: unknown) => {
    const id = previewPositiveInteger(idInput, '产品 ID');
    const state = dataset.products.find((candidate) => candidate.row.id === id);
    if (!state) throw new Error('PREVIEW_OBJECT_NOT_FOUND: 当前店铺不存在该产品。');
    return state;
  };
  const assertPreviewRevision = (expected: unknown, actual: string, label: string) => {
    if (typeof expected !== 'string' || !expected) {
      throw new Error(`PREVIEW_CAS_REQUIRED: ${label}必须提供 expectedRevision。`);
    }
    if (expected !== actual) {
      throw new Error(`PREVIEW_OBJECT_CONFLICT: ${label}版本冲突，请重新读取后再试。`);
    }
  };
  const listPreviewProducts = (
    submitted: StoreContextEnvelope,
    inputValue: unknown = {},
  ): PreviewVersionedProduct[] => {
    const { store, dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '产品列表参数');
    assertPreviewIdentityHints(store, input);
    if (input.includeArchived !== undefined && typeof input.includeArchived !== 'boolean') {
      throw new Error('includeArchived 必须是布尔值。');
    }
    return dataset.products
      .filter((state) => input.includeArchived === true || state.row.status !== 'archived')
      .map(publicPreviewProduct);
  };
  const getPreviewProduct = (
    submitted: StoreContextEnvelope,
    inputValue: unknown,
  ): PreviewVersionedProduct => {
    const { store, dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '产品查询参数');
    assertPreviewIdentityHints(store, input);
    const byId = input.id !== undefined;
    const byAsin = input.asin !== undefined;
    if (byId === byAsin) throw new Error('产品查询必须且只能提供 id 或 asin。');
    const state = byId
      ? requirePreviewProductState(dataset, input.id)
      : dataset.products.find((candidate) => candidate.row.asin === previewAsin(input.asin));
    if (!state) throw new Error('PREVIEW_OBJECT_NOT_FOUND: 当前店铺不存在该产品。');
    return publicPreviewProduct(state);
  };
  const createPreviewProduct = (
    submitted: StoreContextEnvelope,
    inputValue: unknown,
  ): PreviewVersionedProduct => {
    const { store, dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '产品创建参数');
    assertPreviewIdentityHints(store, input);
    const asin = previewAsin(input.asin);
    if (dataset.products.some((candidate) => candidate.row.asin === asin)) {
      throw new Error(`PREVIEW_OBJECT_ALREADY_EXISTS: ${asin} 已存在于当前店铺。`);
    }
    const status = previewOptionalText(input.status, '产品状态', 32) ?? 'active';
    if (status !== 'active' && status !== 'inactive') {
      throw new Error('新产品状态只能是 active 或 inactive。');
    }
    const id = ++previewProductIdSequence;
    const revisionVersion = 1;
    const now = new Date().toISOString();
    const state: PreviewProductState = {
      revisionVersion,
      row: {
        id,
        storeId: store.storeId,
        marketplace_code: 'US',
        store_name: store.displayName,
        asin,
        asinValid: true,
        parent_asin: previewOptionalText(input.parentAsin ?? input.parent_asin, '父 ASIN', 64) ?? '',
        msku: previewOptionalText(input.msku, 'MSKU', 200) ?? '',
        sku: previewOptionalText(input.sku, 'SKU', 200) ?? '',
        title: previewOptionalText(input.title, '产品标题', 1_000) ?? '',
        product_stage: previewOptionalText(input.productStage ?? input.product_stage, '产品阶段', 100)
          ?? 'keyword_exploration',
        status,
        created_at: now,
        updated_at: now,
        cost: previewProductCost(id, input.cost),
        revision: previewRevision('product-v1', id, revisionVersion),
      },
    };
    dataset.products.push(state);
    return publicPreviewProduct(state);
  };
  const updatePreviewProduct = (
    submitted: StoreContextEnvelope,
    inputValue: unknown,
  ): PreviewVersionedProduct => {
    const { store, dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '产品更新参数');
    const state = requirePreviewProductState(dataset, input.id);
    assertPreviewRevision(input.expectedRevision, state.row.revision, '产品更新');
    const patch = input.patch === undefined ? {} : previewInputRecord(input.patch, '产品补丁');
    assertPreviewIdentityHints(store, patch);
    if (patch.asin !== undefined && previewAsin(patch.asin) !== state.row.asin) {
      throw new Error('开发预览不支持修改产品 ASIN；请新建产品。');
    }
    let changed = false;
    const next = clonePreviewSnapshot(state.row);
    const assignText = (
      key: 'parent_asin' | 'msku' | 'sku' | 'title' | 'product_stage',
      value: unknown,
      label: string,
      maxLength: number,
    ) => {
      if (value === undefined) return;
      next[key] = previewOptionalText(value, label, maxLength) ?? '';
      changed = true;
    };
    assignText('parent_asin', patch.parentAsin ?? patch.parent_asin, '父 ASIN', 64);
    assignText('msku', patch.msku, 'MSKU', 200);
    assignText('sku', patch.sku, 'SKU', 200);
    assignText('title', patch.title, '产品标题', 1_000);
    assignText('product_stage', patch.productStage ?? patch.product_stage, '产品阶段', 100);
    if (patch.status !== undefined) {
      const status = previewRequiredText(patch.status, '产品状态', 32);
      if (status !== 'active' && status !== 'inactive') {
        throw new Error('产品更新状态只能是 active 或 inactive；归档请使用 archiveStoreProduct。');
      }
      next.status = status;
      changed = true;
    }
    if (input.cost !== undefined) {
      next.cost = previewProductCost(next.id, input.cost, next.cost);
      changed = true;
    }
    if (!changed) throw new Error('产品更新必须包含可编辑字段或成本补丁。');
    state.revisionVersion += 1;
    next.storeId = store.storeId;
    next.store_name = store.displayName;
    next.marketplace_code = 'US';
    next.updated_at = new Date().toISOString();
    next.revision = previewRevision('product-v1', next.id, state.revisionVersion);
    state.row = next;
    return publicPreviewProduct(state);
  };
  const archivePreviewProduct = (
    submitted: StoreContextEnvelope,
    inputValue: unknown,
  ): PreviewVersionedProduct => {
    const { dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '产品归档参数');
    const state = requirePreviewProductState(dataset, input.id);
    assertPreviewRevision(input.expectedRevision, state.row.revision, '产品归档');
    if (state.row.status === 'archived') return publicPreviewProduct(state);
    state.revisionVersion += 1;
    state.row = {
      ...state.row,
      status: 'archived',
      updated_at: new Date().toISOString(),
      revision: previewRevision('product-v1', state.row.id, state.revisionVersion),
    };
    return publicPreviewProduct(state);
  };
  const publicPreviewOperationEvent = (
    state: PreviewOperationEventState,
  ): PreviewVersionedOperationEvent => clonePreviewSnapshot(state.row);
  const requirePreviewOperationEventState = (dataset: PreviewStoreDataset, idInput: unknown) => {
    const id = previewPositiveInteger(idInput, '运营事件 ID');
    const state = dataset.operationEvents.find((candidate) => candidate.row.id === id);
    if (!state) throw new Error('PREVIEW_OBJECT_NOT_FOUND: 当前店铺不存在该运营事件。');
    return state;
  };
  const optionalPreviewAsin = (value: unknown): string | undefined => (
    value === undefined || value === null || String(value).trim() === ''
      ? undefined
      : previewAsin(value)
  );
  const listPreviewOperationEvents = (
    submitted: StoreContextEnvelope,
    inputValue: unknown = {},
  ): PreviewVersionedOperationEvent[] => {
    const { store, dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '运营事件列表参数');
    assertPreviewIdentityHints(store, input);
    const dateFrom = input.dateFrom === undefined ? undefined : previewIsoDate(input.dateFrom, 'dateFrom');
    const dateTo = input.dateTo === undefined ? undefined : previewIsoDate(input.dateTo, 'dateTo');
    if (dateFrom && dateTo && dateFrom > dateTo) throw new Error('dateFrom 不能晚于 dateTo。');
    const asin = optionalPreviewAsin(input.asin);
    const campaignName = previewOptionalText(input.campaignName, 'Campaign 名称', 500);
    const adGroupName = previewOptionalText(input.adGroupName, '广告组名称', 500);
    const eventType = previewOptionalText(input.eventType, '事件类型', 100);
    if (input.includeArchived !== undefined && typeof input.includeArchived !== 'boolean') {
      throw new Error('includeArchived 必须是布尔值。');
    }
    const limit = input.limit === undefined ? 200 : previewPositiveInteger(input.limit, 'limit');
    if (limit > 1_000) throw new Error('limit 不能超过 1000。');
    return dataset.operationEvents
      .filter(({ row }) => input.includeArchived === true || !row.archivedAt)
      .filter(({ row }) => !dateFrom || row.eventDate >= dateFrom)
      .filter(({ row }) => !dateTo || row.eventDate <= dateTo)
      .filter(({ row }) => !asin || row.asin === asin)
      .filter(({ row }) => !campaignName || row.campaignName === campaignName)
      .filter(({ row }) => !adGroupName || row.adGroupName === adGroupName)
      .filter(({ row }) => !eventType || row.eventType === eventType)
      .sort((left, right) => (
        right.row.eventDate.localeCompare(left.row.eventDate)
        || right.row.id - left.row.id
      ))
      .slice(0, limit)
      .map(publicPreviewOperationEvent);
  };
  const createPreviewOperationEvent = (
    submitted: StoreContextEnvelope,
    inputValue: unknown,
  ): PreviewVersionedOperationEvent => {
    const { store, dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '运营事件创建参数');
    assertPreviewIdentityHints(store, input);
    if (input.evidenceArtifactId !== undefined) {
      throw new Error('开发预览不会签发真实证据 Artifact；请在 Windows 桌面端登记证据。');
    }
    const id = ++previewOperationEventIdSequence;
    const revisionVersion = 1;
    const now = new Date().toISOString();
    const state: PreviewOperationEventState = {
      revisionVersion,
      row: {
        id,
        storeId: store.storeId,
        eventDate: previewIsoDate(input.eventDate, '事件日期'),
        storeName: store.displayName,
        marketplaceCode: 'US',
        asin: optionalPreviewAsin(input.asin),
        asinValid: true,
        campaignName: previewOptionalText(input.campaignName, 'Campaign 名称', 500),
        adGroupName: previewOptionalText(input.adGroupName, '广告组名称', 500),
        eventType: previewRequiredText(input.eventType, '事件类型', 100),
        title: previewRequiredText(input.title, '事件标题', 500),
        impactExpectation: previewOptionalText(input.impactExpectation, '影响预期', 100),
        notes: previewOptionalText(input.notes, '事件说明', 10_000),
        evidenceRefValid: true,
        archiveRevision: 0,
        createdAt: now,
        updatedAt: now,
        revision: previewRevision('operation-event-v1', id, revisionVersion),
      },
    };
    dataset.operationEvents.push(state);
    return publicPreviewOperationEvent(state);
  };
  const updatePreviewOperationEvent = (
    submitted: StoreContextEnvelope,
    inputValue: unknown,
  ): PreviewVersionedOperationEvent => {
    const { store, dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '运营事件更新参数');
    const state = requirePreviewOperationEventState(dataset, input.id);
    assertPreviewRevision(input.expectedRevision, state.row.revision, '运营事件更新');
    const patch = previewInputRecord(input.patch, '运营事件补丁');
    assertPreviewIdentityHints(store, patch);
    const businessKeys = [
      'eventDate', 'asin', 'campaignName', 'adGroupName', 'eventType', 'title',
      'impactExpectation', 'notes', 'evidenceArtifactId',
    ];
    const hasBusinessPatch = businessKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key));
    const hasArchivedCommand = Object.prototype.hasOwnProperty.call(patch, 'archived');
    if (!hasBusinessPatch && !hasArchivedCommand) {
      throw new Error('运营事件补丁不能为空。');
    }
    if (hasArchivedCommand && typeof patch.archived !== 'boolean') {
      throw new Error('archived 必须是布尔值。');
    }
    if (patch.evidenceArtifactId !== undefined) {
      throw new Error('开发预览不会签发真实证据 Artifact；请在 Windows 桌面端登记证据。');
    }
    const archivedCommand = hasArchivedCommand ? patch.archived as boolean : undefined;
    if (state.row.archivedAt) {
      if (archivedCommand !== false) {
        throw new Error('归档运营事件为只读状态；请先恢复事件。');
      }
      if (hasBusinessPatch) {
        throw new Error('恢复与业务字段更新必须拆分为两次受版本锁保护的操作。');
      }
      state.revisionVersion += 1;
      state.row = {
        ...state.row,
        archivedAt: undefined,
        archiveRevision: state.row.archiveRevision + 1,
        updatedAt: new Date().toISOString(),
        revision: previewRevision('operation-event-v1', state.row.id, state.revisionVersion),
      };
      return publicPreviewOperationEvent(state);
    }
    if (archivedCommand === true) {
      throw new Error('请使用运营事件归档动作，不要通过更新补丁归档。');
    }
    if (archivedCommand === false && !hasBusinessPatch) {
      return publicPreviewOperationEvent(state);
    }
    const next = clonePreviewSnapshot(state.row);
    if (patch.eventDate !== undefined) next.eventDate = previewIsoDate(patch.eventDate, '事件日期');
    if (patch.asin !== undefined) next.asin = optionalPreviewAsin(patch.asin);
    if (patch.campaignName !== undefined) next.campaignName = previewOptionalText(patch.campaignName, 'Campaign 名称', 500);
    if (patch.adGroupName !== undefined) next.adGroupName = previewOptionalText(patch.adGroupName, '广告组名称', 500);
    if (patch.eventType !== undefined) next.eventType = previewRequiredText(patch.eventType, '事件类型', 100);
    if (patch.title !== undefined) next.title = previewRequiredText(patch.title, '事件标题', 500);
    if (patch.impactExpectation !== undefined) next.impactExpectation = previewOptionalText(patch.impactExpectation, '影响预期', 100);
    if (patch.notes !== undefined) next.notes = previewOptionalText(patch.notes, '事件说明', 10_000);
    state.revisionVersion += 1;
    next.storeId = store.storeId;
    next.storeName = store.displayName;
    next.marketplaceCode = 'US';
    next.updatedAt = new Date().toISOString();
    next.revision = previewRevision('operation-event-v1', next.id, state.revisionVersion);
    state.row = next;
    return publicPreviewOperationEvent(state);
  };
  const deletePreviewOperationEvent = (
    submitted: StoreContextEnvelope,
    inputValue: unknown,
  ): PreviewVersionedOperationEvent => {
    const { dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '运营事件归档参数');
    const state = requirePreviewOperationEventState(dataset, input.id);
    assertPreviewRevision(input.expectedRevision, state.row.revision, '运营事件归档');
    if (state.row.archivedAt) return publicPreviewOperationEvent(state);
    state.revisionVersion += 1;
    const archivedAt = new Date().toISOString();
    state.row = {
      ...state.row,
      archivedAt,
      archiveRevision: state.row.archiveRevision + 1,
      updatedAt: archivedAt,
      revision: previewRevision('operation-event-v1', state.row.id, state.revisionVersion),
    };
    return publicPreviewOperationEvent(state);
  };
  const previewLimit = (value: unknown, fallback: number, maximum: number): number => {
    if (value === undefined) return fallback;
    const limit = previewPositiveInteger(value, 'limit');
    if (limit > maximum) throw new Error(`limit 不能超过 ${maximum}。`);
    return limit;
  };
  const listPreviewAdObjects = (
    submitted: StoreContextEnvelope,
    inputValue: unknown = {},
  ): PreviewAdObjectFact[] => {
    const { store, dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '广告对象列表参数');
    assertPreviewIdentityHints(store, input);
    const kind = input.kind === undefined ? 'campaign' : input.kind;
    if (kind !== 'campaign' && kind !== 'ad_group' && kind !== 'target' && kind !== 'search_term') {
      throw new Error('kind 必须是 campaign、ad_group、target 或 search_term。');
    }
    const dateFrom = input.dateFrom === undefined ? undefined : previewIsoDate(input.dateFrom, 'dateFrom');
    const dateTo = input.dateTo === undefined ? undefined : previewIsoDate(input.dateTo, 'dateTo');
    if (dateFrom && dateTo && dateFrom > dateTo) throw new Error('dateFrom 不能晚于 dateTo。');
    const asin = optionalPreviewAsin(input.asin);
    const query = previewOptionalText(input.query, '查询词', 120)?.toLocaleLowerCase();
    const limit = previewLimit(input.limit, 500, 1_000);
    return dataset.adObjects
      .filter((row) => row.kind === kind)
      .filter((row) => !dateFrom || !row.lastDate || row.lastDate >= dateFrom)
      .filter((row) => !dateTo || !row.firstDate || row.firstDate <= dateTo)
      .filter((row) => !asin || row.asin === asin)
      .filter((row) => !query || [row.name, row.campaignName, row.adGroupName]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(query)))
      .slice(0, limit)
      .map((row) => clonePreviewSnapshot(row));
  };
  const listPreviewKeywordFacts = (
    submitted: StoreContextEnvelope,
    inputValue: unknown = {},
  ): PreviewKeywordFact[] => {
    const { store, dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '关键词事实列表参数');
    assertPreviewIdentityHints(store, input);
    const asin = optionalPreviewAsin(input.asin);
    const query = previewOptionalText(input.query, '查询词', 120)?.toLocaleLowerCase();
    const limit = previewLimit(input.limit, 500, 1_000);
    return dataset.keywordFacts
      .filter((row) => !asin || row.asin === asin)
      .filter((row) => !query || row.keyword.toLocaleLowerCase().includes(query))
      .sort((left, right) => (
        (right.opportunityScore ?? -1) - (left.opportunityScore ?? -1)
        || right.spend - left.spend
        || left.keyword.localeCompare(right.keyword, 'en-US')
      ))
      .slice(0, limit)
      .map((row) => clonePreviewSnapshot(row));
  };
  const publicPreviewListing = (state: PreviewListingState): PreviewListingContent =>
    clonePreviewSnapshot(state.row);
  const requirePreviewListingState = (dataset: PreviewStoreDataset, idInput: unknown) => {
    const id = previewPositiveInteger(idInput, 'Listing ID');
    const state = dataset.listings.find((candidate) => candidate.row.id === id);
    if (!state) throw new Error('PREVIEW_OBJECT_NOT_FOUND: 当前店铺不存在该 Listing。');
    return state;
  };
  const appendPreviewListingVersion = (
    dataset: PreviewStoreDataset,
    row: PreviewListingContent,
  ): PreviewListingVersion => {
    const version: PreviewListingVersion = {
      id: ++previewListingVersionIdSequence,
      listingContentId: row.id,
      storeId: row.storeId,
      asin: row.asin,
      title: row.title,
      bullets: [...row.bullets],
      description: row.description,
      aPlus: row.aPlus,
      imageCopy: row.imageCopy,
      backendTerms: row.backendTerms,
      source: row.source,
      versionLabel: row.versionLabel,
      changeSummary: row.changeSummary,
      createdAt: new Date().toISOString(),
    };
    dataset.listingVersions.push(version);
    return version;
  };
  const listPreviewListings = (
    submitted: StoreContextEnvelope,
    inputValue: unknown = {},
  ): PreviewListingContent[] => {
    const { store, dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, 'Listing 列表参数');
    assertPreviewIdentityHints(store, input);
    const asin = optionalPreviewAsin(input.asin);
    const query = previewOptionalText(input.query, '查询词', 120)?.toLocaleLowerCase();
    const limit = previewLimit(input.limit, 250, 1_000);
    return dataset.listings
      .filter(({ row }) => !asin || row.asin === asin)
      .filter(({ row }) => !query || `${row.asin} ${row.title}`.toLocaleLowerCase().includes(query))
      .sort((left, right) => (
        right.row.updatedAt.localeCompare(left.row.updatedAt)
        || right.row.id - left.row.id
      ))
      .slice(0, limit)
      .map(publicPreviewListing);
  };
  const getPreviewListing = (
    submitted: StoreContextEnvelope,
    inputValue: unknown,
  ): PreviewListingContent => {
    const { store, dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, 'Listing 查询参数');
    assertPreviewIdentityHints(store, input);
    const byId = input.id !== undefined;
    const byAsin = input.asin !== undefined;
    if (byId === byAsin) throw new Error('Listing 查询必须且只能提供 id 或 asin。');
    const state = byId
      ? requirePreviewListingState(dataset, input.id)
      : dataset.listings.find((candidate) => candidate.row.asin === previewAsin(input.asin));
    if (!state) throw new Error('PREVIEW_OBJECT_NOT_FOUND: 当前店铺不存在该 Listing。');
    return publicPreviewListing(state);
  };
  const createPreviewListing = (
    submitted: StoreContextEnvelope,
    inputValue: unknown,
  ): PreviewListingContent => {
    const { store, dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, 'Listing 创建参数');
    assertPreviewIdentityHints(store, input);
    const asin = previewAsin(input.asin);
    if (dataset.listings.some((candidate) => candidate.row.asin === asin)) {
      throw new Error(`PREVIEW_OBJECT_ALREADY_EXISTS: 当前店铺已存在 ${asin} 的 Listing。`);
    }
    const id = ++previewListingIdSequence;
    const revisionVersion = 1;
    const now = new Date().toISOString();
    const state: PreviewListingState = {
      revisionVersion,
      row: {
        id,
        storeId: store.storeId,
        storeName: store.displayName,
        marketplace: 'US',
        currency: 'USD',
        asin,
        title: previewOptionalText(input.title, 'Listing 标题', 500) ?? '',
        bullets: previewTextArray(input.bullets, 'Bullet Points', 10, 2_000),
        description: previewOptionalText(input.description, '产品描述', 20_000) ?? '',
        aPlus: previewOptionalText(input.aPlus ?? input.a_plus, 'A+ 内容', 20_000) ?? '',
        imageCopy: previewOptionalText(input.imageCopy ?? input.image_copy, '图片文案', 20_000) ?? '',
        backendTerms: previewOptionalText(input.backendTerms ?? input.backend_terms, '后台搜索词', 5_000) ?? '',
        source: previewOptionalText(input.source, '内容来源', 80) ?? 'manual',
        versionLabel: previewOptionalText(input.versionLabel ?? input.version_label, '版本标签', 160) ?? '',
        changeSummary: previewOptionalText(input.changeSummary ?? input.change_summary, '变更说明', 1_000) ?? '',
        createdAt: now,
        updatedAt: now,
        revision: previewRevision('listing-content-v1', id, revisionVersion),
      },
    };
    dataset.listings.push(state);
    appendPreviewListingVersion(dataset, state.row);
    return publicPreviewListing(state);
  };
  const updatePreviewListing = (
    submitted: StoreContextEnvelope,
    inputValue: unknown,
  ): PreviewListingContent => {
    const { store, dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, 'Listing 更新参数');
    const state = requirePreviewListingState(dataset, input.id);
    assertPreviewRevision(input.expectedRevision, state.row.revision, 'Listing 更新');
    const patch = previewInputRecord(input.patch, 'Listing 补丁');
    assertPreviewIdentityHints(store, patch);
    if (patch.asin !== undefined && previewAsin(patch.asin) !== state.row.asin) {
      throw new Error('开发预览不支持修改 Listing ASIN；请新建内容。');
    }
    const editableKeys = [
      'title', 'bullets', 'description', 'aPlus', 'a_plus', 'imageCopy', 'image_copy',
      'backendTerms', 'backend_terms', 'source', 'versionLabel', 'version_label',
      'changeSummary', 'change_summary',
    ];
    if (!editableKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key))) {
      throw new Error('Listing 更新必须包含至少一个可编辑字段。');
    }
    const next = clonePreviewSnapshot(state.row);
    if (patch.title !== undefined) next.title = previewOptionalText(patch.title, 'Listing 标题', 500) ?? '';
    if (patch.bullets !== undefined) next.bullets = previewTextArray(patch.bullets, 'Bullet Points', 10, 2_000);
    if (patch.description !== undefined) next.description = previewOptionalText(patch.description, '产品描述', 20_000) ?? '';
    if (patch.aPlus !== undefined || patch.a_plus !== undefined) {
      next.aPlus = previewOptionalText(patch.aPlus ?? patch.a_plus, 'A+ 内容', 20_000) ?? '';
    }
    if (patch.imageCopy !== undefined || patch.image_copy !== undefined) {
      next.imageCopy = previewOptionalText(patch.imageCopy ?? patch.image_copy, '图片文案', 20_000) ?? '';
    }
    if (patch.backendTerms !== undefined || patch.backend_terms !== undefined) {
      next.backendTerms = previewOptionalText(patch.backendTerms ?? patch.backend_terms, '后台搜索词', 5_000) ?? '';
    }
    if (patch.source !== undefined) next.source = previewOptionalText(patch.source, '内容来源', 80) ?? 'manual';
    if (patch.versionLabel !== undefined || patch.version_label !== undefined) {
      next.versionLabel = previewOptionalText(patch.versionLabel ?? patch.version_label, '版本标签', 160) ?? '';
    }
    if (patch.changeSummary !== undefined || patch.change_summary !== undefined) {
      next.changeSummary = previewOptionalText(patch.changeSummary ?? patch.change_summary, '变更说明', 1_000) ?? '';
    }
    state.revisionVersion += 1;
    next.storeId = store.storeId;
    next.storeName = store.displayName;
    next.marketplace = 'US';
    next.currency = 'USD';
    next.updatedAt = new Date().toISOString();
    next.revision = previewRevision('listing-content-v1', next.id, state.revisionVersion);
    state.row = next;
    appendPreviewListingVersion(dataset, state.row);
    return publicPreviewListing(state);
  };
  const deletePreviewListing = (
    submitted: StoreContextEnvelope,
    inputValue: unknown,
  ): { id: number; deleted: true } => {
    const { dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, 'Listing 删除参数');
    const state = requirePreviewListingState(dataset, input.id);
    assertPreviewRevision(input.expectedRevision, state.row.revision, 'Listing 删除');
    dataset.listings = dataset.listings.filter((candidate) => candidate !== state);
    return { id: state.row.id, deleted: true };
  };
  const listPreviewListingVersions = (
    submitted: StoreContextEnvelope,
    inputValue: unknown = {},
  ): PreviewListingVersion[] => {
    const { store, dataset } = requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, 'Listing 版本列表参数');
    assertPreviewIdentityHints(store, input);
    const listingContentId = input.listingContentId === undefined
      ? undefined
      : previewPositiveInteger(input.listingContentId, 'Listing ID');
    // listingContentId is the durable historical identity. Do not run a
    // legacy display ASIN through the current write validator when the id is
    // already present.
    const asin = listingContentId === undefined ? optionalPreviewAsin(input.asin) : undefined;
    const limit = previewLimit(input.limit, 100, 500);
    const offset = input.offset === undefined ? 0 : Number(input.offset);
    if (!Number.isInteger(offset) || offset < 0) throw new Error('offset 必须是非负整数。');
    return dataset.listingVersions
      .filter((row) => !listingContentId || row.listingContentId === listingContentId)
      .filter((row) => !asin || row.asin === asin)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id - left.id)
      .slice(offset, offset + limit)
      .map((row) => clonePreviewSnapshot(row));
  };
  // One explicit in-memory domain suite backs both the workspace bridge and
  // the shell autonomy projection. This prevents preview from presenting two
  // conflicting sources of truth while remaining clearly non-production.
  const previewMissionDomainApi = createPreviewMissionDomainApi();
  const previewDecisionDomainApi = createPreviewDecisionDomainApi();
  const previewAnalysisAuthorityApi = createPreviewAnalysisAuthorityApi();
  const previewPolicyDomainApi = createPreviewPolicyDomainApi();
  const previewExperimentMemoryDomain = createPreviewExperimentMemoryDomainSuite();
  const previewMissionQuery = async (input: MissionControlQueryRequest): Promise<MissionControlQueryResponse> => {
    const request = normalizeMissionControlQueryRequest(input);
    const authoritative = requirePreviewMissionAuthority(request.context);
    const runtime = await previewPolicyDomainApi.getPolicyRuntime(authoritative);
    return {
      query: 'workspace-bootstrap',
      requestId: request.requestId,
      contextEpoch: request.contextEpoch,
      authoritativeContext: clonePreviewSnapshot(authoritative),
      completedAt: new Date().toISOString(),
      data: {
        capabilities: clonePreviewSnapshot([...PREVIEW_MISSION_CONTROL_CAPABILITIES]),
        autonomy: {
          currentMode: runtime.mode,
          manualApprovalAvailable: true,
          policyAutoAvailable: runtime.canAutoExecute,
          ...(!runtime.canAutoExecute ? {
            policyAutoBlockerCode: 'PREVIEW_POLICY_RUNTIME_BLOCKED',
            policyAutoBlockerDetail: '仅开发预览的启用版本、kill switch 或只读熔断状态不满足安全切换条件。',
          } : {}),
        },
        today: {
          storeId: authoritative.storeId,
          authorityKey: missionControlContextKey(authoritative),
          businessDate: authoritative.businessDate,
          marketplace: 'US',
          currency: 'USD',
          generatedAt: new Date().toISOString(),
          facts: {
            productCount: 0,
            configuredProductCount: 0,
            collectionJobCount: 0,
            importedMetricRows: 0,
            operationEventsToday: 0,
            browserSessionReady: false,
          },
          readiness: [
            { id: 'products', label: '产品与经营目标', state: 'blocked', detail: '仅开发预览，不读取生产数据库。', targetView: 'objects/products' },
            { id: 'collection', label: '领星八报表', state: 'blocked', detail: '仅开发预览，不发起真实采集。', targetView: 'collection/reports' },
            { id: 'import', label: '广告事实入库', state: 'blocked', detail: '仅开发预览，不写入生产数据库。', targetView: 'collection/import-check' },
            { id: 'browser', label: '可见浏览器会话', state: 'blocked', detail: '仅开发预览，不建立真实会话。', targetView: 'collection/reports' },
          ],
          blockers: ['仅开发预览，不代表真实准备度。'],
          attentionItems: [],
          analysis: {
            activeMissionId: `MISSION-${String(authoritative.storeId)}-ACTIVE`,
            evidencePackageCount: 1,
            proposalCount: 2,
            humanEligibleCount: 2,
            policyEligibleCount: 2,
            latestFreshUntil: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          },
          nextAction: {
            id: 'preview-only',
            label: '仅查看开发预览',
            detail: '生产下一动作必须由 Main 的店铺权威投影给出。',
            targetView: 'collection/reports',
            requiredCapabilityId: 'collection.reports.view',
            available: false,
            blockerCode: 'DEV_PREVIEW_ONLY',
          },
        },
      },
    };
  };
  const previewMissionCommand = async (input: MissionControlCommandRequest): Promise<MissionControlCommandResponse> => {
    const request = normalizeMissionControlCommandRequest(input);
    const authoritative = requirePreviewMissionAuthority(request.context);
    const before = await previewPolicyDomainApi.getPolicyRuntime(authoritative);
    const runtime = await previewPolicyDomainApi.setAutonomyMode(authoritative, {
      expectedRevision: before.revision,
      mode: request.payload.mode,
      reason: 'dev_preview_shell_mode_change',
    });
    return {
      command: 'set-autonomy-mode',
      requestId: request.requestId,
      contextEpoch: request.contextEpoch,
      authoritativeContext: clonePreviewSnapshot(authoritative),
      completedAt: new Date().toISOString(),
      status: 'APPLIED',
      currentMode: runtime.mode,
      detail: runtime.mode === 'policy_auto'
        ? '仅开发预览已切换策略内自动；不授权或执行真实 Amazon Ads。'
        : '仅开发预览已切换人工审批；不改变任何生产运行时。',
    };
  };

  return {
    missionControl: {
      query: previewMissionQuery,
      command: previewMissionCommand,
    },
    missionDomain: createMissionDomainWindowSurface(
      previewMissionDomainApi,
      previewDecisionDomainApi,
      previewPolicyDomainApi,
      previewExperimentMemoryDomain.experiments,
      previewExperimentMemoryDomain.memory,
    ),
    analysisAuthority: previewAnalysisAuthorityApi,
    storeScopedObjectsPreviewOnly: true,
    storeScopedAdListingPreviewOnly: true,
    listStores: async () => clonePreviewSnapshot(previewStores),
    getStore: async (storeId: StoreId) => clonePreviewSnapshot(requirePreviewStore(storeId)),
    createStore: async (input: { displayName?: unknown }) => {
      const displayName = String(input?.displayName ?? '').trim();
      if (!displayName || displayName.length > 120) throw new Error('预览店铺名称必须为 1-120 个字符。');
      const suffix = previewStores.length + 1;
      const store = previewStore(
        `preview-store-${suffix}`,
        `preview-profile-${suffix}`,
        displayName,
        new Date().toISOString(),
      );
      previewStores = [...previewStores, store];
      previewGenerations.set(store.storeId, 0);
      storeRecordListeners.forEach((listener) => listener(clonePreviewSnapshot(store)));
      return clonePreviewSnapshot(store);
    },
    updateStore: async (input: { storeId: StoreId; patch?: Partial<StoreRecord> }) => {
      const current = requirePreviewStore(input?.storeId);
      const patch = input?.patch ?? {};
      const next: StoreRecord = {
        ...current,
        ...(typeof patch.displayName === 'string' ? { displayName: patch.displayName.trim() } : {}),
        ...(patch.status === 'active' || patch.status === 'inactive' ? { status: patch.status } : {}),
        ...(typeof patch.businessTimezone === 'string'
          ? { businessTimezone: patch.businessTimezone.trim() }
          : {}),
        marketplace: 'US',
        currency: 'USD',
        updatedAt: new Date().toISOString(),
      };
      previewStores = previewStores.map((row) => row.storeId === next.storeId ? next : row);
      if (next.status !== 'active' && activePreviewStoreId === next.storeId) {
        activePreviewStoreId = null;
      }
      storeRecordListeners.forEach((listener) => listener(clonePreviewSnapshot(next)));
      return clonePreviewSnapshot(next);
    },
    archiveStore: async (input: { storeId: StoreId }) => {
      const current = requirePreviewStore(input?.storeId);
      const updatedAt = new Date().toISOString();
      const next: StoreRecord = { ...current, status: 'archived', archivedAt: updatedAt, updatedAt };
      previewStores = previewStores.map((row) => row.storeId === next.storeId ? next : row);
      if (activePreviewStoreId === next.storeId) activePreviewStoreId = null;
      storeRecordListeners.forEach((listener) => listener(clonePreviewSnapshot(next)));
      return clonePreviewSnapshot(next);
    },
    restoreStore: async (input: { storeId: StoreId }) => {
      const current = requirePreviewStore(input?.storeId);
      const next: StoreRecord = {
        ...current,
        status: 'active',
        archivedAt: undefined,
        updatedAt: new Date().toISOString(),
      };
      previewStores = previewStores.map((row) => row.storeId === next.storeId ? next : row);
      storeRecordListeners.forEach((listener) => listener(clonePreviewSnapshot(next)));
      return clonePreviewSnapshot(next);
    },
    switchStore: async (storeIdInput: StoreId) => {
      const store = requirePreviewStore(storeIdInput);
      if (store.status !== 'active') throw new Error('预览中只能切换到 active 店铺。');
      if (activePreviewStoreId && activePreviewStoreId !== store.storeId) {
        previewGenerations.set(
          activePreviewStoreId,
          (previewGenerations.get(activePreviewStoreId) ?? 0) + 1,
        );
      }
      activatePreviewDataset(store);
      activePreviewStoreId = store.storeId;
      const generation = (previewGenerations.get(store.storeId) ?? 0) + 1;
      previewGenerations.set(store.storeId, generation);
      const view = previewView(store, previewContext(store, generation));
      storeContextListeners.forEach((listener) => listener(clonePreviewSnapshot(view)));
      return clonePreviewSnapshot(view);
    },
    getActiveStoreContext: async () => clonePreviewSnapshot(currentPreviewContext()),
    onStoreContextChanged: (callback: (view: StoreWorkspaceView) => void) => {
      storeContextListeners.add(callback);
      return () => storeContextListeners.delete(callback);
    },
    onStoresChanged: (callback: (store: StoreRecord) => void) => {
      storeRecordListeners.add(callback);
      return () => storeRecordListeners.delete(callback);
    },
    getState: async () => ({
      isLoggedIn: true,
      currentStore: activePreviewStoreId
        ? previewStores.find((store) => store.storeId === activePreviewStoreId)?.displayName ?? username ?? 'SHC001'
        : username || 'SHC001',
      loginSession: { erpSessionReused: true, adsEntryMode: 'browser-preview', adsTitle: '浏览器预览模式' },
      storeContext: clonePreviewSnapshot(currentPreviewContext()),
    }),
    browserLogout: async () => true,
    getOperationScope: async (storeContext: StoreContextEnvelope) => {
      const { dataset } = requirePreviewDatasetAuthority(storeContext);
      return scenario.scopeReady ? clonePreviewSnapshot(dataset.scope) : null;
    },
    saveOperationScope: async (storeContext: StoreContextEnvelope, inputValue: unknown) => {
      const { store, dataset } = requirePreviewDatasetAuthority(storeContext);
      if (!scenario.scopeReady) return null;
      const input = previewInputRecord(inputValue, '运营范围');
      assertPreviewIdentityHints(store, input);
      const dateFrom = previewIsoDate(input.dateFrom, '开始日期');
      const dateTo = previewIsoDate(input.dateTo, '结束日期');
      if (dateFrom > dateTo) throw new Error('开始日期不能晚于结束日期。');
      dataset.scope = {
        dateFrom,
        dateTo,
        storeName: store.displayName,
        marketplaceCode: 'US',
        currency: 'USD',
        asin: input.asin === undefined ? undefined : previewAsin(input.asin),
        batchId: previewOptionalText(input.batchId, '批次 ID', 200),
      };
      activePreviewScope = dataset.scope;
      return clonePreviewSnapshot(dataset.scope);
    },
    getStoreRuntimeConfig: async (storeContext: StoreContextEnvelope) => {
      const authoritative = requirePreviewMissionAuthority(storeContext);
      return clonePreviewSnapshot(
        previewRuntimeConfigs.get(authoritative.storeId) ?? { current: null, versions: [] },
      );
    },
    createStoreRuntimeConfig: async (storeContext: StoreContextEnvelope, inputValue: unknown) => {
      const authoritative = requirePreviewMissionAuthority(storeContext);
      const store = requirePreviewStore(authoritative.storeId);
      if (previewRuntimeConfigs.has(store.storeId)) throw new Error('预览店铺已存在运行配置。');
      const input = previewInputRecord(inputValue, '店铺运行配置创建参数');
      const values = clonePreviewSnapshot(input.values as StoreRuntimeConfigValues);
      const occurredAt = new Date().toISOString();
      const current = buildPreviewRuntimeConfig(store, values, 1, 'active', occurredAt);
      const projection: StoreRuntimeConfigProjection = {
        current,
        versions: [{ revision: 1, action: 'create', occurredAt, snapshot: clonePreviewSnapshot(current) }],
      };
      previewRuntimeConfigs.set(store.storeId, projection);
      return clonePreviewSnapshot(projection);
    },
    updateStoreRuntimeConfig: async (storeContext: StoreContextEnvelope, inputValue: unknown) => {
      const authoritative = requirePreviewMissionAuthority(storeContext);
      const store = requirePreviewStore(authoritative.storeId);
      const projection = previewRuntimeConfigs.get(store.storeId);
      const input = previewInputRecord(inputValue, '店铺运行配置更新参数');
      if (!projection?.current) throw new Error('预览店铺还没有运行配置。');
      if (Number(input.expectedRevision) !== projection.current.revision) throw new Error('预览配置版本冲突，请刷新。');
      if (projection.current.status === 'archived') throw new Error('预览配置已归档，请先恢复。');
      const occurredAt = new Date().toISOString();
      const current = buildPreviewRuntimeConfig(
        store,
        { ...projection.current.values, ...(input.patch as Partial<StoreRuntimeConfigValues>) },
        projection.current.revision + 1,
        'active',
        occurredAt,
      );
      const next: StoreRuntimeConfigProjection = {
        current,
        versions: [...projection.versions, {
          revision: current.revision,
          action: 'update',
          occurredAt,
          snapshot: clonePreviewSnapshot(current),
        }],
      };
      previewRuntimeConfigs.set(store.storeId, next);
      return clonePreviewSnapshot(next);
    },
    archiveStoreRuntimeConfig: async (storeContext: StoreContextEnvelope, inputValue: unknown) => {
      const authoritative = requirePreviewMissionAuthority(storeContext);
      const store = requirePreviewStore(authoritative.storeId);
      const projection = previewRuntimeConfigs.get(store.storeId);
      const input = previewInputRecord(inputValue, '店铺运行配置归档参数');
      if (!projection?.current) throw new Error('预览店铺还没有运行配置。');
      if (Number(input.expectedRevision) !== projection.current.revision) throw new Error('预览配置版本冲突，请刷新。');
      const occurredAt = new Date().toISOString();
      const current = buildPreviewRuntimeConfig(
        store,
        projection.current.values,
        projection.current.revision + 1,
        'archived',
        occurredAt,
      );
      const next: StoreRuntimeConfigProjection = {
        current,
        versions: [...projection.versions, {
          revision: current.revision,
          action: 'archive',
          occurredAt,
          reason: typeof input.reason === 'string' ? input.reason : undefined,
          snapshot: clonePreviewSnapshot(current),
        }],
      };
      previewRuntimeConfigs.set(store.storeId, next);
      return clonePreviewSnapshot(next);
    },
    restoreStoreRuntimeConfig: async (storeContext: StoreContextEnvelope, inputValue: unknown) => {
      const authoritative = requirePreviewMissionAuthority(storeContext);
      const store = requirePreviewStore(authoritative.storeId);
      const projection = previewRuntimeConfigs.get(store.storeId);
      const input = previewInputRecord(inputValue, '店铺运行配置恢复参数');
      if (!projection?.current) throw new Error('预览店铺还没有运行配置。');
      if (Number(input.expectedRevision) !== projection.current.revision) throw new Error('预览配置版本冲突，请刷新。');
      const occurredAt = new Date().toISOString();
      const current = buildPreviewRuntimeConfig(
        store,
        projection.current.values,
        projection.current.revision + 1,
        'active',
        occurredAt,
      );
      const next: StoreRuntimeConfigProjection = {
        current,
        versions: [...projection.versions, {
          revision: current.revision,
          action: 'restore',
          occurredAt,
          snapshot: clonePreviewSnapshot(current),
        }],
      };
      previewRuntimeConfigs.set(store.storeId, next);
      return clonePreviewSnapshot(next);
    },
    getBusinessUiDataPipeline: async () => {
      if (!activePreviewStoreId) return previewPipeline(scenario, fixtures);
      const store = requirePreviewStore(activePreviewStoreId);
      return applyPreviewStoreIdentity(previewPipeline(scenario, fixtures), previewStoreIdentity(store));
    },
    getBusinessBatchOptions: async () => {
      if (!activePreviewStoreId) return clonePreviewSnapshot(previewBatchOptions(scenario));
      const store = requirePreviewStore(activePreviewStoreId);
      return clonePreviewSnapshot(applyPreviewStoreIdentity(previewBatchOptions(scenario), previewStoreIdentity(store)));
    },
    lingxingCollectionJobsPreviewOnly: true,
    listLingxingCollectionJobs: async (input: { storeContext: StoreContextEnvelope }) => {
      requirePreviewMissionAuthority(input?.storeContext);
      // Deliberately empty: development preview must not invent durable jobs or production success.
      return [];
    },
    resumeLingxingCollection: async (input: { storeContext: StoreContextEnvelope }) => {
      requirePreviewMissionAuthority(input?.storeContext);
      throw new Error('开发预览没有可恢复的真实领星任务；请在 Windows 桌面端使用持久化任务。');
    },
    cancelLingxingCollection: async (input: { storeContext: StoreContextEnvelope }) => {
      requirePreviewMissionAuthority(input?.storeContext);
      throw new Error('开发预览没有可取消的真实领星任务；请在 Windows 桌面端操作真实任务。');
    },
    onLingxingCollectionProgress: () => () => undefined,
    listStoreProducts: async (storeContext: StoreContextEnvelope, input: unknown = {}) =>
      listPreviewProducts(storeContext, input),
    getStoreProduct: async (storeContext: StoreContextEnvelope, input: unknown) =>
      getPreviewProduct(storeContext, input),
    createStoreProduct: async (storeContext: StoreContextEnvelope, input: unknown) =>
      createPreviewProduct(storeContext, input),
    updateStoreProduct: async (storeContext: StoreContextEnvelope, input: unknown) =>
      updatePreviewProduct(storeContext, input),
    archiveStoreProduct: async (storeContext: StoreContextEnvelope, input: unknown) =>
      archivePreviewProduct(storeContext, input),
    listStoreOperationEvents: async (storeContext: StoreContextEnvelope, input: unknown = {}) =>
      listPreviewOperationEvents(storeContext, input),
    createStoreOperationEvent: async (storeContext: StoreContextEnvelope, input: unknown) =>
      createPreviewOperationEvent(storeContext, input),
    updateStoreOperationEvent: async (storeContext: StoreContextEnvelope, input: unknown) =>
      updatePreviewOperationEvent(storeContext, input),
    deleteStoreOperationEvent: async (storeContext: StoreContextEnvelope, input: unknown) =>
      deletePreviewOperationEvent(storeContext, input),
    listStoreAdObjects: async (storeContext: StoreContextEnvelope, input: unknown = {}) =>
      listPreviewAdObjects(storeContext, input),
    listStoreKeywordFacts: async (storeContext: StoreContextEnvelope, input: unknown = {}) =>
      listPreviewKeywordFacts(storeContext, input),
    listStoreListingContent: async (storeContext: StoreContextEnvelope, input: unknown = {}) =>
      listPreviewListings(storeContext, input),
    getStoreListingContent: async (storeContext: StoreContextEnvelope, input: unknown) =>
      getPreviewListing(storeContext, input),
    createStoreListingContent: async (storeContext: StoreContextEnvelope, input: unknown) =>
      createPreviewListing(storeContext, input),
    updateStoreListingContent: async (storeContext: StoreContextEnvelope, input: unknown) =>
      updatePreviewListing(storeContext, input),
    deleteStoreListingContent: async (storeContext: StoreContextEnvelope, input: unknown) =>
      deletePreviewListing(storeContext, input),
    listStoreListingContentVersions: async (storeContext: StoreContextEnvelope, input: unknown = {}) =>
      listPreviewListingVersions(storeContext, input),
    getRecommendations: async (filter?: PreviewRecommendationFilter) => {
      const request = filter || {};
      const hasFullScope = Boolean(
        normalizedPreviewText(request.dateFrom)
        && normalizedPreviewText(request.dateTo)
        && normalizedPreviewText(request.storeName)
        && normalizedPreviewText(request.marketplaceCode),
      );
      const scopeMatches = hasFullScope
        && normalizedPreviewText(request.dateFrom) === activePreviewScope.dateFrom
        && normalizedPreviewText(request.dateTo) === activePreviewScope.dateTo
        && normalizedPreviewText(request.storeName) === activePreviewScope.storeName
        && normalizedPreviewText(request.marketplaceCode) === activePreviewScope.marketplaceCode
        && (!normalizedPreviewText(request.asin)
          || normalizedPreviewText(request.asin).toUpperCase() === activePreviewScope.asin)
        && (!normalizedPreviewText(request.batchId)
          || normalizedPreviewText(request.batchId) === activePreviewScope.batchId);
      if (!scopeMatches) return [];

      const status = normalizedPreviewText(request.status);
      const limit = Number.isFinite(Number(request.limit))
        ? Math.max(1, Math.min(500, Number(request.limit)))
        : 100;
      const scopedRows = recommendations.filter((recommendation) => (
        recommendation.storeName === activePreviewScope.storeName
        && recommendation.marketplaceCode === activePreviewScope.marketplaceCode
        && recommendation.asin === activePreviewScope.asin
        && recommendation.evidence?.batchId === activePreviewScope.batchId
        && (!status || recommendation.status === status)
      ));
      return clonePreviewSnapshot(scopedRows.slice(0, limit));
    },
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
      const scopeMatches = normalized(scope?.dateFrom) === activePreviewScope.dateFrom
        && normalized(scope?.dateTo) === activePreviewScope.dateTo
        && normalized(scope?.storeName) === activePreviewScope.storeName
        && normalized(scope?.marketplaceCode) === activePreviewScope.marketplaceCode
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
        previewReportFileName(String(report.type)).toLowerCase(),
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
      const scopeMatches = normalized(scope?.dateFrom) === activePreviewScope.dateFrom
        && normalized(scope?.dateTo) === activePreviewScope.dateTo
        && normalized(scope?.storeName) === activePreviewScope.storeName
        && normalized(scope?.marketplaceCode) === activePreviewScope.marketplaceCode
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
        previewReportFileName(String(report.type)).toLowerCase(),
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
      assertRecommendationDecisionRevision(recommendation, input.expectedRevision);
      applyPreviewRecommendationDecision(recommendation, 'approved', input.decision || {});
      return { ok: true };
    },
    rejectRecommendation: async (input: {
      id: number;
      expectedRevision: number;
      decision?: { rejectedBy?: string; note?: string };
    }) => {
      const recommendation = recommendations.find((row) => row.id === input.id);
      if (!recommendation) throw new Error('预览建议不存在，请刷新后重试。');
      assertRecommendationDecisionRevision(recommendation, input.expectedRevision);
      applyPreviewRecommendationDecision(recommendation, 'rejected', input.decision || {});
      return { ok: true };
    },
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
    openReportArtifact: async (artifactId: string, storeContext: StoreContextEnvelope) => {
      requirePreviewMissionAuthority(storeContext);
      const knownArtifacts = new Set<string>([
        PREVIEW_REPORT_FOLDER_ARTIFACT_ID,
        PREVIEW_REPORT_MANIFEST_ARTIFACT_ID,
        ...previewReportOptions.map((_, index) => previewReportArtifactId(index)),
      ]);
      if (!knownArtifacts.has(String(artifactId || '').trim())) {
        throw new Error('开发预览工件不存在或已失效。');
      }
      return { opened: true, artifactId, previewOnly: true };
    },
    openReportPath: async () => true,
    exportDataReconciliation: async () => ({ ok: true, path: 'D:/preview/reconciliation.xlsx' }),
  };
}
