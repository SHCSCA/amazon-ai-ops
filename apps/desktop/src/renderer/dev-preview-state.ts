// 历史开发预览职责模块；启用边界由原引导入口统一控制。
import type { ActionRecommendation, WritableAdTargetBinding, WritableAdTargetEvidence, MissionControlCommandRequest, MissionControlCommandResponse, MissionControlQueryRequest, MissionControlQueryResponse, StoreContextEnvelope, StoreDailyStatusBlocker, StoreDailyStatusListProjection, StoreDailyStatusProjection, StoreCollectionScheduleProjection, StoreConnection, StoreId, StoreRecord, StoreRuntimeConfigProjection, StoreRuntimeConfigRecord, StoreRuntimeConfigValues, StoreWorkspaceView } from '@amazon-ai-ops/shared-types';
import { missionControlContextKey, normalizeMissionControlCommandRequest, normalizeMissionControlQueryRequest, normalizeStoreId } from '@amazon-ai-ops/shared-types';
import type { OperationScope } from './types';
import { createPreviewDecisionDomainApi, createPreviewExperimentMemoryDomainSuite, createPreviewMissionDomainApi, createPreviewPolicyDomainApi } from './mission-control/workspaces/mission-domain-window-api';
import { createPreviewAnalysisAuthorityApi } from './mission-control/workspaces/analysis-authority-window-api';
import { PREVIEW_SCENARIOS, DEFAULT_PREVIEW_SCENARIO } from './dev-preview-scenarios';
import { clonePreviewSnapshot, previewAsin, previewProductCost, previewRevision, previewIsoDate, previewPositiveInteger } from './dev-preview-values';
import { previewScope, previewFixtures, previewDiagnostics, previewReportFileName } from './dev-preview-fixtures';
import { type PreviewRecommendation, type PreviewProductState, type PreviewOperationEventState, type PreviewStoreIdentity, type PreviewAdObjectFact, type PreviewAdObjectKind, type PreviewKeywordFact, type PreviewListingState, type PreviewListingVersion, type PreviewListingContent, type PreviewStoreDataset, type PreviewScenarioId } from './dev-preview-contracts';
import { applyPreviewRecommendationDecision, previewReadinessGates } from './dev-preview-decisions';
import { PREVIEW_STORES, previewStoreIdentity, applyPreviewStoreIdentity, previewContext } from './dev-preview-stores';
import { PREVIEW_MISSION_CONTROL_CAPABILITIES } from './dev-preview-capabilities';

