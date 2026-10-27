import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createWorkspaceOperationState } from './operation-state';

export interface WorkspaceOperationTicket {
  isCurrent(): boolean;
  finish(): void;
}

const useLifecycleEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useWorkspaceOperation(contextKey: string) {
  const state = useRef(createWorkspaceOperationState());
  const mounted = useRef(true);
  const lifecycle = useRef(0);
  const [pending, setPending] = useState<WorkspaceOperationTicket | null>(null);
  state.current.update(contextKey);
  const renderIsCurrent = state.current.capture();
  useLifecycleEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      lifecycle.current += 1;
      state.current.retireActive();
    };
  }, []);

  return {
    busy: Boolean(pending?.isCurrent()),
    capture() {
      const capturedLifecycle = lifecycle.current;
      return () => mounted.current && capturedLifecycle === lifecycle.current && renderIsCurrent();
    },
    begin(): WorkspaceOperationTicket | null {
      if (!mounted.current || !renderIsCurrent()) return null;
      const admitted = state.current.begin();
      if (!admitted) return null;
      const capturedLifecycle = lifecycle.current;
      const ticket: WorkspaceOperationTicket = {
        isCurrent: () => mounted.current && capturedLifecycle === lifecycle.current && admitted.isCurrent(),
        finish() {
          if (mounted.current && capturedLifecycle === lifecycle.current) {
            // 旧请求只能结束自己的反馈，不能清除新范围的忙碌状态。
            setPending(current => current === ticket ? null : current);
          }
          admitted.finish();
        },
      };
      setPending(ticket);
      return ticket;
    },
  };
}
