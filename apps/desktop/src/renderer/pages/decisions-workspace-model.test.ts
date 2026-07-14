import { describe, expect, it } from 'vitest';
import {
  applyDecisionsFocusHandoff,
  countDecisionsWorkspaceRows,
  decisionRiskPriority,
  decisionsWorkspaceSubviewDefinition,
  filterDecisionsWorkspaceRows,
  normalizeDecisionRisk,
  normalizeDecisionsFocusHandoff,
  normalizeDecisionsWorkspaceStatus,
  normalizeDecisionsWorkspaceSubview,
  sortDecisionsWorkspaceRows,
} from './decisions-workspace-model';

describe('normalizeDecisionsWorkspaceSubview', () => {
  it('keeps canonical subviews and falls back to recommendations', () => {
    expect(normalizeDecisionsWorkspaceSubview(' recommendations ')).toBe('recommendations');
    expect(normalizeDecisionsWorkspaceSubview('APPROVAL')).toBe('approval');
    expect(normalizeDecisionsWorkspaceSubview('decided')).toBe('decided');
    expect(normalizeDecisionsWorkspaceSubview('unknown')).toBe('recommendations');
    expect(normalizeDecisionsWorkspaceSubview(null, 'approval')).toBe('approval');
  });
});

describe('applyDecisionsFocusHandoff', () => {
  it('only promotes and focuses matching authoritative rows without injection, hiding, or authorization', () => {
    const authoritativeRows = [
      { id: 1, riskLevel: 'high', status: 'pending', cost: 30, evidence: { cost: 30 } },
      { id: 2, riskLevel: 'low', status: 'pending', cost: 10, evidence: { cost: 10 } },
      { id: 3, riskLevel: 'low', status: 'needs_review', cost: 20, evidence: { cost: 20 } },
    ];

    const result = applyDecisionsFocusHandoff(authoritativeRows, {
      ids: ['999', '2', '3'],
    });

    expect(result.focusedRowId).toBe('2');
    expect(result.matchedIds).toEqual(['2', '3']);
    expect(result.rows.map((row) => row.id)).toEqual([2, 3, 1]);
    expect(result.rows).toHaveLength(authoritativeRows.length);
    expect(new Set(result.rows)).toEqual(new Set(authoritativeRows));
    expect(result.rows.map((row) => row.status)).toEqual(['pending', 'needs_review', 'pending']);
    expect(result).not.toHaveProperty('authorizedIds');
    expect(authoritativeRows.map((row) => row.id)).toEqual([1, 2, 3]);
  });

  it('falls back to risk sorting when no handoff id matches', () => {
    const authoritativeRows = [
      { id: 1, riskLevel: 'low', status: 'pending', cost: 30, evidence: { cost: 30 } },
      { id: 2, riskLevel: 'high', status: 'approved', cost: 1, evidence: { cost: 1 } },
    ];

    expect(applyDecisionsFocusHandoff(authoritativeRows, { ids: ['999'] })).toEqual({
      rows: [authoritativeRows[1], authoritativeRows[0]],
      focusedRowId: null,
      matchedIds: [],
    });
  });
});

describe('normalizeDecisionsFocusHandoff', () => {
  it('accepts only unique scalar ids and treats the payload as a focus hint', () => {
    expect(normalizeDecisionsFocusHandoff({
      ids: [101, ' 102 ', '102', '', null, {}, Number.POSITIVE_INFINITY],
      count: 999,
      batchId: ' batch-1 ',
      authorized: true,
    })).toEqual({
      ids: ['101', '102'],
      batchId: 'batch-1',
    });
    expect(normalizeDecisionsFocusHandoff({ ids: [] })).toBeNull();
    expect(normalizeDecisionsFocusHandoff({ ids: [{ id: 101 }] })).toBeNull();
    expect(normalizeDecisionsFocusHandoff(null)).toBeNull();
  });
});

