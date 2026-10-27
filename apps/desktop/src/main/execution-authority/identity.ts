import fs from 'node:fs';
import path from 'node:path';
import { PlaywrightLingxingKeywordBidPage } from '@amazon-ai-ops/action-executor';
import { type AdKeywordIdentityVersionRecord, type ResolveAdExecutionIdentityRequest } from '@amazon-ai-ops/shared-types';
import { executionIdentityResolutionProofPath } from '../execution-artifacts';
import  {
  EXECUTOR_ACTOR,
  OPERATOR_ACTOR,
  POLICY_ACTOR,
  EXECUTION_LEASE_TTL_MS,
  canonicalPageUrl,
  requiredId,
  compactId,
  sha256Text,
  sha256File,
  releaseLeaseQuietly,
} from './values';
import type { ExecutionAuthorityServiceContext } from './context';
export function resolveIdentity(this: ExecutionAuthorityServiceContext, request: ResolveAdExecutionIdentityRequest): Promise<AdKeywordIdentityVersionRecord> {
    return this.withAdmittedBrowserOperation('resolve-identity', () => this.resolveIdentityAdmitted(request));
}
export async function resolveIdentityAdmitted(this: ExecutionAuthorityServiceContext, request: ResolveAdExecutionIdentityRequest): Promise<AdKeywordIdentityVersionRecord> {
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
    const current = knownIdentities.find((identity) => (identity.adEntityId === adEntityId
        && identity.entityRevision === authority.entityRevision
        && identity.resolvedSessionGeneration === context.sessionGeneration));
    if (current)
        return current;
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
        const proofPath = executionIdentityResolutionProofPath(runtime.capsule, adEntityId, authority.entityRevision, context.sessionGeneration, `${resolution.identity.pageIdentityHash}:${resolution.identity.bidCents}:${resolvedAt}`);
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
    }
    finally {
        releaseLeaseQuietly(this.leases, lease, this.logger);
    }
}
