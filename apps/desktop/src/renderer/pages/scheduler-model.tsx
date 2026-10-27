

import { type MissionControlCapabilityProjection, type StoreCollectionScheduleProjection, type StoreCollectionScheduleRunResult, type StoreCollectionScheduleState, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { type WorkspaceTone } from '../components/workspace';
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

// 只保留 Main 返回的安全汇总，候选与受保护文件名不得进入组件状态或 DOM。
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

export interface RawStoreEvidenceRetentionManifest {
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

export const SCHEDULE_STATES = new Set<StoreCollectionScheduleState>(
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

export const SCHEDULER_INTERNAL_OPERATOR_COPY = /\b(?:Main|StoreContext|Authority|Renderer|Profile|Mission|Experiment|UNKNOWN|revision|draft|set_keyword_bid|manifest|fingerprint|dry-run|CRUD|PRODUCTION_NATIVE|PROTOTYPE_ONLY|LEGACY_ADAPTER|sequence|append-only|correction|DECISION|ACTION|READBACK|EFFECT)\b/i;

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

export function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

export function validTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return Boolean(value && Number.isFinite(timestamp));
}

export function validateScheduleProjection(
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

export function stateTone(state?: StoreCollectionScheduleState): WorkspaceTone {
  if (state === 'succeeded') return 'confirmed';
  if (state === 'failed' || state === 'archived') return 'blocked';
  if (state === 'due' || state === 'claimed' || state === 'not_configured') return 'attention';
  return 'neutral';
}

export function stateLabel(state?: StoreCollectionScheduleState): string {
  return STORE_AUTOMATION_STATES.find((item) => item.state === state)?.label ?? '等待读取';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function taskCopy(
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
