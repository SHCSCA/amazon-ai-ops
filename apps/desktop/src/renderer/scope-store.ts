import { create } from 'zustand';
import type { OperationScope } from './types';

interface ScopeState {
  scope: OperationScope;
  setScope: (patch: Partial<OperationScope>) => void;
  resetScope: () => void;
}

const defaultScope: OperationScope = {
  dateFrom: '2026-06-01',
  dateTo: '2026-06-12',
  storeName: 'FT-US-US',
  marketplaceCode: 'US',
  currency: 'USD',
};

export const useScopeStore = create<ScopeState>((set) => ({
  scope: defaultScope,
  setScope: (patch) => set((state) => ({ scope: { ...state.scope, ...patch, currency: 'USD' } })),
  resetScope: () => set({ scope: defaultScope }),
}));
