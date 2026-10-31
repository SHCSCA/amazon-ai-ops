import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { FamilyObservation } from '@amazon-ai-ops/report-parser';

export type { FamilyObservation };
export interface FamilyObservationScope {
  storeContext: StoreContextEnvelope;
  dateFrom: string;
  dateTo: string;
}
export interface FamilyObservationFile {
  id: number;
  fileName: string;
  batchId: string;
  reportType: string;
  sha256: string;
  dateFrom: string;
  dateTo: string;
}
export interface PrepareFamilyObservationInput extends FamilyObservationScope {
  fileIds: number[];
  familyLabel: string;
}
export interface FamilyObservationPreview {
  token: string;
  familyLabel: string;
  storeName: string;
  marketplaceCode: string;
  dateFrom: string;
  dateTo: string;
  files: FamilyObservationFile[];
}
export interface ConfirmFamilyObservationInput {
  storeContext: StoreContextEnvelope;
  token: string;
}
