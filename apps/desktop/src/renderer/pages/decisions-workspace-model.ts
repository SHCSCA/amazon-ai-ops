import type { RecommendationView } from '../types';

export const DECISIONS_WORKSPACE_SUBVIEWS = ['recommendations', 'approval', 'decided'] as const;

export type DecisionsWorkspaceSubview = (typeof DECISIONS_WORKSPACE_SUBVIEWS)[number];
export type DecisionsWorkspaceStatus = 'pending' | 'needs_review' | 'approved' | 'rejected';
export type DecisionRisk = 'blocked' | 'high' | 'normal';
export type DecisionsWorkspaceSortableRow = Pick<RecommendationView, 'riskLevel' | 'status' | 'cost'> & {
  evidence?: { cost?: number };
};
export type DecisionsWorkspaceAuthoritativeRow = DecisionsWorkspaceSortableRow & Pick<RecommendationView, 'id'>;
export type DecisionsFocusHandoff = {
  ids: string[];
  batchId?: string;
};

export type DecisionsWorkspaceSubviewDefinition = {
  label: string;
  description: string;
  statuses: readonly DecisionsWorkspaceStatus[];
  readOnly: boolean;
};

const DECISIONS_WORKSPACE_SUBVIEW_SET = new Set<string>(DECISIONS_WORKSPACE_SUBVIEWS);
const DECISIONS_WORKSPACE_STATUS_SET = new Set<string>([
  'pending',
  'needs_review',
  'approved',
  'rejected',
] satisfies DecisionsWorkspaceStatus[]);
const DECISIONS_WORKSPACE_SUBVIEW_DEFINITIONS = {
  recommendations: {
    label: '待判断',
    description: '查看待判断与需复核建议，形成是否送审的判断。',
    statuses: ['pending', 'needs_review'],
    readOnly: false,
  },
  approval: {
    label: '待审批',
    description: '逐条确认可批准动作；批准不等于执行。',
    statuses: ['pending'],
    readOnly: false,
  },
  decided: {
    label: '已决策',
    description: '只读查看已批准与已拒绝结果；批准不等于执行。',
    statuses: ['approved', 'rejected'],
    readOnly: true,
  },
} as const satisfies Record<DecisionsWorkspaceSubview, DecisionsWorkspaceSubviewDefinition>;

export function normalizeDecisionsWorkspaceSubview(
  value: unknown,
  fallback: DecisionsWorkspaceSubview = 'recommendations',
): DecisionsWorkspaceSubview {
  const normalized = String(value ?? '').trim().toLowerCase();
  return DECISIONS_WORKSPACE_SUBVIEW_SET.has(normalized)
    ? normalized as DecisionsWorkspaceSubview
    : fallback;
}

export function decisionsWorkspaceSubviewDefinition(
  subview: DecisionsWorkspaceSubview,
): DecisionsWorkspaceSubviewDefinition {
  return DECISIONS_WORKSPACE_SUBVIEW_DEFINITIONS[subview];
}

export function normalizeDecisionsWorkspaceStatus(value: unknown): DecisionsWorkspaceStatus | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return DECISIONS_WORKSPACE_STATUS_SET.has(normalized)
    ? normalized as DecisionsWorkspaceStatus
    : null;
}

export function normalizeDecisionRisk(value: unknown): DecisionRisk {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'blocked' || normalized === 'critical' || normalized === 'forbidden') {
    return 'blocked';
  }
  if (normalized === 'high' || normalized === 'approval') return 'high';
  return 'normal';
}

export function decisionRiskPriority(
  row: Pick<RecommendationView, 'riskLevel' | 'status'>,
): 0 | 1 | 2 | 3 | 4 {
  if (normalizeDecisionRisk(row.riskLevel) !== 'normal') return 0;
  const status = normalizeDecisionsWorkspaceStatus(row.status);
  if (status === 'needs_review') return 1;
  if (status === 'pending') return 2;
  if (status === 'approved' || status === 'rejected') return 3;
  return 4;
}

function decisionEvidenceCost(row: DecisionsWorkspaceSortableRow): number {
  const cost = Number(row.evidence?.cost ?? row.cost ?? 0);
  return Number.isFinite(cost) ? cost : 0;
}

export function sortDecisionsWorkspaceRows<T extends DecisionsWorkspaceSortableRow>(
  rows: readonly T[],
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const priorityDelta = decisionRiskPriority(left.row) - decisionRiskPriority(right.row);
      if (priorityDelta !== 0) return priorityDelta;
      const costDelta = decisionEvidenceCost(right.row) - decisionEvidenceCost(left.row);
      if (costDelta !== 0) return costDelta;
      return left.index - right.index;
    })
    .map(({ row }) => row);
}

function normalizeHandoffId(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function normalizeDecisionsFocusHandoff(value: unknown): DecisionsFocusHandoff | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { ids?: unknown; batchId?: unknown };
  const ids = Array.isArray(record.ids)
    ? Array.from(new Set(record.ids.map(normalizeHandoffId).filter((id): id is string => id !== null)))
    : [];
  if (!ids.length) return null;
  const batchId = typeof record.batchId === 'string' ? record.batchId.trim() : '';
  return {
    ids,
    ...(batchId ? { batchId } : {}),
  };
}

export function applyDecisionsFocusHandoff<T extends DecisionsWorkspaceAuthoritativeRow>(
  authoritativeRows: readonly T[],
  handoff: DecisionsFocusHandoff | null,
): { rows: T[]; focusedRowId: string | null; matchedIds: string[] } {
  const riskSortedRows = sortDecisionsWorkspaceRows(authoritativeRows);
  if (!handoff) return { rows: riskSortedRows, focusedRowId: null, matchedIds: [] };

  const authoritativeIds = new Set(riskSortedRows.map((row) => String(row.id)));
  const matchedIds = Array.from(new Set(handoff.ids.filter((id) => authoritativeIds.has(id))));
  if (!matchedIds.length) return { rows: riskSortedRows, focusedRowId: null, matchedIds: [] };

  const handoffRank = new Map(matchedIds.map((id, index) => [id, index]));
  const rows = riskSortedRows
    .map((row, index) => ({ row, index, rank: handoffRank.get(String(row.id)) }))
    .sort((left, right) => {
      if (left.rank !== undefined && right.rank !== undefined) return left.rank - right.rank;
      if (left.rank !== undefined) return -1;
      if (right.rank !== undefined) return 1;
      return left.index - right.index;
    })
    .map(({ row }) => row);

  return { rows, focusedRowId: matchedIds[0], matchedIds };
}

export function filterDecisionsWorkspaceRows<T extends Pick<RecommendationView, 'status'>>(
  rows: readonly T[],
  subview: DecisionsWorkspaceSubview,
): T[] {
  const allowedStatuses = decisionsWorkspaceSubviewDefinition(subview).statuses;
  return rows.filter((row) => {
    const status = normalizeDecisionsWorkspaceStatus(row.status);
    return status !== null && allowedStatuses.includes(status);
  });
}

export function countDecisionsWorkspaceRows<T extends Pick<RecommendationView, 'status'>>(
  rows: readonly T[],
): Record<DecisionsWorkspaceSubview, number> {
  return {
    recommendations: filterDecisionsWorkspaceRows(rows, 'recommendations').length,
    approval: filterDecisionsWorkspaceRows(rows, 'approval').length,
    decided: filterDecisionsWorkspaceRows(rows, 'decided').length,
  };
}
