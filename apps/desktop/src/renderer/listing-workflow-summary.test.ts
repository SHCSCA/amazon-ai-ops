import { describe, expect, it } from 'vitest';
import {
  buildListingReadinessIssues,
  buildListingSourceStatus,
  buildListingWorkflowSummary,
  isListingReadyForDraft,
} from './listing-workflow-summary';

describe('buildListingWorkflowSummary', () => {
  it('blocks drafting until keyword opportunities are provided', () => {
    const summary = buildListingWorkflowSummary({
      keywordCount: 0,
      listingReadAttempted: false,
      listingReady: false,
      draftCount: 0,
      aiDraftCount: 0,
      ruleDraftCount: 0,
      aiStatusLabel: 'Listing AI 可用',
      quantReady: true,
    });

    expect(summary.statusLabel).toBe('待输入关键词');
    expect(summary.tone).toBe('pending');
    expect(summary.headline).toBe('先从关键词机会带入或粘贴关键词。');
    expect(summary.blockers).toEqual(['缺少关键词机会输入']);
    expect(summary.nextAction).toBe('去关键词机会页带入当前范围关键词，或在本页粘贴关键词。');
  });

  it('keeps incomplete Listing content from drafting', () => {
    const summary = buildListingWorkflowSummary({
      keywordCount: 3,
      listingReadAttempted: true,
      listingReady: false,
      draftCount: 0,
      aiDraftCount: 0,
      ruleDraftCount: 0,
      aiStatusLabel: 'Listing AI 可用',
      quantReady: true,
    });

    expect(summary.statusLabel).toBe('Listing 待核对');
    expect(summary.tone).toBe('warning');
    expect(summary.headline).toBe('关键词已就绪，但 Listing 内容未达到生成草案门槛。');
    expect(summary.blockers).toContain('Listing 未完整读取或 ASIN 未核对通过');
    expect(summary.nextAction).toBe('手工录入并核对 ASIN、标题、五点和后台词；领星读取只作为辅助填充。');
  });

  it('marks finished drafts as local export only and never publish-ready', () => {
    const summary = buildListingWorkflowSummary({
      keywordCount: 5,
      listingReadAttempted: true,
      listingReady: true,
      draftCount: 4,
      aiDraftCount: 2,
      ruleDraftCount: 2,
      aiStatusLabel: 'Listing AI 可用',
      quantReady: true,
    });

    expect(summary.statusLabel).toBe('可导出草案');
    expect(summary.tone).toBe('ready');
    expect(summary.headline).toBe('已有 4 条本地 Listing 草案，可导出给运营复核。');
    expect(summary.nextAction).toBe('导出草案并人工复核，不自动提交 Amazon 或改写 Lingxing Listing。');
    expect(summary.facts).toContain('AI 草案 2 条 / 规则草案 2 条');
    expect(summary.boundary).toBe('只生成本地草案，不提交 Amazon，不修改 Lingxing Listing。');
  });

  it('uses Chinese fallback copy when real ad data is missing', () => {
    const summary = buildListingWorkflowSummary({
      keywordCount: 3,
      listingReadAttempted: true,
      listingReady: true,
      draftCount: 0,
      aiDraftCount: 0,
      ruleDraftCount: 0,
      aiStatusLabel: 'Listing AI 可用',
      quantReady: false,
    });

    expect(summary.facts).toContain('缺真实广告数据，仅规则兜底');
    expect(summary.headline).toBe('关键词和 Listing 已就绪，但缺真实广告数据，只能生成规则兜底草案。');
    expect(summary.nextAction).toBe('生成规则兜底草案，或先补齐真实广告数据后再生成。');
    expect(summary.facts.join('\n')).not.toContain('fallback');
    expect(summary.headline).not.toContain('fallback');
    expect(summary.nextAction).not.toContain('fallback');
  });
});

