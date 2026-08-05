import {
  normalizeLingxingCollectionStoreName,
  normalizeProviderExternalAccountId,
} from '@amazon-ai-ops/shared-types';

export type ProviderIdentityConnection = Readonly<{
  provider: 'lingxing' | 'amazon_ads';
  accountLabel?: string;
  externalAccountId?: string;
}>;

export type ProviderActiveIdentityDomObservation = Readonly<{
  probeId: string;
  value: unknown;
}>;

type ProviderActiveIdentityDomProbe = Readonly<{
  id: string;
  selector: string;
  attribute: string;
  providers: readonly ProviderIdentityConnection['provider'][];
}>;

export const PROVIDER_ACTIVE_IDENTITY_DOM_PROBES = [
  {
    id: 'current-account-id',
    selector: '[data-current-account-id]',
    attribute: 'data-current-account-id',
    providers: ['lingxing', 'amazon_ads'],
  },
  {
    id: 'current-account-label',
    selector: '[data-current-account-label]',
    attribute: 'data-current-account-label',
    providers: ['lingxing', 'amazon_ads'],
  },
  {
    id: 'active-account-id',
    selector: '[data-active-account-id]',
    attribute: 'data-active-account-id',
    providers: ['lingxing', 'amazon_ads'],
  },
  {
    id: 'active-account-label',
    selector: '[data-active-account-label]',
    attribute: 'data-active-account-label',
    providers: ['lingxing', 'amazon_ads'],
  },
  {
    id: 'current-seller-id',
    selector: '[data-current-seller-id]',
    attribute: 'data-current-seller-id',
    providers: ['lingxing'],
  },
  {
    id: 'active-seller-id',
    selector: '[data-active-seller-id]',
    attribute: 'data-active-seller-id',
    providers: ['lingxing'],
  },
  {
    id: 'current-store-id',
    selector: '[data-current-store-id]',
    attribute: 'data-current-store-id',
    providers: ['lingxing'],
  },
  {
    id: 'active-store-id',
    selector: '[data-active-store-id]',
    attribute: 'data-active-store-id',
    providers: ['lingxing'],
  },
  {
    id: 'current-store-name',
    selector: '[data-current-store-name]',
    attribute: 'data-current-store-name',
    providers: ['lingxing'],
  },
  {
    id: 'active-store-name',
    selector: '[data-active-store-name]',
    attribute: 'data-active-store-name',
    providers: ['lingxing'],
  },
  {
    id: 'current-profile-id',
    selector: '[data-current-profile-id]',
    attribute: 'data-current-profile-id',
    providers: ['amazon_ads'],
  },
  {
    id: 'active-profile-id',
    selector: '[data-active-profile-id]',
    attribute: 'data-active-profile-id',
    providers: ['amazon_ads'],
  },
  {
    id: 'aria-current-account-id',
    selector: '[aria-current="true"][data-account-id], [aria-current="page"][data-account-id]',
    attribute: 'data-account-id',
    providers: ['lingxing', 'amazon_ads'],
  },
  {
    id: 'aria-current-account-label',
    selector: '[aria-current="true"][data-account-label], [aria-current="page"][data-account-label]',
    attribute: 'data-account-label',
    providers: ['lingxing', 'amazon_ads'],
  },
  {
    id: 'data-active-account-id',
    selector: '[data-active="true"][data-account-id]',
    attribute: 'data-account-id',
    providers: ['lingxing', 'amazon_ads'],
  },
  {
    id: 'data-active-account-label',
    selector: '[data-active="true"][data-account-label]',
    attribute: 'data-account-label',
    providers: ['lingxing', 'amazon_ads'],
  },
] as const satisfies readonly ProviderActiveIdentityDomProbe[];

export type ProviderCredentialSubmission = Readonly<{
  credentialSource: 'saved' | 'typed';
  credentialsSubmitted: boolean;
  username: string;
}>;

export type AssertProviderActiveIdentityInput = Readonly<{
  connection: ProviderIdentityConnection;
  pageUrl: string;
  domObservations: readonly ProviderActiveIdentityDomObservation[];
  credentialSubmission?: ProviderCredentialSubmission;
}>;

function normalizeIdentity(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
}

