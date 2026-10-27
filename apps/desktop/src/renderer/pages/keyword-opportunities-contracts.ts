

export type KeywordOpportunitySortKey =
  | 'asin'
  | 'portfolioName'
  | 'campaignName'
  | 'adGroupName'
  | 'keyword'
  | 'coverageStatus'
  | 'clicks'
  | 'orders'
  | 'spend'
  | 'sales'
  | 'acos'
  | 'opportunityLevel'
  | 'recommendedPlacement';

export interface KeywordOpportunitySortState {
  key: KeywordOpportunitySortKey;
  direction: 'asc' | 'desc';
}

export interface KeywordOpportunityActionButtonInput {
  active: boolean;
  baseClassName: string;
  label: string;
  busyLabel: string;
  disabled?: boolean;
  groupBusy?: boolean;
}

export interface KeywordOpportunityActionButtonView {
  ariaBusy?: true;
  className: string;
  disabled: boolean;
  label: string;
  showSpinner: boolean;
}

export type KeywordOpportunityTaskIntent =
  | 'import-validation'
  | 'data-collection'
  | 'refresh'
  | 'review-first'
  | 'handoff-listing'
  | 'show-source'
  | 'filter';

export interface KeywordOpportunityTaskModel {
  tone: 'neutral' | 'attention' | 'blocked' | 'confirmed';
  title: string;
  description: string;
  statusLabel: string;
  primaryIntent: KeywordOpportunityTaskIntent;
  primaryLabel: string;
  primaryBusy: boolean;
  secondaryIntents: KeywordOpportunityTaskIntent[];
}
