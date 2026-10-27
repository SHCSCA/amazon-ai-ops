// 历史开发预览职责模块；启用边界由原引导入口统一控制。
import type { ActionRecommendation, MissionControlCapabilityAction, MissionControlLegacyRouteId, MissionControlViewId, MissionControlWorkspaceId, ProductCost, StoreId } from '@amazon-ai-ops/shared-types';
import type { OperationScope, RecommendationView } from './types';
import { PREVIEW_SCENARIO_IDS } from './dev-preview-scenarios';
import { previewFixtures } from './dev-preview-fixtures';

export type PreviewRecommendation = ActionRecommendation & RecommendationView;

export interface PreviewRecommendationFilter {
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

export type PreviewStoreIdentity = {
    storeName: string;
    primaryAsin: string;
    secondaryAsin: string;
    tertiaryAsin: string;
    batchId: string;
    pathSegment: string;
};

export type PreviewCapabilitySpec = readonly [
    capabilityId: string,
    workspace: MissionControlWorkspaceId,
    view: MissionControlViewId,
    action: MissionControlCapabilityAction,
    legacyRoute?: MissionControlLegacyRouteId
];

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

export const PREVIEW_REPORT_MANIFEST_ARTIFACT_ID = 'artifact:v1:00000000-0000-4000-8000-000000000102';

export type PreviewVersionedProduct = {
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

export type PreviewProductState = {
    row: PreviewVersionedProduct;
    revisionVersion: number;
};

export type PreviewVersionedOperationEvent = {
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

export type PreviewOperationEventState = {
    row: PreviewVersionedOperationEvent;
    revisionVersion: number;
};

export type PreviewAdObjectKind = 'campaign' | 'ad_group' | 'target' | 'search_term';

export type PreviewAdObjectFact = {
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

export type PreviewKeywordFact = {
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

export type PreviewListingContent = {
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

export type PreviewListingState = {
    row: PreviewListingContent;
    revisionVersion: number;
};

export type PreviewListingVersion = {
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

export type PreviewStoreDataset = {
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
