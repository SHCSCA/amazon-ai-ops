import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OperatorFlowFeedback } from './operator-flow-feedback';
import type { OperatorFlowStageProjection } from '@amazon-ai-ops/shared-types';

describe('operator flow four-part stage feedback', () => {
  it('renders each actual stage status result blocker and capability-bound recovery without giving UNKNOWN success semantics', () => {
    const stages: OperatorFlowStageProjection[] = [
      { id: 'readback', label: '结果回读', state: 'unknown', statusLabel: '待核验', latestResult: '提交结果不确定。',
        blocker: '只能只读对账。', nextAction: '核对回读与只读对账', targetView: 'execution/evidence' },
      { id: 'delivery', label: '交付验收', state: 'unknown', statusLabel: '待核验', latestResult: '尚无本次证据。',
        blocker: '旧结论不能复用。', nextAction: '刷新当前交付核验', targetView: 'settings/delivery' },
    ];
    const html = renderToStaticMarkup(<OperatorFlowFeedback stages={stages} allows={view => view === 'execution/evidence'} onNavigate={() => undefined} />);
    expect(html).toContain('提交结果不确定。'); expect(html).toContain('只能只读对账。');
    expect(html).toContain('data-recovery-intent="execution/evidence"');
    expect(html).toContain('data-recovery-intent="settings/delivery"');
    expect(html).toContain('当前页面入口尚未接入'); expect(html).toContain('aria-describedby=');
    expect(html).not.toContain('data-tone="ready"');
    expect(html.match(/<dt>最近结果<\/dt>/g)).toHaveLength(2);
    expect(html.match(/<dt>原因与阻断<\/dt>/g)).toHaveLength(2);
  });
  it('redacts unexpected private suffixes even when the safe Main projection is malformed', () => {
    const secret = 'sk-' + 'private'.repeat(8);
    const html = renderToStaticMarkup(<OperatorFlowFeedback stages={[{ id: 'analysis', label: '分析运行', state: 'blocked',
      statusLabel: '已阻断', latestResult: `AI失败 token=${secret}`, blocker: '请检查 C:\\Private Folder\\report.xlsx',
      nextAction: '重新分析', targetView: 'missions/overview' }]} allows={() => true} onNavigate={() => undefined} />);
    expect(html).not.toContain(secret); expect(html).not.toContain('Private Folder');
    expect(html).not.toContain('report.xlsx'); expect(html).toContain('重新分析');
  });
});
