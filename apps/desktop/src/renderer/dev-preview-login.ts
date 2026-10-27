// 历史开发预览职责模块；启用边界由原引导入口统一控制。
import type { StoreConnection } from '@amazon-ai-ops/shared-types';
import { normalizeProviderExternalAccountId, normalizeStoreCapabilityId } from '@amazon-ai-ops/shared-types';
import type { BrowserLoginRequest, BrowserLoginResult, ConfirmBrowserLoginAdsIdentityRequest } from '../shared/login-contract';
import { previewContext } from './dev-preview-stores';
import { clonePreviewSnapshot } from './dev-preview-values';
import type { PreviewRuntimeContext } from './dev-preview-state';

export function createPreviewLoginApi(previewRuntimeContext: PreviewRuntimeContext) {
const previewBrowserLogin = async (request: BrowserLoginRequest): Promise<BrowserLoginResult> => {
    const authoritative = previewRuntimeContext.requirePreviewMissionAuthority(request.storeContext);
    const store = previewRuntimeContext.requirePreviewStore(authoritative.storeId);
    const current = previewRuntimeContext.previewConnections.get(store.storeId) ?? [];
    const lingxingIndex = current.findIndex((connection) => connection.provider === 'lingxing');
    const lingxing = lingxingIndex >= 0 ? current[lingxingIndex] : undefined;
    const amazonAds = current.find((connection) => connection.provider === 'amazon_ads');
    if (!lingxing
        || lingxing.accountLabel?.trim() !== request.username.trim()
        || !lingxing.normalizedCollectionStoreName) {
        throw new Error('PREVIEW_LINGXING_COLLECTION_MAPPING_REQUIRED');
    }
    if (!lingxing.externalAccountId || !lingxing.normalizedExternalAccountId) {
        const stableExternalAccountId = `DEV-PREVIEW-STABLE-${String(store.storeId)}`;
        const normalizedStableExternalAccountId = normalizeProviderExternalAccountId('lingxing', stableExternalAccountId)!;
        const now = Date.now();
        const previous = Date.parse(lingxing.updatedAt);
        const updatedAt = new Date(Number.isFinite(previous) && now <= previous ? previous + 1 : now).toISOString();
        const enrolled: StoreConnection = {
            ...lingxing,
            externalAccountId: stableExternalAccountId,
            normalizedExternalAccountId: normalizedStableExternalAccountId,
            updatedAt,
        };
        previewRuntimeContext.previewConnections.set(store.storeId, current.map((connection, index) => index === lingxingIndex ? enrolled : connection));
        const generation = (previewRuntimeContext.previewGenerations.get(store.storeId) ?? 0) + 1;
        previewRuntimeContext.previewGenerations.set(store.storeId, generation);
        const view = previewRuntimeContext.previewView(store, previewContext(store, generation));
        previewRuntimeContext.storeContextListeners.forEach((listener) => listener(clonePreviewSnapshot(view)));
    }
    const detectedExternalAccountId = amazonAds?.externalAccountId
        || `DEV-PREVIEW-ADS-${String(store.storeId)}`;
    const confirmationToken = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    previewRuntimeContext.previewAdsConfirmationTokens.set(confirmationToken, {
        storeId: store.storeId,
        externalAccountId: detectedExternalAccountId,
    });
    return {
        ok: true,
        credentialSource: request.credentialSource,
        currentStore: store.displayName,
        erpSessionReady: true,
        erpSessionReused: false,
        sessionIdentityVerified: false,
        adsSessionReady: false,
        adsUnavailableReason: '仅开发预览：已模拟自动识别，确认前不代表真实 ERP 或 Ads 登录成功。',
        adsIdentityCandidate: {
            confirmationToken,
            detectedExternalAccountId,
            detectedAccountLabel: '预览广告账户',
        },
        credentialPersistence: 'not_saved_unverified_session',
    };
};
const previewConfirmAdsIdentity = async (request: ConfirmBrowserLoginAdsIdentityRequest): Promise<BrowserLoginResult> => {
    const authoritative = previewRuntimeContext.requirePreviewMissionAuthority(request.storeContext);
    const pending = previewRuntimeContext.previewAdsConfirmationTokens.get(request.confirmationToken);
    if (!pending || pending.storeId !== authoritative.storeId) {
        throw new Error('PREVIEW_ADS_IDENTITY_CONFIRMATION_EXPIRED');
    }
    const store = previewRuntimeContext.requirePreviewStore(authoritative.storeId);
    const current = previewRuntimeContext.previewConnections.get(store.storeId) ?? [];
    const existing = current.find((connection) => connection.provider === 'amazon_ads');
    const now = new Date().toISOString();
    const ready: StoreConnection = {
        id: existing?.id ?? normalizeStoreCapabilityId(`preview-ads-${++previewRuntimeContext.previewConnectionSequence}`),
        storeId: store.storeId,
        provider: 'amazon_ads',
        status: 'ready',
        accountLabel: '预览广告账户',
        externalAccountId: pending.externalAccountId,
        normalizedExternalAccountId: normalizeProviderExternalAccountId('amazon_ads', pending.externalAccountId),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        lastVerifiedAt: now,
    };
    previewRuntimeContext.previewConnections.set(store.storeId, [
        ...current.filter((connection) => connection.provider !== 'amazon_ads'),
        ready,
    ]);
    previewRuntimeContext.previewAdsConfirmationTokens.delete(request.confirmationToken);
    const view = previewRuntimeContext.previewView(store, authoritative);
    previewRuntimeContext.storeContextListeners.forEach((listener) => listener(clonePreviewSnapshot(view)));
    return {
        ok: true,
        credentialSource: 'typed',
        currentStore: store.displayName,
        erpSessionReady: true,
        erpSessionReused: false,
        sessionIdentityVerified: false,
        adsSessionReady: true,
        adsEntryMode: 'erp_ads_entry',
        adsUrl: 'https://ads.lingxing.com/home',
        adsTitle: '仅开发预览 Ads',
        credentialPersistence: 'not_saved_unverified_session',
    };
};
return { previewBrowserLogin, previewConfirmAdsIdentity };
}

export type PreviewLoginApi = ReturnType<typeof createPreviewLoginApi>;
