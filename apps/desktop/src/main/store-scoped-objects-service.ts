import { createHash } from 'crypto';
import {
  canonicalizeAmazonAsin,
  type CreateOperationEventInput,
  type OperationEventFilter,
  type ProductCost,
  type StoreContextEnvelope,
  type StoreRecord,
  type UpdateOperationEventInput,
} from '@amazon-ai-ops/shared-types';
import type {
  Product,
  ProductRepository,
  StoreScopedProductWithCost,
} from '@amazon-ai-ops/local-db/src/sqlite/repositories/product-repo';
import type {
  OperationEventRepository,
  StoreScopedOperationEvent,
} from '@amazon-ai-ops/local-db/src/sqlite/repositories/operation-event-repo';
import { projectBusinessOperationEventForRenderer } from './business-operation-event-projection';
import type { StoreCoordinator } from './store-coordinator';

type StoreIdentityHints = {
  storeName?: unknown;
  store_name?: unknown;
  marketplace?: unknown;
  marketplaceCode?: unknown;
  marketplace_code?: unknown;
  currency?: unknown;
};

export type VersionedStoreProduct = StoreScopedProductWithCost & { revision: string };
export type VersionedStoreOperationEvent = Omit<StoreScopedOperationEvent, 'evidencePath'> & {
  asinValid: boolean;
  evidenceArtifactId?: string;
  evidenceRefValid: boolean;
  revision: string;
};

export interface StoreProductListInput extends StoreIdentityHints {
  includeArchived?: unknown;
}

export interface StoreProductLookupInput extends StoreIdentityHints {
  id?: unknown;
  asin?: unknown;
}

export interface StoreProductCreateInput extends StoreIdentityHints {
  asin: unknown;
  parentAsin?: unknown;
  parent_asin?: unknown;
  msku?: unknown;
  sku?: unknown;
  title?: unknown;
  productStage?: unknown;
  product_stage?: unknown;
  status?: unknown;
  cost?: unknown;
}

export interface StoreProductUpdateInput {
  id: unknown;
  expectedRevision?: unknown;
  expectedUpdatedAt?: unknown;
  patch?: unknown;
  cost?: unknown;
}

export interface StoreProductArchiveInput {
  id: unknown;
  expectedRevision?: unknown;
  expectedUpdatedAt?: unknown;
}

export interface StoreOperationEventListInput extends StoreIdentityHints {
  dateFrom?: unknown;
  dateTo?: unknown;
  asin?: unknown;
  campaignName?: unknown;
  adGroupName?: unknown;
  eventType?: unknown;
  limit?: unknown;
  includeArchived?: unknown;
}

export type StoreOperationEventCreateInput = Omit<
  CreateOperationEventInput,
  'storeName' | 'marketplaceCode' | 'evidencePath'
> & StoreIdentityHints & {
  evidenceArtifactId?: unknown;
};

export interface StoreOperationEventUpdateInput {
  id: unknown;
  expectedRevision?: unknown;
  expectedUpdatedAt?: unknown;
  patch: unknown;
}

export interface StoreOperationEventDeleteInput {
  id: unknown;
  expectedRevision?: unknown;
  expectedUpdatedAt?: unknown;
}

export type StoreScopedObjectsErrorCode =
  | 'INVALID_INPUT'
  | 'STORE_IDENTITY_MISMATCH'
  | 'OBJECT_NOT_FOUND'
  | 'OBJECT_ALREADY_EXISTS'
  | 'CAS_REQUIRED'
  | 'CAS_UNAVAILABLE'
  | 'OBJECT_CONFLICT'
  | 'UNSUPPORTED_MUTATION'
  | 'WRITE_FAILED';

export class StoreScopedObjectsError extends Error {
  constructor(readonly code: StoreScopedObjectsErrorCode, message: string) {
    super(message);
    this.name = 'StoreScopedObjectsError';
  }
}

export interface StoreScopedObjectsServiceOptions {
  storeCoordinator: Pick<StoreCoordinator, 'assertActiveStoreContext' | 'getStore'>;
  productRepository: ProductRepository;
  operationEventRepository: OperationEventRepository;
  validateEvidenceArtifact?: (store: StoreRecord, artifactId: string) => boolean;
}

/**
 * Main-only CRUD boundary for operator-maintained objects.
 *
 * The service is deliberately synchronous. Main validates the captured store
 * context and a deterministic entity revision immediately before each write,
 * so all writers routed through this service are serialized without an await
 * gap. Repository timestamps are only second-resolution and are therefore not
 * accepted as a write precondition on their own.
 */
