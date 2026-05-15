// =============================================
// Rules Types
// =============================================

export type RuleType = 'ad_negative' | 'ad_bid' | 'ad_budget' | 'inventory' | 'profit';
export type RiskLevel = 'AUTO_ALLOWED' | 'APPROVAL_REQUIRED' | 'FORBIDDEN';

export interface RuleConfig {
  id: string;
  rule_name: string;
  rule_type: RuleType;
  scope_type: 'global' | 'store' | 'marketplace' | 'asin' | 'campaign';
  scope_value?: string;
  conditions: RuleCondition[];
  action: RuleAction;
  risk_level: RiskLevel;
  enabled: boolean;
}

export interface RuleCondition {
  field: string;
  operator: 'gte' | 'lte' | 'eq' | 'gt' | 'lt' | 'contains' | 'not_contains';
  value: number | string | boolean;
}

export interface RuleAction {
  type: string;
  params: Record<string, any>;
}
