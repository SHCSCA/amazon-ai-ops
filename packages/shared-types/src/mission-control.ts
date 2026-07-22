import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
} from './store';
import type { LingxingCollectionImportState } from './lingxing-collection';

/**
 * Stable production workspaces exposed by the Mission Control shell.
 *
 * These identifiers describe product domains. Lingxing and legacy Renderer
 * routes remain adapters below this boundary and must not become workspaces.
 */
export const MISSION_CONTROL_WORKSPACE_IDS = [
  'today',
  'missions',
  'decisions',
  'experiments',
  'execution',
  'memory',
  'objects',
  'collection',
  'policy',
  'settings',
] as const;

export type MissionControlWorkspaceId = (typeof MISSION_CONTROL_WORKSPACE_IDS)[number];

export const MISSION_CONTROL_LEGACY_ROUTE_IDS = [
  'dashboard',
  'product-management',
  'product-config',
  'operation-events',
  'operation-scope',
  'data-collection',
  'data-import-validation',
  'ad-quant',
  'recommendations',
  'approval',
  'readback',
  'keyword-opportunities',
  'listing-optimization',
  'settings',
  'scheduler',
  'delivery',
] as const;

export type MissionControlLegacyRouteId =
  (typeof MISSION_CONTROL_LEGACY_ROUTE_IDS)[number];

export type MissionControlCapabilityState =
  | 'PRODUCTION_NATIVE'
  | 'LEGACY_ADAPTER'
  | 'PROTOTYPE_ONLY'
  | 'BLOCKED';

/**
 * Canonical views are qualified by workspace so that an adapter cannot make
 * two unrelated `overview` tabs share an authority decision accidentally.
 */
export const MISSION_CONTROL_VIEW_IDS = [
  'today/overview',
  'today/events',
  'missions/overview',
  'missions/facts',
  'decisions/recommendations',
  'decisions/approval',
  'decisions/decided',
  'experiments/ledger',
  'execution/live',
  'execution/evidence',
  'memory/timeline',
  'objects/products',
  'objects/targets',
  'objects/keywords',
  'objects/listing',
  'collection/scope',
  'collection/reports',
  'collection/import-check',
  'policy/rules',
  'settings/ai-and-local',
  'settings/scheduler',
  'settings/delivery',
] as const;

export type MissionControlViewId = (typeof MISSION_CONTROL_VIEW_IDS)[number];

export type MissionControlCapabilityAction =
  | 'view'
  | 'create'
  | 'update'
  | 'start'
  | 'pause'
  | 'resume'
  | 'approve'
  | 'reject'
  | 'archive'
  | 'restore'
  | 'delete'
  | 'generate'
  | 'analyze'
  | 'import'
  | 'export'
  | 'verify'
  | 'takeover'
  | 'skip'
  | 'enable'
  | 'disable'
  | 'switch'
  | 'rebuild-index'
  | 'reconcile-unknown'
  | 'publish'
  | 'kill-switch';

/**
 * One visible view action has exactly one authority state. Workspace-level
 * badges may be derived from these rows, but are never themselves authority
 * facts because one workspace can mix native, legacy and blocked actions.
 */
export interface MissionControlCapabilityProjection {
  /** Stable dotted identifier, for example `objects.store.create`. */
  capabilityId: string;
  workspace: MissionControlWorkspaceId;
  view: MissionControlViewId;
  action: MissionControlCapabilityAction;
  state: MissionControlCapabilityState;
  legacyRoute?: MissionControlLegacyRouteId;
  blockerCode?: string;
  detail: string;
}

export type MissionControlAutonomyMode = 'manual_approval' | 'policy_auto';

export interface MissionControlAutonomyProjection {
  currentMode: MissionControlAutonomyMode;
  manualApprovalAvailable: true;
  policyAutoAvailable: boolean;
  policyAutoBlockerCode?: string;
  policyAutoBlockerDetail?: string;
}

export type MissionControlTodayReadinessState = 'ready' | 'attention' | 'blocked';

export interface MissionControlTodayReadinessItem {
  id: 'collection' | 'import' | 'products' | 'browser';
  label: string;
  state: MissionControlTodayReadinessState;
  detail: string;
  targetView: MissionControlViewId;
}

export interface MissionControlTodayProjection {
  storeId: string;
  authorityKey: string;
  businessDate: string;
  marketplace: 'US';
  currency: 'USD';
  generatedAt: string;
  facts: {
    productCount: number;
    configuredProductCount: number;
    collectionJobCount: number;
    latestCollectionJob?: {
      jobId: string;
      state: string;
      importState: LingxingCollectionImportState | 'legacy_unverified';
      downloadedReports: number;
      totalReports: number;
      updatedAt: string;
    };
    importedMetricRows: number;
    latestMetricDate?: string;
    operationEventsToday: number;
    browserSessionReady: boolean;
  };
  readiness: MissionControlTodayReadinessItem[];
  blockers: string[];
  attentionItems: string[];
  nextAction: {
    id: string;
    label: string;
    detail: string;
    targetView: MissionControlViewId;
    requiredCapabilityId: string;
    available: boolean;
    blockerCode?: string;
  };
}

