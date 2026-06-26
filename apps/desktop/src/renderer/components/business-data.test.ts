import { describe, expect, it } from 'vitest';
import { BUSINESS_PIPELINE_SCOPE_DEBOUNCE_MS, businessPipelineLoadDelay } from './business-data';

describe('business data pipeline scope debounce', () => {
  it('keeps first load and explicit reload immediate while debouncing scope-only reloads', () => {
    expect(businessPipelineLoadDelay({ firstLoad: true, reloadChanged: false })).toBe(0);
    expect(businessPipelineLoadDelay({ firstLoad: false, reloadChanged: true })).toBe(0);
    expect(businessPipelineLoadDelay({ firstLoad: false, reloadChanged: false })).toBe(BUSINESS_PIPELINE_SCOPE_DEBOUNCE_MS);
    expect(BUSINESS_PIPELINE_SCOPE_DEBOUNCE_MS).toBe(300);
  });
});