const MAX_IDENTITY_VALUE_LENGTH = 256;
const MAX_DOM_OBSERVATIONS = PROVIDER_ACTIVE_IDENTITY_DOM_PROBES.length * 2;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const URL_IDENTITY_POLICIES = {
  lingxing: {
    origin: 'https://erp.lingxing.com',
    queryParameters: ['seller_id', 'store_id'],
  },
  amazon_ads: {
    origin: 'https://ads.lingxing.com',
    queryParameters: ['profile_id'],
  },
} as const satisfies Record<
  ProviderIdentityConnection['provider'],
  { origin: string; queryParameters: readonly string[] }
>;

function boundedNormalizedIdentity(value: unknown): string | null {
  if (
    typeof value !== 'string'
    || value.length > MAX_IDENTITY_VALUE_LENGTH
    || CONTROL_CHARACTERS.test(value)
  ) {
    return null;
  }
  const normalized = normalizeIdentity(value);
  return normalized && normalized.length <= MAX_IDENTITY_VALUE_LENGTH
    ? normalized
    : null;
}

function readUrlIdentityCandidates(
  provider: ProviderIdentityConnection['provider'],
  pageUrl: string,
): string[] | null {
  try {
    const url = new URL(pageUrl);
    const policy = URL_IDENTITY_POLICIES[provider];
    if (
      url.origin !== policy.origin
      || url.username
      || url.password
    ) {
      return null;
    }
    const candidates: string[] = [];
    for (const parameter of policy.queryParameters) {
      const values = url.searchParams.getAll(parameter);
      if (values.length > 1) return null;
      if (values.length === 1) candidates.push(values[0]);
    }
    return candidates;
  } catch {
    return null;
  }
}

const LINGXING_STABLE_ID_PROBES = new Set([
  'current-seller-id',
  'active-seller-id',
  'current-store-id',
  'active-store-id',
]);

const LINGXING_STORE_NAME_PROBES = new Set([
  'current-store-name',
  'active-store-name',
]);

const LINGXING_ACCOUNT_LABEL_PROBES = new Set([
  'current-account-label',
  'active-account-label',
  'aria-current-account-label',
  'data-active-account-label',
]);

const AMAZON_ADS_PROFILE_ID_PROBES = new Set([
  'current-profile-id',
  'active-profile-id',
]);

const AMAZON_ADS_ACCOUNT_LABEL_PROBES = new Set([
  'current-account-label',
  'active-account-label',
  'aria-current-account-label',
  'data-active-account-label',
]);

function normalizeAmazonAdsProfileIdentity(value: unknown): string | null {
  try {
    return normalizeProviderExternalAccountId('amazon_ads', value) ?? null;
  } catch {
    return null;
  }
}

export function readAmazonAdsProfileIdentityEvidence(input: Readonly<{
  pageUrl: string;
  domObservations: readonly ProviderActiveIdentityDomObservation[];
}>): { externalAccountId: string; accountLabel?: string } {
  const urlCandidates = readUrlIdentityCandidates('amazon_ads', input.pageUrl);
  if (urlCandidates === null || input.domObservations.length > MAX_DOM_OBSERVATIONS) {
    throw new Error('Amazon Ads 广告账户只能从 ads.lingxing.com 受信页面自动识别。');
  }
  const rawCandidates: unknown[] = [
    ...urlCandidates,
    ...input.domObservations
      .filter((observation) => AMAZON_ADS_PROFILE_ID_PROBES.has(observation.probeId))
      .map((observation) => observation.value),
  ];
  const candidates = rawCandidates.map(normalizeAmazonAdsProfileIdentity);
  if (candidates.some((candidate) => candidate === null)) {
    throw new Error('Amazon Ads 页面包含无效的广告账户身份，自动识别已停止。');
  }
  const unique = [...new Set(candidates as string[])];
  if (unique.length === 0) {
    throw new Error('无法自动识别唯一广告账户；请在可见 Ads 窗口打开一个广告活动或广告组页面后重试。');
  }
  if (unique.length !== 1) {
    throw new Error('Amazon Ads 页面存在冲突的广告账户身份，自动识别已停止。');
  }
  const labels = input.domObservations
    .filter((observation) => AMAZON_ADS_ACCOUNT_LABEL_PROBES.has(observation.probeId))
    .map((observation) => boundedNormalizedIdentity(observation.value));
  if (labels.some((label) => label === null)) {
    throw new Error('Amazon Ads 页面包含无效的广告账户名称，自动识别已停止。');
  }
  const uniqueLabels = [...new Set(labels as string[])];
  if (uniqueLabels.length > 1) {
    throw new Error('Amazon Ads 页面存在冲突的广告账户名称，自动识别已停止。');
  }
  return {
    externalAccountId: unique[0],
    ...(uniqueLabels[0] ? { accountLabel: uniqueLabels[0] } : {}),
  };
}

