import {
  describe,
  expect,
  it,
} from 'vitest';
import { type LingxingCollectionJobSnapshot } from '@amazon-ai-ops/shared-types';
import type { LingxingCollectionAuthorityProof } from '@amazon-ai-ops/local-db';
import {
  REPORT_TYPES,
  completeJob,
  nonterminalBatchForProof,
  queuedJob,
  runningJob,
  terminalNotApplicableJob,
  harness,
} from "./collection-scheduler.test-fixtures";

describe('StoreCollectionOrchestratorSchedulerAdapter', () => {
it('recovers only the existing exact request and never invokes the coordinator', async () => {
    const states: Array<{
      name: string;
      mutate?: (job: LingxingCollectionJobSnapshot) => LingxingCollectionJobSnapshot;
      expected: string;
      durable?: boolean;
      exact?: boolean;
    }> = [
      { name: 'missing', expected: 'not_found', durable: false },
      {
        name: 'queued',
        expected: 'accepted',
        mutate: (job) => {
          const queued = {
            ...job,
            state: 'queued' as const,
            reports: job.reports.map((checkpoint) => ({
              ...checkpoint,
              state: 'queued' as const,
            })),
          };
          delete queued.completedAt;
          delete queued.importState;
          delete queued.importAttemptedAt;
          delete queued.importCompletedAt;
          return queued;
        },
      },
      {
        name: 'running',
        expected: 'waiting',
        mutate: (job) => {
          const running = {
            ...job,
            state: 'running' as const,
          };
          delete running.completedAt;
          delete running.importState;
          delete running.importAttemptedAt;
          delete running.importCompletedAt;
          return running;
        },
      },
      {
        name: 'completed import pending',
        expected: 'waiting',
        mutate: (job) => {
          const pending = { ...job, importState: 'pending' as const };
          delete pending.importCompletedAt;
          return pending;
        },
      },
      {
        name: 'completed legacy import missing',
        expected: 'unknown',
        mutate: (job) => {
          const legacy = { ...job };
          delete legacy.importState;
          delete legacy.importAttemptedAt;
          delete legacy.importCompletedAt;
          return legacy;
        },
      },
      {
        name: 'completed with partial checkpoints',
        expected: 'unknown',
        exact: false,
        mutate: (job) => ({ ...job, reports: job.reports.slice(0, 7) }),
      },
      {
        name: 'completed with failed import',
        expected: 'failed',
        mutate: (job) => ({ ...job, importState: 'failed' as const, importError: 'bad rows' }),
      },
      {
        name: 'completed_with_errors',
        expected: 'failed',
        mutate: (job) => {
          const terminal = {
            ...job,
            state: 'completed_with_errors' as const,
            importState: 'not_applicable' as const,
          };
          delete terminal.importAttemptedAt;
          delete terminal.importCompletedAt;
          delete terminal.importError;
          return terminal;
        },
      },
      {
        name: 'failed terminal',
        expected: 'failed',
        mutate: (job) => {
          const terminal = {
            ...job,
            state: 'failed' as const,
            importState: 'not_applicable' as const,
          };
          delete terminal.importAttemptedAt;
          delete terminal.importCompletedAt;
          delete terminal.importError;
          return terminal;
        },
      },
      {
        name: 'cancelled terminal',
        expected: 'failed',
        mutate: (job) => {
          const terminal = {
            ...job,
            state: 'cancelled' as const,
            importState: 'not_applicable' as const,
          };
          delete terminal.importAttemptedAt;
          delete terminal.importCompletedAt;
          delete terminal.importError;
          return terminal;
        },
      },
      {
        name: 'stale authority terminal',
        expected: 'failed',
        mutate: (job) => {
          const terminal = {
            ...job,
            state: 'stale_authority' as const,
            importState: 'not_applicable' as const,
          };
          delete terminal.importAttemptedAt;
          delete terminal.importCompletedAt;
          delete terminal.importError;
          return terminal;
        },
      },
      { name: 'successful exact 8/8', expected: 'succeeded' },
    ];

    for (const scenario of states) {
      const test = await harness();
      if (scenario.durable !== false) {
        const job = completeJob({
          requestId: test.identity.requestId,
          storeContext: test.context,
          dateStart: test.window.dateStart,
          dateEnd: test.window.dateEnd,
          mode: 'create-and-download',
          reportTypes: REPORT_TYPES,
        });
        test.jobs.rows.push(scenario.mutate?.(job) ?? job);
      }
      const input = await test.recoveryInput();
      const projection = await test.adapter.recover(input);
      expect(projection.state, scenario.name).toBe(scenario.expected);
      if (scenario.durable === false
        || scenario.exact === false
        || scenario.expected === 'waiting'
        || scenario.expected === 'unknown') {
        expect(projection.accepted, scenario.name).toBeUndefined();
        expect(projection.duplicate, scenario.name).toBeUndefined();
      } else {
        expect(projection.accepted, scenario.name).toBe(true);
        expect(projection.duplicate, scenario.name).toBe(false);
      }
      expect(projection, scenario.name).toMatchObject({
        cycleId: input.cycleId,
        transitionId: input.transitionId,
        fingerprint: input.expectedFingerprint,
        attemptId: input.attemptId,
        requestId: input.requestId,
        authority: input.expectedAuthority,
      });
      expect(projection.capability, scenario.name).toBe(input.capability);
      expect(projection.transitionCapability, scenario.name).toBe(input.transitionCapability);
      expect(projection.transitionScope, scenario.name).toBe(input.transitionScope);
      expect(test.start, scenario.name).not.toHaveBeenCalled();
    }
  });

it('recovers the frozen historical Store/Profile/window after Main authority and config move elsewhere', async () => {
    const test = await harness();
    test.jobs.rows.push(completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    }));
    test.coordinatorAuthority.switchStore(test.storeA.storeId);
    test.setConfig({ current: null, versions: [] });

    const projection = await test.adapter.recover(await test.recoveryInput());

    expect(projection).toMatchObject({
      state: 'succeeded',
      accepted: true,
      duplicate: false,
      authority: test.transitioned.current,
    });
    expect(test.getForStoreId).not.toHaveBeenCalled();
    expect(test.start).not.toHaveBeenCalled();
  });

