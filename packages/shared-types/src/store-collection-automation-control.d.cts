import type { StoreCollectionAutomationProjection } from './store-collection-automation';

export type StoreCollectionAutomationErrorCode =
  | 'INVALID_INPUT' | 'CORRUPT_STORAGE' | 'STORE_IDENTITY_MISMATCH' | 'REVISION_CONFLICT';
export class StoreCollectionAutomationError extends Error {
  readonly code: StoreCollectionAutomationErrorCode;
  constructor(code: StoreCollectionAutomationErrorCode, message: string, options?: ErrorOptions);
}
export function storeCollectionAutomationSettingKey(storeId: string): string;
export function readStoreCollectionAutomation(
  raw: string | null | undefined,
  authority: Readonly<{ storeId: string; browserProfileId: string }>,
): StoreCollectionAutomationProjection;
