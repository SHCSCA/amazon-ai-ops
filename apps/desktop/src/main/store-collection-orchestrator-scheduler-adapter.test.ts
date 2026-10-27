import {
  describe,
  expect,
  it,
} from 'vitest';
import { type LingxingCollectionJobSnapshot } from '@amazon-ai-ops/shared-types';
import {
  assertStoreCollectionCommittedImportProofForRecovery,
  classifyStoreCollectionDurableProof,
} from './store-collection-orchestrator-scheduler-adapter';
import {
  REPORT_TYPES,
  completeJob,
  authorityProofForJob,
  harness,
} from "./collection-scheduler.test-fixtures";

describe('StoreCollectionOrchestratorSchedulerAdapter', () => {
it.each([
    {
      state: 'pending' as const,
      job: (base: LingxingCollectionJobSnapshot) => {
        const pending = {
          ...base,
          importState: 'pending' as const,
          importAttemptedAt: '2026-07-23T16:06:00.000Z',
          updatedAt: '2026-07-23T16:06:00.000Z',
        };
        delete pending.importCompletedAt;
        delete pending.importError;
        return pending;
      },
      expectsCas: true,
    },
    {
      state: 'failed' as const,
      job: (base: LingxingCollectionJobSnapshot) => ({
        ...base,
        importState: 'failed' as const,
        importAttemptedAt: '2026-07-23T16:06:00.000Z',
        importCompletedAt: '2026-07-23T16:08:00.000Z',
        importError: 'projection write interrupted',
        updatedAt: '2026-07-23T16:08:00.000Z',
      }),
      expectsCas: true,
    },
    {
      state: 'succeeded' as const,
      job: (base: LingxingCollectionJobSnapshot) => ({
        ...base,
        importState: 'succeeded' as const,
        importAttemptedAt: '2026-07-23T16:06:00.000Z',
        importCompletedAt: '2026-07-23T16:08:00.000Z',
        updatedAt: '2026-07-23T16:08:00.000Z',
      }),
      expectsCas: false,
    },
  ])('accepts exact committed import evidence with a $state job projection', async ({
    job: projectJob,
    expectsCas,
    state,
  }) => {
    const test = await harness();
    const base = completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    });
    const job = projectJob(base);
    const proof = authorityProofForJob(job, { committedImportEvidence: true });
    const expectation = {
      context: test.context,
      requestId: test.identity.requestId,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      expectedJob: job,
      expectedRun: proof.importRuns[0]!,
    };

    const receipt = assertStoreCollectionCommittedImportProofForRecovery(proof, expectation);
    expect(receipt).toMatchObject({
      storeId: test.context.storeId,
      jobId: job.jobId,
      requestId: test.identity.requestId,
      browserProfileId: test.context.browserProfileId,
      sessionGeneration: test.context.sessionGeneration,
      jobUpdatedAt: job.updatedAt,
      runId: proof.importRuns[0]!.runId,
    });
    expect(Boolean(receipt.casToken)).toBe(expectsCas);
    if (state === 'pending' || state === 'failed') {
      expect(() => classifyStoreCollectionDurableProof(proof, expectation))
        .toThrow(/SAFETY_STATE_UNKNOWN|lifecycle or authority evidence incomplete/);
    } else {
      expect(classifyStoreCollectionDurableProof(proof, expectation)).toBe('succeeded');
    }
  });

it('rejects committed import evidence whose reconciliation rows are not bound to file rows', async () => {
    const test = await harness();
    const base = completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    });
    const job = {
      ...base,
      importAttemptedAt: '2026-07-23T16:06:00.000Z',
      importCompletedAt: '2026-07-23T16:08:00.000Z',
      updatedAt: '2026-07-23T16:08:00.000Z',
    };
    const proof = authorityProofForJob(job);
    const [first, ...rest] = proof.reconciliations;
    expect(first).toBeDefined();
    const drifted = {
      ...proof,
      reconciliations: [
        { ...first!, expectedRows: 1, actualRows: 1 },
        ...rest,
      ],
    };

    expect(() => assertStoreCollectionCommittedImportProofForRecovery(drifted, {
      context: test.context,
      requestId: test.identity.requestId,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      expectedJob: job,
      expectedRun: proof.importRuns[0]!,
    })).toThrow(/committed full-eight import evidence incomplete/);
  });

