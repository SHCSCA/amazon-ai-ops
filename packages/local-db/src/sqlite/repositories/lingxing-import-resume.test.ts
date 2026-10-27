// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { type LingxingCollectionJobSnapshot, LingxingImportRepository, type LingxingReportFile, databases, describe, expect, fingerprintLingxingCollectionAuthorityProof, initSqlite, it, normalizeStoreContextEnvelope } from './lingxing-import-test-environment';
import { createHarness, failedFullAuthorityTerminal, fullAuthorityImportInput, fullAuthorityTerminal, persistSucceededAuthorityProof } from './lingxing-import-test-fixture';
describe('LingxingImportRepository', () => {
it('atomically completes an exact pending import recovery proof and rejects stale replay', () => {
    const { database, databasePath, repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'authority-recovery-batch');
    const attemptedAt = '2026-07-22T00:06:00.000Z';
    terminal.job = {
        ...terminal.job,
        importState: 'pending',
        importAttemptedAt: attemptedAt,
        updatedAt: attemptedAt,
    };
    repository.commitCollectionTerminalForStore(storeA, terminal);
    repository.commitImportForStore(storeA, fullAuthorityImportInput(terminal, attemptedAt, '2026-07-22T00:07:00.000Z'));
    database.close();
    const reopenedDatabase = initSqlite(databasePath);
    databases.push(reopenedDatabase);
    const reopenedRepository = new LingxingImportRepository(reopenedDatabase);
    const proof = reopenedRepository.readUniqueCollectionAuthorityProofForStoreByRequestId(storeA, terminal.job.request.requestId)!;
    const recoveryCompletedAt = new Date(Date.parse(proof.importRuns[0]!.createdAt) + 1).toISOString();
    const token = {
        storeId: storeA,
        jobId: terminal.job.jobId,
        requestId: terminal.job.request.requestId,
        expectedJobUpdatedAt: terminal.job.updatedAt,
        expectedImportState: 'pending' as const,
        expectedRunId: `import_${terminal.job.jobId}`,
        expectedAuthorityProofSha256: fingerprintLingxingCollectionAuthorityProof(proof),
    };
    expect(() => reopenedRepository.completeRecoveredCollectionImportForStore(token, {
        attemptedAt,
        completedAt: proof.importRuns[0]!.completedAt,
    })).toThrow(/COLLECTION_IMPORT_RECOVERY_CAS_INVALID/);
    expect(reopenedRepository.getCollectionJobForStore(storeA, terminal.job.jobId)).toMatchObject({
        importState: 'pending',
        updatedAt: attemptedAt,
    });
    const succeeded = reopenedRepository.completeRecoveredCollectionImportForStore(token, {
        attemptedAt,
        completedAt: recoveryCompletedAt,
    });
    expect(succeeded).toMatchObject({
        importState: 'succeeded',
        importAttemptedAt: attemptedAt,
        importCompletedAt: recoveryCompletedAt,
        updatedAt: recoveryCompletedAt,
    });
    expect(() => reopenedRepository.completeRecoveredCollectionImportForStore(token, {
        attemptedAt,
        completedAt: '2026-07-22T00:09:00.000Z',
    })).toThrow(/COLLECTION_IMPORT_RECOVERY_CAS_CONFLICT/);
    expect(reopenedRepository.getCollectionJobForStore(storeA, terminal.job.jobId)?.importCompletedAt)
        .toBe(recoveryCompletedAt);
});

it('does not overwrite pending state when immutable authority evidence drifts before recovery CAS', () => {
    const { database, repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'authority-recovery-drift');
    const attemptedAt = '2026-07-22T00:06:00.000Z';
    terminal.job = {
        ...terminal.job,
        importState: 'pending',
        importAttemptedAt: attemptedAt,
        updatedAt: attemptedAt,
    };
    repository.commitCollectionTerminalForStore(storeA, terminal);
    repository.commitImportForStore(storeA, fullAuthorityImportInput(terminal, attemptedAt, '2026-07-22T00:07:00.000Z'));
    const proof = repository.readUniqueCollectionAuthorityProofForStoreByRequestId(storeA, terminal.job.request.requestId)!;
    const token = {
        storeId: storeA,
        jobId: terminal.job.jobId,
        requestId: terminal.job.request.requestId,
        expectedJobUpdatedAt: terminal.job.updatedAt,
        expectedImportState: 'pending' as const,
        expectedRunId: `import_${terminal.job.jobId}`,
        expectedAuthorityProofSha256: fingerprintLingxingCollectionAuthorityProof(proof),
    };
    database.prepare(`
      INSERT INTO report_import_runs (
        store_id, run_id, idempotency_key, input_fingerprint, batch_id,
        status, source_file_count, metric_row_count, reconciliation_count,
        started_at, completed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'completed', 0, 0, 0, ?, ?, ?)
    `).run(storeA, 'foreign-completed-run', 'foreign-completed-run-key', 'b'.repeat(64), terminal.job.jobId, attemptedAt, '2026-07-22T00:07:30.000Z', '2026-07-22T00:07:30.000Z');
    expect(() => repository.completeRecoveredCollectionImportForStore(token, {
        attemptedAt,
        completedAt: '2026-07-22T00:08:00.000Z',
    })).toThrow(/COLLECTION_IMPORT_RECOVERY_CAS_CONFLICT/);
    expect(repository.getCollectionJobForStore(storeA, terminal.job.jobId)).toMatchObject({
        importState: 'pending',
        updatedAt: attemptedAt,
    });
});

it('acquires one same-job resume claim, rotates it on progress, and consumes it once on success', () => {
    const { repository, storeA } = createHarness();
    const terminal = failedFullAuthorityTerminal(storeA, 'same-job-resume-1');
    repository.commitCollectionTerminalForStore(storeA, terminal);
    const packet = repository.getCollectionInPlaceResumeStateForStore(storeA, terminal.job.jobId)!;
    expect(packet.jobId).toBe(terminal.job.jobId);
    expect(packet.files).toHaveLength(3);
    expect(packet.reports.filter((checkpoint) => checkpoint.state === 'downloaded'))
        .toHaveLength(3);
    expect(packet.reports.filter((checkpoint) => checkpoint.state === 'queued'))
        .toHaveLength(5);
    const executionStoreContext = normalizeStoreContextEnvelope({
        ...packet.request.storeContext,
        sessionGeneration: 4,
    });
    const claimInput = {
        jobId: packet.jobId,
        requestId: packet.request.requestId,
        expectedJobUpdatedAt: packet.expectedJobUpdatedAt,
        expectedAuthorityProofSha256: packet.authorityProofSha256,
        executionStoreContext,
        claimedAt: '2026-07-22T00:05:30.000Z',
    };
    const claim = repository.acquireCollectionResumeClaimForStore(storeA, {
        ...claimInput,
        attemptId: 'attempt-same-job-1',
    });
    expect(() => repository.acquireCollectionResumeClaimForStore(storeA, {
        ...claimInput,
        attemptId: 'attempt-double-click',
    })).toThrow(/CLAIM_CONFLICT/);
    const runningAt = '2026-07-22T00:06:00.000Z';
    const runningJob: LingxingCollectionJobSnapshot = {
        ...packet.job,
        state: 'running',
        reports: packet.reports,
        blockerCode: undefined,
        detail: undefined,
        completedAt: undefined,
        updatedAt: runningAt,
    };
    const nextClaim = repository.commitCollectionResumeProgressForStore(storeA, {
        claim,
        event: {
            eventId: `${claim.attemptId}:runner:1`,
            emittedAt: runningAt,
            job: runningJob,
        },
    });
    expect(nextClaim.version).toBe(2);
    expect(nextClaim.claimToken).not.toBe(claim.claimToken);
    expect(() => repository.commitCollectionResumeProgressForStore(storeA, {
        claim,
        event: {
            eventId: `${claim.attemptId}:runner:replay`,
            emittedAt: '2026-07-22T00:06:01.000Z',
            job: { ...runningJob, updatedAt: '2026-07-22T00:06:01.000Z' },
        },
    })).toThrow(/CAS_CONFLICT/);
    const completedAt = '2026-07-22T00:07:00.000Z';
    const reports = packet.reports.map((checkpoint) => ({
        ...checkpoint,
        state: 'downloaded' as const,
        createdReportIdentity: checkpoint.createdReportIdentity ?? {
            provider: 'lingxing' as const,
            reportType: checkpoint.reportType,
            externalReportName: `${checkpoint.reportType}-resumed`,
            externalReportId: `external-resumed-${checkpoint.reportType}`,
            dateStart: packet.request.dateStart,
            dateEnd: packet.request.dateEnd,
            createdAt: '2026-07-22T00:06:30.000Z',
        },
        fileSizeBytes: 2048,
        updatedAt: completedAt,
    }));
    const files: LingxingReportFile[] = reports.map((checkpoint) => (packet.files.find((file) => file.reportType === checkpoint.reportType) ?? {
        id: `${packet.jobId}-${checkpoint.reportType}`,
        batchId: packet.jobId,
        reportType: checkpoint.reportType,
        displayName: `${checkpoint.reportType}.xlsx`,
        status: 'downloaded' as const,
        filePath: `C:/${packet.jobId}/${checkpoint.reportType}.xlsx`,
        fileSizeBytes: 2048,
        createdAt: '2026-07-22T00:06:30.000Z',
        updatedAt: completedAt,
    })).map((file) => ({ ...file, status: 'downloaded', updatedAt: completedAt }));
    const prepared = repository.commitCollectionResumeRunnerResultForStore(storeA, {
        claim: nextClaim,
        job: {
            ...runningJob,
            state: 'completed',
            reports,
            completedAt,
            updatedAt: completedAt,
            importState: 'pending',
        },
        batch: {
            ...packet.batch,
            status: 'completed',
            completedAt,
        },
        files,
    });
    expect(prepared.result.job.jobId).toBe(packet.jobId);
    expect(prepared.result.files).toHaveLength(8);
    expect(repository.readUniqueSucceededCollectionResumeReceiptForStore(storeA, packet.jobId, packet.request.requestId)).toBeUndefined();
    const attemptedAt = '2026-07-22T00:07:01.000Z';
    const attemptedClaim = repository.commitCollectionResumeProgressForStore(storeA, {
        claim: prepared.claim,
        event: {
            eventId: `${claim.attemptId}:import:pending`,
            emittedAt: attemptedAt,
            job: {
                ...prepared.result.job,
                importState: 'pending',
                importAttemptedAt: attemptedAt,
                updatedAt: attemptedAt,
            },
        },
    });
    const importCompletedAt = '2026-07-22T00:07:02.000Z';
    const crashImportInput = fullAuthorityImportInput({
        job: { ...prepared.result.job, importAttemptedAt: attemptedAt, updatedAt: attemptedAt },
        batch: prepared.result.batch,
        files: prepared.result.files,
    }, attemptedAt, importCompletedAt);
    const imported = repository.commitImportForStore(storeA, crashImportInput);
    const importedClaim = repository.advanceCollectionResumeClaimAfterImportForStore(storeA, {
        claim: attemptedClaim,
        advancedAt: imported.run.createdAt,
    });
    const succeededAt = new Date(Date.parse(imported.run.createdAt) + 1).toISOString();
    const finalClaim = repository.commitCollectionResumeProgressForStore(storeA, {
        claim: importedClaim,
        event: {
            eventId: `${claim.attemptId}:import:succeeded`,
            emittedAt: succeededAt,
            job: {
                ...prepared.result.job,
                importState: 'succeeded',
                importAttemptedAt: attemptedAt,
                importCompletedAt: succeededAt,
                updatedAt: succeededAt,
            },
        },
    });
    const receipt = repository.finalizeCollectionResumeAttemptForStore(storeA, {
        claim: finalClaim,
        outcome: 'succeeded',
        completedAt: succeededAt,
    });
    expect(receipt).toMatchObject({
        attemptId: claim.attemptId,
        outcome: 'succeeded',
        durableSessionGeneration: 3,
        executionSessionGeneration: 4,
    });
    expect(repository.readUniqueSucceededCollectionResumeReceiptForStore(storeA, packet.jobId, packet.request.requestId)).toEqual(receipt);
    expect(() => repository.finalizeCollectionResumeAttemptForStore(storeA, {
        claim: finalClaim,
        outcome: 'succeeded',
        completedAt: succeededAt,
    })).toThrow(/CAS_CONFLICT/);
});

it('allows an exact full-eight completed-with-errors snapshot to resume its failed report checkpoints in place', () => {
    const { repository, storeA } = createHarness();
    const terminal = failedFullAuthorityTerminal(storeA, 'partial-full8-resume');
    terminal.job = {
        ...terminal.job,
        state: 'completed_with_errors',
    };
    terminal.batch = {
        ...terminal.batch,
        status: 'completed_with_errors',
    };
    repository.commitCollectionTerminalForStore(storeA, terminal);
    const packet = repository.getCollectionInPlaceResumeStateForStore(storeA, terminal.job.jobId);
    expect(packet).toMatchObject({
        jobId: terminal.job.jobId,
        job: { state: 'completed_with_errors' },
    });
    expect(packet?.reports.filter((checkpoint) => checkpoint.state === 'downloaded')).toHaveLength(3);
    expect(packet?.reports.filter((checkpoint) => checkpoint.state === 'queued')).toHaveLength(5);
});

it('preserves a reconciled create failure in the full-eight resume packet', () => {
    const { repository, storeA } = createHarness();
    const terminal = failedFullAuthorityTerminal(storeA, 'deferred-reconciled-create');
    terminal.job = {
        ...terminal.job,
        blockerCode: 'LINGXING_CREATE_CONFIRMED_ABSENT',
        reports: terminal.job.reports.map((checkpoint) => (checkpoint.reportType === 'product_targeting'
            ? {
                reportType: checkpoint.reportType,
                state: 'failed' as const,
                attemptIndex: 0,
                autoRetryCount: 0,
                errorCode: 'LINGXING_CREATE_CONFIRMED_ABSENT',
                detail: '已确认原创建记录不存在，等待单独授权重新创建。',
                updatedAt: checkpoint.updatedAt,
            }
            : checkpoint)),
    };
    repository.commitCollectionTerminalForStore(storeA, terminal);
    const packet = repository.getCollectionInPlaceResumeStateForStore(storeA, terminal.job.jobId);
    expect(packet?.reports.find((checkpoint) => checkpoint.reportType === 'product_targeting'))
        .toEqual(expect.objectContaining({
        state: 'failed',
        errorCode: 'LINGXING_CREATE_CONFIRMED_ABSENT',
    }));
    expect(packet?.reports.filter((checkpoint) => checkpoint.state === 'queued')).toHaveLength(4);
});

it('interrupts an orphaned creating resume at startup without browser work or a reusable claim', () => {
    const { repository, storeA } = createHarness();
    const terminal = failedFullAuthorityTerminal(storeA, 'startup-resume-1', 0);
    repository.commitCollectionTerminalForStore(storeA, terminal);
    const packet = repository.getCollectionInPlaceResumeStateForStore(storeA, terminal.job.jobId)!;
    const claim = repository.acquireCollectionResumeClaimForStore(storeA, {
        jobId: packet.jobId,
        requestId: packet.request.requestId,
        expectedJobUpdatedAt: packet.expectedJobUpdatedAt,
        expectedAuthorityProofSha256: packet.authorityProofSha256,
        executionStoreContext: packet.request.storeContext,
        attemptId: 'attempt-startup-1',
        claimedAt: '2026-07-22T00:05:30.000Z',
    });
    const progressAt = '2026-07-22T00:06:00.000Z';
    repository.commitCollectionResumeProgressForStore(storeA, {
        claim,
        event: {
            eventId: `${claim.attemptId}:runner:1`,
            emittedAt: progressAt,
            changedReportType: packet.reports[0].reportType,
            job: {
                ...packet.job,
                state: 'running',
                completedAt: undefined,
                blockerCode: undefined,
                detail: undefined,
                reports: packet.reports.map((checkpoint, index) => index === 0
                    ? { ...checkpoint, state: 'creating', updatedAt: progressAt }
                    : checkpoint),
                updatedAt: progressAt,
            },
        },
    });
    const receipts = repository.interruptOrphanedCollectionResumeClaimsForStartup('2020-01-01T00:00:00.000Z');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
        attemptId: claim.attemptId,
        outcome: 'interrupted',
    });
    expect(Date.parse(receipts[0].completedAt)).toBeGreaterThan(Date.parse(progressAt));
    const interrupted = repository.getCollectionJobForStore(storeA, packet.jobId)!;
    expect(interrupted.state).toBe('failed');
    expect(interrupted.reports).toEqual(expect.arrayContaining([
        expect.objectContaining({ state: 'create_unknown' }),
    ]));
    expect(() => repository.getCollectionInPlaceResumeStateForStore(storeA, packet.jobId))
        .toThrow(/create_unknown/);
    expect(repository.interruptOrphanedCollectionResumeClaimsForStartup('2026-07-22T00:07:00.000Z')).toEqual([]);
});

