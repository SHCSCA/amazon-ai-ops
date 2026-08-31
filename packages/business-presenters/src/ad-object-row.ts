import {
  businessObjectName,
  formattedChangeValue,
  targetingTypeLabel,
} from './object-labels';
import { localizeObjectType } from './object-type';
import { money } from './format-money';
import { normalizeToken } from './normalize-token';
import { percent } from './format-percent';

/**
 * Health classification for an ad object row. The values are operator-facing
 * Chinese labels that the dashboard / ad-quant / decisions workspaces all
 * render via shared chips.
 */
export type AdObjectHealth = '高风险' | '需观察' | '正常' | '待核验';

/**
 * Input contract for an ad-object table row. All fields are optional because
 * the upstream data layer is loose; the presenter normalizes every missing
 * value into a non-blank cell.
 */
export interface AdObjectRowInput {
  id?: unknown;
  objectKey?: unknown;
  objectName?: unknown;
  keyword?: unknown;
  title?: unknown;
  objectType?: unknown;
  entityType?: unknown;
  campaignName?: unknown;
  adGroupName?: unknown;
  matchType?: unknown;
  spend?: unknown;
  acos?: unknown;
  severity?: unknown;
  [key: string]: unknown;
}

/**
 * Decorated row ready for renderer consumption. Carries the original item
 * so downstream tables can still read raw fields (e.g. id, evidence), plus
 * all localized display strings.
 */
export interface AdObjectTableRow extends AdObjectRowInput {
  readonly id: string;
  readonly campaign: string;
  readonly adGroup: string;
  readonly level: string;
  readonly object: string;
  readonly targetingType: string;
  readonly spendLabel: string;
  readonly acosLabel: string;
  readonly health: AdObjectHealth;
}

/**
 * Map a severity token onto its Chinese health chip. The upstream taxonomy
 * uses three risk bands (`critical` / `medium` / `low`) plus the analysis
 * verdicts `healthy` and `normal`. Anything else is rendered as "待核验"
 * so unmapped severities surface visibly instead of silently degrading.
 */
export function classifyHealth(severity: unknown): AdObjectHealth {
  const normalized = normalizeToken(severity);
  if (normalized === 'critical' || normalized === 'high') return '高风险';
  if (normalized === 'medium') return '需观察';
  if (normalized === 'low' || normalized === 'healthy' || normalized === 'normal') return '正常';
  return '待核验';
}

/**
 * Decorate an ad-object row with the operator-facing display strings the
 * shared VirtualDataTable / row views need.
 */
export function adObjectTableRow(item: AdObjectRowInput): AdObjectTableRow {
  const objectType = normalizeToken(item.objectType);
  const campaign = String(
    item.campaignName ?? (objectType === 'campaign' ? item.objectName : '未归属活动'),
  );
  const adGroup = (objectType === 'campaign' || objectType === 'placement')
    ? '活动级'
    : String(item.adGroupName ?? (objectType === 'ad_group' ? item.objectName : '活动级'));
  const spendLabel = money(item.spend);
  const acosLabel = item.acos === null ? '无订单' : percent(item.acos);
  return {
    ...item,
    id: String(item.objectKey ?? item.id ?? ''),
    campaign,
    adGroup,
    level: localizeObjectType(item.objectType ?? item.entityType),
    object: businessObjectName(item, 'objectType'),
    targetingType: targetingTypeLabel(item, 'objectType'),
    spendLabel,
    acosLabel,
    health: classifyHealth(item.severity),
  };
}
