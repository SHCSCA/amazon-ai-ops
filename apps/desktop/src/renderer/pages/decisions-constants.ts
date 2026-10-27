import type { DecisionsWorkspaceStatus } from './decisions-workspace-model';

export const DECISIONS_HANDOFF_STORAGE_KEY = 'amazon-ai-ops:approval-selection';

export const DECISIONS_AUTHORITATIVE_STATUSES = [
  'pending',
  'needs_review',
  'approved',
  'rejected',
] as const satisfies readonly DecisionsWorkspaceStatus[];

export const DECISIONS_TABLE_COLUMN_DEFINITIONS = [
  { key: 'action', header: '动作', priority: 'anchor' },
  { key: 'object', header: '对象', priority: 'primary' },
  { key: 'change', header: '当前 → 建议', priority: 'primary' },
  { key: 'evidence', header: '证据', priority: 'primary' },
  { key: 'decision', header: '决策', priority: 'action' },
] as const;
