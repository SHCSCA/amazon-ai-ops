import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AppRoute, ListingContentVersionView, ListingContentView, ListingDraftView, ListingHandoffPayload, ListingSection, ListingSuggestionView } from '../types';
import { type ListingHeatmapKeyword, type ListingDraftWorkspaceCopyInput, type ListingDraftWorkspaceCopy } from './listing-contracts';

export function sectionLabel(section: ListingSection): string {
  const labels: Record<ListingSection, string> = {
    title: '标题',
    bullet: '五点',
    a_plus: 'A+',
    image_copy: '图片文案',
    backend_terms: '后台词',
  };
  return labels[section];
}

export function readStatus(ok: boolean, missingLabel: string): string {
  return ok ? '已读取' : missingLabel;
}

export function draftSourceLabel(draft: ListingDraftView): string {
  if (draft.aiFallbackReason) return '本地规则参考';
  return draft.source === 'ai' ? 'AI 草案' : '本地规则参考';
}

export function listingDraftPanelClass(isGenerating: boolean): string {
  return `listing-heatmap-draft-pane${isGenerating ? ' listing-heatmap-draft-generating' : ''}`;
}

export function listingCharacterLimitClass(length: number, limit?: number): string {
  return `listing-heatmap-limit${limit && length > limit ? ' listing-heatmap-limit-over' : ''}`;
}

export function listingHeatmapPulseClass(pulsing: boolean, pulseSerial: number): string {
  if (!pulsing) return '';
  return pulseSerial % 2 === 0 ? ' listing-heatmap-flash-b' : ' listing-heatmap-flash-a';
}

export function listingHeatmapKeywordButtonClass(
  level: ListingHeatmapKeyword['level'],
  active: boolean,
  pulsing: boolean,
  pulseSerial: number,
): string {
  return [
    'listing-heatmap-keyword',
    `listing-heatmap-keyword-${level}`,
    active ? 'listing-heatmap-keyword-active' : '',
    listingHeatmapPulseClass(active && pulsing, pulseSerial).trim(),
  ].filter(Boolean).join(' ');
}

export function listingHeatmapSectionClass(activeHit: boolean, pulsing: boolean, pulseSerial: number): string {
  return [
    'listing-heatmap-section',
    activeHit ? 'listing-heatmap-section-active' : '',
    listingHeatmapPulseClass(activeHit && pulsing, pulseSerial).trim(),
  ].filter(Boolean).join(' ');
}

export function listingHeatmapTokenClass(active: boolean, pulsing: boolean, pulseSerial: number): string {
  return [
    'listing-heatmap-token',
    active ? 'listing-heatmap-token-active' : '',
    listingHeatmapPulseClass(active && pulsing, pulseSerial).trim(),
  ].filter(Boolean).join(' ');
}

export function listingDraftGenerationMessage(quantReady: boolean, drafts: Array<Partial<ListingDraftView>>): string {
  const aiCount = drafts.filter((draft) => draft.source === 'ai' && !draft.aiFallbackReason).length;
  const fallbackDrafts = drafts.filter((draft) => draft.source !== 'ai' || draft.aiFallbackReason);
  const fallbackCount = fallbackDrafts.length;
  const fallbackReasons = Array.from(new Set(fallbackDrafts.map((draft) => draft.aiFallbackReason).filter(Boolean)));
  const parts = [
    aiCount ? `${aiCount} 条 AI 草案` : '',
    fallbackCount ? `${fallbackCount} 条本地规则参考` : '',
  ].filter(Boolean).join('，') || `${drafts.length} 条 Listing 草案`;
  const reason = fallbackReasons.length ? ` 规则参考原因：${fallbackReasons.slice(0, 2).join('；')}。` : '';
  if (!quantReady) {
    return `已生成 ${parts}。当前范围缺真实广告数据，只能作为本地预览，不能声明 AI 已验证或进入交付证据。${reason}`;
  }
  return `已生成 ${parts}。${reason}草案只保存在本地，不会自动提交 Amazon。`;
}

export function listingDraftWorkspaceCopy(input: ListingDraftWorkspaceCopyInput): ListingDraftWorkspaceCopy {
  const sourceLabel = input.draftCount
    ? `${input.aiDraftCount} AI / ${input.ruleDraftCount} 本地规则`
    : input.aiStatusLabel;

  return {
    keywordPlaceholder: '例如 wide toe box\nbarefoot shoes\nlightweight trail runner',
    keywordStatusLabel: input.keywordCount ? `${input.keywordCount} 个关键词待复核` : '待带入关键词',
    dataGateLabel: input.quantReady ? '真实广告数据可用' : '待补齐真实广告数据',
    dataGateDetail: input.quantReady
      ? '关键词可引用当前范围的真实广告指标；生成后仍需人工复核相关性。'
      : '先完成 8 类真实报表采集并导入 DB；缺数据时草案只能用于本地编辑预览。',
    dataGateTone: input.quantReady ? 'ready' : 'blocked',
    draftUseLabel: input.quantReady ? '本地复核草案' : '仅本地预览',
    draftUseDetail: input.quantReady
      ? '可作为运营复核材料导出，但不会自动提交 Amazon 或改写 Lingxing Listing。'
      : '只用于检查结构、词根覆盖和人工改写方向，不能进入交付证据包。',
    sourceLabel,
    sourceDetail: input.draftCount
      ? '来源已在下方明细逐条标记；AI 与本地规则参考都必须人工复核。'
      : input.aiStatusDetail,
    primaryActionLabel: input.loadingDraft ? '生成中...' : input.quantReady ? '生成本地草案' : '生成本地预览草案',
  };
}
