import { type KeywordOpportunityTaskModel } from "./keyword-opportunities-contracts";

export function buildKeywordOpportunityTaskModel(input: {
  quantReady: boolean;
  loading: boolean;
  rowCount: number;
  selectedKeyword?: string | null;
}): KeywordOpportunityTaskModel {
  if (!input.quantReady) {
    return {
      tone: 'blocked',
      title: '先闭合真实广告数据，再识别关键词机会',
      description: '当前不生成或交接关键词机会；截图、HTML 和审计文件不能替代真实广告报表与 DB 指标。',
      statusLabel: '真实数据未就绪',
      primaryIntent: 'import-validation',
      primaryLabel: '去导入校验',
      primaryBusy: false,
      secondaryIntents: ['data-collection'],
    };
  }
  if (input.loading) {
    return {
      tone: 'attention',
      title: '正在刷新当前范围关键词机会',
      description: '只读取当前范围真实导入的 search term、keyword 和 targeting 指标。',
      statusLabel: '刷新中',
      primaryIntent: 'refresh',
      primaryLabel: '重新识别机会',
      primaryBusy: true,
      secondaryIntents: ['filter'],
    };
  }
  const selectedKeyword = input.selectedKeyword?.trim();
  if (selectedKeyword) {
    return {
      tone: 'confirmed',
      title: '复核所选机会并交接到 Listing',
      description: '交接只写入本地 Listing 工作区；仍需核对 ASIN、来源行和 Listing 相关性。',
      statusLabel: `已选 ${selectedKeyword}`,
      primaryIntent: 'handoff-listing',
      primaryLabel: '带入 Listing',
      primaryBusy: false,
      secondaryIntents: ['show-source', 'filter'],
    };
  }
  if (input.rowCount > 0) {
    return {
      tone: 'attention',
      title: '先复核最高优先级关键词机会',
      description: `当前范围已有 ${input.rowCount} 个机会；先核对来源与对象绑定，再决定是否交接。`,
      statusLabel: `${input.rowCount} 个机会`,
      primaryIntent: 'review-first',
      primaryLabel: '复核首个机会',
      primaryBusy: false,
      secondaryIntents: ['filter', 'refresh'],
    };
  }
  return {
    tone: 'neutral',
    title: '刷新当前范围关键词机会',
    description: '真实数据已就绪，但当前尚无可展示机会；刷新后仍为空即表示本范围暂未命中规则。',
    statusLabel: '暂无机会',
    primaryIntent: 'refresh',
    primaryLabel: '重新识别机会',
    primaryBusy: false,
    secondaryIntents: ['filter'],
  };
}
