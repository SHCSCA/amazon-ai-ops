import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildListingHeatmapModel,
  buildListingTextDiffSegments,
  highlightListingTextSegments,
  listingCharacterLimitClass,
  listingDraftPanelClass,
  listingDraftGenerationMessage,
  listingDraftWorkspaceCopy,
  listingManualFieldGroups,
} from './listing-optimization-page';

function cssRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] || '';
}

describe('listingDraftGenerationMessage', () => {
  it('states when generated Listing drafts use local rule reference rather than AI output', () => {
    const message = listingDraftGenerationMessage(true, [
      { source: 'rule', aiFallbackReason: 'AI 返回 JSON 无法解析' },
      { source: 'rule', aiFallbackReason: 'AI 返回 JSON 无法解析' },
    ]);

    expect(message).toContain('2 条本地规则参考');
    expect(message).toContain('AI 返回 JSON 无法解析');
    expect(message).toContain('不会自动提交 Amazon');
    expect(message).not.toContain('占位草案');
    expect(message).not.toContain('规则兜底草案');
    expect(message).not.toContain('fallback');
  });

  it('states when AI drafts were actually produced', () => {
    const message = listingDraftGenerationMessage(true, [
      { source: 'ai' },
      { source: 'rule', aiFallbackReason: 'AI 部分字段缺失' },
    ]);

    expect(message).toContain('1 条 AI 草案');
    expect(message).toContain('1 条本地规则参考');
    expect(message).not.toContain('占位草案');
    expect(message).not.toContain('规则兜底草案');
    expect(message).not.toContain('fallback');
  });
});

describe('listingDraftWorkspaceCopy', () => {
  it('uses production wording for missing real ad data instead of placeholder or fallback copy', () => {
    const copy = listingDraftWorkspaceCopy({
      quantReady: false,
      keywordCount: 2,
      draftCount: 0,
      aiDraftCount: 0,
      ruleDraftCount: 0,
      aiStatusLabel: 'Listing AI 未配置',
      aiStatusDetail: '未配置 API Key，Listing 草案会生成本地规则参考。',
    });

    expect(copy.keywordPlaceholder).toContain('wide toe box');
    expect(copy.keywordPlaceholder).toContain('barefoot shoes');
    expect(copy.dataGateLabel).toBe('待补齐真实广告数据');
    expect(copy.draftUseLabel).toBe('仅本地预览');
    expect(copy.primaryActionLabel).toBe('生成本地预览草案');
    expect(Object.values(copy).join('\n')).not.toContain('占位草案');
    expect(Object.values(copy).join('\n')).not.toContain('规则兜底');
    expect(Object.values(copy).join('\n')).not.toContain('keyword one');
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

describe('Listing draft diff and feedback contract', () => {
  it('marks removed original words and added draft words for review', () => {
    const diff = buildListingTextDiffSegments(
      'Lightweight running shoes for men',
      'Barefoot running shoes for men wide toe box',
    );

    expect(diff.currentSegments).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'Lightweight', kind: 'removed' }),
    ]));
    expect(diff.draftSegments).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'Barefoot', kind: 'added' }),
      expect.objectContaining({ text: 'wide', kind: 'added' }),
      expect.objectContaining({ text: 'toe', kind: 'added' }),
      expect.objectContaining({ text: 'box', kind: 'added' }),
    ]));
  });

  it('exposes stable class contracts for draft skeleton and over-limit alarm', () => {
    expect(listingDraftPanelClass(true)).toContain('listing-heatmap-draft-generating');
    expect(listingDraftPanelClass(false)).not.toContain('listing-heatmap-draft-generating');
    expect(listingCharacterLimitClass(215, 200)).toContain('listing-heatmap-limit-over');
    expect(listingCharacterLimitClass(180, 200)).not.toContain('listing-heatmap-limit-over');
  });

  it('keeps the high-fidelity CSS for diff chips, skeleton wave, and flashing count', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.listing-heatmap-diff-added');
    expect(css).toContain('.listing-heatmap-diff-removed');
    expect(css).toContain('.listing-heatmap-draft-generating::after');
    expect(css).toContain('@keyframes listing-draft-skeleton');
    expect(css).toContain('@keyframes listing-limit-alert');
    expect(css).toContain('animation: listing-limit-alert');
  });

  it('isolates high-density heatmap cells with strict containment', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(cssRule(css, '.listing-heatmap-keyword')).toMatch(/contain:\s*strict/);
    expect(cssRule(css, '.listing-heatmap-text-grid > div')).toMatch(/contain:\s*strict/);
  });
});
