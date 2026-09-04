import { describe, expect, it } from 'vitest';
import { selectExecutionReadbackGate } from './execution-workspace-gate';

const BASE_BATCH_ID = 'BATCH-001';
const BASE_JOB_ID = 'JOB-001';
const BASE_GRANT_ID = 'GRANT-001';

function makeProjection(overrides: {
  grantId?: string;
  jobs?: Partial<{
    id: string;
    identity: { campaignId: string; adGroupId: string; keywordId: string };
    evidence: Array<{
      batchId: string;
      jobId: string;
      slot: 'before' | 'after' | 'reload';
      artifactRef: string;
      observedBidCents: number;
    }>;
  }>[];
} = {}) {
  const { grantId = BASE_GRANT_ID, jobs = [] } = overrides;
  return {
    batch: { id: BASE_BATCH_ID, grantId, status: 'queued' as const },
    jobs: jobs.length
      ? jobs.map((j) => ({
          id: BASE_JOB_ID,
          identity: { campaignId: 'C1', adGroupId: 'AG1', keywordId: 'K1' },
          evidence: [],
          events: [],
          ...j,
        }))
      : [
          {
            id: BASE_JOB_ID,
            identity: { campaignId: 'C1', adGroupId: 'AG1', keywordId: 'K1' },
            evidence: [],
            events: [],
          },
        ],
  };
}

