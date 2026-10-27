import { WorkspaceActionButton } from '../../components/workspace/action-feedback';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  FileText,
  PencilSimple,
  Plus,
  Prohibit,
  ShieldCheck,
  ThumbsDown,
  X,
} from '@phosphor-icons/react';
import {
  canonicalizeAmazonAsin,
  missionControlContextKey,
  type AnalysisEvidencePackageRecord,
  type AnalysisProposalSnapshotRecord,
  type AuthorizeAnalysisProposalBatchRequest,
  type BindRecommendationWritableTargetRequest,
  type BindRecommendationWritableTargetResult,
  type CreateDecisionInput,
  type DecisionHistoryRecord,
  type DecisionRecord,
  type DecisionStatus,
  type MissionControlCapabilityProjection,
  type MissionGrantEventRecord,
  type MissionGrantRecord,
  type MissionAnalysisProjection,
  type RunMissionAnalysisRequest,
  type ReviseDecisionInput,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { useOverlayFocusScope } from '../../components/workspace/overlay-focus-scope';
import { type DecisionDraft } from './decision-workspace-contracts';
import { plusDays, split, OPERATOR } from './decision-workspace-model';

export function decisionDraft(context: StoreContextEnvelope, record?: DecisionRecord | null): DecisionDraft {
  return {
    title: record?.title ?? '',
    missionId: record?.missionId ?? '',
    dataBatchId: record?.dataBatchId ?? '',
    policyVersionId: record?.policyVersionId ?? '',
    policyRevision: String(record?.policyRevision ?? 1),
    actionRevision: String(record?.actionRevision ?? 1),
    rationale: record?.rationale ?? '',
    recommendation: record?.recommendation ?? '',
    facts: record?.facts.join('；') ?? '',
    alternatives: record?.alternatives.join('；') ?? '',
    expectedEffect: record?.expectedEffect ?? '',
    validUntil: record?.validUntil?.slice(0, 10) ?? plusDays(context.businessDate, 7),
    actionType: record?.actionType ?? 'set_keyword_bid',
    adEntityId: record?.adEntityId ?? '',
    productId: record?.productId ?? '',
    currentValue: record?.currentValue === undefined ? '' : String(record.currentValue),
    recommendedValue: record?.recommendedValue === undefined ? '' : String(record.recommendedValue),
    confidence: String(record?.confidence ?? 0.8),
    status: ['proposed', 'needs_approval', 'blocked'].includes(record?.status ?? '') ? record!.status as DecisionDraft['status'] : 'proposed',
  };
}

export function buildCreateDecisionInput(draft: DecisionDraft, id: string): CreateDecisionInput {
  const facts = split(draft.facts);
  const alternatives = split(draft.alternatives);
  const confidence = Number(draft.confidence);
  const policyRevision = Number(draft.policyRevision);
  const actionRevision = Number(draft.actionRevision);
  if (!draft.title.trim() || !draft.missionId.trim() || !draft.dataBatchId.trim() || !draft.policyVersionId.trim()) throw new Error('请填写标题并绑定运营任务、数据批次与策略版本。');
  if (!draft.rationale.trim() || !draft.recommendation.trim() || !facts.length) throw new Error('请填写理由、推荐动作与至少一条可核验事实。');
  if (!Number.isSafeInteger(policyRevision) || policyRevision < 1 || !Number.isSafeInteger(actionRevision) || actionRevision < 1) throw new Error('策略与动作版本号必须是正整数。');
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('置信度必须在 0–1 之间。');
  return {
    id,
    missionId: draft.missionId.trim(),
    dataBatchId: draft.dataBatchId.trim(),
    policyVersionId: draft.policyVersionId.trim(),
    policyRevision,
    actionRevision,
    title: draft.title.trim(),
    rationale: draft.rationale.trim(),
    recommendation: draft.recommendation.trim(),
    facts,
    alternatives,
    ...(draft.expectedEffect.trim() ? { expectedEffect: draft.expectedEffect.trim() } : {}),
    ...(draft.validUntil ? { validUntil: `${draft.validUntil}T07:00:00.000Z` } : {}),
    actionType: draft.actionType.trim() || 'set_keyword_bid',
    ...(draft.adEntityId.trim() ? { adEntityId: draft.adEntityId.trim() } : {}),
    ...(draft.productId.trim() ? { productId: draft.productId.trim() } : {}),
    ...(draft.currentValue.trim() ? { currentValue: Number(draft.currentValue) } : {}),
    ...(draft.recommendedValue.trim() ? { recommendedValue: Number(draft.recommendedValue) } : {}),
    confidence,
    status: draft.status,
    actorId: OPERATOR,
  };
}

export function buildReviseDecisionInput(record: DecisionRecord, draft: DecisionDraft): ReviseDecisionInput {
  const create = buildCreateDecisionInput(draft, record.id);
  return {
    id: record.id,
    expectedRevision: record.revision,
    title: create.title,
    rationale: create.rationale,
    recommendation: create.recommendation,
    facts: create.facts,
    alternatives: create.alternatives,
    expectedEffect: create.expectedEffect ?? null,
    validUntil: create.validUntil ?? null,
    currentValue: create.currentValue,
    recommendedValue: create.recommendedValue,
    confidence: create.confidence,
    status: create.status,
    actorId: OPERATOR,
  };
}

export function DecisionDialog({ record, draft, busy, onChange, onClose, onSave }: { record: DecisionRecord | null; draft: DecisionDraft; busy: boolean; onChange: (draft: DecisionDraft) => void; onClose: () => void; onSave: () => void }) {
  const dialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    open: true, onDismiss: onClose, dismissDisabled: busy,
  });
  const update = <K extends keyof DecisionDraft>(key: K, value: DecisionDraft[K]) => onChange({ ...draft, [key]: value });
  return (
    <div className="mission-control-dialog-backdrop" ref={dialogFocus.overlayRootRef}>
      <section aria-labelledby="decision-dialog-title" aria-modal="true" className="mission-control-dialog decision-domain-dialog" ref={dialogFocus.surfaceRef} tabIndex={-1} role="dialog">
        <header>
          <div>
            <span>经营决策 · US / USD</span>
            <h2 id="decision-dialog-title">{record ? '修订经营决策' : '新建经营决策'}</h2>
            <p>关联运营任务、数据批次和策略版本在创建后保持冻结。</p>
          </div>
          <WorkspaceActionButton aria-label="关闭经营决策编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onClose} type="button" disabledReason={'正在保存经营决策，请等待完成后再关闭编辑器。'}><X size={18} /></WorkspaceActionButton>
        </header>
        {busy && <p id="decision-editor-busy-reason">正在保存经营决策，请等待完成后再修改字段。</p>}
        <fieldset aria-describedby={busy ? "decision-editor-busy-reason" : undefined} disabled={busy} className="decision-domain-form" style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}>
          <label className="decision-domain-form__wide"><span>决策标题 *</span><input data-overlay-initial-focus value={draft.title} onChange={(event) => update('title', event.target.value)} /></label>
          <label className="decision-domain-form__wide"><span>决策理由 *</span><textarea rows={3} value={draft.rationale} onChange={(event) => update('rationale', event.target.value)} /></label>
          <label className="decision-domain-form__wide"><span>推荐动作 *</span><textarea rows={2} value={draft.recommendation} onChange={(event) => update('recommendation', event.target.value)} /></label>
          <label className="decision-domain-form__wide"><span>可核验事实 *</span><textarea rows={3} value={draft.facts} onChange={(event) => update('facts', event.target.value)} /><small>用分号或换行分隔。</small></label>
          <label className="decision-domain-form__wide"><span>备选方案</span><textarea rows={2} value={draft.alternatives} onChange={(event) => update('alternatives', event.target.value)} /></label>
          <label><span>当前值 / 推荐值</span><div className="decision-domain-pair"><input type="number" step="0.01" value={draft.currentValue} onChange={(event) => update('currentValue', event.target.value)} /><input type="number" step="0.01" value={draft.recommendedValue} onChange={(event) => update('recommendedValue', event.target.value)} /></div></label>
          <label><span>置信度 / 状态</span><div className="decision-domain-pair"><input min="0" max="1" step="0.01" type="number" value={draft.confidence} onChange={(event) => update('confidence', event.target.value)} /><select value={draft.status} onChange={(event) => update('status', event.target.value as DecisionDraft['status'])}><option value="proposed">待复核</option><option value="needs_approval">待审批</option><option value="blocked">已阻断</option></select></div></label>
          <label><span>有效期</span><input type="date" value={draft.validUntil} onChange={(event) => update('validUntil', event.target.value)} /></label>
          <label><span>预期效果</span><input value={draft.expectedEffect} onChange={(event) => update('expectedEffect', event.target.value)} /></label>
          <details className="decision-domain-form__wide">
            <summary>诊断详情</summary>
            {record && <p id="decision-frozen-relations">运营任务、数据批次、策略与对象在创建后保持冻结；可修订本次判断内容。</p>}
            <div className="decision-domain-form">
              <label><span>运营任务标识 *</span><input aria-describedby={record ? "decision-frozen-relations" : undefined} disabled={Boolean(record)} value={draft.missionId} onChange={(event) => update('missionId', event.target.value)} /></label>
              <label><span>数据批次标识 *</span><input aria-describedby={record ? "decision-frozen-relations" : undefined} disabled={Boolean(record)} value={draft.dataBatchId} onChange={(event) => update('dataBatchId', event.target.value)} /></label>
              <label><span>策略版本标识 *</span><input aria-describedby={record ? "decision-frozen-relations" : undefined} disabled={Boolean(record)} value={draft.policyVersionId} onChange={(event) => update('policyVersionId', event.target.value)} /></label>
              <label><span>策略 / 动作版本号</span><div className="decision-domain-pair"><input aria-describedby={record ? "decision-frozen-relations" : undefined} disabled={Boolean(record)} min="1" type="number" value={draft.policyRevision} onChange={(event) => update('policyRevision', event.target.value)} /><input aria-describedby={record ? "decision-frozen-relations" : undefined} disabled={Boolean(record)} min="1" type="number" value={draft.actionRevision} onChange={(event) => update('actionRevision', event.target.value)} /></div></label>
              <label><span>广告对象标识</span><input aria-describedby={record ? "decision-frozen-relations" : undefined} disabled={Boolean(record)} value={draft.adEntityId} onChange={(event) => update('adEntityId', event.target.value)} /></label>
              <label><span>产品标识</span><input aria-describedby={record ? "decision-frozen-relations" : undefined} disabled={Boolean(record)} value={draft.productId} onChange={(event) => update('productId', event.target.value)} /></label>
              <label><span>内部动作值</span><input readOnly value={draft.actionType} /></label>
            </div>
          </details>
        </fieldset>
        <footer>
          <WorkspaceActionButton className="workspace-button workspace-button--secondary" disabled={busy} onClick={onClose} type="button" disabledReason={'正在保存经营决策，请等待完成后再关闭编辑器。'}>取消</WorkspaceActionButton>
          <WorkspaceActionButton className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button" disabledReason={'正在保存经营决策，请等待完成后再关闭编辑器。'} busy={busy} busyLabel="保存中…">{busy ? '保存中…' : '保存经营决策'}</WorkspaceActionButton>
        </footer>
      </section>
    </div>
  );
}