it('keeps general recovery away from a no-progress resume claim and preserves its receipt timeline', () => {
    const { repository, storeA } = createHarness();
    const terminal = failedFullAuthorityTerminal(storeA, 'startup-no-progress', 3);
    repository.commitCollectionTerminalForStore(storeA, terminal);
    const packet = repository.getCollectionInPlaceResumeStateForStore(storeA, terminal.job.jobId)!;
    const claimedAt = '2026-07-22T00:05:30.000Z';
    const claim = repository.acquireCollectionResumeClaimForStore(storeA, {
        jobId: packet.jobId,
        requestId: packet.request.requestId,
        expectedJobUpdatedAt: packet.expectedJobUpdatedAt,
        expectedAuthorityProofSha256: packet.authorityProofSha256,
        executionStoreContext: packet.request.storeContext,
        attemptId: 'attempt-no-progress',
        claimedAt,
    });
    expect(repository.recoverInterruptedCollectionJobsForStore(storeA, {
        completedAt: '2026-07-22T00:06:00.000Z',
    })).toEqual([]);
    const receipt = repository.interruptOrphanedCollectionResumeClaimsForStartup('2020-01-01T00:00:00.000Z')[0];
    expect(receipt).toMatchObject({
        attemptId: claim.attemptId,
        outcome: 'interrupted',
    });
    expect(Date.parse(receipt.finalJobUpdatedAt)).toBeGreaterThanOrEqual(Date.parse(claimedAt));
    expect(Date.parse(receipt.completedAt)).toBeGreaterThan(Date.parse(receipt.finalJobUpdatedAt));
    expect(repository.getCollectionJobForStore(storeA, packet.jobId)).toEqual(expect.objectContaining({ state: 'failed', updatedAt: receipt.finalJobUpdatedAt }));
});

