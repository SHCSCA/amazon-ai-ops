import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STORE_RUNTIME_CONFIG_VALUES,
  STORE_RUNTIME_CONFIG_CAPABILITY_IDS,
  readStoreRuntimeConfigApi,
  runtimeConfigRevisionDisplayLabel,
  validateStoreRuntimeConfigDraft,
} from './store-runtime-config-panel';

describe('StoreRuntimeConfigPanel contract', () => {
  it('validates the complete US/USD operating draft before Main mutations', () => {
    expect(validateStoreRuntimeConfigDraft(DEFAULT_STORE_RUNTIME_CONFIG_VALUES)).toEqual({});
    expect(validateStoreRuntimeConfigDraft({
      ...DEFAULT_STORE_RUNTIME_CONFIG_VALUES,
      collectionScheduleLocalTime: '25:00',
      analysisWindowDays: 2,
      minimumRecommendationConfidencePercent: 20,
      evidenceRetentionDays: 1,
    })).toMatchObject({
      collectionScheduleLocalTime: expect.any(String),
      analysisWindowDays: expect.any(String),
      minimumRecommendationConfidencePercent: expect.any(String),
      evidenceRetentionDays: expect.any(String),
    });
  });

  it('accepts only the complete closed preload API surface', () => {
    const complete = {
      getStoreRuntimeConfig: vi.fn(),
      createStoreRuntimeConfig: vi.fn(),
      updateStoreRuntimeConfig: vi.fn(),
      archiveStoreRuntimeConfig: vi.fn(),
      restoreStoreRuntimeConfig: vi.fn(),
    };
    expect(readStoreRuntimeConfigApi({ electronAPI: complete })).toBe(complete);
    expect(readStoreRuntimeConfigApi({ electronAPI: { ...complete, restoreStoreRuntimeConfig: undefined } })).toBeNull();
    expect(readStoreRuntimeConfigApi({})).toBeNull();
  });

  it('keeps every CRUD control capability-bound and excludes execution safety duplication', () => {
    const source = readFileSync(new URL('./store-runtime-config-panel.tsx', import.meta.url), 'utf8');
    for (const capabilityId of Object.values(STORE_RUNTIME_CONFIG_CAPABILITY_IDS)) {
      expect(source).toContain(capabilityId);
    }
    expect(source).toContain('expectedRevision');
    expect(source).toContain('US / USD');
    expect(source).not.toContain('maxBidChangePercent');
    expect(source).not.toContain('killSwitch');
    expect(source).not.toContain('localStorage');
  });

  it('shows configuration version checks without exposing the internal revision number', () => {
    expect(runtimeConfigRevisionDisplayLabel(12)).toBe('版本已校验');
  });
});
