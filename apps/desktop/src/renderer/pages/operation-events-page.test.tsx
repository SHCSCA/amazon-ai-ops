import { describe, expect, it } from 'vitest';
import {
  buildOperationEventDraftForScope,
  filterOperationEventsForView,
  operationEventScopeLabel,
} from './operation-events-page';
import type { OperationEventView, OperationScope } from '../types';

describe('operation events page product/global views', () => {
  const scope: OperationScope = {
    dateFrom: '2026-06-01',
    dateTo: '2026-06-12',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    currency: 'USD',
  };

  it('filters global view to global events only', () => {
    const rows = filterOperationEventsForView([
      event({ id: 1, asin: undefined, title: 'Prime event' }),
      event({ id: 2, asin: 'B001', title: 'Product coupon' }),
    ], 'global', scope.asin);

    expect(rows.map((item) => item.title)).toEqual(['Prime event']);
  });

  it('filters product view to selected product events plus global events', () => {
    const rows = filterOperationEventsForView([
      event({ id: 1, asin: undefined, title: 'Prime event' }),
      event({ id: 2, asin: 'B001', title: 'Product coupon' }),
      event({ id: 3, asin: 'B002', title: 'Other product coupon' }),
    ], 'product', scope.asin);

    expect(rows.map((item) => item.title)).toEqual(['Prime event', 'Product coupon']);
  });

  it('defaults new event drafts to current product scope when ASIN is selected', () => {
    expect(buildOperationEventDraftForScope(scope, 'product')).toMatchObject({
      asin: 'B001',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
    });
    expect(buildOperationEventDraftForScope(scope, 'global')).toMatchObject({
      asin: '',
      campaignName: '',
      adGroupName: '',
    });
  });

  it('labels event scopes for operator UI', () => {
    expect(operationEventScopeLabel(event({ asin: undefined }), 'B001')).toBe('全局');
    expect(operationEventScopeLabel(event({ asin: 'B001' }), 'B001')).toBe('产品');
    expect(operationEventScopeLabel(event({ asin: 'B001', campaignName: 'SP exact' }), 'B001')).toBe('广告对象');
  });
});

function event(patch: Partial<OperationEventView>): OperationEventView {
  return {
    id: patch.id || 1,
    eventDate: '2026-06-01',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: patch.asin,
    campaignName: patch.campaignName,
    adGroupName: patch.adGroupName,
    eventType: 'coupon',
    title: patch.title || 'Event',
    impactExpectation: 'unknown',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}