export function createPreviewRuntimeState(username: string, scenarioId: PreviewScenarioId = DEFAULT_PREVIEW_SCENARIO) {
const scenario = PREVIEW_SCENARIOS[scenarioId];
let activePreviewScope: OperationScope = clonePreviewSnapshot(previewScope);
let fixtures = previewFixtures(scenario);
const recommendationSource = ['mixed', 'approved'].includes(scenario.recommendationState)
    ? previewDiagnostics
    : [];
let recommendations: PreviewRecommendation[] = recommendationSource.map((diagnostic, index) => ({
    id: 10001 + index,
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
        impressions: index === 0 ? 6840 : 3920,
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
                    impressions: index === 0 ? 6840 : 3920,
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
let previewConnectionSequence = 0;
const previewConnections = new Map<StoreId, StoreConnection[]>(previewStores.map((store) => [store.storeId, []]));
const previewAdsConfirmationTokens = new Map<string, {
    storeId: StoreId;
    externalAccountId: string;
}>();
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
const buildPreviewRuntimeConfig = (store: StoreRecord, values: StoreRuntimeConfigValues, revision: number, status: 'active' | 'archived', occurredAt = new Date().toISOString()): StoreRuntimeConfigRecord => ({
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
previewStores.forEach((store, index) => {
    const occurredAt = `2026-07-22T0${8 + index}:00:00.000Z`;
    const values = {
        ...defaultPreviewRuntimeValues(),
        collectionScheduleLocalTime: index === 0 ? '08:00' : '09:30',
        collectionLookbackDays: index === 0 ? 14 : 21,
        evidenceRetentionDays: index === 0 ? 365 : 180,
    };
    const current = buildPreviewRuntimeConfig(store, values, index + 1, 'active', occurredAt);
    previewRuntimeConfigs.set(store.storeId, {
        current,
        versions: [{
                revision: current.revision,
                action: 'create',
                occurredAt,
                snapshot: clonePreviewSnapshot(current),
            }],
    });
});
const previewScheduleStates = new Map<StoreId, 'waiting' | 'succeeded' | 'failed'>([
    [previewStores[0]!.storeId, 'waiting'],
    [previewStores[1]!.storeId, 'failed'],
]);
let previewProductIdSequence = 0;
let previewOperationEventIdSequence = 0;
let previewListingIdSequence = 0;
let previewListingVersionIdSequence = 0;
const basePreviewScope = clonePreviewSnapshot(activePreviewScope);
const baseFixtures = clonePreviewSnapshot(fixtures);
const baseRecommendations = clonePreviewSnapshot(recommendations);
const buildPreviewProducts = (store: StoreRecord, sourceFixtures: ReturnType<typeof previewFixtures>): PreviewProductState[] => sourceFixtures.products.slice(0, 3).map((source) => {
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
const buildPreviewOperationEvents = (store: StoreRecord, sourceFixtures: ReturnType<typeof previewFixtures>): PreviewOperationEventState[] => sourceFixtures.events.map((source) => {
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
const buildPreviewAdObjects = (store: StoreRecord, identity: PreviewStoreIdentity): PreviewAdObjectFact[] => {
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
        impressions: 6840,
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
    const objectKey = (kind: PreviewAdObjectKind, campaign: string | undefined, adGroup: string | undefined, name: string) => [kind, campaign ?? '', adGroup ?? '', name].map(encodeURIComponent).join('/');
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
const buildPreviewKeywordFacts = (store: StoreRecord, identity: PreviewStoreIdentity): PreviewKeywordFact[] => [
    {
        storeId: store.storeId,
        marketplace: 'US',
        currency: 'USD',
        keyword: `${identity.pathSegment} smart lock`,
        asin: identity.primaryAsin,
        impressions: 3920,
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
        impressions: 1460,
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
const buildPreviewListings = (store: StoreRecord, identity: PreviewStoreIdentity): {
    listings: PreviewListingState[];
    listingVersions: PreviewListingVersion[];
} => {
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
const previewDatasets = new Map<StoreId, PreviewStoreDataset>(previewStores.map((store) => {
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
}));
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
const previewGenerations = new Map<StoreId, number>(previewStores.map((store) => [store.storeId, 0]));
const storeContextListeners = new Set<(view: StoreWorkspaceView | null) => void>();
const storeRecordListeners = new Set<(store: StoreRecord) => void>();
const currentPreviewContext = (): StoreContextEnvelope | null => {
    if (!activePreviewStoreId)
        return null;
    const store = previewStores.find((row) => row.storeId === activePreviewStoreId);
    if (!store || store.status !== 'active')
        return null;
    return previewContext(store, previewGenerations.get(store.storeId) ?? 0);
};
const requirePreviewStore = (storeIdInput: unknown): StoreRecord => {
    const storeId = normalizeStoreId(storeIdInput);
    const store = previewStores.find((row) => row.storeId === storeId);
    if (!store)
        throw new Error(`PREVIEW_STORE_NOT_FOUND:${storeId}`);
    return store;
};
const previewView = (store: StoreRecord, context: StoreContextEnvelope): StoreWorkspaceView => ({
    store: clonePreviewSnapshot(store),
    context: clonePreviewSnapshot(context),
    connections: clonePreviewSnapshot(previewConnections.get(store.storeId) ?? []),
    sessions: [],
});
const previewDailyStatuses = (): StoreDailyStatusListProjection => {
    const generatedAt = new Date().toISOString();
    const stores: StoreDailyStatusProjection[] = previewStores.map((store) => {
        const connections = previewConnections.get(store.storeId) ?? [];
        const lingxing = connections.find((connection) => connection.provider === 'lingxing');
        const amazonAds = connections.find((connection) => connection.provider === 'amazon_ads');
        const blockers: StoreDailyStatusBlocker[] = [{
                code: 'COLLECTION_AUTHORITY_UNKNOWN',
                severity: 'unknown',
                detail: '仅开发预览：今日采集、导入与指标状态来自内存 fixture，不代表真实成功。',
            }];
        if (!lingxing)
            blockers.push({
                code: 'LINGXING_BINDING_MISSING',
                severity: 'blocking',
                detail: '开发预览中的当前店铺尚未绑定领星账号与店铺身份。',
                provider: 'lingxing',
            });
        if (lingxing && !lingxing.externalAccountId)
            blockers.push({
                code: 'LINGXING_BINDING_INVALID',
                severity: 'attention',
                detail: '开发预览：稳定身份待模拟首次新鲜登录识别；不代表真实身份已确认。',
                provider: 'lingxing',
            });
        if (!amazonAds)
            blockers.push({
                code: 'AMAZON_ADS_BINDING_MISSING',
                severity: 'blocking',
                detail: '开发预览中的当前店铺尚未确认自动识别的领星广告账户。',
                provider: 'amazon_ads',
            });
        const businessDate = previewContext(store, previewGenerations.get(store.storeId) ?? 0).businessDate;
        return {
            schemaVersion: 1,
            key: { storeId: store.storeId, marketplace: 'US', businessDate },
            displayName: store.displayName,
            storeStatus: store.status,
            currency: 'USD',
            selected: activePreviewStoreId === store.storeId,
            eligibleForCollection: false,
            providers: {
                lingxing: {
                    provider: 'lingxing',
                    bindingState: lingxing ? 'unknown' : 'missing',
                    connectionStatus: lingxing?.status ?? 'missing',
                    sessionStatus: 'unknown',
                    ...(lingxing?.accountLabel ? { accountLabel: lingxing.accountLabel } : {}),
                    ...(lingxing?.externalAccountId ? { externalAccountId: lingxing.externalAccountId } : {}),
                },
                amazonAds: {
                    provider: 'amazon_ads',
                    bindingState: amazonAds ? 'unknown' : 'missing',
                    connectionStatus: amazonAds?.status ?? 'missing',
                    sessionStatus: 'unknown',
                    ...(amazonAds?.externalAccountId ? { externalAccountId: amazonAds.externalAccountId } : {}),
                },
            },
            collection: {
                state: 'unknown',
                requiredReportCount: 8,
            },
            import: { state: 'unknown' },
            metrics: {
                freshness: 'unknown',
                expectedMetricDate: String(businessDate),
            },
            overall: store.status === 'archived'
                ? 'archived'
                : store.status === 'inactive'
                    ? 'inactive'
                    : 'unknown',
            blockers,
            generatedAt,
        };
    });
    return {
        schemaVersion: 1,
        marketplace: 'US',
        generatedAt,
        stores,
    };
};
const requirePreviewMissionAuthority = (submitted: StoreContextEnvelope) => {
    const authoritative = currentPreviewContext();
    if (!authoritative)
        throw new Error('PREVIEW_EXPLICIT_STORE_SELECTION_REQUIRED');
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
const previewCollectionWindow = (businessDate: string, lookbackDays: number): {
    dateStart: string;
    dateEnd: string;
} => {
    const businessDay = new Date(`${businessDate}T00:00:00.000Z`);
    const dateEnd = new Date(businessDay.getTime() - 24 * 60 * 60 * 1000);
    const dateStart = new Date(businessDay.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    return {
        dateStart: dateStart.toISOString().slice(0, 10),
        dateEnd: dateEnd.toISOString().slice(0, 10),
    };
};
const previewScheduleProjection = (submitted: StoreContextEnvelope): StoreCollectionScheduleProjection & {
    previewOnly: true;
    authorityState: 'PROTOTYPE_ONLY';
} => {
    const authoritative = requirePreviewMissionAuthority(submitted);
    const config = previewRuntimeConfigs.get(authoritative.storeId)?.current;
    if (!config) {
        return {
            storeId: authoritative.storeId,
            businessDate: authoritative.businessDate,
            enabled: false,
            state: 'not_configured',
            detail: '仅开发预览：当前店铺尚未配置。',
            previewOnly: true,
            authorityState: 'PROTOTYPE_ONLY',
        };
    }
    if (config.status === 'archived') {
        return {
            storeId: authoritative.storeId,
            businessDate: authoritative.businessDate,
            enabled: false,
            state: 'archived',
            detail: '仅开发预览：当前店铺配置已归档。',
            previewOnly: true,
            authorityState: 'PROTOTYPE_ONLY',
        };
    }
    const state = previewScheduleStates.get(authoritative.storeId) ?? 'waiting';
    const window = previewCollectionWindow(authoritative.businessDate, config.values.collectionLookbackDays);
    const fingerprint = (String(authoritative.storeId).includes('shc001') ? '1' : '2').repeat(64);
    const terminal = state === 'succeeded' || state === 'failed';
    return {
        storeId: authoritative.storeId,
        businessDate: authoritative.businessDate,
        enabled: true,
        state,
        detail: state === 'failed'
            ? '仅开发预览：本业务日失败关闭且不会自动重试。'
            : state === 'succeeded'
                ? '仅开发预览：本业务日采集已完成。'
                : '仅开发预览：等待当前店铺配置时间。',
        scheduleLocalTime: config.values.collectionScheduleLocalTime,
        configRevision: config.revision,
        ...window,
        fingerprint,
        ...(terminal
            ? {
                lastAttempt: {
                    schemaVersion: 1,
                    fingerprint,
                    integrityDigest: (state === 'failed' ? 'b' : 'a').repeat(64),
                    storeId: authoritative.storeId,
                    browserProfileId: authoritative.browserProfileId,
                    sessionGeneration: authoritative.sessionGeneration,
                    businessDate: authoritative.businessDate,
                    scheduleLocalTime: config.values.collectionScheduleLocalTime,
                    configRevision: config.revision,
                    lookbackDays: config.values.collectionLookbackDays,
                    ...window,
                    requestId: `manual:${fingerprint}`,
                    trigger: 'manual',
                    state,
                    claimedAt: '2026-07-22T15:00:00.000Z',
                    completedAt: '2026-07-22T15:02:00.000Z',
                    ...(state === 'failed' ? { failureCode: 'PREVIEW_VISIBLE_SESSION_REQUIRED' } : {}),
                },
            }
            : {}),
        previewOnly: true,
        authorityState: 'PROTOTYPE_ONLY',
    };
};
const previewRetentionManifest = (submitted: StoreContextEnvelope) => {
    const authoritative = requirePreviewMissionAuthority(submitted);
    const config = previewRuntimeConfigs.get(authoritative.storeId)?.current;
    if (!config || config.status !== 'active') {
        throw new Error('仅开发预览：当前店铺活动配置不可用。');
    }
    const blocked = String(authoritative.storeId).includes('shc002');
    return {
        schemaVersion: 1,
        mode: 'dry-run',
        deletionSupported: false,
        generatedAt: '2026-07-22T16:00:00.000Z',
        storeId: String(authoritative.storeId),
        profileId: String(authoritative.browserProfileId),
        marketplace: 'US',
        currency: 'USD',
        retentionDays: config.values.evidenceRetentionDays,
        cutoffAt: blocked ? '2026-01-23T16:00:00.000Z' : '2025-07-22T16:00:00.000Z',
        expiryBasis: 'mtime-before-cutoff',
        applyable: false,
        scanSafe: !blocked,
        candidateCount: blocked ? 0 : 3,
        candidateBytes: blocked ? 0 : 3145728,
        protectedScopeCount: 3,
        protectedFileCount: 1,
        blockerCount: blocked ? 1 : 0,
        blockers: blocked
            ? [{
                    code: 'UNSAFE_LINK_OR_REPARSE_POINT',
                    detail: '仅开发预览安全阻塞示例；不包含本地路径。',
                }]
            : [],
        previewOnly: true,
        authorityState: 'PROTOTYPE_ONLY',
    };
};
const assertPreviewRevision = (expected: unknown, actual: string, label: string) => {
    if (typeof expected !== 'string' || !expected) {
        throw new Error(`PREVIEW_CAS_REQUIRED: ${label}必须提供 expectedRevision。`);
    }
    if (expected !== actual) {
        throw new Error(`PREVIEW_OBJECT_CONFLICT: ${label}版本冲突，请重新读取后再试。`);
    }
};
const optionalPreviewAsin = (value: unknown): string | undefined => (value === undefined || value === null || String(value).trim() === ''
    ? undefined
    : previewAsin(value));
const previewLimit = (value: unknown, fallback: number, maximum: number): number => {
    if (value === undefined)
        return fallback;
    const limit = previewPositiveInteger(value, 'limit');
    if (limit > maximum)
        throw new Error(`limit 不能超过 ${maximum}。`);
    return limit;
};
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
requirePreviewDatasetAuthority,
get previewProductIdSequence() { return previewProductIdSequence; },
set previewProductIdSequence(value: typeof previewProductIdSequence) { previewProductIdSequence = value; },
assertPreviewRevision,
optionalPreviewAsin,
get previewOperationEventIdSequence() { return previewOperationEventIdSequence; },
set previewOperationEventIdSequence(value: typeof previewOperationEventIdSequence) { previewOperationEventIdSequence = value; },
previewLimit,
get previewListingVersionIdSequence() { return previewListingVersionIdSequence; },
set previewListingVersionIdSequence(value: typeof previewListingVersionIdSequence) { previewListingVersionIdSequence = value; },
get previewListingIdSequence() { return previewListingIdSequence; },
set previewListingIdSequence(value: typeof previewListingIdSequence) { previewListingIdSequence = value; },
requirePreviewMissionAuthority,
requirePreviewStore,
previewConnections,
previewGenerations,
previewView,
storeContextListeners,
previewAdsConfirmationTokens,
get previewConnectionSequence() { return previewConnectionSequence; },
set previewConnectionSequence(value: typeof previewConnectionSequence) { previewConnectionSequence = value; },
previewMissionQuery,
previewMissionCommand,
previewMissionDomainApi,
previewDecisionDomainApi,
previewPolicyDomainApi,
previewExperimentMemoryDomain,
previewAnalysisAuthorityApi,
get previewStores() { return previewStores; },
set previewStores(value: typeof previewStores) { previewStores = value; },
storeRecordListeners,
get activePreviewStoreId() { return activePreviewStoreId; },
set activePreviewStoreId(value: typeof activePreviewStoreId) { activePreviewStoreId = value; },
activatePreviewDataset,
previewDailyStatuses,
currentPreviewContext,
username,
scenario,
get activePreviewScope() { return activePreviewScope; },
set activePreviewScope(value: typeof activePreviewScope) { activePreviewScope = value; },
previewRuntimeConfigs,
buildPreviewRuntimeConfig,
get fixtures() { return fixtures; },
set fixtures(value: typeof fixtures) { fixtures = value; },
get recommendations() { return recommendations; },
set recommendations(value: typeof recommendations) { recommendations = value; },
readbackStagePreview,
previewAiDiagnosisRuns,
previewGates,
previewPassedGateCount,
firstMissingPreviewGate,
previewScheduleProjection,
previewScheduleStates,
previewRetentionManifest
};
}

export type PreviewRuntimeContext = ReturnType<typeof createPreviewRuntimeState>;
