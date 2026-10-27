import { describe, expect, it } from 'vitest';
import { normalizeStoreContextEnvelope } from './store';
import { createCausalTimelineExport, sanitizeCausalExportText } from './causal-timeline-export';
import type { CausalEventRecord, CausalEvidenceRefRecord } from './mission-domain';

const context = normalizeStoreContextEnvelope({
  storeId: 'store-one', browserProfileId: 'profile-one', marketplace: 'US', currency: 'USD',
  businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16', sessionGeneration: 4,
});
const event: CausalEventRecord = {
  id: 'event-one', storeId: context.storeId, stage: 'FACT', eventType: 'source_fact', entityType: 'data_batch',
  entityId: 'batch-one', title: '导入事实', signal: 'eight reports', status: 'recorded', source: 'collector', actorId: 'main',
  businessDate: '2026-10-15', sessionGeneration: 3, sequence: 1, createdAt: '2026-10-15T00:00:00Z',
};
const proof: CausalEvidenceRefRecord = {
  id: 'proof-one', storeId: context.storeId, eventId: event.id, evidenceType: 'report', evidenceRef: 'logical:report-one',
  sha256: 'a'.repeat(64), createdAt: '2026-10-15T00:00:00Z',
};

describe('canonical causal timeline export', () => {
  it('preserves scope, historical business dates, lineage, search words and independent evidence refs', () => {
    const correction = { ...event, id: 'event-two', sequence: 2, correctsEventId: event.id, signal: 'revised' };
    const result = createCausalTimelineExport(context, [correction, event], [proof]);
    expect(result.scope).toEqual(context);
    expect(result.recordCount).toBe(2);
    expect(result.evidenceCount).toBe(1);
    expect(result.records.map(record => record.id)).toEqual(['event-one', 'event-two']);
    expect(result.records[0].businessDate).toBe('2026-10-15');
    expect(result.records[1].correctsEventId).toBe('event-one');
    expect(result.evidenceRefs[0]).toMatchObject({ eventId: event.id, evidenceRef: proof.evidenceRef, sha256: proof.sha256 });
    expect(result.searchTermsByRecord[event.id]).toContain('eight reports');
    expect(result).not.toHaveProperty('password');
  });

  it('redacts credentials and paths before building records and the searchable word index', () => {
    const result = createCausalTimelineExport(context, [{
      ...event, title: 'API_KEY=top-secret-value', signal: '来源 C:\\Users\\operator\\secret.db',
      intervention: '参考 https://example.test/?token=private-token', observedEffect: '文件 /home/operator/private.db',
      expectedEffect: 'Bearer private-bearer-value', password: 'unlisted-secret',
    } as CausalEventRecord], [proof]);
    const serialized = JSON.stringify(result);
    for (const secret of ['top-secret-value', 'secret.db', 'private-token', 'private.db', 'private-bearer-value', 'unlisted-secret']) expect(serialized).not.toContain(secret);
    expect(serialized).toContain('已脱敏');
    expect(serialized).toContain('路径已隐藏');
  });

  it('rejects cross-store records, orphan/cross-store evidence and duplicate identifiers', () => {
    expect(() => createCausalTimelineExport(context, [{ ...event, storeId: 'store-two' as CausalEventRecord['storeId'] }], [])).toThrow(/跨店铺/);
    expect(() => createCausalTimelineExport(context, [event], [{ ...proof, eventId: 'missing' }])).toThrow(/不属于/);
    expect(() => createCausalTimelineExport(context, [event], [{ ...proof, storeId: 'store-two' as CausalEvidenceRefRecord['storeId'] }])).toThrow(/不属于/);
    expect(() => createCausalTimelineExport(context, [event, event], [])).toThrow(/重复/);
    expect(() => createCausalTimelineExport(context, [event], [proof, proof])).toThrow(/重复/);
  });

  it('refuses path-like evidence ids, invalid hashes and malformed event metadata', () => {
    expect(() => createCausalTimelineExport(context, [event], [{ ...proof, evidenceRef: 'C:\\secret\\proof.png' }])).toThrow();
    expect(() => createCausalTimelineExport(context, [event], [{ ...proof, sha256: 'invalid' }])).toThrow(/摘要/);
    expect(() => createCausalTimelineExport(context, [{ ...event, createdAt: 'invalid' }], [])).toThrow();
    expect(() => createCausalTimelineExport(context, [{ ...event, businessDate: '2026-02-30' }], [])).toThrow(/日期/);
    expect(() => createCausalTimelineExport(context, [{ ...event, sequence: 0 }], [])).toThrow(/顺序/);
    expect(() => createCausalTimelineExport(context, [{ ...event, confidence: 2 }], [])).toThrow(/置信度/);
  });

  it('hides UNC, file URI and absolute single-component paths', () => {
    const result = sanitizeCausalExportText('来源 \\\\server\\share\\proof.png\nfile:///C:/secret.txt\n目标 /private');
    expect(result).not.toContain('server');
    expect(result).not.toContain('secret.txt');
    expect(result).not.toContain('/private');
  });
});