it('rejects an in-place packet with duplicate durable files for one report type', () => {
    const { database, repository, storeA } = createHarness();
    const terminal = failedFullAuthorityTerminal(storeA, 'duplicate-resume-file', 1);
    repository.commitCollectionTerminalForStore(storeA, terminal);
    database.prepare(`
      INSERT INTO lingxing_report_files (
        id, batch_id, report_type, display_name, status,
        max_auto_retries, auto_retry_count, file_path, file_size_bytes,
        error_message, attempt_errors_json, failure_screenshot_path,
        failure_dom_snapshot_path, failure_trace_path, trace_unavailable_reason,
        created_at, updated_at, store_id
      )
      SELECT id || '-duplicate', batch_id, report_type, display_name, status,
             max_auto_retries, auto_retry_count, file_path, file_size_bytes,
             error_message, attempt_errors_json, failure_screenshot_path,
             failure_dom_snapshot_path, failure_trace_path, trace_unavailable_reason,
             created_at, updated_at, store_id
      FROM lingxing_report_files
      WHERE store_id = ? AND batch_id = ?
      LIMIT 1
    `).run(storeA, terminal.job.jobId);
    expect(() => repository.getCollectionInPlaceResumeStateForStore(storeA, terminal.job.jobId)).toThrow(/重复 durable file/);
});

