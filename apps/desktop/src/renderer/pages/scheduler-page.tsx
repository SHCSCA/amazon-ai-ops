import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowsClockwise,
  CalendarBlank,
  CheckCircle,
  Clock,
  Database,
  Play,
  ShieldCheck,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import {
  missionControlContextKey,
  type MissionControlCapabilityProjection,
  type StoreCollectionScheduleProjection,
  type StoreCollectionScheduleRunResult,
  type StoreCollectionScheduleState,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  PageFrame,
  SummaryStrip,
  TaskBanner,
  WorkbenchPanel,
  WorkspaceState,
  type WorkspaceTone,
} from '../components/workspace';
import type { AppRoute } from '../types';
import { toUserFacingError } from '../user-facing-error';

export const STORE_AUTOMATION_CAPABILITY_IDS = {
  view: 'settings.scheduler.view',
  runNow: 'settings.scheduler.run-now',
  retentionPreview: 'settings.scheduler.retention-preview',
} as const;

export interface StoreEvidenceRetentionBlockerView {
  code: string;
  detail: string;
  diagnosticDetail: string;
}

/**
 * Renderer-safe subset of the Main-only retention manifest. Candidate and
 * protected file names deliberately stay out of component state and the DOM.
 */
export interface StoreEvidenceRetentionSummary {
  schemaVersion: 1;
  mode: 'dry-run';
  deletionSupported: false;
  generatedAt: string;
  storeId: string;
  profileId: string;
  marketplace: 'US';
  currency: 'USD';
  retentionDays: number;
  cutoffAt: string;
  scanSafe: boolean;
  candidateCount: number;
  candidateBytes: number;
  protectedCount: number;
  blockers: readonly StoreEvidenceRetentionBlockerView[];
}

interface RawStoreEvidenceRetentionManifest {
  schemaVersion?: unknown;
  mode?: unknown;
  deletionSupported?: unknown;
  generatedAt?: unknown;
  storeId?: unknown;
  profileId?: unknown;
  marketplace?: unknown;
  currency?: unknown;
  retentionDays?: unknown;
  cutoffAt?: unknown;
  expiryBasis?: unknown;
  applyable?: unknown;
  scanSafe?: unknown;
  candidateCount?: unknown;
  candidateBytes?: unknown;
  protectedScopeCount?: unknown;
  protectedFileCount?: unknown;
  blockerCount?: unknown;
  blockers?: unknown;
}

export interface StoreAutomationRendererApi {
  getStoreCollectionSchedule(context: StoreContextEnvelope): Promise<StoreCollectionScheduleProjection>;
  runStoreCollectionScheduleNow(context: StoreContextEnvelope): Promise<StoreCollectionScheduleRunResult>;
  previewStoreEvidenceRetention(context: StoreContextEnvelope): Promise<RawStoreEvidenceRetentionManifest>;
}

export interface SchedulerPageProps {
  storeContext: StoreContextEnvelope;
  capabilities: readonly MissionControlCapabilityProjection[];
  previewMode?: boolean;
  api?: StoreAutomationRendererApi | null;
}

export const STORE_AUTOMATION_STATES: readonly {
  state: StoreCollectionScheduleState;
  label: string;
  detail: string;
}[] = [
  { state: 'not_configured', label: '未配置', detail: '先在 AI 与本地设置创建当前店铺配置。' },
  { state: 'archived', label: '已归档', detail: '配置不再生效，需先恢复。' },
  { state: 'waiting', label: '等待计划', detail: '等待店铺业务时区的配置时间。' },
  { state: 'due', label: '计划已到', detail: '调度器可认领本业务日采集。' },
  { state: 'claimed', label: '正在采集', detail: '已持久认领，使用可见浏览器执行。' },
  { state: 'succeeded', label: '已完成', detail: '同一店铺、业务日与采集口径不重复认领。' },
  { state: 'failed', label: '失败关闭', detail: '同一采集口径不重试，等待人工排查。' },
] as const;

const SCHEDULE_STATES = new Set<StoreCollectionScheduleState>(
  STORE_AUTOMATION_STATES.map((item) => item.state),
);

