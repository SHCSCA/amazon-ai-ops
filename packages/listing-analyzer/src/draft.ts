import type { ListingDraft, ListingSuggestion } from '@amazon-ai-ops/shared-types';

const BLOCKING_RISK_FLAGS = new Set([
  'possible_competitor_brand',
  'medical_claim',
  'absolute_claim',
  'trademark_risk',
  'false_claim',
]);

export interface BuildListingDraftOptions {
  appVersion?: string;
}

export function buildRuleBasedListingDrafts(
  suggestions: ListingSuggestion[],
  options: BuildListingDraftOptions = {},
): ListingDraft[] {
  const groups = new Map<string, ListingSuggestion[]>();

  for (const suggestion of suggestions) {
    if (suggestion.status !== 'accepted') {
      continue;
    }
    if (suggestion.riskWarnings.some((flag) => BLOCKING_RISK_FLAGS.has(flag))) {
      continue;
    }
    const key = `${suggestion.asin}::${suggestion.section}`;
    groups.set(key, [...(groups.get(key) ?? []), suggestion]);
  }

  return Array.from(groups.values()).map((items) => {
    const first = items[0];
    const keywords = Array.from(new Set(items.map((item) => item.keyword)));
    const draftedText = mergeSuggestedText(items);

    return {
      appVersion: options.appVersion,
      asin: first.asin,
      section: first.section,
      currentText: first.currentText,
      draftedText,
      keywords,
      evidence: items.map((item) => `${item.keyword}: ${item.evidence}`).join('\n'),
      riskWarnings: Array.from(new Set(items.flatMap((item) => item.riskWarnings))),
      source: 'rule',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  });
}

function mergeSuggestedText(suggestions: ListingSuggestion[]): string {
  const sorted = [...suggestions].sort((a, b) => b.suggestedText.length - a.suggestedText.length);
  let draft = sorted[0]?.suggestedText ?? '';

  for (const suggestion of sorted.slice(1)) {
    if (!containsKeyword(draft, suggestion.keyword)) {
      draft = `${draft} ${suggestion.keyword}.`.replace(/\s+/g, ' ').trim();
    }
  }

  return draft;
}

function containsKeyword(text: string, keyword: string): boolean {
  return text.toLowerCase().includes(keyword.toLowerCase());
}