it('appends a succeeded successor after startup interrupts the import-commit crash window', () => {
    const { repository, storeA } = createHarness();
    const failed = failedFullAuthorityTerminal(storeA, 'resume-import-crash', 3);
    repository.commitCollectionTerminalForStore(storeA, failed);
    const packet = repository.getCollectionInPlaceResumeStateForStore(storeA, failed.job.jobId)!;
    const claim = repository.acquireCollectionResumeClaimForStore(storeA, {
        jobId: packet.jobId,
        requestId: packet.request.requestId,
        expectedJobUpdatedAt: packet.expectedJobUpdatedAt,
        expectedAuthorityProofSha256: packet.authorityProofSha256,
        executionStoreContext: packet.request.storeContext,
        attemptId: 'attempt-import-crash',
        claimedAt: '2026-07-22T00:05:30.000Z',
    });
    const succeeded = fullAuthorityTerminal(storeA, 'profile-a', packet.jobId);
    const runnerCompletedAt = '2026-07-22T00:07:00.000Z';
    succeeded.job = {
        ...succeeded.job,
        request: packet.request,
        lineage: packet.job.lineage,
        importState: 'pending',
        completedAt: runnerCompletedAt,
        updatedAt: runnerCompletedAt,
    };
    succeeded.batch = {
        ...succeeded.batch,
        requestId: packet.request.requestId,
        downloadDir: packet.batch.downloadDir,
        createdAt: packet.batch.createdAt,
        completedAt: runnerCompletedAt,
    };
    const prepared = repository.commitCollectionResumeRunnerResultForStore(storeA, {
        claim,
        ...succeeded,
    });
    const attemptedAt = '2026-07-22T00:07:01.000Z';
    const attemptedClaim = repository.commitCollectionResumeProgressForStore(storeA, {
        claim: prepared.claim,
        event: {
            eventId: `${claim.attemptId}:import:pending`,
            emittedAt: attemptedAt,
            job: {
                ...prepared.result.job,
                importState: 'pending',
                importAttemptedAt: attemptedAt,
                updatedAt: attemptedAt,
            },
        },
    });
    const importCompletedAt = '2026-07-22T00:07:02.000Z';
    const crashImportInput = fullAuthorityImportInput({
        job: { ...prepared.result.job, importAttemptedAt: attemptedAt, updatedAt: attemptedAt },
        batch: prepared.result.batch,
        files: prepared.result.files,
    }, attemptedAt, importCompletedAt);
    const imported = repository.commitImportForStore(storeA, crashImportInput);
    expect(imported.deduplicated).toBe(false);
    const interrupted = repository.interruptOrphanedCollectionResumeClaimsForStartup('2020-01-01T00:00:00.000Z');
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0].outcome).toBe('interrupted');
    expect(() => repository.advanceCollectionResumeClaimAfterImportForStore(storeA, {
        claim: attemptedClaim,
    })).toThrow(/CAS_CONFLICT/);
    const pendingProof = repository.readUniqueCollectionAuthorityProofForStoreByRequestId(storeA, packet.request.requestId)!;
    const recoveryCompletedAt = new Date(Date.parse(imported.run.createdAt) + 2).toISOString();
    repository.completeRecoveredCollectionImportForStore({
        storeId: storeA,
        jobId: packet.jobId,
        requestId: packet.request.requestId,
        expectedJobUpdatedAt: pendingProof.job.updatedAt,
        expectedImportState: 'pending',
        expectedRunId: imported.run.runId,
        expectedAuthorityProofSha256: fingerprintLingxingCollectionAuthorityProof(pendingProof),
    }, {
        attemptedAt,
        completedAt: recoveryCompletedAt,
    });
    const finalProof = repository.readUniqueCollectionAuthorityProofForStoreByRequestId(storeA, packet.request.requestId)!;
    expect(repository.readUniqueSucceededCollectionResumeReceiptForStore(storeA, packet.jobId, packet.request.requestId)).toMatchObject({
        attemptId: claim.attemptId,
        outcome: 'succeeded',
        finalJobUpdatedAt: finalProof.job.updatedAt,
        finalAuthorityProofSha256: fingerprintLingxingCollectionAuthorityProof(finalProof),
    });
    expect(repository.commitImportForStore(storeA, crashImportInput).deduplicated).toBe(true);
});

