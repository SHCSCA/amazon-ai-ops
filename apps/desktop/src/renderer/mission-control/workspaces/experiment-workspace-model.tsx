import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Flask,
  NotePencil,
  Pause,
  PencilSimple,
  Play,
  Plus,
  X,
} from '@phosphor-icons/react';
import {
  missionControlContextKey,
  sanitizeCausalExportText,
  type CausalEventRecord,
  type CreateExperimentInput,
  type ExperimentMetricSnapshotRecord,
  type ExperimentObservationRecord,
  type ExperimentObservationType,
  type ExperimentRecord,
  type ExperimentStatus,
  type MissionControlCapabilityProjection,
  type StoreContextEnvelope,
  type UpdateExperimentInput,
} from '@amazon-ai-ops/shared-types';
import { PageFrame, SummaryStrip, TaskBanner, WorkbenchPanel, WorkspaceState } from '../../components/workspace';
import { selectEntityDeletePolicy } from '../../components/workspace/entity-delete-policy';
import {
  assertCausalEventBelongsToContext,
  assertExperimentBelongsToContext,
  assertMissionAuthorityContext,
  assertMissionBelongsToContext,
  readExperimentDomainWindowApi,
  readMissionDomainWindowApi,
  type AppendExperimentObservationInput,
  type ExperimentDomainRendererApi,
} from './mission-domain-window-api';
import { useOverlayFocusScope } from '../../components/workspace/overlay-focus-scope';
import { PAGE_SIZE, OPERATOR, STATUS_LABELS, OBSERVATION_LABELS, ExperimentDraft, ExperimentEditorState, SelectorOption, MissionSelectorOption, AdObjectSelectorOption, ExperimentMissionOptionSource, ExperimentProductOptionSource, ExperimentAdObjectOptionSource, ExperimentSelectorOptions, PRIMARY_METRIC_OPTIONS, ObservationDraft, ExperimentsWorkspaceProps } from './experiment-workspace-contracts';

export function buildExperimentSelectorOptions(
  missions: readonly ExperimentMissionOptionSource[],
  products: readonly ExperimentProductOptionSource[],
  adObjects: readonly ExperimentAdObjectOptionSource[],
): Omit<ExperimentSelectorOptions, 'loading'> {
  return {
    missions: missions
      .filter((mission) => mission.status !== 'archived')
      .map((mission) => ({
        value: mission.id,
        label: mission.title,
        ...(mission.productId?.trim() ? { productId: mission.productId.trim() } : {}),
      })),
    products: products.map((product) => ({
      value: product.asin,
      label: `${product.title?.trim() || '未命名产品'} · ${product.asin}`,
    })),
    adObjects: adObjects
      .filter((item) => item.kind === 'target' && item.entityId && item.resolved && !item.nonExecutable)
      .map((item) => ({
        value: item.entityId!,
        label: [
          item.campaignName?.trim() || '未命名活动',
          item.adGroupName?.trim() || '未命名广告组',
          item.name.trim() || '未命名关键词/投放',
        ].join(' > '),
        ...(item.asin?.trim() ? { productId: item.asin.trim() } : {}),
      })),
  };
}

export function experimentMissionScope(
  options: Pick<ExperimentSelectorOptions, 'missions' | 'products' | 'adObjects'>,
  missionId: string,
): {
  missionProductId: string;
  productId: string;
  products: SelectorOption[];
  adObjects: AdObjectSelectorOption[];
} {
  const missionProductId = options.missions.find((option) => option.value === missionId)?.productId?.trim() ?? '';
  const product = missionProductId
    ? options.products.find((option) => option.value === missionProductId)
    : undefined;
  return {
    missionProductId,
    productId: product?.value ?? '',
    products: product ? [product] : [],
    adObjects: product
      ? options.adObjects.filter((option) => option.productId === missionProductId)
      : [],
  };
}

export function bindExperimentDraftToMission(
  draft: ExperimentDraft,
  missionId: string,
  options: Pick<ExperimentSelectorOptions, 'missions' | 'products' | 'adObjects'>,
): ExperimentDraft {
  const scope = experimentMissionScope(options, missionId);
  return {
    ...draft,
    missionId,
    productId: scope.productId,
    adEntityId: scope.adObjects.some((option) => option.value === draft.adEntityId)
      ? draft.adEntityId
      : '',
  };
}

export function experimentDraftScopeError(
  draft: Pick<ExperimentDraft, 'missionId' | 'productId' | 'adEntityId'>,
  options: Pick<ExperimentSelectorOptions, 'missions' | 'products' | 'adObjects'>,
): string | null {
  if (!draft.missionId.trim()) return '请选择运营任务。';
  const mission = options.missions.find((option) => option.value === draft.missionId);
  if (!mission) return '所选运营任务已不可用，请重新选择。';
  const scope = experimentMissionScope(options, draft.missionId);
  if (!scope.missionProductId) return '所选运营任务尚未绑定产品，请先编辑运营任务。';
  if (!scope.productId) return '运营任务绑定的产品不在当前店铺可用产品中，请先修复产品范围。';
  if (draft.productId !== scope.productId) return '当前产品与运营任务绑定的产品不一致，保存已阻断。';
  if (!scope.adObjects.some((option) => option.value === draft.adEntityId)) {
    return '请选择该运营任务绑定产品下可稳定回读的广告对象。';
  }
  return null;
}

