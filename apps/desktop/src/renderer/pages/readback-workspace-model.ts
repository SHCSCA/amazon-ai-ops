export type ReadbackExportRoute =
  | { kind: 'direct-verify'; evidencePath: string }
  | { kind: 'prepare-session'; sourcePath: string }
  | { kind: 'blocked'; reason: 'contract-mismatch' | 'missing-json-path' | 'unsupported-status' };

export interface ReadbackQueryInput {
  dateFrom?: string;
  dateTo?: string;
  storeName?: string;
  marketplaceCode?: string;
  asin?: string;
  batchId?: string;
}

export type ReadbackPublicationKind = 'capture' | 'rows' | 'export' | 'final' | 'session' | 'verify';

export interface ReadbackRequestSnapshot {
  kind: ReadbackPublicationKind;
  requestId: number;
  queryKey: string;
  formEpoch: number;
}

export type ReadbackAuthorityMode = 'production' | 'preview-readonly';

export interface ReadbackWriteCapabilities {
  captureEvidence: boolean;
  exportEvidence: boolean;
  prepareSession: boolean;
  verifySession: boolean;
  fillSession: boolean;
  verifyEvidence: boolean;
}

export interface ReadbackAuthority {
  mode: ReadbackAuthorityMode;
  previewOnly: boolean;
  appReady: boolean;
  capabilities: ReadbackWriteCapabilities;
}

export type ReadbackRepairBlocker = 'screenshot' | 'value' | 'verification';

export interface ReadbackRepairAction {
  blocker: ReadbackRepairBlocker;
  label: string;
  stepId: 'approval' | 'evidence' | 'verify-export';
  focusTarget: string;
}

export type ReadbackWorkspaceActionKey =
  | 'capture-evidence'
  | 'export-evidence'
  | 'final-verification'
  | 'prepare-session'
  | 'verify-session'
  | 'fill-session'
  | 'verify-evidence'
  | 'open-path'
  | 'copy-command';

export interface ReadbackGlobalBusyView {
  workspaceLocked: boolean;
  peerLocked: boolean;
  disabled: boolean;
  ariaBusy?: true;
  showSpinner: boolean;
}

export type ReadbackFinalVerificationResult<TExport, TVerify> =
  | { kind: 'verification-result'; exportResult: TExport; verifyResult: TVerify }
  | { kind: 'needs-work'; exportResult: TExport; sourcePath: string }
  | { kind: 'blocked'; exportResult: TExport; reason: 'contract-mismatch' | 'missing-json-path' | 'unsupported-status' };

export async function runReadbackFinalVerificationWorkflow<TExport, TVerify>(input: {
  exportEvidence: () => Promise<TExport>;
  verifyEvidence: (evidencePath: string) => Promise<TVerify>;
}): Promise<ReadbackFinalVerificationResult<TExport, TVerify>> {
  const exportResult = await input.exportEvidence();
  const route = resolveReadbackExportRoute(exportResult);

  if (route.kind === 'direct-verify') {
    return {
      kind: 'verification-result',
      exportResult,
      verifyResult: await input.verifyEvidence(route.evidencePath),
    };
  }
  if (route.kind === 'prepare-session') {
    return { kind: 'needs-work', exportResult, sourcePath: route.sourcePath };
  }
  return { kind: 'blocked', exportResult, reason: route.reason };
}

export async function runCurrentReadbackFinalVerification<T>(
  task: () => Promise<T>,
  shouldPublish: () => boolean,
  publish: (result: T) => void,
): Promise<T | undefined> {
  const result = await task();
  if (!shouldPublish()) return undefined;
  publish(result);
  return result;
}

const READBACK_REPAIR_ACTIONS = [
  {
    blocker: 'screenshot',
    label: '补交截图',
    stepId: 'evidence',
    focusTarget: 'readback-first-missing-screenshot',
  },
  {
    blocker: 'value',
    label: '填写回读值',
    stepId: 'evidence',
    focusTarget: 'readback-actual-value',
  },
  {
    blocker: 'verification',
    label: '运行最终校验',
    stepId: 'verify-export',
    focusTarget: 'readback-verify-evidence',
  },
] as const satisfies readonly ReadbackRepairAction[];

function normalizedQueryField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildReadbackQueryKey(input: ReadbackQueryInput): string {
  return JSON.stringify({
    dateFrom: normalizedQueryField(input.dateFrom),
    dateTo: normalizedQueryField(input.dateTo),
    storeName: normalizedQueryField(input.storeName),
    marketplaceCode: normalizedQueryField(input.marketplaceCode),
    asin: normalizedQueryField(input.asin),
    batchId: normalizedQueryField(input.batchId),
  });
}

