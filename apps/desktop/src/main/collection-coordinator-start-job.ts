import {
  type RunBatchOptions,
  type RunBatchResult,
} from '@amazon-ai-ops/lingxing-report-collector';
import {
  COLLECTION_LEASE_TTL_MS,
} from "./collection-coordinator-constants";
import {
  type StartLingxingCollectionInput,
  type LingxingCollectionCoordinatorResult,
} from "./collection-coordinator-contracts";
import {
  transitionCollectionImportState,
  nextCollectionTimestamp,
} from "./collection-coordinator-state-values";
import {
  assertCanaryRequestIdentity,
  attachCollectionLineage,
} from "./collection-coordinator-lineage-values";
import {
  normalizeCollectionRequest,
  assertResultBelongsToRequest,
} from "./collection-coordinator-request-values";

import type { CollectionCoordinatorRuntime } from './collection-coordinator-runtime';

export async function start(this: CollectionCoordinatorRuntime,
  input: StartLingxingCollectionInput): Promise<LingxingCollectionCoordinatorResult> {
    const request = normalizeCollectionRequest(input);
    assertCanaryRequestIdentity(request.requestId, Boolean(input.canary));
    const capturedContext = this.captureAuthority(request.storeContext);

    return this.dependencies.operations.run({
      context: capturedContext,
      owner: `lingxing-collection:${request.requestId}`,
      ttlMs: COLLECTION_LEASE_TTL_MS,
    }, async (operation) => {
      try {
        operation.assertStepCurrent();
        const runtime = this.resolveAuthorizedRuntime(capturedContext, Boolean(input.canary));
        this.dependencies.assertRuntimeCurrent?.(capturedContext, runtime);
        await this.dependencies.preflight?.(request, runtime);
        operation.assertStepCurrent();

        const progressSink = this.buildProgressSink(request, input);
        const authorityGuard = this.buildAuthorityGuard(operation, capturedContext, runtime);
        const cancellationGuard = this.buildCancellationGuard();
        const options: RunBatchOptions = {
          requestId: request.requestId,
          storeContext: capturedContext,
          dateStart: request.dateStart,
          dateEnd: request.dateEnd,
          storeDisplayName: runtime.storeDisplayName,
          rootDownloadDir: runtime.capsule.downloadsDir,
          ...(input.appVersion ? { appVersion: input.appVersion } : {}),
          reportTypes: request.reportTypes,
          ...(input.maxRetries === undefined ? {} : { maxRetries: input.maxRetries }),
          automation: runtime.automation,
          progressSink,
          authorityGuard,
          cancellationGuard,
          ...(input.resumeFrom ? { resumeFrom: input.resumeFrom } : {}),
        };
        const runner = request.mode === 'download-existing'
          ? this.runExistingBatch
          : this.runCreateBatch;
        const runnerResult = await runner(options);
        let result = attachCollectionLineage(runnerResult, request, input);

        // 终态落盘前再次核验 Main 权限，防止异步期间切换店铺后提交正常完成。
        operation.assertStepCurrent();
        this.dependencies.assertRuntimeCurrent?.(capturedContext, runtime);
        result = this.cancelResultIfRequested(result, request, capturedContext);
        assertResultBelongsToRequest(result, request, runtime.capsule);
        let importEligible = (
          !runtime.canary
          && (result.job.state === 'completed' || result.job.state === 'completed_with_errors')
          && !result.job.reports.some((checkpoint) => checkpoint.state === 'create_unknown')
          && this.isProductionImportAuthorized(request, input.lineage)
          && this.isProductionResultComplete(request, result)
        );
        let finalizedResult: RunBatchResult = {
          ...result,
          job: transitionCollectionImportState(
            result.job,
            importEligible ? 'pending' : 'not_applicable',
          ),
        };
        // 取消具有独立权限边界，终态提交前必须回读，不能相信执行器结果。
        finalizedResult = this.cancelResultIfRequested(
          finalizedResult,
          request,
          capturedContext,
        );
        if (finalizedResult.job.state === 'cancelled') importEligible = false;
        await this.dependencies.persistence.persistResult(finalizedResult);
        if (finalizedResult.job.state === 'cancelled') {
          // 取消终态及对应批次文件证明落盘后才清除易失守卫。
          this.dependencies.clearCancellation?.({
            storeId: capturedContext.storeId,
            requestId: request.requestId,
            jobId: finalizedResult.job.jobId,
          });
        }
        this.publishTerminalProgress(finalizedResult);

        let importSummary: unknown;
        if (importEligible) {
          this.assertNotCancelled(result.job.jobId, request, capturedContext);
          operation.assertStepCurrent();
          const attemptedAt = nextCollectionTimestamp(finalizedResult.job.updatedAt);
          finalizedResult = {
            ...finalizedResult,
            job: transitionCollectionImportState(finalizedResult.job, 'pending', {
              attemptedAt,
            }),
          };
          await this.dependencies.persistence.persistImportState(finalizedResult.job);
          this.publishTerminalProgress(finalizedResult);
          try {
            // 导入状态写入后再次检查取消，避免等待期间失效的权限继续写入报表。
            this.assertNotCancelled(result.job.jobId, request, capturedContext);
            const importResult = this.resolveImportResultHandler(request);
            if (!importResult) {
              throw new Error('LINGXING_COLLECTION_IMPORT_HANDLER_UNAVAILABLE');
            }
            importSummary = await importResult(finalizedResult, { startedAt: attemptedAt });
          } catch (error) {
            const completedAt = nextCollectionTimestamp(finalizedResult.job.updatedAt);
            finalizedResult = {
              ...finalizedResult,
              job: transitionCollectionImportState(finalizedResult.job, 'failed', {
                attemptedAt,
                completedAt,
                error: error instanceof Error ? error.message : String(error),
              }),
            };
            await this.dependencies.persistence.persistImportState(finalizedResult.job);
            this.publishTerminalProgress(finalizedResult);
            throw error;
          }
          const completedAt = nextCollectionTimestamp(finalizedResult.job.updatedAt);
          finalizedResult = {
            ...finalizedResult,
            job: transitionCollectionImportState(finalizedResult.job, 'succeeded', {
              attemptedAt,
              completedAt,
            }),
          };
          await this.dependencies.persistence.persistImportState(finalizedResult.job);
          this.publishTerminalProgress(finalizedResult);
        }
        return {
          result: finalizedResult,
          ...(importSummary === undefined ? {} : { importSummary }),
        };
      } catch (error) {
        // 失败路径保留取消守卫，仅在取消终态持久成功后清除。
        throw error;
      }
    });
  }
