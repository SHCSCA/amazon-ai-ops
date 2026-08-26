import {
  missionControlContextKey,
  type AdExecutionBatchProjection,
  type AdExecutionProgressEvent,
  type AdExecutionTakeoverResult,
  type AdExecutionUnknownReconciliationResult,
  type AdKeywordIdentityVersionRecord,
  type CancelAdExecutionBatchRequest,
  type CreateAdExecutionBatchRequest,
  type CreateAdExecutionBatchResult,
  type ResolveAdExecutionIdentityRequest,
  type ReconcileUnknownAdExecutionBatchRequest,
  type StartAdExecutionBatchRequest,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';

export interface ExecutionAuthorityRendererApi {
  listBatches(context: StoreContextEnvelope): Promise<readonly AdExecutionBatchProjection[]>;
  resolveIdentity(input: ResolveAdExecutionIdentityRequest): Promise<AdKeywordIdentityVersionRecord>;
  createBatch(input: CreateAdExecutionBatchRequest): Promise<CreateAdExecutionBatchResult>;
  startBatch(input: StartAdExecutionBatchRequest): Promise<AdExecutionBatchProjection>;
  cancelBatch(input: CancelAdExecutionBatchRequest): Promise<AdExecutionBatchProjection>;
  reconcileUnknownBatch(input: ReconcileUnknownAdExecutionBatchRequest): Promise<AdExecutionUnknownReconciliationResult>;
  takeOverVisibleBrowser(input: StartAdExecutionBatchRequest): Promise<AdExecutionTakeoverResult>;
  onProgress(callback: (event: AdExecutionProgressEvent) => void): () => void;
}

const REQUIRED_METHODS = [
  'listBatches',
  'resolveIdentity',
  'createBatch',
  'startBatch',
  'cancelBatch',
  'reconcileUnknownBatch',
  'takeOverVisibleBrowser',
  'onProgress',
] as const satisfies readonly (keyof ExecutionAuthorityRendererApi)[];

export function readExecutionAuthorityWindowApi(
  target: unknown = typeof window === 'undefined' ? undefined : window,
): ExecutionAuthorityRendererApi | null {
  const candidate = (target as {
    electronAPI?: { executionAuthority?: Partial<ExecutionAuthorityRendererApi> };
  } | null)?.electronAPI?.executionAuthority;
  if (!candidate || REQUIRED_METHODS.some((method) => typeof candidate[method] !== 'function')) return null;
  return candidate as ExecutionAuthorityRendererApi;
}

export function assertExecutionProjectionBelongsToContext(
  context: StoreContextEnvelope,
  projection: AdExecutionBatchProjection,
): void {
  missionControlContextKey(context);
  const { batch, jobs } = projection;
  const storeId = String(context.storeId);
  if (String(batch.storeId) !== storeId || batch.marketplace !== 'US' || batch.currency !== 'USD') {
    throw new Error('执行 Authority 返回了跨店铺或非 US/USD 的批次投影。');
  }
  if (!['succeeded', 'blocked', 'unknown', 'cancelled'].includes(batch.status)
    && batch.createdSessionGeneration !== context.sessionGeneration) {
    throw new Error('执行批次不属于当前浏览器会话代次。');
  }
  const invalidJob = jobs.some((job) => (
    String(job.storeId) !== storeId
    || job.batchId !== batch.id
    || job.missionId !== batch.missionId
    || job.grantId !== batch.grantId
    || job.identity.storeId !== context.storeId
    || job.identity.marketplace !== 'US'
    || job.identity.currency !== 'USD'
    || job.targetBidCents >= job.expectedBidCents
    || Math.abs(job.changePct) > 10.000001
    || job.evidence.some((evidence) => (
      String(evidence.storeId) !== storeId
      || evidence.batchId !== batch.id
      || evidence.jobId !== job.id
      || evidence.canonicalKeywordId !== job.canonicalKeywordId
    ))
    || job.events.some((event) => (
      String(event.storeId) !== storeId
      || event.batchId !== batch.id
      || event.jobId !== job.id
    ))
  ));
  if (invalidJob) {
    throw new Error('执行 Authority 返回了断裂 lineage、越权提价或超过 10% 的投影。');
  }
}

type PreviewState = {
  batches: AdExecutionBatchProjection[];
  identities: Map<string, AdKeywordIdentityVersionRecord>;
  listeners: Set<(event: AdExecutionProgressEvent) => void>;
};

const clone = <T,>(value: T): T => structuredClone(value);
const TERMINAL_PREVIEW_STATUSES = new Set(['succeeded', 'blocked', 'unknown', 'cancelled']);

function previewKey(context: StoreContextEnvelope): string {
  return missionControlContextKey(context);
}

function previewIdentity(
  context: StoreContextEnvelope,
  grantId: string,
  adEntityId: string,
): AdKeywordIdentityVersionRecord {
  const token = `${String(context.storeId)}-${adEntityId}`.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  return {
    identityVersionId: `preview-identity:${token}:v1`,
    canonicalKeywordId: `preview-keyword:${token}`,
    adEntityId,
    entityRevision: 1,
    storeId: context.storeId,
    marketplace: 'US',
    currency: 'USD',
    adsAccountId: `preview-ads-account:${String(context.storeId)}`,
    campaignId: 'preview-campaign:us-exact-core',
    adGroupId: 'preview-ad-group:core-terms',
    keywordId: `preview-amazon-keyword:${token}`,
    objectRevision: 1,
    observedBidCents: 120,
    pageIdentityHash: '1'.repeat(64),
    sourceAuthorityId: `preview-source:${grantId}:${adEntityId}`,
    sourceAuthorityProofSha256: '2'.repeat(64),
    resolutionProofSha256: '3'.repeat(64),
    resolvedSessionGeneration: context.sessionGeneration,
    resolvedAt: new Date().toISOString(),
    resolvedBy: grantId.includes('policy') ? 'policy-engine' : 'preview-operator',
    createdAt: new Date().toISOString(),
  };
}

function previewProjection(
  context: StoreContextEnvelope,
  grantId: string,
  identity: AdKeywordIdentityVersionRecord,
): AdExecutionBatchProjection {
  const createdAt = new Date().toISOString();
  const batchId = `preview-batch:${grantId.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase()}`;
  const jobId = `${batchId}:job-1`;
  return {
    batch: {
      id: batchId,
      storeId: context.storeId,
      marketplace: 'US',
      currency: 'USD',
      missionId: 'preview-mission:keyword-efficiency',
      missionRevision: 1,
      grantId,
      actionRevision: 1,
      status: 'queued',
      revision: 1,
      createdSessionGeneration: context.sessionGeneration,
      createdAt,
      updatedAt: createdAt,
    },
    jobs: [{
      id: jobId,
      storeId: context.storeId,
      batchId,
      ordinal: 1,
      missionId: 'preview-mission:keyword-efficiency',
      grantId,
      proposalId: 'preview-proposal:keyword-bid-down',
      decisionId: 'preview-decision:keyword-bid-down',
      decisionRevision: 1,
      actionRevision: 1,
      actionType: 'set_keyword_bid',
      canonicalKeywordId: identity.canonicalKeywordId,
      adEntityId: identity.adEntityId,
      entityRevision: 1,
      identity: {
        storeId: context.storeId,
        marketplace: 'US',
        currency: 'USD',
        adsAccountId: identity.adsAccountId,
        campaignId: identity.campaignId,
        adGroupId: identity.adGroupId,
        keywordId: identity.keywordId,
        objectRevision: 1,
      },
      pageIdentityHash: identity.pageIdentityHash,
      expectedBidCents: 120,
      targetBidCents: 108,
      changePct: -10,
      idempotencyKey: `preview-idempotency:${jobId}`,
      status: 'queued',
      revision: 1,
      createdSessionGeneration: context.sessionGeneration,
      createdAt,
      updatedAt: createdAt,
      evidence: [],
      events: [{
        id: `${jobId}:event-1`,
        storeId: context.storeId,
        batchId,
        jobId,
        sequence: 1,
        eventType: 'queued',
        fromStatus: 'queued',
        toStatus: 'queued',
        actorId: grantId.includes('policy') ? 'policy-engine' : 'preview-operator',
        detail: '仅开发预览：从不可变 MissionGrant 建立内存队列。',
        sessionGeneration: context.sessionGeneration,
        createdAt,
      }],
    }],
  };
}

/** Explicit in-memory development preview. It never reaches Electron or external Ads pages. */
export function createPreviewExecutionAuthorityApi(): ExecutionAuthorityRendererApi {
  const stores = new Map<string, PreviewState>();
  const listeners = new Set<(event: AdExecutionProgressEvent) => void>();
  const stateFor = (context: StoreContextEnvelope): PreviewState => {
    missionControlContextKey(context);
    const key = previewKey(context);
    let state = stores.get(key);
    if (!state) {
      state = { batches: [], identities: new Map(), listeners };
      stores.set(key, state);
    }
    return state;
  };
  const emit = (
    context: StoreContextEnvelope,
    state: PreviewState,
    batchId: string,
    jobId: string | undefined,
    phase: AdExecutionProgressEvent['phase'],
    status: AdExecutionProgressEvent['status'],
    message: string,
  ) => {
    const event: AdExecutionProgressEvent = {
      storeId: context.storeId,
      batchId,
      ...(jobId ? { jobId } : {}),
      phase,
      status,
      message: `仅开发预览 · ${message}`,
      occurredAt: new Date().toISOString(),
    };
    state.listeners.forEach((listener) => listener(clone(event)));
  };
  const replace = (state: PreviewState, projection: AdExecutionBatchProjection) => {
    const index = state.batches.findIndex((item) => item.batch.id === projection.batch.id);
    if (index >= 0) state.batches[index] = projection;
    else state.batches.unshift(projection);
  };
  const requireBatch = (state: PreviewState, batchId: string) => {
    const projection = state.batches.find((item) => item.batch.id === batchId);
    if (!projection) throw new Error('开发预览批次不存在。');
    return projection;
  };
  const transition = (
    projection: AdExecutionBatchProjection,
    status: AdExecutionBatchProjection['batch']['status'],
    eventType: AdExecutionBatchProjection['jobs'][number]['events'][number]['eventType'],
    evidenceSlot?: 'before' | 'after' | 'reload',
  ): AdExecutionBatchProjection => {
    const now = new Date().toISOString();
    const previous = projection.jobs[0];
    const evidence = evidenceSlot ? [...previous.evidence, {
      id: `${previous.id}:evidence:${evidenceSlot}`,
      storeId: previous.storeId,
      batchId: previous.batchId,
      jobId: previous.id,
      slot: evidenceSlot,
      artifactRef: `preview-artifact-${evidenceSlot}`,
      contentSha256: ({ before: '4', after: '5', reload: '6' } as const)[evidenceSlot].repeat(64),
      pageIdentityHash: previous.pageIdentityHash,
      canonicalKeywordId: previous.canonicalKeywordId,
      objectRevision: previous.identity.objectRevision,
      observedBidCents: evidenceSlot === 'before' ? 120 : 108,
      capturedSessionGeneration: previous.createdSessionGeneration,
      capturedAt: now,
      createdAt: now,
    }] : [...previous.evidence];
    const nextJob = {
      ...previous,
      status,
      revision: previous.revision + 1,
      updatedAt: now,
      ...(status === 'intent_written' ? {
        submitIntentId: `preview-intent:${previous.id}`,
        commandFingerprint: '7'.repeat(64),
        intentWrittenAt: now,
      } : {}),
      ...(['succeeded', 'blocked', 'unknown', 'cancelled'].includes(status) ? { terminalAt: now } : {}),
      evidence,
      events: [...previous.events, {
        id: `${previous.id}:event-${previous.events.length + 1}`,
        storeId: previous.storeId,
        batchId: previous.batchId,
        jobId: previous.id,
        sequence: previous.events.length + 1,
        eventType,
        fromStatus: previous.status,
        toStatus: status,
        actorId: 'preview-execution-authority',
        detail: '仅开发预览内存状态推进；未写入真实 Ads。',
        sessionGeneration: previous.createdSessionGeneration,
        createdAt: now,
      }],
    };
    return {
      batch: {
        ...projection.batch,
        status,
        revision: projection.batch.revision + 1,
        updatedAt: now,
        ...(['succeeded', 'blocked', 'unknown', 'cancelled'].includes(status) ? { terminalAt: now } : {}),
      },
      jobs: [nextJob],
    };
  };

  const api: ExecutionAuthorityRendererApi = {
    async listBatches(context: StoreContextEnvelope) {
      return clone(stateFor(context).batches);
    },
    async resolveIdentity(input: ResolveAdExecutionIdentityRequest) {
      const state = stateFor(input.context);
      const identity = previewIdentity(input.context, input.grantId, input.adEntityId);
      state.identities.set(`${input.grantId}:${input.adEntityId}`, identity);
      emit(input.context, state, input.grantId, undefined, 'identity', 'ready', '当前可见 Ads 页身份已解析。');
      return clone(identity);
    },
    async createBatch(input: CreateAdExecutionBatchRequest) {
      const state = stateFor(input.context);
      const identity = [...state.identities.entries()].find(([key]) => key.startsWith(`${input.grantId}:`))?.[1];
      if (!identity) throw new Error('请先解析当前 Ads 页身份，再从 MissionGrant 建队列。');
      const seeded = previewProjection(input.context, input.grantId, identity);
      const existing = state.batches.find((item) => item.batch.id === seeded.batch.id);
      if (existing) return { created: false, projection: clone(existing) };
      replace(state, seeded);
      emit(input.context, state, seeded.batch.id, seeded.jobs[0].id, 'queue', 'queued', '串行队列已创建。');
      return { created: true, projection: clone(seeded) };
    },
    async startBatch(input: StartAdExecutionBatchRequest) {
      const state = stateFor(input.context);
      let projection = requireBatch(state, input.batchId);
      if (TERMINAL_PREVIEW_STATUSES.has(projection.batch.status)) {
        throw new Error(projection.batch.status === 'unknown'
          ? 'UNKNOWN 是终态，禁止自动重试；请人工接管并对账。'
          : '终态执行批次不能再次启动。');
      }
      const jobId = projection.jobs[0].id;
      const stages = [
        ['preflight', 'started', 'preflight', 'preflight', '预检完成，身份与授权仍有效。'],
        ['intent_written', 'submit_intent_recorded', 'submit', 'intent_written', 'before 证据与保存 intent 已先行落入预览台账。', 'before'],
        ['submitted', 'submitted', 'submit', 'submitted', '模拟提交完成。'],
        ['verifying', 'after_recorded', 'readback', 'verifying', 'after 证据已捕获。', 'after'],
      ] as const;
      for (const [status, eventType, phase, progressStatus, message, slot] of stages) {
        projection = transition(projection, status, eventType, slot);
        replace(state, projection);
        emit(input.context, state, input.batchId, jobId, phase, progressStatus, message);
      }
      if (projection.batch.grantId.includes('unknown')) {
        projection = transition(projection, 'unknown', 'unknown');
        replace(state, projection);
        emit(input.context, state, input.batchId, jobId, 'terminal', 'unknown', '结果 UNKNOWN：队列已停止，只能人工接管并对账。');
        return clone(projection);
      }
      projection = transition(projection, 'succeeded', 'reload_verified', 'reload');
      replace(state, projection);
      emit(input.context, state, input.batchId, jobId, 'terminal', 'succeeded', 'reload 回读一致，批次完成。');
      return clone(projection);
    },
    async cancelBatch(input: CancelAdExecutionBatchRequest) {
      const state = stateFor(input.context);
      const current = requireBatch(state, input.batchId);
      if (current.jobs.some((job) => !['queued', 'preflight'].includes(job.status))) {
        throw new Error('intent 已写入，不能取消；请等待回读或人工对账。');
      }
      const projection = transition(current, 'cancelled', 'cancelled');
      replace(state, projection);
      emit(input.context, state, input.batchId, projection.jobs[0].id, 'terminal', 'cancelled', '队列已在 intent 前取消。');
      return clone(projection);
    },
    async reconcileUnknownBatch(input: ReconcileUnknownAdExecutionBatchRequest) {
      const state = stateFor(input.context);
      const projection = requireBatch(state, input.batchId);
      const job = projection.jobs.find((candidate) => candidate.status === 'unknown');
      if (projection.batch.status !== 'unknown' || !job) {
        throw new Error('只有结果不确定批次可以进行只读对账。');
      }
      const now = new Date().toISOString();
      emit(input.context, state, input.batchId, job.id, 'readback', 'unknown', '只读对账命中目标值；预览不会重试保存。');
      return {
        status: 'CONFIRMED_TARGET',
        batchId: input.batchId,
        jobId: job.id,
        originalStatus: 'unknown',
        firstObservedBidCents: job.targetBidCents,
        reloadObservedBidCents: job.targetBidCents,
        observedBidCents: job.targetBidCents,
        observedAt: now,
        firstEvidenceRef: 'artifact:execution:v1:'.concat('8'.repeat(64)),
        reloadEvidenceRef: 'artifact:execution:v1:'.concat('9'.repeat(64)),
        detail: '仅开发预览：两次只读核验均命中目标值；没有再次提交。',
      };
    },
    async takeOverVisibleBrowser(input: StartAdExecutionBatchRequest): Promise<AdExecutionTakeoverResult> {
      const state = stateFor(input.context);
      requireBatch(state, input.batchId);
      emit(input.context, state, input.batchId, undefined, 'takeover', 'ready', '已切换到可见浏览器演示视图。');
      return { status: 'VISIBLE', batchId: input.batchId };
    },
    onProgress(callback: (event: AdExecutionProgressEvent) => void) {
      listeners.add(callback);
      return () => { listeners.delete(callback); };
    },
  };
  return Object.freeze(api);
}
