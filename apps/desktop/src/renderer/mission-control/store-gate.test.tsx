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
  return renderToStaticMarkup(
    <MissionControlStoreGateView
      error={null}
      onCreate={vi.fn(async () => store)}
      onRetry={vi.fn()}
      onSwitch={vi.fn()}
      phase="needs-selection"
      stores={[]}
      {...overrides}
    >
      <div>workspace</div>
    </MissionControlStoreGateView>,
  );
}

describe('Mission Control StoreGate', () => {
  it('keeps the shared left StoreScopeSwitcher as the only create and switch entry', () => {
    const markup = render();
    expect(markup).toContain('data-state="needs-selection"');
    expect(markup).toContain('class="store-scope-switcher');
    expect(markup).toContain('新增店铺');
    expect(markup).toContain('从左侧新增或选择店铺');
    expect(markup).toContain('应用已经进入');
    expect(markup).toContain('创建后保持未选择');
    expect(markup).not.toContain('mission-control-store-gate__card--create');
    expect(markup).not.toContain('mission-control-store-gate__create-form');
    expect(markup).not.toContain('<select');
    expect(markup).not.toContain('管理店铺');
  });

  it('requires an explicit store switch without presenting login as the navigation action', () => {
    const markup = render({ stores: [store] });
    expect(markup).toContain('SHC001');
    expect(markup).toContain('切换店铺');
    expect(markup).not.toContain('切换并登录');
    expect(markup).not.toContain('aria-selected="true"');
    expect(markup).not.toContain('进入所选店铺');
  });

  it('exposes safe loading, switching, and error states without a second CRUD form', () => {
    expect(render({ phase: 'loading' })).toContain('正在读取店铺范围');
    expect(render({ phase: 'switching', stores: [store] })).toContain('正在切换店铺');
    const failed = render({ phase: 'error', error: 'Main unavailable' });
    expect(failed).toContain('店铺上下文暂不可用');
    expect(failed).toContain('Main unavailable');
    expect(failed).toContain('重试');
    expect(failed).not.toContain('mission-control-store-gate__create-form');
  });

  it('renders the real workspace only after Main reports a ready authority', () => {
    const markup = render({ phase: 'ready', stores: [store] });
    expect(markup).toBe('<div>workspace</div>');
  });
});