it.each(([
    {
      name: 'queued without batch',
      mutateJob: queuedJob,
      expected: 'accepted',
    },
    {
      name: 'queued with pending batch without completion',
      mutateJob: queuedJob,
      mutateProof: (proof) => ({ ...proof, batch: nonterminalBatchForProof(proof, 'pending') }),
      expected: 'accepted',
    },
    {
      name: 'queued with completed pending batch',
      mutateJob: queuedJob,
      mutateProof: (proof) => ({
        ...proof,
        batch: nonterminalBatchForProof(proof, 'pending', '2026-07-23T16:05:00.000Z'),
      }),
      expected: 'unknown',
    },
    {
      name: 'queued with import error',
      mutateJob: (job) => ({ ...queuedJob(job), importError: 'impossible' }),
      expected: 'unknown',
    },
    {
      name: 'running without batch',
      mutateJob: runningJob,
      expected: 'waiting',
    },
    {
      name: 'running with running batch without completion',
      mutateJob: runningJob,
      mutateProof: (proof) => ({ ...proof, batch: nonterminalBatchForProof(proof, 'running') }),
      expected: 'waiting',
    },
    {
      name: 'running with completed running batch',
      mutateJob: runningJob,
      mutateProof: (proof) => ({
        ...proof,
        batch: nonterminalBatchForProof(proof, 'running', '2026-07-23T16:05:00.000Z'),
      }),
      expected: 'unknown',
    },
    {
      name: 'running with import attempt',
      mutateJob: (job) => ({
        ...runningJob(job),
        importAttemptedAt: '2026-07-23T16:04:00.000Z',
      }),
      expected: 'unknown',
    },
    {
      name: 'completed pending without attempted timestamp',
      mutateJob: (job) => {
        const pending = { ...job, importState: 'pending' as const };
        delete pending.importAttemptedAt;
        delete pending.importCompletedAt;
        delete pending.importError;
        return pending;
      },
      expected: 'waiting',
    },
    {
      name: 'completed pending with canonical attempted timestamp',
      mutateJob: (job) => {
        const pending = { ...job, importState: 'pending' as const };
        delete pending.importCompletedAt;
        delete pending.importError;
        return pending;
      },
      expected: 'waiting',
    },
    {
      name: 'completed pending with import completion',
      mutateJob: (job) => ({ ...job, importState: 'pending' as const }),
      expected: 'unknown',
    },
    {
      name: 'completed pending with import error',
      mutateJob: (job) => {
        const pending = { ...job, importState: 'pending' as const, importError: 'impossible' };
        delete pending.importCompletedAt;
        return pending;
      },
      expected: 'unknown',
    },
    {
      name: 'completed failed with full lifecycle',
      mutateJob: (job) => ({ ...job, importState: 'failed' as const, importError: 'bad rows' }),
      expected: 'failed',
    },
    {
      name: 'completed failed without import completion',
      mutateJob: (job) => {
        const failed = { ...job, importState: 'failed' as const, importError: 'bad rows' };
        delete failed.importCompletedAt;
        return failed;
      },
      expected: 'unknown',
    },
    {
      name: 'completed failed with empty error',
      mutateJob: (job) => ({ ...job, importState: 'failed' as const, importError: '   ' }),
      expected: 'unknown',
    },
    {
      name: 'completed succeeded with full 8/8 proof',
      mutateJob: (job) => job,
      expected: 'succeeded',
    },
    {
      name: 'completed succeeded with import error',
      mutateJob: (job) => ({ ...job, importError: 'impossible' }),
      expected: 'unknown',
    },
    {
      name: 'restart-cancelled pre-batch terminal with exact empty durable proof',
      mutateJob: (job) => {
        const terminal = terminalNotApplicableJob(job, 'cancelled');
        return {
          ...terminal,
          blockerCode: 'LINGXING_COLLECTION_INTERRUPTED_BY_RESTART',
          detail: '应用重启前采集未形成终态，已安全收口为取消；可由运营者重新发起。',
          reports: terminal.reports.map((checkpoint) => {
            const cancelled = {
              ...checkpoint,
              state: 'cancelled' as const,
              errorCode: 'LINGXING_COLLECTION_INTERRUPTED_BY_RESTART',
              detail: '应用重启前采集未形成终态，已安全收口为取消；可由运营者重新发起。',
              updatedAt: terminal.completedAt!,
            };
            delete cancelled.createdReportIdentity;
            delete cancelled.fileSizeBytes;
            return cancelled;
          }),
        };
      },
      mutateProof: (proof) => ({
        ...proof,
        batch: undefined,
        lingxingFileCount: 0,
        lingxingFiles: [],
      }),
      expected: 'failed',
    },
    {
      name: 'terminal not_applicable with empty import lifecycle',
      mutateJob: (job) => terminalNotApplicableJob(job, 'failed'),
      expected: 'failed',
    },
    {
      name: 'terminal not_applicable with import attempt',
      mutateJob: (job) => ({
        ...terminalNotApplicableJob(job, 'failed'),
        importAttemptedAt: '2026-07-23T16:04:00.000Z',
      }),
      expected: 'unknown',
    },
    {
      name: 'terminal not_applicable without batch completion',
      mutateJob: (job) => terminalNotApplicableJob(job, 'failed'),
      mutateProof: (proof) => ({
        ...proof,
        batch: proof.batch ? { ...proof.batch, completedAt: undefined } : undefined,
      }),
      expected: 'unknown',
    },
  ] satisfies Array<{
    name: string;
    mutateJob(job: LingxingCollectionJobSnapshot): LingxingCollectionJobSnapshot;
    mutateProof?: (proof: LingxingCollectionAuthorityProof) => LingxingCollectionAuthorityProof;
    expected: 'accepted' | 'waiting' | 'failed' | 'succeeded' | 'unknown';
  }>))('enforces the unified lifecycle matrix: $name', async ({ mutateJob, mutateProof, expected }) => {
    const test = await harness();
    const base = completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    });
    test.jobs.rows.push(mutateJob(base));
    test.jobs.mutateProof = mutateProof;

    const projection = await test.adapter.recover(await test.recoveryInput());

    expect(projection.state).toBe(expected);
    if (expected === 'accepted' || expected === 'failed' || expected === 'succeeded') {
      expect(projection).toMatchObject({ accepted: true, duplicate: false });
    } else {
      expect(projection.accepted).toBeUndefined();
      expect(projection.duplicate).toBeUndefined();
    }
  });

