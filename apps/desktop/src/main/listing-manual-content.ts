import type { ListingContent, ListingContentVersion } from '@amazon-ai-ops/shared-types';

export function validateManualListingInput(listing: Partial<ListingContent>): void {
  if (!String(listing.asin || '').trim()) {
    throw new Error('ASIN 必填');
  }
  const bullets = normalizeBullets(listing.bullets);
  const hasContent = [
    listing.title,
    listing.description,
    listing.aPlus,
    listing.imageCopy,
    listing.backendTerms,
    ...bullets,
  ].some((value) => String(value || '').trim().length > 0);
  if (!hasContent) {
    throw new Error('至少填写标题、五点、详情或后台搜索词中的一项');
  }
}

export function normalizeManualListingContent(listing: Partial<ListingContent>): ListingContent {
  validateManualListingInput(listing);
  return {
    id: listing.id,
    asin: String(listing.asin || '').trim().toUpperCase(),
    title: String(listing.title || '').trim(),
    bullets: normalizeBullets(listing.bullets),
    description: String(listing.description || '').trim(),
    aPlus: String(listing.aPlus || '').trim(),
    imageCopy: String(listing.imageCopy || '').trim(),
    backendTerms: String(listing.backendTerms || '').trim(),
    source: listing.source || 'manual',
    sourceUrl: String(listing.sourceUrl || '').trim(),
    screenshotPath: String(listing.screenshotPath || '').trim(),
    versionLabel: String(listing.versionLabel || '').trim(),
    changeSummary: String(listing.changeSummary || '').trim(),
    updatedAt: listing.updatedAt,
    createdAt: listing.createdAt,
  };
}

export function buildManualListingVersionSnapshot(input: {
  listingContentId?: number;
  listing: Partial<ListingContent>;
  storeName?: string;
  marketplaceCode?: string;
}): ListingContentVersion {
  const normalized = normalizeManualListingContent(input.listing);
  return {
    ...normalized,
    versionId: 0,
    listingContentId: input.listingContentId,
    storeName: input.storeName,
    marketplaceCode: input.marketplaceCode,
  };
}

function normalizeBullets(input?: string[]): string[] {
  return (input || []).map((item) => String(item || '').trim()).filter(Boolean);
}
