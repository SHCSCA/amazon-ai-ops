import { describe, expect, it } from 'vitest';
import {
  BUSINESS_PIPELINE_SCOPE_DEBOUNCE_MS,
  businessPipelineLoadDelay,
  businessPipelineRequestScope,
  businessPipelineScopeKey,
} from './business-data';

describe('business data pipeline scope debounce', () => {
  it('keeps first load and explicit reload immediate while debouncing scope-only reloads', () => {
    expect(businessPipelineLoadDelay({ firstLoad: true, reloadChanged: false })).toBe(0);
    expect(businessPipelineLoadDelay({ firstLoad: false, reloadChanged: true })).toBe(0);
    expect(businessPipelineLoadDelay({ firstLoad: false, reloadChanged: false })).toBe(BUSINESS_PIPELINE_SCOPE_DEBOUNCE_MS);
    expect(BUSINESS_PIPELINE_SCOPE_DEBOUNCE_MS).toBe(300);
  });

  it('keeps the global scope untouched while portfolio reads omit the locked ASIN', () => {
    const scope = {
      dateFrom: '2026-06-01',
      dateTo: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B001',
      batchId: '18',
      currency: 'USD' as const,
    };

    expect(businessPipelineRequestScope(scope, 'portfolio')).toEqual({
      ...scope,
      asin: undefined,
    });
    expect(scope.asin).toBe('B001');
    expect(businessPipelineRequestScope(scope, 'scope')).toBe(scope);
  });

  it('does not reload a portfolio read when only the locked ASIN changes', () => {
    const baseScope = {
      dateFrom: '2026-06-01',
      dateTo: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      batchId: '18',
      currency: 'USD' as const,
    };

    expect(businessPipelineScopeKey({ ...baseScope, asin: 'B001' }, 'portfolio'))
      .toBe(businessPipelineScopeKey({ ...baseScope, asin: 'B002' }, 'portfolio'));
    expect(businessPipelineScopeKey({ ...baseScope, asin: 'B001' }, 'scope'))
      .not.toBe(businessPipelineScopeKey({ ...baseScope, asin: 'B002' }, 'scope'));
  });
});
