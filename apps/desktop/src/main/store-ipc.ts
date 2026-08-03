import type {
  ArchiveStoreInput,
  CreateStoreConnectionInput,
  CreateStoreInput,
  ListStoresInput,
  RestoreStoreInput,
  RemoveStoreConnectionInput,
  StoreContextEnvelope,
  StoreRecord,
  StoreWorkspaceView,
  UpdateStoreConnectionInput,
  UpdateStoreInput,
} from '@amazon-ai-ops/shared-types';
import {
  DEFAULT_US_BUSINESS_TIMEZONE,
  normalizeBusinessTimezone,
  normalizeStoreCapabilityId,
  normalizeStoreId,
  normalizeUsdCurrency,
  normalizeUsMarketplace,
} from '@amazon-ai-ops/shared-types';
import { StoreRepositoryError } from '@amazon-ai-ops/local-db';
import { StoreCoordinatorError, type StoreCoordinator } from './store-coordinator';

export const STORE_IPC_CHANNELS = [
  'stores:list',
  'stores:get',
  'stores:create',
  'stores:update',
  'stores:archive',
  'stores:restore',
  'stores:connections:create',
  'stores:connections:update',
  'stores:connections:remove',
  'stores:switch',
  'stores:reconnect',
  'stores:get-active-context',
  'stores:get-active-workspace-view',
] as const;

export interface IpcHandlerRegistrar {
  handle(channel: string, listener: (event: unknown, input?: unknown) => unknown): void;
}

export interface StoreIpcMutationScope {
  operation: string;
  targetStoreId?: string;
}

type MaybePromise<Value> = Value | Promise<Value>;

const EXPECTED_STORE_MUTATION_REJECTION = Symbol('expected-store-mutation-rejection');

type ExpectedStoreMutationError = StoreCoordinatorError | StoreRepositoryError;

type ExpectedStoreMutationRejection = Readonly<{
  token: typeof EXPECTED_STORE_MUTATION_REJECTION;
  error: ExpectedStoreMutationError;
}>;

interface StoreMutationPhases<Result> {
  /** Read-only business validation that is proven to happen before authority writes. */
  preflight?(activeContext: StoreContextEnvelope | null): void;
  before?(activeContext: StoreContextEnvelope | null): MaybePromise<void>;
  /** Only direct, synchronous coordinator mutations are eligible for safe rejection. */
  mutate(): Result;
  after?(result: Result, activeContext: StoreContextEnvelope | null): MaybePromise<void>;
}

export interface StoreIpcEvents {
  /**
   * Main must claim the shared user/automation mutation lane synchronously
   * before invoking `work`, then keep it until the returned promise settles.
   */
  withUserStoreMutation?<Result>(
    scope: StoreIpcMutationScope,
    work: () => MaybePromise<Result>,
  ): Promise<Result>;
  beforeActiveStoreMutation?(
    context: StoreContextEnvelope,
    operation: string,
  ): MaybePromise<void>;
  onStoreChanged?(view: StoreWorkspaceView): MaybePromise<void>;
  onStoreRecordChanged?(store: StoreRecord): MaybePromise<void>;
}

