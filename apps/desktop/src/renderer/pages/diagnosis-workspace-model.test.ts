import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildDiagnosisQueueRows,
  buildDiagnosisWorkspaceModel,
  diagnosisQueueObjectKey,
} from './diagnosis-workspace-model';

describe('diagnosis queue model', () => {
  it('builds a stable object key from authority identity instead of mutable metrics', () => {
    const identity = {
      portfolioName: ' Core ',
      campaignName: 'Campaign A',
      adGroupName: 'Group A',
      asin: 'b0test',
      objectType: 'search_term',
      objectName: 'Door Lock',
    };

    expect(diagnosisQueueObjectKey({ ...identity, spend: 10 })).toBe(
      diagnosisQueueObjectKey({ ...identity, spend: 99, orders: 3 }),
    );
    expect(diagnosisQueueObjectKey(identity)).not.toBe(diagnosisQueueObjectKey({
      ...identity,
      objectName: 'Door Lock Exact',
    }));
  });

  it('orders rows by review priority with a deterministic identity tie-breaker', () => {
    const rows = buildDiagnosisQueueRows([
      { objectName: 'zeta', spend: 10 },
      { objectName: 'alpha', spend: 20 },
      { objectName: 'beta', spend: 20 },
    ], (row) => Number(row.spend || 0));

    expect(rows.map((entry) => entry.diagnostic.objectName)).toEqual(['alpha', 'beta', 'zeta']);
    expect(new Set(rows.map((entry) => entry.key)).size).toBe(3);
  });

  it('keeps same-label objects from different report identities as separate queue rows', () => {
    const sharedDisplayIdentity = {
      campaignName: 'Campaign A',
      adGroupName: 'Group A',
      asin: 'B0TEST',
      objectType: 'search_term',
      objectName: 'door lock',
    };
    const rows = buildDiagnosisQueueRows([
      { ...sharedDisplayIdentity, objectKey: 'B0TEST|campaign a|group a|user_search_term|search_term|door lock' },
      { ...sharedDisplayIdentity, objectKey: 'B0TEST|campaign a|group a|keyword|search_term|door lock' },
    ], () => 1);

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((entry) => entry.key)).size).toBe(2);
    expect(rows.every((entry) => entry.key.includes('object-key'))).toBe(true);
  });
});

describe('buildDiagnosisWorkspaceModel', () => {
  it('keeps formal diagnosis blocked until all 8 report types are imported', () => {
    const model = buildDiagnosisWorkspaceModel({
      realReportCount: 4,
      requiredReportCount: 8,
      importedReportTypeCount: 4,
      importedRowCount: 512,
      hasImportedMetrics: true,
      recommendationGateIssues: ['当前范围只完成 4/8 类真实广告报表，需补齐 8 类后才能生成正式建议'],
      diagnosticCount: 12,
    });

    expect(model.canDiagnose).toBe(false);
    expect(model.formalRecommendationsLocked).toBe(true);
    expect(model.primaryAction).toMatchObject({
      label: '去数据采集',
      target: 'data-collection',
      disabled: false,
    });
    expect(model.readinessDetail).toContain('4/8');
    expect(model.readinessDetail).toContain('正式诊断保持阻断');
  });

  it('blocks diagnosis when all files exist but per-type imports remain incomplete', () => {
    const model = buildDiagnosisWorkspaceModel({
      realReportCount: 8,
      requiredReportCount: 8,
      importedReportTypeCount: 5,
      importedRowCount: 1879,
      hasImportedMetrics: true,
      recommendationGateIssues: ['仅有 5/8 类真实报表形成 DB 日级指标'],
      diagnosticCount: 3,
    });

    expect(model.canDiagnose).toBe(false);
    expect(model.readinessDetail).toContain('5/8 类已逐类入库');
    expect(model.primaryAction).toEqual({
      label: '补齐逐类入库',
      target: 'data-import-validation',
      disabled: false,
    });
  });

  it('never presents a scope-level AI summary as the selected object explanation', () => {
    const model = buildDiagnosisWorkspaceModel({
      realReportCount: 8,
      requiredReportCount: 8,
      importedReportTypeCount: 8,
      importedRowCount: 1024,
      hasImportedMetrics: true,
      recommendationGateIssues: [],
      diagnosticCount: 3,
      selectedObject: {
        name: 'door lock exact',
        diagnosis: '该搜索词 ACOS 偏高，建议人工复核出价。',
      },
      scopeAiSummary: '当前范围处于关键词探索阶段。',
    });

    expect(model.selectedObjectExplanation).toEqual({
      label: '当前对象诊断',
      objectName: 'door lock exact',
      text: '该搜索词 ACOS 偏高，建议人工复核出价。',
    });
    expect(model.scopeAiSummary).toEqual({
      label: '范围级 AI 总结',
      text: '当前范围处于关键词探索阶段。',
      caveat: '描述整个当前范围，不作为当前对象的诊断解释。',
    });
    expect(model.selectedObjectExplanation.text).not.toContain('关键词探索阶段');
  });

  it('chooses exactly one first-screen primary action and one default result surface', () => {
    const model = buildDiagnosisWorkspaceModel({
      realReportCount: 8,
      requiredReportCount: 8,
      importedReportTypeCount: 8,
      importedRowCount: 1024,
      hasImportedMetrics: true,
      recommendationGateIssues: [],
      diagnosticCount: 3,
    });

    expect(model.primaryAction).toEqual({
      label: '进入优化建议',
      target: 'recommendations',
      disabled: false,
    });
    expect(model.defaultSurfaces).toEqual({
      objectTableVisible: true,
      reviewQueueOpen: false,
      technicalDetailsOpen: false,
    });
  });

  it('keeps formal recommendation eligibility independent from the current metric view', () => {
    const model = buildDiagnosisWorkspaceModel({
      realReportCount: 8,
      requiredReportCount: 8,
      importedReportTypeCount: 8,
      importedRowCount: 1024,
      hasImportedMetrics: true,
      recommendationGateIssues: [],
      diagnosticCount: 3,
      visibleDiagnosticCount: 0,
    });

    expect(model.formalRecommendationsLocked).toBe(false);
    expect(model.primaryAction).toEqual({
      label: '进入优化建议',
      target: 'recommendations',
      disabled: false,
    });
    expect(model.queue).toEqual({
      totalCount: 3,
      visibleCount: 0,
      hasVisibleRows: false,
    });
  });
});

