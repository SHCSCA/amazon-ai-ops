// 历史预览纯夹具测试保留原有启用限制与完整断言。
import { LegacyAdapterBoundary, MISSION_CONTROL_LEGACY_ROUTE_IDS, createElement, describe, expect, it, renderToStaticMarkup, resolveLegacyCapability } from './dev-preview-test-environment';
import { LEGACY_PREVIEW_ROUTE_CASES, previewExports } from './dev-preview-test-fixture';
describe('Mission Control development preview bridge', () => {
    it('starts with exactly two isolated US/USD fixture stores and requires an explicit switch', async () => {
        const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
        const stores = await api.listStores({ includeArchived: true });
        expect(stores).toHaveLength(2);
        expect(stores.every((store: any) => store.marketplace === 'US' && store.currency === 'USD')).toBe(true);
        expect(new Set(stores.map((store: any) => store.storeId)).size).toBe(2);
        expect(new Set(stores.map((store: any) => store.browserProfileId)).size).toBe(2);
        expect(await api.getActiveStoreContext()).toBeNull();
        expect(await api.getActiveStoreWorkspaceView()).toBeNull();
        await expect(api.missionControl.query({
            query: 'workspace-bootstrap', requestId: 'before-switch', contextEpoch: 0,
            context: {
                storeId: stores[0].storeId,
                browserProfileId: stores[0].browserProfileId,
                marketplace: 'US', currency: 'USD', businessTimezone: stores[0].businessTimezone,
                businessDate: '2026-07-22', sessionGeneration: 0,
            },
        })).rejects.toThrow('PREVIEW_EXPLICIT_STORE_SELECTION_REQUIRED');
    });
    it('publishes explicit store switches and returns preview-only capabilities without secrets or paths', async () => {
        const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
        const stores = await api.listStores();
        const contexts: any[] = [];
        const unsubscribe = api.onStoreContextChanged((view: any) => contexts.push(view.context));
        const view = await api.switchStore({ storeId: stores[0].storeId, marketplace: stores[0].marketplace });
        const response = await api.missionControl.query({
            query: 'workspace-bootstrap', requestId: 'preview-query', contextEpoch: 7, context: view.context,
        });
        unsubscribe();
        expect(contexts).toHaveLength(1);
        expect(response).toEqual(expect.objectContaining({
            requestId: 'preview-query',
            contextEpoch: 7,
            authoritativeContext: view.context,
        }));
        expect(response.data.capabilities.length).toBeGreaterThan(22);
        expect(response.data.capabilities.every((row: any) => (row.state === 'PROTOTYPE_ONLY' && row.blockerCode === 'DEV_PREVIEW_ONLY'))).toBe(true);
        expect(response.data.capabilities.find((row: any) => row.capabilityId === 'decisions.grants.issue')?.view)
            .toBe('decisions/decided');
        expect(response.data.capabilities.find((row: any) => row.capabilityId === 'decisions.grants.revoke')?.view)
            .toBe('decisions/decided');
        expect(response.data.capabilities.find((row: any) => row.capabilityId === 'execution.queue.cancel'))
            .toEqual(expect.objectContaining({ view: 'execution/live', action: 'cancel', state: 'PROTOTYPE_ONLY' }));
        const serialized = JSON.stringify(response);
        expect(serialized).not.toMatch(/password|cookie|token|apiKey|filePath|profilePath/i);
        expect(serialized).not.toMatch(/[A-Za-z]:[\\/]/);
    });
    it('simulates a visible store connection binding without accepting secrets or creating duplicates', async () => {
        const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
        const [store] = await api.listStores();
        const switched = await api.switchStore({ storeId: store.storeId, marketplace: store.marketplace });
        expect(switched.connections).toEqual([]);
        const first = await api.createStoreConnection({
            storeId: store.storeId,
            provider: 'lingxing',
            accountLabel: 'preview-operator',
            collectionStoreName: 'Preview Download Store',
            password: 'must-not-cross-preview-boundary',
            token: 'must-not-cross-preview-boundary',
        } as any);
        const repeated = await api.createStoreConnection({
            storeId: store.storeId,
            provider: 'lingxing',
            accountLabel: 'different-label-does-not-create-a-duplicate',
        });
        const active = await api.getActiveStoreWorkspaceView();
        expect(repeated.id).toBe(first.id);
        expect(active).toEqual(expect.objectContaining({
            store: expect.objectContaining({ storeId: store.storeId, marketplace: 'US', currency: 'USD' }),
            connections: [expect.objectContaining({
                    id: first.id,
                    provider: 'lingxing',
                    accountLabel: 'preview-operator',
                    collectionStoreName: 'Preview Download Store',
                    status: 'not_configured',
                })],
        }));
        expect(first.externalAccountId).toBeUndefined();
        expect(JSON.stringify({ first, active })).not.toMatch(/password|token|cookie|profilePath|userDataDir/i);
        const updated = await api.updateStoreConnection({
            id: first.id,
            storeId: store.storeId,
            expectedUpdatedAt: first.updatedAt,
            accountLabel: 'preview-operator-updated',
            collectionStoreName: 'Preview Download Store Updated',
            password: 'must-not-cross-preview-boundary',
        } as any);
        const updatedView = await api.getActiveStoreWorkspaceView();
        expect(updated).toEqual(expect.objectContaining({
            id: first.id,
            accountLabel: 'preview-operator-updated',
        }));
        expect(updatedView?.connections).toEqual([
            expect.objectContaining({
                id: first.id,
                accountLabel: 'preview-operator-updated',
                collectionStoreName: 'Preview Download Store Updated',
                status: 'not_configured',
                lastFailureCode: 'connection_identity_changed',
            }),
        ]);
        expect(updated.externalAccountId).toBeUndefined();
        expect(updated.session).toBeUndefined();
        expect(JSON.stringify({ updated, updatedView })).not.toMatch(/password|token|cookie|profilePath|userDataDir/i);
        const loginView = await api.getActiveStoreWorkspaceView();
        const login = await api.browserLogin({
            credentialSource: 'typed',
            password: 'must-not-cross-preview-boundary',
            rememberPassword: false,
            storeContext: loginView!.context,
            username: 'preview-operator-updated',
        });
        const enrolledView = await api.getActiveStoreWorkspaceView();
        const enrolled = enrolledView!.connections.find((connection: any) => connection.provider === 'lingxing');
        expect(enrolled).toEqual(expect.objectContaining({
            collectionStoreName: 'Preview Download Store Updated',
            externalAccountId: expect.stringContaining('DEV-PREVIEW-STABLE-'),
        }));
        expect(login).toEqual(expect.objectContaining({
            sessionIdentityVerified: false,
            adsSessionReady: false,
            adsUnavailableReason: expect.stringContaining('不代表真实'),
            adsIdentityCandidate: expect.objectContaining({
                confirmationToken: expect.any(String),
                detectedExternalAccountId: expect.any(String),
            }),
        }));
        const confirmationView = await api.getActiveStoreWorkspaceView();
        const confirmed = await api.confirmBrowserLoginAdsIdentity({
            confirmationToken: login.adsIdentityCandidate!.confirmationToken,
            storeContext: confirmationView!.context,
        });
        expect(confirmed).toEqual(expect.objectContaining({ adsSessionReady: true }));
        const confirmedView = await api.getActiveStoreWorkspaceView();
        const ads = confirmedView!.connections.find((connection: any) => connection.provider === 'amazon_ads')!;
        await expect(api.removeStoreConnection({
            id: ads.id,
            storeId: store.storeId,
            expectedUpdatedAt: 'stale-revision',
        })).rejects.toThrow('PREVIEW_STORE_CONNECTION_CONFLICT');
        await expect(api.removeStoreConnection({
            id: ads.id,
            storeId: store.storeId,
            expectedUpdatedAt: ads.updatedAt,
        })).resolves.toEqual({ success: true });
    });
    it('marks every store-scoped object preview capability as prototype-only', async () => {
        const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
        const [store] = await api.listStores();
        const view = await api.switchStore({ storeId: store.storeId, marketplace: store.marketplace });
        const response = await api.missionControl.query({
            query: 'workspace-bootstrap', requestId: 'preview-object-capabilities', contextEpoch: 1, context: view.context,
        });
        const expected = [
            'today.events.view',
            'today.events.create',
            'today.events.update',
            'today.events.archive',
            'today.events.restore',
            'objects.products.view',
            'objects.products.create',
            'objects.products.update',
            'objects.products.archive',
            'objects.events.view',
            'objects.events.create',
            'objects.events.update',
            'objects.events.delete',
            'objects.targets.view',
            'objects.keywords.view',
            'objects.listing.view',
            'objects.listing.create',
            'objects.listing.update',
            'objects.listing.delete',
        ];
        const capabilities = new Map(response.data.capabilities.map((capability: any) => [capability.capabilityId, capability]));
        expect(api.storeScopedObjectsPreviewOnly).toBe(true);
        expect(api.storeScopedAdListingPreviewOnly).toBe(true);
        for (const capabilityId of expected) {
            expect(capabilities.get(capabilityId)).toEqual(expect.objectContaining({
                capabilityId,
                blockerCode: 'DEV_PREVIEW_ONLY',
                state: 'PROTOTYPE_ONLY',
            }));
        }
    });
    it('keeps versioned product CRUD isolated by the complete active StoreContext', async () => {
        const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
        const stores = await api.listStores();
        const firstView = await api.switchStore({ storeId: stores[0].storeId, marketplace: stores[0].marketplace });
        const first = await api.createStoreProduct(firstView.context, {
            asin: 'B0PREVIEW9',
            title: 'First preview store product',
            marketplace: 'US',
            currency: 'USD',
            cost: { currentPrice: 39.99, purchaseCost: 8.5, targetAcos: 0.3 },
        });
        expect(first).toEqual(expect.objectContaining({
            storeId: stores[0].storeId,
            store_name: stores[0].displayName,
            marketplace_code: 'US',
            asin: 'B0PREVIEW9',
            title: 'First preview store product',
            status: 'active',
            revision: expect.stringMatching(/^product-v1:[a-f0-9]{64}$/),
            cost: expect.objectContaining({ currentPrice: 39.99, purchaseCost: 8.5, targetAcos: 0.3 }),
        }));
        const secondView = await api.switchStore({ storeId: stores[1].storeId, marketplace: stores[1].marketplace });
        const second = await api.createStoreProduct(secondView.context, {
            asin: 'B0PREVIEW9',
            title: 'Second preview store product',
        });
        expect(second).toEqual(expect.objectContaining({
            storeId: stores[1].storeId,
            asin: 'B0PREVIEW9',
            title: 'Second preview store product',
        }));
        expect(second.id).not.toBe(first.id);
        expect(await api.listStoreProducts(secondView.context)).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: second.id, storeId: stores[1].storeId }),
        ]));
        expect((await api.listStoreProducts(secondView.context)).some((row: any) => row.id === first.id)).toBe(false);
        await expect(api.listStoreProducts(firstView.context)).rejects.toThrow('PREVIEW_MISSION_CONTROL_STORE_CONTEXT_MISMATCH');
        const refreshedFirst = await api.switchStore({ storeId: stores[0].storeId, marketplace: stores[0].marketplace });
        const current = (await api.listStoreProducts(refreshedFirst.context, { includeArchived: true }))
            .find((row: any) => row.id === first.id);
        const updated = await api.updateStoreProduct(refreshedFirst.context, {
            id: current.id,
            expectedRevision: current.revision,
            patch: { title: 'First product updated', marketplace: 'US', currency: 'USD' },
            cost: { currentPrice: 42.5 },
        });
        expect(updated).toEqual(expect.objectContaining({
            id: first.id,
            title: 'First product updated',
            cost: expect.objectContaining({ currentPrice: 42.5, purchaseCost: 8.5 }),
        }));
        expect(updated.revision).not.toBe(current.revision);
        await expect(api.updateStoreProduct(refreshedFirst.context, {
            id: first.id,
            expectedRevision: current.revision,
            patch: { title: 'Stale overwrite' },
        })).rejects.toThrow(/revision|版本|冲突/i);
        const archived = await api.archiveStoreProduct(refreshedFirst.context, {
            id: first.id,
            expectedRevision: updated.revision,
        });
        expect(archived.status).toBe('archived');
        expect((await api.listStoreProducts(refreshedFirst.context)).some((row: any) => row.id === first.id)).toBe(false);
        expect(await api.getStoreProduct(refreshedFirst.context, { id: first.id })).toEqual(expect.objectContaining({ id: first.id, status: 'archived' }));
    });
    it('supports store-owned operation-event CRUD with revision CAS', async () => {
        const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
        const stores = await api.listStores();
        const firstView = await api.switchStore({ storeId: stores[0].storeId, marketplace: stores[0].marketplace });
        const created = await api.createStoreOperationEvent(firstView.context, {
            eventDate: firstView.context.businessDate,
            eventType: 'coupon',
            title: 'Preview coupon launched',
            asin: 'B0EVENT001',
            impactExpectation: 'conversion_up',
            notes: 'Track this store only.',
            marketplace: 'US',
            currency: 'USD',
        });
        expect(created).toEqual(expect.objectContaining({
            storeId: stores[0].storeId,
            storeName: stores[0].displayName,
            marketplaceCode: 'US',
            eventDate: firstView.context.businessDate,
            title: 'Preview coupon launched',
            archiveRevision: 0,
            revision: expect.stringMatching(/^operation-event-v1:[a-f0-9]{64}$/),
        }));
        const updated = await api.updateStoreOperationEvent(firstView.context, {
            id: created.id,
            expectedRevision: created.revision,
            patch: { title: 'Preview coupon reviewed', notes: 'Keep observing ACOS.' },
        });
        expect(updated.title).toBe('Preview coupon reviewed');
        expect(updated.revision).not.toBe(created.revision);
        await expect(api.deleteStoreOperationEvent(firstView.context, {
            id: created.id,
            expectedRevision: created.revision,
        })).rejects.toThrow(/revision|版本|冲突/i);
        expect(await api.listStoreOperationEvents(firstView.context, {
            asin: 'b0event001', dateFrom: '2026-07-01', dateTo: '2026-07-31', limit: 20,
        })).toEqual([expect.objectContaining({ id: created.id, title: 'Preview coupon reviewed' })]);
        const secondView = await api.switchStore({ storeId: stores[1].storeId, marketplace: stores[1].marketplace });
        expect((await api.listStoreOperationEvents(secondView.context, { limit: 200 }))
            .some((row: any) => row.id === created.id)).toBe(false);
        const refreshedFirst = await api.switchStore({ storeId: stores[0].storeId, marketplace: stores[0].marketplace });
        const archived = await api.deleteStoreOperationEvent(refreshedFirst.context, {
            id: updated.id,
            expectedRevision: updated.revision,
        });
        expect(archived).toEqual(expect.objectContaining({
            id: updated.id,
            archivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
            archiveRevision: 1,
            revision: expect.stringMatching(/^operation-event-v1:[a-f0-9]{64}$/),
        }));
        expect(archived.revision).not.toBe(updated.revision);
        expect((await api.listStoreOperationEvents(refreshedFirst.context, { limit: 200 }))
            .some((row: any) => row.id === updated.id)).toBe(false);
        expect(await api.listStoreOperationEvents(refreshedFirst.context, {
            includeArchived: true,
            limit: 200,
        })).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: updated.id, archiveRevision: 1 }),
        ]));
        await expect(api.listStoreOperationEvents(refreshedFirst.context, {
            includeArchived: 'yes',
        })).rejects.toThrow(/includeArchived/);
        await expect(api.updateStoreOperationEvent(refreshedFirst.context, {
            id: updated.id,
            expectedRevision: archived.revision,
            patch: { title: 'Archived overwrite' },
        })).rejects.toThrow(/归档|只读|恢复/);
        await expect(api.updateStoreOperationEvent(refreshedFirst.context, {
            id: updated.id,
            expectedRevision: archived.revision,
            patch: { archived: false, title: 'Restore and overwrite' },
        })).rejects.toThrow(/拆分|恢复/);
        const restored = await api.updateStoreOperationEvent(refreshedFirst.context, {
            id: updated.id,
            expectedRevision: archived.revision,
            patch: { archived: false },
        });
        expect(restored).toEqual(expect.objectContaining({
            id: updated.id,
            archiveRevision: 2,
            title: 'Preview coupon reviewed',
        }));
        expect(restored.archivedAt).toBeUndefined();
        expect(restored.revision).not.toBe(archived.revision);
        expect((await api.listStoreOperationEvents(refreshedFirst.context, { limit: 200 }))
            .some((row: any) => row.id === updated.id)).toBe(true);
    });
    it('projects store-isolated US/USD advertising objects and keyword facts', async () => {
        const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
        const stores = await api.listStores();
        const firstView = await api.switchStore({ storeId: stores[0].storeId, marketplace: stores[0].marketplace });
        const firstByKind = await Promise.all(['campaign', 'ad_group', 'target', 'search_term'].map((kind) => (api.listStoreAdObjects(firstView.context, { kind, limit: 20 }))));
        expect(firstByKind.every((rows) => rows.length > 0)).toBe(true);
        expect(firstByKind.flat().every((row: any) => (row.storeId === stores[0].storeId && row.marketplace === 'US' && row.currency === 'USD'))).toBe(true);
        const firstTarget = firstByKind[2][0];
        expect(await api.listStoreAdObjects(firstView.context, {
            kind: 'target', asin: firstTarget.asin, query: firstTarget.name, limit: 5,
        })).toEqual([expect.objectContaining({ objectKey: firstTarget.objectKey })]);
        const firstKeywords = await api.listStoreKeywordFacts(firstView.context, { limit: 20 });
        expect(firstKeywords.length).toBeGreaterThan(0);
        expect(firstKeywords.every((row: any) => (row.storeId === stores[0].storeId && row.marketplace === 'US' && row.currency === 'USD'))).toBe(true);
        expect(await api.listStoreKeywordFacts(firstView.context, {
            asin: firstKeywords[0].asin, query: firstKeywords[0].keyword, limit: 5,
        })).toEqual([expect.objectContaining({ keyword: firstKeywords[0].keyword })]);
        const secondView = await api.switchStore({ storeId: stores[1].storeId, marketplace: stores[1].marketplace });
        const secondTargets = await api.listStoreAdObjects(secondView.context, { kind: 'target', limit: 20 });
        const secondKeywords = await api.listStoreKeywordFacts(secondView.context, { limit: 20 });
        expect(secondTargets.every((row: any) => row.storeId === stores[1].storeId)).toBe(true);
        expect(secondKeywords.every((row: any) => row.storeId === stores[1].storeId)).toBe(true);
        expect(JSON.stringify({ secondTargets, secondKeywords })).not.toContain(firstTarget.asin);
        expect(JSON.stringify({ secondTargets, secondKeywords })).not.toContain(String(stores[0].storeId));
    });
    it('keeps Listing CRUD and durable versions isolated with revision CAS', async () => {
        const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
        const stores = await api.listStores();
        const firstView = await api.switchStore({ storeId: stores[0].storeId, marketplace: stores[0].marketplace });
        const first = await api.createStoreListingContent(firstView.context, {
            asin: 'B0LISTP009',
            title: 'First store preview Listing',
            bullets: ['First bullet', 'Second bullet'],
            description: 'Store-owned description',
            backendTerms: 'preview listing',
            source: 'manual',
            versionLabel: 'v1',
            changeSummary: 'Created in DEV preview',
            marketplace: 'US',
            currency: 'USD',
        });
        expect(first).toEqual(expect.objectContaining({
            storeId: stores[0].storeId,
            storeName: stores[0].displayName,
            marketplace: 'US',
            currency: 'USD',
            asin: 'B0LISTP009',
            title: 'First store preview Listing',
            bullets: ['First bullet', 'Second bullet'],
            revision: expect.stringMatching(/^listing-content-v1:[a-f0-9]{64}$/),
        }));
        expect(await api.getStoreListingContent(firstView.context, { asin: 'b0listp009' }))
            .toEqual(expect.objectContaining({ id: first.id, storeId: stores[0].storeId }));
        expect(await api.listStoreListingContentVersions(firstView.context, {
            listingContentId: first.id, limit: 20,
        })).toEqual([expect.objectContaining({
                listingContentId: first.id,
                storeId: stores[0].storeId,
                asin: 'B0LISTP009',
                title: 'First store preview Listing',
            })]);
        const secondView = await api.switchStore({ storeId: stores[1].storeId, marketplace: stores[1].marketplace });
        const second = await api.createStoreListingContent(secondView.context, {
            asin: 'B0LISTP009', title: 'Second store preview Listing',
        });
        expect(second.storeId).toBe(stores[1].storeId);
        expect(second.id).not.toBe(first.id);
        expect((await api.listStoreListingContent(secondView.context, { limit: 250 }))
            .some((row: any) => row.id === first.id)).toBe(false);
        const refreshedFirst = await api.switchStore({ storeId: stores[0].storeId, marketplace: stores[0].marketplace });
        const current = await api.getStoreListingContent(refreshedFirst.context, { id: first.id });
        const updated = await api.updateStoreListingContent(refreshedFirst.context, {
            id: current.id,
            expectedRevision: current.revision,
            patch: {
                title: 'First store Listing updated',
                bullets: ['Updated bullet'],
                versionLabel: 'v2',
                changeSummary: 'Reviewed in DEV preview',
                marketplace: 'US',
                currency: 'USD',
            },
        });
        expect(updated.title).toBe('First store Listing updated');
        expect(updated.revision).not.toBe(current.revision);
        await expect(api.updateStoreListingContent(refreshedFirst.context, {
            id: first.id,
            expectedRevision: current.revision,
            patch: { title: 'Stale Listing overwrite' },
        })).rejects.toThrow(/revision|版本|冲突/i);
        expect(await api.listStoreListingContentVersions(refreshedFirst.context, {
            listingContentId: first.id, limit: 20,
        })).toHaveLength(2);
        expect(await api.deleteStoreListingContent(refreshedFirst.context, {
            id: first.id,
            expectedRevision: updated.revision,
        })).toEqual({ id: first.id, deleted: true });
        expect((await api.listStoreListingContent(refreshedFirst.context, { limit: 250 }))
            .some((row: any) => row.id === first.id)).toBe(false);
        expect(await api.listStoreListingContentVersions(refreshedFirst.context, {
            listingContentId: first.id, limit: 20,
        })).toHaveLength(2);
        const deletedHistoryInStoreLedger = await api.listStoreListingContentVersions(refreshedFirst.context, { limit: 100, offset: 0 });
        expect(deletedHistoryInStoreLedger.filter((row: any) => row.listingContentId === first.id))
            .toHaveLength(2);
        expect(deletedHistoryInStoreLedger.every((row: any) => row.storeId === stores[0].storeId))
            .toBe(true);
        const [ledgerPageOne, ledgerPageTwo] = await Promise.all([
            api.listStoreListingContentVersions(refreshedFirst.context, { limit: 1, offset: 0 }),
            api.listStoreListingContentVersions(refreshedFirst.context, { limit: 1, offset: 1 }),
        ]);
        expect(ledgerPageOne).toHaveLength(1);
        expect(ledgerPageTwo).toHaveLength(1);
        expect(ledgerPageTwo[0].id).not.toBe(ledgerPageOne[0].id);
    });
    it('exposes a clearly marked empty collection-job bridge without inventing production records', async () => {
        const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
        const [store] = await api.listStores();
        const view = await api.switchStore({ storeId: store.storeId, marketplace: store.marketplace });
        expect(api.lingxingCollectionJobsPreviewOnly).toBe(true);
        expect(await api.listLingxingCollectionJobs({ storeContext: view.context, limit: 12 })).toEqual([]);
        await expect(api.resumeLingxingCollection({
            storeContext: view.context,
            jobId: 'preview-job-does-not-exist',
            requestId: 'lx:preview-resume',
        })).rejects.toThrow('开发预览没有可恢复的真实领星任务');
        await expect(api.cancelLingxingCollection({
            storeContext: view.context,
            jobId: 'preview-job-does-not-exist',
            requestId: 'lx:preview-cancel',
        })).rejects.toThrow('开发预览没有可取消的真实领星任务');
        expect(api.onLingxingCollectionProgress(() => undefined)()).toBeUndefined();
    });
    it('keeps canonical preview facts isolated when the authoritative store changes', async () => {
        const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
        const stores = await api.listStores();
        const firstView = await api.switchStore({ storeId: stores[0].storeId, marketplace: stores[0].marketplace });
        const firstScope = await api.getOperationScope(firstView.context);
        const firstProducts = await api.listStoreProducts(firstView.context);
        const firstPipeline = await api.getBusinessUiDataPipeline();
        const secondView = await api.switchStore({ storeId: stores[1].storeId, marketplace: stores[1].marketplace });
        const secondScope = await api.getOperationScope(secondView.context);
        const secondProducts = await api.listStoreProducts(secondView.context);
        const secondPipeline = await api.getBusinessUiDataPipeline();
        expect(firstScope).toEqual(expect.objectContaining({ storeName: 'SHC001-US', currency: 'USD' }));
        expect(secondScope).toEqual(expect.objectContaining({ storeName: 'SHC002-US', currency: 'USD' }));
        expect(secondScope.storeName).not.toBe(firstScope.storeName);
        expect(secondScope.asin).not.toBe(firstScope.asin);
        expect(secondScope.batchId).not.toBe(firstScope.batchId);
        expect(secondProducts[0].asin).not.toBe(firstProducts[0].asin);
        expect(secondProducts.every((product: any) => product.store_name === stores[1].displayName)).toBe(true);
        expect(firstPipeline.scope.storeName).toBe(firstScope.storeName);
        expect(secondPipeline.scope.storeName).toBe(secondScope.storeName);
        expect(JSON.stringify(secondPipeline)).not.toContain(firstScope.storeName);
        expect(JSON.stringify(secondPipeline)).not.toContain('D:/preview/shc002/shc002/');
        const refreshedFirst = await api.switchStore({ storeId: stores[0].storeId, marketplace: stores[0].marketplace });
        expect(await api.getOperationScope(refreshedFirst.context)).toEqual(firstScope);
        expect((await api.listStoreProducts(refreshedFirst.context))[0].asin).toBe(firstProducts[0].asin);
    });
    it('keeps two store automation previews independent, explicit, and path-free', async () => {
        const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
        const stores = await api.listStores();
        const firstView = await api.switchStore({ storeId: stores[0].storeId, marketplace: stores[0].marketplace });
        const firstSchedule = await api.getStoreCollectionSchedule(firstView.context);
        const firstRetention = await api.previewStoreEvidenceRetention(firstView.context);
        expect(firstSchedule).toMatchObject({
            storeId: stores[0].storeId,
            state: 'waiting',
            previewOnly: true,
            authorityState: 'PROTOTYPE_ONLY',
        });
        expect(firstRetention).toMatchObject({
            storeId: String(stores[0].storeId),
            mode: 'dry-run',
            deletionSupported: false,
            applyable: false,
            scanSafe: true,
            previewOnly: true,
            authorityState: 'PROTOTYPE_ONLY',
            blockers: [],
        });
        const firstRun = await api.runStoreCollectionScheduleNow(firstView.context);
        expect(firstRun).toMatchObject({
            accepted: true,
            duplicate: false,
            projection: { storeId: stores[0].storeId, state: 'succeeded' },
        });
        const secondView = await api.switchStore({ storeId: stores[1].storeId, marketplace: stores[1].marketplace });
        const secondSchedule = await api.getStoreCollectionSchedule(secondView.context);
        const secondRetention = await api.previewStoreEvidenceRetention(secondView.context);
        expect(secondSchedule).toMatchObject({
            storeId: stores[1].storeId,
            state: 'failed',
            detail: expect.stringMatching(/失败关闭.*不会自动重试/),
            previewOnly: true,
            authorityState: 'PROTOTYPE_ONLY',
        });
        expect(await api.runStoreCollectionScheduleNow(secondView.context)).toMatchObject({
            accepted: false,
            duplicate: true,
            projection: { storeId: stores[1].storeId, state: 'failed' },
        });
        expect(secondRetention).toMatchObject({
            storeId: String(stores[1].storeId),
            deletionSupported: false,
            applyable: false,
            scanSafe: false,
            blockers: [expect.objectContaining({ code: 'UNSAFE_LINK_OR_REPARSE_POINT' })],
            authorityState: 'PROTOTYPE_ONLY',
        });
        await expect(api.getStoreCollectionSchedule(firstView.context))
            .rejects.toThrow(/STORE_CONTEXT_MISMATCH|StoreContext|CONTEXT/i);
        const refreshedFirst = await api.switchStore({ storeId: stores[0].storeId, marketplace: stores[0].marketplace });
        expect(await api.getStoreCollectionSchedule(refreshedFirst.context)).toMatchObject({
            storeId: stores[0].storeId,
            state: 'succeeded',
        });
        const serialized = JSON.stringify({
            firstSchedule,
            firstRetention,
            firstRun,
            secondSchedule,
            secondRetention,
        });
        expect(serialized).not.toMatch(/[A-Za-z]:[\\/]/);
        expect(serialized).not.toMatch(/absolutePath|relativePath|filePath|folderPath/);
        expect(api.getScheduledTasks).toBeUndefined();
        expect(api.setTaskEnabled).toBeUndefined();
        expect(api.runTaskNow).toBeUndefined();
    });
    it('projects all scheduler preview actions as explicit PROTOTYPE_ONLY capabilities', async () => {
        const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
        const [store] = await api.listStores();
        const view = await api.switchStore({ storeId: store.storeId, marketplace: store.marketplace });
        const response = await api.missionControl.query({
            query: 'workspace-bootstrap',
            requestId: 'preview-store-automation-capabilities',
            contextEpoch: 2,
            context: view.context,
        });
        expect(response.data.capabilities
            .filter((item: any) => item.view === 'settings/scheduler'))
            .toEqual(expect.arrayContaining([
            expect.objectContaining({
                capabilityId: 'settings.scheduler.view',
                state: 'PROTOTYPE_ONLY',
                legacyRoute: 'scheduler',
            }),
            expect.objectContaining({
                capabilityId: 'settings.scheduler.run-now',
                action: 'start',
                state: 'PROTOTYPE_ONLY',
            }),
            expect.objectContaining({
                capabilityId: 'settings.scheduler.retention-preview',
                action: 'view',
                state: 'PROTOTYPE_ONLY',
            }),
        ]));
    });
    it('binds all 16 legacy preview pages to their exact route projection without opening production', async () => {
        const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
        const [store] = await api.listStores();
        const storeView = await api.switchStore({ storeId: store.storeId, marketplace: store.marketplace });
        const response = await api.missionControl.query({
            query: 'workspace-bootstrap',
            requestId: 'preview-legacy-routes',
            contextEpoch: 2,
            context: storeView.context,
        });
        expect(new Set(LEGACY_PREVIEW_ROUTE_CASES.map(({ route }) => route))).toEqual(new Set(MISSION_CONTROL_LEGACY_ROUTE_IDS));
        for (const { route, intent, view } of LEGACY_PREVIEW_ROUTE_CASES) {
            const capability = resolveLegacyCapability(response.data.capabilities, route, intent);
            expect(capability, `${view} should resolve ${route}`).toEqual(expect.objectContaining({
                action: 'view',
                legacyRoute: route,
                state: 'PROTOTYPE_ONLY',
                view,
                workspace: intent.workspace,
            }));
            const previewMarkup = renderToStaticMarkup(createElement(LegacyAdapterBoundary, {
                capability,
                children: createElement('span', null, `mounted:${view}`),
                intent,
                previewMode: true,
                route,
                storeContext: response.authoritativeContext,
            }));
            expect(previewMarkup).toContain('仅开发预览');
            expect(previewMarkup).toContain(`mounted:${view}`);
        }
        const firstCase = LEGACY_PREVIEW_ROUTE_CASES[0];
        const previewCapability = resolveLegacyCapability(response.data.capabilities, firstCase.route, firstCase.intent);
        const productionMarkup = renderToStaticMarkup(createElement(LegacyAdapterBoundary, {
            capability: previewCapability,
            children: createElement('span', null, 'must-not-mount-in-production'),
            intent: firstCase.intent,
            previewMode: false,
            route: firstCase.route,
            storeContext: response.authoritativeContext,
        }));
        expect(productionMarkup).toContain('当前功能未放行');
        expect(productionMarkup).not.toContain('must-not-mount-in-production');
    });
    it('shares the explicit preview Policy runtime with the shell and strictly rejects extra request fields', async () => {
        const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
        const [store] = await api.listStores();
        const view = await api.switchStore({ storeId: store.storeId, marketplace: store.marketplace });
        const applied = await api.missionControl.command({
            command: 'set-autonomy-mode',
            requestId: 'preview-auto',
            contextEpoch: 1,
            context: view.context,
            payload: { mode: 'policy_auto' },
        });
        expect(applied).toEqual(expect.objectContaining({
            status: 'APPLIED',
            currentMode: 'policy_auto',
        }));
        expect(applied.detail).toMatch(/仅开发预览|不授权|不执行/);
        const refreshed = await api.missionControl.query({
            query: 'workspace-bootstrap', requestId: 'preview-auto-query', contextEpoch: 1, context: view.context,
        });
        expect(refreshed.data.autonomy).toEqual(expect.objectContaining({
            currentMode: 'policy_auto', policyAutoAvailable: true,
        }));
        await expect(api.missionControl.query({
            query: 'workspace-bootstrap',
            requestId: 'preview-extra',
            contextEpoch: 1,
            context: view.context,
            filePath: 'C:/not-allowed',
        })).rejects.toThrow(/unsupported field filePath/);
    });
    it('supports fixture CRUD without silently selecting a newly created store', async () => {
        const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
        const records: any[] = [];
        api.onStoresChanged((store: any) => records.push(store));
        const created = await api.createStore({
            displayName: 'SHC003', marketplace: 'CA', currency: 'CAD', businessTimezone: 'UTC',
        });
        expect(created).toEqual(expect.objectContaining({
            displayName: 'SHC003', marketplace: 'US', currency: 'USD',
            businessTimezone: 'America/Los_Angeles',
        }));
        expect(await api.listStores()).toHaveLength(3);
        expect(await api.getActiveStoreContext()).toBeNull();
        expect(records).toHaveLength(1);
    });
});
