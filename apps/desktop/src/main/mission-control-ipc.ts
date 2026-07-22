import {
  missionControlContextKey,
  normalizeMissionControlCommandRequest,
  normalizeMissionControlQueryRequest,
  type MissionControlCommandResponse,
  type MissionControlQueryResponse,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type { StoreCoordinator } from './store-coordinator';
import type { MissionControlAdapter } from './mission-control-legacy-adapter';

export const MISSION_CONTROL_IPC_CHANNELS = [
  'mission-control:query',
  'mission-control:command',
] as const;

export interface MissionControlIpcRegistrar {
  handle(channel: string, listener: (event: unknown, input?: unknown) => unknown): void;
}

export interface MissionControlAuthority {
  assertActiveStoreContext(value: unknown): StoreContextEnvelope;
  getActiveStoreContext(): StoreContextEnvelope | null;
}

export function registerMissionControlIpcHandlers(
  ipc: MissionControlIpcRegistrar,
  coordinator: Pick<StoreCoordinator, 'assertActiveStoreContext' | 'getActiveStoreContext'>,
  adapter: MissionControlAdapter,
  now: () => Date = () => new Date(),
): void {
  ipc.handle('mission-control:query', async (_event, input): Promise<MissionControlQueryResponse> => {
    const request = normalizeMissionControlQueryRequest(input);
    const before = captureAuthoritativeContext(coordinator, request.context);
    const body = await adapter.query(request, before);
    const after = captureAuthoritativeContext(coordinator, request.context);
    assertUnchangedAuthority(before, after);
    return {
      query: 'workspace-bootstrap',
      requestId: request.requestId,
      contextEpoch: request.contextEpoch,
      authoritativeContext: after,
      completedAt: now().toISOString(),
      data: {
        capabilities: body.data.capabilities.map((capability) => ({ ...capability })),
        autonomy: { ...body.data.autonomy },
      },
    };
  });

  ipc.handle('mission-control:command', async (_event, input): Promise<MissionControlCommandResponse> => {
    const request = normalizeMissionControlCommandRequest(input);
    const before = captureAuthoritativeContext(coordinator, request.context);
    const body = await adapter.command(request, before);
    const after = captureAuthoritativeContext(coordinator, request.context);
    assertUnchangedAuthority(before, after);
    return {
      command: 'set-autonomy-mode',
      requestId: request.requestId,
      contextEpoch: request.contextEpoch,
      authoritativeContext: after,
      completedAt: now().toISOString(),
      status: body.status,
      currentMode: body.currentMode,
      ...(body.blockerCode ? { blockerCode: body.blockerCode } : {}),
      detail: body.detail,
    };
  });
}

function captureAuthoritativeContext(
  coordinator: MissionControlAuthority,
  submitted: StoreContextEnvelope,
): StoreContextEnvelope {
  coordinator.assertActiveStoreContext(submitted);
  const authoritative = coordinator.getActiveStoreContext();
  if (!authoritative) {
    throw new Error('MISSION_CONTROL_NO_ACTIVE_STORE');
  }
  if (missionControlContextKey(authoritative) !== missionControlContextKey(submitted)) {
    throw new Error('MISSION_CONTROL_STORE_CONTEXT_MISMATCH');
  }
  return authoritative;
}

function assertUnchangedAuthority(
  before: StoreContextEnvelope,
  after: StoreContextEnvelope,
): void {
  if (missionControlContextKey(before) !== missionControlContextKey(after)) {
    throw new Error('MISSION_CONTROL_STORE_CONTEXT_CHANGED_DURING_REQUEST');
  }
}