export class StoreScopedObjectsService {
  private readonly storeCoordinator: StoreScopedObjectsServiceOptions['storeCoordinator'];
  private readonly productRepository: ProductRepository;
  private readonly operationEventRepository: OperationEventRepository;
  private readonly validateEvidenceArtifact?: StoreScopedObjectsServiceOptions['validateEvidenceArtifact'];

  constructor(options: StoreScopedObjectsServiceOptions) {
    this.storeCoordinator = options.storeCoordinator;
    this.productRepository = options.productRepository;
    this.operationEventRepository = options.operationEventRepository;
    this.validateEvidenceArtifact = options.validateEvidenceArtifact;
  }

  listProducts(
    contextInput: StoreContextEnvelope,
    input: StoreProductListInput = {},
  ): VersionedStoreProduct[] {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'product list input');
    rejectUnknownKeys(value, PRODUCT_LIST_KEYS, 'product list input');
    this.assertIdentityHints(store, value);
    const includeArchived = optionalBoolean(value.includeArchived, 'includeArchived') ?? false;
    return this.productRepository
      .findAllWithCostsForStore(store.storeId)
      .filter((product) => includeArchived || product.status !== 'archived')
      .map((product) => this.projectProduct(store, product));
  }

  getProduct(
    contextInput: StoreContextEnvelope,
    input: StoreProductLookupInput,
  ): VersionedStoreProduct {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'product lookup input');
    rejectUnknownKeys(value, PRODUCT_LOOKUP_KEYS, 'product lookup input');
    this.assertIdentityHints(store, value);

    const hasId = value.id !== undefined;
    const hasAsin = value.asin !== undefined;
    if (hasId === hasAsin) {
      throw invalid('product lookup requires exactly one of id or asin');
    }
    const product = hasId
      ? this.findProductById(store, positiveInteger(value.id, 'product id'))
      : this.findProductByAsin(store, normalizeAsin(value.asin));
    if (!product) throw notFound('product');
    return this.projectProduct(store, product);
  }

  createProduct(
    contextInput: StoreContextEnvelope,
    input: StoreProductCreateInput,
  ): VersionedStoreProduct {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'product create input');
    rejectUnknownKeys(value, PRODUCT_CREATE_KEYS, 'product create input');
    this.assertIdentityHints(store, value);
    const asin = normalizeAsin(value.asin);
    if (this.productRepository.findByAsinForStore(store.storeId, asin)) {
      throw new StoreScopedObjectsError(
        'OBJECT_ALREADY_EXISTS',
        `product ${asin} already exists in the active store`,
      );
    }

    const cost = value.cost === undefined ? undefined : normalizeCostPatch(value.cost, true);
    const product = normalizeProductCreate(store, value, asin);
    let id: number;
    try {
      id = this.productRepository.insertWithCostForStore(store.storeId, product, cost);
    } catch (error) {
      if (isSqliteConstraint(error)) {
        throw new StoreScopedObjectsError(
          'OBJECT_ALREADY_EXISTS',
          `product ${asin} conflicts with the current database uniqueness boundary`,
        );
      }
      throw error;
    }
    const created = this.findProductById(store, id);
    if (!created) throw new StoreScopedObjectsError('WRITE_FAILED', 'created product cannot be read back');
    return this.projectProduct(store, created);
  }

  updateProduct(
    contextInput: StoreContextEnvelope,
    input: StoreProductUpdateInput,
  ): VersionedStoreProduct {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'product update input');
    rejectUnknownKeys(value, PRODUCT_UPDATE_KEYS, 'product update input');
    const id = positiveInteger(value.id, 'product id');
    const expectedRevision = this.requireMutationRevision(value);
    const patch = value.patch === undefined
      ? {}
      : requireObject(value.patch, 'product patch');
    rejectUnknownKeys(patch, PRODUCT_PATCH_KEYS, 'product patch');
    this.assertIdentityHints(store, patch);
    const cost = value.cost === undefined ? undefined : normalizeCostPatch(value.cost, false);
    const hasProductPatch = Object.keys(patch).some((key) => !IDENTITY_HINT_KEYS.has(key));
    if (!hasProductPatch && !cost) throw invalid('product update must change product or cost fields');

    return this.productRepository.runImmediateRevisionTransaction(expectedRevision, () => {
      const current = this.findProductById(store, id);
      if (!current) throw notFound('product');
      const projected = this.projectProduct(store, current);
      this.assertExpectedRevision(expectedRevision, projected.revision);
      if (!current.asinValid) {
        throw invalid('historical product has an invalid ASIN and is read-only until reconciled');
      }
      if (patch.asin !== undefined && normalizeAsin(patch.asin) !== current.asin) {
        throw new StoreScopedObjectsError(
          'UNSUPPORTED_MUTATION',
          'changing a product ASIN is not supported; create a new product instead',
        );
      }

      if (hasProductPatch) {
        const next = mergeProductPatch(store, current, patch);
        const updatedId = cost
          ? this.productRepository.upsertWithCostForStore(store.storeId, next, cost)
          : this.productRepository.upsertForStore(store.storeId, next);
        if (updatedId !== current.id) {
          throw new StoreScopedObjectsError('WRITE_FAILED', 'product update changed the row identity');
        }
      }
      if (!hasProductPatch && cost && !this.productRepository.updateCostForStore(
        store.storeId,
        id,
        cost,
      )) {
        throw new StoreScopedObjectsError('WRITE_FAILED', 'product cost write was not applied');
      }
      const updated = this.findProductById(store, id);
      if (!updated) throw new StoreScopedObjectsError('WRITE_FAILED', 'updated product cannot be read back');
      return this.projectProduct(store, updated);
    });
  }

  archiveProduct(
    contextInput: StoreContextEnvelope,
    input: StoreProductArchiveInput,
  ): VersionedStoreProduct {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'product archive input');
    rejectUnknownKeys(value, VERSIONED_ID_KEYS, 'product archive input');
    const id = positiveInteger(value.id, 'product id');
    const expectedRevision = this.requireMutationRevision(value);
    return this.productRepository.runImmediateRevisionTransaction(expectedRevision, () => {
      const current = this.findProductById(store, id);
      if (!current) throw notFound('product');
      const projected = this.projectProduct(store, current);
      this.assertExpectedRevision(expectedRevision, projected.revision);
      if (current.status === 'archived') return projected;
      if (!current.asinValid) {
        throw invalid('historical product has an invalid ASIN and is read-only until reconciled');
      }

      const updatedId = this.productRepository.upsertForStore(store.storeId, {
        ...copyProductForWrite(store, current),
        status: 'archived',
      });
      if (updatedId !== id) {
        throw new StoreScopedObjectsError('WRITE_FAILED', 'product archive changed the row identity');
      }
      const archived = this.findProductById(store, id);
      if (!archived || archived.status !== 'archived') {
        throw new StoreScopedObjectsError('WRITE_FAILED', 'product archive was not persisted');
      }
      return this.projectProduct(store, archived);
    });
  }

  listOperationEvents(
    contextInput: StoreContextEnvelope,
    input: StoreOperationEventListInput = {},
  ): VersionedStoreOperationEvent[] {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'operation event list input');
    rejectUnknownKeys(value, EVENT_LIST_KEYS, 'operation event list input');
    this.assertIdentityHints(store, value);
    const filter = normalizeEventFilter(value);
    const includeArchived = optionalBoolean(value.includeArchived, 'includeArchived') ?? false;
    return this.operationEventRepository
      .findByScopeForStore(store.storeId, filter, { includeArchived })
      .map((event) => this.projectEvent(store, event));
  }

  createOperationEvent(
    contextInput: StoreContextEnvelope,
    input: StoreOperationEventCreateInput,
  ): VersionedStoreOperationEvent {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'operation event create input');
    rejectUnknownKeys(value, EVENT_CREATE_KEYS, 'operation event create input');
    this.assertIdentityHints(store, value);
    const eventInput = normalizeEventCreate(
      store,
      value,
      (artifactId) => this.evidenceArtifactIsValid(store, artifactId),
    );
    const id = this.operationEventRepository.createForStore(store.storeId, eventInput);
    const created = this.operationEventRepository.getByIdForStore(store.storeId, id);
    if (!created) throw new StoreScopedObjectsError('WRITE_FAILED', 'created operation event cannot be read back');
    return this.projectEvent(store, created);
  }

  updateOperationEvent(
    contextInput: StoreContextEnvelope,
    input: StoreOperationEventUpdateInput,
  ): VersionedStoreOperationEvent {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'operation event update input');
    rejectUnknownKeys(value, EVENT_UPDATE_KEYS, 'operation event update input');
    const id = positiveInteger(value.id, 'operation event id');
    const expectedRevision = this.requireMutationRevision(value);
    const patch = requireObject(value.patch, 'operation event patch');
    rejectUnknownKeys(patch, EVENT_PATCH_KEYS, 'operation event patch');
    this.assertIdentityHints(store, patch);
    return this.productRepository.runImmediateRevisionTransaction(expectedRevision, () => {
      const current = this.operationEventRepository.getByIdForStore(store.storeId, id);
      if (!current) throw notFound('operation event');
      const projected = this.projectEvent(store, current);
      this.assertExpectedRevision(expectedRevision, projected.revision);

      const archivedCommand = patch.archived === undefined
        ? undefined
        : optionalBoolean(patch.archived, 'archived');
      const hasBusinessPatch = Object.keys(patch).some((key) => (
        !IDENTITY_HINT_KEYS.has(key) && key !== 'archived'
      ));
      this.assertEventMutable(store, current, {
        allowInvalidEvidenceReference: (
          Object.prototype.hasOwnProperty.call(patch, 'evidenceArtifactId')
          || Boolean(current.archivedAt && archivedCommand === false && !hasBusinessPatch)
        ),
      });
      if (current.archivedAt) {
        if (archivedCommand !== false) {
          throw invalid('archived operation events are read-only; restore the event before editing it');
        }
        if (hasBusinessPatch) {
          throw invalid('restore and business-field updates must be separate revision-locked operations');
        }
        if (!this.operationEventRepository.restoreForStore(store.storeId, id)) {
          throw new StoreScopedObjectsError('WRITE_FAILED', 'operation event restore was not applied');
        }
        const restored = this.operationEventRepository.getByIdForStore(store.storeId, id);
        if (!restored || restored.archivedAt) {
          throw new StoreScopedObjectsError('WRITE_FAILED', 'restored operation event cannot be read back');
        }
        return this.projectEvent(store, restored);
      }
      if (archivedCommand !== undefined) {
        if (archivedCommand) {
          throw new StoreScopedObjectsError(
            'UNSUPPORTED_MUTATION',
            'use the operation-event archive action instead of an update patch',
          );
        }
        if (!hasBusinessPatch) return projected;
      }

      const normalizedPatch = normalizeEventPatch(
        store,
        current,
        patch,
        (artifactId) => this.evidenceArtifactIsValid(store, artifactId),
      );
      if (!this.operationEventRepository.updateForStore(store.storeId, id, normalizedPatch)) {
        throw new StoreScopedObjectsError('WRITE_FAILED', 'operation event update was not applied');
      }
      const updated = this.operationEventRepository.getByIdForStore(store.storeId, id);
      if (!updated) throw new StoreScopedObjectsError('WRITE_FAILED', 'updated operation event cannot be read back');
      return this.projectEvent(store, updated);
    });
  }

  deleteOperationEvent(
    contextInput: StoreContextEnvelope,
    input: StoreOperationEventDeleteInput,
  ): VersionedStoreOperationEvent {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'operation event archive input');
    rejectUnknownKeys(value, VERSIONED_ID_KEYS, 'operation event archive input');
    const id = positiveInteger(value.id, 'operation event id');
    const expectedRevision = this.requireMutationRevision(value);
    return this.productRepository.runImmediateRevisionTransaction(expectedRevision, () => {
      const current = this.operationEventRepository.getByIdForStore(store.storeId, id);
      if (!current) throw notFound('operation event');
      const projected = this.projectEvent(store, current);
      this.assertExpectedRevision(expectedRevision, projected.revision);
      this.assertEventMutable(store, current, { allowInvalidEvidenceReference: true });
      if (current.archivedAt) return projected;
      if (!this.operationEventRepository.archiveForStore(store.storeId, id)) {
        throw new StoreScopedObjectsError('WRITE_FAILED', 'operation event archive was not applied');
      }
      const archived = this.operationEventRepository.getByIdForStore(store.storeId, id);
      if (!archived?.archivedAt) {
        throw new StoreScopedObjectsError('WRITE_FAILED', 'archived operation event cannot be read back');
      }
      return this.projectEvent(store, archived);
    });
  }

  private authorize(contextInput: StoreContextEnvelope): StoreRecord {
    const context = this.storeCoordinator.assertActiveStoreContext(contextInput);
    const store = this.storeCoordinator.getStore(context.storeId);
    if (context.marketplace !== 'US' || store.marketplace !== 'US') {
      throw new StoreScopedObjectsError('STORE_IDENTITY_MISMATCH', 'V1 supports the US marketplace only');
    }
    if (context.currency !== 'USD' || store.currency !== 'USD') {
      throw new StoreScopedObjectsError('STORE_IDENTITY_MISMATCH', 'V1 supports USD only');
    }
    return store;
  }

  private assertIdentityHints(store: StoreRecord, value: Record<string, unknown>): void {
    const providedStoreNames = [value.storeName, value.store_name].filter((item) => item !== undefined);
    for (const storeName of providedStoreNames) {
      if (normalizeIdentityText(storeName) !== normalizeIdentityText(store.displayName)) {
        throw new StoreScopedObjectsError(
          'STORE_IDENTITY_MISMATCH',
          'Renderer storeName does not match Main-process store authority',
        );
      }
    }
    const providedMarketplaces = [
      value.marketplace,
      value.marketplaceCode,
      value.marketplace_code,
    ].filter((item) => item !== undefined);
    for (const marketplace of providedMarketplaces) {
      if (String(marketplace).trim().toUpperCase() !== 'US') {
        throw new StoreScopedObjectsError(
          'STORE_IDENTITY_MISMATCH',
          'Renderer marketplace does not match Main-process US authority',
        );
      }
    }
    if (value.currency !== undefined && String(value.currency).trim().toUpperCase() !== 'USD') {
      throw new StoreScopedObjectsError(
        'STORE_IDENTITY_MISMATCH',
        'Renderer currency does not match Main-process USD authority',
      );
    }
  }

  private findProductById(store: StoreRecord, id: number): StoreScopedProductWithCost | undefined {
    return this.productRepository.findAllWithCostsForStore(store.storeId)
      .find((product) => product.id === id);
  }

  private findProductByAsin(store: StoreRecord, asin: string): StoreScopedProductWithCost | undefined {
    const product = this.productRepository.findByAsinForStore(store.storeId, asin);
    if (!product) return undefined;
    return { ...product, cost: this.productRepository.getCostForStore(store.storeId, product.id) };
  }

  private projectProduct(
    store: StoreRecord,
    product: StoreScopedProductWithCost,
  ): VersionedStoreProduct {
    const projected: StoreScopedProductWithCost = {
      ...product,
      storeId: store.storeId,
      store_name: store.displayName,
      marketplace_code: 'US',
    };
    return { ...projected, revision: productRevision(projected) };
  }

  private projectEvent(
    store: StoreRecord,
    event: StoreScopedOperationEvent,
  ): VersionedStoreOperationEvent {
    const canonicalAsin = canonicalEventAsin(event.asin);
    const evidenceArtifactId = event.evidencePath && this.evidenceArtifactIsValid(store, event.evidencePath)
      ? event.evidencePath
      : undefined;
    const pathFreeEvent = projectBusinessOperationEventForRenderer(event);
    const projected: Omit<StoreScopedOperationEvent, 'evidencePath'> = {
      ...pathFreeEvent,
      storeId: store.storeId,
      storeName: store.displayName,
      marketplaceCode: 'US',
      ...(canonicalAsin ? { asin: canonicalAsin } : {}),
    };
    return {
      ...projected,
      asinValid: event.asin === undefined || canonicalAsin !== undefined,
      ...(evidenceArtifactId ? { evidenceArtifactId } : {}),
      evidenceRefValid: event.evidencePath === undefined || evidenceArtifactId !== undefined,
      revision: eventRevision(event),
    };
  }

  private evidenceArtifactIsValid(store: StoreRecord, artifactId: string): boolean {
    if (!RENDERER_ARTIFACT_ID_PATTERN.test(artifactId)) return false;
    return this.validateEvidenceArtifact?.(store, artifactId) === true;
  }

  private assertEventMutable(
    store: StoreRecord,
    event: StoreScopedOperationEvent,
    options: { allowInvalidEvidenceReference?: boolean } = {},
  ): void {
    if (event.asin !== undefined && canonicalEventAsin(event.asin) === undefined) {
      throw new StoreScopedObjectsError(
        'UNSUPPORTED_MUTATION',
        'historical operation event has an invalid ASIN and is read-only until reconciled',
      );
    }
    if (
      event.evidencePath !== undefined
      && !this.evidenceArtifactIsValid(store, event.evidencePath)
      && !options.allowInvalidEvidenceReference
    ) {
      throw new StoreScopedObjectsError(
        'UNSUPPORTED_MUTATION',
        'historical operation event has an untrusted evidence reference and is read-only until reconciled',
      );
    }
  }

  private requireMutationRevision(input: Record<string, unknown>): string {
    if (input.expectedRevision === undefined) {
      if (input.expectedUpdatedAt !== undefined) {
        throw new StoreScopedObjectsError(
          'CAS_UNAVAILABLE',
          'updatedAt is second-resolution and cannot safely authorize a write; reload and send expectedRevision',
        );
      }
      throw new StoreScopedObjectsError(
        'CAS_REQUIRED',
        'expectedRevision is required for update, archive, and restore mutations',
      );
    }
    if (typeof input.expectedRevision !== 'string' || input.expectedRevision.length === 0) {
      throw new StoreScopedObjectsError('OBJECT_CONFLICT', 'object changed after it was read');
    }
    return input.expectedRevision;
  }

  private assertExpectedRevision(expectedRevision: string, actualRevision: string): void {
    if (expectedRevision !== actualRevision) {
      throw new StoreScopedObjectsError('OBJECT_CONFLICT', 'object changed after it was read');
    }
  }
}

