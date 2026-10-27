// 历史预览纯夹具测试保留原有启用限制与完整断言。
import { DeliveryPageModule, createElement, describe, expect, it, renderToStaticMarkup } from './dev-preview-test-environment';
import { EXPECTED_SCENARIOS, getPreviewRecommendations, previewExports } from './dev-preview-test-fixture';
describe('development preview enablement', () => {
    it('rejects localhost preview in a production build even with an explicit query opt-in', () => {
        const resolve = previewExports().resolvePreviewBootstrap;
        expect(typeof resolve).toBe('function');
        expect(resolve!({
            dev: false,
            hostname: 'localhost',
            search: '?preview=1&scenario=delivery-ready',
        })).toMatchObject({ enabled: false });
    });
    it('rejects a development browser session without explicit preview opt-in', () => {
        const resolve = previewExports().resolvePreviewBootstrap;
        expect(typeof resolve).toBe('function');
        expect(resolve!({
            dev: true,
            hostname: 'localhost',
            search: '',
        })).toMatchObject({ enabled: false });
    });
    it('accepts explicit development preview and defaults to the non-final diagnosis-ready scenario', () => {
        const resolve = previewExports().resolvePreviewBootstrap;
        expect(typeof resolve).toBe('function');
        expect(resolve!({
            dev: true,
            hostname: '127.0.0.1',
            search: '?preview=1',
        })).toEqual({
            enabled: true,
            scenarioId: 'diagnosis-ready',
        });
    });
    it('falls back deterministically and visibly when the requested scenario is invalid', () => {
        const resolve = previewExports().resolvePreviewBootstrap;
        expect(typeof resolve).toBe('function');
        const result = resolve!({
            dev: true,
            hostname: 'localhost',
            search: '?preview=1&scenario=definitely-not-real',
        });
        expect(result).toMatchObject({
            enabled: true,
            scenarioId: 'diagnosis-ready',
        });
        expect(result.warning).toContain('definitely-not-real');
        expect(result.warning).toContain('diagnosis-ready');
    });
});

describe('browser preview bootstrap integration', () => {
    it('does not install an API on production localhost even with explicit opt-in', () => {
        const bootstrap = previewExports().bootstrapBrowserPreview;
        const target = {
            location: { hostname: 'localhost', search: '?preview=1&scenario=delivery-ready' },
        } as {
            location: {
                hostname: string;
                search: string;
            };
            electronAPI?: any;
        };
        expect(typeof bootstrap).toBe('function');
        expect(bootstrap!({ dev: false, target })).toMatchObject({ enabled: false });
        expect(target.electronAPI).toBeUndefined();
    });
    it('installs the selected fixture only for an explicitly opted-in local development URL', async () => {
        const bootstrap = previewExports().bootstrapBrowserPreview;
        const target = {
            location: { hostname: '127.0.0.1', search: '?preview=1&scenario=mixed-recommendations' },
        } as {
            location: {
                hostname: string;
                search: string;
            };
            electronAPI?: any;
        };
        expect(bootstrap!({ dev: true, target })).toEqual({
            enabled: true,
            scenarioId: 'mixed-recommendations',
        });
        expect(await getPreviewRecommendations(target.electronAPI)).toHaveLength(2);
        const [store] = await target.electronAPI.listStores();
        const storeView = await target.electronAPI.switchStore({ storeId: store.storeId, marketplace: store.marketplace });
        expect(target.electronAPI.missionDomain).toBeTruthy();
        await expect(target.electronAPI.missionDomain.missions.list(storeView.context, { includeArchived: true }))
            .resolves.toHaveLength(7);
    });
    it('preserves a pre-injected Electron API instead of replacing smoke or preload behavior', () => {
        const bootstrap = previewExports().bootstrapBrowserPreview;
        const injectedApi = { getState: async () => ({ isLoggedIn: true }), marker: 'pre-injected' };
        const target = {
            electronAPI: injectedApi,
            location: { hostname: 'localhost', search: '?preview=1&scenario=delivery-ready' },
        };
        expect(bootstrap!({ dev: true, target })).toMatchObject({
            enabled: true,
            scenarioId: 'delivery-ready',
        });
        expect(target.electronAPI).toBe(injectedApi);
    });
});

describe('DeliveryPage development preview state', () => {
    it('renders all seven scenarios as preview-only and never unlocks the real export gate', async () => {
        const deliveryModule = DeliveryPageModule as unknown as {
            canExportDeliveryBundle: (readiness: any, packageEvidence: any) => boolean;
            deliveryPreviewState?: (readiness: any, evidenceStatus: any) => any;
            DeliveryPreviewNotice?: (props: {
                state: any;
            }) => any;
        };
        expect(typeof deliveryModule.deliveryPreviewState).toBe('function');
        expect(typeof deliveryModule.DeliveryPreviewNotice).toBe('function');
        for (const id of EXPECTED_SCENARIOS) {
            const api = previewExports().createBrowserPreviewElectronApi!('SHC001', id);
            const [readiness, evidenceStatus] = await Promise.all([
                api.getDeliveryReadiness(),
                api.getDeliveryEvidenceStatus(),
            ]);
            const state = deliveryModule.deliveryPreviewState!(readiness, evidenceStatus);
            const markup = renderToStaticMarkup(createElement(deliveryModule.DeliveryPreviewNotice!, { state }));
            expect(state.scenarioId).toBe(id);
            expect(state.tone).toBe('warning');
            expect(markup).toContain('仅开发预览');
            expect(markup).toContain('不可视为 APP_READY');
            expect(deliveryModule.canExportDeliveryBundle(readiness, evidenceStatus.package)).toBe(false);
            if (id === 'delivery-ready') {
                expect(state.headline).toBe('仅开发预览已走通');
                expect(markup).toContain('仅开发预览已走通');
            }
            else {
                expect(state.headline).toBe('仅开发预览场景未走通');
            }
        }
    });
});
