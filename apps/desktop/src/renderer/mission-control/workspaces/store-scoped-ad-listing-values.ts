import { canonicalizeAmazonAsin, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { rendererRuntimeLog } from '../../runtime-log';
import { type ListingContentDraft, type StoreListingContentView, type StoreAdListingRendererApi, type StoreListingContentVersionView, type StoreAdObjectFactView } from "./store-scoped-ad-listing-contracts";

export function storeResultBelongsToContext(
  result: { storeId?: unknown; marketplace?: unknown; currency?: unknown },
  context: StoreContextEnvelope,
): boolean {
  return result.storeId === context.storeId
    && result.marketplace === 'US'
    && result.currency === 'USD';
}

export function buildListingCreateInput(draft: ListingContentDraft): Record<string, unknown> {
  return {
    asin: canonicalizeAmazonAsin(draft.asin),
    title: draft.title.trim(),
    bullets: listingBullets(draft.bulletsText),
    description: draft.description.trim(),
    aPlus: draft.aPlus.trim(),
    imageCopy: draft.imageCopy.trim(),
    backendTerms: draft.backendTerms.trim(),
    source: draft.source.trim() || 'manual',
    versionLabel: draft.versionLabel.trim(),
    changeSummary: draft.changeSummary.trim(),
    marketplace: 'US',
    currency: 'USD',
  };
}

export function buildListingUpdateInput(
  current: StoreListingContentView,
  draft: ListingContentDraft,
): { id: number; expectedRevision: string; patch: Record<string, unknown> } {
  const create = buildListingCreateInput(draft);
  const { asin: _asin, ...patch } = create;
  return {
    id: current.id,
    expectedRevision: current.revision,
    patch,
  };
}

export const LISTING_VERSION_PAGE_SIZE = 100;

export function buildListingVersionHistoryInput(
  target: Pick<StoreListingContentView, 'id'>,
): { listingContentId: number; limit: number; offset: number } {
  return {
    listingContentId: target.id,
    limit: LISTING_VERSION_PAGE_SIZE,
    offset: 0,
  };
}

export function buildStoreListingVersionLedgerInput(
  offset = 0,
): { limit: number; offset: number } {
  return { limit: LISTING_VERSION_PAGE_SIZE, offset };
}

export async function readListingVersionHistoryForTarget(
  method: NonNullable<StoreAdListingRendererApi['listStoreListingContentVersions']>,
  context: StoreContextEnvelope,
  target: StoreListingContentView,
): Promise<StoreListingContentVersionView[]> {
  const result = await method(context, buildListingVersionHistoryInput(target));
  if (!Array.isArray(result)
    || result.some((row) => !storeListingVersionBelongsToContext(row, context, target))) {
    throw new Error('返回的版本历史与当前店铺或当前商品详情不一致');
  }
  return result;
}

export async function readStoreListingVersionLedgerPage(
  method: NonNullable<StoreAdListingRendererApi['listStoreListingContentVersions']>,
  context: StoreContextEnvelope,
  offset: number,
): Promise<StoreListingContentVersionView[]> {
  const result = await method(context, buildStoreListingVersionLedgerInput(offset));
  if (!Array.isArray(result)
    || result.some((row) => !storeListingVersionBelongsToStoreContext(row, context))) {
    throw new Error('返回的版本记录与当前店铺不一致');
  }
  return result;
}

export function storeListingVersionBelongsToStoreContext(
  version: StoreListingContentVersionView,
  context: StoreContextEnvelope,
): boolean {
  return version.storeId === context.storeId;
}

export function storeListingVersionBelongsToContext(
  version: StoreListingContentVersionView,
  context: StoreContextEnvelope,
  target: StoreListingContentView,
): boolean {
  const sameListing = version.listingContentId === undefined
    || version.listingContentId === target.id;
  return version.storeId === context.storeId
    && sameListing
    && version.asin.trim().toUpperCase() === target.asin.trim().toUpperCase();
}

export function listingVersionResponseIsCurrent(
  request: number,
  latestRequest: number,
  capturedAuthorityKey: string,
  currentAuthorityKey: string,
): boolean {
  return request === latestRequest && capturedAuthorityKey === currentAuthorityKey;
}

export function resolveApi(api?: Partial<StoreAdListingRendererApi>): Partial<StoreAdListingRendererApi> {
  if (api) return api;
  if (typeof window === 'undefined') return {};
  return (window as unknown as { electronAPI?: Partial<StoreAdListingRendererApi> }).electronAPI ?? {};
}

export function emptyListingDraft(): ListingContentDraft {
  return {
    asin: '',
    title: '',
    bulletsText: '',
    description: '',
    aPlus: '',
    imageCopy: '',
    backendTerms: '',
    source: 'manual',
    versionLabel: '',
    changeSummary: '',
  };
}

export function listingDraft(row: StoreListingContentView): ListingContentDraft {
  return {
    asin: row.asin,
    title: row.title,
    bulletsText: row.bullets.join('\n'),
    description: row.description,
    aPlus: row.aPlus,
    imageCopy: row.imageCopy,
    backendTerms: row.backendTerms,
    source: row.source || 'manual',
    versionLabel: row.versionLabel,
    changeSummary: row.changeSummary,
  };
}

export function listingBullets(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

export function listingCoverage(row: StoreListingContentView): number {
  return [row.title, row.bullets.length > 0, row.description, row.imageCopy, row.backendTerms]
    .filter(Boolean).length;
}

export function listingSourceLabel(source: string): string {
  if (source === 'manual') return '人工录入';
  if (source === 'lingxing') return '领星读取';
  if (source === 'import') return '本地导入';
  return source.trim() || '来源未知';
}

export function objectHierarchy(row: StoreAdObjectFactView): string {
  const usableName = (value: string | undefined) => {
    const name = value?.trim();
    return name && name !== row.entityId && name !== row.objectKey ? name : '';
  };
  const campaign = usableName(row.campaignName) || (row.kind === 'campaign' ? usableName(row.name) : '') || '未提供';
  const group = row.kind === 'campaign' ? '不适用' : usableName(row.adGroupName) || (row.kind === 'ad_group' ? usableName(row.name) : '') || '未提供';
  return [`广告活动：${campaign}`, `广告组：${group}`, row.asin ? `ASIN：${row.asin}` : ''].filter(Boolean).join(' · ');
}

export function opportunityLabel(level?: string): string {
  if (level === 'high') return '高机会';
  if (level === 'medium') return '中机会';
  if (level === 'low') return '低机会';
  return '仅指标';
}

export function usd(value: unknown): string {
  const numeric = Number(value);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format(Number.isFinite(numeric) ? numeric : 0);
}

export function integer(value: unknown): string {
  const numeric = Number(value);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
    .format(Number.isFinite(numeric) ? numeric : 0);
}

export function percent(value: unknown): string {
  const numeric = Number(value);
  return `${((Number.isFinite(numeric) ? numeric : 0) * 100).toFixed(1)}%`;
}

export function userError(caught: unknown, fallback: string): string {
  rendererRuntimeLog.error('renderer.store_ad_listing_failed', { error: caught, operation: fallback });
  const message = caught instanceof Error
    ? caught.message.trim()
    : typeof caught === 'string'
      ? caught.trim()
      : '';
  const internalCopy = /Main|StoreContext|Authority|Renderer|Profile|Mission|Decision|Experiment|UNKNOWN|revision|draft|set_keyword_bid|manifest|fingerprint|dry-run|CRUD|PRODUCTION_NATIVE|PROTOTYPE_ONLY|LEGACY_ADAPTER|sequence|append-only|correction|READBACK|EFFECT|remote method|store-ad-listing/i;
  if (!message || internalCopy.test(message)) {
    return `${fallback}：当前店铺数据校验未通过，请刷新后重试。`;
  }
  if (/请.+重试。?$/.test(message)) return message;
  return `${fallback}：${message.replace(/[。；;:]?$/, '')}。请刷新后重试。`;
}
