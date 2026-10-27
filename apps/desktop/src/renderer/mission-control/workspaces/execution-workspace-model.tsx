import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AD_EXECUTION_RECONCILIATION_COPY,
  missionControlContextKey,
  type AdExecutionBatchProjection,
  type AdExecutionEvidenceSlot,
  type AdExecutionProgressEvent,
  type AdExecutionStatus,
  type AnalysisProposalSnapshotRecord,
  type DecisionRecord,
  type MissionAnalysisProjection,
  type MissionGrantEventRecord,
  type MissionGrantRecord,
  type MissionRecord,
  type MissionControlCapabilityProjection,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { toUserFacingError } from '../../user-facing-error';
import { type ExecutionMutationTicket, type ExecutionDetailTab } from './execution-workspace-contracts';

export const EXECUTION_CAPABILITY_IDS = {
  view: 'execution.queue.view',
  start: 'execution.queue.start',
  takeover: 'execution.queue.takeover',
  cancel: 'execution.queue.cancel',
  reconcileUnknown: 'execution.queue.reconcile-unknown',
} as const;

export function executionCapabilityReady(
  capabilities: readonly MissionControlCapabilityProjection[],
  capabilityId: string,
  previewEnabled: boolean,
): boolean {
  const expectedState = previewEnabled ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE';
  return capabilities.some((capability) => (
    capability.capabilityId === capabilityId && capability.state === expectedState
  ));
}

export const TERMINAL = new Set<AdExecutionStatus>(['succeeded', 'blocked', 'unknown', 'cancelled']);

export const STATUS_LABELS: Record<AdExecutionStatus, string> = {
  queued: '排队',
  preflight: '预检',
  intent_written: '执行意图已记录',
  submitted: '已提交',
  verifying: '回读中',
  succeeded: '成功',
  blocked: '已阻断',
  unknown: '结果不确定',
  cancelled: '已取消',
};

export function executionProgressBelongsToSelection(
  event: AdExecutionProgressEvent,
  context: StoreContextEnvelope | null,
  selected: AdExecutionBatchProjection | null,
  grantId: string,
): boolean {
  if (!context || String(event.storeId) !== String(context.storeId)) return false;
  if (event.phase === 'identity') {
    return !event.jobId && Boolean(grantId.trim()) && event.batchId === grantId.trim();
  }
  if (!selected || event.batchId !== selected.batch.id) return false;
  return !event.jobId || selected.jobs.some((job) => job.id === event.jobId);
}

export function executionMutationCanCommit(
  ticket: ExecutionMutationTicket,
  currentAuthorityKey: string,
  currentSequence: number,
): boolean {
  return ticket.authorityKey === currentAuthorityKey && ticket.sequence === currentSequence;
}

export const STEP_DEFINITIONS = [
  { id: 'queue', label: '排队', detail: '绑定执行授权与完整批次' },
  { id: 'preflight', label: '预检', detail: '重查店铺、会话、身份与变更前值' },
  { id: 'intent', label: '写入意图', detail: '点击前持久化一次性保存意图' },
  { id: 'submitted', label: '提交', detail: '可见浏览器串行执行，绝不并发' },
  { id: 'after', label: '保存后核验', detail: '保存后立即捕获同对象证据' },
  { id: 'reload', label: '刷新回读', detail: '刷新后重新读取并核对目标值' },
] as const;

export const BUSINESS_PLAN_STEPS = [
  { id: 'scope', title: '身份与店铺范围确认', detail: '当前店铺与广告账户已绑定' },
  { id: 'report', title: '广告报表下载完成', detail: '当前运营任务的事实批次已冻结' },
  { id: 'import', title: '数据导入并校验', detail: 'US / USD 口径与版本校验已通过' },
  { id: 'analysis', title: 'AI 完成量化诊断', detail: '结构化建议与证据包已生成' },
  { id: 'grant', title: '生成已授权调整动作', detail: '只允许关键词降价且单次不超过 10%' },
  { id: 'act', title: '执行 · 调整广告出价', detail: '可见浏览器串行执行' },
  { id: 'readback', title: '验证与回读', detail: '变更前 / 提交后 / 刷新后同对象核验' },
] as const;

export const UNKNOWN_DIAGNOSTIC_DETAIL = 'UNKNOWN · 队列已停止；只允许只读双次对账，禁止重试保存';

export const DETAIL_TABS: ReadonlyArray<{ id: ExecutionDetailTab; label: string }> = [
  { id: 'action', label: '动作详情' },
  { id: 'compare', label: '前后对比' },
  { id: 'readback', label: '回读验证' },
  { id: 'evidence', label: '证据与归档' },
  { id: 'experiment', label: '关联实验' },
];

export const EVIDENCE_SLOT_LABELS = {
  before: '变更前',
  after: '提交后',
  reload: '刷新后',
} as const;

export function executionUserFacingError(error: unknown): string {
  const fallback = '实时执行暂不可用：请核对当前店铺连接、审批授权与可见浏览器状态。';
  const mapped = toUserFacingError(error, fallback);
  const rawFirstLine = (error instanceof Error ? error.message : String(error || ''))
    .split(/\r?\n/)[0]
    .slice(0, 240);
  return mapped === rawFirstLine ? fallback : mapped;
}

export function money(cents: number): string {
  return `USD ${(cents / 100).toFixed(2)}`;
}

export function shortId(value: string, max = 22): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function formatTime(value?: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString('zh-CN', { hour12: false });
}

export function grantIssuer(
  projection: AdExecutionBatchProjection,
  explicit?: 'human' | 'policy',
): '人工签发' | '策略签发' | '人工 / 策略签发待核验' {
  if (explicit === 'policy') return '策略签发';
  if (explicit === 'human') return '人工签发';
  const actors = projection.jobs.flatMap((job) => job.events.map((event) => event.actorId.toLowerCase()));
  if (projection.batch.grantId.toLowerCase().includes('policy') || actors.some((actor) => actor.includes('policy'))) {
    return '策略签发';
  }
  if (projection.batch.grantId.toLowerCase().includes('human')
    || actors.some((actor) => /operator|human/.test(actor))) return '人工签发';
  return '人工 / 策略签发待核验';
}

export function preferredExecutionBatchId(rows: readonly AdExecutionBatchProjection[]): string {
  return rows.find((row) => !TERMINAL.has(row.batch.status))?.batch.id
    ?? rows[0]?.batch.id
    ?? '';
}

export function preferredExecutionJobId(
  projection: AdExecutionBatchProjection | null,
  currentJobId = '',
): string {
  if (!projection) return '';
  return projection.jobs.some((job) => job.id === currentJobId)
    ? currentJobId
    : projection.jobs[0]?.id ?? '';
}

export function missionForExecutionBatch(
  missions: readonly MissionRecord[],
  projection: AdExecutionBatchProjection | null,
): MissionRecord | null {
  if (!projection) return null;
  return missions.find((mission) => (
    mission.id === projection.batch.missionId
    && mission.revision === projection.batch.missionRevision
  )) ?? null;
}

export function confirmStop(): boolean {
  return typeof window !== 'undefined'
    && window.confirm('确认终止当前队列？只有执行意图写入前的动作可以安全取消；审计记录会继续保留。');
}
