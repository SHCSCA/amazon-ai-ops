import { describe, expect, it } from 'vitest';
import { buildListingAiCallLogInput, buildListingRewritePrompt, parseAiDraftResponse } from './listing-ai-draft';
import type { ListingDraft } from '@amazon-ai-ops/shared-types';

describe('listing AI draft prompt and parser', () => {
  it('builds a Chinese JSON-only prompt with a stable schema version', () => {
    const prompt = buildListingRewritePrompt('模板要求', draft(), {
      aiOutputLanguage: '简体中文',
      aiPersona: '你是资深中文亚马逊 Listing 优化顾问。',
    });

    expect(prompt).toContain('你是资深中文亚马逊 Listing 优化顾问。');
    expect(prompt).toContain('所有 reason 和 riskWarnings 必须使用简体中文');
    expect(prompt).toContain('只返回 JSON');
    expect(prompt).toContain('"schemaVersion": "listing_rewrite_v1"');
    expect(prompt).toContain('不得使用人民币、RMB、CNY、¥');
  });

  it('parses a fenced structured JSON response', () => {
    const parsed = parseAiDraftResponse(`\`\`\`json
${JSON.stringify({
  schemaVersion: 'listing_rewrite_v1',
  suggestedText: 'Rechargeable motion sensor closet light with easy installation',
  reason: '覆盖当前高意向关键词，并保留原有使用场景。',
  riskWarnings: ['需人工确认关键词相关性。'],
})}
\`\`\``);

    expect(parsed).toEqual({
      suggestedText: 'Rechargeable motion sensor closet light with easy installation',
      reason: '覆盖当前高意向关键词，并保留原有使用场景。',
      riskWarnings: ['需人工确认关键词相关性。'],
    });
  });

  it('rejects malformed or non-Chinese reasoning so the draft falls back to rules', () => {
    expect(parseAiDraftResponse(JSON.stringify({
      schemaVersion: 'listing_rewrite_v1',
      suggestedText: 'Rechargeable light',
      reason: 'Good keyword coverage',
      riskWarnings: ['Check relevance'],
    }))).toBeNull();

    expect(parseAiDraftResponse(JSON.stringify({
      suggestedText: 'Rechargeable light',
      reason: '覆盖关键词。',
      riskWarnings: ['需人工复核。'],
    }))).toBeNull();
  });

  it('builds an auditable AI call log input without storing prompt text or API keys', () => {
    const log = buildListingAiCallLogInput({
      draft: draft({ evidence: '包含真实广告数据证据和 sk-should-not-persist-123456789' }),
      model: 'deepseek-v4-flash',
      outputJson: JSON.stringify({ schemaVersion: 'listing_rewrite_v1', suggestedText: 'ok' }),
      success: true,
    });

    expect(log).toMatchObject({
      promptKey: 'listing_rewrite',
      promptVersion: 'listing_rewrite_v1',
      model: 'deepseek-v4-flash',
      schemaVersion: 'listing_rewrite_v1',
      success: true,
      evidencePackSummary: {
        total: 1,
        listingDraft: 1,
        keywordCount: 1,
      },
    });
    expect(log.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(log)).not.toContain('sk-should-not-persist');
    expect(JSON.stringify(log)).not.toContain('包含真实广告数据证据');
  });
});

function draft(patch: Partial<ListingDraft> = {}): ListingDraft {
  return {
    asin: 'B0TESTASIN',
    section: 'title',
    currentText: 'Rechargeable Motion Sensor Wall Light',
    draftedText: 'Rechargeable Motion Sensor Wall Light closet light',
    keywords: ['closet light'],
    evidence: '关键词来自当前范围真实广告数据。',
    riskWarnings: ['需人工复核相关性'],
    source: 'rule',
    status: 'pending',
    ...patch,
  };
}
