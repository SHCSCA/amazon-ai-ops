import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AppRoute, ListingContentVersionView, ListingContentView, ListingDraftView, ListingHandoffPayload, ListingSection, ListingSuggestionView } from '../types';
import { type ListingHeatmapModel, type ListingHeatmapSection, type ListingHeatmapKeyword, type ListingTextSegment } from './listing-contracts';
import { ensureFiveBullets } from './listing-content';

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeHeatmapKeyword(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function includesKeyword(text: string, keyword: string): boolean {
  if (!text || !keyword) return false;
  return text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
}

export function uniqueKeywords(input: string[]): string[] {
  const seen = new Set<string>();
  return input
    .map(normalizeHeatmapKeyword)
    .filter(Boolean)
    .filter((keyword) => {
      const key = keyword.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function draftTextForSection(drafts: ListingDraftView[], section: ListingSection): string {
  return drafts.find((draft) => draft.section === section)?.draftedText || '';
}

export function buildListingHeatmapModel(input: {
  keywords: string[];
  listing?: ListingContentView | null;
  drafts?: ListingDraftView[];
}): ListingHeatmapModel {
  const keywords = uniqueKeywords(input.keywords);
  const listing = input.listing || {};
  const drafts = input.drafts || [];
  const bullets = ensureFiveBullets(listing.bullets);
  const titleDraft = draftTextForSection(drafts, 'title');
  const bulletDraft = draftTextForSection(drafts, 'bullet');
  const backendDraft = draftTextForSection(drafts, 'backend_terms');
  const sections: ListingHeatmapSection[] = [
    {
      key: 'title',
      label: '标题',
      currentText: listing.title || '',
      draftText: titleDraft || listing.title || '',
      currentHits: [],
      draftHits: [],
      charLimit: 200,
    },
    ...bullets.map((bullet, index) => ({
      key: `bullet-${index + 1}`,
      label: `五点 ${index + 1}`,
      currentText: bullet || '',
      draftText: index === 0 ? (bulletDraft || bullet || '') : (bullet || ''),
      currentHits: [] as string[],
      draftHits: [] as string[],
      charLimit: 250,
    })),
    {
      key: 'backend_terms',
      label: '后台词',
      currentText: listing.backendTerms || '',
      draftText: backendDraft || listing.backendTerms || '',
      currentHits: [],
      draftHits: [],
    },
    {
      key: 'details',
      label: '详情/A+',
      currentText: listing.description || listing.aPlus || '',
      draftText: listing.description || listing.aPlus || '',
      currentHits: [],
      draftHits: [],
    },
  ];

  for (const section of sections) {
    section.currentHits = keywords.filter((keyword) => includesKeyword(section.currentText, keyword));
    section.draftHits = keywords.filter((keyword) => includesKeyword(section.draftText, keyword));
  }

  const heatmapKeywords = keywords.map((keyword) => {
    const currentSections = sections.filter((section) => includesKeyword(section.currentText, keyword));
    const draftSections = sections.filter((section) => includesKeyword(section.draftText, keyword));
    const hitSectionLabels = Array.from(new Set([...currentSections, ...draftSections].map((section) => section.label)));
    const draftGain = draftSections.filter((section) => !includesKeyword(section.currentText, keyword));
    const score = Math.min(100, (hitSectionLabels.length * 22) + (draftGain.length * 18));
    const level: ListingHeatmapKeyword['level'] = score >= 60 ? 'ready' : score >= 22 ? 'warning' : 'pending';
    const recommendedSection = !draftSections.some((section) => section.key === 'title')
      ? '标题'
      : !draftSections.some((section) => section.key.startsWith('bullet'))
        ? '五点'
        : !draftSections.some((section) => section.key === 'backend_terms')
          ? '后台词'
          : '保持复核';
    return {
      keyword,
      score,
      level,
      levelLabel: level === 'ready' ? '覆盖密集' : level === 'warning' ? '部分覆盖' : '待融入',
      hitSections: hitSectionLabels,
      recommendedSection,
      evidence: hitSectionLabels.length
        ? `${hitSectionLabels.join('、')} 已命中${draftGain.length ? `，草案新增 ${draftGain.length} 处` : ''}`
        : '当前文本和草案均未覆盖',
    };
  });

  return {
    keywords: heatmapKeywords,
    sections,
    summary: {
      keywordCount: heatmapKeywords.length,
      coveredCount: heatmapKeywords.filter((item) => item.hitSections.length > 0).length,
      draftGainCount: heatmapKeywords.filter((item) => item.evidence.includes('草案新增')).length,
      missingCount: heatmapKeywords.filter((item) => item.hitSections.length === 0).length,
    },
  };
}

export function highlightListingTextSegments(text: string, activeKeyword: string | null, keywords: string[]): ListingTextSegment[] {
  if (!text) return [{ text: '', active: false }];
  const candidates = uniqueKeywords(activeKeyword ? [activeKeyword] : keywords).sort((a, b) => b.length - a.length);
  if (!candidates.length) return [{ text, active: false }];
  const pattern = new RegExp(`(${candidates.map(escapeRegExp).join('|')})`, 'ig');
  const segments: ListingTextSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, index), active: false });
    }
    const matchedText = match[0];
    const matchedKeyword = candidates.find((keyword) => keyword.toLocaleLowerCase() === matchedText.toLocaleLowerCase()) || matchedText;
    segments.push({
      text: matchedText,
      matchedKeyword,
      active: Boolean(activeKeyword && matchedKeyword.toLocaleLowerCase() === activeKeyword.toLocaleLowerCase()),
    });
    lastIndex = index + matchedText.length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), active: false });
  }
  return segments.length ? segments : [{ text, active: false }];
}

export function buildListingHeatmapFocusAnnouncement(model: ListingHeatmapModel, activeKeyword: string | null): string {
  const keyword = normalizeHeatmapKeyword(activeKeyword || '');
  if (!keyword) return '未选择词根。';
  const hitSections = model.sections
    .filter((section) => includesKeyword(section.currentText, keyword) || includesKeyword(section.draftText, keyword))
    .map((section) => section.label);
  if (!hitSections.length) {
    return `已聚焦 ${keyword}：当前文本和本地草案均未命中，建议优先补入标题或五点。`;
  }
  return `已聚焦 ${keyword}：${Array.from(new Set(hitSections)).join('、')} 已命中，右侧命中区域已闪烁高亮。`;
}
