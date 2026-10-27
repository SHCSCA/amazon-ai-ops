import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  MissionControlAutonomyMode,
  MissionControlAutonomyProjection,
  MissionControlCapabilityProjection,
  MissionControlCommandResponse,
  MissionControlTodayProjection,
} from '@amazon-ai-ops/shared-types';
import { useMissionControlStoreContext } from '../store-context';
import { getMissionControlWindowApi } from './window-api';
import { rendererRuntimeLog } from '../../runtime-log';
import { useWorkspaceOperation } from '../../components/workspace/use-workspace-operation';
import {
  captureMissionControlRequest,
  isMissionControlResponseCurrent,
} from './request-guard';

export type MissionControlBridgePhase = 'idle' | 'loading' | 'ready' | 'error';

export interface MissionControlBridgeState {
  capabilities: MissionControlCapabilityProjection[];
  autonomy: MissionControlAutonomyProjection | null;
  today: MissionControlTodayProjection | null;
  phase: MissionControlBridgePhase;
  error: string | null;
  refreshBootstrap(): Promise<boolean>;
  setAutonomyMode(mode: MissionControlAutonomyMode, missionId?: string): Promise<MissionControlCommandResponse | null>;
}

let rendererRequestSequence = 0;

export function useMissionControlBridge(): MissionControlBridgeState {
  const store = useMissionControlStoreContext();
  const [capabilities, setCapabilities] = useState<MissionControlCapabilityProjection[]>([]);
  const [autonomy, setAutonomy] = useState<MissionControlAutonomyProjection | null>(null);
  const [today, setToday] = useState<MissionControlTodayProjection | null>(null);
  const [phase, setPhase] = useState<MissionControlBridgePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const latestBootstrapSequenceRef = useRef(0);
  const operation = useWorkspaceOperation(JSON.stringify([store.authorityKey, store.contextEpoch]));
  const operationRef = useRef(operation);
  operationRef.current = operation;
  const currentRef = useRef({
    contextEpoch: store.contextEpoch,
    context: store.authoritativeContext,
  });
  currentRef.current = {
    contextEpoch: store.contextEpoch,
    context: store.authoritativeContext,
  };

  const refreshBootstrap = useCallback(async () => {
    const isCurrent = operationRef.current.capture();
    if (!isCurrent()) return false;
    const bootstrapSequence = latestBootstrapSequenceRef.current + 1;
    latestBootstrapSequenceRef.current = bootstrapSequence;
    const context = currentRef.current.context;
    if (!context) {
      setCapabilities([]);
      setAutonomy(null);
      setToday(null);
      setPhase('idle');
      setError(null);
      return false;
    }
    const contextEpoch = currentRef.current.contextEpoch;
    const requestId = nextRequestId('bootstrap');
    const capture = captureMissionControlRequest(requestId, contextEpoch, context);
    // 同店刷新保留正在执行的工作区；权威变化仍由下方 effect 清空旧投影。
    setPhase(current => current === 'ready' ? 'ready' : 'loading');
    setError(null);
    try {
      const response = await getMissionControlWindowApi().missionControl.query({
        query: 'workspace-bootstrap',
        requestId,
        contextEpoch,
        context,
      });
      if (
        !isCurrent() || bootstrapSequence !== latestBootstrapSequenceRef.current
        || !isMissionControlResponseCurrent(response, capture, currentRef.current)
      ) return false;
      setCapabilities(response.data.capabilities);
      setAutonomy(response.data.autonomy);
      setToday(response.data.today);
      setPhase('ready');
      return true;
    } catch (caught) {
      rendererRuntimeLog.error('mission_control.bootstrap_failed', { error: caught });
      if (
        !isCurrent() || bootstrapSequence !== latestBootstrapSequenceRef.current
        || currentRef.current.contextEpoch !== contextEpoch
      ) return false;
      setCapabilities([]);
      setAutonomy(null);
      setToday(null);
      setPhase('error');
      setError(errorMessage(caught));
      return false;
    }
  }, []);

  useEffect(() => {
    setCapabilities([]);
    setAutonomy(null);
    setToday(null);
    setError(null);
    setPhase(store.authoritativeContext ? 'loading' : 'idle');
    void refreshBootstrap();
  }, [store.authorityKey, store.contextEpoch, refreshBootstrap]);

  useEffect(() => {
    const refresh = () => { void refreshBootstrap(); };
    window.addEventListener('business-ui:data-updated', refresh);
    return () => window.removeEventListener('business-ui:data-updated', refresh);
  }, [refreshBootstrap]);

  const setAutonomyMode = useCallback(async (
    mode: MissionControlAutonomyMode,
    missionId?: string,
  ): Promise<MissionControlCommandResponse | null> => {
    const isCurrent = operationRef.current.capture();
    if (!isCurrent()) return null;
    const context = currentRef.current.context;
    if (!context) return null;
    const contextEpoch = currentRef.current.contextEpoch;
    const requestId = nextRequestId('autonomy');
    const capture = captureMissionControlRequest(requestId, contextEpoch, context);
    try {
      const response = await getMissionControlWindowApi().missionControl.command({
        command: 'set-autonomy-mode',
        requestId,
        contextEpoch,
        context,
        payload: { mode, ...(missionId ? { missionId } : {}) },
      });
      if (!isCurrent() || !isMissionControlResponseCurrent(response, capture, currentRef.current)) return null;
      setAutonomy((current) => current ? {
        ...current,
        currentMode: response.currentMode,
        ...(response.blockerCode ? {
          policyAutoAvailable: false,
          policyAutoBlockerCode: response.blockerCode,
          policyAutoBlockerDetail: response.detail,
        } : {}),
      } : current);
      return response;
    } catch (caught) {
      rendererRuntimeLog.error('mission_control.mode_command_failed', { error: caught });
      if (isCurrent() && currentRef.current.contextEpoch === contextEpoch) {
        setError(errorMessage(caught));
        setPhase('error');
      }
      throw caught;
    }
  }, []);

  return { capabilities, autonomy, today, phase, error, refreshBootstrap, setAutonomyMode };
}

function nextRequestId(kind: string): string {
  rendererRequestSequence += 1;
  return `renderer-${kind}-${Date.now()}-${rendererRequestSequence}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