export function registerStoreIpcHandlers(
  ipc: IpcHandlerRegistrar,
  coordinator: StoreCoordinator,
  events: StoreIpcEvents = {},
): void {
  ipc.handle('stores:list', (_event, input) =>
    coordinator.listStores(asOptionalObject(input) as ListStoresInput | undefined));
  ipc.handle('stores:get', (_event, input) => coordinator.getStore(readStoreId(input)));
  ipc.handle('stores:create', (_event, input) => {
    const request = readCreateStoreInput(input);
    return runStoreMutation(coordinator, events, {
      operation: 'stores:create',
    }, {
      mutate: () => coordinator.createStore(request),
      after: async (store) => {
        await events.onStoreRecordChanged?.(store);
      },
    });
  });
  ipc.handle('stores:update', (_event, input) => {
    const request = readUpdateStoreInput(input);
    return runStoreMutation(coordinator, events, {
      operation: 'stores:update',
      targetStoreId: optionalStoreId(request.storeId),
    }, {
      before: (activeContext) => guardActiveStoreMutation(
        activeContext,
        events,
        request.storeId,
        'stores:update',
      ),
      mutate: () => coordinator.updateStore(request),
      after: async (store) => {
        await events.onStoreRecordChanged?.(store);
        const activeView = coordinator.getActiveStoreWorkspaceView();
        if (activeView?.store.storeId === store.storeId) {
          await events.onStoreChanged?.(activeView);
        }
      },
    });
  });
  ipc.handle('stores:archive', (_event, input) => {
    const request = readArchiveStoreInput(input);
    return runStoreMutation(coordinator, events, {
      operation: 'stores:archive',
      targetStoreId: optionalStoreId(request.storeId),
    }, {
      before: (activeContext) => guardActiveStoreMutation(
        activeContext,
        events,
        request.storeId,
        'stores:archive',
      ),
      mutate: () => coordinator.archiveStore(request),
      after: async (store) => {
        await events.onStoreRecordChanged?.(store);
      },
    });
  });
  ipc.handle('stores:restore', (_event, input) => {
    const request = readRestoreStoreInput(input);
    return runStoreMutation(coordinator, events, {
      operation: 'stores:restore',
      targetStoreId: optionalStoreId(request.storeId),
    }, {
      mutate: () => coordinator.restoreStore(request),
      after: async (store) => {
        await events.onStoreRecordChanged?.(store);
      },
    });
  });
  ipc.handle('stores:connections:create', (_event, input) => {
    const request = readCreateConnectionInput(input);
    return runStoreMutation(coordinator, events, {
      operation: 'stores:connections:create',
      targetStoreId: optionalStoreId(request.storeId),
    }, {
      before: (activeContext) => guardActiveStoreMutation(
        activeContext,
        events,
        request.storeId,
        'stores:connections:create',
      ),
      mutate: () => coordinator.createConnection(request),
      after: async (connection) => {
        const activeView = coordinator.getActiveStoreWorkspaceView();
        if (activeView?.store.storeId === connection.storeId) {
          await events.onStoreChanged?.(activeView);
        }
      },
    });
  });
  ipc.handle('stores:connections:update', (_event, input) => {
    const request = readUpdateConnectionInput(input);
    return runStoreMutation(coordinator, events, {
      operation: 'stores:connections:update',
      targetStoreId: optionalStoreId(request.storeId),
    }, {
      before: (activeContext) => guardActiveStoreMutation(
        activeContext,
        events,
        request.storeId,
        'stores:connections:update',
      ),
      mutate: () => coordinator.updateConnection(request),
      after: async (connection) => {
        const activeView = coordinator.getActiveStoreWorkspaceView();
        if (activeView?.store.storeId === connection.storeId) {
          await events.onStoreChanged?.(activeView);
        }
      },
    });
  });
  ipc.handle('stores:connections:remove', (_event, input) => {
    const request = readRemoveConnectionInput(input);
    return runStoreMutation(coordinator, events, {
      operation: 'stores:connections:remove',
      targetStoreId: optionalStoreId(request.storeId),
    }, {
      before: (activeContext) => guardActiveStoreMutation(
        activeContext,
        events,
        request.storeId,
        'stores:connections:remove',
      ),
      mutate: () => {
        coordinator.removeConnection(request);
        return { success: true };
      },
      after: async () => {
        const activeView = coordinator.getActiveStoreWorkspaceView();
        if (activeView?.store.storeId === request.storeId) {
          await events.onStoreChanged?.(activeView);
        }
      },
    });
  });
  ipc.handle('stores:switch', (_event, input) => {
    const storeId = readStoreId(input);
    return runStoreMutation(coordinator, events, {
      operation: 'stores:switch',
      targetStoreId: optionalStoreId(storeId),
    }, {
      preflight: () => preflightStoreTransition(coordinator, storeId, 'stores:switch'),
      before: (activeContext) => guardCurrentActiveStoreMutation(
        activeContext,
        events,
        'stores:switch',
      ),
      mutate: () => coordinator.switchStore(storeId),
      after: async (view) => {
        await events.onStoreChanged?.(view);
      },
    });
  });
  ipc.handle('stores:reconnect', (_event, input) => {
    const storeId = readStoreId(input);
    return runStoreMutation(coordinator, events, {
      operation: 'stores:reconnect',
      targetStoreId: optionalStoreId(storeId),
    }, {
      preflight: (activeContext) => preflightStoreTransition(
        coordinator,
        storeId,
        'stores:reconnect',
        activeContext,
      ),
      before: (activeContext) => guardCurrentActiveStoreMutation(
        activeContext,
        events,
        'stores:reconnect',
      ),
      mutate: () => coordinator.reconnectStore(storeId),
      after: async (view) => {
        await events.onStoreChanged?.(view);
      },
    });
  });
  ipc.handle('stores:get-active-context', (): StoreContextEnvelope | null =>
    coordinator.getActiveStoreContext());
  ipc.handle('stores:get-active-workspace-view', (): StoreWorkspaceView | null =>
    coordinator.getActiveStoreWorkspaceView());
}