export function experimentCausalEventsForSelection(
  events: readonly CausalEventRecord[],
  experimentId: string | undefined,
  observationIds: ReadonlySet<string>,
  metricIds: ReadonlySet<string>,
): CausalEventRecord[] {
  return events.filter((event) => event.entityId === experimentId
    || (event.entityType === 'experiment_record' && observationIds.has(event.entityId))
    || (['experiment_metric_snapshot', 'experiment_metric'].includes(event.entityType)
      && metricIds.has(event.entityId)));
}

export function message(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? sanitizeCausalExportText(error.message)
    : '经营实验操作未完成，请刷新当前店铺后重试。';
}

export function operatorFacingBlocker(reason: string | null | undefined, subject: string): string {
  const value = reason ? sanitizeCausalExportText(reason).trim() : '';
  if (!value || /Mission|Experiment|Decision|Authority|Renderer|Main|StoreContext|UNKNOWN|\brevision\b|\bdraft\b|set_keyword_bid|PRODUCTION_NATIVE|PROTOTYPE_ONLY|\bBLOCKED\b/.test(value)) {
    return `${subject}当前不可用。请确认当前店铺连接与本机服务后重试。`;
  }
  return value;
}

export function list(value: string): string[] {
  return value.split(/[\n；;]/).map((item) => item.trim()).filter(Boolean);
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function capabilityReady(
  rows: readonly MissionControlCapabilityProjection[] | undefined,
  capabilityId: string,
  previewMode: boolean,
): boolean {
  const projection = rows?.find((item) => item.capabilityId === capabilityId);
  return projection?.state === (previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE');
}

export function ExperimentStatusTag({ status }: { status: ExperimentStatus }) {
  return <span className="experiment-status" data-status={status}>{STATUS_LABELS[status]}</span>;
}

export function preferredExperimentId(records: readonly Pick<ExperimentRecord, 'id' | 'status'>[]): string {
  return records.find((record) => record.status === 'running')?.id
    ?? records.find((record) => record.status !== 'archived')?.id
    ?? records[0]?.id
    ?? '';
}

export function experimentEvaluationFeedback(
  record: Pick<ExperimentRecord, 'status' | 'conclusion'>,
): string {
  if (record.status === 'paused' && record.conclusion?.includes('守护栏触发')) {
    return `守护栏触发：系统已暂停经营实验并写入效果记录。${record.conclusion}`;
  }
  if (record.status === 'completed') {
    return `系统判定完成：指标快照与效果记录已写入因果链，关联运营任务已同步进入效果阶段。${record.conclusion ?? ''}`;
  }
  return '系统已检查当前指标，经营实验仍保持当前状态。';
}

export function experimentRestoreFeedback(
  record: Pick<ExperimentRecord, 'status'>,
): string {
  if (record.status === 'completed') {
    return '经营实验已恢复；系统判定结果与效果证据保持不变。';
  }
  if (record.status === 'paused') return '经营实验已恢复为暂停状态。';
  return `经营实验已恢复，当前状态：${STATUS_LABELS[record.status]}。`;
}

export function experimentEditAvailability(
  status: ExperimentStatus,
): { enabled: true } | { enabled: false; reason: string } {
  if (status === 'draft') return { enabled: true };
  return {
    enabled: false,
    reason: '实验首次启动后合同已冻结；如需改变对象、指标、变量或观察窗口，请归档当前实验并新建实验。',
  };
}

export function experimentResumeAvailability(
  record: Pick<ExperimentRecord, 'status' | 'conclusion'>,
): { enabled: true } | { enabled: false; reason: string } {
  if (record.status === 'paused' && record.conclusion?.includes('守护栏触发')) {
    return {
      enabled: false,
      reason: '系统指标已触发守护栏，原实验不能恢复；请复核原因并新建实验。',
    };
  }
  return { enabled: true };
}

export function experimentEvaluationErrorMessage(error: unknown): string {
  const detail = message(error);
  if (detail.includes('观察窗口尚未结束')) {
    return `观察窗口尚未结束，暂不能判定。请在结束时间后导入新报表再试。${detail}`;
  }
  if (/还没有新的已完成导入|缺少.*指标|指标快照.*不完整/.test(detail)) {
    return `判定数据尚不完整：${detail}请先到数据采集导入观察窗结束后的 8 类报表，再点击“检查并判定”。`;
  }
  return detail;
}
