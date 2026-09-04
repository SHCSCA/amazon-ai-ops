/**
 * Entity delete policy — centralized policy selector for "remove / archive / void /
 * forbid" actions across mission control workspaces.
 *
 * The function is a pure, side-effect-free selector. It does not touch IPC, DB, or
 * global state. Each workspace still owns its confirm dialog and busy state; this
 * module only decides what kind of operation is allowed, why, and what label the
 * primary button should show.
 *
 * Modes:
 * - `forbidden`     — the entity must never be removed from the renderer; explain why.
 * - `archive`       — soft-delete; the entity hides from default lists but stays
 *                     recoverable.
 * - `void`          — recorded as a "voided" entry on the timeline; the entity's
 *                     status changes but historical context is preserved.
 * - `hard-delete`   — only allowed when no downstream entity references the record.
 *
 * The matrix is intentionally strict: anything we cannot prove is reversible (audit
 * entries, evidence, decisions, executions, readback) starts in `forbidden`. UI
 * callers should treat `forbidden` as "do not render a destructive primary action";
 * they should still render the entity and explain why it cannot be removed.
 */

export type EntityDeleteMode = 'forbidden' | 'archive' | 'void' | 'hard-delete';

export interface EntityDeletePolicy {
  /** What kind of removal is allowed. */
  readonly mode: EntityDeleteMode;
  /** Operator-facing explanation shown next to the action. */
  readonly reason: string;
  /** Primary button label when the action is allowed. */
  readonly buttonLabel: string;
  /** Optional aria-label override; defaults to buttonLabel. */
  readonly ariaLabel?: string;
  /** Optional short tone for status pills (kept loose to avoid coupling). */
  readonly tone?: 'danger' | 'warning' | 'neutral';
}

export interface EntityDeleteContext {
  /** The entity has been referenced by another active record (decision, mission, etc). */
  hasReferences?: boolean;
  /** The entity already has at least one immutable version snapshot. */
  hasVersions?: boolean;
  /** The entity has recorded execution / observation history. */
  hasRuns?: boolean;
  /** The entity is a historical snapshot retained only for reconciliation. */
  isHistorical?: boolean;
  /** Caller-provided override for the operator-facing reason. */
  reasonOverride?: string;
  /** Caller-provided override for the primary button label. */
  buttonLabelOverride?: string;
}

/**
 * Entity types currently recognised by the policy matrix. Workspace callers pass
 * the most specific entity type they can identify. Unknown entity types fall back
 * to `archive` (the safest default — no irreversible loss without explicit UI).
 */
export type SupportedEntityType =
  | 'experiment'
  | 'experiment-observation'
  | 'mission'
  | 'mission-grant'
  | 'mission-decision'
  | 'policy'
  | 'policy-version'
  | 'execution-batch'
  | 'execution-job'
  | 'readback'
  | 'evidence'
  | 'audit-entry'
  | 'listing-version'
  | 'listing-draft'
  | 'product'
  | 'ad-object'
  | 'operation-event'
  | 'causal-event'
  | 'schedule'
  | 'schedule-run'
  | 'store-runtime-config'
  | 'store';

const FORBIDDEN_REASON =
  '权威与审计对象不可在界面物理删除；归档、撤稿或追加修正保持历史完整。';
const ARCHIVE_REASON =
  '默认使用可恢复归档：隐藏于默认列表，历史与因果链继续保留。';
const VOID_REASON =
  '作废会在时间轴留下解释链，原记录不被删除。';