export function readLingxingStableExternalAccountIdEvidence(input: Readonly<{
  pageUrl: string;
  domObservations: readonly ProviderActiveIdentityDomObservation[];
}>): string {
  let url: URL;
  try {
    url = new URL(input.pageUrl);
  } catch {
    throw new Error('领星稳定店铺身份无法从受信页面唯一读取，登录已阻断。');
  }
  if (url.origin !== URL_IDENTITY_POLICIES.lingxing.origin
    || url.username
    || url.password
    || input.domObservations.length > MAX_DOM_OBSERVATIONS) {
    throw new Error('领星稳定店铺身份无法从受信页面唯一读取，登录已阻断。');
  }
  const candidates: unknown[] = [];
  for (const parameter of ['seller_id', 'store_id'] as const) {
    const values = url.searchParams.getAll(parameter);
    if (values.length > 1) {
      throw new Error('领星页面存在冲突的稳定店铺身份，登录已阻断。');
    }
    if (values.length === 1) candidates.push(values[0]);
  }
  for (const observation of input.domObservations) {
    if (LINGXING_STABLE_ID_PROBES.has(observation.probeId)) {
      candidates.push(observation.value);
    }
  }
  let normalized: string[];
  try {
    normalized = candidates.map((candidate) => {
      const value = normalizeProviderExternalAccountId('lingxing', candidate);
      if (!value) throw new Error('empty Lingxing stable identity');
      return value;
    });
  } catch {
    throw new Error('领星稳定店铺身份包含无效证据，登录已阻断。');
  }
  const unique = [...new Set(normalized)];
  if (unique.length === 0) {
    throw new Error('领星稳定店铺身份无法从受信页面唯一读取，登录已阻断。');
  }
  if (unique.length !== 1) {
    throw new Error('领星页面存在冲突的稳定店铺身份，登录已阻断。');
  }
  return unique[0];
}

export function requireLingxingTypedStableIdentityEnrollment(input: Readonly<{
  accountLabel: string;
  collectionStoreName: string;
  credentialSubmission: ProviderCredentialSubmission | undefined;
  pageUrl: string;
  domObservations: readonly ProviderActiveIdentityDomObservation[];
}>): string {
  const submission = input.credentialSubmission;
  const expectedUsername = boundedNormalizedIdentity(input.accountLabel);
  const submittedUsername = submission
    ? boundedNormalizedIdentity(submission.username)
    : null;
  if (!submission
    || submission.credentialSource !== 'typed'
    || !submission.credentialsSubmitted
    || !expectedUsername
    || submittedUsername !== expectedUsername) {
    throw new Error('领星稳定身份首次绑定必须使用与连接账号一致的本次手动登录凭证。');
  }
  assertLingxingCollectionStoreNameEvidence({
    expectedCollectionStoreName: input.collectionStoreName,
    domObservations: input.domObservations,
  });
  return readLingxingStableExternalAccountIdEvidence(input);
}

export function assertLingxingCollectionStoreNameEvidence(input: Readonly<{
  expectedCollectionStoreName: string;
  domObservations: readonly ProviderActiveIdentityDomObservation[];
}>): void {
  let expected: string | undefined;
  let candidates: string[];
  try {
    expected = normalizeLingxingCollectionStoreName(input.expectedCollectionStoreName);
    candidates = input.domObservations
      .filter((observation) => LINGXING_STORE_NAME_PROBES.has(observation.probeId))
      .map((observation) => {
        const value = normalizeLingxingCollectionStoreName(observation.value);
        if (!value) throw new Error('empty Lingxing collection store name');
        return value;
      });
  } catch {
    throw new Error('领星当前可见店铺名称证据无效，稳定身份绑定已阻断。');
  }
  if (!expected || candidates.length === 0) {
    throw new Error('无法从可信页面唯一读取领星当前店铺名称，稳定身份绑定已阻断。');
  }
  const unique = [...new Set(candidates)];
  if (unique.length !== 1 || unique[0] !== expected) {
    throw new Error('领星当前可见店铺名称与配置的下载中心店铺名称不一致，稳定身份绑定已阻断。');
  }
}

