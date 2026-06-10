import type { ListingContent } from '@amazon-ai-ops/shared-types';

export interface ListingDomFieldSnapshot {
  key: string;
  label: string;
  value: string;
}

export interface ListingDetailCandidateSnapshot {
  key: string;
  label: string;
  text: string;
  href?: string;
  selectorHint?: string;
}

export interface ListingPageSnapshot {
  url: string;
  title: string;
  asinCandidates: string[];
  fields: ListingDomFieldSnapshot[];
  detailCandidates?: ListingDetailCandidateSnapshot[];
  capturedAt?: string;
}

export interface ListingExtractionEvidence {
  pageUrl: string;
  pageTitle: string;
  fieldMatches: Record<string, string[]>;
  completeness: Record<keyof Pick<ListingContent, 'asin' | 'title' | 'bullets' | 'backendTerms'>, boolean>;
  partialReady: boolean;
  fullContentReady: boolean;
  detailCandidates?: ListingDetailCandidateSnapshot[];
  detailProbe?: {
    started: boolean;
    clicked: boolean;
    status: string;
    fromUrl?: string;
    finalUrl?: string;
    candidateCount?: number;
    candidateText?: string;
    candidateHref?: string;
    asinMatched?: boolean;
    reason?: string;
  };
  capturedAt?: string;
  screenshotPath?: string;
}

export interface ListingExtractionResult {
  ready: boolean;
  partialReady: boolean;
  fullContentReady: boolean;
  reason?: string;
  listing?: ListingContent;
  evidence: ListingExtractionEvidence;
}

const ASIN_PATTERN = /\bB0[A-Z0-9]{8}\b/i;

export function extractLingxingListingFromSnapshot(snapshot: ListingPageSnapshot): ListingExtractionResult {
  const fieldMatches: ListingExtractionEvidence['fieldMatches'] = {};
  const fields = snapshot.fields.map((field) => ({
    ...field,
    labelNorm: normalizeLabel(`${field.key} ${field.label}`),
  }));

  const asin = findAsin(snapshot, fields);
  const title = findTitle(fields, asin.value);
  const bullets = findBulletFields(fields);
  const backendTerms = findFirstFieldValue(fields, [
    'backendterms',
    'searchterms',
    'generickeyword',
    'generickeywords',
    'hiddenkeywords',
    '关键词',
    '搜索词',
    '后台词',
  ]);
  const aPlus = findFirstFieldValue(fields, ['aplus', 'a+', '品牌描述', '图文描述']);
  const imageCopy = findFirstFieldValue(fields, ['imagecopy', '图片文案', '主图文案']);

  fieldMatches.asin = asin.matches;
  fieldMatches.title = title.matches;
  fieldMatches.bullets = bullets.matches;
  fieldMatches.backendTerms = backendTerms.matches;
  fieldMatches.aPlus = aPlus.matches;
  fieldMatches.imageCopy = imageCopy.matches;

  const listing: ListingContent = {
    asin: asin.value,
    title: title.value,
    bullets: bullets.value,
    aPlus: aPlus.value,
    imageCopy: imageCopy.value,
    backendTerms: backendTerms.value,
    updatedAt: snapshot.capturedAt,
  };

  const partialReady = Boolean(listing.asin && listing.title);
  const fullContentReady = Boolean(partialReady && listing.bullets.length > 0 && listing.backendTerms);
  const evidence: ListingExtractionEvidence = {
    pageUrl: snapshot.url,
    pageTitle: snapshot.title,
    fieldMatches,
    completeness: {
      asin: Boolean(listing.asin),
      title: Boolean(listing.title),
      bullets: listing.bullets.length > 0,
      backendTerms: Boolean(listing.backendTerms),
    },
    partialReady,
    fullContentReady,
    detailCandidates: snapshot.detailCandidates?.slice(0, 20) ?? [],
    capturedAt: snapshot.capturedAt,
  };

  if (!listing.asin || !listing.title) {
    const pageText = fields.map((field) => field.value).join('\n');
    const reason = /网络异常|稍后重试|加载失败/.test(pageText)
      ? '当前领星 Listing 页面显示网络异常或数据加载失败，未读取到 ASIN 和标题。'
      : '当前页面未识别到 ASIN 和标题，不能作为领星 Listing 实读证据。';
    return {
      ready: false,
      partialReady: false,
      fullContentReady: false,
      reason,
      evidence,
    };
  }

  return {
    ready: true,
    partialReady,
    fullContentReady,
    listing,
    evidence,
  };
}

