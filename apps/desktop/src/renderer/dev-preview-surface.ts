// 历史开发预览职责模块；启用边界由原引导入口统一控制。
import type { BindRecommendationWritableTargetRequest, BindRecommendationWritableTargetResult, CreateStoreConnectionInput, RecommendationReviewResolution, ResolveRecommendationReviewRequest, ResolveRecommendationReviewResult, WritableAdTargetBinding, WritableAdTargetEvidence, RemoveStoreConnectionInput, StoreContextEnvelope, StoreCollectionScheduleRunResult, StoreConnection, StoreId, StoreRecord, StoreScopeRef, StoreRuntimeConfigProjection, StoreRuntimeConfigValues, StoreWorkspaceView, UpdateStoreConnectionInput } from '@amazon-ai-ops/shared-types';
import { normalizeLingxingCollectionStoreName, normalizeProviderExternalAccountId, normalizeStoreCapabilityId } from '@amazon-ai-ops/shared-types';
import { assertRecommendationDecisionRevision } from '@amazon-ai-ops/rules-engine';
import { createMissionDomainWindowSurface } from './mission-control/workspaces/mission-domain-window-api';
import { clonePreviewSnapshot, previewInputRecord, assertPreviewIdentityHints, previewIsoDate, previewAsin, previewOptionalText, normalizedPreviewText } from './dev-preview-values';
import { previewStore, previewContext, applyPreviewStoreIdentity, previewStoreIdentity } from './dev-preview-stores';
import { previewPipeline } from './dev-preview-pipeline';
import { previewBatchOptions, previewReportOptions, previewReportFileName, PREVIEW_REPORT_FOLDER_ARTIFACT_ID, previewReportArtifactId } from './dev-preview-fixtures';
import { type PreviewRecommendationFilter, PREVIEW_REPORT_MANIFEST_ARTIFACT_ID } from './dev-preview-contracts';
import { applyPreviewRecommendationDecision } from './dev-preview-decisions';
import type { PreviewRuntimeContext } from './dev-preview-state';
import type { PreviewLoginApi } from './dev-preview-login';
import type { PreviewProductsApi } from './dev-preview-products';
import type { PreviewEventsApi } from './dev-preview-events';
import type { PreviewQueriesApi } from './dev-preview-queries';
import type { PreviewListingsApi } from './dev-preview-listings';

