import React from 'react';
import { sanitizeCausalExportText, type OperatorFlowStageProjection, type MissionControlViewId } from '@amazon-ai-ops/shared-types';
import { WorkspaceActionButton } from '../../components/workspace/action-feedback';
import './operator-flow-feedback.css';

export function OperatorFlowFeedback({ stages, allows, onNavigate }: {
  stages: readonly OperatorFlowStageProjection[];
  allows: (view: MissionControlViewId) => boolean;
  onNavigate: (view: MissionControlViewId) => void;
}) {
  return <section className="canonical-next-actions operator-flow-feedback" aria-label="十三阶段业务进度">
    <h3>业务全流程</h3>
    <p>只读展示当前店铺持久化事实；阶段记录不授予执行或发布权限。</p>
    <ol>{stages.map(stage => <li key={stage.id} data-flow-stage={stage.id} data-flow-state={stage.state}>
      <div><h4>{stage.label} · <span data-tone={stage.state === 'verified' ? 'ready' : stage.state === 'blocked' ? 'blocked' : 'attention'}>{stage.statusLabel}</span></h4>
        <dl><div><dt>最近结果</dt><dd>{sanitizeCausalExportText(stage.latestResult)}</dd></div>
          <div><dt>原因与阻断</dt><dd>{sanitizeCausalExportText(stage.blocker)}</dd></div></dl>
      </div>
      <WorkspaceActionButton className="workspace-button workspace-button--secondary" data-recovery-intent={stage.targetView}
        disabled={!allows(stage.targetView)} disabledReason="当前页面入口尚未接入，请先检查当前店铺的连接与应用服务。"
        onClick={() => { if (allows(stage.targetView)) onNavigate(stage.targetView); }}>{stage.nextAction}</WorkspaceActionButton>
    </li>)}</ol>
  </section>;
}
