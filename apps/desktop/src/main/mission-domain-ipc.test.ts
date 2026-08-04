import { describe, expect, it, vi } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  MISSION_DOMAIN_IPC_CHANNELS,
  MISSION_DOMAIN_IPC_ROUTES,
  registerMissionDomainIpcHandlers,
} from './mission-domain-ipc';

const storeContext = normalizeStoreContextEnvelope({
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 3,
});

describe('Mission domain fixed IPC whitelist', () => {
  it('registers exactly the fixed routes and forwards only storeContext plus input', async () => {
    const handlers = new Map<string, (event: unknown, request?: unknown) => unknown>();
    const executeOperation = vi.fn(() => ({ ok: true }));
    registerMissionDomainIpcHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { executeOperation },
    );

    expect([...handlers.keys()]).toEqual(MISSION_DOMAIN_IPC_CHANNELS);
    expect(MISSION_DOMAIN_IPC_CHANNELS).not.toContain('mission-domain:invoke' as never);
    expect(MISSION_DOMAIN_IPC_CHANNELS).not.toContain('mission-domain:grants:issue-policy' as never);
    expect(MISSION_DOMAIN_IPC_CHANNELS).not.toContain('mission-domain:grants:issue-human' as never);
    expect(MISSION_DOMAIN_IPC_CHANNELS).not.toContain('mission-domain:missions:append-link' as never);
    expect(MISSION_DOMAIN_IPC_CHANNELS).not.toContain('mission-domain:causal:append-link' as never);
    expect(MISSION_DOMAIN_IPC_CHANNELS).not.toContain('mission-domain:experiments:append-metric-snapshot' as never);
    expect(MISSION_DOMAIN_IPC_CHANNELS).not.toContain('mission-domain:grants:append-event' as never);
    expect(MISSION_DOMAIN_IPC_CHANNELS).not.toContain('mission-domain:grants:authorize' as never);
    expect(MISSION_DOMAIN_IPC_CHANNELS).not.toContain('mission-domain:policy-runtime:update' as never);
    expect(MISSION_DOMAIN_IPC_CHANNELS).not.toContain('mission-domain:causal:append-evidence-ref' as never);
    expect(MISSION_DOMAIN_IPC_CHANNELS).toContain('mission-domain:policy-runtime:set-kill-switch');
    expect(MISSION_DOMAIN_IPC_CHANNELS).toContain('mission-domain:grants:list-events');

    const channel = 'mission-domain:missions:create';
    await handlers.get(channel)?.({}, { storeContext, input: { id: 'mission-1' } });
    expect(executeOperation).toHaveBeenCalledWith(
      MISSION_DOMAIN_IPC_ROUTES[channel],
      storeContext,
      { id: 'mission-1' },
    );

  });

  it('rejects incomplete envelopes and extra top-level authority fields', async () => {
    const handlers = new Map<string, (event: unknown, request?: unknown) => unknown>();
    registerMissionDomainIpcHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { executeOperation: vi.fn() },
    );
    const handler = handlers.get('mission-domain:policies:list');
    expect(() => handler?.({}, { storeContext })).toThrow(/requires storeContext and input/);
    expect(() => handler?.({}, { storeContext, input: {}, channel: 'arbitrary' }))
      .toThrow(/accepts only storeContext and input/);
  });
});
