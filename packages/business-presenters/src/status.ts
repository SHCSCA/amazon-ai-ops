import { normalizeToken } from './normalize-token';

/**
 * Status taxonomy used by recommendations, actions, and experiments.
 * `waiting_approval` and `pending_review` intentionally collapse to the
 * same label to match the operator-facing copy on the decisions workspace.
 */
export type StatusToken =
  | 'waiting_approval'
  | 'pending_review'
  | 'pending_approval'
  | 'approved'
  | 'executed'
  | 'rejected'
  | 'superseded';

const STATUS_LABELS: Readonly<Record<StatusToken, string>> = Object.freeze({
  waiting_approval: '待判断',
  pending_review: '待判断',
  pending_approval: '待审批',
  approved: '许可已签发',
  executed: '已执行',
  rejected: '已拒绝',
  superseded: '已替代',
});

const DEFAULT_STATUS_LABEL = '待处理';

/**
 * Localize a status token to its Chinese label.
 *
 * Unknown or empty tokens return "待处理" so cells stay non-blank.
 */
export function localizeStatus(value: unknown): string {
  const normalized = normalizeToken(value) as StatusToken | '';
  if (!normalized) return DEFAULT_STATUS_LABEL;
  return STATUS_LABELS[normalized] ?? DEFAULT_STATUS_LABEL;
}

export const STATUS_LABEL_TABLE: Readonly<Record<StatusToken, string>> = STATUS_LABELS;
export { DEFAULT_STATUS_LABEL };
