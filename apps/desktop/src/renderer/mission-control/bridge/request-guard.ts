import {
  missionControlContextKey,
  type MissionControlResponseMeta,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';

export interface MissionControlRequestCapture {
  requestId: string;
  contextEpoch: number;
  contextKey: string;
}

export interface MissionControlCurrentAuthority {
  contextEpoch: number;
  context: StoreContextEnvelope | null;
}

export function captureMissionControlRequest(
  requestId: string,
  contextEpoch: number,
  context: StoreContextEnvelope,
): MissionControlRequestCapture {
  return {
    requestId,
    contextEpoch,
    contextKey: missionControlContextKey(context),
  };
}

/**
 * Renderer-only late response guard. It improves UI consistency but is never
 * an authorization decision; Main already performed the authority checks.
 */
export function isMissionControlResponseCurrent(
  response: MissionControlResponseMeta,
  capture: MissionControlRequestCapture,
  current: MissionControlCurrentAuthority,
): boolean {
  if (!current.context) return false;
  return response.requestId === capture.requestId
    && response.contextEpoch === capture.contextEpoch
    && missionControlContextKey(response.authoritativeContext) === capture.contextKey
    && current.contextEpoch === capture.contextEpoch
    && missionControlContextKey(current.context) === capture.contextKey;
}
