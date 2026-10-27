import { useRef } from 'react';
import { missionControlContextKey, type MissionControlCapabilityProjection, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { useOptionalMissionControlStoreContext } from '../store-context';
import { useWorkspaceOperation } from '../../components/workspace/use-workspace-operation';

export function useCanonicalWorkspaceOperation(context: StoreContextEnvelope | null, capabilities: readonly MissionControlCapabilityProjection[] | undefined, view: string) {
  const provider = useOptionalMissionControlStoreContext();
  const contextKey = context ? missionControlContextKey(context) : null;
  const ready = Boolean(contextKey && (!provider || (provider.phase === 'ready'
    && provider.authoritativeContext && missionControlContextKey(provider.authoritativeContext) === contextKey)));
  const key = JSON.stringify([contextKey, provider?.contextEpoch ?? 0, provider?.phase ?? null, view,
    capabilities?.map(item => [item.capabilityId, item.state]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))) ?? []]);
  const revision = useRef({ key, value: 0 });
  if (revision.current.key !== key) revision.current = { key, value: revision.current.value + 1 };
  return { key, ready, projectionKey: `${revision.current.value}|${key}`, operation: useWorkspaceOperation(key) };
}
