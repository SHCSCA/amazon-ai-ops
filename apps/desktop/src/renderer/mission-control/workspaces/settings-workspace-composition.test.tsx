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

describe('settings workspace composition', () => {
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
    expect(markup).toContain('STORE CONFIG CRUD');
    expect(markup).toContain('SYSTEM AI');
    expect(markup.indexOf('STORE CONFIG CRUD')).toBeLessThan(markup.indexOf('SYSTEM AI'));
    expect(markup).toContain('US / USD');
  });
});
