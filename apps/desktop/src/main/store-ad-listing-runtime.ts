import type { Database } from 'better-sqlite3';
import type { StoreScopedAdListingServiceOptions } from './store-ad-listing-contracts';

export interface StoreAdListingRuntime {
  readonly db: Database;
  readonly storeCoordinator: StoreScopedAdListingServiceOptions['storeCoordinator'];
  listAdObjects: typeof import('./store-ad-listing-objects').listAdObjects;
  loadCurrentStableAdEntityAuthorities: typeof import('./store-ad-listing-entity-authority').loadCurrentStableAdEntityAuthorities;
  resolveProductionAdAuthority: typeof import('./store-ad-listing-production-authority').resolveProductionAdAuthority;
  listKeywordFacts: typeof import('./store-ad-listing-keyword-facts').listKeywordFacts;
  listListingContent: typeof import('./store-ad-listing-listing-content').listListingContent;
  getListingContent: typeof import('./store-ad-listing-listing-content').getListingContent;
  createListingContent: typeof import('./store-ad-listing-listing-content').createListingContent;
  updateListingContent: typeof import('./store-ad-listing-listing-content').updateListingContent;
  deleteListingContent: typeof import('./store-ad-listing-listing-content').deleteListingContent;
  listListingVersions: typeof import('./store-ad-listing-listing-content').listListingVersions;
  authorize: typeof import('./store-ad-listing-store-access').authorize;
  assertIdentityHints: typeof import('./store-ad-listing-store-access').assertIdentityHints;
  findListingById: typeof import('./store-ad-listing-listing-content').findListingById;
  findListingByAsin: typeof import('./store-ad-listing-listing-content').findListingByAsin;
  projectListing: typeof import('./store-ad-listing-listing-content').projectListing;
  insertListingVersion: typeof import('./store-ad-listing-listing-content').insertListingVersion;
}
