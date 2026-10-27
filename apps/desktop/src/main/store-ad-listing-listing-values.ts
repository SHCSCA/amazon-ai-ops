import { createHash } from 'crypto';
import { type VersionedStoreListingContent, StoreScopedAdListingError } from "./store-ad-listing-contracts";
import { normalizeAsinForWrite, optionalText, normalizeStringArray } from "./store-ad-listing-input-values";

export function normalizeListingCreate(input: Record<string, unknown>) {
  return {
    asin: normalizeAsinForWrite(input.asin),
    title: optionalText(input.title, 'title', 500) ?? '',
    bullets: normalizeStringArray(input.bullets, 'bullets', 10, 2_000),
    description: optionalText(input.description, 'description', 20_000) ?? '',
    aPlus: optionalText(input.aPlus ?? input.a_plus, 'aPlus', 20_000) ?? '',
    imageCopy: optionalText(input.imageCopy ?? input.image_copy, 'imageCopy', 20_000) ?? '',
    backendTerms: optionalText(input.backendTerms ?? input.backend_terms, 'backendTerms', 5_000) ?? '',
    source: optionalText(input.source, 'source', 80) ?? 'manual',
    versionLabel: optionalText(input.versionLabel ?? input.version_label, 'versionLabel', 160) ?? '',
    changeSummary: optionalText(input.changeSummary ?? input.change_summary, 'changeSummary', 1_000) ?? '',
  };
}

export function mergeListingPatch(
  current: VersionedStoreListingContent,
  patch: Record<string, unknown>,
) {
  return {
    title: patch.title === undefined ? current.title : optionalText(patch.title, 'title', 500) ?? '',
    bullets: patch.bullets === undefined
      ? current.bullets
      : normalizeStringArray(patch.bullets, 'bullets', 10, 2_000),
    description: patch.description === undefined
      ? current.description
      : optionalText(patch.description, 'description', 20_000) ?? '',
    aPlus: patch.aPlus === undefined && patch.a_plus === undefined
      ? current.aPlus
      : optionalText(patch.aPlus ?? patch.a_plus, 'aPlus', 20_000) ?? '',
    imageCopy: patch.imageCopy === undefined && patch.image_copy === undefined
      ? current.imageCopy
      : optionalText(patch.imageCopy ?? patch.image_copy, 'imageCopy', 20_000) ?? '',
    backendTerms: patch.backendTerms === undefined && patch.backend_terms === undefined
      ? current.backendTerms
      : optionalText(patch.backendTerms ?? patch.backend_terms, 'backendTerms', 5_000) ?? '',
    source: patch.source === undefined
      ? current.source
      : optionalText(patch.source, 'source', 80) ?? 'manual',
    versionLabel: patch.versionLabel === undefined && patch.version_label === undefined
      ? current.versionLabel
      : optionalText(patch.versionLabel ?? patch.version_label, 'versionLabel', 160) ?? '',
    changeSummary: patch.changeSummary === undefined && patch.change_summary === undefined
      ? current.changeSummary
      : optionalText(patch.changeSummary ?? patch.change_summary, 'changeSummary', 1_000) ?? '',
  };
}

export function listingRevision(input: Omit<VersionedStoreListingContent, 'revision'>): string {
  return `listing-content-v1:${createHash('sha256').update(JSON.stringify({
    id: input.id,
    storeId: input.storeId,
    asin: input.asin,
    asinValid: input.asinValid,
    title: input.title,
    bullets: input.bullets,
    description: input.description,
    aPlus: input.aPlus,
    imageCopy: input.imageCopy,
    backendTerms: input.backendTerms,
    source: input.source,
    versionLabel: input.versionLabel,
    changeSummary: input.changeSummary,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  })).digest('hex')}`;
}

export function assertExpectedRevision(value: unknown, actual: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new StoreScopedAdListingError(
      'CAS_REQUIRED',
      'expectedRevision is required for Listing update and delete',
    );
  }
  if (value !== actual) {
    throw new StoreScopedAdListingError('OBJECT_CONFLICT', 'Listing content changed after it was read');
  }
}
