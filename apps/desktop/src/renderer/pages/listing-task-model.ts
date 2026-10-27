import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type ListingTaskModel } from './listing-contracts';

export function buildListingTaskModel(input: {
  keywordCount: number;
  listingReady: boolean;
  draftCount: number;
  quantReady: boolean;
  loading: string | null;
}): ListingTaskModel {
  const publishBoundary = '仅本地，不提交 Amazon，不改写 Lingxing。' as const;
  if (input.keywordCount <= 0) {
    return {
      tone: 'attention',
      title: '先确定要覆盖的关键词',
      description: `从当前范围关键词机会带入，或手工录入本地词根。${publishBoundary}`,
      statusLabel: '待关键词',
      primaryIntent: 'edit-keywords',
      primaryLabel: '打开关键词录入',
      primaryBusy: false,
      secondaryIntents: ['keyword-opportunities', 'edit-listing'],
      publishBoundary,
    };
  }
  if (!input.listingReady) {
    return {
      tone: 'blocked',
      title: '补齐并保存当前 Listing',
      description: `生成草案前必须核对 ASIN、范围、标题、五点和后台词。${publishBoundary}`,
      statusLabel: 'Listing 待闭合',
      primaryIntent: 'edit-listing',
      primaryLabel: '补齐当前 Listing',
      primaryBusy: false,
      secondaryIntents: ['read-lingxing', 'edit-keywords'],
      publishBoundary,
    };
  }
  if (input.draftCount > 0) {
    return {
      tone: 'confirmed',
      title: '导出草案给运营人工复核',
      description: `当前有 ${input.draftCount} 条本地草案；导出不会发布或覆盖线上内容。${publishBoundary}`,
      statusLabel: `${input.draftCount} 条本地草案`,
      primaryIntent: 'export-draft',
      primaryLabel: '导出本地草案',
      primaryBusy: input.loading === 'export-drafts',
      secondaryIntents: ['generate-draft', 'edit-listing'],
      publishBoundary,
    };
  }
  return {
    tone: input.quantReady ? 'confirmed' : 'attention',
    title: input.quantReady ? '生成本地 Listing 草案' : '生成仅供本地预览的草案',
    description: input.quantReady
      ? `真实广告指标可用于关键词相关性复核；生成后仍需人工确认。${publishBoundary}`
      : `当前缺真实广告数据，草案不得声明 AI 已验证，也不能进入交付证据。${publishBoundary}`,
    statusLabel: input.quantReady ? '可生成本地草案' : '仅本地预览',
    primaryIntent: 'generate-draft',
    primaryLabel: input.quantReady ? '开始生成本地草案' : '开始生成本地预览草案',
    primaryBusy: input.loading === 'draft',
    secondaryIntents: ['edit-keywords', 'edit-listing'],
    publishBoundary,
  };
}
