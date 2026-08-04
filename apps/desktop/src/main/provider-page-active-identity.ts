import type { StoreConnection } from '@amazon-ai-ops/shared-types';
import { normalizeProviderExternalAccountId } from '@amazon-ai-ops/shared-types';
import {
  assertProviderActiveIdentity,
  PROVIDER_ACTIVE_IDENTITY_DOM_PROBES,
  type ProviderActiveIdentityDomObservation,
  type ProviderCredentialSubmission,
} from './provider-active-identity';
import { getLingxingSessionNavigationPlan } from './lingxing-session-flow';

export type ProviderPageIdentityStatus =
  | 'ready'
  | 'login_required'
  | 'mfa_required'
  | 'identity_unverified';

export interface ProviderIdentityPageLike {
  url(): string;
  title(): Promise<string>;
  evaluate<Result, Argument>(
    pageFunction: (argument: Argument) => Result | Promise<Result>,
    argument: Argument,
  ): Promise<Result>;
}

export interface ProviderPageIdentityResult {
  status: ProviderPageIdentityStatus;
  pageUrl: string;
  title: string;
  domObservations: readonly ProviderActiveIdentityDomObservation[];
}

export interface InspectLingxingProviderPageInput {
  page: ProviderIdentityPageLike;
  connection: Pick<
    StoreConnection,
    'provider' | 'accountLabel' | 'externalAccountId'
  >;
  mode: 'collection_only' | 'operator_full';
  credentialSubmission?: ProviderCredentialSubmission;
}

type PageObservationPayload = {
  bodyText: unknown;
  hasLoginInput: unknown;
  hasPasswordInput: unknown;
  hasMfaInput: unknown;
  domObservations: unknown;
};

const MAX_TITLE_LENGTH = 512;
const MAX_BODY_TEXT_LENGTH = 8_192;
const MAX_OBSERVATIONS = PROVIDER_ACTIVE_IDENTITY_DOM_PROBES
  .filter((probe) => probe.providers.some((provider) => provider === 'lingxing'))
  .length * 2;
const MAX_IDENTITY_VALUE_LENGTH = 256;
const PAGE_OBSERVATION_TIMEOUT_MS = 5_000;

/**
 * Reads identity only from the current visible page. Stored session metadata
 * is intentionally absent from this interface and therefore cannot satisfy a
 * current-page identity decision.
 */
export async function inspectLingxingProviderPageIdentity(
  input: InspectLingxingProviderPageInput,
): Promise<ProviderPageIdentityResult> {
  if (input.connection.provider !== 'lingxing') {
    throw new TypeError('collection-only provider page identity supports Lingxing ERP only');
  }
  if (input.mode === 'collection_only' && input.credentialSubmission !== undefined) {
    throw new TypeError('collection-only identity inspection forbids credential submission');
  }
  const pageUrl = boundedPageUrl(input.page.url());
  const titleValue = await withTimeout(
    input.page.title(),
    PAGE_OBSERVATION_TIMEOUT_MS,
    'provider page title observation timed out',
  );
  if (boundedPageUrl(input.page.url()) !== pageUrl) {
    return unverified(pageUrl, '', []);
  }
  const title = boundedText(titleValue, MAX_TITLE_LENGTH, 'page title');
  const probes = PROVIDER_ACTIVE_IDENTITY_DOM_PROBES
    .filter((probe) => probe.providers.some((provider) => provider === 'lingxing'))
    .map((probe) => ({
      id: probe.id,
      selector: probe.selector,
      attribute: probe.attribute,
    }));
  const payload = await withTimeout(input.page.evaluate((activeIdentityProbes) => {
    const visible = (element: Element): boolean => {
      if (element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
      const style = window.getComputedStyle(element);
      return element.getClientRects().length > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) > 0;
    };
    return {
      bodyText: (document.body?.innerText ?? '').slice(0, 8192),
      hasLoginInput: [...document.querySelectorAll(
        'input[name="account"], input[autocomplete="username"], input[placeholder*="用户名"], input[placeholder*="手机号"]',
      )].some(visible),
      hasPasswordInput: [...document.querySelectorAll(
        'input[name="pwd"], input[type="password"], input[autocomplete="current-password"]',
      )].some(visible),
      hasMfaInput: [...document.querySelectorAll(
        'input[autocomplete="one-time-code"], input[name*="verify"], input[name*="code"], input[placeholder*="验证码"]',
      )].some(visible),
      domObservations: activeIdentityProbes.flatMap((probe) => (
        [...document.querySelectorAll(probe.selector)]
          .filter(visible)
          .slice(0, 2)
          .flatMap((element) => {
            const value = element.getAttribute(probe.attribute);
            return value === null ? [] : [{ probeId: probe.id, value }];
          })
      )),
    };
  }, probes), PAGE_OBSERVATION_TIMEOUT_MS, 'provider page DOM observation timed out');
  if (boundedPageUrl(input.page.url()) !== pageUrl) {
    return unverified(pageUrl, title, []);
  }
  const observation = normalizePayload(payload);
  const status = classifyPageState({
    pageUrl,
    title,
    ...observation,
  });
  if (status !== 'identity_unverified') {
    return Object.freeze({
      status,
      pageUrl,
      title,
      domObservations: observation.domObservations,
    });
  }
  try {
    if (!hasExactExternalAccountEvidence(
      input.connection.externalAccountId,
      pageUrl,
      observation.domObservations,
    )) {
      return unverified(pageUrl, title, observation.domObservations);
    }
    assertProviderActiveIdentity({
      connection: input.connection,
      pageUrl,
      domObservations: observation.domObservations,
      ...(input.mode === 'operator_full' && input.credentialSubmission
        ? { credentialSubmission: input.credentialSubmission }
        : {}),
    });
    return Object.freeze({
      status: 'ready',
      pageUrl,
      title,
      domObservations: observation.domObservations,
    });
  } catch {
    return Object.freeze({
      status: 'identity_unverified',
      pageUrl,
      title,
      domObservations: observation.domObservations,
    });
  }
}

