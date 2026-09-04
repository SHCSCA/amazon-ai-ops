/**
 * V1.6 Memory Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { CausalEventRow, MemoryRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/v16-domain-repositories';
import { MemoryService, MemoryServiceError } from './v16-memory-service';

type MockRepo = Pick<MemoryRepository, 'append' | 'findByStore' | 'findTrustedByStore' | 'countByStore'>;

const storeA: StoreContextEnvelope = {
  storeId: 'store-a',
  marketplace: 'US',
  currency: 'USD',
  businessDate: '2026-09-03',
  sessionGeneration: 1,
};

function makeEvent(overrides: Partial<CausalEventRow> = {}): CausalEventRow {
  return {
    event_id: 'evt-1',
    store_id: 'store-a',
    stage: 'analysis',
    mission_id: null,
    decision_id: null,
    grant_id: null,
    execution_id: null,
    experiment_id: null,
    analysis_run_id: null,
    entity_id: null,
    product_id: null,
    business_date: '2026-09-03',
    event_type: 'analysis_started',
    session_generation: 1,
    proof_hash: 'ph-1',
    evidence_refs_json: '[]',
    summary: 'started',
    details_json: null,
    status: 'observed',
    memory_digest: null,
    created_at: '2026-09-03T10:00:00Z',
    correction_of: null,
    corrected_by: null,
    metadata: null,
    ...overrides,
  };
}

describe('V16MemoryService', () => {
  let service: MemoryService;
  let repo: MockRepo;

  beforeEach(() => {
    repo = {
      append: vi.fn(),
      findByStore: vi.fn(),
      findTrustedByStore: vi.fn(),
      countByStore: vi.fn(),
    };
    (repo.append as ReturnType<typeof vi.fn>).mockImplementation((e: CausalEventRow) => e);
    service = new MemoryService(repo as unknown as MemoryRepository);
  });

  it('append requires non-empty proof hash', () => {
    expect(() =>
      service.append({
        storeContext: storeA,
        stage: 'analysis',
        eventType: 'analysis_started',
        businessDate: '2026-09-03',
        sessionGeneration: 1,
        proofHash: '',
        summary: 'x',
      }),
    ).toThrow(MemoryServiceError);
  });

  it('append stores event with stable digest', () => {
    const event = service.append({
      storeContext: storeA,
      stage: 'analysis',
      eventType: 'analysis_started',
      businessDate: '2026-09-03',
      sessionGeneration: 1,
      proofHash: 'ph-1',
      summary: 'started',
    });
    expect(event.proofHash).toBe('ph-1');
    expect(event.memoryDigest).toBeTruthy();
    expect(repo.append).toHaveBeenCalled();
  });

  it('correct appends correction event referencing original', () => {
    (repo.findByStore as ReturnType<typeof vi.fn>).mockReturnValue([
      makeEvent({ event_id: 'evt-orig' }),
    ]);
    const correction = service.correct({
      storeContext: storeA,
      originalEventId: 'evt-orig',
      correctionEventType: 'correction',
      summary: 'corrected',
      proofHash: 'ph-2',
    });
    expect(correction).toBeTruthy();
    expect(repo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'correction',
        correction_of: 'evt-orig',
        status: 'trusted',
      }),
    );
  });

  it('correct fails when original not found', () => {
    (repo.findByStore as ReturnType<typeof vi.fn>).mockReturnValue([]);
    expect(() =>
      service.correct({
        storeContext: storeA,
        originalEventId: 'nope',
        correctionEventType: 'correction',
        summary: 'x',
        proofHash: 'ph-2',
      }),
    ).toThrow(/not found/);
  });

  it('correct rejects cross-store', () => {
    (repo.findByStore as ReturnType<typeof vi.fn>).mockReturnValue([
      makeEvent({ store_id: 'store-other' }),
    ]);
    expect(() =>
      service.correct({
        storeContext: storeA,
        originalEventId: 'evt-1',
        correctionEventType: 'correction',
        summary: 'x',
        proofHash: 'ph-2',
      }),
    ).toThrow(MemoryServiceError);
  });

  it('exportMemory filters by trustedOnly', () => {
    (repo.findByStore as ReturnType<typeof vi.fn>).mockReturnValue([
      makeEvent({ event_id: 'e1', status: 'trusted' }),
      makeEvent({ event_id: 'e2', status: 'observed' }),
    ]);
    const exportPayload = service.exportMemory({ storeContext: storeA, trustedOnly: true });
    expect(exportPayload.records.length).toBe(1); // Only trusted event
    expect(exportPayload.trustedCount).toBe(1);
    expect(exportPayload.recordCount).toBe(1); // Same as records.length when trustedOnly
  });

  it('searchByEntity returns matching events', () => {
    (repo.findByStore as ReturnType<typeof vi.fn>).mockReturnValue([
      makeEvent({ entity_id: 'kw-1' }),
      makeEvent({ entity_id: 'kw-2' }),
    ]);
    const results = service.searchByEntity({ storeContext: storeA, entityId: 'kw-1' });
    expect(results.length).toBe(1);
    expect(results[0].entityId).toBe('kw-1');
  });

  it('promoteToTrusted appends trusted correction event', () => {
    (repo.findByStore as ReturnType<typeof vi.fn>).mockReturnValue([
      makeEvent({ event_id: 'evt-1', stage: 'readback', status: 'observed' }),
    ]);
    service.promoteToTrusted({ storeContext: storeA, eventId: 'evt-1' });
    expect(repo.append).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'trusted', event_type: 'correction' }),
    );
  });

  it('promoteToTrusted rejects if stage is not readback/effect', () => {
    (repo.findByStore as ReturnType<typeof vi.fn>).mockReturnValue([
      makeEvent({ event_id: 'evt-1', stage: 'analysis' }),
    ]);
    expect(() =>
      service.promoteToTrusted({ storeContext: storeA, eventId: 'evt-1' }),
    ).toThrow(/must be readback or effect/);
  });
});
