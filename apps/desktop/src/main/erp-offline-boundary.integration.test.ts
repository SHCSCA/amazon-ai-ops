import { describe, expect, it, vi } from 'vitest';
import { BrowserController } from '@amazon-ai-ops/browser-worker';
import { createFullDomainFixture } from '@amazon-ai-ops/local-db/src/sqlite/repositories/store-full-domain.test-fixtures';
import { StoreRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/store-repo';
import { assertVisibleLingxingCollectionSession } from './main-mission-today-runtime';

const ports = vi.hoisted(() => ({ runtime: null as unknown }));
vi.mock('./main-runtime-access', () => ({ getMainRuntimeContext: () => ports.runtime }));
vi.mock('electron', () => ({ app: { isPackaged: true }, safeStorage: {}, shell: {} }));

describe('ERP offline production collection boundary', () => {
  it('blocks collection for an expired ERP session while leaving Ads and all local history independently readable', () => {
    const { h, seeded, project } = createFullDomainFixture();
    const item = seeded[0];
    const before = project(item);
    const controller = Object.create(BrowserController.prototype) as BrowserController;
    controller.getPage = () => ({}) as ReturnType<BrowserController['getPage']>;
    const stores = new StoreRepository(h.database);
    ports.runtime = { state: { storeRepo: stores,
      storeCoordinator: { assertActiveStoreContext: (context: unknown) => { expect(context).toEqual(item.context); return item.context; } } },
      visibleBrowserRuntimeRegistry: { read: () => ({ purpose: 'operator_full', context: item.context,
        providerIdentityStatus: { lingxing: 'verified', amazon_ads: 'verified' }, controllers: { lingxing: controller } }) } };
    expect(() => assertVisibleLingxingCollectionSession(item.context)).not.toThrow();
    h.database.prepare("UPDATE store_session_metadata SET status='expired' WHERE store_id=? AND provider='lingxing'").run(item.context.storeId);
    const changes = h.database.prepare('SELECT total_changes() AS count').get();
    expect(() => assertVisibleLingxingCollectionSession(item.context)).toThrow(/领星可见会话/);
    expect(stores.getSessionMetadata(item.context.storeId, 'amazon_ads')?.status).toBe('ready');
    expect(project(item)).toEqual(before);
    expect(h.database.prepare('SELECT total_changes() AS count').get()).toEqual(changes);
  });
});
