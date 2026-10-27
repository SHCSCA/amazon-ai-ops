// 历史开发预览职责模块；启用边界由原引导入口统一控制。
import type { StoreContextEnvelope, StoreRecord } from '@amazon-ai-ops/shared-types';
import { normalizeBrowserProfileId, normalizeStoreContextEnvelope, normalizeStoreId } from '@amazon-ai-ops/shared-types';
import { type PreviewStoreIdentity } from './dev-preview-contracts';

export function previewStore(storeIdInput: string, browserProfileIdInput: string, displayName: string, timestamp = '2026-07-22T00:00:00.000Z'): StoreRecord {
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

export function previewContext(store: StoreRecord, sessionGeneration: number): StoreContextEnvelope {
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

export function previewStoreIdentity(store: StoreRecord): PreviewStoreIdentity {
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

export function applyPreviewStoreIdentity<T>(value: T, identity: PreviewStoreIdentity): T {
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
                if (source === 'D:/preview/' && next.includes(replacement))
                    return;
                next = next.split(source).join(replacement);
            });
            return next;
        }
        if (Array.isArray(input))
            return input.map((item) => visit(item));
        if (input && typeof input === 'object') {
            return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([key, item]) => [key, visit(item)]));
        }
        return input;
    };
    return visit(value) as T;
}