describe('ad diagnosis workspace structure', () => {
  const source = readFileSync(new URL('./ad-quant-page.tsx', import.meta.url), 'utf8');

  it('renders one shared first-screen task banner', () => {
    expect(source.match(/<TaskBanner/g)).toHaveLength(1);
    expect(source).toContain('label: workspaceModel.primaryAction.label');
  });

  it('uses one selectable virtual queue and a responsive object inspector', () => {
    expect(source.match(/<VirtualDataTable\b/g)).toHaveLength(1);
    expect(source).toContain('estimateSize={54}');
    expect(source.match(/<ResponsiveInspector/g)).toHaveLength(1);
    expect(source).toContain('selectedDiagnosticKey');
    expect(source).toContain('data-workspace-work-surface');
    expect(source).toContain('data-workspace-queue');
  });

  it('does not render a duplicate entity diagnosis table or legacy review queue', () => {
    expect(source).not.toContain('当前产品实体诊断表');
    expect(source).not.toContain('<Panel title="复核队列"');
    expect(source).not.toContain('<Panel title="量化后动作"');
  });

  it('keeps the technical drawer to one disclosure level', () => {
    const technicalStart = source.indexOf('<ProgressiveDetails title="技术依据与诊断上下文"');
    const technicalEnd = source.indexOf('</ProgressiveDetails>', technicalStart);
    expect(technicalStart).toBeGreaterThan(-1);
    expect(technicalEnd).toBeGreaterThan(technicalStart);

    const technicalBody = source.slice(technicalStart, technicalEnd);
    expect(technicalBody.match(/<details\b/g) || []).toHaveLength(0);
    expect(technicalBody.match(/<ProgressiveDetails\b/g) || []).toHaveLength(1);
  });

  it('keeps the single AI run status visible before the closed technical disclosure', () => {
    const feedbackStart = source.indexOf('id="ai-strategy-run-feedback"');
    const technicalStart = source.indexOf('<ProgressiveDetails title="技术依据与诊断上下文"');

    expect(source.match(/id="ai-strategy-run-feedback"/g)).toHaveLength(1);
    expect(feedbackStart).toBeGreaterThan(-1);
    expect(feedbackStart).toBeLessThan(technicalStart);
    expect(source).toContain('data-ai-run-status-visible="true"');
    expect(source).toContain('aria-atomic="true"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="status"');
  });
});