export function readStoreAutomationRendererApi(target: unknown = globalThis): StoreAutomationRendererApi | null {
  const candidate = (target as { electronAPI?: Partial<StoreAutomationRendererApi> } | null)?.electronAPI;
  if (!candidate) return null;
  return (
    typeof candidate.getStoreCollectionSchedule === 'function'
    && typeof candidate.runStoreCollectionScheduleNow === 'function'
    && typeof candidate.previewStoreEvidenceRetention === 'function'
  )
    ? candidate as StoreAutomationRendererApi
    : null;
}

export function resolveStoreAutomationAccess(
  capabilities: readonly MissionControlCapabilityProjection[],
  previewMode: boolean,
) {
  const allowed = (capabilityId: string, productionStates: readonly MissionControlCapabilityProjection['state'][]) => {
    const capability = capabilities.find((item) => (
      item.capabilityId === capabilityId
      && item.workspace === 'settings'
      && item.view === 'settings/scheduler'
    ));
    const states = previewMode ? ['PROTOTYPE_ONLY'] : productionStates;
    return {
      allowed: Boolean(capability && states.includes(capability.state)),
      capability,
    };
  };
  return {
    view: allowed(STORE_AUTOMATION_CAPABILITY_IDS.view, ['LEGACY_ADAPTER', 'PRODUCTION_NATIVE']),
    runNow: allowed(STORE_AUTOMATION_CAPABILITY_IDS.runNow, ['PRODUCTION_NATIVE']),
    retentionPreview: allowed(STORE_AUTOMATION_CAPABILITY_IDS.retentionPreview, ['PRODUCTION_NATIVE']),
  };
}

const SCHEDULER_INTERNAL_OPERATOR_COPY = /\b(?:Main|StoreContext|Authority|Renderer|Profile|Mission|Experiment|UNKNOWN|revision|draft|set_keyword_bid|manifest|fingerprint|dry-run|CRUD|PRODUCTION_NATIVE|PROTOTYPE_ONLY|LEGACY_ADAPTER|sequence|append-only|correction|DECISION|ACTION|READBACK|EFFECT)\b/i;

export function schedulerOperatorMessage(value: unknown, fallback: string): string {
  const mapped = toUserFacingError(value, fallback);
  return SCHEDULER_INTERNAL_OPERATOR_COPY.test(mapped) ? fallback : mapped;
}

export function schedulerRunNowPolicy(
  projection: StoreCollectionScheduleProjection | null,
): { allowed: boolean; reason: string } {
  if (!projection) return { allowed: false, reason: '尚未读取当前店铺计划。' };
  switch (projection.state) {
    case 'waiting':
    case 'due':
      return { allowed: true, reason: '需要二次确认；系统会再次核对当前店铺与可见领星会话。' };
    case 'not_configured':
      return { allowed: false, reason: '当前店铺尚未配置，请先前往 AI 与本地设置。' };
    case 'archived':
      return { allowed: false, reason: '当前店铺配置已归档，请先恢复配置。' };
    case 'claimed':
      return { allowed: false, reason: '当前店铺已有采集任务执行中，禁止重复触发。' };
    case 'succeeded':
      return { allowed: false, reason: '同一店铺、业务日与采集口径已完成，幂等边界禁止重复触发。' };
    case 'failed':
      return {
        allowed: false,
        reason: '同一店铺、业务日与采集口径已失败关闭且不重试；调整触发时间不会绕过安全限制，只有回看窗口变化才会形成新的采集口径标识。',
      };
  }
}

export function schedulerFailureReviewLabel(
  state: StoreCollectionScheduleProjection['state'],
): string {
  return state === 'failed'
    ? '同采集口径关闭 · 不重试'
    : '状态无法确认或采集失败时，均需人工核对';
}

export function storeAutomationRequestMatches(
  sequence: number,
  currentSequence: number,
  capturedAuthorityKey: string,
  currentAuthorityKey: string,
): boolean {
  return sequence === currentSequence && capturedAuthorityKey === currentAuthorityKey;
}

