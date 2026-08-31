/**
 * Public entry point of `@amazon-ai-ops/business-presenters`.
 *
 * This package hosts the pure, dependency-free presenters that translate
 * upstream domain tokens (match types, object types, actions, statuses,
 * currencies, percentage / currency formatters, and table-row decorators)
 * into the operator-facing Chinese labels and shapes the renderer consumes.
 *
 * It deliberately holds zero React, browser, persistence, IPC, or
 * business-rule code so it stays trivially unit-testable and shareable
 * between the standalone prototype and the production Electron renderer.
 */

export { normalizeToken } from './normalize-token';

export type { Currency } from './currency';
export { usdCurrency, isSupportedCurrency } from './currency';

export { money } from './format-money';
export { percent } from './format-percent';

export type { MatchTypeToken } from './match-type';
export { localizeMatchType, MATCH_TYPE_LABEL_TABLE } from './match-type';

export type { ObjectTypeToken } from './object-type';
export { localizeObjectType, OBJECT_TYPE_LABEL_TABLE } from './object-type';

export type { ActionTypeToken } from './action';
export { localizeAction, ACTION_LABEL_TABLE } from './action';

export type { StatusToken } from './status';
export { localizeStatus, STATUS_LABEL_TABLE, DEFAULT_STATUS_LABEL } from './status';

export type { DecisionActionToken } from './decision-action';
export { localizeDecisionAction, DECISION_ACTION_LABEL_TABLE } from './decision-action';

export type { CollectionReportType } from './collection-report-type';
export {
  localizeCollectionReportType,
  COLLECTION_REPORT_LABEL_TABLE,
} from './collection-report-type';

export type { ProductStageToken } from './product-stage';
export { localizeProductStage, PRODUCT_STAGE_LABEL_TABLE } from './product-stage';

export type { AgreementToken } from './agreement';
export { localizeAgreement, AGREEMENT_LABEL_TABLE } from './agreement';

export type { RecommendationSourceToken } from './recommendation-source';
export {
  localizeRecommendationSource,
  RECOMMENDATION_SOURCE_LABEL_TABLE,
} from './recommendation-source';

export type { ReportStatusToken } from './report-status';
export { localizeReportStatus, REPORT_STATUS_LABEL_TABLE } from './report-status';

export type { QuantStatusToken } from './quant-status';
export { localizeQuantStatus, QUANT_STATUS_LABEL_TABLE } from './quant-status';

export {
  businessObjectName,
  targetingTypeLabel,
  formattedChangeValue,
} from './object-labels';

export type { BusinessGroupPathSegment } from './business-group';
export {
  businessGroupPath,
  businessGroupLabel,
  normalizeBusinessGroupPath,
  businessGroupTransitions,
} from './business-group';

export type { AdObjectHealth, AdObjectRowInput, AdObjectTableRow } from './ad-object-row';
export { classifyHealth, adObjectTableRow } from './ad-object-row';

export type {
  RecommendationRowInput,
  RecommendationTableRow,
} from './recommendation-row';
export { recommendationTableRow } from './recommendation-row';
