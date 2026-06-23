import { describe, expect, it } from 'vitest';
import { listingDraftGenerationMessage, listingManualFieldGroups } from './listing-optimization-page';

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
