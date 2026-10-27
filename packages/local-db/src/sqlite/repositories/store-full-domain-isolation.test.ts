import { describe, expect, it } from 'vitest';
import { createFullDomainFixture } from './store-full-domain.test-fixtures';

describe('current-store full domain projection isolation', () => {
  it('replaces products, reports, runs, proposals, approvals, grants, execution, experiments and memory on A to B to A selection', () => {
    const { h, execution, seeded, project } = createFullDomainFixture();
    const before = h.database.prepare('SELECT total_changes() AS count').get();
    const snapshots = [seeded[0], seeded[1], seeded[0]].map(project);
    expect(snapshots[0]).toEqual(snapshots[2]);
    for (const [index, snapshot] of snapshots.entries()) {
      const expected = seeded[index === 1 ? 1 : 0];
      for (const values of Object.values(snapshot)) {
        expect(values.length).toBeGreaterThan(0);
        for (const row of values) {
          const store = 'batch' in row ? row.batch.storeId : row.storeId;
          expect(store).toBe(expected.context.storeId);
        }
      }
      expect(snapshot.runs.map(run => run.runId)).toEqual([expected.run.runId]);
      expect(snapshot.approvals.map(decision => decision.id)).toEqual([expected.decision.id]);
      expect(snapshot.grants.map(grant => grant.id)).toEqual([expected.grant.id]);
      expect(snapshot.experiments.map(experiment => experiment.id)).toEqual([expected.experiment.id]);
      const other = seeded[index === 1 ? 0 : 1];
      expect(h.repository.getMission(expected.context, other.mission.id)).toBeUndefined();
      expect(execution.getExecutionBatch(expected.context, other.batch.batch.id)).toBeUndefined();
      expect(h.repository.getExperiment(expected.context, other.experiment.id)).toBeUndefined();
    }
    expect(h.database.prepare('SELECT total_changes() AS count').get()).toEqual(before);
  });
});

