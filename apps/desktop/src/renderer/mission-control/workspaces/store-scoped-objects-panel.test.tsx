import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  StoreScopedObjectsPanel,
  buildEventCreateInput,
  buildEventRestoreInput,
  buildEventUpdateInput,
  buildProductCreateInput,
  buildProductRestoreInput,
  buildProductUpdateInput,
  responseBelongsToRequest,
  resultBelongsToStore,
  operationEventIsArchived,
  operationEventNeedsReconciliation,
  operationEventImpactLabel,
  operationEventTypeLabel,
  paginateOperationEvents,
  type EventDraft,
  type ProductDraft,
  type VersionedOperationEventView,
  type VersionedProductView,
} from './store-scoped-objects-panel';

const context = {
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 3,
} as StoreContextEnvelope;

const product = {
  id: 7,
  storeId: context.storeId,
  marketplace_code: 'US',
  store_name: 'SHC001',
  asin: 'B0TEST0001',
  asinValid: true,
  parent_asin: '',
  msku: 'MSKU-1',
  sku: 'SKU-1',
  title: 'Example product',
  product_stage: 'growth',
  status: 'active',
  created_at: '2026-07-22 00:00:00',
  updated_at: '2026-07-22 00:00:01',
  revision: 'product-v1:abc',
  cost: {
    productId: 7,
    purchaseCost: 10,
    firstLegCost: 1,
    fbaFee: 3,
    referralFeeRate: 0.15,
    storageFee: 0.5,
    otherCost: 0,
    currentPrice: 29.99,
    minPrice: 24.99,
    targetNetMargin: 0.2,
    targetAcos: 0.28,
    targetTacos: 0.12,
  },
} as VersionedProductView;

const productDraft: ProductDraft = {
  asin: ' b0test0001 ',
  parentAsin: '',
  msku: ' MSKU-1 ',
  sku: ' SKU-1 ',
  title: ' Updated ',
  productStage: 'profit',
  status: 'active',
  purchaseCost: '10.50',
  firstLegCost: '1.25',
  fbaFee: '3',
  referralFeeRate: '15',
  storageFee: '0.5',
  otherCost: '0',
  currentPrice: '29.99',
  minPrice: '24.99',
  targetNetMargin: '20',
  targetAcos: '28',
  targetTacos: '12',
};

