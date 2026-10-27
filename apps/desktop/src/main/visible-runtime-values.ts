import path from 'node:path';
import {
  normalizeProviderExternalAccountId,
  normalizeStoreContextEnvelope,
  type StoreConnection,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type VisibleBrowserRuntimeCandidate,
  VisibleBrowserRuntimeRegistryError,
  type VisibleBrowserRuntime,
  type VisibleBrowserRuntimeControllers,
  type VisibleBrowserControllerLike,
  StoreMutationLaneError,
} from "./visible-runtime-contracts";

export function assertCandidate(input: VisibleBrowserRuntimeCandidate): void {
  const lingxingProfileDir = normalizedProfileDir(input?.profileDirs?.lingxing);
  const amazonAdsProfileDir = normalizedProfileDir(input?.profileDirs?.amazonAds);
  if (!input
    || (input.purpose !== 'operator_full' && input.purpose !== 'collection_only')
    || !input.controllers
    || !controllerLike(input.controllers.lingxing)
    || (input.controllers.amazonAds !== undefined && !controllerLike(input.controllers.amazonAds))
    || (input.purpose === 'collection_only' && (
      input.controllers.amazonAds !== undefined
      || input.profileDirs?.amazonAds !== undefined
      || input.connections?.amazonAds !== undefined
      || input.amazonAdsIdentityStatus !== undefined
    ))) {
    throw new VisibleBrowserRuntimeRegistryError(
      'INVALID_RUNTIME',
      'visible runtime candidate has an invalid purpose or controller set',
    );
  }
  if (input.purpose === 'operator_full' && (
    !controllerLike(input.controllers.amazonAds)
    || input.controllers.lingxing === input.controllers.amazonAds
    || !lingxingProfileDir
    || !amazonAdsProfileDir
    || lingxingProfileDir === amazonAdsProfileDir
    || !input.connections?.lingxing
    || !input.connections.amazonAds
  )) {
    throw new VisibleBrowserRuntimeRegistryError(
      'INVALID_RUNTIME',
      'operator_full runtime requires distinct Lingxing/Amazon Ads controllers, profiles, and connections',
    );
  }
  if (input.profileDirs?.lingxing !== undefined && !lingxingProfileDir) {
    throw new VisibleBrowserRuntimeRegistryError(
      'INVALID_RUNTIME',
      'visible runtime Lingxing profile directory must be non-empty',
    );
  }
  if (input.amazonAdsIdentityStatus !== undefined
    && !['unknown', 'pending', 'blocked'].includes(input.amazonAdsIdentityStatus)) {
    throw new VisibleBrowserRuntimeRegistryError(
      'INVALID_RUNTIME',
      'initial Amazon Ads identity status is invalid',
    );
  }
  if (input.attempt) {
    if ((input.attempt.kind !== 'manual' && input.attempt.kind !== 'automation')
      || !safeIdentity(input.attempt.attemptId)
      || !Number.isSafeInteger(input.attempt.attemptEpoch)
      || input.attempt.attemptEpoch < 0) {
      throw new VisibleBrowserRuntimeRegistryError(
        'INVALID_RUNTIME',
        'visible runtime attempt identity is invalid',
      );
    }
  }
  if (input.connections) {
    if (input.connections.lingxing.provider !== 'lingxing'
      || input.connections.lingxing.storeId !== input.context.storeId
      || (input.connections.amazonAds !== undefined
        && (input.connections.amazonAds.provider !== 'amazon_ads'
          || input.connections.amazonAds.storeId !== input.context.storeId))) {
      throw new VisibleBrowserRuntimeRegistryError(
        'INVALID_RUNTIME',
        'visible runtime provider connections do not match the exact store',
      );
    }
  }
}

export function assertConfirmedAmazonAdsConnection(
  runtime: VisibleBrowserRuntime,
  replacement?: StoreConnection,
): StoreConnection {
  const current = runtime.connections?.amazonAds;
  const connection = replacement ?? current;
  let normalizedExternalAccountId: string | undefined;
  try {
    normalizedExternalAccountId = normalizeProviderExternalAccountId(
      'amazon_ads',
      connection?.externalAccountId,
    );
  } catch {
    normalizedExternalAccountId = undefined;
  }
  if (!current
    || !connection
    || connection.id !== current.id
    || connection.provider !== 'amazon_ads'
    || connection.storeId !== runtime.context.storeId
    || connection.status !== 'ready'
    || !normalizedExternalAccountId
    || (replacement !== undefined
      && connection.normalizedExternalAccountId !== normalizedExternalAccountId)) {
    throw new VisibleBrowserRuntimeRegistryError(
      'INVALID_RUNTIME',
      'confirmed Amazon Ads connection must be ready and match the exact runtime store and pending capability',
    );
  }
  return connection;
}

