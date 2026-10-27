import type { RecommendationView } from '../types';
import { runWorkflowInvalidatingMutation } from '../workflow-invalidation';
import type { WorkflowEventTarget } from '../workflow-invalidation';
import { type ApprovalQueueExitState } from "./approval-contracts";

export function runApprovalWorkflowMutation<T>(
  decision: 'approve' | 'reject',
  task: () => Promise<T>,
  target?: WorkflowEventTarget,
  canInvalidate?: () => boolean,
): Promise<T> {
  return runWorkflowInvalidatingMutation(
    decision === 'approve' ? 'approval-approved' : 'approval-rejected',
    task,
    target,
    canInvalidate,
  );
}

export function approvalRowsAfterDecision(rows: RecommendationView[], recommendationId: number): RecommendationView[] {
  return rows.filter((row) => row.id !== recommendationId);
}

export function approvalDecisionFocusReturnTarget<T>(
  trigger: T | null,
  completedDecisionTarget: T | null,
): T | null {
  return completedDecisionTarget ?? trigger;
}

export function buildRecommendationDecisionRequest(
  recommendation: Pick<RecommendationView, 'id' | 'revision'>,
  decision: Record<string, unknown>,
) {
  return {
    id: recommendation.id,
    expectedRevision: recommendation.revision,
    decision,
  };
}

export function refreshedApprovalSelection(
  current: RecommendationView | null,
  refreshedRows: RecommendationView[],
): RecommendationView | null {
  if (!current) return null;
  return refreshedRows.find((row) => row.id === current.id) ?? null;
}

export function approvalQueueRowClass(row: RecommendationView, exiting: ApprovalQueueExitState): string {
  if (!exiting || row.id !== exiting.id) return '';
  return `approval-row-exiting approval-row-exiting-${exiting.decision}`;
}

export function parseApprovalSelectionIntent(value: unknown): {
  ids: string[];
  count: number;
  batchId?: string;
} | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { ids?: unknown; count?: unknown; batchId?: unknown };
  const ids = Array.isArray(record.ids)
    ? Array.from(new Set(record.ids.map((id) => String(id || '').trim()).filter(Boolean)))
    : [];
  if (!ids.length) return null;
  return {
    ids,
    count: Math.max(ids.length, Number(record.count || ids.length) || ids.length),
    batchId: typeof record.batchId === 'string' ? record.batchId : undefined,
  };
}
