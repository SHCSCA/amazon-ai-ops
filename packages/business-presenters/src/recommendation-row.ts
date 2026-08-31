import {
  businessObjectName,
  formattedChangeValue,
  targetingTypeLabel,
} from './object-labels';
import { localizeAction } from './action';
import { localizeObjectType } from './object-type';
import { localizeStatus } from './status';

/**
 * Input contract for a recommendation table row. The fields are optional
 * because the upstream data layer is loose; the presenter normalizes every
 * missing value into a non-blank cell or label.
 */
export interface RecommendationRowInput {
  id?: unknown;
  objectName?: unknown;
  keyword?: unknown;
  title?: unknown;
  entityType?: unknown;
  objectType?: unknown;
  campaignName?: unknown;
  adGroupName?: unknown;
  matchType?: unknown;
  actionType?: unknown;
  actionLabel?: unknown;
  currentValue?: unknown;
  recommendedValue?: unknown;
  unit?: unknown;
  currency?: unknown;
  reason?: unknown;
  status?: unknown;
  [key: string]: unknown;
}

/**
 * Decorated recommendation row ready for renderer consumption. Carries the
 * original item so downstream tables can still read raw fields, plus all
 * localized display strings the shared VirtualDataTable consumes.
 */
export interface RecommendationTableRow extends RecommendationRowInput {
  readonly campaign: string;
  readonly adGroup: string;
  readonly level: string;
  readonly object: string;
  readonly targetingType: string;
  readonly action: string;
  readonly beforeLabel: string;
  readonly afterLabel: string;
  readonly change: string;
  readonly basis: string;
  readonly statusLabel: string;
}

/**
 * Decorate a recommendation row with operator-facing display strings.
 */
export function recommendationTableRow(item: RecommendationRowInput): RecommendationTableRow {
  const beforeLabel = formattedChangeValue(item.currentValue, item);
  const afterLabel = formattedChangeValue(item.recommendedValue, item);
  return {
    ...item,
    campaign: String(item.campaignName ?? '未归属活动'),
    adGroup: String(
      item.adGroupName
        ?? (item.entityType === 'campaign' ? '活动级' : '未归属广告组'),
    ),
    level: localizeObjectType(item.entityType ?? item.objectType),
    object: businessObjectName(item, 'entityType'),
    targetingType: targetingTypeLabel(item, 'entityType'),
    action: localizeAction(item.actionType, item.actionLabel, item.entityType),
    beforeLabel,
    afterLabel,
    change: `${beforeLabel} → ${afterLabel}`,
    basis: String(item.reason ?? '等待补充业务依据'),
    statusLabel: localizeStatus(item.status),
  };
}