const IDENTITY_HINT_KEYS = new Set([
  'storeName',
  'store_name',
  'marketplace',
  'marketplaceCode',
  'marketplace_code',
  'currency',
]);
const PRODUCT_LIST_KEYS = new Set([...IDENTITY_HINT_KEYS, 'includeArchived']);
const PRODUCT_LOOKUP_KEYS = new Set([...IDENTITY_HINT_KEYS, 'id', 'asin']);
const PRODUCT_CREATE_KEYS = new Set([
  ...IDENTITY_HINT_KEYS,
  'asin',
  'parentAsin',
  'parent_asin',
  'msku',
  'sku',
  'title',
  'productStage',
  'product_stage',
  'status',
  'cost',
]);
const PRODUCT_PATCH_KEYS = new Set(PRODUCT_CREATE_KEYS);
PRODUCT_PATCH_KEYS.delete('cost');
const PRODUCT_UPDATE_KEYS = new Set(['id', 'expectedRevision', 'expectedUpdatedAt', 'patch', 'cost']);
const VERSIONED_ID_KEYS = new Set(['id', 'expectedRevision', 'expectedUpdatedAt']);
const EVENT_FIELDS = [
  'eventDate',
  'asin',
  'campaignName',
  'adGroupName',
  'eventType',
  'title',
  'impactExpectation',
  'notes',
] as const;
const EVENT_CREATE_KEYS = new Set([...IDENTITY_HINT_KEYS, ...EVENT_FIELDS, 'evidenceArtifactId']);
const EVENT_PATCH_KEYS = new Set(EVENT_CREATE_KEYS);
EVENT_PATCH_KEYS.add('archived');
const EVENT_LIST_KEYS = new Set([
  ...IDENTITY_HINT_KEYS,
  'dateFrom',
  'dateTo',
  'asin',
  'campaignName',
  'adGroupName',
  'eventType',
  'limit',
  'includeArchived',
]);
const EVENT_UPDATE_KEYS = new Set(['id', 'expectedRevision', 'expectedUpdatedAt', 'patch']);

