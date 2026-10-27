import { localizeDecisionAction } from '@amazon-ai-ops/business-presenters';
import type { RecommendationView } from '../types';
import { buildApprovalStampFeedback } from './approval-page';
import {
  DECISIONS_WORKSPACE_SUBVIEWS,
  normalizeDecisionsFocusHandoff,
} from './decisions-workspace-model';
import type {
  DecisionsFocusHandoff,
  DecisionsWorkspaceSubview,
} from './decisions-workspace-model';
import {
  DECISIONS_HANDOFF_STORAGE_KEY,
} from "./decisions-constants";
import {
  type DecisionsPrimaryQueueTask,
  type DecisionEligibilityContext,
} from "./decisions-contracts";
import {
  decisionEligibilitySummary,
} from "./decisions-eligibility";

export function decisionActionLabel(actionType: unknown): string {
  return localizeDecisionAction(actionType);
}

export function decisionsPrimaryQueueTask(
  row: RecommendationView | null | undefined,
): DecisionsPrimaryQueueTask | null {
  if (!row) return null;
  const objectName = decisionObjectName(row);
  const actionName = decisionActionLabel(row.actionType);

  if (row.status === 'needs_review') {
    return {
      rowId: Number(row.id),
      title: '先处理首条需人工复核建议',
      description: `${actionName} · ${objectName}。先核对真实证据与唯一 Ads 对象，再决定是否回到待审批。`,
      actionLabel: '复核首条建议与 Ads 对象',
    };
  }

  if (row.status === 'pending' && !row.evidence?.writableTarget) {
    return {
      rowId: Number(row.id),
      title: '先核验首条建议的 Ads 对象',
      description: `${actionName} · ${objectName}。先绑定当前建议对应的唯一 Ads 对象；核验不会批准建议，也不会执行 Ads。`,
      actionLabel: '核验首条 Ads 对象',
    };
  }

  if (row.status === 'pending') {
    return {
      rowId: Number(row.id),
      title: '先完成首条待审批判断',
      description: `${actionName} · ${objectName}。核对证据、对象与版本后，再显式批准或拒绝。`,
      actionLabel: '打开首条待审批建议',
    };
  }

  return {
    rowId: Number(row.id),
    title: '查看首条已决策记录',
    description: `${actionName} · ${objectName}。当前记录只读；批准不等于已经执行。`,
    actionLabel: '查看首条决定',
  };
}

export function buildDecisionsTargetBindingFeedback(
  recommendationId: number,
  targetName: string,
): ReturnType<typeof buildApprovalStampFeedback> {
  return {
    label: '仍待审批',
    title: `对象已核验 · 仍待审批 #${recommendationId}`,
    detail: `${targetName} 已写入不可覆盖的对象绑定审计；建议仍保持待审批，尚未批准，也未执行 Ads。`,
    tone: 'ready',
  };
}

export function nextDecisionsTab(
  activeSubview: DecisionsWorkspaceSubview,
  key: string,
): DecisionsWorkspaceSubview | null {
  if (key === 'Home') return DECISIONS_WORKSPACE_SUBVIEWS[0];
  if (key === 'End') return DECISIONS_WORKSPACE_SUBVIEWS[DECISIONS_WORKSPACE_SUBVIEWS.length - 1];
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;

  const currentIndex = DECISIONS_WORKSPACE_SUBVIEWS.indexOf(activeSubview);
  const delta = key === 'ArrowRight' ? 1 : -1;
  const nextIndex = (
    currentIndex + delta + DECISIONS_WORKSPACE_SUBVIEWS.length
  ) % DECISIONS_WORKSPACE_SUBVIEWS.length;
  return DECISIONS_WORKSPACE_SUBVIEWS[nextIndex];
}

export function selectDecisionsBatchHandoffRows(
  rows: readonly RecommendationView[],
  selectedIds: ReadonlySet<string>,
  context: DecisionEligibilityContext,
): RecommendationView[] {
  const unlockedContext = { ...context, locked: false };
  return rows.filter((row) => (
    row.status === 'pending'
    && selectedIds.has(String(row.id))
    && decisionEligibilitySummary(row, unlockedContext).canApprove
  ));
}

export function decisionsHandoffMatchesQuery(
  handoffQueryKey: string | null,
  currentQueryKey: string,
): boolean {
  return Boolean(handoffQueryKey && handoffQueryKey === currentQueryKey);
}

export function clearDecisionsHandoffStorage(
  storage?: Pick<Storage, 'removeItem'>,
): void {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : undefined);
    target?.removeItem(DECISIONS_HANDOFF_STORAGE_KEY);
  } catch {
    // 会话存储仅用于尽力保留兼容提示。
  }
}

export function decisionObjectName(row: RecommendationView): string {
  return row.evidence?.searchTerm
    || row.evidence?.targeting
    || row.entityName
    || '未命名对象';
}

export function decisionStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: '待处理',
    needs_review: '需复核',
    approved: '已批准',
    rejected: '已拒绝',
  };
  return labels[status] || '状态未知';
}

export function decisionRiskLabel(riskLevel: string): string {
  const normalized = String(riskLevel || '').toLowerCase();
  if (normalized === 'blocked' || normalized === 'critical' || normalized === 'forbidden') return '高风险阻断';
  if (normalized === 'high' || normalized === 'approval') return '高风险';
  if (normalized === 'medium') return '中风险';
  return '常规风险';
}

export function readDecisionsHandoff(): DecisionsFocusHandoff | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage?.getItem(DECISIONS_HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    clearDecisionsHandoffStorage();
    return normalizeDecisionsFocusHandoff(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function dispatchDecisionsSubview(subview: DecisionsWorkspaceSubview): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', {
    detail: { workspace: 'decisions', subview },
  }));
}

export function stampTargetName(row: RecommendationView): string {
  return decisionObjectName(row);
}

export function feedbackClass(tone: 'ready' | 'blocked' | 'pending'): string {
  return `decisions-feedback decisions-feedback--${tone}`;
}
