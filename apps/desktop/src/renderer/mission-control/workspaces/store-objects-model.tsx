import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toUserFacingError } from '../../user-facing-error';
import {
  Archive,
  ArrowsClockwise,
  CalendarDots,
  CaretLeft,
  CaretRight,
  Check,
  NotePencil,
  Package,
  PencilSimple,
  Plus,
  X,
} from '@phosphor-icons/react';
import {
  canonicalizeAmazonAsin,
  inspectAmazonAsin,
  missionControlContextKey,
  type ProductCost,
  type StoreContextEnvelope,
  type StoreId,
} from '@amazon-ai-ops/shared-types';
import {
  PriorityDataTable,
  WorkbenchPanel,
  WorkspaceState,
  type PriorityDataTableColumn,
} from '../../components/workspace';
import { useOverlayFocusScope } from '../../components/workspace/overlay-focus-scope';
import { VersionedProductView, VersionedOperationEventView, ProductDraft, EventDraft, ProductMutationInput, OperationEventMutationInput, StoreObjectsRendererApi, ObjectsSubview, PendingAction, StoreScopedObjectsPanelProps, COST_FIELDS, PERCENT_FIELDS, EVENT_PAGE_SIZE, EVENT_TYPE_LABELS, EVENT_IMPACT_LABELS } from './store-objects-contracts';

export function operationEventIsArchived(event: VersionedOperationEventView): boolean {
  return Boolean(event.archivedAt);
}

export function operationEventTypeLabel(value: string): string {
  return EVENT_TYPE_LABELS[value] ?? value.replaceAll('_', ' ');
}

export function operationEventImpactLabel(value?: string): string {
  if (!value) return '待观察';
  return EVENT_IMPACT_LABELS[value] ?? value.replaceAll('_', ' ');
}

export function paginateOperationEvents(
  events: readonly VersionedOperationEventView[],
  requestedPage: number,
  pageSize = EVENT_PAGE_SIZE,
) {
  const safePageSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : EVENT_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(events.length / safePageSize));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), pageCount);
  const offset = (page - 1) * safePageSize;
  return {
    page,
    pageCount,
    start: events.length === 0 ? 0 : offset + 1,
    end: Math.min(offset + safePageSize, events.length),
    rows: events.slice(offset, offset + safePageSize),
  };
}

export function resultBelongsToStore(
  value: { storeId: StoreId },
  context: StoreContextEnvelope,
): boolean {
  return String(value.storeId) === String(context.storeId);
}

export function responseBelongsToRequest(
  currentAuthorityKey: string,
  capturedAuthorityKey: string,
  currentSequence: number,
  capturedSequence: number,
): boolean {
  return currentAuthorityKey === capturedAuthorityKey
    && currentSequence === capturedSequence;
}

export function readApi(): StoreObjectsRendererApi | null {
  const candidate = (window as unknown as { electronAPI?: Partial<StoreObjectsRendererApi> }).electronAPI;
  if (!candidate) return null;
  const required = [
    'listStoreProducts',
    'createStoreProduct',
    'updateStoreProduct',
    'archiveStoreProduct',
    'listStoreOperationEvents',
    'createStoreOperationEvent',
    'updateStoreOperationEvent',
    'deleteStoreOperationEvent',
  ] as const;
  return required.every((key) => typeof candidate[key] === 'function')
    ? candidate as StoreObjectsRendererApi
    : null;
}

export function errorMessage(error: unknown): string {
  return toUserFacingError(error, '操作未完成，请重新读取当前店铺后再试。');
}

export function money(value?: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value ?? 0);
}

export function percent(value?: number): string {
  return `${((value ?? 0) * 100).toFixed(1)}%`;
}

export function ProductStatus({ status }: { status: string }) {
  const label = status === 'archived' ? '已归档' : status === 'inactive' ? '已停用' : '运行中';
  return <span className="store-object-status" data-object-status={status}>{label}</span>;
}

export function OperationEventStatus({ event }: { event: VersionedOperationEventView }) {
  if (operationEventNeedsReconciliation(event)) {
    return <span className="store-object-status" data-object-status="reconcile">待对账 · 只读</span>;
  }
  return operationEventIsArchived(event)
    ? <span className="store-object-status" data-object-status="archived">已归档</span>
    : null;
}

export function operationEventNeedsReconciliation(event: VersionedOperationEventView): boolean {
  return event.asinValid === false || event.evidenceRefValid === false;
}

export function operationEventReconciliationReason(event: VersionedOperationEventView): string {
  const reasons = [
    event.asinValid === false ? '历史 ASIN 无效' : '',
    event.evidenceRefValid === false ? '历史证据引用未通过当前店铺 Artifact 校验' : '',
  ].filter(Boolean);
  return reasons.length > 0 ? `${reasons.join('；')}，完成对账前禁止修改、归档或恢复。` : '';
}