describe('buildListingReadinessIssues', () => {
  it('lists exact blockers for a probed Listing page with missing fields', () => {
    const issues = buildListingReadinessIssues({
      listingReadAttempted: true,
      hasListing: true,
      expectedAsin: 'B0TARGETASIN',
      listingAsin: 'B0TARGETASIN',
      pageMatched: true,
      asinMatched: true,
      titleRead: true,
      bulletsRead: false,
      backendTermsRead: false,
      scopeMatched: false,
      readScopeAvailable: true,
    });

    expect(issues).toEqual(['五点缺失', '后台词缺失', '店铺/站点未核对通过']);
  });

  it('calls out ASIN mismatch instead of a generic Listing blocker', () => {
    const issues = buildListingReadinessIssues({
      listingReadAttempted: true,
      hasListing: true,
      expectedAsin: 'B0TARGETASIN',
      listingAsin: 'B0OTHERASIN',
      pageMatched: false,
      asinMatched: false,
      titleRead: true,
      bulletsRead: true,
      backendTermsRead: true,
      scopeMatched: true,
      readScopeAvailable: true,
    });

    expect(issues).toContain('页面 ASIN 与目标 ASIN 不一致');
    expect(issues).not.toContain('Listing 未完整读取或 ASIN 未核对通过');
  });

  it('returns no blockers when current page has the required Listing evidence', () => {
    const issues = buildListingReadinessIssues({
      listingReadAttempted: true,
      hasListing: true,
      expectedAsin: 'B0TARGETASIN',
      listingAsin: 'B0TARGETASIN',
      pageMatched: true,
      asinMatched: true,
      titleRead: true,
      bulletsRead: true,
      backendTermsRead: true,
      scopeMatched: true,
      readScopeAvailable: true,
    });

    expect(issues).toEqual([]);
  });
});

describe('buildListingSourceStatus', () => {
  it('keeps not-entered wording before the user provides Listing content', () => {
    const status = buildListingSourceStatus({
      listingReadAttempted: false,
      hasListing: false,
      listingReady: false,
      pageMatched: false,
      asinMatched: false,
      titleRead: false,
      bulletsRead: false,
      backendTermsRead: false,
    });

    expect(status.label).toBe('未读取');
    expect(status.headline).toBe('尚未录入或读取当前 Listing 内容');
    expect(status.missingFieldLabel).toBe('未读取');
  });

  it('shows evidence-only probes as parsed failure instead of still unread', () => {
    const status = buildListingSourceStatus({
      listingReadAttempted: true,
      hasListing: false,
      listingReady: false,
      pageMatched: false,
      asinMatched: false,
      titleRead: false,
      bulletsRead: false,
      backendTermsRead: false,
    });

    expect(status.label).toBe('已探测未解析');
    expect(status.headline).toBe('已探测页面，但没有解析到可用 Listing 内容');
    expect(status.missingFieldLabel).toBe('缺失');
  });

  it('shows partial reads as partial content, not unread', () => {
    const status = buildListingSourceStatus({
      listingReadAttempted: true,
      hasListing: true,
      listingReady: false,
      pageMatched: true,
      asinMatched: true,
      titleRead: true,
      bulletsRead: false,
      backendTermsRead: false,
    });

    expect(status.label).toBe('已读取部分内容');
    expect(status.headline).toBe('已读取 Listing 部分内容，生成草案前需补齐缺失字段');
    expect(status.missingFieldLabel).toBe('缺失');
  });

  it('marks fully verified Listing reads as complete', () => {
    const status = buildListingSourceStatus({
      listingReadAttempted: true,
      hasListing: true,
      listingReady: true,
      pageMatched: true,
      asinMatched: true,
      titleRead: true,
      bulletsRead: true,
      backendTermsRead: true,
    });

    expect(status.label).toBe('完整读取');
    expect(status.headline).toBe('当前 Listing 内容已完整录入并通过核对');
    expect(status.missingFieldLabel).toBe('缺失');
  });
});

describe('isListingReadyForDraft', () => {
  it('blocks draft generation when the Lingxing read scope does not match the current scope', () => {
    expect(isListingReadyForDraft({
      hasListing: true,
      pageMatched: true,
      asinMatched: true,
      titleRead: true,
      bulletsRead: true,
      backendTermsRead: true,
      scopeMatched: false,
      readScopeAvailable: true,
    })).toBe(false);
  });

  it('blocks draft generation when the Lingxing read result has no store or marketplace scope', () => {
    expect(isListingReadyForDraft({
      hasListing: true,
      pageMatched: true,
      asinMatched: true,
      titleRead: true,
      bulletsRead: true,
      backendTermsRead: true,
      scopeMatched: false,
      readScopeAvailable: false,
    })).toBe(false);
  });

  it('allows draft generation only after page, content, ASIN and scope checks pass', () => {
    expect(isListingReadyForDraft({
      hasListing: true,
      pageMatched: true,
      asinMatched: true,
      titleRead: true,
      bulletsRead: true,
      backendTermsRead: true,
      scopeMatched: true,
      readScopeAvailable: true,
    })).toBe(true);
  });
});
