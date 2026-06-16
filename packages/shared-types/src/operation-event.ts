export type OperationEventType =
  | 'coupon'
  | 'deal'
  | 'bd'
  | 'ld'
  | 'promotion'
  | 'price_change'
  | 'inventory'
  | 'external_traffic'
  | 'note'
  | 'listing_change'
  | 'offsite_promotion'
  | 'inventory_issue'
  | 'review_change'
  | 'manual_note';

export type OperationEventImpact =
  | 'conversion_up'
  | 'conversion_down'
  | 'traffic_up'
  | 'traffic_down'
  | 'acos_up'
  | 'acos_down'
  | 'unknown';

export interface OperationEvent {
  id: number;
  eventDate: string;
  storeName: string;
  marketplaceCode: string;
  asin?: string;
  campaignName?: string;
  adGroupName?: string;
  eventType: OperationEventType | string;
  title: string;
  impactExpectation?: OperationEventImpact | string;
  notes?: string;
  evidencePath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOperationEventInput {
  eventDate: string;
  storeName: string;
  marketplaceCode: string;
  asin?: string;
  campaignName?: string;
  adGroupName?: string;
  eventType: OperationEventType | string;
  title: string;
  impactExpectation?: OperationEventImpact | string;
  notes?: string;
  evidencePath?: string;
}

export type UpdateOperationEventInput = Partial<CreateOperationEventInput>;

export interface OperationEventFilter {
  dateFrom?: string;
  dateTo?: string;
  storeName?: string;
  marketplaceCode?: string;
  asin?: string;
  campaignName?: string;
  adGroupName?: string;
  eventType?: string;
  limit?: number;
}