describe('sortDecisionsWorkspaceRows', () => {
  it('sorts by risk attention then evidence cost while preserving stable input order', () => {
    const rows = [
      { id: 1, riskLevel: 'low', status: 'pending', cost: 100, evidence: { cost: 20 } },
      { id: 2, riskLevel: 'low', status: 'needs_review', cost: 10, evidence: { cost: 5 } },
      { id: 3, riskLevel: 'HIGH', status: 'approved', cost: 1, evidence: { cost: 1 } },
      { id: 4, riskLevel: 'blocked', status: 'pending', cost: 10, evidence: { cost: 10 } },
      { id: 5, riskLevel: 'low', status: 'pending', cost: 100, evidence: { cost: 20 } },
      { id: 6, riskLevel: 'low', status: 'rejected', cost: 999, evidence: { cost: 999 } },
    ];

    const sorted = sortDecisionsWorkspaceRows(rows);

    expect(sorted.map((row) => row.id)).toEqual([4, 3, 2, 1, 5, 6]);
    expect(sorted[3]).toBe(rows[0]);
    expect(sorted[4]).toBe(rows[4]);
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('decisionRiskPriority', () => {
  it('orders blocked or high risk before review, pending, decided, and unsupported statuses', () => {
    expect(decisionRiskPriority({ riskLevel: 'blocked', status: 'pending' })).toBe(0);
    expect(decisionRiskPriority({ riskLevel: 'HIGH', status: 'approved' })).toBe(0);
    expect(decisionRiskPriority({ riskLevel: 'APPROVAL', status: 'rejected' })).toBe(0);
    expect(decisionRiskPriority({ riskLevel: 'medium', status: 'needs_review' })).toBe(1);
    expect(decisionRiskPriority({ riskLevel: 'low', status: 'pending' })).toBe(2);
    expect(decisionRiskPriority({ riskLevel: 'low', status: 'approved' })).toBe(3);
    expect(decisionRiskPriority({ riskLevel: 'low', status: 'rejected' })).toBe(3);
    expect(decisionRiskPriority({ riskLevel: 'low', status: 'executed' })).toBe(4);
  });
});

describe('normalizeDecisionRisk', () => {
  it('normalizes blocked and high-risk aliases without upgrading unknown values', () => {
    expect(normalizeDecisionRisk(' BLOCKED ')).toBe('blocked');
    expect(normalizeDecisionRisk('critical')).toBe('blocked');
    expect(normalizeDecisionRisk('HIGH')).toBe('high');
    expect(normalizeDecisionRisk('APPROVAL')).toBe('high');
    expect(normalizeDecisionRisk('medium')).toBe('normal');
    expect(normalizeDecisionRisk(undefined)).toBe('normal');
  });

  it('treats real forbidden risk values as blocked regardless of case', () => {
    expect(normalizeDecisionRisk('FORBIDDEN')).toBe('blocked');
    expect(normalizeDecisionRisk(' forbidden ')).toBe('blocked');

    const rows = [
      { id: 1, riskLevel: 'low', status: 'needs_review', cost: 999 },
      { id: 2, riskLevel: 'FORBIDDEN', status: 'approved', cost: 10 },
      { id: 3, riskLevel: 'forbidden', status: 'rejected', cost: 10 },
      { id: 4, riskLevel: 'low', status: 'pending', cost: 1_000 },
    ];

    expect(sortDecisionsWorkspaceRows(rows).map((row) => row.id)).toEqual([2, 3, 1, 4]);
  });
});

describe('normalizeDecisionsWorkspaceStatus', () => {
  it('normalizes only statuses represented by the decisions workspace', () => {
    expect(normalizeDecisionsWorkspaceStatus(' NEEDS_REVIEW ')).toBe('needs_review');
    expect(normalizeDecisionsWorkspaceStatus('approved')).toBe('approved');
    expect(normalizeDecisionsWorkspaceStatus('executed')).toBeNull();
    expect(normalizeDecisionsWorkspaceStatus('expired')).toBeNull();
    expect(normalizeDecisionsWorkspaceStatus(null)).toBeNull();
  });
});

describe('countDecisionsWorkspaceRows', () => {
  it('counts each canonical context without partitioning overlapping pending rows', () => {
    const rows = [
      { status: 'pending' },
      { status: 'needs_review' },
      { status: 'approved' },
      { status: 'rejected' },
      { status: 'executed' },
    ];

    expect(countDecisionsWorkspaceRows(rows)).toEqual({
      recommendations: 2,
      approval: 1,
      decided: 2,
    });
  });
});

describe('filterDecisionsWorkspaceRows', () => {
  it('keeps pending in both decision contexts and limits decided to approved or rejected', () => {
    const rows = [
      { id: 1, status: 'pending' },
      { id: 2, status: 'needs_review' },
      { id: 3, status: 'approved' },
      { id: 4, status: 'rejected' },
      { id: 5, status: 'executed' },
      { id: 6, status: 'expired' },
    ];

    expect(filterDecisionsWorkspaceRows(rows, 'recommendations').map((row) => row.id)).toEqual([1, 2]);
    expect(filterDecisionsWorkspaceRows(rows, 'approval').map((row) => row.id)).toEqual([1]);
    expect(filterDecisionsWorkspaceRows(rows, 'decided').map((row) => row.id)).toEqual([3, 4]);
    expect(rows).toHaveLength(6);
  });
});

describe('decisionsWorkspaceSubviewDefinition', () => {
  it('defines canonical labels, descriptions, statuses, and read-only behavior', () => {
    expect(decisionsWorkspaceSubviewDefinition('recommendations')).toEqual({
      label: '待判断',
      description: '查看待判断与需复核建议，形成是否送审的判断。',
      statuses: ['pending', 'needs_review'],
      readOnly: false,
    });
    expect(decisionsWorkspaceSubviewDefinition('approval')).toEqual({
      label: '待审批',
      description: '逐条确认可批准动作；批准不等于执行。',
      statuses: ['pending'],
      readOnly: false,
    });
    expect(decisionsWorkspaceSubviewDefinition('decided')).toEqual({
      label: '已决策',
      description: '只读查看已批准与已拒绝结果；批准不等于执行。',
      statuses: ['approved', 'rejected'],
      readOnly: true,
    });
  });
});