async function runStoreMutation<Result>(
  coordinator: StoreCoordinator,
  events: StoreIpcEvents,
  input: {
    operation: string;
    targetStoreId?: string;
  },
  phases: StoreMutationPhases<Result>,
): Promise<Result> {
  const scope: StoreIpcMutationScope = {
    operation: input.operation,
    ...(input.targetStoreId ? { targetStoreId: input.targetStoreId } : {}),
  };
  // The authority snapshot must be read only after Main has claimed the
  // shared user/automation lane. Reading it before `withUserStoreMutation`
  // could authorize against a context that automation changed while this
  // mutation was waiting for the lane.
  const invoke = async (): Promise<Result | ExpectedStoreMutationRejection> => {
    const activeContext = coordinator.getActiveStoreContext();
    try {
      phases.preflight?.(activeContext);
    } catch (error) {
      if (!isExpectedStorePreflightError(input.operation, error)) throw error;
      return expectedStoreMutationRejection(error);
    }
    await phases.before?.(activeContext);

    let result: Result;
    try {
      result = phases.mutate();
    } catch (error) {
      if (!isExpectedStoreMutationError(input.operation, error)) throw error;
      return expectedStoreMutationRejection(error);
    }

    await phases.after?.(result, activeContext);
    return result;
  };
  const outcome = events.withUserStoreMutation
    ? await events.withUserStoreMutation<Result | ExpectedStoreMutationRejection>(scope, invoke)
    : await invoke();
  if (isExpectedStoreMutationRejection(outcome)) throw outcome.error;
  return outcome;
}

const SAFE_COORDINATOR_MUTATION_CODES: Readonly<Record<
string,
readonly StoreCoordinatorError['code'][]
>> = Object.freeze({
  'stores:create': ['INVALID_DISPLAY_NAME'],
  'stores:update': ['STORE_NOT_FOUND', 'INVALID_STORE_STATUS', 'EMPTY_STORE_PATCH'],
  'stores:archive': ['STORE_NOT_FOUND'],
  'stores:restore': ['STORE_NOT_FOUND'],
  'stores:connections:create': ['STORE_NOT_FOUND', 'STORE_NOT_ACTIVE'],
  'stores:connections:update': ['STORE_NOT_FOUND', 'STORE_NOT_ACTIVE'],
  'stores:connections:remove': ['STORE_NOT_FOUND', 'STORE_NOT_ACTIVE'],
});

const SAFE_REPOSITORY_MUTATION_CODES: Readonly<Record<
string,
readonly StoreRepositoryError['code'][]
>> = Object.freeze({
  'stores:create': ['INVALID_STORE_INPUT', 'STORE_ALREADY_EXISTS'],
  'stores:update': ['STORE_ARCHIVED', 'STORE_CONFLICT', 'INVALID_STORE_INPUT'],
  'stores:archive': ['STORE_CONFLICT'],
  'stores:restore': ['STORE_CONFLICT'],
  'stores:connections:create': ['STORE_CONFLICT', 'INVALID_STORE_INPUT'],
  'stores:connections:update': ['CONNECTION_NOT_FOUND', 'INVALID_STORE_INPUT'],
  'stores:connections:remove': ['CONNECTION_NOT_FOUND', 'SESSION_GENERATION_STALE'],
});

function isExpectedStoreMutationError(
  operation: string,
  error: unknown,
): error is ExpectedStoreMutationError {
  if (error instanceof StoreCoordinatorError) {
    return SAFE_COORDINATOR_MUTATION_CODES[operation]?.includes(error.code) === true;
  }
  if (error instanceof StoreRepositoryError) {
    return SAFE_REPOSITORY_MUTATION_CODES[operation]?.includes(error.code) === true;
  }
  return false;
}