const BASE_MATRIX: Record<SupportedEntityType, EntityDeletePolicy> = {
  // ---- Forbidden: anything tied to authority / audit / evidence ----
  experiment: {
    mode: 'forbidden',
    reason: FORBIDDEN_REASON,
    buttonLabel: '归档当前实验',
    ariaLabel: '归档当前实验',
    tone: 'warning',
  },
  'experiment-observation': {
    mode: 'forbidden',
    reason: FORBIDDEN_REASON,
    buttonLabel: '追加修正观察',
    tone: 'warning',
  },
  mission: {
    mode: 'forbidden',
    reason: FORBIDDEN_REASON,
    buttonLabel: '归档当前任务',
    ariaLabel: '归档当前任务',
    tone: 'warning',
  },
  'mission-grant': {
    mode: 'forbidden',
    reason: FORBIDDEN_REASON,
    buttonLabel: '撤稿当前授权',
    tone: 'warning',
  },
  'mission-decision': {
    mode: 'forbidden',
    reason: FORBIDDEN_REASON,
    buttonLabel: '撤稿当前决议',
    tone: 'warning',
  },
  policy: {
    mode: 'forbidden',
    reason: FORBIDDEN_REASON,
    buttonLabel: '归档当前策略',
    tone: 'warning',
  },
  'policy-version': {
    mode: 'forbidden',
    reason: FORBIDDEN_REASON,
    buttonLabel: '停用当前版本',
    tone: 'warning',
  },
  'execution-batch': {
    mode: 'forbidden',
    reason: FORBIDDEN_REASON,
    buttonLabel: '归档当前批次',
    tone: 'warning',
  },
  'execution-job': {
    mode: 'forbidden',
    reason: FORBIDDEN_REASON,
    buttonLabel: '撤稿当前对象',
    tone: 'warning',
  },
  readback: {
    mode: 'forbidden',
    reason: FORBIDDEN_REASON,
    buttonLabel: '作废当前回读',
    tone: 'warning',
  },
  evidence: {
    mode: 'forbidden',
    reason: FORBIDDEN_REASON,
    buttonLabel: '作废当前证据',
    tone: 'warning',
  },
  'audit-entry': {
    mode: 'forbidden',
    reason: FORBIDDEN_REASON,
    buttonLabel: '追加修正记录',
    tone: 'warning',
  },
  'listing-version': {
    mode: 'forbidden',
    reason: FORBIDDEN_REASON,
    buttonLabel: '停用当前版本',
    tone: 'warning',
  },
  // ---- Void: timeline-visible but reversible through status ----
  'listing-draft': {
    mode: 'void',
    reason: VOID_REASON,
    buttonLabel: '归档当前草稿',
    tone: 'warning',
  },
  'operation-event': {
    mode: 'void',
    reason: VOID_REASON,
    buttonLabel: '归档当前事件',
    ariaLabel: '归档当前事件',
    tone: 'warning',
  },
  'causal-event': {
    mode: 'forbidden',
    reason: FORBIDDEN_REASON,
    buttonLabel: '追加修正因果记录',
    tone: 'warning',
  },
  'schedule-run': {
    mode: 'forbidden',
    reason: FORBIDDEN_REASON,
    buttonLabel: '归档当前运行',
    tone: 'warning',
  },
  // ---- Archive: soft-delete (recoverable) ----
  product: {
    mode: 'archive',
    reason: ARCHIVE_REASON,
    buttonLabel: '归档当前产品',
    ariaLabel: '归档当前产品',
    tone: 'warning',
  },
  'ad-object': {
    mode: 'archive',
    reason: ARCHIVE_REASON,
    buttonLabel: '归档当前对象',
    tone: 'warning',
  },
  'store-runtime-config': {
    mode: 'archive',
    reason: ARCHIVE_REASON,
    buttonLabel: '归档当前运行配置',
    tone: 'warning',
  },
  store: {
    mode: 'archive',
    reason: ARCHIVE_REASON,
    buttonLabel: '归档当前店铺',
    tone: 'warning',
  },
  // ---- Hard-delete allowed only when no history exists ----
  schedule: {
    mode: 'hard-delete',
    reason: '未运行的任务可物理删除。',
    buttonLabel: '删除当前任务',
    tone: 'danger',
  },
};

/**
 * Resolve the delete policy for an entity. Always returns a policy, even for
 * unknown entity types (defaults to `archive`). Callers can pass an optional
 * `reasonOverride` / `buttonLabelOverride` to surface contextual copy (e.g. an
 * entity-specific aria-label) without re-implementing the matrix.
 */
export function selectEntityDeletePolicy(
  entityType: SupportedEntityType | string,
  ctx: EntityDeleteContext = {},
): EntityDeletePolicy {
  const base = BASE_MATRIX[entityType as SupportedEntityType] ?? {
    mode: 'archive' as EntityDeleteMode,
    reason: ARCHIVE_REASON,
    buttonLabel: '归档当前记录',
    tone: 'warning' as const,
  };

  // Historical reconciliation snapshots are always read-only — never archive.
  if (ctx.isHistorical) {
    return {
      mode: 'forbidden',
      reason: '历史快照仅供对账，禁止编辑或删除。',
      buttonLabel: '历史快照不可删除',
      ariaLabel: '历史快照不可删除',
      tone: 'neutral',
    };
  }

  // Listings drafts: if any version exists, the draft itself must stay (so the
  // history is still traceable back to its origin). Void becomes the right call.
  if (entityType === 'listing-draft' && ctx.hasVersions) {
    return {
      mode: 'archive',
      reason: '草稿已生成版本，归档保留解释链。',
      buttonLabel: '归档当前草稿',
      tone: 'warning',
    };
  }

  // Schedule: history-aware hard-delete.
  if (entityType === 'schedule') {
    if (ctx.hasRuns) {
      return {
        mode: 'archive',
        reason: '任务已有运行历史，归档保留记录。',
        buttonLabel: '归档当前任务',
        tone: 'warning',
      };
    }
    return {
      mode: 'hard-delete',
      reason: '尚无运行记录，可物理删除。',
      buttonLabel: '删除当前任务',
      tone: 'danger',
    };
  }

  // Anything referencing a downstream entity should never hard-delete.
  if (ctx.hasReferences && base.mode !== 'forbidden') {
    return {
      ...base,
      reason: '已被下游业务引用，只能归档或追加修正。',
    };
  }

  return {
    ...base,
    ...(ctx.reasonOverride ? { reason: ctx.reasonOverride } : {}),
    ...(ctx.buttonLabelOverride ? { buttonLabel: ctx.buttonLabelOverride } : {}),
  };
}

/** Convenience predicate for callers that only need "is this deletable?". */
export function isEntityRemovable(policy: EntityDeletePolicy): boolean {
  return policy.mode !== 'forbidden';
}

/** Convenience predicate for callers that want to render a danger-class button. */
export function isEntityDestructive(policy: EntityDeletePolicy): boolean {
  return policy.mode === 'hard-delete';
}
