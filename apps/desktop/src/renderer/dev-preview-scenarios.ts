// 历史开发预览职责模块；启用边界由原引导入口统一控制。
import { type PreviewScenarioId, type PreviewScenarioContract } from './dev-preview-contracts';

export const PREVIEW_SCENARIO_IDS = [
    'missing-scope',
    'missing-reports',
    'pending-import',
    'diagnosis-ready',
    'mixed-recommendations',
    'missing-readback-evidence',
    'delivery-ready',
] as const;

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

export const DEFAULT_PREVIEW_SCENARIO: PreviewScenarioId = 'diagnosis-ready';
