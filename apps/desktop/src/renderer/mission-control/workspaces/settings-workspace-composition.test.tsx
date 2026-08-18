import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MissionControlCapabilityProjection, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  normalizeBrowserProfileId,
  normalizeBusinessDate,
  normalizeSessionGeneration,
  normalizeStoreId,
} from '@amazon-ai-ops/shared-types';
import { LegacyWorkspace } from './legacy-workspace';

const context: StoreContextEnvelope = {
  storeId: normalizeStoreId('shc001'),
  browserProfileId: normalizeBrowserProfileId('profile-shc001'),
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: normalizeBusinessDate('2026-07-22'),
  sessionGeneration: normalizeSessionGeneration(4),
};

function capability(
  capabilityId: string,
  action: MissionControlCapabilityProjection['action'],
  state: MissionControlCapabilityProjection['state'],
): MissionControlCapabilityProjection {
  return {
    capabilityId,
    workspace: 'settings',
    view: 'settings/ai-and-local',
    action,
    state,
    legacyRoute: state === 'LEGACY_ADAPTER' ? 'settings' : undefined,
    detail: capabilityId,
  };
}

function ordinaryVisibleText(markup: string): string {
  return markup
    .replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('settings workspace composition', () => {
  it('shows business-safe loading and blocking guidance with technical detail collapsed', () => {
    const loading = renderToStaticMarkup(
      <LegacyWorkspace
        description="系统设置"
        intent={{ workspace: 'settings', subview: 'ai-and-local' }}
        route="settings"
        storeContext={context}
        title="系统设置"
        view="settings/ai-and-local"
      />,
    );
    const blocked = renderToStaticMarkup(
      <LegacyWorkspace
        capabilities={[{
          ...capability('settings.ai-and-local.view', 'view', 'BLOCKED'),
          detail: 'Main Settings Authority rejected StoreContext Profile',
        }]}
        description="系统设置"
        intent={{ workspace: 'settings', subview: 'ai-and-local' }}
        route="settings"
        storeContext={context}
        title="系统设置"
        view="settings/ai-and-local"
      />,
    );

    expect(ordinaryVisibleText(loading)).toContain('正在确认系统连接能力，请稍候。');
    expect(ordinaryVisibleText(blocked)).toContain('系统连接暂不可用，请刷新后重试；仍失败时查看诊断详情。');
    expect(ordinaryVisibleText(`${loading}${blocked}`))
      .not.toMatch(/Main|StoreContext|Authority|Renderer|Profile|CRUD|PRODUCTION_NATIVE|LEGACY_ADAPTER/i);
    expect(blocked).toContain('诊断详情');
    expect(blocked).toContain('Main Settings Authority rejected StoreContext Profile');
  });

  it('renders one page heading above native store CRUD and the adapted system AI surface', () => {
    const markup = renderToStaticMarkup(
      <LegacyWorkspace
        capabilities={[
          capability('settings.ai-and-local.view', 'view', 'LEGACY_ADAPTER'),
          capability('settings.store-config.create', 'create', 'PRODUCTION_NATIVE'),
          capability('settings.store-config.update', 'update', 'PRODUCTION_NATIVE'),
          capability('settings.store-config.archive', 'archive', 'PRODUCTION_NATIVE'),
          capability('settings.store-config.restore', 'restore', 'PRODUCTION_NATIVE'),
        ]}
        description="系统设置"
        intent={{ workspace: 'settings', subview: 'ai-and-local' }}
        legacySlot={<div data-testid="system-ai">SYSTEM AI</div>}
        route="settings"
        settingsCrudSlot={<div data-testid="store-config">STORE CONFIG CRUD</div>}
        storeContext={context}
        title="系统设置"
        view="settings/ai-and-local"
      />,
    );

    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain('店铺与运行设置');
    expect(markup).toContain('检查店铺连接');
    expect(markup).toContain('data-action-priority="primary"');
    expect(markup).toContain('STORE CONFIG CRUD');
    expect(markup).toContain('SYSTEM AI');
    expect(markup.indexOf('STORE CONFIG CRUD')).toBeLessThan(markup.indexOf('SYSTEM AI'));
    expect(markup).toContain('US / USD');
  });
});
