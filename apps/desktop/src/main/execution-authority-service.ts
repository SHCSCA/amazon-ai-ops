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
  MissionDomainRepository,
} from '@amazon-ai-ops/local-db';
import {
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
  private readonly running = new Map<string, RunningBatch>();
  private readonly recoveredBatchReconciliations = new Map<string, Set<string>>();
  private stopping = false;

  constructor(options: ExecutionAuthorityServiceOptions) {
    this.repository = options.repository;
    this.missionRepository = options.missionRepository;
    this.analysisRepository = options.analysisRepository;
    this.storeCoordinator = options.storeCoordinator;
    this.leases = options.leases;
    this.resolveBrowserRuntime = options.resolveBrowserRuntime;
    this.emit = options.emitProgress ?? (() => undefined);
    this.now = options.now ?? (() => new Date());
  }

  listBatches(contextInput: StoreContextEnvelope): readonly AdExecutionBatchProjection[] {
    const context = this.assertContext(contextInput);
    this.reconcileRecoveredBatches(context);
    return this.repository.listExecutionBatches(context);
  }

  async resolveIdentity(
    request: ResolveAdExecutionIdentityRequest,
  ): Promise<AdKeywordIdentityVersionRecord> {
    this.assertNotStopping();
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
    const linkId = compactId('link-execution', [result.projection.batch.id]);
    const hasLink = this.missionRepository.getMissionLineage(
      context,
      result.projection.batch.missionId,
    ).links.some((link) => link.id === linkId);
    if (!hasLink) {
      this.missionRepository.appendMissionLink(context, {
        id: linkId,
        missionId: result.projection.batch.missionId,
        linkType: 'execution',
        targetId: result.projection.batch.id,
        relation: 'authorized_execution_batch',
        actorId: EXECUTOR_ACTOR,
      });
    }
    this.progress(context, result.projection.batch.id, undefined, 'queue', result.projection.batch.status,
      result.created ? '已从不可变授权创建完整串行执行批次。' : '已返回现有幂等执行批次。');
    return result;
  }

  async startBatch(request: StartAdExecutionBatchRequest): Promise<AdExecutionBatchProjection> {
    this.assertNotStopping();
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

  async enqueuePolicyGrant(
    contextInput: StoreContextEnvelope,
    grant: MissionGrantRecord,
  ): Promise<void> {
    const context = this.assertContext(contextInput);
    if (grant.issuer.type !== 'policy') throw new Error('只有 policy MissionGrant 可进入自动执行入口。');
    try {
      for (const adEntityId of grant.allowedAdEntityIds) {
        await this.resolveIdentity({ context, grantId: grant.id, adEntityId });
      }
      const created = this.createBatch({ context, grantId: grant.id });
      await this.startBatch({ context, batchId: created.projection.batch.id });
    } catch (error) {
      this.progress(context, grant.id, undefined, 'terminal', 'blocked', safeMessage(
        error,
        '策略授权已签发，但当前可见浏览器/身份条件未满足，未进入保存边界。',
      ));
    }
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

  async takeOverVisibleBrowser(request: StartAdExecutionBatchRequest): Promise<{ status: 'VISIBLE'; batchId: string }> {
    const context = this.assertContext(request.context);
    const batchId = requiredId(request.batchId, 'batchId');
    this.requireBatch(context, batchId);
    await this.requireRuntime(context).bringToFront();
    this.progress(context, batchId, undefined, 'takeover', 'ready', '已将当前店铺的可见 Ads 浏览器置于前台。');
    return { status: 'VISIBLE', batchId };
  }

  recoverStartup(): AdExecutionStartupRecoveryResult {
    const result = this.repository.recoverInterruptedExecutions();
    for (const item of result.domainReconciliations) {
      const batches = this.recoveredBatchReconciliations.get(String(item.storeId)) ?? new Set<string>();
      batches.add(item.batchId);
      this.recoveredBatchReconciliations.set(String(item.storeId), batches);
    }
    const active = this.storeCoordinator.getActiveStoreContext();
    if (active) this.reconcileRecoveredBatches(active);
    return result;
  }

  reconcileActiveStore(contextInput: StoreContextEnvelope): void {
    this.reconcileRecoveredBatches(this.assertContext(contextInput));
  }

  assertStoreMutationAllowed(contextInput: StoreContextEnvelope): void {
    const context = this.assertContext(contextInput);
    const active = this.running.get(String(context.storeId));
    if (active) {
      throw new Error(
        `当前店铺执行批次 ${active.batchId} 正在运行；保存边界完成或在队列中安全取消后才能切换店铺、重连或修改连接。`,
      );
    }
  }

  async prepareForShutdown(timeoutMs = 60_000): Promise<void> {
    this.stopping = true;
    const running = [...this.running.values()];
    running.forEach((item) => { item.cancelRequested = true; });
    if (running.length === 0) return;
    await Promise.race([
      Promise.allSettled(running.map((item) => item.promise)),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
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

function safeReason(value: unknown): string {
  const normalized = String(value ?? '')
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>]*/g, '[local-path]')
    .replace(/\\\\[^\\/\s"'<>]+[\\/][^\s"'<>]*/g, '[local-path]')
    .replace(/\bfile:(?:\/{2,}|\\{2,})[^\s"'<>]*/gi, '[local-path]')
    .replace(/\bhttps?:\/\/[^\s"'<>?#]+[^\s"'<>]*[?#][^\s"'<>]*/gi, '[url-redacted]')
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
