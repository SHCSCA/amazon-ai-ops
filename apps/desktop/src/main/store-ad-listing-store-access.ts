import { type StoreContextEnvelope, type StoreRecord } from '@amazon-ai-ops/shared-types';
import { StoreScopedAdListingError } from "./store-ad-listing-contracts";
import { normalizeIdentity, identityMismatch } from "./store-ad-listing-input-values";
import type { StoreAdListingRuntime } from './store-ad-listing-runtime';

export function authorize(this: StoreAdListingRuntime,
  contextInput: StoreContextEnvelope): StoreRecord {
    const context = this.storeCoordinator.assertActiveStoreContext(contextInput);
    const store = this.storeCoordinator.getStore(context.storeId);
    if (context.marketplace !== 'US' || store.marketplace !== 'US') {
      throw new StoreScopedAdListingError('STORE_IDENTITY_MISMATCH', 'V1 supports Amazon US only');
    }
    if (context.currency !== 'USD' || store.currency !== 'USD') {
      throw new StoreScopedAdListingError('STORE_IDENTITY_MISMATCH', 'V1 supports USD only');
    }
    return store;
  }

export function assertIdentityHints(this: StoreAdListingRuntime,
  store: StoreRecord,
  value: Record<string, unknown>): void {
    for (const input of [value.storeName, value.store_name].filter((item) => item !== undefined)) {
      if (normalizeIdentity(input) !== normalizeIdentity(store.displayName)) {
        throw identityMismatch('Renderer store name does not match Main store authority');
      }
    }
    for (const input of [value.marketplace, value.marketplaceCode, value.marketplace_code]
      .filter((item) => item !== undefined)) {
      if (String(input).trim().toUpperCase() !== 'US') {
        throw identityMismatch('Renderer marketplace does not match Main US authority');
      }
    }
    if (value.currency !== undefined && String(value.currency).trim().toUpperCase() !== 'USD') {
      throw identityMismatch('Renderer currency does not match Main USD authority');
    }
  }
