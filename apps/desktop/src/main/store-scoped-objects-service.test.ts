import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Database } from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  BrowserProfileId,
  StoreId,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { initSqlite } from '@amazon-ai-ops/local-db/src/sqlite/db';
import { StoreRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/store-repo';
import { ProductRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/product-repo';
import { OperationEventRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/operation-event-repo';
import {
  StoreCoordinator,
  type StoreSessionGenerationAuthority,
} from './store-coordinator';
import {
  StoreScopedObjectsError,
  StoreScopedObjectsService,
} from './store-scoped-objects-service';

class MemorySessions implements StoreSessionGenerationAuthority {
  private readonly values = new Map<StoreId, number>();

  current(storeId: StoreId): number {
    return this.values.get(storeId) ?? 0;
  }

  advance(storeId: StoreId): number {
    const next = this.current(storeId) + 1;
    this.values.set(storeId, next);
    return next;
  }

  advanceMany(storeIds: readonly StoreId[]): ReadonlyMap<StoreId, number> {
    return new Map(storeIds.map((storeId) => [storeId, this.advance(storeId)]));
  }

  assertCurrent(context: StoreContextEnvelope): void {
    if (context.sessionGeneration !== this.current(context.storeId)) {
      throw new Error('stale generation');
    }
  }
}

interface Harness {
  db: Database;
  dir: string;
  coordinator: StoreCoordinator;
  service: StoreScopedObjectsService;
  productRepository: ProductRepository;
  operationEventRepository: OperationEventRepository;
  firstStoreId: StoreId;
  secondStoreId: StoreId;
  switchFirst(): StoreContextEnvelope;
  switchSecond(): StoreContextEnvelope;
}

const harnesses: Harness[] = [];
const VALID_EVENT_ARTIFACT_ID = 'artifact:v1:00000000-0000-4000-8000-000000000001';
const REPLACEMENT_EVENT_ARTIFACT_ID = 'artifact:v1:00000000-0000-4000-8000-000000000002';

afterEach(() => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop()!;
    if (harness.db.open) harness.db.close();
    fs.rmSync(harness.dir, { recursive: true, force: true });
  }
});

function createHarness(): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-store-objects-'));
  const db = initSqlite(path.join(dir, 'objects.db'));
  const storeRepository = new StoreRepository(db);
  let storeSequence = 0;
  const coordinator = new StoreCoordinator({
    repository: storeRepository,
    sessions: new MemorySessions(),
    now: () => new Date('2026-07-22T18:00:00.000Z'),
    createStoreId: () => `objects-store-${++storeSequence}` as StoreId,
    createBrowserProfileId: (storeId) => `browser-${storeId}` as BrowserProfileId,
  });
  const first = coordinator.createStore({ displayName: 'Same US Store' });
  const second = coordinator.createStore({ displayName: 'Same US Store' });
  const productRepository = new ProductRepository(db);
  const operationEventRepository = new OperationEventRepository(db);
  const service = new StoreScopedObjectsService({
    storeCoordinator: coordinator,
    productRepository,
    operationEventRepository,
    validateEvidenceArtifact: (_store, artifactId) => artifactId === VALID_EVENT_ARTIFACT_ID,
  });
  const harness: Harness = {
    db,
    dir,
    coordinator,
    service,
    productRepository,
    operationEventRepository,
    firstStoreId: first.storeId,
    secondStoreId: second.storeId,
    switchFirst: () => coordinator.switchStore(first.storeId).context,
    switchSecond: () => coordinator.switchStore(second.storeId).context,
  };
  harnesses.push(harness);
  return harness;
}

function createProduct(
  service: StoreScopedObjectsService,
  context: StoreContextEnvelope,
  title: string,
) {
  return service.createProduct(context, {
    asin: 'B0SAME0001',
    title,
    sku: 'SKU-1',
    productStage: 'stable',
    cost: {
      currentPrice: 29.99,
      purchaseCost: 7.25,
      targetAcos: 0.28,
      targetTacos: 0.12,
    },
  });
}

