import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type {
  StoreAdObjectListInput,
  StoreKeywordFactListInput,
  StoreListingContentCreateInput,
  StoreListingContentDeleteInput,
  StoreListingContentListInput,
  StoreListingContentLookupInput,
  StoreListingContentUpdateInput,
  StoreListingVersionListInput,
  StoreScopedAdListingService,
} from './store-scoped-ad-listing-service';

export const STORE_SCOPED_AD_LISTING_IPC_CHANNELS = [
  'store-ad-listing:ad-objects:list',
  'store-ad-listing:keyword-facts:list',
  'store-ad-listing:listing:list',
  'store-ad-listing:listing:get',
  'store-ad-listing:listing:create',
  'store-ad-listing:listing:update',
  'store-ad-listing:listing:delete',
  'store-ad-listing:listing-versions:list',
] as const;

export interface StoreScopedAdListingIpcRegistrar {
  handle(channel: string, listener: (event: unknown, input?: unknown) => unknown): void;
}

export interface StoreScopedAdListingIpcEvents {
  onListingChanged?(context: StoreContextEnvelope): void;
}

type StoreScopedAdListingPort = Pick<
  StoreScopedAdListingService,
  | 'listAdObjects'
  | 'listKeywordFacts'
  | 'listListingContent'
  | 'getListingContent'
  | 'createListingContent'
  | 'updateListingContent'
  | 'deleteListingContent'
  | 'listListingVersions'
>;

type AuthorizedRequest<T> = {
  storeContext: StoreContextEnvelope;
  input: T;
};

/**
 * Explicit IPC allowlist for store-owned advertising facts and Listing CRUD.
 * Main re-authorizes the complete StoreContextEnvelope inside the service on
 * every call; Renderer-provided store labels are never used as authority.
 */
export function registerStoreScopedAdListingIpcHandlers(
  ipc: StoreScopedAdListingIpcRegistrar,
  service: StoreScopedAdListingPort,
  events: StoreScopedAdListingIpcEvents = {},
): void {
  ipc.handle('store-ad-listing:ad-objects:list', (_event, raw) => {
    const request = readAuthorizedRequest<StoreAdObjectListInput>(raw);
    return service.listAdObjects(request.storeContext, request.input);
  });
  ipc.handle('store-ad-listing:keyword-facts:list', (_event, raw) => {
    const request = readAuthorizedRequest<StoreKeywordFactListInput>(raw);
    return service.listKeywordFacts(request.storeContext, request.input);
  });
  ipc.handle('store-ad-listing:listing:list', (_event, raw) => {
    const request = readAuthorizedRequest<StoreListingContentListInput>(raw);
    return service.listListingContent(request.storeContext, request.input);
  });
  ipc.handle('store-ad-listing:listing:get', (_event, raw) => {
    const request = readAuthorizedRequest<StoreListingContentLookupInput>(raw);
    return service.getListingContent(request.storeContext, request.input);
  });
  ipc.handle('store-ad-listing:listing:create', (_event, raw) => {
    const request = readAuthorizedRequest<StoreListingContentCreateInput>(raw);
    const result = service.createListingContent(request.storeContext, request.input);
    events.onListingChanged?.(request.storeContext);
    return result;
  });
  ipc.handle('store-ad-listing:listing:update', (_event, raw) => {
    const request = readAuthorizedRequest<StoreListingContentUpdateInput>(raw);
    const result = service.updateListingContent(request.storeContext, request.input);
    events.onListingChanged?.(request.storeContext);
    return result;
  });
  ipc.handle('store-ad-listing:listing:delete', (_event, raw) => {
    const request = readAuthorizedRequest<StoreListingContentDeleteInput>(raw);
    const result = service.deleteListingContent(request.storeContext, request.input);
    events.onListingChanged?.(request.storeContext);
    return result;
  });
  ipc.handle('store-ad-listing:listing-versions:list', (_event, raw) => {
    const request = readAuthorizedRequest<StoreListingVersionListInput>(raw);
    return service.listListingVersions(request.storeContext, request.input);
  });
}

function readAuthorizedRequest<T>(value: unknown): AuthorizedRequest<T> {
  const request = asObject(value, 'store ad/listing IPC request');
  const storeContext = asObject(request.storeContext, 'storeContext') as unknown as StoreContextEnvelope;
  const input = asObject(request.input, 'input') as T;
  return { storeContext, input };
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}