export function normalizeRetentionSummary(
  value: RawStoreEvidenceRetentionManifest,
  context: StoreContextEnvelope,
): StoreEvidenceRetentionSummary {
  if (!value || typeof value !== 'object') throw new Error('证据保留预览返回了无效对象。');
  const storeId = String(value.storeId ?? '');
  const profileId = String(value.profileId ?? '');
  const blockers = Array.isArray(value.blockers)
    ? value.blockers.map((item) => {
        if (!item || typeof item !== 'object') throw new Error('证据保留阻塞项格式无效。');
        const blocker = item as { code?: unknown; detail?: unknown };
        const code = String(blocker.code ?? '').trim();
        const detail = String(blocker.detail ?? '').trim();
        if (!code || !detail) throw new Error('证据保留阻塞项不完整。');
        return {
          code,
          detail: schedulerOperatorMessage(
            detail,
            '此候选项未通过安全检查，当前不会删除或应用。',
          ),
          diagnosticDetail: detail,
        };
      })
    : [];
  const retentionDays = Number(value.retentionDays);
  const candidateCount = Number(value.candidateCount);
  const candidateBytes = Number(value.candidateBytes);
  const protectedScopeCount = Number(value.protectedScopeCount);
  const protectedFileCount = Number(value.protectedFileCount);
  const blockerCount = Number(value.blockerCount);
  const generatedAt = String(value.generatedAt ?? '');
  const cutoffAt = String(value.cutoffAt ?? '');
  if (
    value.schemaVersion !== 1
    || value.mode !== 'dry-run'
    || value.deletionSupported !== false
    || storeId !== String(context.storeId)
    || profileId !== String(context.browserProfileId)
    || value.marketplace !== 'US'
    || value.currency !== 'USD'
    || value.expiryBasis !== 'mtime-before-cutoff'
    || !Number.isInteger(retentionDays)
    || retentionDays < 30
    || !Number.isInteger(candidateCount)
    || candidateCount < 0
    || !Number.isFinite(candidateBytes)
    || candidateBytes < 0
    || !Number.isInteger(protectedScopeCount)
    || protectedScopeCount < 0
    || !Number.isInteger(protectedFileCount)
    || protectedFileCount < 0
    || !Number.isInteger(blockerCount)
    || blockerCount !== blockers.length
    || !validTimestamp(generatedAt)
    || !validTimestamp(cutoffAt)
    || value.applyable !== false
    || typeof value.scanSafe !== 'boolean'
    || value.scanSafe !== (blockers.length === 0)
  ) {
    throw new Error('证据保留预览未通过当前店铺、US/USD 或 dry-run 安全校验。');
  }
  return {
    schemaVersion: 1,
    mode: 'dry-run',
    deletionSupported: false,
    generatedAt,
    storeId,
    profileId,
    marketplace: 'US',
    currency: 'USD',
    retentionDays,
    cutoffAt,
    scanSafe: value.scanSafe,
    candidateCount,
    candidateBytes,
    protectedCount: protectedScopeCount + protectedFileCount,
    blockers,
  };
}

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

function validTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return Boolean(value && Number.isFinite(timestamp));
}

function validateScheduleProjection(
  value: StoreCollectionScheduleProjection,
  context: StoreContextEnvelope,
): StoreCollectionScheduleProjection {
  if (
    !value
    || typeof value !== 'object'
    || String(value.storeId) !== String(context.storeId)
    || String(value.businessDate) !== String(context.businessDate)
    || !SCHEDULE_STATES.has(value.state)
    || typeof value.enabled !== 'boolean'
    || typeof value.detail !== 'string'
  ) {
    throw new Error('店铺计划结果与当前店铺不一致，已安全停止。');
  }
  return value;
}

function stateTone(state?: StoreCollectionScheduleState): WorkspaceTone {
  if (state === 'succeeded') return 'confirmed';
  if (state === 'failed' || state === 'archived') return 'blocked';
  if (state === 'due' || state === 'claimed' || state === 'not_configured') return 'attention';
  return 'neutral';
}