describe('StoreScopedObjectsPanel', () => {
  it('renders product and event CRUD entry points for the current US/USD store', () => {
    const markup = renderToStaticMarkup(<StoreScopedObjectsPanel storeContext={context} />);
    expect(markup).toContain('产品与成本');
    expect(markup).toContain('运营事件');
    expect(markup).toContain('新建产品');
    expect(markup).toContain('data-action-priority="primary"');
    expect(markup).toContain('当前店铺 · 美国站 / USD');
    expect(markup).not.toContain('>store-one · US / USD<');
    expect(markup).toContain('查询 ASIN / 标题 / SKU');
    expect(markup).not.toContain('PRODUCT DIRECTORY ADAPTER');
  });

  it('fails closed when there is no authoritative store context', () => {
    const markup = renderToStaticMarkup(<StoreScopedObjectsPanel storeContext={null} />);
    expect(markup).toContain('尚未确认当前店铺');
    expect(markup).toContain('请先选择并确认店铺，确认后才会开放该店铺的产品与运营事件读写。');
    expect(markup).not.toMatch(/Main|StoreContext/);
    expect(markup).not.toContain('新建产品');
  });

  it('explains percentage inputs without exposing the internal save process', () => {
    const source = readFileSync(new URL('./store-scoped-objects-panel.tsx', import.meta.url), 'utf8');

    expect(source).toContain('界面按百分比填写，保存时自动换算，无需手动输入小数');
    expect(source).not.toContain('Main 保存为 0–1 比率');
  });

  it('builds USD product writes and keeps the displayed revision as the CAS precondition', () => {
    const create = buildProductCreateInput(productDraft);
    expect(create).toMatchObject({ asin: 'B0TEST0001', marketplace: 'US', currency: 'USD' });
    expect(create.cost).toMatchObject({
      purchaseCost: 10.5,
      referralFeeRate: 0.15,
      targetNetMargin: 0.2,
      targetAcos: 0.28,
      targetTacos: 0.12,
    });

    const update = buildProductUpdateInput(product, productDraft);
    expect(update.id).toBe(7);
    expect(update.expectedRevision).toBe('product-v1:abc');
    expect(update.patch).toMatchObject({ title: 'Updated', marketplace: 'US', currency: 'USD' });
    expect(update).not.toHaveProperty('expectedUpdatedAt');

    expect(buildProductRestoreInput({ ...product, status: 'archived' })).toEqual({
      id: 7,
      expectedRevision: 'product-v1:abc',
      patch: { status: 'active' },
    });
  });

  it('rejects non-canonical product and scoped-event ASINs before calling Main', () => {
    expect(() => buildProductCreateInput({ ...productDraft, asin: 'B001' }))
      .toThrow(/exactly 10 ASCII/i);
    expect(() => buildEventCreateInput({
      eventDate: '2026-07-22',
      title: 'Invalid scoped event',
      eventType: 'manual_note',
      impactExpectation: 'unknown',
      asin: 'B001',
      campaignName: '',
      adGroupName: '',
      notes: '',
    })).toThrow(/exactly 10 ASCII/i);
  });

  it('keeps operation-event updates store-authorized and revision-locked', () => {
    const event = {
      id: 9,
      storeId: context.storeId,
      eventDate: '2026-07-22',
      storeName: 'SHC001',
      marketplaceCode: 'US',
      asinValid: true,
      eventType: 'coupon',
      title: 'Coupon started',
      evidenceRefValid: true,
      createdAt: '2026-07-22 00:00:00',
      updatedAt: '2026-07-22 00:00:00',
      revision: 'operation-event-v1:def',
    } as VersionedOperationEventView;
    const draft: EventDraft = {
      eventDate: '2026-07-23',
      title: ' Coupon extended ',
      eventType: 'coupon',
      impactExpectation: 'conversion_up',
      asin: ' b0test0001 ',
      campaignName: '',
      adGroupName: '',
      notes: ' seven more days ',
    };
    expect(buildEventUpdateInput(event, draft)).toEqual({
      id: 9,
      expectedRevision: 'operation-event-v1:def',
      patch: {
        eventDate: '2026-07-23',
        title: 'Coupon extended',
        eventType: 'coupon',
        impactExpectation: 'conversion_up',
        asin: 'B0TEST0001',
        campaignName: undefined,
        adGroupName: undefined,
        notes: 'seven more days',
        marketplace: 'US',
        currency: 'USD',
      },
    });

    const archived = {
      ...event,
      archivedAt: '2026-07-22 10:00:00',
      archiveRevision: 1,
      revision: 'operation-event-v1:archived',
    };
    expect(operationEventIsArchived(archived)).toBe(true);
    expect(buildEventRestoreInput(archived)).toEqual({
      id: 9,
      expectedRevision: 'operation-event-v1:archived',
      patch: { archived: false },
    });
    expect(operationEventIsArchived({ ...archived, archivedAt: undefined })).toBe(false);
    expect(operationEventNeedsReconciliation(event)).toBe(false);
    expect(operationEventNeedsReconciliation({ ...event, asinValid: false })).toBe(true);
    expect(operationEventNeedsReconciliation({ ...event, evidenceRefValid: false })).toBe(true);
  });

  it('presents event removal as recoverable archive with explicit history access', () => {
    const source = readFileSync(new URL('./store-scoped-objects-panel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('查看已归档事件');
    expect(source).toContain('不会被删除');
    expect(source).toContain('精准检索并恢复');
    expect(source).not.toContain('确认删除');
    expect(source).not.toContain('已删除。');
  });

  it('uses operator labels and bounded pages for dense event history', () => {
    expect(operationEventTypeLabel('listing_change')).toBe('Listing 调整');
    expect(operationEventImpactLabel('conversion_up')).toBe('转化上升');
    expect(operationEventImpactLabel()).toBe('待观察');
    const events = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
    })) as VersionedOperationEventView[];
    expect(paginateOperationEvents(events, 2)).toMatchObject({
      page: 2,
      pageCount: 5,
      start: 7,
      end: 12,
      rows: events.slice(6, 12),
    });
    expect(paginateOperationEvents(events, 99)).toMatchObject({
      page: 5,
      start: 25,
      end: 25,
      rows: events.slice(24),
    });
  });

  it('rejects rows from a different logical store before renderer state is updated', () => {
    expect(resultBelongsToStore(product, context)).toBe(true);
    expect(resultBelongsToStore({ ...product, storeId: 'store-two' as typeof product.storeId }, context)).toBe(false);
  });

  it('rejects late same-store reads and mutations after a newer request sequence starts', () => {
    expect(responseBelongsToRequest('authority-a', 'authority-a', 8, 8)).toBe(true);
    expect(responseBelongsToRequest('authority-a', 'authority-a', 9, 8)).toBe(false);
    expect(responseBelongsToRequest('authority-b', 'authority-a', 8, 8)).toBe(false);
  });
});
