import type {
  LingxingCollectionJobSnapshot,
  StoreId,
} from '@amazon-ai-ops/shared-types';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_JOB_ID = /^[A-Za-z0-9._-]{1,180}$/;

export interface LingxingCollectionJobReader {
  getCollectionJobForStore(
    storeId: StoreId,
    jobId: string,
  ): LingxingCollectionJobSnapshot | undefined;
}

export interface LingxingCollectionCancellationIdentity {
  storeId: StoreId;
  requestId: string;
  jobId: string;
}

/**
 * Binds an operator cancellation to one persisted job in one store. A
 * requestId by itself is not an authority identity because callers may reuse
 * it, mistype it, or submit it after a job has already reached a terminal
 * state.
 */
export function bindLingxingCollectionCancellation(
  repository: LingxingCollectionJobReader,
  storeId: StoreId,
  input: { requestId: unknown; jobId: unknown },
): LingxingCollectionCancellationIdentity {
  const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
  const jobId = typeof input.jobId === 'string' ? input.jobId.trim() : '';
  if (!SAFE_REQUEST_ID.test(requestId)) {
    throw new Error('取消采集需要有效的 requestId。');
  }
  if (!SAFE_JOB_ID.test(jobId)) {
    throw new Error('取消采集需要有效的 jobId。');
  }
  const job = repository.getCollectionJobForStore(storeId, jobId);
  if (!job || job.request.requestId !== requestId) {
    throw new Error('取消采集的 jobId 与 requestId 未绑定到当前店铺同一任务。');
  }
  if (job.state !== 'queued' && job.state !== 'running') {
    throw new Error(`任务 ${jobId} 已进入 ${job.state}，不能再取消。`);
  }
  return { storeId, requestId, jobId };
}
