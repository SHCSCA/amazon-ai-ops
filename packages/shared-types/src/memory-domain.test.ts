/**
 * Memory Domain Model Tests
 */

import { describe, it, expect } from 'vitest';
import {
  isIndexable,
  computeMemoryDigest,
  EVENT_TYPE_LABELS,
  type CausalEventRecord,
} from './memory-domain';

function makeEvent(overrides: Partial<CausalEventRecord> = {}): CausalEventRecord {
  return {
    eventId: 'evt_1',
    storeId: 'store-a',
    stage: 'effect',
    missionId: 'mission-1',
    businessDate: '2026-09-03',
    eventType: 'effect_observed',
    sessionGeneration: 1,
    proofHash: 'a'.repeat(64),
    evidenceRefs: [],
    summary: 'test event',
    status: 'trusted',
    createdAt: '2026-09-03T10:00:00Z',
    ...overrides,
  };
}

describe('MemoryDomain', () => {
  describe('isIndexable', () => {
    it('returns true for valid event in effect stage', () => {
      const event = makeEvent();
      expect(isIndexable(event)).toBe(true);
    });

    it('returns true for valid event in readback stage', () => {
      const event = makeEvent({ stage: 'readback' });
      expect(isIndexable(event)).toBe(true);
    });

    it('returns false without 64-char proof hash', () => {
      const event = makeEvent({ proofHash: 'short' });
      expect(isIndexable(event)).toBe(false);
    });

    it('returns false for non-readback/effect stage', () => {
      const event = makeEvent({ stage: 'analysis' });
      expect(isIndexable(event)).toBe(false);
    });

    it('returns false for non-trusted status', () => {
      const event = makeEvent({ status: 'disputed' });
      expect(isIndexable(event)).toBe(false);
    });

    it('returns false without provenance', () => {
      const event = makeEvent({
        missionId: undefined,
        decisionId: undefined,
        executionId: undefined,
      });
      expect(isIndexable(event)).toBe(false);
    });
  });

  describe('computeMemoryDigest', () => {
    it('produces consistent digest for same event', () => {
      const event = makeEvent();
      const digest1 = computeMemoryDigest(event);
      const digest2 = computeMemoryDigest(event);
      expect(digest1).toBe(digest2);
    });

    it('produces 32-character hex digest', () => {
      const event = makeEvent();
      const digest = computeMemoryDigest(event);
      expect(digest).toMatch(/^[a-f0-9]{32}$/);
    });

    it('produces different digest for different events', () => {
      const event1 = makeEvent({ eventId: 'evt_1' });
      const event2 = makeEvent({ eventId: 'evt_2' });
      expect(computeMemoryDigest(event1)).not.toBe(computeMemoryDigest(event2));
    });
  });

  describe('EVENT_TYPE_LABELS', () => {
    it('provides Chinese label for each event type', () => {
      expect(EVENT_TYPE_LABELS.fact_gathered).toBe('数据采集');
      expect(EVENT_TYPE_LABELS.analysis_completed).toBe('分析完成');
      expect(EVENT_TYPE_LABELS.decision_approved).toBe('建议批准');
      expect(EVENT_TYPE_LABELS.readback_verified).toBe('回读验证');
      expect(EVENT_TYPE_LABELS.effect_observed).toBe('效果观察');
    });
  });

  describe('validateCausalEventRecord', () => {
    it('accepts valid event', async () => {
      const { validateCausalEventRecord, buildCausalEventRecord } = await import('./memory-domain');

      const event = buildCausalEventRecord({
        eventId: 'evt-001',
        storeId: 'jf-us',
        stage: 'readback',
        businessDate: '2026-09-03',
        eventType: 'readback_verified',
        sessionGeneration: 1,
        proofHash: 'a'.repeat(64),
        evidenceRefs: [],
        summary: 'Readback verified',
        missionId: 'mission-001',
      });

      expect(() => validateCausalEventRecord(event)).not.toThrow();
    });

    it('rejects missing required fields', async () => {
      const { validateCausalEventRecord } = await import('./memory-domain');

      const event = makeEvent({ eventId: '' });
      expect(() => validateCausalEventRecord(event)).toThrow('Event ID is required');
    });

    it('rejects invalid business date format', async () => {
      const { validateCausalEventRecord } = await import('./memory-domain');

      const event = makeEvent({ businessDate: '2026/09/03' });
      expect(() => validateCausalEventRecord(event)).toThrow('Business date must be in YYYY-MM-DD format');
    });

    it('rejects invalid timestamp', async () => {
      const { validateCausalEventRecord } = await import('./memory-domain');

      const event = makeEvent({ createdAt: 'invalid-date' });
      expect(() => validateCausalEventRecord(event)).toThrow('Invalid created timestamp');
    });
  });

  describe('buildCausalEventRecord', () => {
    it('builds event with observed status', async () => {
      const { buildCausalEventRecord } = await import('./memory-domain');

      const event = buildCausalEventRecord({
        eventId: 'evt-001',
        storeId: 'jf-us',
        stage: 'action',
        businessDate: '2026-09-03',
        eventType: 'action_submitted',
        sessionGeneration: 1,
        proofHash: 'abc123',
        evidenceRefs: [],
        summary: 'Action submitted',
        missionId: 'mission-001',
        decisionId: 'dec-001',
        grantId: 'grant-001',
        executionId: 'exec-001',
      });

      expect(event.status).toBe('observed');
      expect(event.memoryDigest).toBeDefined();
      expect(event.createdAt).toBeDefined();
    });
  });

  describe('buildCorrectionEvent', () => {
    it('builds correction with correctionOf field', async () => {
      const { buildCorrectionEvent } = await import('./memory-domain');

      const correction = buildCorrectionEvent({
        eventId: 'evt-002',
        storeId: 'jf-us',
        correctionOf: 'evt-001',
        stage: 'readback',
        businessDate: '2026-09-03',
        sessionGeneration: 1,
        proofHash: 'def456',
        evidenceRefs: [],
        summary: 'Correcting previous event',
        missionId: 'mission-001',
      });

      expect(correction.eventType).toBe('correction');
      expect(correction.correctionOf).toBe('evt-001');
    });
  });

  describe('buildEvidenceRef', () => {
    it('builds screenshot evidence ref', async () => {
      const { buildEvidenceRef } = await import('./memory-domain');

      const ref = buildEvidenceRef({
        refType: 'screenshot',
        refPath: '/evidence/screenshot-001.png',
        refHash: 'sha256-abc',
        description: 'Before screenshot',
      });

      expect(ref.refType).toBe('screenshot');
      expect(ref.refPath).toBe('/evidence/screenshot-001.png');
    });

    it('builds value evidence ref', async () => {
      const { buildEvidenceRef } = await import('./memory-domain');

      const ref = buildEvidenceRef({
        refType: 'value',
        refValue: '1.50',
        description: 'Target bid',
      });

      expect(ref.refType).toBe('value');
      expect(ref.refValue).toBe('1.50');
    });
  });

  describe('safeExportEvent', () => {
    it('redacts local paths from evidence refs', async () => {
      const { safeExportEvent, buildCausalEventRecord, buildEvidenceRef } = await import('./memory-domain');

      const event = buildCausalEventRecord({
        eventId: 'evt-001',
        storeId: 'jf-us',
        stage: 'readback',
        businessDate: '2026-09-03',
        eventType: 'readback_verified',
        sessionGeneration: 1,
        proofHash: 'abc123',
        evidenceRefs: [
          buildEvidenceRef({
            refType: 'screenshot',
            refPath: '/local/secret/path/screenshot.png',
            refHash: 'sha256-abc',
          }),
        ],
        summary: 'Test event',
      });

      const exported = safeExportEvent(event);
      expect(exported.evidenceRefs[0].refPath).toBe('[REDACTED]');
    });

    it('preserves non-path evidence', async () => {
      const { safeExportEvent, buildCausalEventRecord, buildEvidenceRef } = await import('./memory-domain');

      const event = buildCausalEventRecord({
        eventId: 'evt-001',
        storeId: 'jf-us',
        stage: 'readback',
        businessDate: '2026-09-03',
        eventType: 'readback_verified',
        sessionGeneration: 1,
        proofHash: 'abc123',
        evidenceRefs: [
          buildEvidenceRef({
            refType: 'value',
            refValue: '1.50',
          }),
        ],
        summary: 'Test event',
      });

      const exported = safeExportEvent(event);
      expect(exported.evidenceRefs[0].refValue).toBe('1.50');
      expect(exported.evidenceRefs[0].refPath).toBeUndefined();
    });
  });

  describe('MEMORY_STATUS_LABELS', () => {
    it('provides Chinese label for each status', async () => {
      const { MEMORY_STATUS_LABELS } = await import('./memory-domain');

      expect(MEMORY_STATUS_LABELS.observed).toBe('已记录');
      expect(MEMORY_STATUS_LABELS.trusted).toBe('已验证');
      expect(MEMORY_STATUS_LABELS.corrected).toBe('已修正');
      expect(MEMORY_STATUS_LABELS.disputed).toBe('有争议');
    });
  });
});
