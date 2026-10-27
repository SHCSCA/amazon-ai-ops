// 历史开发预览职责模块；启用边界由原引导入口统一控制。
import { type PreviewBootstrapInput, type PreviewBootstrapResolution, type PreviewScenarioId } from './dev-preview-contracts';
import { DEFAULT_PREVIEW_SCENARIO, PREVIEW_SCENARIO_IDS } from './dev-preview-scenarios';
import { createBrowserPreviewElectronApi } from './dev-preview-composition';

export function resolvePreviewBootstrap(input: PreviewBootstrapInput): PreviewBootstrapResolution {
    const isLocalHost = input.hostname === 'localhost' || input.hostname === '127.0.0.1';
    if (!input.dev || !isLocalHost)
        return { enabled: false };
    const parameters = new URLSearchParams(input.search);
    if (parameters.get('preview') !== '1')
        return { enabled: false };
    const requestedScenario = parameters.get('scenario');
    if (!requestedScenario)
        return { enabled: true, scenarioId: DEFAULT_PREVIEW_SCENARIO };
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
        location?: {
            hostname: string;
            search: string;
        };
    };
    username?: string;
}): PreviewBootstrapResolution {
    const resolution = resolvePreviewBootstrap({
        dev: input.dev,
        hostname: input.target.location?.hostname || '',
        search: input.target.location?.search || '',
    });
    if (resolution.enabled && !input.target.electronAPI?.getState) {
        input.target.electronAPI = createBrowserPreviewElectronApi(input.username || 'SHC001', resolution.scenarioId);
    }
    return resolution;
}
