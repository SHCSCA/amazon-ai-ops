import type { BrowserProfileId, StoreId } from './store';

// 自动采集开关独立持久化，不改变分析配置、人工采集或执行授权。
export interface StoreCollectionAutomationProjection {
  readonly storeId: StoreId;
  readonly browserProfileId: BrowserProfileId;
  readonly automaticCollectionEnabled: boolean;
  readonly source: 'legacy-default' | 'explicit-override';
  readonly revision: number;
  readonly updatedAt: string | null;
}

export interface SetStoreCollectionAutomationInput {
  expectedRevision: number;
  automaticCollectionEnabled: boolean;
}