export function normalizedProfileDir(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = path.win32.normalize(value.trim())
    .replace(/[\\/]+$/u, '')
    .toLocaleLowerCase('en-US');
  return normalized || null;
}

export function freezeRuntime(input: VisibleBrowserRuntime): VisibleBrowserRuntime {
  const context = Object.freeze(normalizeStoreContextEnvelope(input.context));
  return Object.freeze({
    ...input,
    context,
    providerIdentityStatus: Object.freeze({ ...input.providerIdentityStatus }),
    controllers: Object.freeze({ ...input.controllers }),
    ...(input.profileDirs ? { profileDirs: Object.freeze({ ...input.profileDirs }) } : {}),
    ...(input.connections ? {
      connections: Object.freeze({
        lingxing: cloneConnection(input.connections.lingxing),
        ...(input.connections.amazonAds
          ? { amazonAds: cloneConnection(input.connections.amazonAds) }
          : {}),
      }),
    } : {}),
    ...(input.attempt ? { attempt: Object.freeze({ ...input.attempt }) } : {}),
  });
}

export function cloneConnection(connection: StoreConnection): StoreConnection {
  return Object.freeze({
    ...connection,
    ...(connection.session
      ? { session: Object.freeze({ ...connection.session }) }
      : {}),
  });
}

export function uniqueControllers(
  controllers: VisibleBrowserRuntimeControllers,
): VisibleBrowserControllerLike[] {
  return [...new Set([
    controllers.lingxing,
    ...(controllers.amazonAds ? [controllers.amazonAds] : []),
  ])];
}

export function controllerLike(value: unknown): value is VisibleBrowserControllerLike {
  return Boolean(value)
    && typeof (value as VisibleBrowserControllerLike).close === 'function'
    && typeof (value as VisibleBrowserControllerLike).getPage === 'function'
    && typeof (value as VisibleBrowserControllerLike).getContext === 'function';
}

export function assertUsContext(context: StoreContextEnvelope): void {
  if (context.marketplace !== 'US'
    || context.currency !== 'USD'
    || context.businessTimezone !== 'America/Los_Angeles') {
    throw new VisibleBrowserRuntimeRegistryError(
      'INVALID_RUNTIME',
      'visible runtime supports exact US/USD/America/Los_Angeles context only',
    );
  }
}

export function sameStoreProfileGeneration(
  left: StoreContextEnvelope,
  rightInput: StoreContextEnvelope,
): boolean {
  const right = normalizeStoreContextEnvelope(rightInput);
  return left.storeId === right.storeId
    && left.browserProfileId === right.browserProfileId
    && left.sessionGeneration === right.sessionGeneration;
}

export function sameVisibleRuntimeContext(
  left: StoreContextEnvelope,
  right: StoreContextEnvelope,
): boolean {
  return sameContext(left, right);
}

export function sameContext(
  leftInput: StoreContextEnvelope,
  rightInput: StoreContextEnvelope,
): boolean {
  const left = normalizeStoreContextEnvelope(leftInput);
  const right = normalizeStoreContextEnvelope(rightInput);
  return left.storeId === right.storeId
    && left.browserProfileId === right.browserProfileId
    && left.marketplace === right.marketplace
    && left.currency === right.currency
    && left.businessTimezone === right.businessTimezone
    && left.businessDate === right.businessDate
    && left.sessionGeneration === right.sessionGeneration;
}

export function nextEpoch(value: number): number {
  const next = value + 1;
  if (!Number.isSafeInteger(next)) {
    throw new VisibleBrowserRuntimeRegistryError(
      'INVALID_RUNTIME',
      'visible runtime epoch is exhausted',
    );
  }
  return next;
}

export function safeIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(value);
}

export function normalizeOwner(value: unknown): string {
  if (!safeIdentity(value)) {
    throw new StoreMutationLaneError(
      'INVALID_AUTHORITY',
      'mutation lane owner must use 1-160 safe identity characters',
    );
  }
  return value;
}

export function runtimeObject(value: unknown): value is Readonly<object> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}