function findAsin(
  snapshot: ListingPageSnapshot,
  fields: Array<ListingDomFieldSnapshot & { labelNorm: string }>,
): { value: string; matches: string[] } {
  for (const value of snapshot.asinCandidates) {
    const match = value.match(ASIN_PATTERN)?.[0]?.toUpperCase();
    if (match) {
      return { value: match, matches: ['page-candidate'] };
    }
  }
  for (const field of fields) {
    const match = field.value.match(ASIN_PATTERN)?.[0]?.toUpperCase();
    if (match) {
      return { value: match, matches: [field.key] };
    }
  }
  return { value: '', matches: [] };
}

function findFirstFieldValue(
  fields: Array<ListingDomFieldSnapshot & { labelNorm: string }>,
  labels: string[],
): { value: string; matches: string[] } {
  const normalizedLabels = labels.map(normalizeLabel);
  const match = fields.find((field) =>
    field.value && normalizedLabels.some((label) => field.labelNorm.includes(label)),
  );
  return {
    value: match?.value.trim() ?? '',
    matches: match ? [match.key] : [],
  };
}

function findTitle(
  fields: Array<ListingDomFieldSnapshot & { labelNorm: string }>,
  asin: string,
): { value: string; matches: string[] } {
  const explicit = findFirstFieldValue(fields, ['title', 'itemname', 'productname', 'listingtitle', '商品标题', '标题', '品名']);
  if (explicit.value && isLikelyTitleSegment(explicit.value)) {
    return explicit;
  }
  if (!asin) {
    return { value: '', matches: [] };
  }

  const candidates = fields
    .filter((field) => field.value.toUpperCase().includes(asin.toUpperCase()))
    .flatMap((field) => field.value
      .split(/\r?\n|\t|\s{2,}/)
      .map((segment) => ({ field, segment: segment.trim() })))
    .filter((item) => item.segment)
    .filter((item) => !item.segment.toUpperCase().includes(asin.toUpperCase()))
    .filter((item) => isLikelyTitleSegment(item.segment));
  const best = candidates
    .sort((a, b) => scoreTitleCandidate(b.segment) - scoreTitleCandidate(a.segment))[0];
  const value = best?.segment ?? '';
  return {
    value,
    matches: best ? [best.field.key] : [],
  };
}

function isLikelyTitleSegment(segment: string): boolean {
  const clean = segment.trim();
  if (clean.length < 5 || clean.length > 240) return false;
  if (/^\$?\s*[\d,.]+(?:%|天)?$/.test(clean)) return false;
  if (/^(ft|hj|jf|us|usa|美国|英国|fba|fbm|在售|停售|-|—)$/i.test(clean)) return false;
  if (/^[A-Z0-9_-]{6,}$/.test(clean)) return false;
  if (/^\d+\s*\|\s*\d+\s*\|\s*\d+$/.test(clean)) return false;
  return /[\u4e00-\u9fa5A-Za-z]/.test(clean);
}

function scoreTitleCandidate(segment: string): number {
  let score = segment.length;
  if (/[\u4e00-\u9fa5]/.test(segment)) score += 20;
  if (/[A-Za-z]{3,}/.test(segment)) score += 10;
  if (/[$%]|\d+\s*\|\s*\d+/.test(segment)) score -= 30;
  return score;
}

function findBulletFields(
  fields: Array<ListingDomFieldSnapshot & { labelNorm: string }>,
): { value: string[]; matches: string[] } {
  const bulletLike = fields.filter((field) => {
    if (!field.value) return false;
    if (/(description|描述|详情|aplus|a\+)/i.test(field.labelNorm) && !/(bullet|五点|卖点|要点)/i.test(field.labelNorm)) {
      return false;
    }
    return /(bullet|bullets|五点|卖点|要点|feature)/i.test(field.labelNorm);
  });
  const values = bulletLike
    .flatMap((field) => splitBulletText(field.value))
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    value: Array.from(new Set(values)).slice(0, 10),
    matches: bulletLike.map((field) => field.key),
  };
}

function splitBulletText(value: string): string[] {
  return value
    .split(/\r?\n|(?:^|\s)[1-9][.)、]\s+/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
}

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[：:＿_\-]/g, '');
}