function isExpectedStorePreflightError(
  operation: string,
  error: unknown,
): error is StoreCoordinatorError {
  if (!(error instanceof StoreCoordinatorError)) return false;
  if (operation === 'stores:switch') {
    return error.code === 'STORE_NOT_FOUND' || error.code === 'STORE_NOT_ACTIVE';
  }
  if (operation === 'stores:reconnect') {
    return error.code === 'STORE_NOT_FOUND'
      || error.code === 'STORE_NOT_ACTIVE'
      || error.code === 'STORE_CONTEXT_MISMATCH';
  }
  return false;
}

function expectedStoreMutationRejection(
  error: ExpectedStoreMutationError,
): ExpectedStoreMutationRejection {
  return Object.freeze({
    token: EXPECTED_STORE_MUTATION_REJECTION,
    error,
  });
}

function isExpectedStoreMutationRejection(
  value: unknown,
): value is ExpectedStoreMutationRejection {
  return Boolean(
    value
      && typeof value === 'object'
      && (value as ExpectedStoreMutationRejection).token === EXPECTED_STORE_MUTATION_REJECTION,
  );
}

async function guardCurrentActiveStoreMutation(
  context: StoreContextEnvelope | null,
  events: StoreIpcEvents,
  operation: string,
): Promise<void> {
  if (context) await events.beforeActiveStoreMutation?.(context, operation);
}

function preflightStoreTransition(
  coordinator: StoreCoordinator,
  storeId: ReturnType<typeof normalizeStoreId>,
  operation: 'stores:switch' | 'stores:reconnect',
  activeContext: StoreContextEnvelope | null = null,
): void {
  const store = coordinator.getStore(storeId);
  if (store.status !== 'active') {
    throw new StoreCoordinatorError('STORE_NOT_ACTIVE', `store ${storeId} is not active`);
  }
  if (operation === 'stores:reconnect' && activeContext?.storeId !== storeId) {
    throw new StoreCoordinatorError(
      'STORE_CONTEXT_MISMATCH',
      'only the active store can reconnect its browser session',
    );
  }
}

async function guardActiveStoreMutation(
  context: StoreContextEnvelope | null,
  events: StoreIpcEvents,
  storeId: unknown,
  operation: string,
): Promise<void> {
  if (context && String(context.storeId) === String(storeId ?? '').trim()) {
    await events.beforeActiveStoreMutation?.(context, operation);
  }
}

function readStoreId(value: unknown): ReturnType<typeof normalizeStoreId> {
  if (typeof value === 'string') return normalizeStoreId(value);
  return normalizeStoreId(asObject(value).storeId);
}

function readCreateStoreInput(value: unknown): CreateStoreInput {
  const input = asObject(value);
  return {
    displayName: readDisplayName(input.displayName),
    marketplace: normalizeUsMarketplace(input.marketplace),
    currency: normalizeUsdCurrency(input.currency),
    businessTimezone: readUsBusinessTimezone(input.businessTimezone),
  };
}

function readUpdateStoreInput(value: unknown): UpdateStoreInput {
  const input = asObject(value);
  const patchInput = asObject(input.patch);
  const patch: UpdateStoreInput['patch'] = {};
  if (hasOwn(patchInput, 'displayName')) {
    patch.displayName = readDisplayName(patchInput.displayName);
  }
  if (hasOwn(patchInput, 'status')) {
    patch.status = readWritableStoreStatus(patchInput.status);
  }
  if (hasOwn(patchInput, 'businessTimezone')) {
    patch.businessTimezone = readUsBusinessTimezone(patchInput.businessTimezone);
  }
  if (Object.keys(patch).length === 0) {
    throw new StoreCoordinatorError('EMPTY_STORE_PATCH', 'store update requires at least one field');
  }
  const expectedUpdatedAt = readOptionalRevision(input.expectedUpdatedAt);
  return {
    storeId: normalizeStoreId(input.storeId),
    patch,
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
  };
}

function readArchiveStoreInput(value: unknown): ArchiveStoreInput {
  const input = asObject(value);
  const expectedUpdatedAt = readOptionalRevision(input.expectedUpdatedAt);
  const reason = readOptionalText(input.reason, 'reason');
  return {
    storeId: normalizeStoreId(input.storeId),
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    ...(reason ? { reason } : {}),
  };
}

function readRestoreStoreInput(value: unknown): RestoreStoreInput {
  const input = asObject(value);
  const expectedUpdatedAt = readOptionalRevision(input.expectedUpdatedAt);
  return {
    storeId: normalizeStoreId(input.storeId),
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
  };
}

function readDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new StoreCoordinatorError('INVALID_DISPLAY_NAME', 'displayName is required');
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < 1 || normalized.length > 120) {
    throw new StoreCoordinatorError(
      'INVALID_DISPLAY_NAME',
      'displayName must contain 1-120 characters',
    );
  }
  return normalized;
}

function readUsBusinessTimezone(value: unknown): string {
  const normalized = normalizeBusinessTimezone(value ?? DEFAULT_US_BUSINESS_TIMEZONE);
  if (normalized !== DEFAULT_US_BUSINESS_TIMEZONE) {
    throw new TypeError(`V1 supports businessTimezone ${DEFAULT_US_BUSINESS_TIMEZONE} only`);
  }
  return normalized;
}

function readWritableStoreStatus(value: unknown): 'active' | 'inactive' {
  if (value !== 'active' && value !== 'inactive') {
    throw new StoreCoordinatorError('INVALID_STORE_STATUS', 'status must be active or inactive');
  }
  return value;
}

function readOptionalRevision(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || Number.isNaN(Date.parse(value.trim()))) {
    throw new TypeError('expectedUpdatedAt must be a parseable timestamp string');
  }
  return value.trim();
}

function readOptionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  return value.trim() || undefined;
}

function optionalStoreId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined;
}

function readCreateConnectionInput(value: unknown): CreateStoreConnectionInput {
  const input = asObject(value);
  const hasAccountLabel = input.accountLabel !== undefined;
  const hasExternalAccountId = input.externalAccountId !== undefined;
  const accountLabel = hasAccountLabel
    ? readProviderIdentity(input.accountLabel, 'accountLabel')
    : undefined;
  const externalAccountId = hasExternalAccountId
    ? readProviderIdentity(input.externalAccountId, 'externalAccountId')
    : undefined;
  return {
    storeId: normalizeStoreId(input.storeId),
    provider: readConnectionProvider(input.provider),
    ...(hasAccountLabel ? { accountLabel } : {}),
    ...(hasExternalAccountId ? { externalAccountId } : {}),
  };
}

function readUpdateConnectionInput(value: unknown): UpdateStoreConnectionInput {
  const input = asObject(value);
  const hasAccountLabel = input.accountLabel !== undefined;
  const hasExternalAccountId = input.externalAccountId !== undefined;
  if (!hasAccountLabel && !hasExternalAccountId) {
    throw new TypeError('connection update requires accountLabel or externalAccountId');
  }
  const accountLabel = hasAccountLabel
    ? readProviderIdentity(input.accountLabel, 'accountLabel')
    : undefined;
  const externalAccountId = hasExternalAccountId
    ? readProviderIdentity(input.externalAccountId, 'externalAccountId')
    : undefined;
  return {
    id: normalizeStoreCapabilityId(input.id),
    storeId: normalizeStoreId(input.storeId),
    ...(hasAccountLabel ? { accountLabel } : {}),
    ...(hasExternalAccountId ? { externalAccountId } : {}),
  };
}

function readRemoveConnectionInput(value: unknown): RemoveStoreConnectionInput {
  const input = asObject(value);
  return {
    id: normalizeStoreCapabilityId(input.id),
    storeId: normalizeStoreId(input.storeId),
  };
}

function readConnectionProvider(value: unknown): CreateStoreConnectionInput['provider'] {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value;
  if (normalized !== 'lingxing' && normalized !== 'amazon_ads') {
    throw new TypeError('provider must be lingxing or amazon_ads');
  }
  return normalized;
}

const MAX_PROVIDER_IDENTITY_LENGTH = 256;
const PROVIDER_IDENTITY_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function readProviderIdentity(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  if (
    normalized.length > MAX_PROVIDER_IDENTITY_LENGTH
    || PROVIDER_IDENTITY_CONTROL_CHARACTERS.test(normalized)
  ) {
    throw new TypeError(
      `${label} must be at most ${MAX_PROVIDER_IDENTITY_LENGTH} characters without control characters`,
    );
  }
  return normalized;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('store IPC input must be an object');
  }
  return value as Record<string, unknown>;
}

function asOptionalObject(value: unknown): Record<string, unknown> | undefined {
  return value === undefined ? undefined : asObject(value);
}