const TRUSTED_EXTERNAL_ID_PROBES = new Set([
  'current-seller-id',
  'active-seller-id',
  'current-store-id',
  'active-store-id',
]);

function hasExactExternalAccountEvidence(
  externalAccountId: string | undefined,
  pageUrl: string,
  observations: readonly ProviderActiveIdentityDomObservation[],
): boolean {
  if (externalAccountId === undefined) return false;
  let expected: string | undefined;
  try {
    expected = normalizeProviderExternalAccountId('lingxing', externalAccountId);
  } catch {
    return false;
  }
  if (!expected) return false;
  const candidates: string[] = [];
  try {
    const url = new URL(pageUrl);
    if (url.origin !== new URL(getLingxingSessionNavigationPlan().initialUrl).origin) return false;
    for (const parameter of ['seller_id', 'store_id']) {
      const values = url.searchParams.getAll(parameter);
      if (values.length > 1) return false;
      if (values.length === 1) candidates.push(values[0]);
    }
  } catch {
    return false;
  }
  for (const observation of observations) {
    if (TRUSTED_EXTERNAL_ID_PROBES.has(observation.probeId)
      && typeof observation.value === 'string') {
      candidates.push(observation.value);
    }
  }
  let normalized: Array<string | undefined>;
  try {
    normalized = candidates.map((candidate) => (
      normalizeProviderExternalAccountId('lingxing', candidate)
    ));
  } catch {
    return false;
  }
  return normalized.length > 0
    && normalized.every((candidate) => Boolean(candidate) && candidate === expected);
}

function unverified(
  pageUrl: string,
  title: string,
  domObservations: readonly ProviderActiveIdentityDomObservation[],
): ProviderPageIdentityResult {
  return Object.freeze({
    status: 'identity_unverified',
    pageUrl,
    title,
    domObservations: Object.freeze([...domObservations]),
  });
}

function classifyPageState(input: {
  pageUrl: string;
  title: string;
  bodyText: string;
  hasLoginInput: boolean;
  hasPasswordInput: boolean;
  hasMfaInput: boolean;
}): Exclude<ProviderPageIdentityStatus, 'ready'> {
  const combined = `${input.title}\n${input.bodyText}`;
  if (input.hasMfaInput
    || /验证码|安全验证|二次验证|双重验证|mfa|two[- ]factor|one[- ]time code/i.test(combined)) {
    return 'mfa_required';
  }
  let url: URL;
  try {
    url = new URL(input.pageUrl);
  } catch {
    return 'identity_unverified';
  }
  const loginPath = /(?:^|\/)(?:login|restartLogin)(?:\/|$)/i.test(url.pathname);
  if (input.hasLoginInput
    || input.hasPasswordInput
    || loginPath
    || /账号登录|密码登录|微信登录|请登录/i.test(combined)) {
    return 'login_required';
  }
  return 'identity_unverified';
}

function normalizePayload(value: unknown): {
  bodyText: string;
  hasLoginInput: boolean;
  hasPasswordInput: boolean;
  hasMfaInput: boolean;
  domObservations: readonly ProviderActiveIdentityDomObservation[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('provider page observation payload is invalid');
  }
  const payload = value as PageObservationPayload;
  const bodyText = boundedText(payload.bodyText, MAX_BODY_TEXT_LENGTH, 'page body');
  if (typeof payload.hasLoginInput !== 'boolean'
    || typeof payload.hasPasswordInput !== 'boolean'
    || typeof payload.hasMfaInput !== 'boolean'
    || !Array.isArray(payload.domObservations)
    || payload.domObservations.length > MAX_OBSERVATIONS) {
    throw new TypeError('provider page observation payload exceeded its bounded contract');
  }
  const observations = payload.domObservations.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new TypeError('provider page DOM observation is invalid');
    }
    const record = candidate as Record<string, unknown>;
    if (typeof record.probeId !== 'string'
      || record.probeId.length > 80
      || typeof record.value !== 'string'
      || record.value.length > MAX_IDENTITY_VALUE_LENGTH
      || /[\u0000-\u001f\u007f]/.test(record.value)) {
      throw new TypeError('provider page DOM observation exceeded its bounded contract');
    }
    return Object.freeze({
      probeId: record.probeId,
      value: record.value,
    });
  });
  return {
    bodyText,
    hasLoginInput: payload.hasLoginInput,
    hasPasswordInput: payload.hasPasswordInput,
    hasMfaInput: payload.hasMfaInput,
    domObservations: Object.freeze(observations),
  };
}

function boundedPageUrl(value: unknown): string {
  const pageUrl = boundedText(value, 2_048, 'page URL');
  const navigation = getLingxingSessionNavigationPlan();
  const allowedOrigin = new URL(navigation.initialUrl).origin;
  try {
    const url = new URL(pageUrl);
    if (url.origin !== allowedOrigin || url.username || url.password) {
      return 'about:identity-unverified';
    }
    return url.toString();
  } catch {
    return 'about:identity-unverified';
  }
}

function boundedText(value: unknown, maxLength: number, label: string): string {
  if (typeof value !== 'string'
    || value.length > maxLength
    || value.includes('\0')) {
    throw new TypeError(`${label} exceeded its bounded contract`);
  }
  return value;
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