/**
 * Renderer epoch is a local invalidation counter, not an authorization token.
 * Main echoes it so the Renderer can discard a response issued before a store
 * switch even when the underlying IPC promise resolves later.
 */
export interface MissionControlRequestMeta {
  requestId: string;
  contextEpoch: number;
  context: StoreContextEnvelope;
}

/**
 * Responses never echo Renderer-supplied context as authority. Main must
 * reacquire this snapshot after the operation and return that value here.
 */
export interface MissionControlResponseMeta {
  requestId: string;
  contextEpoch: number;
  authoritativeContext: StoreContextEnvelope;
  completedAt: string;
}

export interface MissionControlBootstrapQueryRequest extends MissionControlRequestMeta {
  query: 'workspace-bootstrap';
}

export type MissionControlQueryRequest = MissionControlBootstrapQueryRequest;

export interface MissionControlBootstrapProjection {
  capabilities: MissionControlCapabilityProjection[];
  autonomy: MissionControlAutonomyProjection;
  today: MissionControlTodayProjection;
}

export interface MissionControlBootstrapQueryResponse extends MissionControlResponseMeta {
  query: 'workspace-bootstrap';
  data: MissionControlBootstrapProjection;
}

export type MissionControlQueryResponse = MissionControlBootstrapQueryResponse;

export interface MissionControlSetAutonomyModeCommandRequest extends MissionControlRequestMeta {
  command: 'set-autonomy-mode';
  payload: {
    mode: MissionControlAutonomyMode;
    missionId?: string;
  };
}

export type MissionControlCommandRequest = MissionControlSetAutonomyModeCommandRequest;

export type MissionControlCommandStatus = 'NOOP' | 'BLOCKED';

export interface MissionControlSetAutonomyModeCommandResponse extends MissionControlResponseMeta {
  command: 'set-autonomy-mode';
  status: MissionControlCommandStatus;
  currentMode: MissionControlAutonomyMode;
  blockerCode?: string;
  detail: string;
}

export type MissionControlCommandResponse = MissionControlSetAutonomyModeCommandResponse;

export function missionControlContextKey(context: StoreContextEnvelope): string {
  const normalized = normalizeStoreContextEnvelope(context);
  return [
    normalized.storeId,
    normalized.browserProfileId,
    normalized.marketplace,
    normalized.currency,
    normalized.businessTimezone,
    normalized.businessDate,
    normalized.sessionGeneration,
  ].join('|');
}

export function normalizeMissionControlQueryRequest(
  value: unknown,
): MissionControlQueryRequest {
  const record = strictRecord(value, [
    'query',
    'requestId',
    'contextEpoch',
    'context',
  ], 'Mission Control query');
  if (record.query !== 'workspace-bootstrap') {
    throw new TypeError('unsupported Mission Control query');
  }
  return {
    query: 'workspace-bootstrap',
    ...normalizeRequestMeta(record),
  };
}

export function normalizeMissionControlCommandRequest(
  value: unknown,
): MissionControlCommandRequest {
  const record = strictRecord(value, [
    'command',
    'requestId',
    'contextEpoch',
    'context',
    'payload',
  ], 'Mission Control command');
  if (record.command !== 'set-autonomy-mode') {
    throw new TypeError('unsupported Mission Control command');
  }
  const payload = strictRecord(
    record.payload,
    ['mode', 'missionId'],
    'Mission Control command payload',
    ['missionId'],
  );
  if (payload.mode !== 'manual_approval' && payload.mode !== 'policy_auto') {
    throw new TypeError('Mission Control autonomy mode is invalid');
  }
  const missionId = optionalTrimmedString(payload.missionId, 'missionId', 160);
  return {
    command: 'set-autonomy-mode',
    ...normalizeRequestMeta(record),
    payload: {
      mode: payload.mode,
      ...(missionId ? { missionId } : {}),
    },
  };
}

function normalizeRequestMeta(record: Record<string, unknown>): MissionControlRequestMeta {
  const requestId = requiredTrimmedString(record.requestId, 'requestId', 128);
  if (!/^[A-Za-z0-9._:-]+$/.test(requestId)) {
    throw new TypeError('requestId contains unsupported characters');
  }
  if (!Number.isSafeInteger(record.contextEpoch) || (record.contextEpoch as number) < 0) {
    throw new TypeError('contextEpoch must be a non-negative safe integer');
  }
  return {
    requestId,
    contextEpoch: record.contextEpoch as number,
    context: normalizeStoreContextEnvelope(record.context),
  };
}

function strictRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unsupported field ${key}`);
  }
  for (const key of allowedKeys) {
    if (!optionalKeys.includes(key) && !Object.prototype.hasOwnProperty.call(record, key)) {
      throw new TypeError(`${label} is missing ${key}`);
    }
  }
  return record;
}

function requiredTrimmedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new TypeError(`${label} must contain 1-${maxLength} characters`);
  }
  return normalized;
}

function optionalTrimmedString(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  return requiredTrimmedString(value, label, maxLength);
}
