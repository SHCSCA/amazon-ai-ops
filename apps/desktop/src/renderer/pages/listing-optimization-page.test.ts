import { describe, expect, it } from 'vitest';
import {
  buildListingHeatmapModel,
  highlightListingTextSegments,
  listingDraftGenerationMessage,
  listingManualFieldGroups,
} from './listing-optimization-page';

describe('listingDraftGenerationMessage', () => {
  it('states when generated Listing drafts use rule fallback rather than AI output', () => {
    const message = listingDraftGenerationMessage(true, [
      { source: 'rule', aiFallbackReason: 'AI 返回 JSON 无法解析' },
      { source: 'rule', aiFallbackReason: 'AI 返回 JSON 无法解析' },
    ]);

    expect(message).toContain('2 条规则兜底草案');
    expect(message).toContain('AI 返回 JSON 无法解析');
    expect(message).toContain('不会自动提交 Amazon');
    expect(message).not.toContain('fallback');
  });

  it('states when AI drafts were actually produced', () => {
    const message = listingDraftGenerationMessage(true, [
      { source: 'ai' },
      { source: 'rule', aiFallbackReason: 'AI 部分字段缺失' },
    ]);

    expect(message).toContain('1 条 AI 草案');
    expect(message).toContain('1 条规则兜底草案');
    expect(message).not.toContain('fallback');
  });
});

describe('listingManualFieldGroups', () => {
  it('orders manual Listing fields like a table editor', () => {
    expect(listingManualFieldGroups().map((group) => group.title)).toEqual([
      '基础信息',
      '标题',
      '五点',
      '详情与搜索词',
    ]);
    expect(listingManualFieldGroups().flatMap((group) => group.fields.map((field) => field.label))).toContain('五点 5');
  });
});

describe('buildListingHeatmapModel', () => {
  it('builds a keyword heatmap from current Listing and local drafts', () => {
    const model = buildListingHeatmapModel({
      keywords: ['wide toe box', 'trail runner', 'wide toe box'],
      listing: {
        asin: 'B0ABCDEF12',
        title: 'Wide Toe Box Running Shoes',
        bullets: ['Lightweight mesh upper', 'Flexible walking sole'],
        backendTerms: 'running shoes men',
      },
      drafts: [
        {
          asin: 'B0ABCDEF12',
          section: 'bullet',
          currentText: 'Lightweight mesh upper',
          draftedText: 'Trail runner fit with wide toe box comfort',
          keywords: ['trail runner', 'wide toe box'],
          evidence: 'keyword opportunity',
          riskWarnings: [],
          source: 'rule',
          status: 'pending',
        },
      ],
    });

    expect(model.summary.keywordCount).toBe(2);
    expect(model.summary.coveredCount).toBe(2);
    expect(model.summary.draftGainCount).toBe(2);
    expect(model.keywords.find((item) => item.keyword === 'trail runner')).toMatchObject({
      level: 'warning',
      recommendedSection: '标题',
    });
    expect(model.sections.find((section) => section.key === 'bullet-1')?.draftHits).toEqual(['wide toe box', 'trail runner']);
  });

  it('marks missing keywords as pending and recommends the title first', () => {
    const model = buildListingHeatmapModel({
      keywords: ['barefoot shoes'],
      listing: { asin: 'B0ABCDEF12', title: 'Minimal sneaker', bullets: [], backendTerms: '' },
      drafts: [],
    });

    expect(model.summary.missingCount).toBe(1);
    expect(model.keywords[0]).toMatchObject({
      level: 'pending',
      recommendedSection: '标题',
    });
  });
});

describe('highlightListingTextSegments', () => {
  it('highlights only the active keyword when one is selected', () => {
    const segments = highlightListingTextSegments(
      'Wide toe box trail runner shoes',
      'trail runner',
      ['wide toe box', 'trail runner'],
    );

    expect(segments.filter((segment) => segment.matchedKeyword).map((segment) => segment.text)).toEqual(['trail runner']);
    expect(segments.find((segment) => segment.text === 'trail runner')?.active).toBe(true);
  });

  it('highlights all known keywords when no active keyword is selected', () => {
    const segments = highlightListingTextSegments(
      'Wide toe box trail runner shoes',
      null,
      ['wide toe box', 'trail runner'],
    );

    expect(segments.filter((segment) => segment.matchedKeyword).map((segment) => segment.text)).toEqual(['Wide toe box', 'trail runner']);
  });
});