it.each([
    {
      name: 'missing one durable Lingxing file',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        lingxingFileCount: 7,
        lingxingFiles: proof.lingxingFiles.slice(0, 7),
      }),
    },
    {
      name: 'file size differs from downloaded checkpoint',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        lingxingFiles: proof.lingxingFiles.map((file, index) => (
          index === 0 ? { ...file, fileSizeBytes: file.fileSizeBytes! + 1 } : file
        )),
      }),
    },
    {
      name: 'created report identity has the wrong date window',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        job: {
          ...proof.job,
          reports: proof.job.reports.map((checkpoint, index) => (
            index === 0
              ? {
                  ...checkpoint,
                  createdReportIdentity: {
                    ...checkpoint.createdReportIdentity!,
                    dateStart: '2026-07-01',
                  },
                }
              : checkpoint
          )),
        },
      }),
    },
    {
      name: 'multiple completed import runs',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importRunCount: 2,
        importRuns: [
          ...proof.importRuns,
          { ...proof.importRuns[0]!, runId: 'second-completed-run' },
        ],
      }),
    },
    {
      name: 'completed run count claims a reconciliation row that is absent',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        reconciliations: proof.reconciliations.slice(1),
      }),
    },
    {
      name: 'completed run metric row count differs from exact per-report totals',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importRuns: proof.importRuns.map((run, index) => (
          index === 0 ? { ...run, metricRowCount: run.metricRowCount + 1 } : run
        )),
      }),
    },
    {
      name: 'reconciliation row records a mismatch',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        reconciliations: proof.reconciliations.map((row, index) => (
          index === 0
            ? { ...row, status: 'mismatch' as const, withinTolerance: false }
            : row
        )),
      }),
    },
    {
      name: 'reconciliation row belongs to another import run',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        reconciliations: proof.reconciliations.map((row, index) => (
          index === 0 ? { ...row, runId: 'foreign-run' } : row
        )),
      }),
    },
    {
      name: 'reconciliation row covers only part of the authorized window',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        reconciliations: proof.reconciliations.map((row, index) => (
          index === 0 ? { ...row, dateStart: row.dateEnd } : row
        )),
      }),
    },
    {
      name: 'reconciliation compatibility date is not the window end',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        reconciliations: proof.reconciliations.map((row, index) => (
          index === 0 ? { ...row, metricDate: row.dateStart } : row
        )),
      }),
    },
    {
      name: 'reconciliation absolute delta conflicts with its amounts',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        reconciliations: proof.reconciliations.map((row, index) => (
          index === 0 ? { ...row, absoluteCostDelta: 0.01 } : row
        )),
      }),
    },
    {
      name: 'import completion precedes import start',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importRuns: proof.importRuns.map((run, index) => (
          index === 0
            ? { ...run, completedAt: '2026-07-23T16:03:59.000Z' }
            : run
        )),
      }),
    },
    {
      name: 'import run creation precedes its completion',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importRuns: proof.importRuns.map((run, index) => (
          index === 0
            ? { ...run, createdAt: '2026-07-23T16:04:30.000Z' }
            : run
        )),
      }),
    },
    {
      name: 'imported report timestamp precedes its unique run',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importedReportFiles: proof.importedReportFiles.map((file, index) => (
          index === 0
            ? { ...file, lastImportedAt: '2026-07-23T16:03:59.000Z' }
            : file
        )),
      }),
    },
    {
      name: 'job terminal timestamp follows its updated timestamp',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        job: { ...proof.job, completedAt: '2026-07-23T16:06:00.000Z' },
      }),
    },
    {
      name: 'batch completion precedes batch creation',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        batch: { ...proof.batch!, createdAt: '2026-07-23T16:06:00.000Z' },
      }),
    },
    {
      name: 'created-report timestamp follows its checkpoint update',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        job: {
          ...proof.job,
          reports: proof.job.reports.map((checkpoint, index) => (
            index === 0
              ? {
                  ...checkpoint,
                  createdReportIdentity: {
                    ...checkpoint.createdReportIdentity!,
                    createdAt: '2026-07-23T16:06:00.000Z',
                  },
                }
              : checkpoint
          )),
        },
      }),
    },
    {
      name: 'Lingxing file update precedes file creation',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        lingxingFiles: proof.lingxingFiles.map((file, index) => (
          index === 0 ? { ...file, createdAt: '2026-07-23T16:06:00.000Z' } : file
        )),
      }),
    },
    {
      name: 'immutable import snapshot hash is malformed',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importFileSnapshots: proof.importFileSnapshots.map((snapshot, index) => (
          index === 0 ? { ...snapshot, fileHash: 'not-a-sha256' } : snapshot
        )),
      }),
    },
    {
      name: 'imported report file is not imported',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importedReportFiles: proof.importedReportFiles.map((file, index) => (
          index === 0 ? { ...file, status: 'pending' } : file
        )),
      }),
    },
    {
      name: 'import snapshot points at another Lingxing file',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importFileSnapshots: proof.importFileSnapshots.map((snapshot, index) => (
          index === 0 ? { ...snapshot, lingxingFileId: 'foreign-file' } : snapshot
        )),
      }),
    },
  ])('does not promote succeeded when $name', async ({ mutate }) => {
    const test = await harness();
    test.jobs.rows.push(completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    }));
    test.jobs.mutateProof = mutate;

    const projection = await test.adapter.recover(await test.recoveryInput());

    expect(projection.state).toBe('unknown');
    expect(projection.accepted).toBeUndefined();
    expect(projection.duplicate).toBeUndefined();
    expect(test.start).not.toHaveBeenCalled();
  });

