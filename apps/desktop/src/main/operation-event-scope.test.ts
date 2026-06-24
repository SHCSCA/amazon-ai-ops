import { describe, expect, it } from 'vitest';
import type { OperationEvent } from '@amazon-ai-ops/shared-types';
import {
  filterBusinessPipelineOperationEvents,
  operationEventIsGlobal,
  operationEventMatchesProduct,
} from './operation-event-scope';

describe('operation event scope helpers', () => {
  it('identifies global events without product or ad-object binding', () => {
    expect(operationEventIsGlobal(event({ asin: undefined, campaignName: undefined, adGroupName: undefined }))).toBe(true);
    expect(operationEventIsGlobal(event({ asin: 'B001' }))).toBe(false);
    expect(operationEventIsGlobal(event({ campaignName: 'SP exact' }))).toBe(false);
  });

  it('matches product events case-insensitively and excludes other products', () => {
    expect(operationEventMatchesProduct(event({ asin: 'b001' }), 'B001')).toBe(true);
    expect(operationEventMatchesProduct(event({ asin: 'B002' }), 'B001')).toBe(false);
    expect(operationEventMatchesProduct(event({ asin: undefined }), 'B001')).toBe(false);
  });

  it('keeps selected product events plus global events for product-scoped business data', () => {
    const result = filterBusinessPipelineOperationEvents({
      scopeAsin: 'B001',
      events: [
        event({ id: 1, asin: 'B001', title: 'Product coupon' }),
        event({ id: 2, asin: undefined, title: 'Prime event' }),
        event({ id: 3, asin: 'B002', title: 'Other product coupon' }),
      ],
    });

    expect(result.map((item) => item.title)).toEqual(['Product coupon', 'Prime event']);
  });

  it('keeps all events when no product is selected', () => {
    const result = filterBusinessPipelineOperationEvents({
      scopeAsin: undefined,
      events: [
        event({ id: 1, asin: 'B001', title: 'Product coupon' }),
        event({ id: 2, asin: undefined, title: 'Prime event' }),
      ],
    });

    expect(result.map((item) => item.title)).toEqual(['Product coupon', 'Prime event']);
  });
});

function event(patch: Partial<OperationEvent>): OperationEvent {
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
    notes: undefined,
    evidencePath: undefined,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}
