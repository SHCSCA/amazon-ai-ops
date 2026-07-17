export { AdRules } from './ad-rules';
export { RiskEvaluator } from './risk-evaluator';
export { RecommendationGenerator } from './recommendation';
export { mergeAdDecisions } from './ad-decision-merger';
export { AdQuantifier, buildAdMetricObjectIdentity } from './quantification';
export { DEFAULT_RULE_CONFIG } from './types';
export type { RuleConfig, RuleResult, RuleEvidence, RecommendationInput } from './types';
export type { GenerateOptions } from './recommendation';
export type { RiskAssessment } from './risk-evaluator';
export type {
  AdDecisionCandidate,
  DecisionAgreement,
  MergeAdDecisionsInput,
  MergedAdDecision,
} from './ad-decision-merger';
export type {
  AdLifecycleStage,
  AdMetricObjectIdentity,
  AdQuantStatus,
  DailyAdTimeline,
  QuantifiedAdMetric,
  QuantifyOptions,
} from './quantification';