it.each([
    {
      name: 'job timestamp',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        job: { ...proof.job, createdAt: '1' },
      }),
    },
    {
      name: 'batch timestamp',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        batch: { ...proof.batch!, createdAt: '1' },
      }),
    },
    {
      name: 'created report identity timestamp',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        job: {
          ...proof.job,
          reports: proof.job.reports.map((checkpoint, index) => (
            index === 0
              ? {
                  ...checkpoint,
                  createdReportIdentity: {
                    ...checkpoint.createdReportIdentity!,
                    createdAt: '1',
                  },
                }
              : checkpoint
          )),
        },
      }),
    },
    {
      name: 'import run timestamp',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importRuns: proof.importRuns.map((run, index) => (
          index === 0 ? { ...run, completedAt: '1' } : run
        )),
      }),
    },
    {
      name: 'immutable snapshot timestamp',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importFileSnapshots: proof.importFileSnapshots.map((snapshot, index) => (
          index === 0 ? { ...snapshot, capturedAt: '1' } : snapshot
        )),
      }),
    },
    {
      name: 'imported file timestamp',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importedReportFiles: proof.importedReportFiles.map((file, index) => (
          index === 0 ? { ...file, lastImportedAt: '1' } : file
        )),
      }),
    },
    {
      name: 'reconciliation timestamp',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        reconciliations: proof.reconciliations.map((row, index) => (
          index === 0 ? { ...row, reconciledAt: '1' } : row
        )),
      }),
    },
  ])('rejects Date.parse-compatible but non-canonical UTC $name', async ({ mutate }) => {
    const test = await harness();
    test.jobs.rows.push(completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    }));
    test.jobs.mutateProof = mutate;

    const projection = await test.adapter.recover(await test.recoveryInput());

    expect(projection.state).toBe('unknown');
    expect(projection.accepted).toBeUndefined();
    expect(projection.duplicate).toBeUndefined();
  });

