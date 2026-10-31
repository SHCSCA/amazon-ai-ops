import {
  type LingxingCollectionProgressSink,
  type LingxingInPlaceResumeState,
  type RunBatchOptions,
  type RunBatchResult,
} from '@amazon-ai-ops/lingxing-report-collector';
import type {
  CollectionResumeClaim,
} from '@amazon-ai-ops/local-db';
import {
  COLLECTION_LEASE_TTL_MS,
} from "./collection-coordinator-constants";
import {
  type ResumeLingxingCollectionInput,
  type LingxingCollectionCoordinatorResult,
  type LingxingCollectionRuntime,
} from "./collection-coordinator-contracts";
import {
  assertResumeExecutionContext,
  requireResumePersistence,
  resumeAdmissionError,
} from "./collection-coordinator-resume-values";
import {
  transitionCollectionImportState,
  nextCollectionTimestamp,
} from "./collection-coordinator-state-values";
import {
  normalizeCollectionRequest,
  assertProgressBelongsToRequest,
  assertResultBelongsToRequest,
} from "./collection-coordinator-request-values";

import type { CollectionCoordinatorRuntime } from './collection-coordinator-runtime';

export async function resumeInPlace(this: CollectionCoordinatorRuntime,
  input: ResumeLingxingCollectionInput): Promise<LingxingCollectionCoordinatorResult> {
    if (input.canary) throw new Error('LINGXING_COLLECTION_IN_PLACE_RESUME_CANARY_FORBIDDEN');
    const request = normalizeCollectionRequest({
      requestId: input.resumeFrom.request.requestId,
      storeContext: input.resumeFrom.request.storeContext,
      dateStart: input.resumeFrom.request.dateStart,
      dateEnd: input.resumeFrom.request.dateEnd,
      mode: input.resumeFrom.request.mode,
      reportTypes: input.resumeFrom.request.reportTypes,
      ...(input.maxRetries === undefined ? {} : { maxRetries: input.maxRetries }),
      ...(input.appVersion ? { appVersion: input.appVersion } : {}),
    });
    if (request.mode !== 'create-and-download') {
      throw new Error('LINGXING_COLLECTION_IN_PLACE_RESUME_MODE_INVALID');
    }
    assertResumeExecutionContext(request.storeContext, input.currentStoreContext);
    const capturedContext = this.captureAuthority(input.currentStoreContext);
    assertResumeExecutionContext(request.storeContext, capturedContext);
    const persistence = requireResumePersistence(this.dependencies.persistence);

    return this.dependencies.operations.run({
      context: capturedContext,
      owner: `lingxing-collection-resume:${request.requestId}`,
      ttlMs: COLLECTION_LEASE_TTL_MS,
    }, async (operation) => {
      let claim: CollectionResumeClaim | undefined;
      let finalized = false;
      try {
        let runtime: LingxingCollectionRuntime;
        try {
          operation.assertStepCurrent();
          runtime = this.resolveAuthorizedRuntime(capturedContext, false);
          this.dependencies.assertRuntimeCurrent?.(capturedContext, runtime);
        } catch (error) {
          throw resumeAdmissionError(
            'RUNTIME_AUTHORITY',
            '继续采集在当前店铺与浏览器会话核验阶段停止',
            error,
          );
        }
        try {
          await this.dependencies.preflight?.({
            ...request,
            storeContext: capturedContext,
          }, runtime);
          operation.assertStepCurrent();
        } catch (error) {
          throw resumeAdmissionError(
            'PREFLIGHT',
            '继续采集在下载中心安全预检阶段停止',
            error,
          );
        }

        try {
          claim = await persistence.acquireCollectionResumeClaimForStore(
            request.storeContext.storeId,
            {
              jobId: input.resumeFrom.jobId,
              requestId: request.requestId,
              expectedJobUpdatedAt: input.resumeFrom.expectedJobUpdatedAt,
              expectedAuthorityProofSha256: input.resumeFrom.authorityProofSha256,
              executionStoreContext: capturedContext,
            },
          );
        } catch (error) {
          throw resumeAdmissionError(
            'CLAIM',
            '继续采集在持久化恢复权限核验阶段停止',
            error,
          );
        }
        const persistResumeProgress: LingxingCollectionProgressSink = async (event) => {
          assertProgressBelongsToRequest(event, request);
          if (!claim) throw new Error('LINGXING_COLLECTION_RESUME_CLAIM_MISSING');
          claim = await persistence.commitCollectionResumeProgressForStore(
            request.storeContext.storeId,
            { claim, event },
          );
          this.publishResumeProgress(event, capturedContext);
        };
        const options: RunBatchOptions = {
          requestId: request.requestId,
          storeContext: request.storeContext,
          executionStoreContext: capturedContext,
          progressEventNamespace: claim.attemptId,
          dateStart: request.dateStart,
          dateEnd: request.dateEnd,
          storeDisplayName: runtime.storeDisplayName,
          rootDownloadDir: runtime.capsule.downloadsDir,
          ...(input.appVersion ? { appVersion: input.appVersion } : {}),
          reportTypes: request.reportTypes,
          ...(input.maxRetries === undefined ? {} : { maxRetries: input.maxRetries }),
          automation: runtime.automation,
          progressSink: persistResumeProgress,
          authorityGuard: this.buildAuthorityGuard(operation, capturedContext, runtime),
          cancellationGuard: this.buildCancellationGuard(),
          reportContentInspector: this.dependencies.reportContentInspector ?? (async () => { throw new Error('REPORT_CONTENT_INSPECTOR_REQUIRED'); }),
          resumeFrom: input.resumeFrom as LingxingInPlaceResumeState,
          ...(input.deferReconciledCreateFailures === true
            ? { deferReconciledCreateFailures: true }
            : {}),
        };
        let result = await this.runCreateBatch(options);
        operation.assertStepCurrent();
        this.dependencies.assertRuntimeCurrent?.(capturedContext, runtime);
        result = this.cancelResultIfRequested(result, request, capturedContext);
        assertResultBelongsToRequest(result, request, runtime.capsule);

        let importEligible = (
          result.job.state === 'completed'
          && result.job.reports.length === request.reportTypes.length
          && result.job.reports.every((checkpoint) => checkpoint.state === 'downloaded')
          && this.isProductionImportAuthorized(request)
          && this.isProductionResultComplete(request, result)
        );
        let finalizedResult: RunBatchResult = {
          ...result,
          job: transitionCollectionImportState(
            result.job,
            importEligible ? 'pending' : 'not_applicable',
          ),
        };
        finalizedResult = this.cancelResultIfRequested(
          finalizedResult,
          request,
          capturedContext,
        );
        if (finalizedResult.job.state === 'cancelled') importEligible = false;
        if (!claim) throw new Error('LINGXING_COLLECTION_RESUME_CLAIM_MISSING');
        const prepared = await persistence.commitCollectionResumeRunnerResultForStore(
          request.storeContext.storeId,
          { claim, ...finalizedResult },
        );
        claim = prepared.claim;
        finalizedResult = prepared.result;
        this.publishResumeProgress({
          eventId: `${claim.attemptId}:runner-result`,
          emittedAt: finalizedResult.job.updatedAt,
          job: finalizedResult.job,
        }, capturedContext);

        let importSummary: unknown;
        let importFailed = false;
        if (importEligible) {
          this.assertNotCancelled(finalizedResult.job.jobId, request, capturedContext);
          operation.assertStepCurrent();
          const attemptedAt = nextCollectionTimestamp(finalizedResult.job.updatedAt);
          finalizedResult = {
            ...finalizedResult,
            job: transitionCollectionImportState(finalizedResult.job, 'pending', { attemptedAt }),
          };
          claim = await persistence.commitCollectionResumeProgressForStore(
            request.storeContext.storeId,
            {
              claim,
              event: {
                eventId: `${claim.attemptId}:import:pending`,
                emittedAt: finalizedResult.job.updatedAt,
                job: finalizedResult.job,
              },
            },
          );
          this.publishResumeProgress({
            eventId: `${claim.attemptId}:import:pending:durable`,
            emittedAt: finalizedResult.job.updatedAt,
            job: finalizedResult.job,
          }, capturedContext);
          try {
            this.assertNotCancelled(finalizedResult.job.jobId, request, capturedContext);
            const importResult = this.resolveImportResultHandler(request);
            if (!importResult) {
              throw new Error('LINGXING_COLLECTION_IMPORT_HANDLER_UNAVAILABLE');
            }
            importSummary = await importResult(finalizedResult, {
              startedAt: attemptedAt,
              expectedClaim: claim,
              assertBeforeCommit: () => {
                this.assertNotCancelled(finalizedResult.job.jobId, request, capturedContext);
                operation.assertStepCurrent();
                this.dependencies.assertRuntimeCurrent?.(capturedContext, runtime);
              },
            });
            claim = await persistence.advanceCollectionResumeClaimAfterImportForStore(
              request.storeContext.storeId,
              { claim },
            );
          } catch (error) {
            // 若导入已提交则推进到精确不可变后继，否则保留旧证明作为失败写入的 CAS 基础。
            try {
              claim = await persistence.advanceCollectionResumeClaimAfterImportForStore(
                request.storeContext.storeId,
                { claim },
              );
            } catch {
              // 除允许的导入后继外，后续进度 CAS 必须拒绝任何权限漂移。
            }
            const completedAt = nextCollectionTimestamp(finalizedResult.job.updatedAt);
            finalizedResult = {
              ...finalizedResult,
              job: transitionCollectionImportState(finalizedResult.job, 'failed', {
                attemptedAt,
                completedAt,
                error: error instanceof Error ? error.message : String(error),
              }),
            };
            claim = await persistence.commitCollectionResumeProgressForStore(
              request.storeContext.storeId,
              {
                claim,
                event: {
                  eventId: `${claim.attemptId}:import:failed`,
                  emittedAt: finalizedResult.job.updatedAt,
                  job: finalizedResult.job,
                },
              },
            );
            await persistence.finalizeCollectionResumeAttemptForStore(
              request.storeContext.storeId,
              { claim, outcome: 'failed', completedAt: finalizedResult.job.updatedAt },
            );
            finalized = true;
            this.publishResumeProgress({
              eventId: `${claim.attemptId}:final:failed`,
              emittedAt: finalizedResult.job.updatedAt,
              job: finalizedResult.job,
            }, capturedContext);
            importFailed = true;
          }
          if (!importFailed) {
            const completedAt = nextCollectionTimestamp(finalizedResult.job.updatedAt);
            finalizedResult = {
              ...finalizedResult,
              job: transitionCollectionImportState(finalizedResult.job, 'succeeded', {
                attemptedAt,
                completedAt,
              }),
            };
            claim = await persistence.commitCollectionResumeProgressForStore(
              request.storeContext.storeId,
              {
                claim,
                event: {
                  eventId: `${claim.attemptId}:import:succeeded`,
                  emittedAt: finalizedResult.job.updatedAt,
                  job: finalizedResult.job,
                },
              },
            );
            try {
              await persistence.finalizeCollectionResumeAttemptForStore(
                request.storeContext.storeId,
                { claim, outcome: 'succeeded', completedAt: finalizedResult.job.updatedAt },
              );
            } catch (finalizeError) {
              // 成功证明已持久化时，通过同一令牌边界对账，不得消耗为中断失败。
              const reconciled = await persistence.interruptCollectionResumeClaimForStore(
                request.storeContext.storeId,
                {
                  claim,
                  detail: finalizeError instanceof Error
                    ? `succeeded finalize reconciliation: ${finalizeError.message}`
                    : 'succeeded finalize reconciliation',
                },
              );
              if (reconciled.outcome !== 'succeeded') throw finalizeError;
            }
            finalized = true;
          }
        } else {
          if (!claim) throw new Error('LINGXING_COLLECTION_RESUME_CLAIM_MISSING');
          await persistence.finalizeCollectionResumeAttemptForStore(
            request.storeContext.storeId,
            { claim, outcome: 'failed', completedAt: finalizedResult.job.updatedAt },
          );
          finalized = true;
          if (finalizedResult.job.state === 'cancelled') {
            // 取消终态及令牌绑定回执都持久化后才清除易失取消守卫。
            this.dependencies.clearCancellation?.({
              storeId: capturedContext.storeId,
              requestId: request.requestId,
              jobId: finalizedResult.job.jobId,
            });
          }
        }
        this.publishResumeProgress({
          eventId: `${claim.attemptId}:final:${finalizedResult.job.importState ?? 'legacy'}`,
          emittedAt: finalizedResult.job.updatedAt,
          job: finalizedResult.job,
        }, capturedContext);
        return {
          result: finalizedResult,
          ...(importSummary === undefined ? {} : { importSummary }),
        };
      } catch (error) {
        if (claim && !finalized) {
          try {
            await persistence.interruptCollectionResumeClaimForStore(
              request.storeContext.storeId,
              {
                claim,
                detail: error instanceof Error ? error.message : String(error),
              },
            );
          } catch {
            // 保留原始失败；证明漂移由启动恢复的孤立任务接口处理，此处不重开浏览器。
          }
        }
        throw error;
      }
    });
  }
