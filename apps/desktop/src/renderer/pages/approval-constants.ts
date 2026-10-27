import { type ApprovalTab } from "./approval-contracts";

export const APPROVAL_SELECTION_STORAGE_KEY = 'amazon-ai-ops:approval-selection';

export const APPROVAL_QUEUE_EXIT_ANIMATION_MS = 180;

export const TAB_LABELS: Record<ApprovalTab, string> = {
  pending: '待审批',
  needs_review: '复核队列',
  approved: '已批准待执行',
  rejected: '已拒绝',
};