function normalizeProductCreate(
  store: StoreRecord,
  input: Record<string, unknown>,
  asin: string,
): Omit<Product, 'id' | 'created_at' | 'updated_at'> {
  const status = optionalText(input.status, 'status', 32) ?? 'active';
  if (status !== 'active' && status !== 'inactive') {
    throw invalid('new product status must be active or inactive');
  }
  return {
    asin,
    store_name: store.displayName,
    marketplace_code: 'US',
    parent_asin: optionalText(firstDefined(input.parentAsin, input.parent_asin), 'parentAsin', 64) ?? '',
    msku: optionalText(input.msku, 'msku', 200) ?? '',
    sku: optionalText(input.sku, 'sku', 200) ?? '',
    title: optionalText(input.title, 'title', 1000) ?? '',
    product_stage: optionalText(firstDefined(input.productStage, input.product_stage), 'productStage', 100) ?? 'keyword_exploration',
    status,
  };
}

function mergeProductPatch(
  store: StoreRecord,
  current: StoreScopedProductWithCost,
  patch: Record<string, unknown>,
): Partial<Product> & { asin: string; store_name: string; marketplace_code: string } {
  const status = patch.status === undefined
    ? current.status
    : requiredText(patch.status, 'status', 32);
  if (status !== 'active' && status !== 'inactive') {
    throw invalid('product update status must be active or inactive; use archiveProduct for archive');
  }
  return {
    ...copyProductForWrite(store, current),
    parent_asin: patch.parentAsin !== undefined || patch.parent_asin !== undefined
      ? optionalText(firstDefined(patch.parentAsin, patch.parent_asin), 'parentAsin', 64) ?? ''
      : current.parent_asin,
    msku: patch.msku !== undefined ? optionalText(patch.msku, 'msku', 200) ?? '' : current.msku,
    sku: patch.sku !== undefined ? optionalText(patch.sku, 'sku', 200) ?? '' : current.sku,
    title: patch.title !== undefined ? optionalText(patch.title, 'title', 1000) ?? '' : current.title,
    product_stage: patch.productStage !== undefined || patch.product_stage !== undefined
      ? optionalText(firstDefined(patch.productStage, patch.product_stage), 'productStage', 100) ?? ''
      : current.product_stage,
    status,
  };
}

