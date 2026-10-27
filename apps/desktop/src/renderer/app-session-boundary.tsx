import React,{ useEffect,useLayoutEffect,useRef } from 'react';
import { type StoreAuthoritySnapshot,appStateAuthorityKey,shouldInvalidateLoginForStoreAuthority,shouldRestoreLoginForStoreAuthority,shouldStartLoginRestoreForAuthority } from './app-authority';
import { appElectronApi } from './app-bootstrap';
import { useStore } from './app-login-state';
import {
useMissionControlStoreContext
} from './mission-control/store-context';
import { rendererRuntimeLog } from './runtime-log';

export function MissionControlSessionAuthorityBoundary({ children }: { children: React.ReactNode }) {
  const store = useMissionControlStoreContext();
  const { isLoggedIn, setLoginState } = useStore();
  const loginRestoreAuthorityRef = useRef<string | null>(null);
  const previousAuthorityRef = useRef<StoreAuthoritySnapshot>({
    authorityKey: store.authorityKey,
    contextEpoch: store.contextEpoch,
    phase: store.phase,
  });

  useLayoutEffect(() => {
    const currentAuthority: StoreAuthoritySnapshot = {
      authorityKey: store.authorityKey,
      contextEpoch: store.contextEpoch,
      phase: store.phase,
    };
    const previousAuthority = previousAuthorityRef.current;
    previousAuthorityRef.current = currentAuthority;
    if (shouldInvalidateLoginForStoreAuthority(isLoggedIn, previousAuthority, currentAuthority)) {
      setLoginState(false);
    }
  }, [isLoggedIn, setLoginState, store.authorityKey, store.contextEpoch, store.phase]);

  useEffect(() => {
    const currentAuthority: StoreAuthoritySnapshot = {
      authorityKey: store.authorityKey,
      contextEpoch: store.contextEpoch,
      phase: store.phase,
    };
    if (!shouldStartLoginRestoreForAuthority(loginRestoreAuthorityRef.current, currentAuthority)) return;
    loginRestoreAuthorityRef.current = currentAuthority.authorityKey;
    const requestedAuthorityKey = currentAuthority.authorityKey;
    const requestedLoginRevision = useStore.getState().loginStateRevision;

    async function restoreLoginState() {
      try {
        const state = await appElectronApi().getState();
        if (useStore.getState().loginStateRevision !== requestedLoginRevision) return;
        const currentAuthorityKey = previousAuthorityRef.current.authorityKey;
        if (shouldRestoreLoginForStoreAuthority({
          responseIsLoggedIn: Boolean(state?.isLoggedIn),
          responseAuthorityKey: appStateAuthorityKey(state),
          requestedAuthorityKey,
          currentAuthorityKey,
        })) {
          setLoginState(true, state.currentStore, state.loginSession || null);
        } else {
          setLoginState(false);
        }
      } catch (caught) {
        rendererRuntimeLog.error('renderer.login_restore_failed', { error: caught });
        if (useStore.getState().loginStateRevision === requestedLoginRevision) {
          setLoginState(false);
        }
      }
    }

    void restoreLoginState();
  }, [setLoginState, store.authorityKey, store.contextEpoch, store.phase]);

  return <>{children}</>;
}
