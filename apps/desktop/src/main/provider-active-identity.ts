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
    queryParameters: ['account_id', 'seller_id', 'store_id'],
  },
  amazon_ads: {
    origin: 'https://ads.lingxing.com',
    queryParameters: ['profile_id'],
  },
} as const satisfies Record<
  ProviderIdentityConnection['provider'],
  { origin: string; queryParameters: readonly string[] }
>;

const DOM_PROBE_BY_ID: ReadonlyMap<string, ProviderActiveIdentityDomProbe> = new Map(
  PROVIDER_ACTIVE_IDENTITY_DOM_PROBES.map((probe) => [
    probe.id,
    probe as ProviderActiveIdentityDomProbe,
  ]),
);

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

export function assertProviderActiveIdentity(
  input: AssertProviderActiveIdentityInput,
): void {
  const expected = [input.connection.externalAccountId, input.connection.accountLabel]
    .map(boundedNormalizedIdentity)
    .filter((value): value is string => Boolean(value));
  const urlCandidates = readUrlIdentityCandidates(input.connection.provider, input.pageUrl);
  if (!urlCandidates) {
    throw new Error(`${input.connection.provider} 当前账户身份与当前店铺连接不匹配，浏览器会话已拒绝。`);
  }
  if (input.domObservations.length > MAX_DOM_OBSERVATIONS) {
    throw new Error(`${input.connection.provider} 当前账户身份与当前店铺连接不匹配，浏览器会话已拒绝。`);
  }
  const domCandidates = input.domObservations
    .flatMap((observation) => {
      const probe = DOM_PROBE_BY_ID.get(observation.probeId);
      if (!probe || !probe.providers.includes(input.connection.provider)) return [];
      return [observation.value];
    });
  const submittedUsername = input.connection.provider === 'lingxing'
    && input.credentialSubmission?.credentialSource === 'typed'
    && input.credentialSubmission.credentialsSubmitted
    ? [input.credentialSubmission.username]
    : [];
  const normalizedCandidates = [...urlCandidates, ...domCandidates, ...submittedUsername]
    .map(boundedNormalizedIdentity);
  if (normalizedCandidates.some((value) => value === null)) {
    throw new Error(`${input.connection.provider} 当前账户身份与当前店铺连接不匹配，浏览器会话已拒绝。`);
  }
  const candidates = normalizedCandidates as string[];
  const expectedSet = new Set(expected);
  if (
    candidates.length > 0
    && candidates.every((candidate) => expectedSet.has(candidate))
  ) return;

  throw new Error(`${input.connection.provider} 当前账户身份与当前店铺连接不匹配，浏览器会话已拒绝。`);
}
