import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { normalizeStoreId, type StoreRecord } from '@amazon-ai-ops/shared-types';
import { MissionControlStoreGateView } from './store-gate';

const store: StoreRecord = {
  storeId: normalizeStoreId('store-one'),
  browserProfileId: 'profile-one' as StoreRecord['browserProfileId'],
  marketplace: 'US',
  currency: 'USD',
  displayName: 'SHC001',
  status: 'active',
  businessTimezone: 'America/Los_Angeles',
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
};

function render(overrides: Partial<Parameters<typeof MissionControlStoreGateView>[0]> = {}) {
  return renderToStaticMarkup(<MissionControlStoreGateView
    phase="needs-selection"
    stores={[]}
    error={null}
    selectedStoreId=""
    onSelectedStoreIdChange={vi.fn()}
    onConfirm={vi.fn()}
    onRetry={vi.fn()}
    createDisplayName=""
    onCreateDisplayNameChange={vi.fn()}
    creating={false}
    createError={null}
    onCreate={vi.fn()}
    {...overrides}
  >
    <div>workspace</div>
  </MissionControlStoreGateView>);
}

describe('Mission Control StoreGate', () => {
  it('has no zero-store dead end and keeps US/USD/timezone fixed', () => {
    const markup = render();
    expect(markup).toContain('data-state="needs-selection"');
    expect(markup).toContain('mission-control-store-gate__card--create');
    expect(markup).toContain('创建美国站店铺');
    expect(markup).toContain('<strong>US</strong>');
    expect(markup).toContain('<strong>USD</strong>');
    expect(markup).toContain('<strong>America/Los_Angeles</strong>');
    expect(markup).toContain('创建后仍需由你明确选择并确认进入');
  });

  it('never preselects a store and requires explicit confirmation', () => {
    const markup = render({ stores: [store] });
    expect(markup).toContain('<option value="" selected="">请选择店铺</option>');
    expect(markup).toContain('进入所选店铺');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>进入所选店铺/);
  });

  it('exposes stable busy and error states for styling', () => {
    expect(render({ phase: 'loading' })).toContain('data-state="loading"');
    const createBusy = render({ creating: true, createDisplayName: 'SHC002' });
    expect(createBusy).toContain('aria-busy="true"');
    expect(createBusy).toContain('创建中…');
    const failed = render({ createError: '名称已存在' });
    expect(failed).toContain('mission-control-store-gate__error');
    expect(failed).toContain('名称已存在');
    const loadFailed = render({ phase: 'error', error: 'Main unavailable' });
    expect(loadFailed).toContain('data-state="error"');
    expect(loadFailed).toContain('重新读取');
  });
});
