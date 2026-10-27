import { useEffect, useRef, useState } from 'react';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { collectionActionFeedbackBelongsToAuthority } from './collection-jobs';
import type { RunningCollectionActionMode } from './collection-contracts';
import { rendererRuntimeLog } from '../runtime-log';

export function createCollectionOperationState() {
  let context: StoreContextEnvelope | null = null;
  let epoch = 0;
  let sequence = 0;
  let active: number | undefined;
  return {
    bind(next: StoreContextEnvelope | null) {
      if ((context || next) && !collectionActionFeedbackBelongsToAuthority(context, next)) {
        epoch += 1;
        active = undefined;
      }
      context = next ? { ...next } : null;
      return epoch;
    },
    isCurrent(capturedEpoch: number) { return epoch === capturedEpoch; },
    begin() {
      if (!context || active !== undefined) return undefined;
      const token = ++sequence;
      const capturedEpoch = epoch;
      active = token;
      return {
        isCurrent: () => epoch === capturedEpoch && active === token,
        finish() { if (epoch === capturedEpoch && active === token) active = undefined; },
      };
    },
    dispose() { epoch += 1; active = undefined; },
  };
}

export function useCollectionOperation(context: StoreContextEnvelope | null) {
  const state = useRef(createCollectionOperationState());
  const mounted = useRef(true);
  const epoch = state.current.bind(context);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setPending(false);
  }, [epoch]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return {
    pending,
    isCurrentEpoch: () => mounted.current && state.current.isCurrent(epoch),
    async run(action: string, task: () => Promise<void>, onStart?: () => void, onFinish?: () => void) {
      if (!mounted.current || !state.current.isCurrent(epoch)) return;
      const ticket = state.current.begin();
      if (!ticket) return;
      setPending(true);
      try {
        onStart?.();
        await task();
      } catch (error) {
        rendererRuntimeLog.error('collection.operation_failed', { error, action });
      } finally {
        if (mounted.current && ticket.isCurrent()) {
          setPending(false);
          onFinish?.();
        }
        ticket.finish();
      }
    },
  };
}

export function collectionResumeMode(job: { request: { mode: string; reportTypes: readonly unknown[] } }): RunningCollectionActionMode {
  return job.request.mode === 'download-existing' ? 'download-existing'
    : job.request.reportTypes.length >= 8 ? 'recreate-full' : 'recreate-selected';
}