export function assertProviderActiveIdentity(
  input: AssertProviderActiveIdentityInput,
): void {
  if (input.connection.provider === 'lingxing') {
    assertLingxingActiveIdentity(input);
    return;
  }
  assertAmazonAdsActiveIdentity(input);
}

function assertAmazonAdsActiveIdentity(input: AssertProviderActiveIdentityInput): void {
  const fail = (): never => {
    throw new Error('amazon_ads 当前账户身份与当前店铺连接不匹配，浏览器会话已拒绝。');
  };
  if (input.domObservations.length > MAX_DOM_OBSERVATIONS) fail();
  const expectedProfileId = normalizeAmazonAdsProfileIdentity(input.connection.externalAccountId);
  if (!expectedProfileId) fail();
  const urlCandidates = readUrlIdentityCandidates('amazon_ads', input.pageUrl);
  if (urlCandidates === null) {
    throw new Error('amazon_ads 当前账户身份与当前店铺连接不匹配，浏览器会话已拒绝。');
  }
  const stableProfileEvidence = [
    ...urlCandidates,
    ...input.domObservations
      .filter((observation) => AMAZON_ADS_PROFILE_ID_PROBES.has(observation.probeId))
      .map((observation) => observation.value),
  ].map(normalizeAmazonAdsProfileIdentity);
  if (
    stableProfileEvidence.length === 0
    || stableProfileEvidence.some((candidate) => candidate !== expectedProfileId)
  ) {
    fail();
  }

  const labelEvidence = input.domObservations
    .filter((observation) => AMAZON_ADS_ACCOUNT_LABEL_PROBES.has(observation.probeId))
    .map((observation) => boundedNormalizedIdentity(observation.value));
  if (labelEvidence.some((candidate) => candidate === null)) fail();
  if (labelEvidence.length > 0 && input.connection.accountLabel) {
    const expectedLabel = boundedNormalizedIdentity(input.connection.accountLabel);
    if (!expectedLabel || labelEvidence.some((candidate) => candidate !== expectedLabel)) fail();
  }
}

function assertLingxingActiveIdentity(input: AssertProviderActiveIdentityInput): void {
  if (input.domObservations.length > MAX_DOM_OBSERVATIONS
    || readUrlIdentityCandidates('lingxing', input.pageUrl) === null) {
    throw new Error('lingxing 当前账户身份与当前店铺连接不匹配，浏览器会话已拒绝。');
  }
  const expectedStableId = normalizeProviderExternalAccountId(
    'lingxing',
    input.connection.externalAccountId,
  );
  if (expectedStableId) {
    const observedStableId = readLingxingStableExternalAccountIdEvidence(input);
    if (observedStableId !== expectedStableId) {
      throw new Error('lingxing 当前稳定店铺身份与当前店铺连接不匹配，浏览器会话已拒绝。');
    }
  }

  const expectedAccountLabel = input.connection.accountLabel
    ? boundedNormalizedIdentity(input.connection.accountLabel)
    : null;
  const observedAccountLabels = input.domObservations
    .filter((observation) => LINGXING_ACCOUNT_LABEL_PROBES.has(observation.probeId))
    .map((observation) => boundedNormalizedIdentity(observation.value));
  if (observedAccountLabels.some((value) => value === null)
    || (observedAccountLabels.length > 0
      && (!expectedAccountLabel
        || observedAccountLabels.some((value) => value !== expectedAccountLabel)))) {
    throw new Error('lingxing 当前登录账号与当前店铺连接不匹配，浏览器会话已拒绝。');
  }

  const submission = input.credentialSubmission;
  let typedAccountVerified = false;
  if (submission !== undefined) {
    const submittedUsername = boundedNormalizedIdentity(submission.username);
    if (submission.credentialSource !== 'typed'
      || !submission.credentialsSubmitted
      || !expectedAccountLabel
      || submittedUsername !== expectedAccountLabel) {
      throw new Error('lingxing 本次提交账号与当前店铺连接不匹配，浏览器会话已拒绝。');
    }
    typedAccountVerified = true;
  }
  if (!expectedStableId && observedAccountLabels.length === 0 && !typedAccountVerified) {
    throw new Error('lingxing 当前账户身份与当前店铺连接不匹配，浏览器会话已拒绝。');
  }
}
