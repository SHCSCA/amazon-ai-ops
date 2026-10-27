import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { operationEventIsArchived, operationEventTypeLabel, operationEventImpactLabel, paginateOperationEvents, resultBelongsToStore, responseBelongsToRequest, readApi, errorMessage, money, percent, ProductStatus, OperationEventStatus, operationEventNeedsReconciliation, operationEventReconciliationReason } from './store-objects-model';

export function buildProductCreateInput(draft: ProductDraft): Record<string, unknown> {
  return {
    asin: canonicalizeAmazonAsin(draft.asin),
    parentAsin: draft.parentAsin.trim(),
    msku: draft.msku.trim(),
    sku: draft.sku.trim(),
    title: draft.title.trim(),
    productStage: draft.productStage.trim(),
    status: draft.status,
    marketplace: 'US',
    currency: 'USD',
    cost: buildCostPatch(draft),
  };
}

export function buildProductUpdateInput(
  product: VersionedProductView,
  draft: ProductDraft,
): ProductMutationInput {
  return {
    id: product.id,
    expectedRevision: product.revision,
    patch: {
      parentAsin: draft.parentAsin.trim(),
      msku: draft.msku.trim(),
      sku: draft.sku.trim(),
      title: draft.title.trim(),
      productStage: draft.productStage.trim(),
      status: draft.status,
      marketplace: 'US',
      currency: 'USD',
    },
    cost: buildCostPatch(draft),
  };
}

export function buildProductRestoreInput(product: VersionedProductView): ProductMutationInput {
  return {
    id: product.id,
    expectedRevision: product.revision,
    patch: { status: 'active' },
  };
}

export function buildEventCreateInput(draft: EventDraft): Record<string, unknown> {
  const eventAsin = draft.asin.trim();
  return {
    eventDate: draft.eventDate,
    title: draft.title.trim(),
    eventType: draft.eventType,
    impactExpectation: draft.impactExpectation || 'unknown',
    asin: eventAsin ? canonicalizeAmazonAsin(eventAsin) : undefined,
    campaignName: emptyToUndefined(draft.campaignName.trim()),
    adGroupName: emptyToUndefined(draft.adGroupName.trim()),
    notes: emptyToUndefined(draft.notes.trim()),
    marketplace: 'US',
    currency: 'USD',
  };
}

export function buildEventUpdateInput(
  event: VersionedOperationEventView,
  draft: EventDraft,
): OperationEventMutationInput {
  return {
    id: event.id,
    expectedRevision: event.revision,
    patch: buildEventCreateInput(draft),
  };
}

export function buildEventRestoreInput(
  event: VersionedOperationEventView,
): OperationEventMutationInput {
  return {
    id: event.id,
    expectedRevision: event.revision,
    patch: { archived: false },
  };
}

export function buildCostPatch(draft: ProductDraft): Record<string, number> {
  const cost: Record<string, number> = {};
  for (const field of COST_FIELDS) cost[field] = parseNumber(draft[field], field);
  for (const field of PERCENT_FIELDS) cost[field] = parsePercent(draft[field], field);
  return cost;
}

export function parseNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} 必须是不小于 0 的数字。`);
  return parsed;
}

export function parsePercent(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < (label === 'targetNetMargin' ? -100 : 0) || parsed > 100) {
    throw new Error(`${label} 必须在 ${label === 'targetNetMargin' ? '-100' : '0'}% 到 100% 之间。`);
  }
  return parsed / 100;
}

export function emptyToUndefined(value: string): string | undefined {
  return value || undefined;
}

export function productDraft(product?: VersionedProductView | null): ProductDraft {
  const cost = product?.cost;
  return {
    asin: product?.asin ?? '',
    parentAsin: product?.parent_asin ?? '',
    msku: product?.msku ?? '',
    sku: product?.sku ?? '',
    title: product?.title ?? '',
    productStage: product?.product_stage ?? 'keyword_exploration',
    status: product?.status === 'inactive' ? 'inactive' : 'active',
    purchaseCost: String(cost?.purchaseCost ?? 0),
    firstLegCost: String(cost?.firstLegCost ?? 0),
    fbaFee: String(cost?.fbaFee ?? 0),
    referralFeeRate: String((cost?.referralFeeRate ?? 0.15) * 100),
    storageFee: String(cost?.storageFee ?? 0),
    otherCost: String(cost?.otherCost ?? 0),
    currentPrice: String(cost?.currentPrice ?? 0),
    minPrice: String(cost?.minPrice ?? 0),
    targetNetMargin: String((cost?.targetNetMargin ?? 0) * 100),
    targetAcos: String((cost?.targetAcos ?? 0) * 100),
    targetTacos: String((cost?.targetTacos ?? 0) * 100),
  };
}

export function eventDraft(businessDate: string, event?: VersionedOperationEventView | null): EventDraft {
  return {
    eventDate: event?.eventDate ?? businessDate,
    title: event?.title ?? '',
    eventType: event?.eventType ?? 'manual_note',
    impactExpectation: event?.impactExpectation ?? 'unknown',
    asin: event?.asin ?? '',
    campaignName: event?.campaignName ?? '',
    adGroupName: event?.adGroupName ?? '',
    notes: event?.notes ?? '',
  };
}