describe('selectExecutionReadbackGate', () => {
  it('returns blocked when projection is null', () => {
    const result = selectExecutionReadbackGate(null, null, null);
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain('尚未选择执行批次');
  });

  it('returns blocked when selectedJobId is null', () => {
    const result = selectExecutionReadbackGate(makeProjection(), null, BASE_GRANT_ID);
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain('尚未选择执行批次');
  });

  it('blocks when no grant id', () => {
    const result = selectExecutionReadbackGate(makeProjection({ grantId: '' }), BASE_JOB_ID, null);
    expect(result.authorityBound).toBe(false);
    expect(result.blockers).toContain('缺少执行授权绑定');
  });

  it('blocks when identity is unresolved', () => {
    const projection = makeProjection({
      jobs: [
        {
          id: 'JOB-1',
          identity: { campaignId: '', adGroupId: 'AG1', keywordId: 'K1' },
        },
      ],
    });
    const result = selectExecutionReadbackGate(projection, 'JOB-1', BASE_GRANT_ID);
    expect(result.identityVerified).toBe(false);
    expect(result.blockers).toContain('广告对象身份尚未全部核验');
  });

  it('passes authority and identity gates with valid grant and resolved IDs', () => {
    const result = selectExecutionReadbackGate(
      makeProjection({ grantId: BASE_GRANT_ID }),
      BASE_JOB_ID,
      BASE_GRANT_ID,
    );
    expect(result.authorityBound).toBe(true);
    expect(result.identityVerified).toBe(true);
    expect(result.blockers).not.toContain('缺少执行授权绑定');
    expect(result.blockers).not.toContain('广告对象身份尚未全部核验');
  });

  it('blocks each missing evidence slot individually', () => {
    const evidence = [
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'before' as const,
        artifactRef: 'art-1',
        observedBidCents: 100,
      },
    ];
    const projection = makeProjection({ jobs: [{ id: BASE_JOB_ID, evidence }] });
    const result = selectExecutionReadbackGate(projection, BASE_JOB_ID, BASE_GRANT_ID);
    expect(result.beforeAttached).toBe(true);
    expect(result.afterAttached).toBe(false);
    expect(result.reloadAttached).toBe(false);
    expect(result.blockers).toContain('缺少提交后证据');
    expect(result.blockers).toContain('缺少刷新后核验');
    expect(result.blockers).not.toContain('缺少变更前证据');
  });

  it('passes all evidence gates when all three slots are populated', () => {
    const evidence = [
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'before' as const,
        artifactRef: 'art-1',
        observedBidCents: 100,
      },
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'after' as const,
        artifactRef: 'art-2',
        observedBidCents: 90,
      },
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'reload' as const,
        artifactRef: 'art-3',
        observedBidCents: 90,
      },
    ];
    const projection = makeProjection({ jobs: [{ id: BASE_JOB_ID, evidence }] });
    const result = selectExecutionReadbackGate(projection, BASE_JOB_ID, BASE_GRANT_ID);
    expect(result.beforeAttached).toBe(true);
    expect(result.afterAttached).toBe(true);
    expect(result.reloadAttached).toBe(true);
    expect(result.blockers).not.toContain('缺少变更前证据');
    expect(result.blockers).not.toContain('缺少提交后证据');
    expect(result.blockers).not.toContain('缺少刷新后核验');
  });

  it('blocks when after and reload share the same artifact ref', () => {
    const evidence = [
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'before' as const,
        artifactRef: 'art-1',
        observedBidCents: 100,
      },
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'after' as const,
        artifactRef: 'art-SAME',
        observedBidCents: 90,
      },
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'reload' as const,
        artifactRef: 'art-SAME', // duplicate
        observedBidCents: 90,
      },
    ];
    const projection = makeProjection({ jobs: [{ id: BASE_JOB_ID, evidence }] });
    const result = selectExecutionReadbackGate(projection, BASE_JOB_ID, BASE_GRANT_ID);
    expect(result.distinctEvidence).toBe(false);
    expect(result.blockers).toContain('证据必须来自不同截图');
  });

  it('passes distinctEvidence when all three artifact refs differ', () => {
    const evidence = [
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'before' as const,
        artifactRef: 'art-1',
        observedBidCents: 100,
      },
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'after' as const,
        artifactRef: 'art-2',
        observedBidCents: 90,
      },
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'reload' as const,
        artifactRef: 'art-3',
        observedBidCents: 91, // 1 cent off
      },
    ];
    const projection = makeProjection({ jobs: [{ id: BASE_JOB_ID, evidence }] });
    const result = selectExecutionReadbackGate(projection, BASE_JOB_ID, BASE_GRANT_ID);
    expect(result.distinctEvidence).toBe(true);
    expect(result.blockers).not.toContain('证据必须来自不同截图');
  });

  it('blocks when after and reload bid differ by more than 1 cent', () => {
    const evidence = [
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'after' as const,
        artifactRef: 'art-2',
        observedBidCents: 100,
      },
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'reload' as const,
        artifactRef: 'art-3',
        observedBidCents: 98, // 2 cents off
      },
    ];
    const projection = makeProjection({ jobs: [{ id: BASE_JOB_ID, evidence }] });
    const result = selectExecutionReadbackGate(projection, BASE_JOB_ID, BASE_GRANT_ID);
    expect(result.valuesMatch).toBe(false);
    expect(result.blockers).toContain('提交后与刷新后出价不一致');
  });

  it('allows 1 cent tolerance on bid values', () => {
    const evidence = [
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'after' as const,
        artifactRef: 'art-2',
        observedBidCents: 100,
      },
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'reload' as const,
        artifactRef: 'art-3',
        observedBidCents: 100, // exact match
      },
    ];
    const projection = makeProjection({ jobs: [{ id: BASE_JOB_ID, evidence }] });
    const result = selectExecutionReadbackGate(projection, BASE_JOB_ID, BASE_GRANT_ID);
    expect(result.valuesMatch).toBe(true);
    expect(result.blockers).not.toContain('提交后与刷新后出价不一致');
  });

  it('returns eligible=true only when all 7 gates pass', () => {
    const evidence = [
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'before' as const,
        artifactRef: 'art-1',
        observedBidCents: 100,
      },
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'after' as const,
        artifactRef: 'art-2',
        observedBidCents: 90,
      },
      {
        batchId: BASE_BATCH_ID,
        jobId: BASE_JOB_ID,
        slot: 'reload' as const,
        artifactRef: 'art-3',
        observedBidCents: 90,
      },
    ];
    const projection = makeProjection({ grantId: BASE_GRANT_ID, jobs: [{ id: BASE_JOB_ID, evidence }] });
    const result = selectExecutionReadbackGate(projection, BASE_JOB_ID, BASE_GRANT_ID);
    expect(result.eligible).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });
});
