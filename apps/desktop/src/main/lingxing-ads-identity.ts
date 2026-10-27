// 职责模块保留原有公开接口及安全校验边界。
import { normalizeLingxingCollectionStoreName, normalizeProviderExternalAccountId, } from '@amazon-ai-ops/shared-types';
import type { ProviderCredentialSubmission } from './provider-active-identity';
import { type LingxingAdsProfileEvidence } from './lingxing-ads-contracts';
import { normalizeAccountIdentity } from './lingxing-ads-values';

export function resolveLingxingStableIdentityFromAdsProfile(input: Readonly<{
    accountLabel: string;
    collectionStoreName: string;
    configuredExternalAccountId?: string;
    evidence: LingxingAdsProfileEvidence;
    credentialSubmission?: ProviderCredentialSubmission;
}>): string {
    const observedId = resolveMatchedLingxingAdsProfileIdentity(input);
    const configuredId = normalizeProviderExternalAccountId('lingxing', input.configuredExternalAccountId);
    if (configuredId) {
        if (configuredId !== observedId) {
            throw new Error('领星 Ads 稳定店铺身份与当前连接不一致，登录已阻断。');
        }
        return configuredId;
    }
    const submission = input.credentialSubmission;
    if (!submission
        || submission.credentialSource !== 'typed'
        || !submission.credentialsSubmitted
        || normalizeAccountIdentity(input.accountLabel) !== normalizeAccountIdentity(submission.username)) {
        throw new Error('领星稳定身份首次绑定必须使用与连接账号一致的本次手动登录凭证。');
    }
    return observedId;
}

export function resolveLingxingStableIdentityFromVerifiedContinuation(input: Readonly<{
    accountLabel: string;
    collectionStoreName: string;
    evidence: LingxingAdsProfileEvidence;
    continuation: Readonly<{
        credentialSource: string;
        credentialPersistence: string;
        sessionIdentityVerified: boolean;
        username: string;
    }>;
}>): string {
    const continuation = input.continuation;
    if (continuation.credentialSource !== 'saved'
        || !continuation.sessionIdentityVerified
        || (continuation.credentialPersistence !== 'saved'
            && continuation.credentialPersistence !== 'main_managed')
        || normalizeAccountIdentity(input.accountLabel)
            !== normalizeAccountIdentity(continuation.username)) {
        throw new Error('领星稳定身份续绑只允许使用同一已验证会话与 Main 托管凭证。');
    }
    return resolveMatchedLingxingAdsProfileIdentity(input);
}

export function resolveMatchedLingxingAdsProfileIdentity(input: Readonly<{
    collectionStoreName: string;
    evidence: LingxingAdsProfileEvidence;
}>): string {
    const expectedAlias = normalizeLingxingCollectionStoreName(input.collectionStoreName);
    const observedAlias = normalizeLingxingCollectionStoreName(input.evidence.alias);
    const observedId = normalizeProviderExternalAccountId('lingxing', input.evidence.externalAccountId);
    if (!expectedAlias || observedAlias !== expectedAlias || input.evidence.country !== 'US' || !observedId) {
        throw new Error('领星 Ads 美国站店铺证据与当前连接不一致，登录已阻断。');
    }
    return observedId;
}

export function selectLingxingAdsProfileEvidence(payload: unknown, expectedAlias: string): LingxingAdsProfileEvidence {
    const normalizedExpectedAlias = normalizeLingxingCollectionStoreName(expectedAlias);
    if (!normalizedExpectedAlias) {
        throw new Error('领星下载中心店铺名称无效，Ads 身份识别已阻断。');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('领星 Ads 店铺身份响应无效，登录已阻断。');
    }
    const data = (payload as {
        data?: unknown;
    }).data;
    if (!Array.isArray(data)) {
        throw new Error('领星 Ads 店铺身份响应缺少店铺列表，登录已阻断。');
    }
    const matches = data.flatMap((candidate): LingxingAdsProfileEvidence[] => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
            return [];
        const record = candidate as Record<string, unknown>;
        const alias = normalizeLingxingCollectionStoreName(record.alias);
        if (alias !== normalizedExpectedAlias || record.country !== 'US')
            return [];
        const displayAlias = typeof record.alias === 'string'
            ? record.alias.normalize('NFKC').trim()
            : '';
        const externalAccountId = normalizeProviderExternalAccountId('amazon_ads', record.profile_id);
        if (!externalAccountId) {
            throw new Error('领星 Ads 店铺身份缺少稳定 profile_id，登录已阻断。');
        }
        return [{ alias: displayAlias, country: 'US', externalAccountId }];
    });
    const unique = [...new Map(matches.map((match) => [match.externalAccountId, match])).values()];
    if (unique.length === 0) {
        throw new Error(`领星 Ads 未找到美国站店铺 ${normalizedExpectedAlias}，登录已阻断。`);
    }
    if (unique.length !== 1) {
        throw new Error(`领星 Ads 店铺 ${normalizedExpectedAlias} 对应多个 profile_id，登录已阻断。`);
    }
    return Object.freeze(unique[0]);
}