it('appends a succeeded successor when startup interrupts before the first import run', () => {
    const { repository, storeA } = createHarness();
    const failed = failedFullAuthorityTerminal(storeA, 'resume-before-import', 3);
    repository.commitCollectionTerminalForStore(storeA, failed);
    const packet = repository.getCollectionInPlaceResumeStateForStore(storeA, failed.job.jobId)!;
    const claim = repository.acquireCollectionResumeClaimForStore(storeA, {
        jobId: packet.jobId,
        requestId: packet.request.requestId,
        expectedJobUpdatedAt: packet.expectedJobUpdatedAt,
        expectedAuthorityProofSha256: packet.authorityProofSha256,
        executionStoreContext: packet.request.storeContext,
        attemptId: 'attempt-before-import',
        claimedAt: '2026-07-22T00:05:30.000Z',
    });
    const completed = fullAuthorityTerminal(storeA, 'profile-a', packet.jobId);
    const runnerCompletedAt = '2026-07-22T00:07:00.000Z';
    completed.job = {
        ...completed.job,
        request: packet.request,
        lineage: packet.job.lineage,
        importState: 'pending',
        completedAt: runnerCompletedAt,
        updatedAt: runnerCompletedAt,
    };
    completed.batch = {
        ...completed.batch,
        requestId: packet.request.requestId,
        downloadDir: packet.batch.downloadDir,
        createdAt: packet.batch.createdAt,
        completedAt: runnerCompletedAt,
    };
    const prepared = repository.commitCollectionResumeRunnerResultForStore(storeA, {
        claim,
        ...completed,
    });
    const attemptedAt = '2026-07-22T00:07:01.000Z';
    repository.commitCollectionResumeProgressForStore(storeA, {
        claim: prepared.claim,
        event: {
            eventId: `${claim.attemptId}:import:pending`,
            emittedAt: attemptedAt,
            job: {
                ...prepared.result.job,
                importState: 'pending',
                importAttemptedAt: attemptedAt,
                updatedAt: attemptedAt,
            },
        },
    });
    const interrupted = repository.interruptOrphanedCollectionResumeClaimsForStartup('2020-01-01T00:00:00.000Z');
    expect(interrupted).toEqual([
        expect.objectContaining({ attemptId: claim.attemptId, outcome: 'interrupted' }),
    ]);
    expect(repository.listImportRunsForStore(storeA)).toEqual([]);
    const importInput = fullAuthorityImportInput({
        job: { ...prepared.result.job, importAttemptedAt: attemptedAt, updatedAt: attemptedAt },
        batch: prepared.result.batch,
        files: prepared.result.files,
    }, attemptedAt, '2026-07-22T00:07:02.000Z');
    const imported = repository.commitImportForStore(storeA, importInput);
    const pendingProof = repository.readUniqueCollectionAuthorityProofForStoreByRequestId(storeA, packet.request.requestId)!;
    const recoveryCompletedAt = new Date(Date.parse(imported.run.createdAt) + 2).toISOString();
    repository.completeRecoveredCollectionImportForStore({
        storeId: storeA,
        jobId: packet.jobId,
        requestId: packet.request.requestId,
        expectedJobUpdatedAt: pendingProof.job.updatedAt,
        expectedImportState: 'pending',
        expectedRunId: imported.run.runId,
        expectedAuthorityProofSha256: fingerprintLingxingCollectionAuthorityProof(pendingProof),
    }, {
        attemptedAt,
        completedAt: recoveryCompletedAt,
    });
    expect(repository.readUniqueSucceededCollectionResumeReceiptForStore(storeA, packet.jobId, packet.request.requestId)).toEqual(expect.objectContaining({
        attemptId: claim.attemptId,
        outcome: 'succeeded',
    }));
    expect(repository.commitImportForStore(storeA, importInput).deduplicated).toBe(true);
});