function copyProductForWrite(
  store: StoreRecord,
  product: StoreScopedProductWithCost,
): Partial<Product> & { asin: string; store_name: string; marketplace_code: string } {
  return {
    asin: product.asin,
    store_name: store.displayName,
    marketplace_code: 'US',
    parent_asin: product.parent_asin,
    msku: product.msku,
    sku: product.sku,
    title: product.title,
    product_stage: product.product_stage,
    status: product.status,
  };
}

function normalizeCostPatch(input: unknown, create: boolean): Partial<ProductCost> {
  const value = requireObject(input, 'product cost');
  const allowed = new Set([
    'purchaseCost',
    'firstLegCost',
    'fbaFee',
    'referralFeeRate',
    'storageFee',
    'otherCost',
    'currentPrice',
    'minPrice',
    'targetNetMargin',
    'targetAcos',
    'targetTacos',
  ]);
  rejectUnknownKeys(value, allowed, 'product cost');
  if (Object.keys(value).length === 0) throw invalid('product cost patch cannot be empty');
  const patch: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const number = finiteNumber(raw, key);
    if (key === 'targetNetMargin') {
      if (number < -1 || number > 1) throw invalid(`${key} must be between -1 and 1`);
    } else if (key === 'referralFeeRate' || key === 'targetAcos' || key === 'targetTacos') {
      if (number < 0 || number > 1) throw invalid(`${key} must be between 0 and 1`);
    } else if (number < 0) {
      throw invalid(`${key} cannot be negative`);
    }
    patch[key] = number;
  }
  if (create && patch.referralFeeRate === undefined) patch.referralFeeRate = 0.15;
  return patch;
}

