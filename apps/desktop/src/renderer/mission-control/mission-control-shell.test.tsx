import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StoreContextEnvelope, StoreRecord } from '@amazon-ai-ops/shared-types';
import { MissionControlShell } from './mission-control-shell';

const store = {
  storeId: 'store-jf-us',
  displayName: 'JF-US',
  browserProfileId: 'profile-jf-us',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  status: 'active',
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
} as StoreRecord;

const context = {
  storeId: store.storeId,
  browserProfileId: store.browserProfileId,
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: store.businessTimezone,
  businessDate: '2026-08-28',
  sessionGeneration: 8,
} as StoreContextEnvelope;

describe('MissionControlShell operator modules', () => {
  it('uses the six-module facade as the only daily primary navigation', () => {
    const markup = renderToStaticMarkup(
      <MissionControlShell
        activeIntent={{ workspace: 'today', subview: 'overview' }}
        activeStore={store}
        authoritativeContext={context}
        onLogout={() => undefined}
        onNavigate={() => undefined}
        onSwitchStore={() => undefined}
        stores={[store]}
      >
        <div>当前工作区</div>
      </MissionControlShell>,
    );

    expect(markup.match(/data-operator-module=/g)).toHaveLength(6);
    expect(markup).toContain('data-operator-module="today-decisions"');
    expect(markup).toContain('data-operator-module="memory-settings"');
    expect(markup).not.toContain('data-navigation-section="mission"');
    expect(markup).not.toMatch(/部分可用|PRODUCTION_NATIVE|LEGACY_ADAPTER|原型/);
  });
});