export function createPreviewElectronSurface(previewRuntimeContext: PreviewRuntimeContext, login: PreviewLoginApi, products: PreviewProductsApi, events: PreviewEventsApi, queries: PreviewQueriesApi, listings: PreviewListingsApi) {
return {
    missionControl: {
        query: previewRuntimeContext.previewMissionQuery,
        command: previewRuntimeContext.previewMissionCommand,
    },
    missionDomain: createMissionDomainWindowSurface(previewRuntimeContext.previewMissionDomainApi, previewRuntimeContext.previewDecisionDomainApi, previewRuntimeContext.previewPolicyDomainApi, previewRuntimeContext.previewExperimentMemoryDomain.experiments, previewRuntimeContext.previewExperimentMemoryDomain.memory),
    analysisAuthority: previewRuntimeContext.previewAnalysisAuthorityApi,
    storeScopedObjectsPreviewOnly: true,
    storeScopedAdListingPreviewOnly: true,
    listStores: async () => clonePreviewSnapshot(previewRuntimeContext.previewStores),
    getStore: async (storeId: StoreId) => clonePreviewSnapshot(previewRuntimeContext.requirePreviewStore(storeId)),
    createStore: async (input: {
        displayName?: unknown;
    }) => {
        const displayName = String(input?.displayName ?? '').trim();
        if (!displayName || displayName.length > 120)
            throw new Error('预览店铺名称必须为 1-120 个字符。');
        const suffix = previewRuntimeContext.previewStores.length + 1;
        const store = previewStore(`preview-store-${suffix}`, `preview-profile-${suffix}`, displayName, new Date().toISOString());
        previewRuntimeContext.previewStores = [...previewRuntimeContext.previewStores, store];
        previewRuntimeContext.previewGenerations.set(store.storeId, 0);
        previewRuntimeContext.previewConnections.set(store.storeId, []);
        previewRuntimeContext.storeRecordListeners.forEach((listener) => listener(clonePreviewSnapshot(store)));
        return clonePreviewSnapshot(store);
    },
    updateStore: async (input: {
        storeId: StoreId;
        patch?: Partial<StoreRecord>;
    }) => {
        const current = previewRuntimeContext.requirePreviewStore(input?.storeId);
        const patch = input?.patch ?? {};
        if (typeof patch.businessTimezone === 'string'
            && patch.businessTimezone.trim() !== 'America/Los_Angeles')
            throw new Error('PREVIEW_US_BUSINESS_TIMEZONE_FIXED');
        const next: StoreRecord = {
            ...current,
            ...(typeof patch.displayName === 'string' ? { displayName: patch.displayName.trim() } : {}),
            ...(patch.status === 'active' || patch.status === 'inactive' ? { status: patch.status } : {}),
            businessTimezone: 'America/Los_Angeles',
            marketplace: 'US',
            currency: 'USD',
            updatedAt: new Date().toISOString(),
        };
        previewRuntimeContext.previewStores = previewRuntimeContext.previewStores.map((row) => row.storeId === next.storeId ? next : row);
        if (next.status !== 'active' && previewRuntimeContext.activePreviewStoreId === next.storeId) {
            previewRuntimeContext.activePreviewStoreId = null;
            previewRuntimeContext.storeContextListeners.forEach((listener) => listener(null));
        }
        previewRuntimeContext.storeRecordListeners.forEach((listener) => listener(clonePreviewSnapshot(next)));
        return clonePreviewSnapshot(next);
    },
    archiveStore: async (input: {
        storeId: StoreId;
    }) => {
        const current = previewRuntimeContext.requirePreviewStore(input?.storeId);
        const updatedAt = new Date().toISOString();
        const next: StoreRecord = { ...current, status: 'archived', archivedAt: updatedAt, updatedAt };
        previewRuntimeContext.previewStores = previewRuntimeContext.previewStores.map((row) => row.storeId === next.storeId ? next : row);
        if (previewRuntimeContext.activePreviewStoreId === next.storeId) {
            previewRuntimeContext.activePreviewStoreId = null;
            previewRuntimeContext.storeContextListeners.forEach((listener) => listener(null));
        }
        previewRuntimeContext.storeRecordListeners.forEach((listener) => listener(clonePreviewSnapshot(next)));
        return clonePreviewSnapshot(next);
    },
    restoreStore: async (input: {
        storeId: StoreId;
    }) => {
        const current = previewRuntimeContext.requirePreviewStore(input?.storeId);
        const next: StoreRecord = {
            ...current,
            status: 'active',
            archivedAt: undefined,
            updatedAt: new Date().toISOString(),
        };
        previewRuntimeContext.previewStores = previewRuntimeContext.previewStores.map((row) => row.storeId === next.storeId ? next : row);
        previewRuntimeContext.storeRecordListeners.forEach((listener) => listener(clonePreviewSnapshot(next)));
        return clonePreviewSnapshot(next);
    },
    switchStore: async (scope: StoreScopeRef) => {
        if (!scope || scope.marketplace !== 'US')
            throw new Error('PREVIEW_STORE_SCOPE_MARKETPLACE_UNSUPPORTED');
        const store = previewRuntimeContext.requirePreviewStore(scope.storeId);
        if (store.status !== 'active')
            throw new Error('预览中只能切换到 active 店铺。');
        if (previewRuntimeContext.activePreviewStoreId && previewRuntimeContext.activePreviewStoreId !== store.storeId) {
            previewRuntimeContext.previewGenerations.set(previewRuntimeContext.activePreviewStoreId, (previewRuntimeContext.previewGenerations.get(previewRuntimeContext.activePreviewStoreId) ?? 0) + 1);
        }
        previewRuntimeContext.activatePreviewDataset(store);
        previewRuntimeContext.activePreviewStoreId = store.storeId;
        const generation = (previewRuntimeContext.previewGenerations.get(store.storeId) ?? 0) + 1;
        previewRuntimeContext.previewGenerations.set(store.storeId, generation);
        const view = previewRuntimeContext.previewView(store, previewContext(store, generation));
        previewRuntimeContext.storeContextListeners.forEach((listener) => listener(clonePreviewSnapshot(view)));
        return clonePreviewSnapshot(view);
    },
    createStoreConnection: async (input: CreateStoreConnectionInput) => {
        const store = previewRuntimeContext.requirePreviewStore(input?.storeId);
        if (store.status !== 'active' || previewRuntimeContext.activePreviewStoreId !== store.storeId) {
            throw new Error('PREVIEW_ACTIVE_STORE_CONNECTION_REQUIRED');
        }
        if (input?.provider !== 'lingxing' && input?.provider !== 'amazon_ads') {
            throw new Error('PREVIEW_STORE_CONNECTION_PROVIDER_UNSUPPORTED');
        }
        const current = previewRuntimeContext.previewConnections.get(store.storeId) ?? [];
        const existing = current.find((connection) => connection.provider === input.provider);
        if (existing)
            return clonePreviewSnapshot(existing);
        const accountLabel = typeof input.accountLabel === 'string' ? input.accountLabel.trim() : '';
        const externalAccountId = typeof input.externalAccountId === 'string'
            ? input.externalAccountId.trim()
            : '';
        const collectionStoreName = typeof input.collectionStoreName === 'string'
            ? input.collectionStoreName.trim()
            : '';
        const normalizedCollectionStoreName = normalizeLingxingCollectionStoreName(collectionStoreName);
        const normalizedExternalAccountId = input.provider === 'amazon_ads'
            ? normalizeProviderExternalAccountId(input.provider, externalAccountId)
            : undefined;
        if (input.provider === 'lingxing'
            ? !accountLabel || !normalizedCollectionStoreName || Boolean(externalAccountId)
            : !normalizedExternalAccountId) {
            throw new Error('PREVIEW_STORE_CONNECTION_IDENTITY_REQUIRED');
        }
        const duplicate = [...previewRuntimeContext.previewConnections.values()].flat().find((connection) => (connection.provider === input.provider
            && normalizedExternalAccountId !== undefined
            && connection.normalizedExternalAccountId === normalizedExternalAccountId));
        if (duplicate)
            throw new Error('PREVIEW_EXTERNAL_ACCOUNT_ALREADY_BOUND');
        const occurredAt = new Date().toISOString();
        const connection: StoreConnection = {
            id: normalizeStoreCapabilityId(`preview-capability-${++previewRuntimeContext.previewConnectionSequence}`),
            storeId: store.storeId,
            provider: input.provider,
            status: 'not_configured',
            ...(accountLabel
                ? { accountLabel }
                : {}),
            ...(input.provider === 'lingxing'
                ? {
                    collectionStoreName,
                    normalizedCollectionStoreName,
                }
                : {
                    externalAccountId,
                    normalizedExternalAccountId,
                }),
            createdAt: occurredAt,
            updatedAt: occurredAt,
        };
        previewRuntimeContext.previewConnections.set(store.storeId, [...current, connection]);
        const generation = (previewRuntimeContext.previewGenerations.get(store.storeId) ?? 0) + 1;
        previewRuntimeContext.previewGenerations.set(store.storeId, generation);
        const view = previewRuntimeContext.previewView(store, previewContext(store, generation));
        previewRuntimeContext.storeContextListeners.forEach((listener) => listener(clonePreviewSnapshot(view)));
        return clonePreviewSnapshot(connection);
    },
    updateStoreConnection: async (input: UpdateStoreConnectionInput) => {
        const store = previewRuntimeContext.requirePreviewStore(input?.storeId);
        if (store.status !== 'active' || previewRuntimeContext.activePreviewStoreId !== store.storeId) {
            throw new Error('PREVIEW_ACTIVE_STORE_CONNECTION_REQUIRED');
        }
        const current = previewRuntimeContext.previewConnections.get(store.storeId) ?? [];
        const index = current.findIndex((connection) => connection.id === input?.id);
        if (index === -1)
            throw new Error('PREVIEW_STORE_CONNECTION_NOT_FOUND');
        const existing = current[index]!;
        if (!input.expectedUpdatedAt || input.expectedUpdatedAt !== existing.updatedAt) {
            throw new Error('PREVIEW_STORE_CONNECTION_CONFLICT');
        }
        const normalizedAccountLabel = typeof input.accountLabel === 'string'
            ? input.accountLabel.trim()
            : existing.accountLabel;
        const externalAccountId = typeof input.externalAccountId === 'string'
            ? input.externalAccountId.trim()
            : existing.externalAccountId ?? '';
        const collectionStoreName = typeof input.collectionStoreName === 'string'
            ? input.collectionStoreName.trim()
            : existing.collectionStoreName ?? '';
        const normalizedCollectionStoreName = normalizeLingxingCollectionStoreName(collectionStoreName);
        const normalizedExternalAccountId = existing.provider === 'amazon_ads'
            ? normalizeProviderExternalAccountId(existing.provider, externalAccountId)
            : existing.normalizedExternalAccountId;
        if (existing.provider === 'lingxing'
            ? !normalizedAccountLabel || !normalizedCollectionStoreName || input.externalAccountId !== undefined
            : !normalizedExternalAccountId) {
            throw new Error('PREVIEW_STORE_CONNECTION_IDENTITY_REQUIRED');
        }
        const duplicate = [...previewRuntimeContext.previewConnections.values()].flat().find((connection) => (connection.id !== existing.id
            && connection.provider === existing.provider
            && normalizedExternalAccountId !== undefined
            && connection.normalizedExternalAccountId === normalizedExternalAccountId));
        if (duplicate)
            throw new Error('PREVIEW_EXTERNAL_ACCOUNT_ALREADY_BOUND');
        const accountLabelChanged = normalizedAccountLabel !== existing.accountLabel?.trim();
        const collectionStoreNameChanged = existing.provider === 'lingxing'
            && normalizedCollectionStoreName !== existing.normalizedCollectionStoreName;
        const identityChanged = accountLabelChanged
            || collectionStoreNameChanged
            || normalizedExternalAccountId !== existing.normalizedExternalAccountId;
        const updated: StoreConnection = {
            ...existing,
            ...(normalizedAccountLabel
                ? { accountLabel: normalizedAccountLabel }
                : {}),
            ...(existing.provider === 'lingxing'
                ? {
                    collectionStoreName,
                    normalizedCollectionStoreName,
                    ...(accountLabelChanged
                        ? { externalAccountId: undefined, normalizedExternalAccountId: undefined }
                        : {}),
                }
                : { externalAccountId, normalizedExternalAccountId }),
            ...(identityChanged ? {
                status: 'not_configured' as const,
                lastVerifiedAt: undefined,
                lastFailureCode: 'connection_identity_changed',
                session: undefined,
            } : {}),
            updatedAt: new Date().toISOString(),
        };
        previewRuntimeContext.previewConnections.set(store.storeId, current.map((connection, rowIndex) => rowIndex === index ? updated : connection));
        const generation = (previewRuntimeContext.previewGenerations.get(store.storeId) ?? 0) + 1;
        previewRuntimeContext.previewGenerations.set(store.storeId, generation);
        const view = previewRuntimeContext.previewView(store, previewContext(store, generation));
        previewRuntimeContext.storeContextListeners.forEach((listener) => listener(clonePreviewSnapshot(view)));
        return clonePreviewSnapshot(updated);
    },
    removeStoreConnection: async (input: RemoveStoreConnectionInput) => {
        const store = previewRuntimeContext.requirePreviewStore(input?.storeId);
        if (store.status !== 'active' || previewRuntimeContext.activePreviewStoreId !== store.storeId) {
            throw new Error('PREVIEW_ACTIVE_STORE_CONNECTION_REQUIRED');
        }
        const current = previewRuntimeContext.previewConnections.get(store.storeId) ?? [];
        const existing = current.find((connection) => connection.id === input?.id);
        if (!existing) {
            throw new Error('PREVIEW_STORE_CONNECTION_NOT_FOUND');
        }
        if (!input.expectedUpdatedAt || input.expectedUpdatedAt !== existing.updatedAt) {
            throw new Error('PREVIEW_STORE_CONNECTION_CONFLICT');
        }
        previewRuntimeContext.previewConnections.set(store.storeId, current.filter((connection) => connection.id !== input.id));
        const generation = (previewRuntimeContext.previewGenerations.get(store.storeId) ?? 0) + 1;
        previewRuntimeContext.previewGenerations.set(store.storeId, generation);
        const view = previewRuntimeContext.previewView(store, previewContext(store, generation));
        previewRuntimeContext.storeContextListeners.forEach((listener) => listener(clonePreviewSnapshot(view)));
        return { success: true as const };
    },
    listStoreDailyStatuses: async (input: {
        marketplace: 'US';
    }) => {
        if (!input || input.marketplace !== 'US')
            throw new Error('PREVIEW_STORE_SCOPE_MARKETPLACE_UNSUPPORTED');
        return clonePreviewSnapshot(previewRuntimeContext.previewDailyStatuses());
    },
    getActiveStoreContext: async () => clonePreviewSnapshot(previewRuntimeContext.currentPreviewContext()),
    getActiveStoreWorkspaceView: async () => {
        const context = previewRuntimeContext.currentPreviewContext();
        if (!context)
            return null;
        return clonePreviewSnapshot(previewRuntimeContext.previewView(previewRuntimeContext.requirePreviewStore(context.storeId), context));
    },
    onStoreContextChanged: (callback: (view: StoreWorkspaceView | null) => void) => {
        previewRuntimeContext.storeContextListeners.add(callback);
        return () => previewRuntimeContext.storeContextListeners.delete(callback);
    },
    onStoresChanged: (callback: (store: StoreRecord) => void) => {
        previewRuntimeContext.storeRecordListeners.add(callback);
        return () => previewRuntimeContext.storeRecordListeners.delete(callback);
    },
    getState: async () => ({
        isLoggedIn: true,
        currentStore: previewRuntimeContext.activePreviewStoreId ? previewRuntimeContext.previewStores.find((store) => store.storeId === previewRuntimeContext.activePreviewStoreId)?.displayName ?? previewRuntimeContext.username ?? 'SHC001'
            : previewRuntimeContext.username || 'SHC001',
        loginSession: { erpSessionReused: true, adsEntryMode: 'browser-preview', adsTitle: '浏览器预览模式' },
        storeContext: clonePreviewSnapshot(previewRuntimeContext.currentPreviewContext()),
    }),
    browserLogin: login.previewBrowserLogin,
    confirmBrowserLoginAdsIdentity: login.previewConfirmAdsIdentity,
    browserLogout: async () => true,
    getOperationScope: async (storeContext: StoreContextEnvelope) => {
        const { dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(storeContext);
        return previewRuntimeContext.scenario.scopeReady ? clonePreviewSnapshot(dataset.scope) : null;
    },
    saveOperationScope: async (storeContext: StoreContextEnvelope, inputValue: unknown) => {
        const { store, dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(storeContext);
        if (!previewRuntimeContext.scenario.scopeReady)
            return null;
        const input = previewInputRecord(inputValue, '运营范围');
        assertPreviewIdentityHints(store, input);
        const dateFrom = previewIsoDate(input.dateFrom, '开始日期');
        const dateTo = previewIsoDate(input.dateTo, '结束日期');
        if (dateFrom > dateTo)
            throw new Error('开始日期不能晚于结束日期。');
        dataset.scope = {
            dateFrom,
            dateTo,
            storeName: store.displayName,
            marketplaceCode: 'US',
            currency: 'USD',
            asin: input.asin === undefined ? undefined : previewAsin(input.asin),
            batchId: previewOptionalText(input.batchId, '批次 ID', 200),
        };
        previewRuntimeContext.activePreviewScope = dataset.scope;
        return clonePreviewSnapshot(dataset.scope);
    },
    getStoreRuntimeConfig: async (storeContext: StoreContextEnvelope) => {
        const authoritative = previewRuntimeContext.requirePreviewMissionAuthority(storeContext);
        return clonePreviewSnapshot(previewRuntimeContext.previewRuntimeConfigs.get(authoritative.storeId) ?? { current: null, versions: [] });
    },
    createStoreRuntimeConfig: async (storeContext: StoreContextEnvelope, inputValue: unknown) => {
        const authoritative = previewRuntimeContext.requirePreviewMissionAuthority(storeContext);
        const store = previewRuntimeContext.requirePreviewStore(authoritative.storeId);
        if (previewRuntimeContext.previewRuntimeConfigs.has(store.storeId))
            throw new Error('预览店铺已存在运行配置。');
        const input = previewInputRecord(inputValue, '店铺运行配置创建参数');
        const values = clonePreviewSnapshot(input.values as StoreRuntimeConfigValues);
        const occurredAt = new Date().toISOString();
        const current = previewRuntimeContext.buildPreviewRuntimeConfig(store, values, 1, 'active', occurredAt);
        const projection: StoreRuntimeConfigProjection = {
            current,
            versions: [{ revision: 1, action: 'create', occurredAt, snapshot: clonePreviewSnapshot(current) }],
        };
        previewRuntimeContext.previewRuntimeConfigs.set(store.storeId, projection);
        return clonePreviewSnapshot(projection);
    },
    updateStoreRuntimeConfig: async (storeContext: StoreContextEnvelope, inputValue: unknown) => {
        const authoritative = previewRuntimeContext.requirePreviewMissionAuthority(storeContext);
        const store = previewRuntimeContext.requirePreviewStore(authoritative.storeId);
        const projection = previewRuntimeContext.previewRuntimeConfigs.get(store.storeId);
        const input = previewInputRecord(inputValue, '店铺运行配置更新参数');
        if (!projection?.current)
            throw new Error('预览店铺还没有运行配置。');
        if (Number(input.expectedRevision) !== projection.current.revision)
            throw new Error('预览配置版本冲突，请刷新。');
        if (projection.current.status === 'archived')
            throw new Error('预览配置已归档，请先恢复。');
        const occurredAt = new Date().toISOString();
        const current = previewRuntimeContext.buildPreviewRuntimeConfig(store, { ...projection.current.values, ...(input.patch as Partial<StoreRuntimeConfigValues>) }, projection.current.revision + 1, 'active', occurredAt);
        const next: StoreRuntimeConfigProjection = {
            current,
            versions: [...projection.versions, {
                    revision: current.revision,
                    action: 'update',
                    occurredAt,
                    snapshot: clonePreviewSnapshot(current),
                }],
        };
        previewRuntimeContext.previewRuntimeConfigs.set(store.storeId, next);
        return clonePreviewSnapshot(next);
    },
    archiveStoreRuntimeConfig: async (storeContext: StoreContextEnvelope, inputValue: unknown) => {
        const authoritative = previewRuntimeContext.requirePreviewMissionAuthority(storeContext);
        const store = previewRuntimeContext.requirePreviewStore(authoritative.storeId);
        const projection = previewRuntimeContext.previewRuntimeConfigs.get(store.storeId);
        const input = previewInputRecord(inputValue, '店铺运行配置归档参数');
        if (!projection?.current)
            throw new Error('预览店铺还没有运行配置。');
        if (Number(input.expectedRevision) !== projection.current.revision)
            throw new Error('预览配置版本冲突，请刷新。');
        const occurredAt = new Date().toISOString();
        const current = previewRuntimeContext.buildPreviewRuntimeConfig(store, projection.current.values, projection.current.revision + 1, 'archived', occurredAt);
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
        previewRuntimeContext.previewRuntimeConfigs.set(store.storeId, next);
        return clonePreviewSnapshot(next);
    },
    restoreStoreRuntimeConfig: async (storeContext: StoreContextEnvelope, inputValue: unknown) => {
        const authoritative = previewRuntimeContext.requirePreviewMissionAuthority(storeContext);
        const store = previewRuntimeContext.requirePreviewStore(authoritative.storeId);
        const projection = previewRuntimeContext.previewRuntimeConfigs.get(store.storeId);
        const input = previewInputRecord(inputValue, '店铺运行配置恢复参数');
        if (!projection?.current)
            throw new Error('预览店铺还没有运行配置。');
        if (Number(input.expectedRevision) !== projection.current.revision)
            throw new Error('预览配置版本冲突，请刷新。');
        const occurredAt = new Date().toISOString();
        const current = previewRuntimeContext.buildPreviewRuntimeConfig(store, projection.current.values, projection.current.revision + 1, 'active', occurredAt);
        const next: StoreRuntimeConfigProjection = {
            current,
            versions: [...projection.versions, {
                    revision: current.revision,
                    action: 'restore',
                    occurredAt,
                    snapshot: clonePreviewSnapshot(current),
                }],
        };
        previewRuntimeContext.previewRuntimeConfigs.set(store.storeId, next);
        return clonePreviewSnapshot(next);
    },
    getBusinessUiDataPipeline: async () => {
        if (!previewRuntimeContext.activePreviewStoreId)
            return previewPipeline(previewRuntimeContext.scenario, previewRuntimeContext.fixtures);
        const store = previewRuntimeContext.requirePreviewStore(previewRuntimeContext.activePreviewStoreId);
        return applyPreviewStoreIdentity(previewPipeline(previewRuntimeContext.scenario, previewRuntimeContext.fixtures), previewStoreIdentity(store));
    },
    getBusinessBatchOptions: async () => {
        if (!previewRuntimeContext.activePreviewStoreId)
            return clonePreviewSnapshot(previewBatchOptions(previewRuntimeContext.scenario));
        const store = previewRuntimeContext.requirePreviewStore(previewRuntimeContext.activePreviewStoreId);
        return clonePreviewSnapshot(applyPreviewStoreIdentity(previewBatchOptions(previewRuntimeContext.scenario), previewStoreIdentity(store)));
    },
    lingxingCollectionJobsPreviewOnly: true,
    listLingxingCollectionJobs: async (input: {
        storeContext: StoreContextEnvelope;
    }) => {
        previewRuntimeContext.requirePreviewMissionAuthority(input?.storeContext);
        return [];
    },
    resumeLingxingCollection: async (input: {
        storeContext: StoreContextEnvelope;
    }) => {
        previewRuntimeContext.requirePreviewMissionAuthority(input?.storeContext);
        throw new Error('开发预览没有可恢复的真实领星任务；请在 Windows 桌面端使用持久化任务。');
    },
    cancelLingxingCollection: async (input: {
        storeContext: StoreContextEnvelope;
    }) => {
        previewRuntimeContext.requirePreviewMissionAuthority(input?.storeContext);
        throw new Error('开发预览没有可取消的真实领星任务；请在 Windows 桌面端操作真实任务。');
    },
    onLingxingCollectionProgress: () => () => undefined,
    listStoreProducts: async (storeContext: StoreContextEnvelope, input: unknown = {}) => products.listPreviewProducts(storeContext, input),
    getStoreProduct: async (storeContext: StoreContextEnvelope, input: unknown) => products.getPreviewProduct(storeContext, input),
    createStoreProduct: async (storeContext: StoreContextEnvelope, input: unknown) => products.createPreviewProduct(storeContext, input),
    updateStoreProduct: async (storeContext: StoreContextEnvelope, input: unknown) => products.updatePreviewProduct(storeContext, input),
    archiveStoreProduct: async (storeContext: StoreContextEnvelope, input: unknown) => products.archivePreviewProduct(storeContext, input),
    listStoreOperationEvents: async (storeContext: StoreContextEnvelope, input: unknown = {}) => events.listPreviewOperationEvents(storeContext, input),
    createStoreOperationEvent: async (storeContext: StoreContextEnvelope, input: unknown) => events.createPreviewOperationEvent(storeContext, input),
    updateStoreOperationEvent: async (storeContext: StoreContextEnvelope, input: unknown) => events.updatePreviewOperationEvent(storeContext, input),
    deleteStoreOperationEvent: async (storeContext: StoreContextEnvelope, input: unknown) => events.deletePreviewOperationEvent(storeContext, input),
    listStoreAdObjects: async (storeContext: StoreContextEnvelope, input: unknown = {}) => queries.listPreviewAdObjects(storeContext, input),
    listStoreKeywordFacts: async (storeContext: StoreContextEnvelope, input: unknown = {}) => queries.listPreviewKeywordFacts(storeContext, input),
    listStoreListingContent: async (storeContext: StoreContextEnvelope, input: unknown = {}) => listings.listPreviewListings(storeContext, input),
    getStoreListingContent: async (storeContext: StoreContextEnvelope, input: unknown) => listings.getPreviewListing(storeContext, input),
    createStoreListingContent: async (storeContext: StoreContextEnvelope, input: unknown) => listings.createPreviewListing(storeContext, input),
    updateStoreListingContent: async (storeContext: StoreContextEnvelope, input: unknown) => listings.updatePreviewListing(storeContext, input),
    deleteStoreListingContent: async (storeContext: StoreContextEnvelope, input: unknown) => listings.deletePreviewListing(storeContext, input),
    listStoreListingContentVersions: async (storeContext: StoreContextEnvelope, input: unknown = {}) => listings.listPreviewListingVersions(storeContext, input),
    getRecommendations: async (filter?: PreviewRecommendationFilter) => {
        const request = filter || {};
        const hasFullScope = Boolean(normalizedPreviewText(request.dateFrom)
            && normalizedPreviewText(request.dateTo)
            && normalizedPreviewText(request.storeName)
            && normalizedPreviewText(request.marketplaceCode));
        const scopeMatches = hasFullScope
            && normalizedPreviewText(request.dateFrom) === previewRuntimeContext.activePreviewScope.dateFrom
            && normalizedPreviewText(request.dateTo) === previewRuntimeContext.activePreviewScope.dateTo
            && normalizedPreviewText(request.storeName) === previewRuntimeContext.activePreviewScope.storeName
            && normalizedPreviewText(request.marketplaceCode) === previewRuntimeContext.activePreviewScope.marketplaceCode
            && (!normalizedPreviewText(request.asin)
                || normalizedPreviewText(request.asin).toUpperCase() === previewRuntimeContext.activePreviewScope.asin)
            && (!normalizedPreviewText(request.batchId)
                || normalizedPreviewText(request.batchId) === previewRuntimeContext.activePreviewScope.batchId);
        if (!scopeMatches)
            return [];
        const status = normalizedPreviewText(request.status);
        const limit = Number.isFinite(Number(request.limit))
            ? Math.max(1, Math.min(500, Number(request.limit)))
            : 100;
        const scopedRows = previewRuntimeContext.recommendations.filter((recommendation) => (recommendation.storeName === previewRuntimeContext.activePreviewScope.storeName
            && recommendation.marketplaceCode === previewRuntimeContext.activePreviewScope.marketplaceCode
            && recommendation.asin === previewRuntimeContext.activePreviewScope.asin
            && recommendation.evidence?.batchId === previewRuntimeContext.activePreviewScope.batchId
            && (!status || recommendation.status === status)));
        return clonePreviewSnapshot(scopedRows.slice(0, limit));
    },
    generateRecommendations: async () => clonePreviewSnapshot({
        generated: previewRuntimeContext.recommendations.length,
        recommendations: previewRuntimeContext.recommendations,
    }),
    resolveRecommendationReview: async (input: ResolveRecommendationReviewRequest): Promise<ResolveRecommendationReviewResult> => {
        const recommendation = previewRuntimeContext.recommendations.find((row) => row.id === input.recommendationId);
        if (!recommendation)
            throw new Error('预览复核被阻断：建议不存在，请刷新后重试。');
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
        const scopeMatches = normalized(scope?.dateFrom) === previewRuntimeContext.activePreviewScope.dateFrom
            && normalized(scope?.dateTo) === previewRuntimeContext.activePreviewScope.dateTo
            && normalized(scope?.storeName) === previewRuntimeContext.activePreviewScope.storeName
            && normalized(scope?.marketplaceCode) === previewRuntimeContext.activePreviewScope.marketplaceCode
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
    bindRecommendationWritableTarget: async (input: BindRecommendationWritableTargetRequest): Promise<BindRecommendationWritableTargetResult> => {
        const recommendation = previewRuntimeContext.recommendations.find((row) => row.id === input.recommendationId);
        if (!recommendation)
            throw new Error('预览 Ads 对象核验被阻断：建议不存在，请刷新后重试。');
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
        const scopeMatches = normalized(scope?.dateFrom) === previewRuntimeContext.activePreviewScope.dateFrom
            && normalized(scope?.dateTo) === previewRuntimeContext.activePreviewScope.dateTo
            && normalized(scope?.storeName) === previewRuntimeContext.activePreviewScope.storeName
            && normalized(scope?.marketplaceCode) === previewRuntimeContext.activePreviewScope.marketplaceCode
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
            status: 'verified',
            revision: recommendation.revision,
            boundAt,
        });
    },
    approveRecommendation: async (input: {
        id: number;
        expectedRevision: number;
        decision?: {
            approvedBy?: string;
            note?: string;
        };
    }) => {
        const recommendation = previewRuntimeContext.recommendations.find((row) => row.id === input.id);
        if (!recommendation)
            throw new Error('预览建议不存在，请刷新后重试。');
        assertRecommendationDecisionRevision(recommendation, input.expectedRevision);
        applyPreviewRecommendationDecision(recommendation, 'approved', input.decision || {});
        return { ok: true };
    },
    rejectRecommendation: async (input: {
        id: number;
        expectedRevision: number;
        decision?: {
            rejectedBy?: string;
            note?: string;
        };
    }) => {
        const recommendation = previewRuntimeContext.recommendations.find((row) => row.id === input.id);
        if (!recommendation)
            throw new Error('预览建议不存在，请刷新后重试。');
        assertRecommendationDecisionRevision(recommendation, input.expectedRevision);
        applyPreviewRecommendationDecision(recommendation, 'rejected', input.decision || {});
        return { ok: true };
    },
    getRuleConfig: async () => ({ targetAcos: 0.35, highAcosThreshold: 0.4, minSpend: 10, noOrderClickThreshold: 30 }),
    getSettings: async () => ({
        ai: { provider: 'deepseek', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com' },
        aiKeyConfigured: previewRuntimeContext.readbackStagePreview,
        aiBaseUrl: 'https://api.deepseek.com',
        aiProvider: 'deepseek',
        aiModel: 'deepseek-v4-flash',
        aiLastTestBaseUrl: previewRuntimeContext.readbackStagePreview ? 'https://api.deepseek.com' : '',
        aiLastTestModel: previewRuntimeContext.readbackStagePreview ? 'deepseek-v4-flash' : '',
        aiLastTestStatus: previewRuntimeContext.readbackStagePreview ? 'available' : 'untested',
    }),
    listAiDiagnosisRuns: async () => clonePreviewSnapshot(previewRuntimeContext.previewAiDiagnosisRuns),
    getDeliveryReadiness: async () => ({
        available: previewRuntimeContext.scenario.deliveryReady,
        path: null,
        exists: false,
        status: previewRuntimeContext.scenario.deliveryReady ? 'PREVIEW_ONLY_READY' : 'PREVIEW_ONLY_BLOCKED',
        appReady: false,
        manifestDriven: false,
        previewOnly: true,
        previewReady: previewRuntimeContext.scenario.deliveryReady,
        previewScenarioId: previewRuntimeContext.scenario.id,
        gates: clonePreviewSnapshot(previewRuntimeContext.previewGates),
        gatesSummary: {
            total: previewRuntimeContext.previewGates.length,
            passed: previewRuntimeContext.previewPassedGateCount,
            failed: previewRuntimeContext.previewGates.length - previewRuntimeContext.previewPassedGateCount,
        },
        missing: previewRuntimeContext.scenario.deliveryReady
            ? ['真实交付仍需当前 Windows 包、真实 Ads 回读、manifest 与安全门。']
            : [previewRuntimeContext.firstMissingPreviewGate?.message || '开发预览页面流程尚未走通。'],
        actionItems: previewRuntimeContext.scenario.deliveryReady
            ? ['退出开发预览后运行真实最终验收。']
            : [`先补齐${previewRuntimeContext.firstMissingPreviewGate?.name || '当前预览步骤'}。`],
        message: previewRuntimeContext.scenario.deliveryReady
            ? '仅开发预览已走通；不可视为 APP_READY。'
            : '开发预览场景尚未走通；不可视为 APP_READY。',
    }),
    getDeliveryEvidenceStatus: async () => ({
        listing: {
            readReady: previewRuntimeContext.readbackStagePreview,
            draftReady: previewRuntimeContext.readbackStagePreview,
            contentCount: previewRuntimeContext.readbackStagePreview ? 1 : 0,
            fullContentCount: previewRuntimeContext.readbackStagePreview ? 1 : 0,
            draftCount: previewRuntimeContext.readbackStagePreview ? 1 : 0,
            aiDraftCount: previewRuntimeContext.readbackStagePreview ? 1 : 0,
            ruleFallbackDraftCount: 0,
        },
        readback: {
            verifiedCount: previewRuntimeContext.scenario.readbackEvidenceReady ? 1 : 0,
            latestStatus: previewRuntimeContext.scenario.readbackEvidenceReady ? 'preview-only-verified' : 'preview-only-missing',
        },
        package: {
            installerAvailable: false,
        },
        preview: {
            previewOnly: true,
            scenarioId: previewRuntimeContext.scenario.id,
            workflowComplete: previewRuntimeContext.scenario.deliveryReady,
            message: previewRuntimeContext.scenario.deliveryReady
                ? '仅开发预览已走通；不可视为 APP_READY。'
                : '开发预览场景尚未走通；不可视为 APP_READY。',
        },
    }),
    getStoreCollectionSchedule: async (storeContext: StoreContextEnvelope) => clonePreviewSnapshot(previewRuntimeContext.previewScheduleProjection(storeContext)),
    runStoreCollectionScheduleNow: async (storeContext: StoreContextEnvelope): Promise<StoreCollectionScheduleRunResult> => {
        const authoritative = previewRuntimeContext.requirePreviewMissionAuthority(storeContext);
        const current = previewRuntimeContext.previewScheduleProjection(authoritative);
        if (current.state === 'succeeded' || current.state === 'failed' || current.state === 'claimed') {
            return clonePreviewSnapshot({
                accepted: false,
                duplicate: true,
                projection: current,
            });
        }
        previewRuntimeContext.previewScheduleStates.set(authoritative.storeId, 'succeeded');
        return clonePreviewSnapshot({
            accepted: true,
            duplicate: false,
            projection: previewRuntimeContext.previewScheduleProjection(authoritative),
        });
    },
    previewStoreEvidenceRetention: async (storeContext: StoreContextEnvelope) => clonePreviewSnapshot(previewRuntimeContext.previewRetentionManifest(storeContext)),
    openReportArtifact: async (artifactId: string, storeContext: StoreContextEnvelope) => {
        previewRuntimeContext.requirePreviewMissionAuthority(storeContext);
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