function normalizeEventFilter(input: Record<string, unknown>): Omit<OperationEventFilter, 'storeName'> {
  const filter: Omit<OperationEventFilter, 'storeName'> = { marketplaceCode: 'US' };
  if (input.dateFrom !== undefined) filter.dateFrom = normalizeDate(input.dateFrom, 'dateFrom');
  if (input.dateTo !== undefined) filter.dateTo = normalizeDate(input.dateTo, 'dateTo');
  if (filter.dateFrom && filter.dateTo && filter.dateFrom > filter.dateTo) {
    throw invalid('dateFrom must not be after dateTo');
  }
  if (input.asin !== undefined) filter.asin = normalizeAsin(input.asin);
  if (input.campaignName !== undefined) filter.campaignName = requiredText(input.campaignName, 'campaignName', 500);
  if (input.adGroupName !== undefined) filter.adGroupName = requiredText(input.adGroupName, 'adGroupName', 500);
  if (input.eventType !== undefined) filter.eventType = requiredText(input.eventType, 'eventType', 100);
  if (input.limit !== undefined) {
    const limit = positiveInteger(input.limit, 'limit');
    if (limit > 1000) throw invalid('limit cannot exceed 1000');
    filter.limit = limit;
  }
  return filter;
}

function normalizeEventCreate(
  store: StoreRecord,
  input: Record<string, unknown>,
  validateEvidenceArtifact: (artifactId: string) => boolean,
): CreateOperationEventInput {
  return {
    eventDate: normalizeDate(input.eventDate, 'eventDate'),
    storeName: store.displayName,
    marketplaceCode: 'US',
    asin: input.asin === undefined ? undefined : normalizeAsin(input.asin),
    campaignName: optionalText(input.campaignName, 'campaignName', 500),
    adGroupName: optionalText(input.adGroupName, 'adGroupName', 500),
    eventType: requiredText(input.eventType, 'eventType', 100),
    title: requiredText(input.title, 'title', 500),
    impactExpectation: optionalText(input.impactExpectation, 'impactExpectation', 100),
    notes: optionalText(input.notes, 'notes', 10_000),
    evidencePath: normalizeEvidenceArtifactId(input.evidenceArtifactId, validateEvidenceArtifact),
  };
}

