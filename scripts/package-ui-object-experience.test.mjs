import {
  describe,
  expect,
  it,
  validateObjectWorkspaceExperienceEvidence,
} from './package-ui-test-context.mjs';

describe('package object-workspace experience contract', () => {
  function validObjectMetrics(minFullyVisibleRows = 5) {
    return {
      contract: { passed: true, violations: [] },
      experience: {
        contract: { maxRenderedRows: 30, minAriaRowCount: 1, minFullyVisibleRows },
        enabled: true,
        initial: {
          ariaRowCount: 100,
          fullyVisibleRowCount: minFullyVisibleRows,
          renderedRowCount: 18,
          rowIndexes: Array.from({ length: 18 }, (_, index) => index),
          rowKeysUnique: true,
        },
        probe: {
          pageScrollLeakPx: 0,
          renderedRowCount: 19,
          restoredScrollTop: 0,
          rowKeysUnique: true,
          virtualWindowAdvanced: true,
        },
      },
    };
  }

  it('accepts the shared queue experience evidence only after the virtual window is restored and AI state is recorded', () => {
    const aiRunState = {
      ariaBusy: false,
      observed: true,
      statusLabel: '最近成功',
      text: 'AI 阶段分析已完成 · 使用真实广告数据 最近成功',
      tone: 'confirmed',
    };
    expect(validateObjectWorkspaceExperienceEvidence({
      aiRunState,
      capacity: { allRowsFit: false, ariaRowCount: 100, scrollable: true, visibleRowCapacity: 5 },
      metrics: validObjectMetrics(),
      requiredVisibleCapacity: 5,
      workspace: 'diagnosis',
    })).toEqual({
      aiRunState,
      capacity: { allRowsFit: false, ariaRowCount: 100, scrollable: true, visibleRowCapacity: 5 },
      contract: { maxRenderedRows: 30, minAriaRowCount: 1, minFullyVisibleRows: 5 },
      metrics: validObjectMetrics(),
      passed: true,
      probeApplicability: { applicable: true, passed: true, reason: 'scrollable-dataset' },
      requiredVisibleCapacity: 5,
      restored: true,
      rowCountCredible: true,
      violations: [],
      workspace: 'diagnosis',
    });
  });

  it('accepts a three-row product queue when the viewport proves five-row capacity and marks scroll probes not applicable', () => {
    const metrics = validObjectMetrics(3);
    metrics.contract = {
      passed: false,
      violations: [
        { code: 'QUEUE_VIRTUAL_WINDOW_STALE' },
        { code: 'QUEUE_SCROLL_OWNER' },
        { code: 'QUEUE_STICKY_HEADER' },
        { code: 'QUEUE_SCROLL_LEAK' },
      ],
    };
    metrics.experience.initial = {
      ariaRowCount: 3,
      fullyVisibleRowCount: 3,
      renderedRowCount: 3,
      rowIndexes: [0, 1, 2],
      rowKeysUnique: true,
    };
    metrics.experience.probe = {
      pageScrollLeakPx: 0,
      renderedRowCount: 3,
      restoredScrollTop: 0,
      rowKeysUnique: true,
      virtualWindowAdvanced: false,
    };
    const result = validateObjectWorkspaceExperienceEvidence({
      aiRunState: { observed: false, text: '' },
      capacity: { allRowsFit: true, ariaRowCount: 3, scrollable: false, visibleRowCapacity: 5 },
      metrics,
      requiredVisibleCapacity: 5,
      workspace: 'product',
    });
    expect(result.passed).toBe(true);
    expect(result.probeApplicability).toEqual({ applicable: false, passed: true, reason: 'short-dataset' });
    expect(result.restored).toBe(null);
    expect(result.rowCountCredible).toBe(true);
  });

  it.each([
    ['shared collector failure', { metrics: { ...validObjectMetrics(), contract: { passed: false, violations: [{ code: 'QUEUE_STICKY_HEADER' }] } } }, 'OBJECT_WORKSPACE_EXPERIENCE_CONTRACT'],
    ['scroll restoration failure', { metrics: { ...validObjectMetrics(), experience: { ...validObjectMetrics().experience, probe: { ...validObjectMetrics().experience.probe, restoredScrollTop: 42 } } } }, 'OBJECT_WORKSPACE_SCROLL_NOT_RESTORED'],
    ['missing diagnosis AI state', { aiRunState: { observed: false, text: '' } }, 'DIAGNOSIS_AI_STATE_MISSING'],
  ])('fails closed for %s', (_label, override, code) => {
    const result = validateObjectWorkspaceExperienceEvidence({
      aiRunState: { observed: true, text: '当前 AI 状态' },
      capacity: { allRowsFit: false, ariaRowCount: 100, scrollable: true, visibleRowCapacity: 5 },
      metrics: validObjectMetrics(),
      requiredVisibleCapacity: 5,
      workspace: 'diagnosis',
      ...override,
    });
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });

  it('rejects a short queue whose measured row viewport cannot hold the required compact capacity', () => {
    const metrics = validObjectMetrics(3);
    metrics.experience.initial.ariaRowCount = 3;
    metrics.experience.initial.renderedRowCount = 3;
    metrics.experience.initial.rowIndexes = [0, 1, 2];
    const result = validateObjectWorkspaceExperienceEvidence({
      aiRunState: { observed: false, text: '' },
      capacity: { allRowsFit: false, ariaRowCount: 3, scrollable: false, visibleRowCapacity: 4 },
      metrics,
      requiredVisibleCapacity: 5,
      workspace: 'product',
    });
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'QUEUE_CAPACITY_INSUFFICIENT' }),
    ]));
  });
});