it.each(['update', 'delete', 'insert'] as const)('rejects authority proof when committed ad metrics drift by %s', (operation) => {
    const { database, repository, storeA } = createHarness();
    const terminal = persistSucceededAuthorityProof(repository, storeA, `metric-evidence-${operation}`);
    expect(repository.readUniqueCollectionAuthorityProofForStoreByRequestId(storeA, terminal.job.request.requestId)?.metricEvidenceCount).toBe(1);
    if (operation === 'update') {
        database.prepare(`
          UPDATE ad_daily_metrics SET clicks = clicks + 1
          WHERE store_id = ? AND batch_id = ?
        `).run(storeA, terminal.job.jobId);
    }
    else if (operation === 'delete') {
        database.prepare(`
          DELETE FROM ad_daily_metrics
          WHERE id = (
            SELECT id FROM ad_daily_metrics WHERE store_id = ? AND batch_id = ? LIMIT 1
          )
        `).run(storeA, terminal.job.jobId);
    }
    else {
        database.prepare(`
          INSERT INTO ad_daily_metrics (
            store_id, batch_id, report_type, date, store_name, marketplace_code,
            impressions, clicks, cost, orders, sales, currency,
            acos, cpc, cvr, source_file, source_row
          ) VALUES (?, ?, 'campaign', '2026-07-21', 'Shop Alpha', 'US',
                    1, 1, 1, 1, 1, 'USD', 1, 1, 1, 'tampered.xlsx', 999)
        `).run(storeA, terminal.job.jobId);
    }
    expect(() => repository.readUniqueCollectionAuthorityProofForStoreByRequestId(storeA, terminal.job.request.requestId)).toThrow(/广告指标与不可变导入证据不一致/);
});
});
