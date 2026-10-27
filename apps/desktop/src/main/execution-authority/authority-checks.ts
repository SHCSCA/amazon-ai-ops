import { type BrowserLease } from '@amazon-ai-ops/browser-worker';
import { missionControlContextKey, type MissionGrantRecord, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { ExecutionBrowserRuntime } from './contracts';
import { requiredId, assertExecutionWindowOpen } from './values';
import type { ExecutionAuthorityServiceContext } from './context';
export function requireRuntime(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope): ExecutionBrowserRuntime {
    const runtime = this.resolveBrowserRuntime(context);
    if (missionControlContextKey(runtime.context) !== missionControlContextKey(context)
        || runtime.capsule.storeId !== context.storeId
        || runtime.capsule.browserProfileId !== context.browserProfileId
        || !requiredId(runtime.externalAccountId, 'externalAccountId')) {
        throw new Error('当前可见浏览器不属于提交的店铺会话。');
    }
    return runtime;
}
export function assertLeaseAndRuntime(this: ExecutionAuthorityServiceContext, lease: BrowserLease, context: StoreContextEnvelope, expectedAdsAccountId: string): void {
    this.leases.assertCurrent(lease);
    const runtime = this.requireRuntime(this.assertContext(context));
    if (runtime.externalAccountId !== expectedAdsAccountId) {
        throw new Error('保存边界前 Ads 账户映射已变化。');
    }
}
export function requireLiveGrant(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, grantIdInput: string): MissionGrantRecord {
    const grantId = requiredId(grantIdInput, 'grantId');
    this.missionRepository.expireMissionGrants(context);
    this.repository.assertExecutionGrantAuthority(context, grantId);
    const grant = this.missionRepository.getMissionGrant(context, grantId);
    if (!grant)
        throw new Error('MissionGrant 不存在或不属于当前店铺。');
    const policy = this.missionRepository.getPolicyVersion(context, grant.policyVersionId);
    if (!policy)
        throw new Error('授权绑定的策略版本不存在。');
    assertExecutionWindowOpen(policy.rules, context, this.now());
    return grant;
}
export function assertGrantUsesEffectivePolicyVersion(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, grant: MissionGrantRecord): void {
    const effective = this.missionRepository.resolveEffectivePolicyVersion(context, {
        allowedActionTypes: grant.allowedActionTypes,
        allowedAdEntityIds: grant.allowedAdEntityIds,
        at: this.now().toISOString(),
    });
    if (effective.id !== grant.policyVersionId) {
        throw new Error('授权绑定的策略不再是当前广告对象的最高优先级唯一匹配；请重新运行分析并签发新授权。');
    }
}
export function assertContext(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope): StoreContextEnvelope {
    return this.storeCoordinator.assertActiveStoreContext(context);
}
