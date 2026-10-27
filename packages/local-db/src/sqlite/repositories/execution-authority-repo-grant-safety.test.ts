import { describe, expect, it } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { enableLowerNumberMatchingPolicy } from './execution-authority-repo.test-authority';
import { registerIdentity } from './execution-authority-repo.test-jobs';
import { createHarness } from './execution-authority-repo.test-harness';
describe("ExecutionAuthorityRepository", () => {
it('rejects batch materialization when a lower-number matching policy supersedes the grant policy', () => {
    const harness = createHarness();
    registerIdentity(harness);
    enableLowerNumberMatchingPolicy(harness.database);

    expect(() => harness.repository.createExactExecutionBatch(harness.context, 'grant-1'))
      .toThrow(/highest priority|优先级|策略/i);
    expect(harness.repository.listExecutionBatches(harness.context)).toEqual([]);
  });

it('rejects starting a queued job after a lower-number matching policy supersedes its grant', () => {
    const harness = createHarness();
    registerIdentity(harness);
    const created = harness.repository.createExactExecutionBatch(harness.context, 'grant-1').projection;
    enableLowerNumberMatchingPolicy(harness.database);

    expect(() => harness.repository.startJob(harness.context, {
      jobId: created.jobs[0]!.id,
      expectedRevision: created.jobs[0]!.revision,
    })).toThrow(/highest priority|优先级|策略/i);
    expect(harness.repository.getExecutionBatch(harness.context, created.batch.id)?.jobs[0])
      .toMatchObject({ status: 'queued', revision: 1 });
  });

it('enforces the grant total-impact budget in USD, not percentage points', () => {
    const allowed = createHarness(10, 0.10);
    registerIdentity(allowed);
    expect(() => allowed.repository.createExactExecutionBatch(allowed.context, 'grant-1'))
      .not.toThrow();

    const blocked = createHarness(10, 0.09);
    registerIdentity(blocked);
    expect(() => blocked.repository.createExactExecutionBatch(blocked.context, 'grant-1'))
      .toThrow(/impact budget/i);
  });

it('rejects a grant that expands the V1 execution batch above ten actions', () => {
    const harness = createHarness(10, 100, 11);

    expect(() => harness.repository.createExactExecutionBatch(harness.context, 'grant-1'))
      .toThrow(/at most 10 actions/i);
  });

it('rejects a stale context and a proposal above the grant change cap', () => {
    const harness = createHarness(5);
    const staleContext = normalizeStoreContextEnvelope({ ...harness.context, sessionGeneration: 3 });
    expect(() => harness.repository.listCanonicalKeywordIdentities(staleContext)).toThrow(/stale/i);

    registerIdentity(harness);
    expect(() => harness.repository.createExactExecutionBatch(harness.context, 'grant-1'))
      .toThrow(/within 5%/i);
  });
});
