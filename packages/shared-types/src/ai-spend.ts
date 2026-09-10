import type { StoreContextEnvelope } from './store';

export const AI_PURPOSES = {
  authority: { label: '权限与数值门禁', level: 'A0', necessary: false, fallback: 'rules', mayBlock: false },
  connection_test: { label: 'AI 连接测试', level: 'A1', necessary: false, fallback: 'no_generation', mayBlock: false },
  action_explanation: { label: '建议解释', level: 'A1', necessary: false, fallback: 'template', mayBlock: false },
  daily_summary: { label: '每日摘要', level: 'A1', necessary: false, fallback: 'template', mayBlock: false },
  listing_draft: { label: 'Listing 草案', level: 'A2', necessary: false, fallback: 'rules', mayBlock: false },
  strategy_analysis: { label: '结构化广告分析', level: 'A3', necessary: false, fallback: 'rules', mayBlock: true },
} as const;
export type PaidAiPurpose = Exclude<keyof typeof AI_PURPOSES, 'authority'>;

/** USD micro-units, independent of Ads impact cents and MissionGrant authority. */
export interface AiSpendPolicyInput {
  expectedRevision: number;
  enabled: boolean;
  providerBaseUrl: string;
  model: string;
  windowStartsAt: string;
  windowEndsAt: string;
  budgetMicrousd: number;
  /** Reviewed provider-enforced model context limit, not a measured typical prompt. */
  contextTokenLimit: number;
  outputTokenLimit: number;
  inputMicrousdPerMillion: number;
  outputMicrousdPerMillion: number;
  pricingReference: string;
  reason: string;
}
export interface AiSpendPolicy extends Omit<AiSpendPolicyInput, 'expectedRevision'> {
  storeId: StoreContextEnvelope['storeId'];
  revision: number;
  owner: 'operator';
  currency: 'USD';
  approvedAt: string;
}
export interface AiCostRecord {
  id: string;
  storeContext: StoreContextEnvelope;
  providerBaseUrl: string;
  model: string;
  purpose: PaidAiPurpose;
  automatic: boolean;
  policyRevision?: number;
  startedAt: string;
  endedAt?: string;
  status: 'started' | 'succeeded' | 'failed' | 'interrupted' | 'blocked';
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  costStatus: 'estimated' | 'reported' | 'unknown';
  costMicrousd?: number;
  reservedMicrousd?: number;
  fallback: 'none' | 'template' | 'rules' | 'no_generation';
  reasonCode?: string;
  /** Derived from the append-only semantic audit; transport success alone leaves this unvalidated. */
  outputStatus?: 'unvalidated' | 'accepted' | 'invalid' | 'discarded';
}
export interface AiSpendProjection {
  policy?: AiSpendPolicy;
  records: AiCostRecord[];
  committedMicrousd: number;
  reservedMicrousd: number;
  unknownCount: number;
  remainingMicrousd?: number;
}
