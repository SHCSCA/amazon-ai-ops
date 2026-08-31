import { localizeObjectType } from './object-type';
import { normalizeToken } from './normalize-token';

/**
 * One segment in the canonical `活动 > 广告组 > 关键词/投放` path used
 * across the ad-quant, decisions, and readback workspaces. The segment
 * carries a stable `key` for diff comparisons plus a `level` discriminator
 * and a `label` for direct rendering.
 */
export interface BusinessGroupPathSegment {
  readonly key: string;
  readonly level: 'campaign' | 'ad-group' | 'group';
  readonly label: string;
}

/**
 * Build the canonical path for an item. Campaign-level and placement-level
 * items collapse to a single segment. Other grains get a `广告组` segment
 * when the upstream `adGroup` is present and meaningful.
 */
export function businessGroupPath(item: {
  campaign?: unknown;
  campaignName?: unknown;
  adGroup?: unknown;
  adGroupName?: unknown;
  level?: unknown;
  entityType?: unknown;
  objectType?: unknown;
}): readonly BusinessGroupPathSegment[] {
  const campaign = String(item.campaign ?? item.campaignName ?? '未归属活动');
  const adGroup = String(item.adGroup ?? item.adGroupName ?? '');
  const level = String(item.level ?? localizeObjectType(item.entityType ?? item.objectType));
  const path: BusinessGroupPathSegment[] = [
    {
      key: `campaign:${campaign}`,
      level: 'campaign',
      label: `广告活动:${campaign}`,
    },
  ];
  if (adGroup && adGroup !== '活动级' && level !== '广告活动' && level !== '广告位') {
    path.push({
      key: `ad-group:${campaign}:${adGroup}`,
      level: 'ad-group',
      label: `广告组:${adGroup}`,
    });
  }
  return path;
}

/**
 * Flat, "A · B · C" rendering of the canonical path for compact titles.
 */
export function businessGroupLabel(item: Parameters<typeof businessGroupPath>[0]): string {
  return businessGroupPath(item).map((group) => group.label).join(' · ');
}

/**
 * Normalize an arbitrary path-like value into an array of segments.
 *
 * Strings wrap into a single group-level segment. Already-array inputs pass
 * through with shallow validation, so we never throw on malformed upstream.
 */
export function normalizeBusinessGroupPath(
  value: unknown,
): readonly BusinessGroupPathSegment[] {
  if (!value) return [];
  const rawPath = Array.isArray(value)
    ? value
    : [{ key: String(value), level: 'group', label: String(value) }];
  return rawPath
    .filter((group): group is { key?: unknown; label?: unknown; level?: unknown } => Boolean(group))
    .map((group) => ({
      key: String(group.key ?? group.label ?? ''),
      level: (group.level === 'campaign' || group.level === 'ad-group'
        ? group.level
        : 'group') as BusinessGroupPathSegment['level'],
      label: String(group.label ?? group.key ?? ''),
    }))
    .filter((group) => Boolean(group.key || group.label));
}

/**
 * Compute the per-row group transition for a list of items.
 *
 * Returns `{ row, groups }` where `groups` is the list of new path segments
 * the row introduces relative to the previous row. The renderer uses this
 * to render dense tables with shared-segment merging and progressive
 * disclosure of nested campaign → ad-group → keyword paths.
 */
export function businessGroupTransitions<R>(
  rows: readonly R[],
  groupBy: (row: R) => unknown = businessGroupPath as (row: R) => unknown,
): readonly { row: R; groups: readonly BusinessGroupPathSegment[] }[] {
  let previousPath: readonly BusinessGroupPathSegment[] = [];
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const path = normalizeBusinessGroupPath(groupBy(row));
    let sharedDepth = 0;
    while (
      sharedDepth < path.length
      && sharedDepth < previousPath.length
      && path[sharedDepth].key === previousPath[sharedDepth].key
    ) {
      sharedDepth += 1;
    }
    const groups = path.slice(sharedDepth);
    previousPath = path;
    return { row, groups };
  });
}
