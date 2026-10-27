// 历史预览纯夹具测试保留原有启用限制与完整断言。
import { type MissionControlLegacyRouteId, type MissionControlViewId, type NavigationIntent, PreviewModule } from './dev-preview-test-environment';
const EXPECTED_SCENARIOS = [
    'missing-scope',
    'missing-reports',
    'pending-import',
    'diagnosis-ready',
    'mixed-recommendations',
    'missing-readback-evidence',
    'delivery-ready',
] as const;

const LEGACY_PREVIEW_ROUTE_CASES: readonly {
    route: MissionControlLegacyRouteId;
    intent: NavigationIntent;
    view: MissionControlViewId;
}[] = [
    { route: 'dashboard', intent: { workspace: 'today', subview: 'overview' }, view: 'today/overview' },
    { route: 'operation-events', intent: { workspace: 'today', subview: 'events' }, view: 'today/events' },
    { route: 'ad-quant', intent: { workspace: 'missions', subview: 'facts' }, view: 'missions/facts' },
    { route: 'recommendations', intent: { workspace: 'decisions', subview: 'recommendations' }, view: 'decisions/recommendations' },
    { route: 'approval', intent: { workspace: 'decisions', subview: 'approval' }, view: 'decisions/approval' },
    { route: 'approval', intent: { workspace: 'decisions', subview: 'decided' }, view: 'decisions/decided' },
    { route: 'readback', intent: { workspace: 'execution', subview: 'evidence' }, view: 'execution/evidence' },
    { route: 'product-management', intent: { workspace: 'objects', subview: 'products' }, view: 'objects/products' },
    { route: 'product-config', intent: { workspace: 'objects', subview: 'targets' }, view: 'objects/targets' },
    { route: 'keyword-opportunities', intent: { workspace: 'objects', subview: 'keywords' }, view: 'objects/keywords' },
    { route: 'listing-optimization', intent: { workspace: 'objects', subview: 'listing' }, view: 'objects/listing' },
    { route: 'operation-scope', intent: { workspace: 'collection', subview: 'scope' }, view: 'collection/scope' },
    { route: 'data-collection', intent: { workspace: 'collection', subview: 'reports' }, view: 'collection/reports' },
    { route: 'data-import-validation', intent: { workspace: 'collection', subview: 'import-check' }, view: 'collection/import-check' },
    { route: 'settings', intent: { workspace: 'settings', subview: 'ai-and-local' }, view: 'settings/ai-and-local' },
    { route: 'scheduler', intent: { workspace: 'settings', subview: 'scheduler' }, view: 'settings/scheduler' },
    { route: 'delivery', intent: { workspace: 'settings', subview: 'delivery' }, view: 'settings/delivery' },
] as const;

type PreviewScenarioId = (typeof EXPECTED_SCENARIOS)[number];

const PREVIEW_RECOMMENDATION_FILTER = {
    dateFrom: '2026-05-21',
    dateTo: '2026-06-23',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B0GTTJFQTM',
    batchId: 'batch_preview_20260625',
} as const;

function getPreviewRecommendations(api: any, filter: Record<string, unknown> = {}): Promise<any[]> {
    return api.getRecommendations({
        ...PREVIEW_RECOMMENDATION_FILTER,
        ...filter,
    });
}

interface PreviewScenarioContract {
    id: PreviewScenarioId;
    scopeReady: boolean;
    reportsCollected: boolean;
    reportsImported: boolean;
    diagnosisReady: boolean;
    recommendationState: 'blocked' | 'none' | 'mixed' | 'approved';
    readbackEvidenceReady: boolean;
    deliveryReady: boolean;
}

function previewExports() {
    return PreviewModule as unknown as {
        PREVIEW_SCENARIO_IDS?: readonly PreviewScenarioId[];
        PREVIEW_SCENARIOS?: Record<PreviewScenarioId, PreviewScenarioContract>;
        resolvePreviewBootstrap?: (input: {
            dev: boolean;
            hostname: string;
            search: string;
        }) => {
            enabled: boolean;
            scenarioId?: PreviewScenarioId;
            warning?: string;
        };
        bootstrapBrowserPreview?: (input: {
            dev: boolean;
            target: {
                electronAPI?: any;
                location: {
                    hostname: string;
                    search: string;
                };
            };
        }) => {
            enabled: boolean;
            scenarioId?: PreviewScenarioId;
            warning?: string;
        };
        createBrowserPreviewElectronApi?: (username: string, scenarioId?: PreviewScenarioId) => any;
    };
}

async function bindPreviewPendingTarget(api: any, pending: any) {
    return api.bindRecommendationWritableTarget({
        recommendationId: pending.id,
        expectedRevision: pending.revision,
        scope: {
            dateFrom: '2026-05-21',
            dateTo: '2026-06-23',
            storeName: 'FT-US-US',
            marketplaceCode: 'US',
            asin: 'B0GTTJFQTM',
            batchId: 'batch_preview_20260625',
        },
        binding: {
            boundBy: 'Preview Verifier',
            note: '已在 Ads UI 中确认当前关键词与真实报表行唯一对应。',
            writableTarget: {
                entityType: 'keyword',
                entityId: 'amzn-keyword-preview-1001',
                sourceFile: 'keyword.xlsx',
                sourceRow: pending.evidence.sourceRow,
                identitySource: 'ads_ui',
                identityProofPath: 'D:/preview/evidence/keyword-1001.png',
                verificationNote: '逐项核对广告活动、广告组、关键词名称与对象 ID。',
            },
        },
    });
}
export { EXPECTED_SCENARIOS, LEGACY_PREVIEW_ROUTE_CASES, type PreviewScenarioId, PREVIEW_RECOMMENDATION_FILTER, getPreviewRecommendations, type PreviewScenarioContract, previewExports, bindPreviewPendingTarget };
