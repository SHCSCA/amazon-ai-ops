import { describe, expect, it } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createHarness } from './mission-domain-repo.test-harness';

describe('production causal timeline snapshot export', () => {
  it('reads events and separate proof refs from the same current-store readonly snapshot with zero writes', () => {
    const { repository, database, contextOne, contextTwo } = createHarness();
    const append = (context: StoreContextEnvelope, id: string) => repository.appendCausalEvent(context, {
      id, stage: 'FACT', eventType: 'source_fact', entityType: 'operation_note', entityId: 'entity-one',
      title: '导入事实', signal: '八类报表已核对；api_key=private-value', status: 'recorded', source: 'collector', actorId: 'main',
    });
    append(contextOne, 'event-one');
    append(contextTwo, 'event-two');
    repository.appendEvidenceRef(contextOne, {
      id: 'proof-one', eventId: 'event-one', evidenceType: 'report', evidenceRef: 'logical:report-one', sha256: 'a'.repeat(64),
    });
    repository.appendEvidenceRef(contextTwo, {
      id: 'proof-two', eventId: 'event-two', evidenceType: 'report', evidenceRef: 'logical:report-two', sha256: 'b'.repeat(64),
    });
    const before = database.prepare('SELECT total_changes() AS count').get();
    database.pragma('query_only = ON');
    const result = repository.exportCausalTimeline(contextOne);
    expect(result.records.map(record => record.id)).toEqual(['event-one']);
    expect(result.evidenceRefs.map(proof => proof.id)).toEqual(['proof-one']);
    expect(result.evidenceRefs[0].sha256).toBe('a'.repeat(64));
    expect(result.scope).toEqual(contextOne);
    expect(JSON.stringify(result)).not.toContain('private-value');
    expect(result.searchTermsByRecord['event-one']).toContain('八类报表已核对');
    expect(database.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    expect(database.pragma('query_only', { simple: true })).toBe(1);
  });

  it('filters events and proofs together and rejects stale active-session context', () => {
    const { repository, contextOne } = createHarness();
    repository.appendCausalEvent(contextOne, {
      id: 'event-one', stage: 'FACT', eventType: 'source_fact', entityType: 'operation_note', entityId: 'entity-one',
      title: '事实', status: 'recorded', source: 'collector', actorId: 'main',
    });
    repository.appendEvidenceRef(contextOne, { id: 'proof-one', eventId: 'event-one', evidenceType: 'report', evidenceRef: 'logical:report-one' });
    const result = repository.exportCausalTimeline(contextOne, { stages: ['ANALYSIS'] });
    expect(result.recordCount).toBe(0);
    expect(result.evidenceCount).toBe(0);
    expect(() => repository.exportCausalTimeline({ ...contextOne, sessionGeneration: contextOne.sessionGeneration + 1 })).toThrow();
  });
});
