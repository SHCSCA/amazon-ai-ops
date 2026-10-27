import { type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  type StoreScopedAdListingServiceOptions,
  type StoreAdObjectListInput,
  type StoreScopedAdObjectFact,
  type StoreKeywordFactListInput,
  type StoreScopedKeywordFact,
  type StoreListingContentListInput,
  type VersionedStoreListingContent,
  type StoreListingContentLookupInput,
  type StoreListingContentCreateInput,
  type StoreListingContentUpdateInput,
  type StoreListingContentDeleteInput,
  type StoreListingVersionListInput,
  type StoreListingContentVersion,
} from "./store-ad-listing-contracts";
import { listAdObjects } from "./store-ad-listing-objects";
import { loadCurrentStableAdEntityAuthorities } from "./store-ad-listing-entity-authority";
import { resolveProductionAdAuthority } from "./store-ad-listing-production-authority";
import { listKeywordFacts } from "./store-ad-listing-keyword-facts";
import {
  listListingContent,
  getListingContent,
  createListingContent,
  updateListingContent,
  deleteListingContent,
  listListingVersions,
  findListingById,
  findListingByAsin,
  projectListing,
  insertListingVersion,
} from "./store-ad-listing-listing-content";
import { authorize, assertIdentityHints } from "./store-ad-listing-store-access";
import type { StoreAdListingRuntime } from './store-ad-listing-runtime';

export { type StoreScopedAdObjectKind, type StoreScopedAdObjectFact, type StoreScopedKeywordFact, type VersionedStoreListingContent, type StoreListingContentVersion, type StoreAdObjectListInput, type StoreKeywordFactListInput, type StoreListingContentListInput, type StoreListingContentLookupInput, type StoreListingContentCreateInput, type StoreListingContentUpdateInput, type StoreListingContentDeleteInput, type StoreListingVersionListInput, type StoreScopedAdListingErrorCode, StoreScopedAdListingError, type StoreScopedAdListingServiceOptions } from "./store-ad-listing-contracts";

export class StoreScopedAdListingService {
  private readonly runtime: StoreAdListingRuntime;

  constructor(options: StoreScopedAdListingServiceOptions) {
    this.runtime = {
      db: options.db,
      storeCoordinator: options.storeCoordinator,
      listAdObjects,
      loadCurrentStableAdEntityAuthorities,
      resolveProductionAdAuthority,
      listKeywordFacts,
      listListingContent,
      getListingContent,
      createListingContent,
      updateListingContent,
      deleteListingContent,
      listListingVersions,
      authorize,
      assertIdentityHints,
      findListingById,
      findListingByAsin,
      projectListing,
      insertListingVersion,
    };
  }

  listAdObjects(
    contextInput: StoreContextEnvelope,
    input: StoreAdObjectListInput = {},
  ): StoreScopedAdObjectFact[] {
    return this.runtime.listAdObjects(contextInput, input);
  }

  listKeywordFacts(
    contextInput: StoreContextEnvelope,
    input: StoreKeywordFactListInput = {},
  ): StoreScopedKeywordFact[] {
    return this.runtime.listKeywordFacts(contextInput, input);
  }

  listListingContent(
    contextInput: StoreContextEnvelope,
    input: StoreListingContentListInput = {},
  ): VersionedStoreListingContent[] {
    return this.runtime.listListingContent(contextInput, input);
  }

  getListingContent(
    contextInput: StoreContextEnvelope,
    input: StoreListingContentLookupInput,
  ): VersionedStoreListingContent {
    return this.runtime.getListingContent(contextInput, input);
  }

  createListingContent(
    contextInput: StoreContextEnvelope,
    input: StoreListingContentCreateInput,
  ): VersionedStoreListingContent {
    return this.runtime.createListingContent(contextInput, input);
  }

  updateListingContent(
    contextInput: StoreContextEnvelope,
    input: StoreListingContentUpdateInput,
  ): VersionedStoreListingContent {
    return this.runtime.updateListingContent(contextInput, input);
  }

  deleteListingContent(
    contextInput: StoreContextEnvelope,
    input: StoreListingContentDeleteInput,
  ): { id: number; deleted: true } {
    return this.runtime.deleteListingContent(contextInput, input);
  }

  listListingVersions(
    contextInput: StoreContextEnvelope,
    input: StoreListingVersionListInput = {},
  ): StoreListingContentVersion[] {
    return this.runtime.listListingVersions(contextInput, input);
  }
}
