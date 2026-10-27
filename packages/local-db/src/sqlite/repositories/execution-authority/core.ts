import { type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { ExecutionAuthorityRepositoryError } from './errors';
import { normalizeContext, idOf } from './values';
import type { ExecutionAuthorityRepositoryContext } from './context';
export function durableStoreSessionGeneration(this: ExecutionAuthorityRepositoryContext, storeId: string): number {
    const setting = this.db.prepare(`SELECT value FROM app_settings WHERE key = ?`)
        .get(`store_session_generation:${storeId}`) as {
        value: string | null;
    } | undefined;
    return setting?.value === undefined || setting.value === null
        ? Number((this.db.prepare(`
          SELECT COALESCE(MAX(session_generation), 0) AS generation
          FROM store_session_metadata WHERE store_id = ?
        `).get(storeId) as {
            generation: number;
        }).generation)
        : Number(setting.value);
}
export function assertStoreContext(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope): StoreContextEnvelope {
    const context = normalizeContext(contextInput);
    const store = this.db.prepare(`
      SELECT browser_profile_id AS browserProfileId, marketplace, currency,
             business_timezone AS businessTimezone, status
      FROM stores WHERE store_id = ?
    `).get(context.storeId) as {
        browserProfileId: string;
        marketplace: string;
        currency: string;
        businessTimezone: string;
        status: string;
    } | undefined;
    if (!store || store.browserProfileId !== context.browserProfileId
        || store.marketplace !== 'US' || context.marketplace !== 'US'
        || store.currency !== 'USD' || context.currency !== 'USD'
        || store.businessTimezone !== context.businessTimezone) {
        throw new ExecutionAuthorityRepositoryError('INVALID_CONTEXT', 'StoreContextEnvelope does not match SQLite execution authority.');
    }
    if (store.status !== 'active') {
        throw new ExecutionAuthorityRepositoryError('STORE_NOT_ACTIVE', `Store ${context.storeId} is ${store.status}; execution is blocked.`);
    }
    const durable = this.durableStoreSessionGeneration(context.storeId);
    if (!Number.isSafeInteger(durable) || durable < 0 || durable !== context.sessionGeneration) {
        throw new ExecutionAuthorityRepositoryError('STALE_CONTEXT', `Store session generation is stale; expected ${durable}, received ${context.sessionGeneration}.`);
    }
    return context;
}
export function assertContext(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, expectedAdsAccountId?: string): StoreContextEnvelope {
    const context = this.assertStoreContext(contextInput);
    const connection = this.db.prepare(`
      SELECT status, external_account_id AS externalAccountId FROM store_connections
      WHERE store_id = ? AND provider = 'amazon_ads'
    `).get(context.storeId) as {
        status: string;
        externalAccountId: string | null;
    } | undefined;
    const session = this.db.prepare(`
      SELECT browser_profile_id AS browserProfileId, status, session_generation AS sessionGeneration,
             external_account_id AS externalAccountId
      FROM store_session_metadata WHERE store_id = ? AND provider = 'amazon_ads'
    `).get(context.storeId) as {
        browserProfileId: string;
        status: string;
        sessionGeneration: number;
        externalAccountId: string | null;
    } | undefined;
    if (!connection || connection.status !== 'ready' || !connection.externalAccountId
        || !session || session.status !== 'ready' || session.browserProfileId !== context.browserProfileId
        || session.sessionGeneration !== context.sessionGeneration
        || session.externalAccountId !== connection.externalAccountId
        || (expectedAdsAccountId !== undefined
            && idOf(expectedAdsAccountId, 'adsAccountId') !== connection.externalAccountId)) {
        throw new ExecutionAuthorityRepositoryError('INVALID_CONTEXT', 'Amazon Ads account/session identity is not ready or does not match exactly.');
    }
    return context;
}
export function immediate<T>(this: ExecutionAuthorityRepositoryContext, work: () => T): T {
    return this.db.transaction(work).immediate();
}
export function timestamp(this: ExecutionAuthorityRepositoryContext): string {
    return this.now().toISOString();
}
