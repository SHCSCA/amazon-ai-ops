import type { AdActionType, ActionRecommendation } from '@amazon-ai-ops/shared-types';

export interface ExecutionContext {
  recommendation: ActionRecommendation;
  pageUrl: string;
  screenshots: {
    before?: string;
    after?: string;
  };
  tracePath?: string;
}

export interface ExecutionResult {
  success: boolean;
  executionId: string;
  actionType: AdActionType;
  beforeValue: string;
  afterValue: string;
  verified: boolean;  // 回读校验是否通过
  error?: string;
  errorCode?: string;
  screenshotBefore?: string;
  screenshotAfter?: string;
  tracePath?: string;
  executedAt: string;
}

export type ExecutionErrorCode = 
  | 'ELEMENT_NOT_FOUND'
  | 'ELEMENT_DISABLED'
  | 'VALUE_MISMATCH'
  | 'PAGE_CHANGED'
  | 'SESSION_EXPIRED'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface VerifyOptions {
  retries: number;
  retryDelayMs: number;
  tolerance: number;  // 允许的偏差（如 bid 允许 ±0.01）
}
