import { describe, expect, it } from 'vitest';
import {
  normalizeListStoreDailyStatusesInput,
  normalizeOperatorWorkspaceSelection,
} from './store-daily-status';

describe('store daily status contracts', () => {
  it('normalizes one explicit US operator selection without carrying browser authority', () => {
    expect(normalizeOperatorWorkspaceSelection({
      schemaVersion: 1,
      storeId: ' Store-One ',
      marketplace: 'us',
      selectedAt: '2026-08-04T08:00:00+08:00',
    })).toEqual({
      schemaVersion: 1,
      storeId: 'store-one',
      marketplace: 'US',
      selectedAt: '2026-08-04T00:00:00.000Z',
    });
  });

  it('fails closed for missing marketplace or corrupt persisted selection', () => {
    expect(() => normalizeListStoreDailyStatusesInput({})).toThrow(/marketplace is required/);
    expect(() => normalizeListStoreDailyStatusesInput({ marketplace: 'CA' }))
      .toThrow(/supports marketplace US only/);
    expect(() => normalizeOperatorWorkspaceSelection({
      schemaVersion: 1,
      storeId: 'store-one',
      marketplace: 'US',
      selectedAt: 'not-a-time',
    })).toThrow(/selectedAt/);
  });

  it('preserves explicit include flags and rejects non-boolean filters', () => {
    expect(normalizeListStoreDailyStatusesInput({
      marketplace: 'US',
      includeInactive: true,
      includeArchived: false,
    })).toEqual({
      marketplace: 'US',
      includeInactive: true,
      includeArchived: false,
    });
    expect(() => normalizeListStoreDailyStatusesInput({
      marketplace: 'US',
      includeInactive: 'yes',
    })).toThrow(/includeInactive/);
  });
});
