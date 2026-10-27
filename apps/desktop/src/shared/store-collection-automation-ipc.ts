import type { SetStoreCollectionAutomationInput, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';

export const STORE_COLLECTION_AUTOMATION_IPC_CHANNELS = [
  'store-collection-automation:get',
  'store-collection-automation:set',
] as const;

export interface GetStoreCollectionAutomationRequest {
  storeContext: StoreContextEnvelope;
}

export interface SetStoreCollectionAutomationRequest extends GetStoreCollectionAutomationRequest {
  input: SetStoreCollectionAutomationInput;
}