export function canPublishReadbackResult(
  request: ReadbackRequestSnapshot,
  active: ReadbackRequestSnapshot,
): boolean {
  return request.kind === active.kind
    && request.requestId === active.requestId
    && request.queryKey === active.queryKey
    && request.formEpoch === active.formEpoch;
}

export function readbackAuthorityForMode(
  mode: ReadbackAuthorityMode,
  options: { appReady?: boolean } = {},
): ReadbackAuthority {
  const writable = mode === 'production';
  return {
    mode,
    previewOnly: !writable,
    appReady: writable && options.appReady === true,
    capabilities: {
      captureEvidence: writable,
      exportEvidence: writable,
      prepareSession: writable,
      verifySession: writable,
      fillSession: writable,
      verifyEvidence: writable,
    },
  };
}

export function readbackRepairActions(
  blockers: readonly ReadbackRepairBlocker[],
): ReadbackRepairAction[] {
  const uniqueBlockers = new Set(blockers);
  return READBACK_REPAIR_ACTIONS
    .filter((action) => uniqueBlockers.has(action.blocker))
    .map((action) => ({ ...action }));
}

const SCREENSHOT_REPAIR_MARKERS = [
  '审批凭证',
  '执行前截图',
  '执行后截图',
  '回读证据',
  '证据文件不能复用',
] as const;

const VALUE_REPAIR_MARKERS = [
  '执行前值',
  '执行后值',
  '回读值',
  '降价动作必须证明',
] as const;

export function readbackRepairBlockersForMissing(
  missing: readonly string[],
): ReadbackRepairBlocker[] {
  const blockers: ReadbackRepairBlocker[] = [];
  if (missing.some((item) => SCREENSHOT_REPAIR_MARKERS.some((marker) => item.includes(marker)))) {
    blockers.push('screenshot');
  }
  if (missing.some((item) => VALUE_REPAIR_MARKERS.some((marker) => item.includes(marker)))) {
    blockers.push('value');
  }
  if (blockers.length === 0) blockers.push('verification');
  return blockers.slice(0, 2);
}

export function resolveReadbackScreenshotRepairAction(
  action: ReadbackRepairAction,
  evidence: {
    approvalArtifactPath?: string;
    beforeScreenshotPath?: string;
    afterScreenshotPath?: string;
    readbackEvidencePath?: string;
  },
): ReadbackRepairAction {
  if (action.blocker !== 'screenshot') return { ...action };
  return {
    ...action,
    stepId: evidence.approvalArtifactPath?.trim() ? 'evidence' : 'approval',
    focusTarget: 'readback-first-missing-screenshot',
  };
}

export function readbackGlobalBusyView(input: {
  action: ReadbackWorkspaceActionKey;
  activeAction: ReadbackWorkspaceActionKey | null;
  disabled?: boolean;
}): ReadbackGlobalBusyView {
  const workspaceLocked = input.activeAction !== null;
  const active = input.activeAction === input.action;
  return {
    workspaceLocked,
    peerLocked: workspaceLocked && !active,
    disabled: Boolean(input.disabled || workspaceLocked),
    ariaBusy: active ? true : undefined,
    showSpinner: active,
  };
}

export function resolveReadbackExportRoute(value: unknown): ReadbackExportRoute {
  if (!value || typeof value !== 'object') {
    return { kind: 'blocked', reason: 'unsupported-status' };
  }

  const result = value as Record<string, unknown>;
  const status = String(result.status ?? '').trim().toUpperCase();
  if (status !== 'PASS' && status !== 'NEEDS_WORK') {
    return { kind: 'blocked', reason: 'unsupported-status' };
  }

  const jsonPath = typeof result.jsonPath === 'string' ? result.jsonPath.trim() : '';
  if (!jsonPath) return { kind: 'blocked', reason: 'missing-json-path' };

  if (status === 'PASS') {
    if (result.readyForVerifier !== true || result.nextAction !== 'verify') {
      return { kind: 'blocked', reason: 'contract-mismatch' };
    }
    return { kind: 'direct-verify', evidencePath: jsonPath };
  }

  if (result.readyForVerifier !== false || result.nextAction !== 'prepare') {
    return { kind: 'blocked', reason: 'contract-mismatch' };
  }
  return { kind: 'prepare-session', sourcePath: jsonPath };
}