function createEvent(
  service: StoreScopedObjectsService,
  context: StoreContextEnvelope,
  title = 'Coupon launched',
) {
  return service.createOperationEvent(context, {
    eventDate: '2026-07-22',
    asin: 'B0SAME0001',
    eventType: 'coupon',
    title,
    impactExpectation: 'conversion_up',
    notes: 'Track the impact against daily advertising data.',
  });
}

describe('StoreScopedObjectsService', () => {
  it('isolates two same-name US stores and rejects stale contexts and cross-store ids', () => {
    const harness = createHarness();
    const firstContext = harness.switchFirst();
    const firstProduct = createProduct(harness.service, firstContext, 'First store product');
    const firstEvent = createEvent(harness.service, firstContext, 'First store event');

    const secondContext = harness.switchSecond();
    const secondProduct = createProduct(harness.service, secondContext, 'Second store product');
    createEvent(harness.service, secondContext, 'Second store event');

    expect(secondProduct.id).not.toBe(firstProduct.id);
    expect(harness.service.listProducts(secondContext)).toEqual([
      expect.objectContaining({
        storeId: harness.secondStoreId,
        store_name: 'Same US Store',
        marketplace_code: 'US',
        asin: 'B0SAME0001',
        title: 'Second store product',
      }),
    ]);
    expect(harness.service.listOperationEvents(secondContext)).toEqual([
      expect.objectContaining({ storeId: harness.secondStoreId, title: 'Second store event' }),
    ]);

    expect(() => harness.service.getProduct(secondContext, { id: firstProduct.id }))
      .toThrowError(expect.objectContaining({ code: 'OBJECT_NOT_FOUND' }));
    expect(() => harness.service.updateOperationEvent(secondContext, {
      id: firstEvent.id,
      expectedRevision: firstEvent.revision,
      patch: { title: 'Cross-store overwrite' },
    })).toThrowError(expect.objectContaining({ code: 'OBJECT_NOT_FOUND' }));
    expect(() => harness.service.listProducts(firstContext)).toThrow(/stale generation/);

    const refreshedFirstContext = harness.switchFirst();
    expect(harness.service.listProducts(refreshedFirstContext)).toEqual([
      expect.objectContaining({
        storeId: harness.firstStoreId,
        title: 'First store product',
      }),
    ]);
    expect(harness.service.listOperationEvents(refreshedFirstContext)).toEqual([
      expect.objectContaining({ title: 'First store event' }),
    ]);
  });

  it('supports versioned product and cost CRUD, archives through status, and rejects stale writes', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    const created = createProduct(harness.service, context, 'Original title');

    expect(created).toMatchObject({
      storeId: harness.firstStoreId,
      status: 'active',
      cost: {
        currentPrice: 29.99,
        purchaseCost: 7.25,
        referralFeeRate: 0.15,
        targetAcos: 0.28,
        targetTacos: 0.12,
      },
    });
    expect(created.revision).toMatch(/^product-v1:[a-f0-9]{64}$/);

    const updated = harness.service.updateProduct(context, {
      id: created.id,
      expectedRevision: created.revision,
      patch: { title: 'Updated title', productStage: 'scale' },
      cost: { currentPrice: 31.5, targetAcos: 0.25 },
    });
    expect(updated).toMatchObject({
      id: created.id,
      title: 'Updated title',
      product_stage: 'scale',
      cost: { currentPrice: 31.5, targetAcos: 0.25, purchaseCost: 7.25 },
    });
    expect(updated.revision).not.toBe(created.revision);

    expect(() => harness.service.updateProduct(context, {
      id: created.id,
      expectedRevision: created.revision,
      patch: { title: 'Stale overwrite' },
    })).toThrowError(expect.objectContaining({ code: 'OBJECT_CONFLICT' }));
    expect(() => harness.service.updateProduct(context, {
      id: created.id,
      expectedUpdatedAt: updated.updated_at,
      patch: { title: 'Timestamp-only overwrite' },
    })).toThrowError(expect.objectContaining({ code: 'CAS_UNAVAILABLE' }));
    expect(harness.service.getProduct(context, { id: created.id }).title).toBe('Updated title');

    const archived = harness.service.archiveProduct(context, {
      id: updated.id,
      expectedRevision: updated.revision,
    });
    expect(archived.status).toBe('archived');
    expect(harness.service.listProducts(context)).toEqual([]);
    expect(harness.service.listProducts(context, { includeArchived: true })).toEqual([
      expect.objectContaining({ id: created.id, status: 'archived' }),
    ]);
  });

  it('archives operation events with CAS, hides them by default, and restores durable history', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    const created = createEvent(harness.service, context);
    expect(created).toMatchObject({
      storeId: harness.firstStoreId,
      storeName: 'Same US Store',
      marketplaceCode: 'US',
      title: 'Coupon launched',
    });
    expect(created.revision).toMatch(/^operation-event-v1:[a-f0-9]{64}$/);

    const updated = harness.service.updateOperationEvent(context, {
      id: created.id,
      expectedRevision: created.revision,
      patch: {
        title: 'Coupon performance reviewed',
        notes: 'Conversion improved; keep observing ACOS.',
      },
    });
    expect(updated.title).toBe('Coupon performance reviewed');
    expect(updated.revision).not.toBe(created.revision);
    expect(harness.service.listOperationEvents(context, {
      asin: 'b0same0001',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    })).toEqual([expect.objectContaining({ id: created.id })]);

    expect(() => harness.service.deleteOperationEvent(context, {
      id: created.id,
      expectedRevision: created.revision,
    })).toThrowError(expect.objectContaining({ code: 'OBJECT_CONFLICT' }));
    expect(harness.service.listOperationEvents(context)).toHaveLength(1);

    const archived = harness.service.deleteOperationEvent(context, {
      id: updated.id,
      expectedRevision: updated.revision,
    });
    expect(archived).toMatchObject({
      id: updated.id,
      storeId: harness.firstStoreId,
      title: 'Coupon performance reviewed',
      archivedAt: expect.any(String),
      archiveRevision: 1,
    });
    expect(archived.revision).not.toBe(updated.revision);
    expect(harness.service.listOperationEvents(context)).toEqual([]);
    expect(harness.service.listOperationEvents(context, { includeArchived: true })).toEqual([
      expect.objectContaining({
        id: updated.id,
        archivedAt: archived.archivedAt,
        archiveRevision: 1,
      }),
    ]);
    expect(harness.db.prepare('SELECT COUNT(*) AS count FROM operation_events WHERE id = ?')
      .get(updated.id)).toEqual({ count: 1 });

    expect(() => harness.service.updateOperationEvent(context, {
      id: archived.id,
      expectedRevision: archived.revision,
      patch: { title: 'Archived overwrite' },
    })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => harness.service.updateOperationEvent(context, {
      id: archived.id,
      expectedRevision: archived.revision,
      patch: { archived: false, title: 'Restore and overwrite' },
    })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));

    const restored = harness.service.updateOperationEvent(context, {
      id: archived.id,
      expectedRevision: archived.revision,
      patch: { archived: false },
    });
    expect(restored).toMatchObject({
      id: updated.id,
      archivedAt: undefined,
      archiveRevision: 2,
      title: 'Coupon performance reviewed',
    });
    expect(restored.revision).not.toBe(archived.revision);
    expect(harness.service.listOperationEvents(context)).toEqual([
      expect.objectContaining({ id: restored.id, archiveRevision: 2 }),
    ]);

    expect(() => harness.service.updateOperationEvent(context, {
      id: restored.id,
      expectedRevision: archived.revision,
      patch: { archived: false },
    })).toThrowError(expect.objectContaining({ code: 'OBJECT_CONFLICT' }));
  });

  it('keeps archived operation-event history isolated to its owning store', () => {
    const harness = createHarness();
    const firstContext = harness.switchFirst();
    const event = createEvent(harness.service, firstContext, 'First store history');
    const archived = harness.service.deleteOperationEvent(firstContext, {
      id: event.id,
      expectedRevision: event.revision,
    });

    const secondContext = harness.switchSecond();
    expect(harness.service.listOperationEvents(secondContext, { includeArchived: true })).toEqual([]);
    expect(() => harness.service.updateOperationEvent(secondContext, {
      id: archived.id,
      expectedRevision: archived.revision,
      patch: { archived: false },
    })).toThrowError(expect.objectContaining({ code: 'OBJECT_NOT_FOUND' }));

    const refreshedFirst = harness.switchFirst();
    expect(harness.service.listOperationEvents(refreshedFirst, { includeArchived: true }))
      .toEqual([expect.objectContaining({ id: archived.id, archivedAt: expect.any(String) })]);
  });

  it('keeps product and event CAS compare, mutation, and readback in one transaction', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    const product = createProduct(harness.service, context, 'Transactional product');
    const event = createEvent(harness.service, context, 'Transactional event');
    const transactionStates: boolean[] = [];

    const originalProductUpdate = harness.productRepository.upsertWithCostForStore
      .bind(harness.productRepository);
    harness.productRepository.upsertWithCostForStore = ((...args: Parameters<
      ProductRepository['upsertWithCostForStore']
    >) => {
      transactionStates.push(harness.db.inTransaction);
      return originalProductUpdate(...args);
    }) as ProductRepository['upsertWithCostForStore'];

    const originalEventUpdate = harness.operationEventRepository.updateForStore
      .bind(harness.operationEventRepository);
    harness.operationEventRepository.updateForStore = ((...args: Parameters<
      OperationEventRepository['updateForStore']
    >) => {
      transactionStates.push(harness.db.inTransaction);
      return originalEventUpdate(...args);
    }) as OperationEventRepository['updateForStore'];

    const originalEventArchive = harness.operationEventRepository.archiveForStore
      .bind(harness.operationEventRepository);
    harness.operationEventRepository.archiveForStore = ((...args: Parameters<
      OperationEventRepository['archiveForStore']
    >) => {
      transactionStates.push(harness.db.inTransaction);
      return originalEventArchive(...args);
    }) as OperationEventRepository['archiveForStore'];

    harness.service.updateProduct(context, {
      id: product.id,
      expectedRevision: product.revision,
      patch: { title: 'Transactional product updated' },
      cost: { currentPrice: 30.5 },
    });
    const updatedEvent = harness.service.updateOperationEvent(context, {
      id: event.id,
      expectedRevision: event.revision,
      patch: { title: 'Transactional event updated' },
    });
    harness.service.deleteOperationEvent(context, {
      id: updatedEvent.id,
      expectedRevision: updatedEvent.revision,
    });

    expect(transactionStates).toEqual([true, true, true]);
  });

  it('rejects non-canonical ASIN writes and accepts only current-store Main artifacts', () => {
    const harness = createHarness();
    const context = harness.switchFirst();

    expect(() => harness.service.createProduct(context, {
      asin: 'B0SHORT1',
      title: 'Invalid product',
    })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => harness.service.createOperationEvent(context, {
      eventDate: '2026-07-22',
      eventType: 'note',
      title: 'Unsafe evidence',
      evidenceArtifactId: 'C:\\Users\\operator\\Desktop\\proof.png',
    })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => harness.service.createOperationEvent(context, {
      eventDate: '2026-07-22',
      eventType: 'note',
      title: 'Unsafe UNC evidence',
      evidenceArtifactId: '\\\\server\\share\\proof.png',
    })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));

    const safe = harness.service.createOperationEvent(context, {
      eventDate: '2026-07-22',
      asin: 'b0same0001',
      eventType: 'note',
      title: 'Controlled evidence',
      evidenceArtifactId: VALID_EVENT_ARTIFACT_ID,
    });
    expect(safe).toMatchObject({
      asin: 'B0SAME0001',
      evidenceArtifactId: VALID_EVENT_ARTIFACT_ID,
      evidenceRefValid: true,
    });
    expect(harness.db.prepare('SELECT COUNT(*) AS count FROM products').get())
      .toEqual({ count: 0 });
    expect(harness.db.prepare('SELECT COUNT(*) AS count FROM operation_events').get())
      .toEqual({ count: 1 });
  });

  it('projects legacy evidence paths as path-free read-only rows', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    const id = harness.operationEventRepository.createForStore(context.storeId, {
      eventDate: '2026-07-22',
      storeName: 'Same US Store',
      marketplaceCode: 'US',
      asin: 'BAD',
      eventType: 'legacy_note',
      title: 'Legacy unsafe event',
      evidencePath: 'C:\\Users\\operator\\Desktop\\proof.png',
    });

    const [legacy] = harness.service.listOperationEvents(context);
    expect(legacy).toMatchObject({
      id,
      asin: 'BAD',
      asinValid: false,
      evidenceRefValid: false,
    });
    expect(legacy).not.toHaveProperty('evidencePath');
    expect(legacy).not.toHaveProperty('evidenceArtifactId');
    expect(() => harness.service.deleteOperationEvent(context, {
      id,
      expectedRevision: legacy.revision,
    })).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_MUTATION' }));
    expect(() => harness.service.updateOperationEvent(context, {
      id,
      expectedRevision: legacy.revision,
      patch: { title: 'Attempted rewrite' },
    })).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_MUTATION' }));
  });

  it('projects path-bearing event text safely across create, update, and list readbacks', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    const created = harness.service.createOperationEvent(context, {
      eventDate: '2026-07-22',
      eventType: 'manual_note',
      title: '促销证据 C:\\Users\\operator\\Desktop\\coupon.png 已确认',
      notes: '回读 file:///C:/Exports/result.csv；转化上升。',
    });

    expect(created).toMatchObject({
      title: '促销证据 [本地文件] 已确认',
      notes: '回读 [本地文件]；转化上升。',
    });

    const updated = harness.service.updateOperationEvent(context, {
      id: created.id,
      expectedRevision: created.revision,
      patch: {
        title: '共享证据 \\\\fileserver\\ads\\proof.xlsx 已复核',
      },
    });
    expect(updated.title).toBe('共享证据 [本地文件] 已复核');
    expect(harness.service.listOperationEvents(context)).toEqual([
      expect.objectContaining({
        id: created.id,
        title: '共享证据 [本地文件] 已复核',
        notes: '回读 [本地文件]；转化上升。',
      }),
    ]);
    expect(JSON.stringify(updated)).not.toMatch(/fileserver|C:\\Exports|file:\/\//i);
  });

  it('allows a revision-locked clear when a persisted evidence capability expires after restart', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    const created = harness.service.createOperationEvent(context, {
      eventDate: '2026-07-22',
      eventType: 'manual_note',
      title: 'Evidence expires after restart',
      evidenceArtifactId: VALID_EVENT_ARTIFACT_ID,
    });
    const restartedService = new StoreScopedObjectsService({
      storeCoordinator: harness.coordinator,
      productRepository: harness.productRepository,
      operationEventRepository: harness.operationEventRepository,
      validateEvidenceArtifact: () => false,
    });
    const [staleReference] = restartedService.listOperationEvents(context);
    expect(staleReference).toMatchObject({
      id: created.id,
      evidenceRefValid: false,
    });
    expect(staleReference).not.toHaveProperty('evidenceArtifactId');

    expect(() => restartedService.updateOperationEvent(context, {
      id: created.id,
      expectedRevision: 'operation-event-v1:stale',
      patch: { evidenceArtifactId: null },
    })).toThrowError(expect.objectContaining({ code: 'OBJECT_CONFLICT' }));

    const cleared = restartedService.updateOperationEvent(context, {
      id: created.id,
      expectedRevision: staleReference.revision,
      patch: { evidenceArtifactId: null },
    });
    expect(cleared.evidenceRefValid).toBe(true);
    expect(cleared).not.toHaveProperty('evidenceArtifactId');
    expect(harness.operationEventRepository.getByIdForStore(context.storeId, created.id)?.evidencePath)
      .toBeUndefined();
  });

  it('allows a revision-locked replacement when Main issues a new current-store evidence capability', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    const created = harness.service.createOperationEvent(context, {
      eventDate: '2026-07-22',
      eventType: 'manual_note',
      title: 'Replace expired evidence',
      evidenceArtifactId: VALID_EVENT_ARTIFACT_ID,
    });
    const restartedService = new StoreScopedObjectsService({
      storeCoordinator: harness.coordinator,
      productRepository: harness.productRepository,
      operationEventRepository: harness.operationEventRepository,
      validateEvidenceArtifact: (_store, artifactId) => artifactId === REPLACEMENT_EVENT_ARTIFACT_ID,
    });
    const [staleReference] = restartedService.listOperationEvents(context);

    const replaced = restartedService.updateOperationEvent(context, {
      id: created.id,
      expectedRevision: staleReference.revision,
      patch: { evidenceArtifactId: REPLACEMENT_EVENT_ARTIFACT_ID },
    });
    expect(replaced).toMatchObject({
      evidenceArtifactId: REPLACEMENT_EVENT_ARTIFACT_ID,
      evidenceRefValid: true,
    });
    expect(harness.operationEventRepository.getByIdForStore(context.storeId, created.id)?.evidencePath)
      .toBe(REPLACEMENT_EVENT_ARTIFACT_ID);
  });

  it('allows revision-locked archive and restore after an evidence capability expires', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    const created = harness.service.createOperationEvent(context, {
      eventDate: '2026-07-22',
      eventType: 'manual_note',
      title: 'Durable event history',
      evidenceArtifactId: VALID_EVENT_ARTIFACT_ID,
    });
    const restartedService = new StoreScopedObjectsService({
      storeCoordinator: harness.coordinator,
      productRepository: harness.productRepository,
      operationEventRepository: harness.operationEventRepository,
      validateEvidenceArtifact: () => false,
    });
    const [staleReference] = restartedService.listOperationEvents(context);

    const archived = restartedService.deleteOperationEvent(context, {
      id: created.id,
      expectedRevision: staleReference.revision,
    });
    expect(archived).toMatchObject({
      archivedAt: expect.any(String),
      evidenceRefValid: false,
    });
    expect(archived).not.toHaveProperty('evidenceArtifactId');

    const restored = restartedService.updateOperationEvent(context, {
      id: created.id,
      expectedRevision: archived.revision,
      patch: { archived: false },
    });
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.evidenceRefValid).toBe(false);
    expect(restored).not.toHaveProperty('evidenceArtifactId');
  });

  it('rejects forged identities and invalid payloads before writing any row', () => {
    const harness = createHarness();
    const context = harness.switchFirst();

    expect(() => harness.service.createProduct(context, {
      asin: 'B0FORGED01',
      storeName: 'Another Store',
    })).toThrowError(expect.objectContaining({ code: 'STORE_IDENTITY_MISMATCH' }));
    expect(() => harness.service.createProduct(context, {
      asin: 'B0FORGED02',
      currency: 'USDT',
    })).toThrowError(expect.objectContaining({ code: 'STORE_IDENTITY_MISMATCH' }));
    expect(() => harness.service.createProduct(context, {
      asin: 'B0INVALID1',
      cost: { purchaseCost: -1 },
    })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(harness.db.prepare('SELECT COUNT(*) AS count FROM products').get())
      .toEqual({ count: 0 });

    const event = createEvent(harness.service, context, 'Safe event');
    const before = harness.service.listOperationEvents(context)[0];
    expect(() => harness.service.updateOperationEvent(context, {
      id: event.id,
      expectedRevision: event.revision,
      patch: { storeName: 'Forged Store', title: 'Unsafe title' },
    })).toThrowError(expect.objectContaining({ code: 'STORE_IDENTITY_MISMATCH' }));
    expect(() => harness.service.createOperationEvent(context, {
      eventDate: '2026-02-30',
      eventType: 'note',
      title: 'Impossible date',
      marketplaceCode: 'DE',
    })).toThrowError(StoreScopedObjectsError);

    expect(harness.service.listOperationEvents(context)).toEqual([before]);
    expect(harness.db.prepare('SELECT COUNT(*) AS count FROM operation_events').get())
      .toEqual({ count: 1 });
  });
});