function normalizeEventPatch(
  store: StoreRecord,
  current: StoreScopedOperationEvent,
  patch: Record<string, unknown>,
  validateEvidenceArtifact: (artifactId: string) => boolean,
): UpdateOperationEventInput {
  const hasBusinessPatch = Object.keys(patch).some((key) => (
    !IDENTITY_HINT_KEYS.has(key) && key !== 'archived'
  ));
  if (!hasBusinessPatch) throw invalid('operation event patch cannot be empty');
  const merged = {
    ...current,
    ...patch,
    evidenceArtifactId: Object.prototype.hasOwnProperty.call(patch, 'evidenceArtifactId')
      ? patch.evidenceArtifactId
      : current.evidencePath,
  };
  const normalized = normalizeEventCreate(store, merged, validateEvidenceArtifact);
  const output: UpdateOperationEventInput = {
    storeName: store.displayName,
    marketplaceCode: 'US',
  };
  for (const key of EVENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) output[key] = normalized[key];
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'evidenceArtifactId')) {
    output.evidencePath = normalized.evidencePath;
  }
  return output;
}

function productRevision(product: StoreScopedProductWithCost): string {
  return revision('product-v1', [
    product.storeId,
    product.id,
    product.asin,
    product.parent_asin,
    product.msku,
    product.sku,
    product.title,
    product.product_stage,
    product.status,
    product.created_at,
    product.updated_at,
    product.cost
      ? [
          product.cost.purchaseCost,
          product.cost.firstLegCost,
          product.cost.fbaFee,
          product.cost.referralFeeRate,
          product.cost.storageFee,
          product.cost.otherCost,
          product.cost.currentPrice,
          product.cost.minPrice,
          product.cost.targetNetMargin,
          product.cost.targetAcos,
          product.cost.targetTacos,
          product.cost.updatedAt,
        ]
      : null,
  ]);
}