it('maps impossible job/import combinations to unknown without terminal flags', async () => {
    const test = await harness();
    test.jobs.rows.push(completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    }, {
      state: 'completed_with_errors',
      importState: 'succeeded',
    }));

    const projection = await test.adapter.recover(await test.recoveryInput());

    expect(projection.state).toBe('unknown');
    expect(projection.accepted).toBeUndefined();
    expect(projection.duplicate).toBeUndefined();
  });

it('fails closed on duplicate durable recovery rows without invoking the coordinator', async () => {
    const test = await harness();
    const job = completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    });
    test.jobs.rows.push(job, { ...job, jobId: 'duplicate-recovery-job' });
    await expect(test.adapter.recover(await test.recoveryInput())).rejects.toThrow(/ambiguity/);
    expect(test.start).not.toHaveBeenCalled();
  });

it('rejects forged recovery identity/capability and never creates or repairs a job', async () => {
    const wrongIdentity = await harness();
    const input = await wrongIdentity.recoveryInput();
    await expect(wrongIdentity.adapter.recover({
      ...input,
      requestId: `scr:${'f'.repeat(64)}`,
    })).rejects.toThrow(/forged|replayed|scope-mismatched|复算/);
    expect(wrongIdentity.start).not.toHaveBeenCalled();
    expect(wrongIdentity.jobs.rows).toEqual([]);

    const forged = await harness();
    const forgedInput = await forged.recoveryInput();
    await expect(forged.adapter.recover({
      ...forgedInput,
      transitionCapability: Object.freeze({}) as never,
    })).rejects.toThrow(/forged/);
    expect(forged.start).not.toHaveBeenCalled();
    expect(forged.jobs.rows).toEqual([]);
  });
});
