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


export type VersionedProductView = {
  id: number;
  storeId: StoreId;
  marketplace_code: string;
  store_name: string;
  asin: string;
  asinValid: boolean;
  parent_asin: string;
  msku: string;
  sku: string;
  title: string;
  product_stage: string;
  status: string;
  created_at: string;
  updated_at: string;
  cost?: ProductCost;
  revision: string;
};

export type VersionedOperationEventView = {
  id: number;
  storeId: StoreId;
  eventDate: string;
  storeName: string;
  marketplaceCode: string;
  asin?: string;
  asinValid: boolean;
  campaignName?: string;
  adGroupName?: string;
  eventType: string;
  title: string;
  impactExpectation?: string;
  notes?: string;
  evidenceArtifactId?: string;
  evidenceRefValid: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  archiveRevision: number;
  revision: string;
};

export type ProductDraft = {
  asin: string;
  parentAsin: string;
  msku: string;
  sku: string;
  title: string;
  productStage: string;
  status: 'active' | 'inactive';
  purchaseCost: string;
  firstLegCost: string;
  fbaFee: string;
  referralFeeRate: string;
  storageFee: string;
  otherCost: string;
  currentPrice: string;
  minPrice: string;
  targetNetMargin: string;
  targetAcos: string;
  targetTacos: string;
};

export type EventDraft = {
  eventDate: string;
  title: string;
  eventType: string;
  impactExpectation: string;
  asin: string;
  campaignName: string;
  adGroupName: string;
  notes: string;
};

export type ProductMutationInput = {
  id: number;
  expectedRevision: string;
  patch: Record<string, unknown>;
  cost?: Record<string, number>;
};

export type OperationEventMutationInput = {
  id: number;
  expectedRevision: string;
  patch: Record<string, unknown>;
};

export type StoreObjectsRendererApi = {
  listStoreProducts(context: StoreContextEnvelope, input?: { includeArchived?: boolean }): Promise<VersionedProductView[]>;
  createStoreProduct(context: StoreContextEnvelope, input: Record<string, unknown>): Promise<VersionedProductView>;
  updateStoreProduct(context: StoreContextEnvelope, input: ProductMutationInput): Promise<VersionedProductView>;
  archiveStoreProduct(context: StoreContextEnvelope, input: { id: number; expectedRevision: string }): Promise<VersionedProductView>;
  listStoreOperationEvents(context: StoreContextEnvelope, input?: { limit?: number; includeArchived?: boolean }): Promise<VersionedOperationEventView[]>;
  createStoreOperationEvent(context: StoreContextEnvelope, input: Record<string, unknown>): Promise<VersionedOperationEventView>;
  updateStoreOperationEvent(context: StoreContextEnvelope, input: OperationEventMutationInput): Promise<VersionedOperationEventView>;
  deleteStoreOperationEvent(context: StoreContextEnvelope, input: { id: number; expectedRevision: string }): Promise<VersionedOperationEventView>;
};

export type ObjectsSubview = 'products' | 'events';

export type PendingAction = 'load' | 'save-product' | 'archive-product' | 'restore-product' | 'save-event' | 'archive-event' | 'restore-event';

export type StoreScopedObjectsPanelProps = {
  storeContext: StoreContextEnvelope | null;
  fixedSubview?: ObjectsSubview;
};

export const COST_FIELDS = [
  'purchaseCost',
  'firstLegCost',
  'fbaFee',
  'storageFee',
  'otherCost',
  'currentPrice',
  'minPrice',
] as const;

export const PERCENT_FIELDS = [
  'referralFeeRate',
  'targetNetMargin',
  'targetAcos',
  'targetTacos',
] as const;

export const EVENT_PAGE_SIZE = 6;

export const EVENT_TYPE_LABELS: Record<string, string> = {
  manual_note: '运营备注',
  coupon: 'Coupon',
  deal: 'Deal',
  price_change: '改价',
  listing_change: 'Listing 调整',
  inventory_issue: '库存异常',
  external_traffic: '站外流量',
};

export const EVENT_IMPACT_LABELS: Record<string, string> = {
  unknown: '待观察',
  conversion_up: '转化上升',
  conversion_down: '转化下降',
  traffic_up: '流量上升',
  traffic_down: '流量下降',
  acos_up: 'ACOS 上升',
  acos_down: 'ACOS 下降',
  watch: '待观察',
};
