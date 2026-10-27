import { create } from 'zustand';
import type {
BrowserLoginCredentialPersistence,
BrowserLoginResult
} from '../shared/login-contract';
import type { NavigationIntent } from './navigation';
import {
DEFAULT_WORKSPACE_INTENTS
} from './navigation';

export interface LoginSessionInfo {
  erpSessionReady?: boolean;
  erpSessionReused?: boolean;
  sessionIdentityVerified?: boolean;
  adsSessionReady?: boolean;
  adsEntryMode?: string;
  adsUrl?: string;
  adsTitle?: string;
  adsUnavailableReason?: string;
  adsIdentityCandidate?: BrowserLoginResult['adsIdentityCandidate'];
  credentialPersistence?: BrowserLoginCredentialPersistence;
}

export interface AppState {
  isLoggedIn: boolean;
  currentStore: string;
  loginSession?: LoginSessionInfo | null;
  loginStateRevision: number;
  activeNavigation: NavigationIntent;
  setActiveNavigation: (intent: NavigationIntent) => void;
  setLoginState: (isLoggedIn: boolean, store?: string, loginSession?: LoginSessionInfo | null) => void;
}

export const useStore = create<AppState>((set) => ({
  isLoggedIn: false,
  currentStore: '',
  loginSession: null,
  loginStateRevision: 0,
  activeNavigation: DEFAULT_WORKSPACE_INTENTS.today,
  setActiveNavigation: (intent) => set({ activeNavigation: intent }),
  setLoginState: (isLoggedIn, store = '', loginSession = null) => set((state) => ({
    isLoggedIn,
    currentStore: store,
    loginSession,
    loginStateRevision: state.loginStateRevision + 1,
  })),
}));
