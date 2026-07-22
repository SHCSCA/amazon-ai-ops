import { describe, expect, it } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  captureMissionControlRequest,
  isMissionControlResponseCurrent,
} from './request-guard';

const context = normalizeStoreContextEnvelope({
  storeId: 'store-one', browserProfileId: 'profile-one', marketplace: 'US', currency: 'USD',
  businessTimezone: 'America/Los_Angeles', businessDate: '2026-07-22', sessionGeneration: 1,
});

describe('Mission Control renderer response guard', () => {
  it('accepts only the exact request, epoch, and full authority key', () => {
    const capture = captureMissionControlRequest('request-1', 2, context);
    const response = {
      requestId: 'request-1', contextEpoch: 2, authoritativeContext: context,
      completedAt: '2026-07-22T12:00:00.000Z',
    };
    expect(isMissionControlResponseCurrent(response, capture, { contextEpoch: 2, context })).toBe(true);
    expect(isMissionControlResponseCurrent(response, capture, { contextEpoch: 3, context })).toBe(false);
    expect(isMissionControlResponseCurrent(response, capture, { contextEpoch: 2, context: null })).toBe(false);
    expect(isMissionControlResponseCurrent({ ...response, requestId: 'late' }, capture, {
      contextEpoch: 2, context,
    })).toBe(false);
  });

  it('rejects business-date and generation changes', () => {
    const capture = captureMissionControlRequest('request-1', 2, context);
    const nextDate = { ...context, businessDate: '2026-07-23' as typeof context.businessDate };
    const nextGeneration = { ...context, sessionGeneration: 2 };
    const response = {
      requestId: 'request-1', contextEpoch: 2, authoritativeContext: context,
      completedAt: '2026-07-22T12:00:00.000Z',
    };
    expect(isMissionControlResponseCurrent(response, capture, { contextEpoch: 2, context: nextDate })).toBe(false);
    expect(isMissionControlResponseCurrent(response, capture, { contextEpoch: 2, context: nextGeneration })).toBe(false);
  });
});
