import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  KeywordBidAdapter,
  fingerprintKeywordBidPageSnapshot,
  LINGXING_KEYWORD_BID_ORIGIN,
  LINGXING_KEYWORD_BID_PATH,
  PlaywrightLingxingKeywordBidPage,
  type KeywordBidApplyResult,
  type KeywordBidCommand,
  type KeywordBidPreflightResult,
  type PlaywrightKeywordBidPageLike,
} from '@amazon-ai-ops/action-executor';
import {
  type BrowserLease,
  BrowserLeaseManager,
  type StoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import {
  AnalysisAuthorityRepository,
  ExecutionAuthorityRepository,
  ExecutionAuthorityRepositoryError,
  isPolicyExecutionBatchSafelyRestartable,
  MissionDomainRepository,
  type PolicyGrantDispatchCode,
  type PolicyGrantDispatchRecord,
  type PolicyGrantDispatchTrigger,
} from '@amazon-ai-ops/local-db';
import {
  isTerminalAdExecutionStatus,
  missionControlContextKey,
  type AdExecutionProgressEvent,
  type AdExecutionBatchProjection,
  type AdExecutionJobProjection,
  type AdExecutionStartupRecoveryResult,
  type AdKeywordIdentityVersionRecord,
  type CreateAdExecutionBatchRequest,
  type CreateAdExecutionBatchResult,
  type CancelAdExecutionBatchRequest,
  type MissionGrantRecord,
  type PolicyVersionRules,
  type ResolveAdExecutionIdentityRequest,
  type StartAdExecutionBatchRequest,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type { StoreCoordinator } from './store-coordinator';
import {
  buildExecutionEvidenceInput,
  executionEvidencePath,
  executionIdentityResolutionProofPath,
} from './execution-artifacts';
import type { PolicyDispatchSuppressionReadPort } from './store-collection-policy-suppression';

const EXECUTOR_ACTOR = 'execution-authority';
const OPERATOR_ACTOR = 'operator';
const POLICY_ACTOR = 'policy-engine';
const EXECUTION_LEASE_TTL_MS = 60 * 60 * 1000;

export interface ExecutionBrowserRuntime {
  context: StoreContextEnvelope;
  externalAccountId: string;
  page: PlaywrightKeywordBidPageLike;
  capsule: StoreCapsulePaths;
  navigate(url: string): Promise<void>;
  bringToFront(): Promise<void>;
}

export interface ExecutionAuthorityServiceOptions {
  repository: ExecutionAuthorityRepository;
  missionRepository: MissionDomainRepository;
  analysisRepository: AnalysisAuthorityRepository;
  storeCoordinator: Pick<StoreCoordinator,
    'assertActiveStoreContext' | 'getActiveStoreContext'>;
  leases: BrowserLeaseManager;
  resolveBrowserRuntime(context: StoreContextEnvelope): ExecutionBrowserRuntime;
  emitProgress?(event: AdExecutionProgressEvent): void;
  now?: () => Date;
  policyDispatchRetryMs?: number;
  policyDispatchTimer?: {
    set(callback: () => void, delayMs: number): unknown;
    clear(handle: unknown): void;
  };
  /** Main-only read boundary; acquisition/release authority is intentionally absent. */
  policyDispatchSuppression: PolicyDispatchSuppressionReadPort;
}

interface RunningBatch {
  batchId: string;
  cancelRequested: boolean;
  promise: Promise<AdExecutionBatchProjection>;
}

interface PreparedJob {
  command: KeywordBidCommand;
  preflight: Extract<KeywordBidPreflightResult, { status: 'READY' }>;
  pageIdentityHash: string;
}

interface PolicyDispatchLane {
  context: StoreContextEnvelope;
  trigger: PolicyGrantDispatchTrigger;
  rerunRequested: boolean;
  promise: Promise<void>;
}

interface PolicyDispatchRetryTimer {
  context: StoreContextEnvelope;
  nextRetryAt: string;
  handle: unknown;
}

interface AdmittedAuthorityOperation {
  readonly settlement: Promise<void>;
  settle(): void;
}

export class ExecutionAuthorityShutdownError extends Error {
  readonly code = 'DRAIN_TIMEOUT' as const;

  constructor(
    readonly timeoutMs: number,
    message = 'Execution authority did not drain before the shutdown deadline.',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ExecutionAuthorityShutdownError';
  }
}

/**
 * Main-only Stage 6 coordinator. Renderer input can select only an existing
 * grant/batch/entity; all stable Ads ids, bid values, paths and click targets
 * are reconstructed from the durable authority graph inside Main.
 */
export class ExecutionAuthorityService {
  private readonly repository: ExecutionAuthorityRepository;
  private readonly missionRepository: MissionDomainRepository;
  private readonly analysisRepository: AnalysisAuthorityRepository;
  private readonly storeCoordinator: ExecutionAuthorityServiceOptions['storeCoordinator'];
  private readonly leases: BrowserLeaseManager;
  private readonly resolveBrowserRuntime: ExecutionAuthorityServiceOptions['resolveBrowserRuntime'];
  private readonly emit: NonNullable<ExecutionAuthorityServiceOptions['emitProgress']>;
  private readonly now: () => Date;
  private readonly policyDispatchRetryMs: number;
  private readonly policyDispatchTimer: NonNullable<ExecutionAuthorityServiceOptions['policyDispatchTimer']>;
  private readonly policyDispatchSuppression: PolicyDispatchSuppressionReadPort;
  private readonly running = new Map<string, RunningBatch>();
  private readonly policyDispatchLanes = new Map<string, PolicyDispatchLane>();
  private readonly policyDispatchRetryTimers = new Map<string, PolicyDispatchRetryTimer>();
  private readonly recoveredBatchReconciliations = new Map<string, Set<string>>();
  private readonly admittedOperations = new Set<Promise<void>>();
  private stopping = false;

  constructor(options: ExecutionAuthorityServiceOptions) {
    if (!options.policyDispatchSuppression
      || typeof options.policyDispatchSuppression.isPolicyDispatchSuppressed !== 'function') {
      throw new TypeError('policyDispatchSuppression read port is required');
    }
    this.repository = options.repository;
    this.missionRepository = options.missionRepository;
    this.analysisRepository = options.analysisRepository;
    this.storeCoordinator = options.storeCoordinator;
    this.leases = options.leases;
    this.resolveBrowserRuntime = options.resolveBrowserRuntime;
    this.emit = options.emitProgress ?? (() => undefined);
    this.now = options.now ?? (() => new Date());
    this.policyDispatchRetryMs = normalizePolicyDispatchRetryMs(options.policyDispatchRetryMs);
    this.policyDispatchTimer = options.policyDispatchTimer ?? {
      set: (callback, delayMs) => setTimeout(callback, delayMs),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.policyDispatchSuppression = options.policyDispatchSuppression;
  }

  listBatches(contextInput: StoreContextEnvelope): readonly AdExecutionBatchProjection[] {
    const context = this.assertContext(contextInput);
    this.reconcileRecoveredBatches(context);
    return this.repository.listExecutionBatches(context);
  }

  /**
   * Main-only admission boundary for visible-browser work that still lives in
   * a legacy IPC adapter. Registration happens synchronously before `work` is
   * invoked, so shutdown can prove that every already-admitted browser owner
   * has settled before the registry or authority database is closed.
   */
  async withAdmittedBrowserOperation<Result>(
    label: string,
    work: () => Promise<Result> | Result,
  ): Promise<Result> {
    const admitted = this.admitAuthorityOperation(label);
    try {
      return await work();
    } finally {
      admitted.settle();
    }
  }

  resolveIdentity(
    request: ResolveAdExecutionIdentityRequest,
  ): Promise<AdKeywordIdentityVersionRecord> {
    return this.withAdmittedBrowserOperation(
      'resolve-identity',
      () => this.resolveIdentityAdmitted(request),
    );
  }

  private async resolveIdentityAdmitted(
    request: ResolveAdExecutionIdentityRequest,
  ): Promise<AdKeywordIdentityVersionRecord> {
    const context = this.assertContext(request.context);
    const grant = this.requireLiveGrant(context, request.grantId);
    const adEntityId = requiredId(request.adEntityId, 'adEntityId');
    if (!grant.allowedAdEntityIds.includes(adEntityId)) {
      throw new Error('当前广告对象不在 MissionGrant 的完整批次范围内。');
    }
    const authority = this.analysisRepository.getLatestVerifiedAdEntityById(context, adEntityId);
    if (!authority || authority.entityType !== 'keyword') {
      throw new Error('缺少当前店铺的 Stage 5 关键词身份权威。');
    }
    const knownIdentities = this.repository.listCanonicalKeywordIdentities(context);
    const current = knownIdentities.find((identity) => (
      identity.adEntityId === adEntityId
      && identity.entityRevision === authority.entityRevision
      && identity.resolvedSessionGeneration === context.sessionGeneration
    ));
    if (current) return current;
    const prior = knownIdentities
      .filter((identity) => identity.adEntityId === adEntityId)
      .sort((left, right) => Date.parse(right.resolvedAt) - Date.parse(left.resolvedAt))[0];

    const lease = this.leases.acquire({
      storeId: context.storeId,
      purpose: 'external_write',
      owner: `identity:${grant.id}:${adEntityId}`,
      ttlMs: EXECUTION_LEASE_TTL_MS,
    });
    this.progress(context, grant.id, undefined, 'identity', 'resolving', '正在从当前可见 Ads 页面解析稳定关键词身份。');
    try {
      const runtime = this.requireRuntime(context);
      if (prior) {
        if (prior.adsAccountId !== runtime.externalAccountId) {
          throw new Error('历史关键词身份不属于当前店铺的 Ads 账户，禁止自动重绑。');
        }
        await runtime.navigate(canonicalPageUrl(prior.adsAccountId, prior.campaignId));
        this.assertLeaseAndRuntime(lease, context, runtime.externalAccountId);
      }
      await runtime.bringToFront();
      const page = new PlaywrightLingxingKeywordBidPage(runtime.page);
      const resolution = await page.resolveCurrentKeywordIdentity({
        adEntityId,
        expectedName: authority.entityName,
      });
      if (resolution.status !== 'RESOLVED') {
        throw new Error(resolution.error.message);
      }
      if (resolution.identity.adsAccountId !== runtime.externalAccountId) {
        throw new Error('当前 Ads 页面账户与店铺连接的 externalAccountId 不一致。');
      }
      this.assertLeaseAndRuntime(lease, context, runtime.externalAccountId);
      const resolvedAt = this.timestamp();
      const proofPath = executionIdentityResolutionProofPath(
        runtime.capsule,
        adEntityId,
        authority.entityRevision,
        context.sessionGeneration,
        `${resolution.identity.pageIdentityHash}:${resolution.identity.bidCents}:${resolvedAt}`,
      );
      fs.mkdirSync(path.dirname(proofPath), { recursive: true });
      await page.captureScreenshot(proofPath);
      const confirmed = await page.resolveCurrentKeywordIdentity({
        adEntityId,
        expectedName: authority.entityName,
      });
      if (confirmed.status !== 'RESOLVED'
        || confirmed.identity.pageIdentityHash !== resolution.identity.pageIdentityHash
        || confirmed.identity.bidCents !== resolution.identity.bidCents) {
        throw new Error('身份解析截图前后页面对象或竞价发生变化，禁止建立执行身份。');
      }
      this.assertLeaseAndRuntime(lease, context, runtime.externalAccountId);
      const identity = this.repository.registerCanonicalKeywordIdentity(context, {
        adEntityId,
        entityRevision: authority.entityRevision,
        adsAccountId: resolution.identity.adsAccountId,
        campaignId: resolution.identity.campaignId,
        adGroupId: resolution.identity.adGroupId,
        keywordId: resolution.identity.keywordId,
        observedBidCents: resolution.identity.bidCents,
        pageIdentityHash: resolution.identity.pageIdentityHash,
        resolutionProofSha256: sha256File(proofPath),
        resolvedAt,
        resolvedBy: grant.issuer.type === 'policy' ? POLICY_ACTOR : OPERATOR_ACTOR,
      });
      this.repository.recordCanonicalKeywordAliasResolution(context, {
        id: compactId('keyword-alias', [identity.identityVersionId, context.sessionGeneration]),
        aliasType: 'stage5_ad_entity',
        aliasHash: sha256Text(adEntityId),
        canonicalKeywordId: identity.canonicalKeywordId,
        objectRevision: identity.objectRevision,
        status: 'resolved',
        reason: 'Current visible Lingxing Ads keyword row matched the Stage 5 entity.',
        resolvedAt,
        resolvedBy: EXECUTOR_ACTOR,
      });
      this.progress(context, grant.id, undefined, 'identity', 'ready', '稳定关键词身份已绑定到当前店铺与浏览器会话。');
      return identity;
    } finally {
      releaseLeaseQuietly(this.leases, lease);
    }
  }

  createBatch(request: CreateAdExecutionBatchRequest): CreateAdExecutionBatchResult {
    this.assertNotStopping();
    const context = this.assertContext(request.context);
    this.requireLiveGrant(context, request.grantId);
    const result = this.repository.createExactExecutionBatch(context, request.grantId);
    this.ensureAuthorizedExecutionLink(context, result.projection);
    this.progress(context, result.projection.batch.id, undefined, 'queue', result.projection.batch.status,
      result.created ? '已从不可变授权创建完整串行执行批次。' : '已返回现有幂等执行批次。');
    return result;
  }

  startBatch(request: StartAdExecutionBatchRequest): Promise<AdExecutionBatchProjection> {
    return this.withAdmittedBrowserOperation(
      'start-execution-batch',
      () => this.startBatchAdmitted(request),
    );
  }

  private async startBatchAdmitted(
    request: StartAdExecutionBatchRequest,
  ): Promise<AdExecutionBatchProjection> {
    const context = this.assertContext(request.context);
    const batchId = requiredId(request.batchId, 'batchId');
    const active = this.running.get(String(context.storeId));
    if (active) {
      if (active.batchId !== batchId) throw new Error('当前店铺已有另一个外部写入批次正在运行。');
      return active.promise;
    }
    const running: RunningBatch = {
      batchId,
      cancelRequested: false,
      promise: Promise.resolve(undefined as never),
    };
    running.promise = this.runBatch(context, batchId, running).finally(() => {
      if (this.running.get(String(context.storeId)) === running) {
        this.running.delete(String(context.storeId));
      }
    });
    this.running.set(String(context.storeId), running);
    return running.promise;
  }

  enqueuePolicyGrant(
    contextInput: StoreContextEnvelope,
    grant: MissionGrantRecord,
  ): Promise<void> {
    return this.withAdmittedBrowserOperation(
      'enqueue-policy-grant',
      () => this.enqueuePolicyGrantAdmitted(contextInput, grant),
    );
  }

  private async enqueuePolicyGrantAdmitted(
    contextInput: StoreContextEnvelope,
    grant: MissionGrantRecord,
  ): Promise<void> {
    const context = this.assertContext(contextInput);
    if (grant.issuer.type !== 'policy') throw new Error('只有 policy MissionGrant 可进入自动执行入口。');
    const durable = this.missionRepository.getMissionGrant(context, grant.id);
    if (!durable || durable.issuer.type !== 'policy') {
      throw new Error('Policy MissionGrant 不存在、跨店铺或签发者不匹配。');
    }
    const current = this.policyGrantDispatch(context, grant.id);
    if (current.status === 'completed' || current.status === 'attention_required') return;
    if (!current.eventId) {
      this.repository.appendPolicyGrantDispatchEvent(context, {
        grantId: grant.id,
        status: 'pending',
        trigger: 'grant_issued',
        attempt: 0,
        code: 'DISPATCH_PENDING',
        detail: 'Policy grant was durably journaled before browser or identity work started.',
      });
    }
    if (this.policyDispatchIsSuppressed()) {
      this.clearPolicyDispatchRetry(String(context.storeId));
      return;
    }
    await this.wakePolicyGrantPump(context, 'grant_issued');
  }

  resumePolicyGrantDispatches(
    contextInput: StoreContextEnvelope,
    trigger: Extract<PolicyGrantDispatchTrigger, 'store_activated' | 'session_ready'>,
  ): Promise<void> {
    return this.withAdmittedBrowserOperation(
      'resume-policy-grant-dispatches',
      () => this.resumePolicyGrantDispatchesAdmitted(contextInput, trigger),
    );
  }

  private async resumePolicyGrantDispatchesAdmitted(
    contextInput: StoreContextEnvelope,
    trigger: Extract<PolicyGrantDispatchTrigger, 'store_activated' | 'session_ready'>,
  ): Promise<void> {
    const context = this.assertContext(contextInput);
    if (this.policyDispatchIsSuppressed()) {
      this.clearPolicyDispatchRetry(String(context.storeId));
      return;
    }
    await this.wakePolicyGrantPump(context, trigger);
  }

  cancelBatch(request: CancelAdExecutionBatchRequest): AdExecutionBatchProjection {
    const context = this.assertContext(request.context);
    const batchId = requiredId(request.batchId, 'batchId');
    const projection = this.requireBatch(context, batchId);
    if (projection.jobs.some((job) => ['intent_written', 'submitted', 'verifying', 'unknown'].includes(job.status))) {
      throw new Error('批次已经进入保存边界，不能取消；必须等待回读或进行 UNKNOWN 人工对账。');
    }
    const running = this.running.get(String(context.storeId));
    if (running?.batchId === batchId) running.cancelRequested = true;
    let current = projection;
    for (const job of current.jobs) {
      if (job.status !== 'queued' && job.status !== 'preflight') continue;
      this.repository.cancelJob(context, {
        jobId: job.id,
        expectedRevision: job.revision,
        reasonCode: 'operator_cancelled_before_intent',
        detail: safeReason(request.reason),
      });
      current = this.requireBatch(context, batchId);
    }
    this.revokeGrantAndStopMission(context, current, '批次在保存意图前由操作员取消。', false);
    this.progress(context, batchId, undefined, 'terminal', 'cancelled', '批次已在保存意图前安全取消。');
    return this.requireBatch(context, batchId);
  }

  takeOverVisibleBrowser(
    request: StartAdExecutionBatchRequest,
  ): Promise<{ status: 'VISIBLE'; batchId: string }> {
    return this.withAdmittedBrowserOperation(
      'take-over-visible-browser',
      () => this.takeOverVisibleBrowserAdmitted(request),
    );
  }

  private async takeOverVisibleBrowserAdmitted(
    request: StartAdExecutionBatchRequest,
  ): Promise<{ status: 'VISIBLE'; batchId: string }> {
    const context = this.assertContext(request.context);
    const batchId = requiredId(request.batchId, 'batchId');
    this.requireBatch(context, batchId);
    const lease = this.leases.acquire({
      storeId: context.storeId,
      purpose: 'external_write',
      owner: `takeover:${batchId}`,
      ttlMs: EXECUTION_LEASE_TTL_MS,
    });
    try {
      const runtime = this.requireRuntime(context);
      this.assertLeaseAndRuntime(lease, context, runtime.externalAccountId);
      await runtime.bringToFront();
      this.assertLeaseAndRuntime(lease, context, runtime.externalAccountId);
      this.progress(context, batchId, undefined, 'takeover', 'ready', '已将当前店铺的可见 Ads 浏览器置于前台。');
      return { status: 'VISIBLE', batchId };
    } finally {
      releaseLeaseQuietly(this.leases, lease);
    }
  }

  recoverStartup(): AdExecutionStartupRecoveryResult {
    const result = this.repository.recoverInterruptedExecutions();
    const active = this.storeCoordinator.getActiveStoreContext();
    if (active) {
      this.reconcileExecutionMissionLinks(this.assertContext(active));
    }
    this.repository.recoverPolicyGrantDispatchesOnStartup();
    for (const item of result.domainReconciliations) {
      const batches = this.recoveredBatchReconciliations.get(String(item.storeId)) ?? new Set<string>();
      batches.add(item.batchId);
      this.recoveredBatchReconciliations.set(String(item.storeId), batches);
    }
    if (active) {
      this.reconcileRecoveredBatches(active);
      if (this.policyDispatchIsSuppressed()) return result;
      void this.wakePolicyGrantPump(active, 'startup_recovery').catch(() => {
        this.progress(
          active,
          'policy-dispatch-lane',
          undefined,
          'terminal',
          'blocked',
          '策略派发启动恢复暂未完成，已保留持久化状态。',
        );
      });
    }
    return result;
  }

  reconcileActiveStore(contextInput: StoreContextEnvelope): void {
    const context = this.assertContext(contextInput);
    this.reconcileExecutionMissionLinks(context);
    this.reconcileRecoveredBatches(context);
  }

  assertStoreMutationAllowed(contextInput: StoreContextEnvelope): void {
    const context = this.assertContext(contextInput);
    if (this.policyDispatchLanes.has(String(context.storeId))) {
      throw new Error('当前店铺有策略授权正在建立安全执行批次；派发落账或安全等待后才能切换店铺、重连或修改连接。');
    }
    const active = this.running.get(String(context.storeId));
    if (active) {
      throw new Error(
        `当前店铺执行批次 ${active.batchId} 正在运行；保存边界完成或在队列中安全取消后才能切换店铺、重连或修改连接。`,
      );
    }
  }

  async prepareForShutdown(timeoutMs = 60_000): Promise<void> {
    this.stopping = true;
    for (const storeId of [...this.policyDispatchRetryTimers.keys()]) {
      this.clearPolicyDispatchRetry(storeId);
    }
    [...this.running.values()].forEach((item) => { item.cancelRequested = true; });
    const admitted = [...this.admittedOperations];
    if (admitted.length === 0) return;
    try {
      await waitForExecutionAuthorityDrain(admitted, timeoutMs);
    } catch (error) {
      let reconciliationError: unknown;
      try {
        this.markPostIntentJobsUnknownForShutdown();
      } catch (failure) {
        reconciliationError = failure;
      }
      throw new ExecutionAuthorityShutdownError(
        timeoutMs,
        'Execution authority still owns admitted work at the shutdown deadline.',
        { cause: reconciliationError ?? error },
      );
    }
    const admittedStillTracked = admitted.some((operation) => this.admittedOperations.has(operation));
    if (admittedStillTracked) {
      let reconciliationError: unknown;
      try {
        this.markPostIntentJobsUnknownForShutdown();
      } catch (failure) {
        reconciliationError = failure;
      }
      throw new ExecutionAuthorityShutdownError(
        timeoutMs,
        'Execution authority settlement did not clear the tracked admitted operations.',
        { cause: reconciliationError },
      );
    }
    this.markPostIntentJobsUnknownForShutdown();
  }

  private markPostIntentJobsUnknownForShutdown(): void {
    const active = this.storeCoordinator.getActiveStoreContext();
    if (!active) return;
    const context = this.assertContext(active);
    for (const projection of this.repository.listExecutionBatches(context)) {
      for (const job of projection.jobs) {
        if (!['intent_written', 'submitted', 'verifying'].includes(job.status)) continue;
        this.repository.markUnknown(context, {
          jobId: job.id,
          expectedRevision: job.revision,
          reasonCode: 'shutdown_after_intent',
          detail: 'Application shutdown crossed the persisted submit-intent boundary.',
        });
        const current = this.requireBatch(context, projection.batch.id);
        this.cancelRemainingBeforeIntent(context, current, 'batch_stopped_after_unknown');
        this.revokeGrantAndStopMission(context, current, '应用在保存边界后退出，结果必须人工对账。', true);
      }
    }
  }

  private async runBatch(
    context: StoreContextEnvelope,
    batchId: string,
    running: RunningBatch,
  ): Promise<AdExecutionBatchProjection> {
    let projection = this.requireBatch(context, batchId);
    if (projection.batch.status === 'succeeded') {
      this.finalizeSucceededBatch(context, projection);
      return this.requireBatch(context, batchId);
    }
    if (['blocked', 'unknown', 'cancelled'].includes(projection.batch.status)) return projection;
    const grant = this.requireLiveGrant(context, projection.batch.grantId);
    const lease = this.leases.acquire({
      storeId: context.storeId,
      purpose: 'external_write',
      owner: `execution:${batchId}`,
      ttlMs: EXECUTION_LEASE_TTL_MS,
    });
    const prepared = new Map<string, PreparedJob>();
    this.progress(context, batchId, undefined, 'queue', projection.batch.status, '完整动作批次开始串行预检。');
    try {
      await this.requireRuntime(context).bringToFront();
      // Phase 1: preflight every unfinished job before the first save click.
      for (const original of projection.jobs) {
        if (original.status === 'succeeded') continue;
        if (running.cancelRequested) return this.cancelBatch({ context, batchId, reason: '执行前收到取消请求' });
        let job = this.requireJob(context, batchId, original.id);
        if (job.status === 'queued') {
          job = this.repository.startJob(context, {
            jobId: job.id,
            expectedRevision: job.revision,
          }).job;
        }
        if (job.status !== 'preflight') {
          throw new Error(`动作 ${job.id} 不是可预检状态。`);
        }
        const runtime = await this.navigateToJob(context, job, lease);
        const command = this.commandFor(context, grant, job, runtime.capsule);
        const adapter = new KeywordBidAdapter(new PlaywrightLingxingKeywordBidPage(runtime.page), { now: this.now });
        const preflight = await adapter.preflight(command);
        if (preflight.status !== 'READY') {
          if (grant.issuer.type === 'policy'
            && preflight.error.code === 'PREFLIGHT_BLOCKED'
            && isPolicyExecutionBatchSafelyRestartable(this.requireBatch(context, batchId))) {
            throw new Error('Visible browser preflight is temporarily unavailable before submit intent.');
          }
          this.repository.markBlocked(context, {
            jobId: job.id,
            expectedRevision: job.revision,
            reasonCode: preflight.error.code,
            detail: preflight.error.message,
          });
          projection = this.requireBatch(context, batchId);
          this.cancelRemainingBeforeIntent(context, projection, 'batch_preflight_blocked');
          this.revokeGrantAndStopMission(context, projection, preflight.error.message, false);
          this.progress(context, batchId, job.id, 'terminal', 'blocked', preflight.error.message);
          return this.requireBatch(context, batchId);
        }
        job = this.requireJob(context, batchId, job.id);
        if (job.status === 'cancelled') return this.requireBatch(context, batchId);
        const actualPageIdentityHash = fingerprintKeywordBidPageSnapshot(preflight.snapshot);
        const recorded = this.repository.recordPreflight(context, {
          jobId: job.id,
          expectedRevision: job.revision,
          observedBidCents: preflight.snapshot.keyword.bidCents,
          pageIdentityHash: actualPageIdentityHash,
          canonicalKeywordId: job.canonicalKeywordId,
          objectRevision: job.identity.objectRevision,
        });
        prepared.set(job.id, { command, preflight, pageIdentityHash: actualPageIdentityHash });
        this.progress(context, batchId, job.id, 'preflight', recorded.job.status, '执行前值、稳定身份与页面身份已复核。');
      }

      // Phase 2: one save boundary at a time. Any uncertainty stops the Mission.
      for (const original of projection.jobs) {
        if (original.status === 'succeeded') continue;
        if (running.cancelRequested) return this.cancelBatch({ context, batchId, reason: '保存边界前收到取消请求' });
        let job = this.requireJob(context, batchId, original.id);
        const preparedJob = prepared.get(job.id);
        if (!preparedJob || job.status !== 'preflight') {
          throw new Error(`动作 ${job.id} 缺少当前批次预检。`);
        }
        const runtime = await this.navigateToJob(context, job, lease);
        const adapter = new KeywordBidAdapter(new PlaywrightLingxingKeywordBidPage(runtime.page), { now: this.now });
        let intentJob: AdExecutionJobProjection | undefined;
        let applyResult: KeywordBidApplyResult;
        try {
          applyResult = await adapter.apply(preparedJob.command, preparedJob.preflight, {
            beforeSubmit: async (intent) => {
              this.assertContext(context);
              this.assertLeaseAndRuntime(lease, context, job.identity.adsAccountId);
              this.requireLiveGrant(context, grant.id);
              if (running.cancelRequested || this.stopping) {
                throw new Error('保存意图写入前收到停止请求。');
              }
              const before = buildExecutionEvidenceInput({
                storeId: String(context.storeId),
                batchId,
                jobId: job.id,
                slot: 'before',
                absolutePath: preparedJob.preflight.beforeEvidence.path,
                pageIdentityHash: preparedJob.pageIdentityHash,
                canonicalKeywordId: job.canonicalKeywordId,
                objectRevision: job.identity.objectRevision,
                observedBidCents: job.expectedBidCents,
                capturedAt: preparedJob.preflight.beforeEvidence.capturedAt,
              });
              const submitIntentId = compactId('submit-intent', [
                job.id,
                job.revision,
                intent.commandFingerprint,
              ]);
              intentJob = this.repository.recordSubmitIntent(context, {
                jobId: job.id,
                expectedRevision: job.revision,
                before,
                submitIntentId,
                commandFingerprint: intent.commandFingerprint,
              }).job;
              job = intentJob;
              this.progress(context, batchId, job.id, 'submit', job.status, '保存意图已持久化；下一步只允许单次点击保存。');
              return {
                intentId: requiredId(job.submitIntentId, 'submitIntentId'),
                persistedAt: requiredTimestamp(job.intentWrittenAt, 'intentWrittenAt'),
                commandFingerprint: requiredSha256(job.commandFingerprint, 'commandFingerprint'),
              };
            },
          });
        } catch (error) {
          job = this.requireJob(context, batchId, job.id);
          if (['intent_written', 'submitted', 'verifying'].includes(job.status)) {
            this.markUnknownAndStop(
              context,
              batchId,
              job,
              'COORDINATOR_FAILURE_AFTER_INTENT',
              safeMessage(error),
            );
          } else {
            this.repository.markBlocked(context, {
              jobId: job.id,
              expectedRevision: job.revision,
              reasonCode: 'COORDINATOR_FAILURE_BEFORE_INTENT',
              detail: safeMessage(error),
            });
            projection = this.requireBatch(context, batchId);
            this.cancelRemainingBeforeIntent(context, projection, 'batch_apply_blocked');
            this.revokeGrantAndStopMission(context, projection, safeMessage(error), false);
          }
          return this.requireBatch(context, batchId);
        }

        if (applyResult.status !== 'SUBMITTED') {
          job = this.requireJob(context, batchId, job.id);
          if (job.status === 'cancelled') return this.requireBatch(context, batchId);
          if (grant.issuer.type === 'policy'
            && applyResult.status === 'NOT_SUBMITTED'
            && !applyResult.submitAttempted
            && isPolicyExecutionBatchSafelyRestartable(this.requireBatch(context, batchId))) {
            throw new Error('Final policy permit is temporarily unavailable before submit intent.');
          }
          if (applyResult.status === 'UNKNOWN' || applyResult.submitAttempted) {
            this.markUnknownAndStop(context, batchId, job, applyResult.error.code, applyResult.error.message);
          } else if (job.status === 'intent_written') {
            this.repository.markNotSubmittedAfterIntent(context, {
              jobId: job.id,
              expectedRevision: job.revision,
              reasonCode: applyResult.error.code,
              detail: applyResult.error.message,
            });
            projection = this.requireBatch(context, batchId);
            this.cancelRemainingBeforeIntent(context, projection, 'batch_apply_blocked');
            this.revokeGrantAndStopMission(context, projection, applyResult.error.message, false);
          } else {
            this.repository.markBlocked(context, {
              jobId: job.id,
              expectedRevision: job.revision,
              reasonCode: applyResult.error.code,
              detail: applyResult.error.message,
            });
            projection = this.requireBatch(context, batchId);
            this.cancelRemainingBeforeIntent(context, projection, 'batch_apply_blocked');
            this.revokeGrantAndStopMission(context, projection, applyResult.error.message, false);
          }
          return this.requireBatch(context, batchId);
        }

        try {
          job = this.repository.recordSubmitted(context, {
            jobId: job.id,
            expectedRevision: job.revision,
          }).job;
          const after = buildExecutionEvidenceInput({
            storeId: String(context.storeId),
            batchId,
            jobId: job.id,
            slot: 'after',
            absolutePath: applyResult.afterEvidence.path,
            pageIdentityHash: fingerprintKeywordBidPageSnapshot(applyResult.afterSnapshot),
            canonicalKeywordId: job.canonicalKeywordId,
            objectRevision: job.identity.objectRevision,
            observedBidCents: applyResult.afterSnapshot.keyword.bidCents,
            capturedAt: applyResult.afterEvidence.capturedAt,
          });
          job = this.repository.recordAfterEvidence(context, {
            jobId: job.id,
            expectedRevision: job.revision,
            evidence: after,
          }).job;
          const readback = await adapter.reloadReadback(preparedJob.command, applyResult);
          if (readback.status !== 'VERIFIED') {
            this.markUnknownAndStop(context, batchId, job, readback.error.code, readback.error.message);
            return this.requireBatch(context, batchId);
          }
          const reload = buildExecutionEvidenceInput({
            storeId: String(context.storeId),
            batchId,
            jobId: job.id,
            slot: 'reload',
            absolutePath: readback.reloadEvidence.path,
            pageIdentityHash: fingerprintKeywordBidPageSnapshot(readback.reloadSnapshot),
            canonicalKeywordId: job.canonicalKeywordId,
            objectRevision: job.identity.objectRevision,
            observedBidCents: readback.reloadSnapshot.keyword.bidCents,
            capturedAt: readback.reloadEvidence.capturedAt,
          });
          job = this.repository.recordReloadVerified(context, {
            jobId: job.id,
            expectedRevision: job.revision,
            evidence: reload,
          }).job;
          this.progress(context, batchId, job.id, 'readback', job.status, '提交后证据与独立刷新回读均已命中目标值。');
        } catch (error) {
          job = this.requireJob(context, batchId, job.id);
          if (['intent_written', 'submitted', 'verifying'].includes(job.status)) {
            this.markUnknownAndStop(context, batchId, job, 'COORDINATOR_FAILURE_AFTER_INTENT', safeMessage(error));
          }
          return this.requireBatch(context, batchId);
        }
      }
      projection = this.requireBatch(context, batchId);
      if (projection.jobs.every((job) => job.status === 'succeeded')) {
        this.finalizeSucceededBatch(context, projection);
        this.progress(context, batchId, undefined, 'terminal', 'succeeded', '整批动作已完成 before / after / reload 三段证据闭环。');
      }
      return this.requireBatch(context, batchId);
    } finally {
      releaseLeaseQuietly(this.leases, lease);
    }
  }

  private async navigateToJob(
    context: StoreContextEnvelope,
    job: AdExecutionJobProjection,
    lease: BrowserLease,
  ): Promise<ExecutionBrowserRuntime> {
    this.assertContext(context);
    const runtime = this.requireRuntime(context);
    if (runtime.externalAccountId !== job.identity.adsAccountId) {
      throw new Error('执行对象 Ads 账户与当前店铺连接不一致。');
    }
    this.leases.assertCurrent(lease);
    await runtime.navigate(canonicalPageUrl(job.identity.adsAccountId, job.identity.campaignId));
    this.assertLeaseAndRuntime(lease, context, job.identity.adsAccountId);
    return runtime;
  }

  private commandFor(
    context: StoreContextEnvelope,
    grant: MissionGrantRecord,
    job: AdExecutionJobProjection,
    capsule: StoreCapsulePaths,
  ): KeywordBidCommand {
    const evidencePaths = {
      before: executionEvidencePath(capsule, job.batchId, job.id, 'before'),
      after: executionEvidencePath(capsule, job.batchId, job.id, 'after'),
      reload: executionEvidencePath(capsule, job.batchId, job.id, 'reload'),
    };
    for (const target of Object.values(evidencePaths)) fs.mkdirSync(path.dirname(target), { recursive: true });
    return {
      actionType: 'set_keyword_bid',
      missionGrantId: grant.id,
      storeId: context.storeId,
      browserProfileId: String(context.browserProfileId),
      sessionGeneration: context.sessionGeneration,
      marketplace: 'US',
      currency: 'USD',
      adsAccountId: job.identity.adsAccountId,
      campaignId: job.identity.campaignId,
      adGroupId: job.identity.adGroupId,
      keywordId: job.identity.keywordId,
      objectRevision: job.identity.objectRevision,
      expectedBeforeBidCents: job.expectedBidCents,
      targetBidCents: job.targetBidCents,
      maxChangePct: Math.min(10, grant.maxChangePct),
      pageIdentityExpectation: {
        origin: LINGXING_KEYWORD_BID_ORIGIN,
        pathname: LINGXING_KEYWORD_BID_PATH,
        // US/USD are Main/store authority. The real Lingxing page may expose
        // only a dollar symbol, so DOM markers are never fabricated.
        requiredTextMarkers: [],
      },
      evidencePaths,
    };
  }

  private policyGrantDispatch(
    context: StoreContextEnvelope,
    grantId: string,
  ): PolicyGrantDispatchRecord {
    const dispatch = this.repository.listPolicyGrantDispatches(context)
      .find((candidate) => candidate.grantId === requiredId(grantId, 'grantId'));
    if (!dispatch) throw new Error('Policy MissionGrant 尚未进入可恢复的派发账本。');
    return dispatch;
  }

  private wakePolicyGrantPump(
    contextInput: StoreContextEnvelope,
    trigger: PolicyGrantDispatchTrigger,
  ): Promise<void> {
    const context = this.assertContext(contextInput);
    if (this.stopping) return Promise.resolve();
    const storeKey = String(context.storeId);
    if (this.policyDispatchIsSuppressed()) {
      this.clearPolicyDispatchRetry(storeKey);
      return Promise.resolve();
    }
    const active = this.policyDispatchLanes.get(storeKey);
    if (active) {
      active.rerunRequested = true;
      active.trigger = trigger;
      return active.promise;
    }
    this.clearPolicyDispatchRetry(storeKey);
    const lane: PolicyDispatchLane = {
      context,
      trigger,
      rerunRequested: false,
      promise: Promise.resolve(),
    };
    lane.promise = this.withAdmittedBrowserOperation(
      'policy-grant-dispatch',
      async () => {
        try {
          await this.runPolicyGrantPump(lane);
        } finally {
          if (this.policyDispatchLanes.get(storeKey) === lane) {
            this.policyDispatchLanes.delete(storeKey);
          }
        }
      },
    );
    this.policyDispatchLanes.set(storeKey, lane);
    return lane.promise;
  }

  private async runPolicyGrantPump(lane: PolicyDispatchLane): Promise<void> {
    do {
      lane.rerunRequested = false;
      while (!this.stopping) {
        if (this.policyDispatchIsSuppressed()) {
          this.clearPolicyDispatchRetry(String(lane.context.storeId));
          return;
        }
        const dispatches = this.repository.listPolicyGrantDispatches(lane.context);
        const candidate = dispatches.find((dispatch) => (
          dispatch.status === 'pending'
          || dispatch.status === 'waiting_runtime'
          || dispatch.status === 'queued_for_execution'
        ));
        if (!candidate) break;
        if (this.policyDispatchIsSuppressed()) return;
        if (candidate.status === 'waiting_runtime'
          && lane.trigger === 'timer_retry'
          && candidate.nextRetryAt
          && Date.parse(candidate.nextRetryAt) > this.now().getTime()) {
          this.schedulePolicyDispatchRetry(lane.context, candidate.nextRetryAt);
          break;
        }
        const outcome = await this.runPolicyGrantPumpAttempt(
          lane.context,
          candidate,
          lane.trigger,
        );
        if (outcome === 'wait' || outcome === 'suppressed') return;
      }
    } while (lane.rerunRequested && !this.stopping);
  }

  private async runPolicyGrantPumpAttempt(
    context: StoreContextEnvelope,
    candidate: PolicyGrantDispatchRecord,
    trigger: PolicyGrantDispatchTrigger,
  ): Promise<'continue' | 'wait' | 'suppressed'> {
    const grantId = candidate.grantId;
    if (this.policyDispatchIsSuppressed()) return 'suppressed';
    let current = candidate;
    if (!current.eventId) {
      this.repository.appendPolicyGrantDispatchEvent(context, {
        grantId,
        status: 'pending',
        trigger,
        attempt: 0,
        code: 'DISPATCH_PENDING',
        detail: 'A policy grant is durably pending in the store execution lane.',
      });
      current = this.policyGrantDispatch(context, grantId);
    }
    if (this.policyDispatchIsSuppressed()) return 'suppressed';
    const attempt = current.attemptCount + 1;
    this.repository.appendPolicyGrantDispatchEvent(context, {
      grantId,
      status: 'attempting',
      trigger,
      attempt,
      code: 'DISPATCH_ATTEMPT_STARTED',
      detail: 'The store execution lane started a dispatch attempt.',
      ...(current.batchId ? { batchId: current.batchId } : {}),
    });
    try {
      if (this.policyDispatchIsSuppressed()) {
        return this.holdPolicyGrantDispatchForSuppression(context, grantId, trigger, attempt);
      }
      this.assertPolicyPumpRunning();
      const grant = this.requireDispatchablePolicyGrant(context, grantId);
      if (this.policyDispatchIsSuppressed()) {
        return this.holdPolicyGrantDispatchForSuppression(context, grantId, trigger, attempt);
      }
      this.requireRuntime(context);
      let batch: AdExecutionBatchProjection;
      const refreshed = this.policyGrantDispatch(context, grantId);
      if (refreshed.batchId || refreshed.batchJobCount > 0) {
        if (!refreshed.batchId) {
          return this.completeUnsafeExistingDispatch(
            context,
            refreshed,
            trigger,
            attempt,
          );
        }
        const existing = this.repository.getExecutionBatch(context, refreshed.batchId);
        if (!existing || !isPolicyExecutionBatchSafelyRestartable(existing)) {
          return this.completeUnsafeExistingDispatch(
            context,
            refreshed,
            trigger,
            attempt,
          );
        }
        batch = existing;
      } else {
        for (const adEntityId of grant.allowedAdEntityIds) {
          if (this.policyDispatchIsSuppressed()) {
            return this.holdPolicyGrantDispatchForSuppression(context, grantId, trigger, attempt);
          }
          await this.resolveIdentity({ context, grantId: grant.id, adEntityId });
          if (this.policyDispatchIsSuppressed()) {
            return this.holdPolicyGrantDispatchForSuppression(context, grantId, trigger, attempt);
          }
        }
        this.assertPolicyPumpRunning();
        if (this.policyDispatchIsSuppressed()) {
          return this.holdPolicyGrantDispatchForSuppression(context, grantId, trigger, attempt);
        }
        const created = this.createBatch({ context, grantId });
        batch = created.projection;
        if (!isPolicyExecutionBatchSafelyRestartable(batch)) {
          return this.completeUnsafeExistingDispatch(
            context,
            this.policyGrantDispatch(context, grantId),
            trigger,
            attempt,
          );
        }
        this.repository.appendPolicyGrantDispatchEvent(context, {
          grantId,
          status: 'queued_for_execution',
          trigger,
          attempt,
          code: 'BATCH_QUEUED_FOR_EXECUTION',
          detail: 'The durable batch is queued for the store execution lane.',
          batchId: batch.batch.id,
        });
      }

      if (this.policyDispatchIsSuppressed()) {
        return this.holdPolicyGrantDispatchForSuppression(context, grantId, trigger, attempt);
      }
      this.ensureAuthorizedExecutionLink(context, batch);
      this.assertPolicyPumpRunning();
      this.requireDispatchablePolicyGrant(context, grantId);
      const beforeStart = this.repository.getExecutionBatch(context, batch.batch.id);
      if (!beforeStart || !isPolicyExecutionBatchSafelyRestartable(beforeStart)) {
        return this.completeUnsafeExistingDispatch(
          context,
          this.policyGrantDispatch(context, grantId),
          trigger,
          attempt,
        );
      }
      if (this.policyDispatchIsSuppressed()) {
        return this.holdPolicyGrantDispatchForSuppression(context, grantId, trigger, attempt);
      }
      this.repository.appendPolicyGrantDispatchEvent(context, {
        grantId,
        status: 'queued_for_execution',
        trigger,
        attempt,
        code: 'EXECUTION_START_ACQUIRED',
        detail: 'The store execution lane acquired the pre-intent batch.',
        batchId: beforeStart.batch.id,
      });
      let projection: AdExecutionBatchProjection;
      try {
        if (this.policyDispatchIsSuppressed()) {
          return this.holdPolicyGrantDispatchForSuppression(context, grantId, trigger, attempt);
        }
        projection = await this.startBatch({
          context,
          batchId: beforeStart.batch.id,
        });
      } catch (error) {
        const afterError = this.repository.getExecutionBatch(context, beforeStart.batch.id);
        if (afterError && isPolicyExecutionBatchSafelyRestartable(afterError)) {
          return this.waitPolicyGrantDispatch(
            context,
            grantId,
            trigger,
            attempt,
            beforeStart.batch.id,
            error,
          );
        }
        return this.completeUnsafeExistingDispatch(
          context,
          this.policyGrantDispatch(context, grantId),
          trigger,
          attempt,
        );
      }
      if (isPolicyExecutionBatchSafelyRestartable(projection)) {
        return this.waitPolicyGrantDispatch(
          context,
          grantId,
          trigger,
          attempt,
          projection.batch.id,
          new Error('Execution returned before a durable terminal state.'),
        );
      }
      this.repository.appendPolicyGrantDispatchEvent(context, {
        grantId,
        status: 'completed',
        trigger,
        attempt,
        code: isTerminalAdExecutionStatus(projection.batch.status)
          ? 'EXECUTION_TERMINAL'
          : 'EXECUTION_STATE_REQUIRES_RECONCILIATION',
        detail: 'The execution ledger now owns the durable terminal or reconciliation state.',
        batchId: projection.batch.id,
      });
      return 'continue';
    } catch (error) {
      const failure = classifyPolicyGrantDispatchFailure(error);
      const current = this.policyGrantDispatch(context, grantId);
      if (current.batchId || current.batchJobCount > 0) {
        if (failure.status === 'attention_required') {
          this.repository.appendPolicyGrantDispatchEvent(context, {
            grantId,
            status: 'attention_required',
            trigger,
            attempt,
            code: failure.code,
            detail: failure.message,
            ...(current.batchId ? { batchId: current.batchId } : {}),
          });
          return 'continue';
        }
        const currentBatch = current.batchId
          ? this.repository.getExecutionBatch(context, current.batchId)
          : undefined;
        if (failure.status === 'waiting_runtime'
          && currentBatch
          && isPolicyExecutionBatchSafelyRestartable(currentBatch)) {
          return this.waitPolicyGrantDispatch(
            context,
            grantId,
            trigger,
            attempt,
            current.batchId,
            error,
          );
        }
        return this.completeUnsafeExistingDispatch(
          context,
          current,
          trigger,
          attempt,
        );
      }
      if (failure.status === 'waiting_runtime') {
        return this.waitPolicyGrantDispatch(
          context,
          grantId,
          trigger,
          attempt,
          undefined,
          error,
        );
      }
      this.repository.appendPolicyGrantDispatchEvent(context, {
        grantId,
        status: 'attention_required',
        trigger,
        attempt,
        code: failure.code,
        detail: failure.message,
      });
      this.progress(
        context,
        grantId,
        undefined,
        'terminal',
        'blocked',
        `策略授权派发需要人工修复并重新分析授权：${failure.message}`,
      );
      return 'continue';
    }
  }

  private completeUnsafeExistingDispatch(
    context: StoreContextEnvelope,
    dispatch: PolicyGrantDispatchRecord,
    trigger: PolicyGrantDispatchTrigger,
    attempt: number,
  ): 'continue' {
    if (!dispatch.batchId) {
      this.repository.appendPolicyGrantDispatchEvent(context, {
        grantId: dispatch.grantId,
        status: 'attention_required',
        trigger,
        attempt,
        code: 'UNSAFE_DISPATCH_FAILURE',
        detail: 'Execution jobs exist without a durable batch lineage.',
      });
      return 'continue';
    }
    this.repository.appendPolicyGrantDispatchEvent(context, {
      grantId: dispatch.grantId,
      status: 'completed',
      trigger,
      attempt,
      code: 'EXECUTION_STATE_REQUIRES_RECONCILIATION',
      detail: 'Existing execution state is not safe for automatic restart.',
      batchId: dispatch.batchId,
    });
    return 'continue';
  }

  private ensureAuthorizedExecutionLink(
    context: StoreContextEnvelope,
    projection: AdExecutionBatchProjection,
  ): void {
    const hasExpectedLink = (): boolean => this.missionRepository.getMissionLineage(
      context,
      projection.batch.missionId,
    ).links.some((link) => (
      link.linkType === 'execution'
      && link.targetId === projection.batch.id
      && link.relation === 'authorized_execution_batch'
    ));
    if (hasExpectedLink()) return;
    try {
      this.missionRepository.appendMissionLink(context, {
        id: compactId('link-execution', [projection.batch.id]),
        missionId: projection.batch.missionId,
        linkType: 'execution',
        targetId: projection.batch.id,
        relation: 'authorized_execution_batch',
        actorId: EXECUTOR_ACTOR,
      });
    } catch (error) {
      if (!hasExpectedLink()) throw error;
    }
  }

  private reconcileExecutionMissionLinks(context: StoreContextEnvelope): void {
    for (const projection of this.repository.listExecutionBatchesForStoreReconciliation(context)) {
      try {
        this.ensureAuthorizedExecutionLink(context, projection);
      } catch (error) {
        this.progress(
          context,
          projection.batch.id,
          undefined,
          'terminal',
          'blocked',
          `执行批次 Mission 血缘补全暂未完成：${safeMessage(error)}`,
        );
      }
    }
  }

  private waitPolicyGrantDispatch(
    context: StoreContextEnvelope,
    grantId: string,
    trigger: PolicyGrantDispatchTrigger,
    attempt: number,
    batchId: string | undefined,
    error: unknown,
  ): 'wait' {
    const nextRetryAt = new Date(this.now().getTime() + this.policyDispatchRetryMs).toISOString();
    const suppressed = this.policyDispatchIsSuppressed();
    this.repository.appendPolicyGrantDispatchEvent(context, {
      grantId,
      status: 'waiting_runtime',
      trigger,
      attempt,
      code: batchId ? 'EXECUTION_RETRY_SCHEDULED' : 'RUNTIME_UNAVAILABLE',
      detail: safeMessage(error),
      ...(batchId ? { batchId } : {}),
      ...(!this.stopping && !suppressed ? { nextRetryAt } : {}),
    });
    this.progress(
      context,
      grantId,
      undefined,
      'terminal',
      'blocked',
      `策略授权已安全保留，等待受控恢复：${safeMessage(error)}`,
    );
    if (!this.stopping && !suppressed) this.schedulePolicyDispatchRetry(context, nextRetryAt);
    return 'wait';
  }

  private holdPolicyGrantDispatchForSuppression(
    context: StoreContextEnvelope,
    grantId: string,
    trigger: PolicyGrantDispatchTrigger,
    attempt: number,
  ): 'suppressed' {
    const current = this.policyGrantDispatch(context, grantId);
    this.clearPolicyDispatchRetry(String(context.storeId));
    if (current.status === 'attempting') {
      this.repository.appendPolicyGrantDispatchEvent(context, {
        grantId,
        status: 'waiting_runtime',
        trigger,
        attempt,
        code: 'RUNTIME_UNAVAILABLE',
        detail: 'Policy dispatch is suppressed by active Main collection authority.',
        ...(current.batchId ? { batchId: current.batchId } : {}),
      });
    }
    return 'suppressed';
  }

  private schedulePolicyDispatchRetry(
    context: StoreContextEnvelope,
    nextRetryAt: string,
  ): void {
    if (this.stopping) return;
    const storeKey = String(context.storeId);
    if (this.policyDispatchIsSuppressed()) {
      this.clearPolicyDispatchRetry(storeKey);
      return;
    }
    const existing = this.policyDispatchRetryTimers.get(storeKey);
    if (existing && Date.parse(existing.nextRetryAt) <= Date.parse(nextRetryAt)) return;
    this.clearPolicyDispatchRetry(storeKey);
    const delayMs = Math.max(1, Date.parse(nextRetryAt) - this.now().getTime());
    const handle = this.policyDispatchTimer.set(() => {
      const scheduled = this.policyDispatchRetryTimers.get(storeKey);
      if (!scheduled || scheduled.handle !== handle) return;
      this.policyDispatchRetryTimers.delete(storeKey);
      if (this.stopping) return;
      if (this.policyDispatchIsSuppressed()) return;
      const active = this.storeCoordinator.getActiveStoreContext();
      if (!active || String(active.storeId) !== storeKey) return;
      void this.wakePolicyGrantPump(active, 'timer_retry').catch(() => {
        this.progress(
          active,
          'policy-dispatch-lane',
          undefined,
          'terminal',
          'blocked',
          '策略派发定时恢复暂未完成，持久化状态保持不变。',
        );
      });
    }, delayMs);
    if (handle && typeof handle === 'object' && 'unref' in handle
      && typeof (handle as { unref?: unknown }).unref === 'function') {
      (handle as { unref(): void }).unref();
    }
    this.policyDispatchRetryTimers.set(storeKey, { context, nextRetryAt, handle });
  }

  private clearPolicyDispatchRetry(storeKey: string): void {
    const scheduled = this.policyDispatchRetryTimers.get(storeKey);
    if (!scheduled) return;
    this.policyDispatchRetryTimers.delete(storeKey);
    this.policyDispatchTimer.clear(scheduled.handle);
  }

  private assertPolicyPumpRunning(): void {
    if (this.stopping) {
      throw new PolicyGrantDispatchFailure(
        'waiting_runtime',
        'RUNTIME_UNAVAILABLE',
        'Application shutdown is in progress.',
      );
    }
  }

  private policyDispatchIsSuppressed(): boolean {
    try {
      return this.policyDispatchSuppression.isPolicyDispatchSuppressed() !== false;
    } catch {
      return true;
    }
  }

  private requireDispatchablePolicyGrant(
    context: StoreContextEnvelope,
    grantIdInput: string,
  ): MissionGrantRecord {
    const grantId = requiredId(grantIdInput, 'grantId');
    const grant = this.missionRepository.getMissionGrant(context, grantId);
    if (!grant || grant.issuer.type !== 'policy') {
      throw new PolicyGrantDispatchFailure(
        'attention_required',
        'UNSAFE_DISPATCH_FAILURE',
        'The policy grant is missing or no longer has policy issuer authority.',
      );
    }
    if (grant.createdSessionGeneration !== context.sessionGeneration) {
      throw new PolicyGrantDispatchFailure(
        'attention_required',
        'SESSION_REAUTHORIZATION_REQUIRED',
        'The grant belongs to an earlier store session and cannot be rebound automatically.',
      );
    }
    if (Date.parse(grant.expiresAt) <= this.now().getTime()) {
      throw new PolicyGrantDispatchFailure(
        'attention_required',
        'GRANT_EXPIRED',
        'The policy grant expired before a durable execution batch was created.',
      );
    }
    if (this.missionRepository.getMissionGrantTerminalEvent(context, grant.id)) {
      throw new PolicyGrantDispatchFailure(
        'attention_required',
        'GRANT_TERMINAL',
        'The policy grant is terminal and cannot be dispatched again.',
      );
    }
    const mission = this.missionRepository.getMission(context, grant.missionId);
    if (!mission || mission.status !== 'active'
      || mission.revision !== grant.missionRevision
      || mission.policyVersionId !== grant.policyVersionId) {
      throw new PolicyGrantDispatchFailure(
        'attention_required',
        'MISSION_REVISION_CHANGED',
        'The Mission authority changed; rerun analysis before issuing a fresh grant.',
      );
    }
    const policy = this.missionRepository.getPolicyVersion(context, grant.policyVersionId);
    if (!policy || policy.status !== 'enabled' || policy.revision !== grant.policyRevision) {
      throw new PolicyGrantDispatchFailure(
        'attention_required',
        'POLICY_AUTHORITY_CHANGED',
        'The enabled policy revision changed; rerun policy evaluation before execution.',
      );
    }
    try {
      assertExecutionWindowOpen(policy.rules, context, this.now());
    } catch (error) {
      const message = safeMessage(error);
      if (message.includes('当前不在策略允许的执行窗口内')) {
        throw new PolicyGrantDispatchFailure(
          'waiting_runtime',
          'RUNTIME_UNAVAILABLE',
          'The policy execution window is currently closed.',
        );
      }
      throw new PolicyGrantDispatchFailure(
        'attention_required',
        'POLICY_AUTHORITY_CHANGED',
        message,
      );
    }
    const runtime = this.missionRepository.getPolicyRuntime(context);
    if (runtime.killSwitch
      || runtime.circuitBreakerState !== 'closed'
      || runtime.activePolicyVersionId !== grant.policyVersionId
      || runtime.autonomyMode !== 'policy_auto') {
      throw new PolicyGrantDispatchFailure(
        'waiting_runtime',
        'RUNTIME_UNAVAILABLE',
        'Policy-auto runtime, kill switch, circuit breaker, or active policy is not ready.',
      );
    }
    return grant;
  }

  private requireRuntime(context: StoreContextEnvelope): ExecutionBrowserRuntime {
    const runtime = this.resolveBrowserRuntime(context);
    if (missionControlContextKey(runtime.context) !== missionControlContextKey(context)
      || runtime.capsule.storeId !== context.storeId
      || runtime.capsule.browserProfileId !== context.browserProfileId
      || !requiredId(runtime.externalAccountId, 'externalAccountId')) {
      throw new Error('当前可见浏览器不属于提交的店铺会话。');
    }
    return runtime;
  }

  private assertLeaseAndRuntime(
    lease: BrowserLease,
    context: StoreContextEnvelope,
    expectedAdsAccountId: string,
  ): void {
    this.leases.assertCurrent(lease);
    const runtime = this.requireRuntime(this.assertContext(context));
    if (runtime.externalAccountId !== expectedAdsAccountId) {
      throw new Error('保存边界前 Ads 账户映射已变化。');
    }
  }

  private requireLiveGrant(context: StoreContextEnvelope, grantIdInput: string): MissionGrantRecord {
    const grantId = requiredId(grantIdInput, 'grantId');
    const grant = this.missionRepository.getMissionGrant(context, grantId);
    if (!grant) throw new Error('MissionGrant 不存在或不属于当前店铺。');
    if (grant.marketplace !== 'US' || grant.currency !== 'USD'
      || grant.createdSessionGeneration !== context.sessionGeneration
      || Date.parse(grant.expiresAt) <= this.now().getTime()) {
      throw new Error('MissionGrant 已过期、跨店铺或不属于当前浏览器会话。');
    }
    if (this.missionRepository.getMissionGrantTerminalEvent(context, grant.id)) {
      throw new Error('MissionGrant 已进入终态，禁止再次执行。');
    }
    const mission = this.missionRepository.getMission(context, grant.missionId);
    if (!mission || mission.status !== 'active' || mission.revision !== grant.missionRevision
      || mission.policyVersionId !== grant.policyVersionId) {
      throw new Error('Mission 状态或 revision 已变化，授权已失效。');
    }
    const policy = this.missionRepository.getPolicyVersion(context, grant.policyVersionId);
    if (!policy || policy.status !== 'enabled' || policy.revision !== grant.policyRevision) {
      throw new Error('授权绑定的策略版本不再是当前启用 revision。');
    }
    assertExecutionWindowOpen(policy.rules, context, this.now());
    const runtime = this.missionRepository.getPolicyRuntime(context);
    if (runtime.killSwitch || runtime.circuitBreakerState !== 'closed'
      || runtime.activePolicyVersionId !== grant.policyVersionId
      || (grant.issuer.type === 'policy' && runtime.autonomyMode !== 'policy_auto')) {
      throw new Error('Kill switch、熔断器或策略运行模式阻断执行。');
    }
    return grant;
  }

  private requireBatch(context: StoreContextEnvelope, batchId: string): AdExecutionBatchProjection {
    const projection = this.repository.getExecutionBatch(context, requiredId(batchId, 'batchId'));
    if (!projection) throw new Error('执行批次不存在或不属于当前店铺。');
    return projection;
  }

  private requireJob(
    context: StoreContextEnvelope,
    batchId: string,
    jobId: string,
  ): AdExecutionJobProjection {
    const job = this.requireBatch(context, batchId).jobs.find((candidate) => candidate.id === jobId);
    if (!job) throw new Error('执行动作不存在或不属于当前批次。');
    return job;
  }

  private cancelRemainingBeforeIntent(
    context: StoreContextEnvelope,
    projection: AdExecutionBatchProjection,
    reasonCode: string,
  ): void {
    let current = projection;
    for (const candidate of current.jobs) {
      const job = current.jobs.find((item) => item.id === candidate.id);
      if (!job || (job.status !== 'queued' && job.status !== 'preflight')) continue;
      this.repository.cancelJob(context, {
        jobId: job.id,
        expectedRevision: job.revision,
        reasonCode,
        detail: 'Mission batch stopped before this action entered submit intent.',
      });
      current = this.requireBatch(context, projection.batch.id);
    }
  }

  private markUnknownAndStop(
    context: StoreContextEnvelope,
    batchId: string,
    job: AdExecutionJobProjection,
    reasonCode: string,
    detail: string,
  ): void {
    this.repository.markUnknown(context, {
      jobId: job.id,
      expectedRevision: job.revision,
      reasonCode,
      detail,
    });
    let projection = this.requireBatch(context, batchId);
    this.cancelRemainingBeforeIntent(context, projection, 'batch_stopped_after_unknown');
    projection = this.requireBatch(context, batchId);
    this.revokeGrantAndStopMission(context, projection, detail, true);
    this.progress(context, batchId, job.id, 'terminal', 'unknown', '保存结果无法证明，已停止 Mission 且禁止自动重试。');
  }

  private revokeGrantAndStopMission(
    context: StoreContextEnvelope,
    projection: AdExecutionBatchProjection,
    reason: string,
    unknown: boolean,
  ): void {
    const grantId = projection.batch.grantId;
    if (!this.missionRepository.getMissionGrantTerminalEvent(context, grantId)) {
      this.missionRepository.appendMissionGrantEvent(context, {
        id: compactId('grant-revoked', [grantId, projection.batch.id]),
        grantId,
        eventType: 'revoked',
        actorId: EXECUTOR_ACTOR,
        reason: safeReason(reason),
      });
    }
    const mission = this.missionRepository.getMission(context, projection.batch.missionId);
    if (mission && !['completed', 'archived'].includes(mission.status)) {
      if (mission.status !== 'blocked') {
        this.missionRepository.transitionMission(context, {
          id: mission.id,
          expectedRevision: mission.revision,
          status: 'blocked',
          phase: 'action',
          reason: safeReason(reason),
          actorId: EXECUTOR_ACTOR,
        });
      }
      this.appendCheckpointOnce(context, mission.id, projection.batch.id, 'ACTION',
        unknown ? 'unknown_requires_reconciliation' : 'blocked_before_verified_completion',
        projection.jobs.reduce((total, job) => total + job.evidence.length, 0));
    }
    this.repository.completeDomainReconciliation(context, projection.batch.id);
  }

  private finalizeSucceededBatch(
    context: StoreContextEnvelope,
    projection: AdExecutionBatchProjection,
  ): void {
    const grantId = projection.batch.grantId;
    const terminal = this.missionRepository.getMissionGrantTerminalEvent(context, grantId);
    if (terminal && terminal.eventType !== 'consumed') {
      throw new Error(`执行批次已验证，但授权先进入 ${terminal.eventType}；需要内部账本对账。`);
    }
    if (!terminal) {
      this.missionRepository.appendMissionGrantEvent(context, {
        id: compactId('grant-consumed', [grantId, projection.batch.id]),
        grantId,
        eventType: 'consumed',
        actorId: EXECUTOR_ACTOR,
        reason: 'Every job has after evidence and independent reload verification.',
      });
    }
    for (const job of projection.jobs) {
      let decision = this.missionRepository.getDecision(context, job.decisionId);
      if (decision?.status === 'approved') {
        decision = this.missionRepository.resolveDecision(context, {
          id: decision.id,
          expectedRevision: decision.revision,
          status: 'executed',
          actorId: EXECUTOR_ACTOR,
          reason: `Execution job ${job.id} submitted with durable intent.`,
        });
      }
      if (decision?.status === 'executed') {
        this.missionRepository.resolveDecision(context, {
          id: decision.id,
          expectedRevision: decision.revision,
          status: 'verified',
          actorId: EXECUTOR_ACTOR,
          reason: `Execution job ${job.id} passed after and reload readback.`,
        });
      }
    }
    const evidenceCount = projection.jobs.reduce((total, job) => total + job.evidence.length, 0);
    this.appendCheckpointOnce(context, projection.batch.missionId, projection.batch.id, 'ACTION', 'succeeded', evidenceCount);
    this.appendCheckpointOnce(context, projection.batch.missionId, projection.batch.id, 'READBACK', 'verified', evidenceCount);
    const mission = this.missionRepository.getMission(context, projection.batch.missionId);
    if (mission?.status === 'active' && mission.phase !== 'readback') {
      this.missionRepository.transitionMission(context, {
        id: mission.id,
        expectedRevision: mission.revision,
        status: 'active',
        phase: 'readback',
        reason: 'Execution batch completed with independent reload readback.',
        actorId: EXECUTOR_ACTOR,
      });
    }
    this.repository.completeDomainReconciliation(context, projection.batch.id);
  }

  private appendCheckpointOnce(
    context: StoreContextEnvelope,
    missionId: string,
    batchId: string,
    stage: 'ACTION' | 'READBACK',
    status: string,
    evidenceCount: number,
  ): void {
    const id = compactId('execution-checkpoint', [missionId, batchId, stage]);
    const exists = this.missionRepository.listMissionCheckpoints(context, missionId)
      .some((checkpoint) => checkpoint.id === id);
    if (exists) return;
    this.missionRepository.appendMissionCheckpoint(context, {
      id,
      missionId,
      stage,
      title: stage === 'ACTION' ? '广告动作执行' : '广告执行回读',
      status,
      evidenceCount,
      actorId: EXECUTOR_ACTOR,
    });
  }

  private reconcileRecoveredBatches(context: StoreContextEnvelope): void {
    const pending = this.recoveredBatchReconciliations.get(String(context.storeId));
    if (!pending?.size) return;
    for (const batchId of [...pending]) {
      try {
        const projection = this.requireBatch(context, batchId);
        if (projection.batch.status === 'succeeded') {
          this.finalizeSucceededBatch(context, projection);
        } else {
          this.revokeGrantAndStopMission(
            context,
            projection,
            projection.batch.status === 'unknown'
              ? '启动恢复发现保存边界后的 UNKNOWN；必须人工对账。'
              : `启动恢复确认执行批次已 ${projection.batch.status}。`,
            projection.batch.status === 'unknown',
          );
        }
        pending.delete(batchId);
      } catch (error) {
        this.progress(
          context,
          batchId,
          undefined,
          'terminal',
          'blocked',
          `启动恢复对账暂未完成：${safeMessage(error)}`,
        );
      }
    }
    if (pending.size === 0) this.recoveredBatchReconciliations.delete(String(context.storeId));
  }

  private assertContext(context: StoreContextEnvelope): StoreContextEnvelope {
    return this.storeCoordinator.assertActiveStoreContext(context);
  }

  private admitAuthorityOperation(labelInput: string): AdmittedAuthorityOperation {
    this.assertNotStopping();
    const label = String(labelInput ?? '').trim();
    if (!label) throw new TypeError('admitted authority operation label is required');
    let resolveSettlement!: () => void;
    const settlement = new Promise<void>((resolve) => {
      resolveSettlement = resolve;
    });
    this.admittedOperations.add(settlement);
    let settled = false;
    return {
      settlement,
      settle: () => {
        if (settled) return;
        settled = true;
        this.admittedOperations.delete(settlement);
        resolveSettlement();
      },
    };
  }

  private assertNotStopping(): void {
    if (this.stopping) throw new Error('应用正在退出，禁止启动新的外部写入。');
  }

  private progress(
    context: StoreContextEnvelope,
    batchId: string,
    jobId: string | undefined,
    phase: AdExecutionProgressEvent['phase'],
    status: AdExecutionProgressEvent['status'],
    message: string,
  ): void {
    this.emit({
      storeId: context.storeId,
      batchId,
      ...(jobId ? { jobId } : {}),
      phase,
      status,
      message,
      occurredAt: this.timestamp(),
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function canonicalPageUrl(adsAccountId: string, campaignId: string): string {
  return `${LINGXING_KEYWORD_BID_ORIGIN}${LINGXING_KEYWORD_BID_PATH}`
    + `?profile_id=${encodeURIComponent(requiredId(adsAccountId, 'adsAccountId'))}`
    + `&id=${encodeURIComponent(requiredId(campaignId, 'campaignId'))}`;
}

function requiredId(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(normalized)) {
    throw new TypeError(`${field} must be an opaque logical identifier.`);
  }
  return normalized;
}

function requiredSha256(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${field} must be a SHA-256 value.`);
  }
  return normalized;
}

function requiredTimestamp(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!Number.isFinite(Date.parse(normalized))
    || new Date(normalized).toISOString() !== normalized) {
    throw new TypeError(`${field} must be an ISO timestamp.`);
  }
  return normalized;
}

function assertExecutionWindowOpen(
  rules: PolicyVersionRules,
  context: StoreContextEnvelope,
  now: Date,
): void {
  const window = rules.executionWindow;
  if (!window || window.timeZone !== context.businessTimezone
    || !Array.isArray(window.daysOfWeek)
    || typeof window.start !== 'string'
    || typeof window.end !== 'string'
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(window.start)
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(window.end)) {
    throw new Error('策略执行窗口与当前店铺业务时区不一致。');
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
      timeZone: window.timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    throw new Error('策略执行窗口时区无效。');
  }
  const part = (type: Intl.DateTimeFormatPartTypes): string => (
    parts.find((item) => item.type === type)?.value ?? ''
  );
  const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));
  const hour = Number(part('hour'));
  const minute = Number(part('minute'));
  const start = wallClockMinutes(window.start);
  const end = wallClockMinutes(window.end);
  const current = (hour * 60) + minute;
  if (dayOfWeek < 0 || !Number.isSafeInteger(hour) || !Number.isSafeInteger(minute)
    || start >= end || !window.daysOfWeek.includes(dayOfWeek)
    || current < start || current >= end) {
    throw new Error('当前不在策略允许的执行窗口内。');
  }
}

function wallClockMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour * 60) + minute;
}

class PolicyGrantDispatchFailure extends Error {
  constructor(
    readonly status: 'waiting_runtime' | 'attention_required',
    readonly code: PolicyGrantDispatchCode,
    message: string,
  ) {
    super(message);
    this.name = 'PolicyGrantDispatchFailure';
  }
}

function classifyPolicyGrantDispatchFailure(error: unknown): PolicyGrantDispatchFailure {
  if (error instanceof PolicyGrantDispatchFailure) return error;
  if (error instanceof ExecutionAuthorityRepositoryError) {
    if (error.code === 'INVALID_CONTEXT' || error.code === 'STORE_NOT_ACTIVE') {
      return new PolicyGrantDispatchFailure(
        'waiting_runtime',
        'RUNTIME_UNAVAILABLE',
        'The current Amazon Ads connection or visible session is not ready.',
      );
    }
    if (error.code === 'STALE_CONTEXT') {
      return new PolicyGrantDispatchFailure(
        'attention_required',
        'SESSION_REAUTHORIZATION_REQUIRED',
        'The store session changed; the prior grant cannot be rebound automatically.',
      );
    }
    if (error.code === 'REFERENCE_CONFLICT' || error.code === 'REVISION_CONFLICT') {
      return new PolicyGrantDispatchFailure(
        'attention_required',
        'ADS_IDENTITY_AUTHORITY_CHANGED',
        'The durable Ads object identity or revision changed and requires a fresh analysis.',
      );
    }
  }
  const message = safeMessage(error);
  if (/(不属于|不一致|已变化|漂移|重绑|stale|mismatch|drift|cross-session|cross-store|stage 5)/i.test(message)) {
    return new PolicyGrantDispatchFailure(
      'attention_required',
      'ADS_IDENTITY_AUTHORITY_CHANGED',
      message,
    );
  }
  if (/(浏览器|会话|登录|连接|正在运行|租约|browser|session|login|connection|not ready|unavailable|disconnected|another external write|lease)/i.test(message)) {
    return new PolicyGrantDispatchFailure(
      'waiting_runtime',
      'RUNTIME_UNAVAILABLE',
      message,
    );
  }
  return new PolicyGrantDispatchFailure(
    'attention_required',
    'UNSAFE_DISPATCH_FAILURE',
    message,
  );
}

async function waitForExecutionAuthorityDrain(
  operations: readonly Promise<unknown>[],
  timeoutMs: number,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = Object.freeze({});
  try {
    const result = await Promise.race<Readonly<object>>([
      Promise.allSettled(operations).then(() => Object.freeze({})),
      new Promise<Readonly<object>>((resolve) => {
        timeout = setTimeout(() => resolve(timedOut), timeoutMs);
      }),
    ]);
    if (result === timedOut) {
      throw new ExecutionAuthorityShutdownError(timeoutMs);
    }
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizePolicyDispatchRetryMs(value: number | undefined): number {
  if (value === undefined) return 60_000;
  if (!Number.isSafeInteger(value) || value < 1 || value > 24 * 60 * 60 * 1000) {
    throw new TypeError('policyDispatchRetryMs must be an integer between 1ms and 24h.');
  }
  return value;
}

function safeReason(value: unknown): string {
  const normalized = String(value ?? '')
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>]*/g, '[local-path]')
    .replace(/\\\\[^\\/\s"'<>]+[\\/][^\s"'<>]*/g, '[local-path]')
    .replace(/\bfile:(?:\/{2,}|\\{2,})[^\s"'<>]*/gi, '[local-path]')
    .replace(/\bhttps?:\/\/[^\s"'<>?#]+[^\s"'<>]*[?#][^\s"'<>]*/gi, '[url-redacted]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(cookie|authorization|password|passwd|token|secret)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b(account|profile|external_account_id|profile_id)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email-redacted]')
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, ' ');
  return (normalized || 'execution stopped by authority').slice(0, 500);
}

function safeMessage(error: unknown, fallback = '执行协调器发生安全阻断。'): string {
  return error instanceof Error && error.message.trim()
    ? safeReason(error.message)
    : fallback;
}

function compactId(prefix: string, values: readonly unknown[]): string {
  return `${prefix}:${createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 48)}`;
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function releaseLeaseQuietly(manager: BrowserLeaseManager, lease: BrowserLease): void {
  try {
    manager.release(lease);
  } catch {
    // Expired/stale leases are already non-authoritative; never mask the result.
  }
}