it('rejects committed import evidence whose metric digest row is missing or drifted', async () => {
    const test = await harness();
    const job = completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    }, {
      importAttemptedAt: '2026-07-23T16:06:00.000Z',
      importCompletedAt: '2026-07-23T16:08:00.000Z',
      updatedAt: '2026-07-23T16:08:00.000Z',
    });
    const proof = authorityProofForJob(job);
    const expectation = {
      context: test.context,
      requestId: test.identity.requestId,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      expectedJob: job,
      expectedRun: proof.importRuns[0]!,
    };

    expect(() => assertStoreCollectionCommittedImportProofForRecovery({
      ...proof,
      metricEvidenceCount: 0,
      metricEvidence: [],
    }, expectation)).toThrow(/committed full-eight import evidence incomplete/);
    expect(() => assertStoreCollectionCommittedImportProofForRecovery({
      ...proof,
      metricEvidence: [{
        ...proof.metricEvidence[0]!,
        rowCount: proof.importRuns[0]!.metricRowCount + 1,
      }],
    }, expectation)).toThrow(/committed full-eight import evidence incomplete/);
  });

it('rejects stale expected job/run identities before issuing a recovery CAS receipt', async () => {
    const test = await harness();
    const base = completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    });
    const job = {
      ...base,
      importState: 'pending' as const,
      importAttemptedAt: '2026-07-23T16:06:00.000Z',
      updatedAt: '2026-07-23T16:06:00.000Z',
    };
    delete job.importCompletedAt;
    const proof = authorityProofForJob(job, { committedImportEvidence: true });
    const expectation = {
      context: test.context,
      requestId: test.identity.requestId,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      expectedJob: job,
      expectedRun: proof.importRuns[0]!,
    };

    expect(() => assertStoreCollectionCommittedImportProofForRecovery(proof, {
      ...expectation,
      expectedJob: { ...job, updatedAt: '2026-07-23T16:06:01.000Z' },
    })).toThrow(/expected job/);
    expect(() => assertStoreCollectionCommittedImportProofForRecovery(proof, {
      ...expectation,
      expectedRun: { ...proof.importRuns[0]!, inputFingerprint: 'b'.repeat(64) },
    })).toThrow(/expected unique completed import run/);
    expect(() => assertStoreCollectionCommittedImportProofForRecovery({
      ...proof,
      jobRow: { ...proof.jobRow, browserProfileId: 'profile-drifted' },
    }, expectation)).toThrow(/SQL authority row drifted/);
  });

it('rejects committed evidence whose imported-file timestamp is outside the unique run', async () => {
    const test = await harness();
    const base = completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    });
    const job = {
      ...base,
      importState: 'pending' as const,
      importAttemptedAt: '2026-07-23T16:06:00.000Z',
      updatedAt: '2026-07-23T16:06:00.000Z',
    };
    delete job.importCompletedAt;
    const proof = authorityProofForJob(job, { committedImportEvidence: true });
    const drifted = {
      ...proof,
      importedReportFiles: proof.importedReportFiles.map((row, index) => (
        index === 0 ? { ...row, lastImportedAt: '2026-07-23T16:05:59.000Z' } : row
      )),
    };

    expect(() => assertStoreCollectionCommittedImportProofForRecovery(drifted, {
      context: test.context,
      requestId: test.identity.requestId,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      expectedJob: job,
      expectedRun: proof.importRuns[0]!,
    })).toThrow(/authority proof timeline incomplete/);
  });
});