function eventRevision(event: StoreScopedOperationEvent): string {
  return revision('operation-event-v1', [
    event.storeId,
    event.id,
    event.eventDate,
    event.asin,
    event.campaignName,
    event.adGroupName,
    event.eventType,
    event.title,
    event.impactExpectation,
    event.notes,
    event.evidencePath,
    event.createdAt,
    event.updatedAt,
    event.archivedAt,
    event.archiveRevision,
  ]);
}

function revision(prefix: string, value: unknown): string {
  const digest = createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return `${prefix}:${digest}`;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw invalid(`${label} contains unsupported fields: ${unknown.join(', ')}`);
}

function normalizeIdentityText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeAsin(value: unknown): string {
  try {
    return canonicalizeAmazonAsin(value);
  } catch {
    throw invalid('asin must be exactly 10 ASCII letters or digits');
  }
}

const RENDERER_ARTIFACT_ID_PATTERN = /^artifact:v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeEvidenceArtifactId(
  value: unknown,
  validateEvidenceArtifact: (artifactId: string) => boolean,
): string | undefined {
  const artifactId = optionalText(value, 'evidenceArtifactId', 512);
  if (artifactId === undefined) return undefined;
  if (!RENDERER_ARTIFACT_ID_PATTERN.test(artifactId) || !validateEvidenceArtifact(artifactId)) {
    throw invalid('evidenceArtifactId must be a current-store Artifact issued by Main or empty');
  }
  return artifactId;
}

function canonicalEventAsin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return canonicalizeAmazonAsin(value);
  } catch {
    return undefined;
  }
}

function normalizeDate(value: unknown, label: string): string {
  const date = requiredText(value, label, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw invalid(`${label} must use YYYY-MM-DD`);
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() !== Number(match[2]) - 1
    || parsed.getUTCDate() !== Number(match[3])
  ) throw invalid(`${label} must be a real date`);
  return date;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw invalid(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw invalid(`${label} cannot be empty`);
  if (normalized.length > maxLength) throw invalid(`${label} cannot exceed ${maxLength} characters`);
  return normalized;
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid(`${label} must be a string`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw invalid(`${label} cannot exceed ${maxLength} characters`);
  return normalized || undefined;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw invalid(`${label} must be a boolean`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw invalid(`${label} must be a positive integer`);
  return parsed;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value === 'string' && value.trim() === '') throw invalid(`${label} must be a number`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw invalid(`${label} must be a finite number`);
  return parsed;
}

function firstDefined(first: unknown, second: unknown): unknown {
  return first !== undefined ? first : second;
}

function invalid(message: string): StoreScopedObjectsError {
  return new StoreScopedObjectsError('INVALID_INPUT', message);
}

function notFound(label: string): StoreScopedObjectsError {
  return new StoreScopedObjectsError('OBJECT_NOT_FOUND', `${label} was not found in the active store`);
}

function isSqliteConstraint(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && String((error as { code?: unknown }).code).startsWith('SQLITE_CONSTRAINT'),
  );
}
