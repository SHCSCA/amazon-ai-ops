import type {
  MissionControlCommandRequest,
  MissionControlCommandResponse,
  MissionControlQueryRequest,
  MissionControlQueryResponse,
} from '@amazon-ai-ops/shared-types';

type MissionControlChannel = 'mission-control:query' | 'mission-control:command';

export interface MissionControlIpcInvoker {
  invoke(channel: MissionControlChannel, input: unknown): Promise<unknown>;
}

export interface MissionControlPreloadApi {
  query(input: MissionControlQueryRequest): Promise<MissionControlQueryResponse>;
  command(input: MissionControlCommandRequest): Promise<MissionControlCommandResponse>;
}

/** A deliberately closed bridge: callers cannot choose an IPC channel. */
export function createMissionControlPreloadApi(
  ipc: MissionControlIpcInvoker,
): MissionControlPreloadApi {
  return Object.freeze({
    query: (input: MissionControlQueryRequest) =>
      ipc.invoke('mission-control:query', input) as Promise<MissionControlQueryResponse>,
    command: (input: MissionControlCommandRequest) =>
      ipc.invoke('mission-control:command', input) as Promise<MissionControlCommandResponse>,
  });
}
