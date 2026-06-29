export type ListingWorkflowTone = 'ready' | 'pending' | 'warning' | 'blocked';

export interface ListingWorkflowSummaryInput {
  keywordCount: number;
  listingReadAttempted: boolean;
  listingReady: boolean;
  listingReadinessIssues?: string[];
  draftCount: number;
  aiDraftCount: number;
  ruleDraftCount: number;
  aiStatusLabel: string;
  quantReady: boolean;
}

export interface ListingReadinessIssueInput {
  listingReadAttempted: boolean;
  hasListing: boolean;
  expectedAsin?: string;
  listingAsin?: string;
  pageMatched: boolean;
  asinMatched: boolean;
  titleRead: boolean;
  bulletsRead: boolean;
  backendTermsRead: boolean;
  scopeMatched: boolean;
  readScopeAvailable: boolean;
}

export interface ListingReadyForDraftInput {
  hasListing: boolean;
  pageMatched: boolean;
  asinMatched: boolean;
  titleRead: boolean;
  bulletsRead: boolean;
  backendTermsRead: boolean;
  scopeMatched: boolean;
  readScopeAvailable: boolean;
}

export interface ListingWorkflowSummary {
  statusLabel: string;
  tone: ListingWorkflowTone;
  headline: string;
  facts: string[];
  blockers: string[];
  nextAction: string;
  boundary: string;
}

export interface ListingSourceStatusInput {
  listingReadAttempted: boolean;
  hasListing: boolean;
  listingReady: boolean;
  pageMatched: boolean;
  asinMatched: boolean;
  titleRead: boolean;
  bulletsRead: boolean;
  backendTermsRead: boolean;
}

export interface ListingSourceStatus {
  label: string;
  tone: ListingWorkflowTone;
  headline: string;
  missingFieldLabel: string;
}

export function buildListingReadinessIssues(input: ListingReadinessIssueInput): string[] {
  if (!input.listingReadAttempted) return ['尚未录入或读取 Listing 内容'];
  if (!input.hasListing) return ['已探测页面但未形成可用 Listing 内容'];

  const issues: string[] = [];
  const expectedAsin = input.expectedAsin?.trim().toUpperCase();
  const listingAsin = input.listingAsin?.trim().toUpperCase();

  if (expectedAsin && listingAsin && expectedAsin !== listingAsin) {
    issues.push('页面 ASIN 与目标 ASIN 不一致');
  } else if (!input.asinMatched || !input.pageMatched) {
    issues.push('ASIN 未核对通过');
  }
  if (!input.titleRead) issues.push('标题缺失');
  if (!input.bulletsRead) issues.push('五点缺失');
  if (!input.backendTermsRead) issues.push('后台词缺失');
  if (input.readScopeAvailable && !input.scopeMatched) issues.push('店铺/站点未核对通过');
  if (!input.readScopeAvailable) issues.push('读取结果缺少店铺/站点范围');

  return issues;
}

export function buildListingSourceStatus(input: ListingSourceStatusInput): ListingSourceStatus {
  if (!input.listingReadAttempted) {
    return {
      label: '未读取',
      tone: 'blocked',
      headline: '尚未录入或读取当前 Listing 内容',
      missingFieldLabel: '未读取',
    };
  }

  if (!input.hasListing) {
    return {
      label: '已探测未解析',
      tone: 'warning',
      headline: '已探测页面，但没有解析到可用 Listing 内容',
      missingFieldLabel: '缺失',
    };
  }

  if (input.listingReady) {
    return {
      label: '完整读取',
      tone: 'ready',
      headline: '当前 Listing 内容已完整录入并通过核对',
      missingFieldLabel: '缺失',
    };
  }

  if (!input.pageMatched || !input.asinMatched) {
    return {
      label: '待核对 ASIN',
      tone: 'warning',
      headline: '已读取 Listing 内容，但页面 ASIN 仍需核对',
      missingFieldLabel: '缺失',
    };
  }

  if (!input.titleRead || !input.bulletsRead || !input.backendTermsRead) {
    return {
      label: '已读取部分内容',
      tone: 'warning',
      headline: '已读取 Listing 部分内容，生成草案前需补齐缺失字段',
      missingFieldLabel: '缺失',
    };
  }

  return {
    label: '待核对范围',
    tone: 'warning',
    headline: 'Listing 内容已读取，仍需核对店铺和站点范围',
    missingFieldLabel: '缺失',
  };
}

export function isListingReadyForDraft(input: ListingReadyForDraftInput): boolean {
  return Boolean(
    input.hasListing
      && input.pageMatched
      && input.asinMatched
      && input.titleRead
      && input.bulletsRead
      && input.backendTermsRead
      && input.readScopeAvailable
      && input.scopeMatched,
  );
}

export function buildListingWorkflowSummary(input: ListingWorkflowSummaryInput): ListingWorkflowSummary {
  const boundary = '只生成本地草案，不提交 Amazon，不修改 Lingxing Listing。';
  const facts = [
    `关键词 ${input.keywordCount} 个`,
    input.listingReady ? 'Listing 已核对' : input.listingReadAttempted ? 'Listing 已录入但未完整' : 'Listing 未录入',
    input.quantReady ? '当前范围有真实广告数据' : '缺真实广告数据，仅本地预览',
    input.draftCount > 0
      ? `AI 草案 ${input.aiDraftCount} 条 / 本地规则参考 ${input.ruleDraftCount} 条`
      : input.aiStatusLabel,
  ];

  if (input.keywordCount <= 0) {
    return {
      statusLabel: '待输入关键词',
      tone: 'pending',
      headline: '先从关键词机会带入或粘贴关键词。',
      facts,
      blockers: ['缺少关键词机会输入'],
      nextAction: '去关键词机会页带入当前范围关键词，或在本页粘贴关键词。',
      boundary,
    };
  }

  if (!input.listingReady) {
    const blockers = input.listingReadinessIssues?.length
      ? input.listingReadinessIssues
      : ['Listing 未完整读取或 ASIN 未核对通过'];

    return {
      statusLabel: 'Listing 待核对',
      tone: input.listingReadAttempted ? 'warning' : 'pending',
      headline: '关键词已就绪，但 Listing 内容未达到生成草案门槛。',
      facts,
      blockers,
      nextAction: '手工录入并核对 ASIN、标题、五点和后台词；领星读取只作为辅助填充。',
      boundary,
    };
  }

  if (input.draftCount <= 0) {
    return {
      statusLabel: '待生成草案',
      tone: input.quantReady ? 'warning' : 'pending',
      headline: input.quantReady
        ? '关键词和 Listing 已就绪，可以生成本地草案。'
        : '关键词和 Listing 已就绪，但缺真实广告数据；只能生成本地预览草案。',
      facts,
      blockers: [],
      nextAction: input.quantReady ? '生成本地草案并检查 AI/规则来源。' : '先补齐真实广告数据，或生成仅供编辑对齐的本地预览草案。',
      boundary,
    };
  }

  return {
    statusLabel: '可导出草案',
    tone: 'ready',
    headline: `已有 ${input.draftCount} 条本地 Listing 草案，可导出给运营复核。`,
    facts,
    blockers: [],
    nextAction: '导出草案并人工复核，不自动提交 Amazon 或改写 Lingxing Listing。',
    boundary,
  };
}
