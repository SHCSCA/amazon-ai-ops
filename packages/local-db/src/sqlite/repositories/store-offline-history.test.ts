import { describe, expect, it } from 'vitest';
import { createFullDomainFixture } from './store-full-domain.test-fixtures';

describe('offline canonical local history', () => {
  it('keeps both stores products, reports, diagnostics, experiments and memory readable with unavailable ERP and Ads in SQLite query-only mode', () => {
    const { h, seeded, project } = createFullDomainFixture();
    const online = seeded.map(project);
    h.database.prepare("UPDATE store_connections SET status='blocked'").run();
    h.database.prepare("UPDATE store_session_metadata SET status='expired'").run();
    const before = h.database.prepare('SELECT total_changes() AS count').get();
    h.database.pragma('query_only=ON');
    for (const [index, item] of seeded.entries()) {
      expect(project(item)).toEqual(online[index]);
      expect(h.repository.getMission(item.context, item.mission.id)).toMatchObject({ id: item.mission.id, storeId: item.context.storeId });
      expect(h.repository.getExperiment(item.context, item.experiment.id)).toMatchObject({ id: item.experiment.id });
      expect(h.repository.listCausalEvents(item.context).some(event => event.id === item.memory.id)).toBe(true);
    }
    expect(h.database.prepare('SELECT total_changes() AS count').get()).toEqual(before);
  });

  it('blocks Ads execution independently while preserving the complete local analysis and authority history', () => {
    const { h, seeded, project, execution } = createFullDomainFixture();
    const item = seeded[0];
    const online = project(item);
    h.database.prepare("UPDATE store_connections SET status='blocked' WHERE store_id=? AND provider='amazon_ads'").run(item.context.storeId);
    h.database.prepare("UPDATE store_session_metadata SET status='expired' WHERE store_id=? AND provider='amazon_ads'").run(item.context.storeId);
    const job = item.batch.jobs[0]!;
    const before = h.database.prepare('SELECT total_changes() AS count').get();
    expect(() => execution.startJob(item.context, { jobId: job.id, expectedRevision: job.revision })).toThrow(/Ads account\/session identity is not ready/);
    expect(project(item)).toEqual(online);
    expect(execution.getExecutionBatch(item.context, item.batch.batch.id)?.jobs[0].status).toBe('queued');
    expect(h.database.prepare("SELECT COUNT(*) AS count FROM mission_grant_events WHERE event_type IN ('reserved','spent')").get()).toEqual({ count: 0 });
    expect(h.database.prepare('SELECT total_changes() AS count').get()).toEqual(before);
  });
});