function stateLabel(state?: StoreCollectionScheduleState): string {
  return STORE_AUTOMATION_STATES.find((item) => item.state === state)?.label ?? '等待读取';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function taskCopy(
  projection: StoreCollectionScheduleProjection | null,
  loading: boolean,
  error: string | null,
) {
  if (loading) {
    return {
      title: '正在读取当前店铺自动化',
      detail: '系统正在核对当前店铺、运行配置与本业务日执行记录。',
      tone: 'neutral' as WorkspaceTone,
    };
  }
  if (error || !projection) {
    return {
      title: '当前店铺自动化已失败关闭',
      detail: error ?? '没有可验证的店铺计划投影。',
      tone: 'blocked' as WorkspaceTone,
    };
  }
  const copies: Record<StoreCollectionScheduleState, { title: string; detail: string }> = {
    not_configured: {
      title: '先创建当前店铺运行配置',
      detail: '计划时间、回看窗口和证据保留期必须先在 AI 与本地设置中按店铺保存。',
    },
    archived: {
      title: '当前店铺运行配置已归档',
      detail: '自动采集已停止；恢复配置前不会认领任何本业务日任务。',
    },
    waiting: {
      title: `等待 ${projection.scheduleLocalTime ?? '配置时间'} 自动采集`,
      detail: '计划按当前店铺业务时区解释；也可二次确认后立即触发一次。',
    },
    due: {
      title: '当前店铺计划已到执行时间',
      detail: '系统将在可见领星会话就绪后认领任务；重复请求会被拒绝。',
    },
    claimed: {
      title: '当前店铺采集正在执行',
      detail: '任务已认领并绑定当前店铺的独立浏览器会话；切换店铺不会接收该结果。',
    },
    succeeded: {
      title: '本业务日采集已完成',
      detail: '同一店铺、业务日与采集口径不会再次执行；调整触发时间不会绕过安全限制，只有回看窗口变化才形成新的采集口径标识。',
    },
    failed: {
      title: '本业务日采集已失败关闭',
      detail: '同一店铺、业务日与采集口径不重试；调整触发时间不会绕过安全限制，只有回看窗口变化才会形成新的采集口径标识。',
    },
  };
  return { ...copies[projection.state], tone: stateTone(projection.state) };
}

export function SchedulerPage({
  storeContext,
  capabilities,
  previewMode = false,
  api: explicitApi,
}: SchedulerPageProps) {
  const api = explicitApi === undefined ? readStoreAutomationRendererApi(window) : explicitApi;
  const authorityKey = missionControlContextKey(storeContext);
  const access = useMemo(
    () => resolveStoreAutomationAccess(capabilities, previewMode),
    [capabilities, previewMode],
  );
  const [projection, setProjection] = useState<StoreCollectionScheduleProjection | null>(null);
  const [retention, setRetention] = useState<StoreEvidenceRetentionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const confirmDialogRef = useRef<HTMLElement | null>(null);
  const confirmReturnFocusRef = useRef<HTMLElement | null>(null);

  const isCurrentRequest = (sequence: number, key: string) => (
    storeAutomationRequestMatches(sequence, requestSequence.current, key, authorityKey)
  );

  async function loadRetention(
    context: StoreContextEnvelope,
    sequence: number,
    key: string,
  ) {
    if (!api || !access.retentionPreview.allowed) return;
    setRetentionLoading(true);
    setRetentionError(null);
    try {
      const raw = await api.previewStoreEvidenceRetention(context);
      const next = normalizeRetentionSummary(raw, context);
      if (isCurrentRequest(sequence, key)) setRetention(next);
    } catch (caught) {
      if (isCurrentRequest(sequence, key)) {
        setRetention(null);
        setRetentionError(schedulerOperatorMessage(caught, '读取证据保留预览失败，请刷新后重试。'));
      }
    } finally {
      if (isCurrentRequest(sequence, key)) setRetentionLoading(false);
    }
  }

  async function loadCurrentStoreAuthorized(
    context: StoreContextEnvelope,
    sequence: number,
    key: string,
  ) {
    if (!api) {
      setLoading(false);
      setError('当前店铺自动化接口不可用，请重新打开最新安装版后重试。');
      return;
    }
    try {
      const next = validateScheduleProjection(
        await api.getStoreCollectionSchedule(context),
        context,
      );
      if (!isCurrentRequest(sequence, key)) return;
      setProjection(next);
      if (next.state !== 'not_configured' && next.state !== 'archived') {
        await loadRetention(context, sequence, key);
      }
    } catch (caught) {
      if (isCurrentRequest(sequence, key)) {
        setError(schedulerOperatorMessage(caught, '读取当前店铺自动化失败，请刷新后重试。'));
      }
    } finally {
      if (isCurrentRequest(sequence, key)) setLoading(false);
    }
  }

  async function loadCurrentStore(options: { keepMessage?: boolean } = {}) {
    const sequence = ++requestSequence.current;
    const key = authorityKey;
    const context = storeContext;
    setLoading(true);
    // Every new StoreContext sequence owns its own retention request state.
    setRetentionLoading(false);
    setError(null);
    setProjection(null);
    setRetention(null);
    setRetentionError(null);
    setConfirmRun(false);
    if (!options.keepMessage) setMessage(null);
    if (!access.view.allowed) {
      setLoading(false);
      setError('当前店铺自动化视图不可用，请刷新或检查运行设置。');
      return;
    }
    await loadCurrentStoreAuthorized(context, sequence, key);
  }

  useEffect(() => {
    setProjection(null);
    setRetention(null);
    setError(null);
    setRetentionError(null);
    setRetentionLoading(false);
    setMessage(null);
    setConfirmRun(false);
    setRunning(false);
    void loadCurrentStore();
    return () => {
      requestSequence.current += 1;
    };
    // The authority key includes every store/profile/session field that may
    // authorize a result; a changed key invalidates all prior async responses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorityKey, access.view.allowed, access.retentionPreview.allowed, api]);

  useEffect(() => {
    if (!confirmRun) return undefined;
    confirmDialogRef.current
      ?.querySelector<HTMLElement>('[data-confirm-initial]')
      ?.focus();
    return () => {
      confirmReturnFocusRef.current?.focus();
      confirmReturnFocusRef.current = null;
    };
  }, [confirmRun]);

  function openRunConfirmation() {
    confirmReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setConfirmRun(true);
  }

  function handleConfirmDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !running) {
      event.preventDefault();
      setConfirmRun(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...(confirmDialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [])];
    if (controls.length === 0) {
      event.preventDefault();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function runNow() {
    if (!api || running || !projection || !access.runNow.allowed) return;
    const policy = schedulerRunNowPolicy(projection);
    if (!policy.allowed) return;
    const sequence = ++requestSequence.current;
    const context = storeContext;
    const key = authorityKey;
    setRunning(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.runStoreCollectionScheduleNow(context);
      const next = validateScheduleProjection(result.projection, context);
      if (!isCurrentRequest(sequence, key)) return;
      setProjection(next);
      setConfirmRun(false);
      setMessage(
        result.duplicate
          ? '系统已识别同一业务日的重复请求，本次没有重复执行。'
          : next.state === 'succeeded'
            ? '当前店铺本业务日采集已完成。'
            : next.state === 'failed'
              ? '采集失败关闭；同一采集口径不会自动重试。'
              : '当前店铺采集已受理。',
      );
      if (next.state !== 'not_configured' && next.state !== 'archived') {
        await loadRetention(context, sequence, key);
      }
    } catch (caught) {
      if (isCurrentRequest(sequence, key)) {
        setConfirmRun(false);
        setError(schedulerOperatorMessage(caught, '立即触发当前店铺采集失败，请刷新后重试。'));
      }
    } finally {
      if (isCurrentRequest(sequence, key)) setRunning(false);
    }
  }

  const runPolicy = schedulerRunNowPolicy(projection);
  const task = taskCopy(projection, loading, error);
  const needsConfig = projection?.state === 'not_configured' || projection?.state === 'archived';
  const runNowDisabledReason = !access.runNow.allowed
    ? schedulerOperatorMessage(
      access.runNow.capability?.detail,
      '立即采集暂不可用，请刷新或检查运行设置。',
    )
    : runPolicy.reason;
  const projectionDetail = projection
    ? schedulerOperatorMessage(projection.detail, runNowDisabledReason)
    : runNowDisabledReason;
  const primaryAction = needsConfig
    ? {
        actionId: 'settings.scheduler.open-config',
        label: '前往 AI 与本地设置',
        onClick: () => navigate('settings'),
      }
    : runPolicy.allowed
      ? {
          actionId: STORE_AUTOMATION_CAPABILITY_IDS.runNow,
          label: '立即采集',
          onClick: openRunConfirmation,
          disabled: !access.runNow.allowed || running,
          disabledReason: !access.runNow.allowed ? runNowDisabledReason : undefined,
        }
      : {
          actionId: 'settings.scheduler.refresh',
          label: '刷新当前店铺',
          busy: loading,
          busyLabel: '读取中…',
          onClick: () => { void loadCurrentStore(); },
          disabled: running,
          disabledReason: projection?.state === 'failed'
            ? '仅刷新状态，不会重试同一店铺、业务日与采集口径的失败任务。'
            : undefined,
        };

  return (
    <PageFrame
      className="mission-control-store-automation"
      description="按当前店铺、美国站、USD 与业务日管理领星自动采集；所有结果都会再次核对店铺范围。"
      pageId="store-automation"
      title="当前店铺自动化"
      task={(
        <TaskBanner
          eyebrow={previewMode ? '仅开发预览 · 当前店铺计划' : '当前店铺计划'}
          title={task.title}
          description={task.detail}
          tone={task.tone}
          status={<span>{stateLabel(projection?.state)}</span>}
          primaryAction={primaryAction}
          secondaryActions={[
            {
              actionId: 'settings.scheduler.refresh-secondary',
              label: '刷新',
              busy: loading,
              busyLabel: '读取中…',
              disabled: running,
              onClick: () => { void loadCurrentStore(); },
            },
          ]}
          meta={message ?? projectionDetail}
        />
      )}
      summary={(
        <SummaryStrip
          ariaLabel="当前店铺自动化范围"
          items={[
            {
              id: 'store',
              label: '店铺范围',
              value: '当前店铺',
              detail: 'Amazon US · USD',
              tone: 'confirmed',
            },
            {
              id: 'business-date',
              label: '业务日',
              value: storeContext.businessDate,
              detail: '按店铺业务时区',
            },
            {
              id: 'timezone',
              label: '业务时区',
              value: storeContext.businessTimezone,
              detail: `会话代次 ${storeContext.sessionGeneration}`,
            },
            {
              id: 'revision',
              label: '配置版本',
              value: projection?.configRevision ? `r${projection.configRevision}` : '未生效',
              detail: projection?.scheduleLocalTime ? `每日 ${projection.scheduleLocalTime}` : '等待配置',
              tone: projection?.configRevision ? 'confirmed' : 'attention',
            },
          ]}
        />
      )}
    >
      {error && <div className="mission-control-store-error" role="alert">{error}</div>}

      <WorkbenchPanel
        className="mission-control-automation-plan"
        description="七个状态构成同一采集口径生命周期；同一店铺、业务日与采集口径的失败终态不会回到等待。"
        status={<span>{stateLabel(projection?.state)} · 7 状态</span>}
        title="本业务日计划"
      >
        {loading ? (
          <WorkspaceState
            description="正在读取当前店铺计划、配置版本与幂等记录。"
            kind="loading"
            title="正在核对计划"
          />
        ) : !projection ? (
          <WorkspaceState
            action={{ label: '重新读取', onClick: () => { void loadCurrentStore(); } }}
            description={error ?? '当前店铺没有可验证的计划投影。'}
            kind="error"
            title="计划投影不可用"
          />
        ) : (
          <div className="mission-control-automation-state-grid" role="list" aria-label="店铺自动化七状态计划">
            {STORE_AUTOMATION_STATES.map((item, index) => {
              const active = item.state === projection.state;
              return (
                <article
                  aria-current={active ? 'step' : undefined}
                  className="mission-control-automation-state"
                  data-active={active || undefined}
                  data-state={item.state}
                  key={item.state}
                  role="listitem"
                >
                  <span>{index + 1}</span>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </div>
                  {active && <CheckCircle aria-hidden="true" size={18} weight="fill" />}
                </article>
              );
            })}
          </div>
        )}
        {projection && (
          <div
            aria-label="当前采集窗口"
            className="mission-control-automation-window"
            data-business-date={projection.businessDate}
            data-currency={storeContext.currency}
            data-marketplace={storeContext.marketplace}
            data-schedule-enabled={String(projection.enabled)}
            data-schedule-state={projection.state}
            data-store-id={projection.storeId}
            role="list"
          >
            <AutomationFact
              icon={<CalendarBlank aria-hidden="true" size={18} />}
              label="采集日期"
              value={projection.dateStart && projection.dateEnd
                ? `${projection.dateStart} → ${projection.dateEnd}`
                : '等待活动配置'}
            />
            <AutomationFact
              icon={<Clock aria-hidden="true" size={18} />}
              label="每日计划"
              value={projection.scheduleLocalTime
                ? `${projection.scheduleLocalTime} · ${storeContext.businessTimezone}`
                : '当前未启用'}
            />
            <AutomationFact
              icon={<Database aria-hidden="true" size={18} />}
              label="最近认领"
              value={projection.lastAttempt
                ? `${projection.lastAttempt.trigger === 'manual' ? '人工触发' : '计划触发'} · ${projection.lastAttempt.state}`
                : '尚无本业务日认领'}
            />
            <AutomationFact
              icon={<ShieldCheck aria-hidden="true" size={18} />}
              label="失败策略"
              value={schedulerFailureReviewLabel(projection.state)}
            />
          </div>
        )}
      </WorkbenchPanel>

      <WorkbenchPanel
        className="mission-control-retention-preview"
        description="只读扫描当前店铺证据空间。页面只接收汇总，不显示候选文件名，也不提供任何变更入口。"
        status={<span>仅预览 · 不支持删除</span>}
        title="证据保留预览"
        toolbar={(
          <button
            aria-busy={retentionLoading || undefined}
            className="workspace-button workspace-button--secondary"
            data-capability-id={STORE_AUTOMATION_CAPABILITY_IDS.retentionPreview}
            disabled={
              retentionLoading
              || running
              || needsConfig
              || !access.retentionPreview.allowed
              || !api
            }
            onClick={() => {
              const sequence = ++requestSequence.current;
              void loadRetention(storeContext, sequence, authorityKey);
            }}
            title={!access.retentionPreview.allowed
              ? schedulerOperatorMessage(
                access.retentionPreview.capability?.detail,
                '证据保留预览暂不可用，请刷新或检查运行设置。',
              )
              : undefined}
            type="button"
          >
            <ArrowsClockwise aria-hidden="true" size={16} />
            {retentionLoading ? '扫描中…' : '刷新只读预览'}
          </button>
        )}
      >
        {needsConfig ? (
          <WorkspaceState
            action={{ label: '前往 AI 与本地设置', onClick: () => navigate('settings') }}
            description={projection?.state === 'archived'
              ? '恢复当前店铺配置后，才能按其证据保留天数生成只读预览。'
              : '创建当前店铺配置并设置证据保留天数后，再生成只读预览。'}
            kind="disabled"
            title={projection?.state === 'archived' ? '运行配置已归档' : '尚无运行配置'}
          />
        ) : !access.retentionPreview.allowed ? (
          <WorkspaceState
            description="当前店铺证据保留预览不可用，请刷新或检查运行设置。"
            kind="blocked"
            title="只读预览未获授权"
          />
        ) : retentionLoading && !retention ? (
          <WorkspaceState
            description="正在按当前店铺证据保留期扫描页面截图与运行记录；不会修改文件。"
            kind="loading"
            title="正在生成只读预览"
          />
        ) : retentionError ? (
          <WorkspaceState
            action={{
              label: '重新扫描',
              onClick: () => {
                const sequence = ++requestSequence.current;
                void loadRetention(storeContext, sequence, authorityKey);
              },
            }}
            description={retentionError}
            kind="error"
            title="证据保留预览失败"
          />
        ) : retention ? (
          <>
            <div
              aria-label="证据保留只读预览摘要"
              className="mission-control-retention-metrics"
              data-blocker-count={retention.blockers.length}
              data-browser-profile-id={retention.profileId}
              data-candidate-count={retention.candidateCount}
              data-currency={retention.currency}
              data-marketplace={retention.marketplace}
              data-store-id={retention.storeId}
              role="list"
            >
              <RetentionMetric icon={<Archive aria-hidden="true" size={18} />} label="保留期" value={`${retention.retentionDays} 天`} />
              <RetentionMetric icon={<CalendarBlank aria-hidden="true" size={18} />} label="截止时间" value={new Date(retention.cutoffAt).toLocaleString()} />
              <RetentionMetric icon={<Database aria-hidden="true" size={18} />} label="候选汇总" value={`${retention.candidateCount} 项 · ${formatBytes(retention.candidateBytes)}`} />
              <RetentionMetric icon={<ShieldCheck aria-hidden="true" size={18} />} label="受保护" value={`${retention.protectedCount} 项 · 永不进入候选`} />
            </div>
            <div
              className="mission-control-retention-safety"
              data-scan-safe={retention.scanSafe}
              role={retention.blockers.length ? 'alert' : 'status'}
            >
              {retention.blockers.length ? <WarningCircle aria-hidden="true" size={20} /> : <ShieldCheck aria-hidden="true" size={20} />}
              <div>
                <strong>{retention.blockers.length ? `${retention.blockers.length} 个安全阻塞项` : '只读扫描通过安全检查'}</strong>
                <p>
                  {retention.blockers.length
                    ? '存在阻塞时诊断清单仅用于排查；当前版本始终不支持删除或应用。'
                    : '候选仅作容量规划；当前版本始终不支持删除或应用。'}
                </p>
              </div>
            </div>
            {retention.blockers.length > 0 && (
              <ul className="mission-control-retention-blockers" aria-label="证据保留阻塞项">
                {retention.blockers.map((blocker, index) => (
                  <li key={`${blocker.code}-${index}`}>
                    <span>{blocker.detail}</span>
                    <details className="mission-control-retention-blocker-diagnostics">
                      <summary>诊断详情</summary>
                      <code>{blocker.code}</code>
                      <p>{blocker.diagnosticDetail}</p>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <WorkspaceState
            description="等待当前店铺计划读取完成后生成只读汇总。"
            kind="empty"
            title="尚无证据保留预览"
          />
        )}
      </WorkbenchPanel>

      {confirmRun && projection && (
        <div className="mission-control-dialog-backdrop">
          <section
            aria-describedby="store-automation-confirm-description"
            aria-labelledby="store-automation-confirm-title"
            aria-modal="true"
            className="mission-control-dialog mission-control-dialog--confirm"
            onKeyDown={handleConfirmDialogKeyDown}
            ref={confirmDialogRef}
            role="alertdialog"
          >
            <header>
              <div>
                <span>仅当前店铺 · 立即采集</span>
                <h2 id="store-automation-confirm-title">立即触发当前店铺采集？</h2>
                <p id="store-automation-confirm-description">
                  当前店铺 · {storeContext.businessDate} ·
                  {' '}{projection.dateStart} 至 {projection.dateEnd}。系统会再次核对可见领星会话与采集口径。
                </p>
              </div>
              <button
                aria-label="关闭立即采集确认"
                className="mission-control-dialog__close"
                disabled={running}
                onClick={() => setConfirmRun(false)}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </header>
            <div className="mission-control-automation-confirm-boundary">
              <WarningCircle aria-hidden="true" size={20} />
              <p>同一店铺、业务日与采集口径一旦形成终态就不重试；调整触发时间不会绕过安全限制，只有回看窗口变化才会形成新的采集口径标识。</p>
            </div>
            <footer>
              <button
                className="workspace-button workspace-button--secondary"
                data-confirm-initial
                disabled={running}
                onClick={() => setConfirmRun(false)}
                type="button"
              >
                取消
              </button>
              <button
                aria-busy={running || undefined}
                className="workspace-button workspace-button--primary"
                data-capability-id={STORE_AUTOMATION_CAPABILITY_IDS.runNow}
                disabled={running || !runPolicy.allowed || !access.runNow.allowed}
                onClick={() => { void runNow(); }}
                type="button"
              >
                <Play aria-hidden="true" size={16} weight="fill" />
                {running ? '正在触发…' : '确认立即采集'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </PageFrame>
  );
}

function AutomationFact({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="mission-control-automation-fact" role="listitem">
      <span>{icon}</span>
      <div><small>{label}</small><strong>{value}</strong></div>
    </div>
  );
}

function RetentionMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="mission-control-retention-metric" role="listitem">
      <span>{icon}</span>
      <div><small>{label}</small><strong>{value}</strong></div>
    </div>
  );
}
