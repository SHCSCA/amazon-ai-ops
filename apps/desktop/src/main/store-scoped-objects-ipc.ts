import type { OperationEvent, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { projectBusinessOperationEventForRenderer } from './business-operation-event-projection';
import type {
  StoreOperationEventCreateInput,
  StoreOperationEventDeleteInput,
  StoreOperationEventListInput,
  StoreOperationEventUpdateInput,
  StoreProductArchiveInput,
  StoreProductCreateInput,
  StoreProductListInput,
  StoreProductLookupInput,
  StoreProductUpdateInput,
  StoreScopedObjectsService,
} from './store-scoped-objects-service';

export const STORE_SCOPED_OBJECTS_IPC_CHANNELS = [
  'store-objects:products:list',
  'store-objects:products:get',
  'store-objects:products:create',
  'store-objects:products:update',
  'store-objects:products:archive',
  'store-objects:operation-events:list',
  'store-objects:operation-events:create',
  'store-objects:operation-events:update',
  'store-objects:operation-events:delete',
] as const;

export interface StoreScopedObjectsIpcRegistrar {
  handle(channel: string, listener: (event: unknown, input?: unknown) => unknown): void;
}

export interface StoreScopedObjectsIpcEvents {
  onObjectsChanged?(
    context: StoreContextEnvelope,
    mutation: StoreScopedObjectMutation,
  ): void;
}

/**
 * Sanitized mutation receipt emitted only after the authoritative service has
 * completed the write. Main uses the operation-event receipt to append (or
 * idempotently reconcile) the matching CausalLedger fact without asking the
 * Renderer to restate store or entity authority.
 */
export type StoreScopedObjectMutation =
  | {
      entityType: 'product';
      action: 'create' | 'update' | 'archive';
      record: unknown;
    }
  | {
      entityType: 'operation_event';
      action: 'create' | 'update' | 'archive' | 'restore';
      record: unknown;
    };

type StoreScopedObjectsPort = Pick<
  StoreScopedObjectsService,
  | 'listProducts'
  | 'getProduct'
  | 'createProduct'
  | 'updateProduct'
  | 'archiveProduct'
  | 'listOperationEvents'
  | 'createOperationEvent'
  | 'updateOperationEvent'
  | 'deleteOperationEvent'
>;

type AuthorizedRequest<T> = {
  storeContext: StoreContextEnvelope;
  input: T;
};

/**
 * Renderer-facing boundary for store-owned operator objects.
 *
 * Every call carries a complete StoreContextEnvelope. The service validates it
 * against current Main authority immediately before the repository read/write;
 * legacy store-name scoped APIs are deliberately not reachable here.
 */
export function registerStoreScopedObjectsIpcHandlers(
  ipc: StoreScopedObjectsIpcRegistrar,
  service: StoreScopedObjectsPort,
  events: StoreScopedObjectsIpcEvents = {},
): void {
  ipc.handle('store-objects:products:list', (_event, raw) => {
    const request = readAuthorizedRequest<StoreProductListInput>(raw);
    return service.listProducts(request.storeContext, request.input);
  });
  ipc.handle('store-objects:products:get', (_event, raw) => {
    const request = readAuthorizedRequest<StoreProductLookupInput>(raw);
    return service.getProduct(request.storeContext, request.input);
  });
  ipc.handle('store-objects:products:create', (_event, raw) => {
    const request = readAuthorizedRequest<StoreProductCreateInput>(raw);
    const result = service.createProduct(request.storeContext, request.input);
    events.onObjectsChanged?.(request.storeContext, {
      entityType: 'product', action: 'create', record: result,
    });
    return result;
  });
  ipc.handle('store-objects:products:update', (_event, raw) => {
    const request = readAuthorizedRequest<StoreProductUpdateInput>(raw);
    const result = service.updateProduct(request.storeContext, request.input);
    events.onObjectsChanged?.(request.storeContext, {
      entityType: 'product', action: 'update', record: result,
    });
    return result;
  });
  ipc.handle('store-objects:products:archive', (_event, raw) => {
    const request = readAuthorizedRequest<StoreProductArchiveInput>(raw);
    const result = service.archiveProduct(request.storeContext, request.input);
    events.onObjectsChanged?.(request.storeContext, {
      entityType: 'product', action: 'archive', record: result,
    });
    return result;
  });
  ipc.handle('store-objects:operation-events:list', (_event, raw) => {
    const request = readAuthorizedRequest<StoreOperationEventListInput>(raw);
    return service.listOperationEvents(request.storeContext, request.input)
      .map(projectRendererOperationEvent);
  });
  ipc.handle('store-objects:operation-events:create', (_event, raw) => {
    const request = readAuthorizedRequest<StoreOperationEventCreateInput>(raw);
    const result = service.createOperationEvent(request.storeContext, request.input);
    events.onObjectsChanged?.(request.storeContext, {
      entityType: 'operation_event', action: 'create', record: result,
    });
    return projectRendererOperationEvent(result);
  });
  ipc.handle('store-objects:operation-events:update', (_event, raw) => {
    const request = readAuthorizedRequest<StoreOperationEventUpdateInput>(raw);
    const result = service.updateOperationEvent(request.storeContext, request.input);
    events.onObjectsChanged?.(request.storeContext, {
      entityType: 'operation_event',
      action: isOperationEventRestore(request.input) ? 'restore' : 'update',
      record: result,
    });
    return projectRendererOperationEvent(result);
  });
  ipc.handle('store-objects:operation-events:delete', (_event, raw) => {
    const request = readAuthorizedRequest<StoreOperationEventDeleteInput>(raw);
    const result = service.deleteOperationEvent(request.storeContext, request.input);
    events.onObjectsChanged?.(request.storeContext, {
      entityType: 'operation_event', action: 'archive', record: result,
    });
    return projectRendererOperationEvent(result);
  });
}

function isOperationEventRestore(input: StoreOperationEventUpdateInput): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const patch = (input as { patch?: unknown }).patch;
  return Boolean(
    patch
    && typeof patch === 'object'
    && !Array.isArray(patch)
    && (patch as { archived?: unknown }).archived === false,
  );
}

function projectRendererOperationEvent<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return projectBusinessOperationEventForRenderer(value as T & OperationEvent) as T;
}

function readAuthorizedRequest<T>(value: unknown): AuthorizedRequest<T> {
  const request = asObject(value, 'store-scoped object IPC request');
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
