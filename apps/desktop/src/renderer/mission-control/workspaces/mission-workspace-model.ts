import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  missionControlContextKey,
  sanitizeCausalExportText,
  type AnalysisEvidencePackageRecord,
  type AnalysisProposalSnapshotRecord,
  type CausalEventRecord,
  type MissionAnalysisProjection,
  type AppendMissionCheckpointInput,
  type CreateMissionInput,
  type MissionCheckpointRecord,
  type MissionControlCapabilityAction,
  type MissionControlCapabilityProjection,
  type MissionLifecycleStatus,
  type MissionLinkRecord,
  type MissionPhase,
  type MissionPriority,
  type MissionRecord,
  type PolicyRecord,
  type PolicyVersionRecord,
  type StoreContextEnvelope,
  type UpdateMissionInput,
} from '@amazon-ai-ops/shared-types';
import { capabilityForAction } from '../components';
import {
  type MissionProductOptionSource,
  type MissionChoice,
} from './mission-workspace-contracts';

export const PAGE_SIZE = 6;

export const OPERATOR_ACTOR_ID = 'desktop-operator';

export const STATUS_LABELS: Record<MissionLifecycleStatus, string> = {
  draft: '待启动',
  active: '运行中',
  paused: '已暂停',
  blocked: '已阻断',
  completed: '已完成',
  archived: '已归档',
};

export function missionTransitionActionLabel(status: MissionLifecycleStatus): string {
  if (status === 'active') return '暂停任务';
  if (status === 'draft') return '启动任务';
  return '恢复任务';
}

export function missionDefinitionEditBlocker(
  record: Pick<MissionRecord, 'phase'>,
  hasBoundDecision = false,
): string | null {
  if (!hasBoundDecision && !['decision', 'action', 'readback', 'effect'].includes(record.phase)) return null;
  return '已进入决策阶段，经营定义已锁定；如需改变目标、产品、观察窗口或守护条件，请重新创建运营任务。';
}

export const PHASE_LABELS: Record<MissionPhase, string> = {
  fact: '核验事实',
  analysis: '分析',
  decision: '决策',
  action: '执行',
  readback: '回读',
  effect: '评估效果',
};

export function missionRestoreFeedback(
  record: Pick<MissionRecord, 'status' | 'phase'>,
): string {
  if (record.status === 'completed' && record.phase === 'effect') {
    return '运营任务已恢复；完成状态、效果阶段与证据链保持不变。';
  }
  if (record.status === 'paused') return '运营任务已恢复为暂停状态。';
  return `运营任务已恢复，当前状态：${STATUS_LABELS[record.status]}，当前阶段：${PHASE_LABELS[record.phase]}。`;
}

export const LINK_LABELS: Record<MissionLinkRecord['linkType'], string> = {
  data_batch: '数据批次',
  policy_version: '策略版本',
  decision: '经营决策',
  experiment: '经营实验',
  execution: '执行记录',
  result: '效果结果',
  product: '产品',
  ad_entity: '广告对象',
};

export function missionLineageLinkLabel(linkType: MissionLinkRecord['linkType']): string {
  return LINK_LABELS[linkType];
}

export function buildMissionProductOptions(products: readonly MissionProductOptionSource[]): MissionChoice[] {
  return products
    .filter((product) => product.asin.trim().length > 0)
    .map((product) => ({
      value: product.asin.trim(),
      label: `${product.title?.trim() || '未命名产品'} · ${product.asin.trim()}`,
    }));
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return '运营任务操作未完成；请重新读取当前店铺后再试。';
}

export function operatorFacingBlocker(reason: string | null | undefined, subject: string): string {
  const value = reason ? sanitizeCausalExportText(reason.trim()) : undefined;
  if (!value || /Mission|Experiment|Decision|Authority|Renderer|Main|StoreContext|Profile|UNKNOWN|\brevision\b|\bdraft\b|set_keyword_bid|manifest|fingerprint|dry-run|CRUD|PRODUCTION_NATIVE|PROTOTYPE_ONLY|LEGACY_ADAPTER|sequence|append-only|correction|DECISION|ACTION|READBACK|EFFECT|\bBLOCKED\b/i.test(value)) {
    return `${subject}当前不可用。请确认当前店铺连接与本机服务后重试。`;
  }
  return value;
}

export function plusDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function listFromDraft(value: string): string[] {
  return value.split(/[\n；;]/).map((item) => item.trim()).filter(Boolean);
}

export function responseMatchesMissionAuthority(
  currentAuthorityKey: string,
  capturedAuthorityKey: string,
  currentSequence: number,
  capturedSequence: number,
): boolean {
  return currentAuthorityKey === capturedAuthorityKey && currentSequence === capturedSequence;
}

export function capabilityReady(
  capabilities: readonly MissionControlCapabilityProjection[] | undefined,
  view: 'missions/overview' | 'missions/facts',
  action: MissionControlCapabilityAction,
  previewMode: boolean,
): boolean {
  const projection = capabilityForAction(capabilities, action === 'view' ? view : 'missions/overview', action);
  return projection?.state === (previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE');
}
