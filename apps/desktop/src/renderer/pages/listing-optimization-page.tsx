import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBusinessDataPipeline, ScopeText } from '../components/business-data';
import { FormTable, FormTableRow, KpiCard, PageHeader, Panel, StateLightGrid, StatusPill } from '../components/ui';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import {
  buildListingReadinessIssues,
  buildListingSourceStatus,
  buildListingWorkflowSummary,
  isListingReadyForDraft,
} from '../listing-workflow-summary';
import { hasRealReportCoverage } from '../report-coverage';
import type { ListingContentVersionView, ListingContentView, ListingDraftView, ListingHandoffPayload, ListingSection, ListingSuggestionView } from '../types';
import { toUserFacingError } from '../user-facing-error';

interface ListingReadEvidence {
  pageUrl?: string;
  screenshotPath?: string;
  scope?: {
    storeName?: string;
    marketplaceCode?: string;
  };
  partialReady?: boolean;
  fullContentReady?: boolean;
  completeness?: {
    asin?: boolean;
    title?: boolean;
    bullets?: boolean;
    backendTerms?: boolean;
  };
  detailProbe?: {
    asinMatched?: boolean;
    status?: string;
    finalUrl?: string;
  };
}

interface ListingAiStatus {
  label: string;
  detail: string;
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
}

interface ListingDraftWorkspaceCopyInput {
  quantReady: boolean;
  keywordCount: number;
  draftCount: number;
  aiDraftCount: number;
  ruleDraftCount: number;
  aiStatusLabel: string;
  aiStatusDetail: string;
  loadingDraft?: boolean;
}

export interface ListingDraftWorkspaceCopy {
  keywordPlaceholder: string;
  keywordStatusLabel: string;
  dataGateLabel: string;
  dataGateDetail: string;
  dataGateTone: 'ready' | 'blocked';
  draftUseLabel: string;
  draftUseDetail: string;
  sourceLabel: string;
  sourceDetail: string;
  primaryActionLabel: string;
}

interface ListingHeatmapSection {
  key: string;
  label: string;
  currentText: string;
  draftText: string;
  currentHits: string[];
  draftHits: string[];
  charLimit?: number;
}

interface ListingHeatmapKeyword {
  keyword: string;
  score: number;
  level: 'ready' | 'warning' | 'pending';
  levelLabel: string;
  hitSections: string[];
  recommendedSection: string;
  evidence: string;
}

interface ListingHeatmapModel {
  keywords: ListingHeatmapKeyword[];
  sections: ListingHeatmapSection[];
  summary: {
    keywordCount: number;
    coveredCount: number;
    draftGainCount: number;
    missingCount: number;
  };
}

export interface ListingTextSegment {
  text: string;
  matchedKeyword?: string;
  active: boolean;
}

export interface ListingTextDiffSegment {
  text: string;
  kind: 'same' | 'removed' | 'added';
}

export interface ListingTextDiff {
  currentSegments: ListingTextDiffSegment[];
  draftSegments: ListingTextDiffSegment[];
}

interface ListingLocalActionButtonInput {
  active: boolean;
  baseClassName: string;
  label: string;
  busyLabel: string;
  disabled?: boolean;
  groupBusy?: boolean;
}

export interface ListingLocalActionButtonView {
  ariaBusy?: true;
  className: string;
  disabled: boolean;
  label: string;
  showSpinner: boolean;
}

export function listingLocalActionButtonView({
  active,
  baseClassName,
  label,
  busyLabel,
  disabled = false,
  groupBusy = false,
}: ListingLocalActionButtonInput): ListingLocalActionButtonView {
  return {
    ariaBusy: active ? true : undefined,
    className: [baseClassName, active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(disabled || active || groupBusy),
    label: active ? busyLabel : label,
    showSpinner: active,
  };
}

export function listingHistoryRefreshButtonView(input: {
  active: boolean;
  canRefresh: boolean;
  groupBusy?: boolean;
}): ListingLocalActionButtonView {
  return listingLocalActionButtonView({
    active: input.active,
    baseClassName: 'secondary-button',
    busyLabel: '刷新中...',
    disabled: !input.canRefresh,
    groupBusy: input.groupBusy,
    label: '刷新版本历史',
  });
}

function errorMessage(caught: unknown, fallback: string): string {
  return `${fallback}: ${toUserFacingError(caught, fallback)}`;
}

function sectionLabel(section: ListingSection): string {
  const labels: Record<ListingSection, string> = {
    title: '标题',
    bullet: '五点',
    a_plus: 'A+',
    image_copy: '图片文案',
    backend_terms: '后台词',
  };
  return labels[section];
}

function readStatus(ok: boolean, missingLabel: string): string {
  return ok ? '已读取' : missingLabel;
}

function draftSourceLabel(draft: ListingDraftView): string {
  if (draft.aiFallbackReason) return '本地规则参考';
  return draft.source === 'ai' ? 'AI 草案' : '本地规则参考';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeHeatmapKeyword(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function includesKeyword(text: string, keyword: string): boolean {
  if (!text || !keyword) return false;
  return text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
}

function uniqueKeywords(input: string[]): string[] {
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

function tokenizeListingText(value: string): string[] {
  return value.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?|[\u4e00-\u9fff]|[^\s]/g) || [];
}

function normalizeDiffToken(value: string): string {
  return value.toLocaleLowerCase();
}

export function buildListingTextDiffSegments(currentText: string, draftText: string): ListingTextDiff {
  const currentTokens = tokenizeListingText(currentText);
  const draftTokens = tokenizeListingText(draftText);
  const dp = Array.from({ length: currentTokens.length + 1 }, () => Array(draftTokens.length + 1).fill(0));

  for (let i = currentTokens.length - 1; i >= 0; i--) {
    for (let j = draftTokens.length - 1; j >= 0; j--) {
      if (normalizeDiffToken(currentTokens[i]) === normalizeDiffToken(draftTokens[j])) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const currentSegments: ListingTextDiffSegment[] = [];
  const draftSegments: ListingTextDiffSegment[] = [];
  let i = 0;
  let j = 0;

  while (i < currentTokens.length && j < draftTokens.length) {
    if (normalizeDiffToken(currentTokens[i]) === normalizeDiffToken(draftTokens[j])) {
      currentSegments.push({ text: currentTokens[i], kind: 'same' });
      draftSegments.push({ text: draftTokens[j], kind: 'same' });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      currentSegments.push({ text: currentTokens[i], kind: 'removed' });
      i += 1;
    } else {
      draftSegments.push({ text: draftTokens[j], kind: 'added' });
      j += 1;
    }
  }

  while (i < currentTokens.length) {
    currentSegments.push({ text: currentTokens[i], kind: 'removed' });
    i += 1;
  }
  while (j < draftTokens.length) {
    draftSegments.push({ text: draftTokens[j], kind: 'added' });
    j += 1;
  }

  return { currentSegments, draftSegments };
}

export function listingDraftPanelClass(isGenerating: boolean): string {
  return `listing-heatmap-draft-pane${isGenerating ? ' listing-heatmap-draft-generating' : ''}`;
}

export function listingCharacterLimitClass(length: number, limit?: number): string {
  return `listing-heatmap-limit${limit && length > limit ? ' listing-heatmap-limit-over' : ''}`;
}

function listingHeatmapPulseClass(pulsing: boolean, pulseSerial: number): string {
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

function draftTextForSection(drafts: ListingDraftView[], section: ListingSection): string {
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

export interface ListingManualField {
  key: string;
  label: string;
  status: '必填' | '建议填写' | '可选';
}

export interface ListingManualFieldGroup {
  title: string;
  fields: ListingManualField[];
}

export function listingManualFieldGroups(): ListingManualFieldGroup[] {
  return [
    {
      title: '基础信息',
      fields: [
        { key: 'asin', label: 'ASIN', status: '必填' },
        { key: 'versionLabel', label: '版本名称', status: '建议填写' },
        { key: 'changeSummary', label: '修改说明', status: '建议填写' },
      ],
    },
    {
      title: '标题',
      fields: [
        { key: 'title', label: '标题', status: '必填' },
      ],
    },
    {
      title: '五点',
      fields: [1, 2, 3, 4, 5].map((index) => ({ key: `bullet-${index}`, label: `五点 ${index}`, status: '建议填写' })),
    },
    {
      title: '详情与搜索词',
      fields: [
        { key: 'description', label: '详情 / A+ 内容', status: '建议填写' },
        { key: 'backendTerms', label: '后台搜索词', status: '必填' },
        { key: 'imageCopy', label: '图片文案', status: '可选' },
      ],
    },
  ];
}

function buildSuggestedText(keyword: string, section: ListingSection, currentText: string): string {
  if (!currentText.trim()) return keyword;
  if (currentText.toLowerCase().includes(keyword.toLowerCase())) return currentText;
  if (section === 'backend_terms') return `${currentText.trim()} ${keyword}`.trim();
  return `${currentText.trim()} ${keyword}`.trim();
}

function hasMeaningfulListingContent(listing?: ListingContentView | null): listing is ListingContentView {
  if (!listing) return false;
  return Boolean(
    listing.asin?.trim()
    && (
      listing.title?.trim()
      || listing.backendTerms?.trim()
      || (Array.isArray(listing.bullets) && listing.bullets.some((bullet) => bullet.trim()))
    ),
  );
}

function getListingContentBlocker(listing?: ListingContentView | null): string | null {
  if (!listing) return '未返回 Listing 内容';
  if (!listing.asin?.trim()) return '未读取到 ASIN';
  if (!listing.title?.trim() && !listing.backendTerms?.trim() && !(listing.bullets || []).some((bullet) => bullet.trim())) {
    return '未读取到标题、五点或后台词';
  }
  return null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function ensureFiveBullets(input?: string[]): string[] {
  const bullets = Array.isArray(input) ? input.slice(0, 5) : [];
  while (bullets.length < 5) bullets.push('');
  return bullets;
}

function normalizeBaseUrl(value: unknown): string {
  return readString(value).replace(/\/+$/, '');
}

function listingAiStatusFromSettings(settings: Record<string, unknown> | null | undefined): ListingAiStatus {
  if (!settings) {
    return {
      label: 'Listing AI 状态未读取',
      detail: '无法读取设置时仍可生成本地规则参考草案，但不会声称 AI 已参与。',
      tone: 'pending',
    };
  }
  const apiKey = readString(settings.aiApiKey ?? settings.ai_api_key);
  const keyConfigured = readBoolean(settings.aiKeyConfigured ?? settings.ai_key_configured);
  const baseUrl = readString(settings.aiBaseUrl ?? settings.ai_base_url) || 'https://api.deepseek.com';
  const model = readString(settings.aiModel ?? settings.ai_model) || 'deepseek-v4-flash';
  const lastStatus = readString(settings.aiLastTestStatus ?? settings.ai_last_test_status);
  const lastBaseUrl = readString(settings.aiLastTestBaseUrl ?? settings.ai_last_test_base_url);
  const lastModel = readString(settings.aiLastTestModel ?? settings.ai_last_test_model);
  const lastMessage = readString(settings.aiLastTestMessage ?? settings.ai_last_test_message);
  const keyPresent = Boolean(apiKey || keyConfigured);
  if (!keyPresent) {
    return {
      label: 'Listing AI 未配置',
      detail: '未配置 API Key，Listing 草案会生成本地规则参考。',
      tone: 'warning',
    };
  }
  const testMatchesCurrent = normalizeBaseUrl(lastBaseUrl) === normalizeBaseUrl(baseUrl) && lastModel === model;
  if (testMatchesCurrent && lastStatus === 'available') {
    return {
      label: 'Listing AI 可用',
      detail: `${model} 已测试通过；生成草案时会尝试调用 AI，但仍只保存本地草案。`,
      tone: 'ready',
    };
  }
  if (testMatchesCurrent && lastStatus === 'failed') {
    return {
      label: 'Listing AI 测试失败',
      detail: lastMessage || '最近一次 AI 连接测试失败，草案会使用本地规则参考。',
      tone: 'blocked',
    };
  }
  return {
    label: 'Listing AI 待测试',
    detail: `${model} 已配置但当前模型/Base URL 尚未通过连接测试，建议到设置页测试。`,
    tone: 'pending',
  };
}

export function ListingOptimizationPage() {
  const { data, loading: pipelineLoading, scope } = useBusinessDataPipeline();
  const [manualListing, setManualListing] = useState<ListingContentView>(() => ({
    asin: scope.asin || '',
    title: '',
    bullets: ensureFiveBullets(),
    description: '',
    aPlus: '',
    imageCopy: '',
    backendTerms: '',
    source: 'manual',
  }));
  const [listing, setListing] = useState<ListingContentView | null>(null);
  const [listingVersions, setListingVersions] = useState<ListingContentVersionView[]>([]);
  const [readEvidence, setReadEvidence] = useState<ListingReadEvidence | null>(null);
  const [drafts, setDrafts] = useState<ListingDraftView[]>([]);
  const [keywordsText, setKeywordsText] = useState('');
  const [handoffPayload, setHandoffPayload] = useState<ListingHandoffPayload | null>(null);
  const [aiStatus, setAiStatus] = useState<ListingAiStatus>(listingAiStatusFromSettings(null));
  const [activeHeatmapKeyword, setActiveHeatmapKeyword] = useState<string | null>(null);
  const [heatmapPulseKeyword, setHeatmapPulseKeyword] = useState<string | null>(null);
  const [heatmapPulseSerial, setHeatmapPulseSerial] = useState(0);
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const heatmapPulseTimeoutRef = useRef<number | null>(null);
  const currentBatchId = scope.batchId || data?.collection.latestBatch?.id || data?.scope.batchId;

  useEffect(() => {
    let mounted = true;
    async function loadAiStatus() {
      try {
        const settings = await (window as any).electronAPI?.getSettings?.();
        if (mounted) setAiStatus(listingAiStatusFromSettings(settings));
      } catch {
        if (mounted) setAiStatus(listingAiStatusFromSettings(null));
      }
    }
    loadAiStatus();
    const onDataUpdated = () => loadAiStatus();
    window.addEventListener('business-ui:data-updated', onDataUpdated);
    return () => {
      mounted = false;
      window.removeEventListener('business-ui:data-updated', onDataUpdated);
    };
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem('amazon-ai-ops-listing-handoff');
    if (!raw) return;
    try {
      const handoff = JSON.parse(raw) as ListingHandoffPayload;
      const handoffScope = handoff.scope;
      if (handoffScope?.batchId && !currentBatchId && pipelineLoading) return;

      window.localStorage.removeItem('amazon-ai-ops-listing-handoff');
      const baseScopeMatches = !handoffScope || (
        handoffScope.dateFrom === scope.dateFrom
        && handoffScope.dateTo === scope.dateTo
        && handoffScope.storeName === scope.storeName
        && handoffScope.marketplaceCode === scope.marketplaceCode
      );
      const batchMatches = !handoffScope?.batchId || Boolean(currentBatchId && handoffScope.batchId === currentBatchId);
      const scopeMatches = !handoffScope || (
        baseScopeMatches && batchMatches
      );
      if (!scopeMatches) {
        setHandoffPayload(null);
        const reason = handoffScope?.batchId && currentBatchId && handoffScope.batchId !== currentBatchId
          ? `数据批次不一致（当前 ${currentBatchId}，带入 ${handoffScope.batchId}）`
          : handoffScope?.batchId && !currentBatchId
            ? '当前运营范围没有可用数据批次'
            : '范围与当前运营范围不一致';
        setMessage(`已忽略过期关键词机会带入：${reason}。请回到关键词机会页重新带入。`);
        return;
      }
      const handoffAsin = handoff.asin?.trim().toUpperCase();
      const currentAsin = scope.asin?.trim().toUpperCase();
      if (handoffAsin && currentAsin && handoffAsin !== currentAsin) {
        setHandoffPayload(null);
        setMessage(`已忽略关键词机会带入：ASIN 不匹配（当前 ${scope.asin}，带入 ${handoff.asin}）。`);
        return;
      }
      if (handoff.source === 'keyword-opportunities' && Array.isArray(handoff.keywords)) {
        setHandoffPayload(handoff);
        setKeywordsText(handoff.keywords.join('\n'));
        setMessage(`已接收关键词机会带入：${handoff.keywords.length} 个关键词。草案只保存在本地，不会自动提交 Amazon。`);
      }
    } catch {
      setHandoffPayload(null);
      window.localStorage.removeItem('amazon-ai-ops-listing-handoff');
    }
  }, [currentBatchId, pipelineLoading, scope.asin, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName]);

  const keywords = useMemo(
    () => keywordsText.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean),
    [keywordsText],
  );
  const heatmapModel = useMemo(
    () => buildListingHeatmapModel({ keywords, listing: listing || manualListing, drafts }),
    [drafts, keywords, listing, manualListing],
  );
  const heatmapKeywordNames = heatmapModel.keywords.map((item) => item.keyword);
  const selectedHeatmapKeyword = activeHeatmapKeyword && heatmapKeywordNames.includes(activeHeatmapKeyword)
    ? activeHeatmapKeyword
    : heatmapKeywordNames[0] || null;
  const pulsingHeatmapKeyword = heatmapPulseKeyword && heatmapPulseKeyword === selectedHeatmapKeyword
    ? heatmapPulseKeyword
    : null;
  const heatmapFocusAnnouncement = selectedHeatmapKeyword
    ? buildListingHeatmapFocusAnnouncement(heatmapModel, selectedHeatmapKeyword)
    : '';
  const expectedAsin = (handoffPayload?.asin || scope.asin || '').trim().toUpperCase();
  const listingAsin = (listing?.asin || '').trim().toUpperCase();
  const readScopeStore = readEvidence?.scope?.storeName || '';
  const readScopeMarketplace = readEvidence?.scope?.marketplaceCode || '';
  const currentScopeText = `${scope.storeName || '-'} / ${scope.marketplaceCode || '-'}`;
  const readScopeText = readScopeStore || readScopeMarketplace ? `${readScopeStore || '-'} / ${readScopeMarketplace || '-'}` : '-';
  const readScopeAvailable = Boolean(readScopeStore || readScopeMarketplace);
  const listingScopeMatched = Boolean(
    readScopeStore
      && readScopeMarketplace
      && readScopeStore === scope.storeName
      && readScopeMarketplace === scope.marketplaceCode,
  );
  const pageMatched = Boolean(listingAsin && (!expectedAsin || listingAsin === expectedAsin));
  const titleRead = Boolean(readEvidence?.completeness?.title ?? listing?.title);
  const bulletsRead = Boolean(readEvidence?.completeness?.bullets ?? listing?.bullets?.length);
  const backendTermsRead = Boolean(readEvidence?.completeness?.backendTerms ?? listing?.backendTerms);
  const probeAsinMatched = readEvidence?.detailProbe?.asinMatched ?? true;
  const asinMatched = Boolean(pageMatched && probeAsinMatched);
  const detailProbeStatus = readEvidence?.detailProbe?.status;
  const fullContentReady = Boolean(readEvidence?.fullContentReady ?? (titleRead && bulletsRead && backendTermsRead));
  const listingProbeAttempted = Boolean(
    listing
    || readEvidence?.partialReady
    || readEvidence?.pageUrl
    || readEvidence?.screenshotPath
    || detailProbeStatus,
  );
  const quantReady = Boolean(hasRealReportCoverage(data?.collection) && data?.quant.hasImportedMetrics);
  const aiDraftCount = drafts.filter((draft) => draft.source === 'ai' && !draft.aiFallbackReason).length;
  const ruleDraftCount = drafts.length - aiDraftCount;
  const listingReady = isListingReadyForDraft({
    hasListing: Boolean(listing),
    pageMatched,
    asinMatched,
    titleRead,
    bulletsRead,
    backendTermsRead,
    scopeMatched: listingScopeMatched,
    readScopeAvailable,
  });
  const listingReadinessIssues = buildListingReadinessIssues({
    listingReadAttempted: listingProbeAttempted,
    hasListing: Boolean(listing),
    expectedAsin,
    listingAsin,
    pageMatched,
    asinMatched,
    titleRead,
    bulletsRead,
    backendTermsRead,
    scopeMatched: listingScopeMatched,
    readScopeAvailable,
  });
  const listingSourceStatus = buildListingSourceStatus({
    listingReadAttempted: listingProbeAttempted,
    hasListing: Boolean(listing),
    listingReady,
    pageMatched,
    asinMatched,
    titleRead,
    bulletsRead,
    backendTermsRead,
  });
  const draftReady = drafts.length > 0;
  const workflowSummary = buildListingWorkflowSummary({
    keywordCount: keywords.length,
    listingReadAttempted: listingProbeAttempted,
    listingReady,
    listingReadinessIssues,
    draftCount: drafts.length,
    aiDraftCount,
    ruleDraftCount,
    aiStatusLabel: aiStatus.label,
    quantReady,
  });
  const draftWorkspaceCopy = listingDraftWorkspaceCopy({
    quantReady,
    keywordCount: keywords.length,
    draftCount: drafts.length,
    aiDraftCount,
    ruleDraftCount,
    aiStatusLabel: aiStatus.label,
    aiStatusDetail: aiStatus.detail,
    loadingDraft: loading === 'draft',
  });
  const workflowBlocker = !keywords.length
    ? '先从关键词机会带入或粘贴关键词'
    : !listingReady
      ? '先手工录入并保存当前 Listing'
      : !draftReady
        ? '下一步生成本地草案'
        : '可导出草案给运营复核';
  const handoffScope = handoffPayload?.scope;
  const handoffScopeText = handoffScope
    ? `${handoffScope.dateFrom || '-'} 至 ${handoffScope.dateTo || '-'} / ${handoffScope.storeName || '-'} / ${handoffScope.marketplaceCode || '-'} / ${handoffScope.batchId || '-'}`
    : '未从关键词机会带入';
  const handoffContext = handoffPayload?.context;

  useEffect(() => {
    setManualListing((current) => {
      if (current.asin?.trim()) return current;
      return { ...current, asin: expectedAsin || scope.asin || '' };
    });
  }, [expectedAsin, scope.asin]);

  useEffect(() => {
    if (!activeHeatmapKeyword || heatmapKeywordNames.includes(activeHeatmapKeyword)) return;
    setActiveHeatmapKeyword(heatmapKeywordNames[0] || null);
  }, [activeHeatmapKeyword, heatmapKeywordNames]);

  useEffect(() => {
    if (!heatmapPulseKeyword || heatmapKeywordNames.includes(heatmapPulseKeyword)) return;
    setHeatmapPulseKeyword(null);
  }, [heatmapPulseKeyword, heatmapKeywordNames]);

  useEffect(() => () => {
    if (heatmapPulseTimeoutRef.current) {
      window.clearTimeout(heatmapPulseTimeoutRef.current);
    }
  }, []);

  function focusHeatmapKeyword(keyword: string) {
    setActiveHeatmapKeyword(keyword);
    setHeatmapPulseKeyword(keyword);
    setHeatmapPulseSerial((serial) => serial + 1);
    if (heatmapPulseTimeoutRef.current) {
      window.clearTimeout(heatmapPulseTimeoutRef.current);
    }
    heatmapPulseTimeoutRef.current = window.setTimeout(() => {
      setHeatmapPulseKeyword((current) => (current === keyword ? null : current));
      heatmapPulseTimeoutRef.current = null;
    }, 360);
  }

  async function loadListingVersions(asin: string): Promise<ListingContentVersionView[]> {
    const api = (window as any).electronAPI;
    if (!api?.listListingContentVersions || !asin.trim()) return [];
    const versions = await api.listListingContentVersions({
      asin: asin.trim().toUpperCase(),
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      limit: 10,
    });
    const normalizedVersions = Array.isArray(versions) ? versions : [];
    setListingVersions(normalizedVersions);
    return normalizedVersions;
  }

  async function refreshListingVersions() {
    const asin = manualListing.asin?.trim();
    if (!asin) {
      setMessage('请先填写 ASIN，再刷新本地版本历史。');
      return;
    }
    setLoading('history');
    setMessage('正在刷新 Listing 版本历史...');
    try {
      const versions = await loadListingVersions(asin);
      setMessage(`已刷新 Listing 版本历史：${versions.length} 个本地版本。`);
    } catch (caught) {
      setMessage(errorMessage(caught, '刷新 Listing 版本历史失败'));
    } finally {
      setLoading(null);
    }
  }

  function updateManualListing(patch: Partial<ListingContentView>) {
    setManualListing((current) => ({ ...current, ...patch }));
  }

  function updateManualBullet(index: number, value: string) {
    setManualListing((current) => {
      const bullets = ensureFiveBullets(current.bullets);
      bullets[index] = value;
      return { ...current, bullets };
    });
  }

  function renderManualListingField(field: ListingManualField) {
    const bullets = ensureFiveBullets(manualListing.bullets);
    const bulletMatch = /^bullet-(\d+)$/.exec(field.key);
    const control = (() => {
      if (bulletMatch) {
        const bulletIndex = Number(bulletMatch[1]) - 1;
        return (
          <textarea
            aria-label={field.label}
            value={bullets[bulletIndex] || ''}
            onChange={(event) => updateManualBullet(bulletIndex, event.target.value)}
            placeholder={`Bullet ${bulletIndex + 1}`}
          />
        );
      }
      if (field.key === 'asin') {
        return <input aria-label={field.label} value={manualListing.asin || ''} onChange={(event) => updateManualListing({ asin: event.target.value })} placeholder="例如 B0..." />;
      }
      if (field.key === 'versionLabel') {
        return <input aria-label={field.label} value={manualListing.versionLabel || ''} onChange={(event) => updateManualListing({ versionLabel: event.target.value })} placeholder="例如 2026-06-18 标题五点调整" />;
      }
      if (field.key === 'changeSummary') {
        return <input aria-label={field.label} value={manualListing.changeSummary || ''} onChange={(event) => updateManualListing({ changeSummary: event.target.value })} placeholder="例如 补充核心词和场景词" />;
      }
      if (field.key === 'title') {
        return <textarea aria-label={field.label} value={manualListing.title || ''} onChange={(event) => updateManualListing({ title: event.target.value })} placeholder="当前 Listing 标题" />;
      }
      if (field.key === 'description') {
        return (
          <textarea
            aria-label={field.label}
            value={manualListing.description || manualListing.aPlus || ''}
            onChange={(event) => updateManualListing({ description: event.target.value, aPlus: event.target.value })}
            placeholder="详情描述或 A+ 文案"
          />
        );
      }
      if (field.key === 'backendTerms') {
        return <textarea aria-label={field.label} value={manualListing.backendTerms || ''} onChange={(event) => updateManualListing({ backendTerms: event.target.value })} placeholder="Search Terms / 后台关键词" />;
      }
      if (field.key === 'imageCopy') {
        return <textarea aria-label={field.label} value={manualListing.imageCopy || ''} onChange={(event) => updateManualListing({ imageCopy: event.target.value })} placeholder="可选：主图/副图文案备注" />;
      }
      return null;
    })();

    return (
      <FormTableRow
        hint={(
          <span className={`listing-editor-status listing-editor-status-${field.status === '必填' ? 'required' : field.status === '可选' ? 'optional' : 'recommended'}`}>
          {field.status}
          </span>
        )}
        key={field.key}
        label={field.label}
        required={field.status === '必填'}
      >
        {control}
      </FormTableRow>
    );
  }

  function renderHeatmapSegments(text: string, activeKeyword: string | null, pulsing: boolean) {
    const segments = highlightListingTextSegments(text || '-', activeKeyword, heatmapKeywordNames);
    return segments.map((segment, index) => {
      if (!segment.matchedKeyword) {
        return <React.Fragment key={`${index}-text`}>{segment.text}</React.Fragment>;
      }
      return (
        <mark
          className={listingHeatmapTokenClass(segment.active, pulsing && segment.active, heatmapPulseSerial)}
          key={`${index}-${segment.matchedKeyword}`}
        >
          {segment.text}
        </mark>
      );
    });
  }

  function renderListingDiffPreview(diff: ListingTextDiff) {
    const removed = diff.currentSegments.filter((segment) => segment.kind === 'removed');
    const added = diff.draftSegments.filter((segment) => segment.kind === 'added');
    if (!removed.length && !added.length) {
      return (
        <div className="listing-heatmap-diff-strip listing-heatmap-diff-stable" aria-label="新旧草案差量">
          <span>差量</span>
          <strong>草案与当前文本一致</strong>
        </div>
      );
    }

    const renderTokens = (segments: ListingTextDiffSegment[], kind: 'removed' | 'added') => (
      segments.length ? segments.map((segment, index) => (
        <b className={`listing-heatmap-diff-token listing-heatmap-diff-${kind}`} key={`${kind}-${index}-${segment.text}`}>
          {segment.text}
        </b>
      )) : <small>无</small>
    );

    return (
      <div className="listing-heatmap-diff-strip" aria-label="新旧草案差量">
        <span>删除</span>
        <div>{renderTokens(removed, 'removed')}</div>
        <span>新增</span>
        <div>{renderTokens(added, 'added')}</div>
      </div>
    );
  }

  async function saveManualListing() {
    setLoading('save-manual');
    setMessage(null);
    try {
      const api = (window as any).electronAPI;
      if (!api?.saveManualListingContent) {
        throw new Error('手工 Listing 保存接口未暴露');
      }
      const saved = await api.saveManualListingContent({
        ...manualListing,
        source: 'manual',
        bullets: ensureFiveBullets(manualListing.bullets).map((item) => item.trim()).filter(Boolean),
      }, {
        storeName: scope.storeName,
        marketplaceCode: scope.marketplaceCode,
      });
      const nextListing: ListingContentView = {
        ...saved,
        bullets: ensureFiveBullets(saved?.bullets),
        source: 'manual',
      };
      setListing(nextListing);
      setManualListing(nextListing);
      setReadEvidence({
        scope: {
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
        },
        partialReady: true,
        fullContentReady: Boolean(nextListing.title && nextListing.bullets?.some((bullet) => bullet.trim()) && nextListing.backendTerms),
        completeness: {
          asin: Boolean(nextListing.asin),
          title: Boolean(nextListing.title),
          bullets: Boolean(nextListing.bullets?.some((bullet) => bullet.trim())),
          backendTerms: Boolean(nextListing.backendTerms),
        },
      });
      setDrafts([]);
      await loadListingVersions(nextListing.asin || '');
      setMessage(`已保存为 Listing 版本${saved?.versionId ? ` #${saved.versionId}` : ''}。草案只保存在本地，不会自动提交 Amazon。`);
    } catch (caught) {
      setMessage(errorMessage(caught, '保存手工 Listing 失败'));
    } finally {
      setLoading(null);
    }
  }

  async function readFromLingxing() {
    setLoading('read');
    setMessage(null);
    try {
      const api = (window as any).electronAPI;
      if (!api?.extractListingFromLingxing && !api?.probeLingxingListingDetailAndExtract) {
        throw new Error('Listing 读取接口未暴露');
      }
      const readOptions = {
        expectedAsin: expectedAsin || undefined,
        scope: {
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
        },
      };
      const result = api?.probeLingxingListingDetailAndExtract
        ? await api.probeLingxingListingDetailAndExtract(readOptions)
        : await api.extractListingFromLingxing(readOptions);
      if (!result || (result.ready === false && result.partialReady !== true)) {
        throw new Error(result?.reason || '领星页面未返回可用 Listing 读取结果');
      }
      const content = result?.listing || result?.content || result;
      const nextListing: ListingContentView = {
        asin: content?.asin,
        title: content?.title,
        bullets: Array.isArray(content?.bullets) ? content.bullets : [],
        description: content?.description,
        aPlus: content?.aPlus,
        imageCopy: content?.imageCopy,
        backendTerms: content?.backendTerms,
        source: content?.source || 'lingxing_readonly',
      };
      const evidence = result?.evidence || {};
      const blocker = getListingContentBlocker(nextListing);
      if (blocker) {
        const hasProbeEvidence = Boolean(
          result?.partialReady
          || evidence?.partialReady
          || evidence?.pageUrl
          || evidence?.screenshotPath
          || evidence?.detailProbe,
        );
        if (hasProbeEvidence) {
          setListing(null);
          setReadEvidence({
            pageUrl: evidence?.pageUrl || result?.pageUrl || result?.url,
            screenshotPath: evidence?.screenshotPath,
            scope: evidence?.scope || readOptions.scope,
            partialReady: Boolean(result?.partialReady ?? evidence?.partialReady ?? true),
            fullContentReady: false,
            completeness: evidence?.completeness,
            detailProbe: evidence?.detailProbe,
          });
          setDrafts([]);
          setMessage(result?.reason || `页面已探测但内容未完整读取：${blocker}。请切换到正确的领星 Listing 详情页或等待页面加载完成后重试。`);
          return;
        }
        throw new Error(blocker);
      }
      const hydratedListing = {
        ...nextListing,
        pageUrl: evidence?.pageUrl || result?.pageUrl || result?.url,
        screenshotPath: evidence?.screenshotPath,
        updatedAt: content?.updatedAt,
      };
      setListing(hydratedListing);
      setManualListing({
        ...hydratedListing,
        source: 'manual',
        bullets: ensureFiveBullets(hydratedListing.bullets),
        versionLabel: hydratedListing.versionLabel || '领星辅助读取后手工确认',
        changeSummary: hydratedListing.changeSummary || '从领星辅助读取并等待人工核对保存',
      });
      setReadEvidence({
        pageUrl: evidence?.pageUrl || result?.pageUrl || result?.url,
        screenshotPath: evidence?.screenshotPath,
        scope: evidence?.scope || readOptions.scope,
        partialReady: Boolean(result?.partialReady ?? evidence?.partialReady),
        fullContentReady: Boolean(result?.fullContentReady ?? evidence?.fullContentReady),
        completeness: evidence?.completeness,
        detailProbe: evidence?.detailProbe,
      });
      setMessage(
        result?.fullContentReady
          ? '已从当前领星页面读取完整 Listing 内容；请核对 ASIN、标题、五点和后台词。'
          : '详情页已读取但 Listing 内容不完整：请核对标题、五点和后台词，必要时切换到正确详情页后重新读取。',
      );
    } catch (caught) {
      setListing(null);
      setReadEvidence(null);
      setDrafts([]);
      setMessage(errorMessage(caught, '读取 Lingxing Listing 失败/阻断'));
    } finally {
      setLoading(null);
    }
  }

  async function generateDrafts() {
    if (!hasMeaningfulListingContent(listing)) {
      setMessage(`请先读取有效 Listing 内容：${getListingContentBlocker(listing) || '内容不足'}。`);
      return;
    }
    if (expectedAsin && listingAsin !== expectedAsin) {
      setMessage(`Listing 页面 ASIN 与目标 ASIN 不匹配：页面 ${listing.asin || '-'}，目标 ${expectedAsin}。请切换到正确 Listing 后重新读取。`);
      return;
    }
    if (!listingReady) {
      setMessage('详情页已读取但 Listing 内容不完整：生成草案前必须读取并核对 ASIN、标题、五点和后台词。');
      return;
    }
    if (!keywords.length) {
      setMessage('请先从关键词机会带入或粘贴至少 1 个关键词。');
      return;
    }
    setLoading('draft');
    setMessage(null);
    try {
      const sections: ListingSection[] = ['title', 'bullet', 'backend_terms'];
      const suggestions: ListingSuggestionView[] = keywords.map((keyword, index) => {
        const section = sections[index % sections.length];
        const currentText = section === 'title'
          ? listing.title || ''
          : section === 'backend_terms'
            ? listing.backendTerms || ''
            : listing.bullets?.[0] || '';
        return {
        asin: listing.asin || scope.asin || '',
        keyword,
        section,
        currentText,
        suggestedText: buildSuggestedText(keyword, section, currentText),
        evidence: quantReady ? '当前范围真实广告指标 + 关键词机会池' : '本地规则参考：当前范围未满足真实广告指标门槛',
        riskWarnings: quantReady ? ['需人工复核相关性'] : ['缺当前真实广告数据门槛，不能声明 AI 已验证'],
        status: 'pending',
      };
      });
      const result = await (window as any).electronAPI?.generateListingDrafts?.(suggestions);
      setDrafts(Array.isArray(result) ? result : []);
      setMessage(listingDraftGenerationMessage(quantReady, Array.isArray(result) ? result : []));
    } catch (caught) {
      setMessage(errorMessage(caught, '生成 Listing 草案失败'));
    } finally {
      setLoading(null);
    }
  }

  async function exportDrafts() {
    if (!drafts.length) {
      setMessage('暂无可导出的草案。');
      return;
    }
    setLoading('export-drafts');
    setMessage(null);
    try {
      const exportPath = await (window as any).electronAPI?.exportListingDrafts?.(drafts, 'xlsx');
      setMessage(`已导出 Listing 草案：${exportPath}`);
    } catch (caught) {
      setMessage(errorMessage(caught, '导出 Listing 草案失败'));
    } finally {
      setLoading(null);
    }
  }

  const listingActionBusy = Boolean(loading);
  const historyRefreshButton = listingHistoryRefreshButtonView({
    active: loading === 'history',
    canRefresh: Boolean(manualListing.asin?.trim()),
    groupBusy: listingActionBusy,
  });
  const saveManualButton = listingLocalActionButtonView({
    active: loading === 'save-manual',
    baseClassName: 'primary-button',
    busyLabel: '保存中...',
    groupBusy: listingActionBusy,
    label: '保存为新版本',
  });
  const readLingxingButton = listingLocalActionButtonView({
    active: loading === 'read',
    baseClassName: 'secondary-button',
    busyLabel: '读取中...',
    groupBusy: listingActionBusy,
    label: '尝试从当前领星页面填入表单',
  });
  const generateDraftButton = listingLocalActionButtonView({
    active: loading === 'draft',
    baseClassName: 'primary-button',
    busyLabel: '生成中...',
    disabled: !listingReady,
    groupBusy: listingActionBusy,
    label: draftWorkspaceCopy.primaryActionLabel,
  });
  const exportDraftButton = listingLocalActionButtonView({
    active: loading === 'export-drafts',
    baseClassName: 'secondary-button',
    busyLabel: '导出中...',
    disabled: !drafts.length,
    groupBusy: listingActionBusy,
    label: '导出草案',
  });

  return (
    <div>
      <PageHeader
        eyebrow="增长"
        title={PAGE_HEADER_TITLES.listingOptimization}
        description="录入或辅助读取当前 Listing，结合关键词机会检查覆盖，生成只供本地复核和导出的草案；不会提交 Amazon，也不会改写 Lingxing。"
        primaryTask="生成本地 Listing 草案"
        nextAction={listing ? '生成草案并导出' : '先录入并保存 Listing'}
        primaryAction={{
          label: draftWorkspaceCopy.primaryActionLabel,
          busy: loading === 'draft',
          busyLabel: '生成中...',
          disabled: !listingReady || loading === 'draft',
          onClick: generateDrafts,
        }}
      />

      <div className="business-stack">
        <div className="kpi-row listing-prototype-status-grid" aria-label="Listing 草案状态">
          <KpiCard
            label="目标 ASIN"
            value={expectedAsin || '-'}
            detail={listing ? (pageMatched ? '页面已匹配' : '待核对') : '尚未保存 Listing'}
            tone={listing && pageMatched ? 'ready' : 'warning'}
          />
          <KpiCard
            label="关键词输入"
            value={keywords.length}
            detail={handoffPayload ? '来自关键词机会' : '手工输入'}
            tone={keywords.length ? 'ready' : 'pending'}
          />
          <KpiCard
            label="Listing 字段"
            value={listingReady ? '可生成' : '待补齐'}
            detail={listingReadinessIssues.slice(0, 1).join('、') || '字段闭合'}
            tone={listingReady ? 'ready' : 'blocked'}
          />
          <KpiCard
            label="草案边界"
            value={draftReady ? `${drafts.length} 条` : '本地保存'}
            detail="不提交 Amazon"
            tone={draftReady ? 'ready' : 'pending'}
          />
        </div>
        <StateLightGrid
          ariaLabel="Listing 草案红绿灯"
          items={[
            {
              label: '目标 ASIN',
              value: expectedAsin || '-',
              detail: listing ? (pageMatched ? '页面 ASIN 已匹配' : '页面 ASIN 待核对') : '尚未保存 Listing',
              tone: listing && pageMatched ? 'ready' : 'warning',
            },
            {
              label: '关键词输入',
              value: keywords.length,
              detail: handoffPayload ? '来自关键词机会' : '手工输入或待带入',
              tone: keywords.length ? 'ready' : 'pending',
            },
            {
              label: 'Listing 字段',
              value: listingReady ? '可生成' : '待补齐',
              detail: listingReadinessIssues.slice(0, 2).join('、') || '标题、五点、后台词已闭合',
              tone: listingReady ? 'ready' : 'blocked',
            },
            {
              label: '草案边界',
              value: draftReady ? `${drafts.length} 条` : '本地保存',
              detail: '不提交 Amazon，不覆盖 Lingxing',
              tone: draftReady ? 'ready' : 'pending',
            },
          ]}
        />

        <Panel title="本地草案工作流" tone={draftReady ? 'success' : keywords.length && listingReady ? 'warning' : 'default'}>
          <div className="evidence-check-panel">
            <div className="business-split">
              <div>
                <h3>当前草案任务</h3>
                <p className="muted-line">{workflowSummary.headline}</p>
              </div>
              <StatusPill tone={workflowSummary.tone}>{workflowSummary.statusLabel}</StatusPill>
            </div>
            <div className="context-summary-grid">
              <div>
                <span>输入与读取</span>
                <strong>{workflowSummary.facts.slice(0, 2).join(' / ')}</strong>
                <p>{workflowSummary.blockers.length ? workflowSummary.blockers.join('；') : '当前输入满足下一步条件。'}</p>
              </div>
              <div>
                <span>AI 与数据</span>
                <strong>{workflowSummary.facts.slice(2).join(' / ')}</strong>
                <p>{draftWorkspaceCopy.dataGateDetail}</p>
              </div>
              <div>
                <span>下一步</span>
                <strong>{workflowSummary.nextAction}</strong>
                <p>{workflowSummary.boundary}</p>
              </div>
            </div>
          </div>
          <div className="workflow-strip workflow-strip-readonly">
            <div className="workflow-step workflow-step-static">
              <span>1 关键词机会</span>
              <strong>{keywords.length ? `${keywords.length} 个关键词已进入草案输入` : '未带入关键词'}</strong>
              <p>{handoffPayload ? '来自关键词机会页，已绑定当前业务范围。' : '可从关键词机会页带入，也可手工粘贴后复核。'}</p>
              <StatusPill tone={keywords.length ? 'ready' : 'pending'}>{keywords.length ? '已就绪' : '待输入'}</StatusPill>
            </div>
            <div className="workflow-step workflow-step-static">
              <span>2 Listing 内容录入/读取</span>
              <strong>{listingSourceStatus.headline}</strong>
              <p>{listing ? `当前 ASIN：${listing.asin || '-'}，目标 ASIN：${expectedAsin || '-'}` : listingProbeAttempted ? '已保留页面 URL、截图和探测状态；可继续手工补齐字段后保存版本。' : '先手工录入当前 Listing；领星读取只作为辅助填充。'}</p>
              <StatusPill tone={listingSourceStatus.tone}>{listingSourceStatus.label}</StatusPill>
            </div>
            <div className="workflow-step workflow-step-static">
              <span>3 AI / 本地规则草案</span>
              <strong>{draftReady ? draftWorkspaceCopy.sourceLabel : aiStatus.label}</strong>
              <p>{draftWorkspaceCopy.sourceDetail}</p>
              <StatusPill tone={draftReady ? 'ready' : listingReady && keywords.length ? aiStatus.tone : 'blocked'}>{draftReady ? '已生成' : aiStatus.label}</StatusPill>
            </div>
            <div className="workflow-step workflow-step-static">
              <span>4 导出与发布边界</span>
              <strong>{draftReady ? `${drafts.length} 条草案可导出` : '暂无可导出内容'}</strong>
              <p>只导出本地文件，不自动提交 Amazon，不修改 Lingxing Listing。</p>
              <StatusPill tone={draftReady ? 'ready' : 'pending'}>{draftReady ? '可导出' : '待草案'}</StatusPill>
            </div>
          </div>
          <p className="muted-line">当前下一步：{workflowBlocker}。本页负责 Listing 草案闭环，不承载广告审批或真实广告执行。</p>
        </Panel>

        <Panel title="手工录入当前 Listing" tone={listing ? (listingReady ? 'success' : 'warning') : 'warning'}>
          <div className="business-split">
            <div>
              <div className="business-scope-line"><ScopeText scope={data?.scope || scope} /></div>
              <p className="muted-line">请录入当前线上 Listing 的标题、五点、详情/A+ 和后台搜索词。每次保存都会写入版本历史，后续可对比修改。</p>
              <p className="blocked-line">本功能只保存本地版本，不会自动提交 Amazon，也不会改写 Lingxing。</p>
            </div>
            <StatusPill tone="ready">主流程</StatusPill>
          </div>
          <div className="listing-editor-table">
            {listingManualFieldGroups().map((group) => (
              <section className="listing-editor-section" key={group.title}>
                <strong>{group.title}</strong>
                <FormTable>
                  {group.fields.map(renderManualListingField)}
                </FormTable>
              </section>
            ))}
          </div>
          <div className="action-row">
            <button aria-busy={saveManualButton.ariaBusy} className={saveManualButton.className} disabled={saveManualButton.disabled} onClick={saveManualListing} type="button">
              {saveManualButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
              <span>{saveManualButton.label}</span>
            </button>
            <button
              aria-busy={historyRefreshButton.ariaBusy}
              className={historyRefreshButton.className}
              disabled={historyRefreshButton.disabled}
              onClick={() => {
                void refreshListingVersions();
              }}
              type="button"
            >
              {historyRefreshButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
              <span>{historyRefreshButton.label}</span>
            </button>
          </div>
        </Panel>

        <Panel title="从领星辅助读取" tone={listing ? (listingReady ? 'success' : 'warning') : listingProbeAttempted ? 'warning' : 'default'}>
          <div className="business-split">
            <div>
              <div className="business-scope-line"><ScopeText scope={data?.scope || scope} /></div>
              <p className="muted-line">领星字段读取不完整时，不再阻断流程。读取成功后只填入上方手工表单，仍需人工保存为版本。</p>
              <p className="blocked-line">辅助读取不会自动提交 Amazon，也不会直接覆盖已保存版本。</p>
            </div>
            <StatusPill tone={listingSourceStatus.tone}>{listingSourceStatus.label}</StatusPill>
          </div>
          <div className="action-row">
            <button aria-busy={readLingxingButton.ariaBusy} className={readLingxingButton.className} disabled={readLingxingButton.disabled} onClick={readFromLingxing} type="button">
              {readLingxingButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
              <span>{readLingxingButton.label}</span>
            </button>
          </div>
          <div className="evidence-grid">
            <div><span>ASIN matched/status</span><strong>{listing ? `${asinMatched ? 'ASIN 匹配' : 'ASIN 待核对'}${detailProbeStatus ? ` / ${detailProbeStatus}` : ''}` : listingProbeAttempted ? `ASIN 缺失${detailProbeStatus ? ` / ${detailProbeStatus}` : ''}` : '未读取'}</strong></div>
            <div><span>Title read</span><strong>{readStatus(titleRead, listingSourceStatus.missingFieldLabel)}</strong></div>
            <div><span>Bullets read</span><strong>{readStatus(bulletsRead, listingSourceStatus.missingFieldLabel)}</strong></div>
            <div><span>Backend terms read</span><strong>{readStatus(backendTermsRead, listingSourceStatus.missingFieldLabel)}</strong></div>
            <div><span>范围核对</span><strong>{readEvidence ? (listingScopeMatched ? '店铺/站点匹配' : '店铺/站点待核对') : '未读取'}</strong></div>
            <div><span>当前店铺/站点</span><strong>{currentScopeText}</strong></div>
            <div><span>读取店铺/站点</span><strong>{readScopeText}</strong></div>
            <div><span>Page URL</span><strong>{readEvidence?.pageUrl || listing?.pageUrl || '-'}</strong></div>
            <div><span>Screenshot path</span><strong>{readEvidence?.screenshotPath || listing?.screenshotPath || '-'}</strong></div>
          </div>
          <div className="inline-alert">
            <strong>Listing 读取缺口</strong>
            <p>
              {listingReadinessIssues.length
                ? `生成草案前需补齐：${listingReadinessIssues.join('、')}。`
                : '无，当前页面已满足草案门槛。'}
            </p>
          </div>
          {readEvidence && !listingScopeMatched && (
            <p className="warning-line">Listing 读取范围未能证明匹配当前店铺/站点：请确认当前范围后重新读取。</p>
          )}
          {listing && !listingReady && (
            <p className="warning-line">详情页已读取但 Listing 内容不完整：生成草案前必须核对 ASIN、标题、五点和后台词。</p>
          )}
          {!listing && listingProbeAttempted && (
            <p className="warning-line">页面已探测但内容未完整读取：已保留截图和页面 URL；请确认当前页是领星 Listing 详情页，并等待 ASIN、标题、五点和后台词加载后重新读取。</p>
          )}
        </Panel>

        <Panel title="关键词交接与发布边界" tone={keywords.length ? 'success' : 'warning'}>
          <div className="context-summary-grid">
            <div>
              <span>关键词来源</span>
              <strong>{handoffPayload ? '关键词机会页' : '手工输入/待带入'}</strong>
              <p>{handoffPayload ? '来自当前范围真实广告指标的机会池。' : '建议先从关键词机会页按 ASIN 带入，减少跨产品误用。'}</p>
            </div>
            <div>
              <span>带入 ASIN</span>
              <strong>{expectedAsin || '-'}</strong>
              <p>读取 Listing 后必须核对页面 ASIN 与该 ASIN 一致。</p>
            </div>
            <div>
              <span>关键词数量</span>
              <strong>{keywords.length}</strong>
              <p>生成草案前应删除不相关词和竞品误匹配词。</p>
            </div>
            <div>
              <span>草案来源</span>
              <strong>{drafts.length ? draftWorkspaceCopy.sourceLabel : '未生成'}</strong>
              <p>DeepSeek 不可用时会标记本地规则参考，不能当作 AI 已验证。</p>
            </div>
            <div>
              <span>AI 连接</span>
              <strong>{aiStatus.label}</strong>
              <p>{aiStatus.detail}</p>
            </div>
          </div>
          <p className="muted-line">交接范围：{handoffScopeText}</p>
          {handoffContext && (
            <div className="detail-grid evidence-grid">
              <div><span>广告组合</span><strong>{handoffContext.portfolioName || '-'}</strong></div>
              <div><span>广告活动</span><strong>{handoffContext.campaignName || '-'}</strong></div>
              <div><span>广告组</span><strong>{handoffContext.adGroupName || '-'}</strong></div>
              <div><span>对象类型</span><strong>{handoffContext.entityType || '-'}</strong></div>
              <div><span>触发关键词</span><strong>{handoffContext.keyword || '-'}</strong></div>
              <div><span>点击/订单</span><strong>{handoffContext.clicks ?? '-'} / {handoffContext.orders ?? '-'}</strong></div>
              <div><span>花费/销售 USD</span><strong>{handoffContext.spend ?? '-'} / {handoffContext.sales ?? '-'}</strong></div>
              <div><span>来源文件</span><strong><code>{handoffContext.sourceFile || '-'}</code></strong></div>
            </div>
          )}
          <p className="blocked-line">本页只生成本地草案和导出文件，不提交 Amazon，不修改 Lingxing Listing。</p>
        </Panel>

        <Panel title="核心商机词根热力图矩阵" tone={heatmapModel.summary.keywordCount ? (heatmapModel.summary.missingCount ? 'warning' : 'success') : 'warning'}>
          <div className="business-split">
            <div>
              <p className="muted-line">左侧词根来自关键词机会或手工输入；点击任一词根后，右侧 Title、五点、后台词和详情/A+ 会即时高亮当前文本与本地草案的命中区域。</p>
              <p className="blocked-line">热力图只做本地覆盖复核，不提交 Amazon，不自动改写 Lingxing Listing。</p>
            </div>
            <StatusPill tone={heatmapModel.summary.missingCount ? 'warning' : heatmapModel.summary.keywordCount ? 'ready' : 'pending'}>
              {heatmapModel.summary.keywordCount ? `${heatmapModel.summary.coveredCount}/${heatmapModel.summary.keywordCount} 已覆盖` : '待输入词根'}
            </StatusPill>
          </div>
          <div className="listing-heatmap-grid">
            <aside className="listing-heatmap-keyword-rail" aria-label="核心商机词根">
              <div className="listing-heatmap-summary">
                <div><span>词根</span><strong>{heatmapModel.summary.keywordCount}</strong></div>
                <div><span>草案新增</span><strong>{heatmapModel.summary.draftGainCount}</strong></div>
                <div><span>待融入</span><strong>{heatmapModel.summary.missingCount}</strong></div>
              </div>
              {heatmapModel.keywords.length ? heatmapModel.keywords.map((item) => (
                <button
                  aria-pressed={selectedHeatmapKeyword === item.keyword}
                  className={listingHeatmapKeywordButtonClass(
                    item.level,
                    selectedHeatmapKeyword === item.keyword,
                    pulsingHeatmapKeyword === item.keyword,
                    heatmapPulseSerial,
                  )}
                  key={item.keyword}
                  onClick={() => focusHeatmapKeyword(item.keyword)}
                  type="button"
                >
                  <span>{item.keyword}</span>
                  <strong>{item.score}</strong>
                  <small>{item.levelLabel} / 建议 {item.recommendedSection}</small>
                </button>
              )) : (
                <p className="muted-line">从关键词机会页带入，或在下方粘贴关键词后显示词根热力图。</p>
              )}
            </aside>
            <div className="listing-heatmap-matrix">
              {heatmapModel.sections.map((section) => {
                const activeHit = Boolean(selectedHeatmapKeyword && (
                  includesKeyword(section.currentText, selectedHeatmapKeyword)
                  || includesKeyword(section.draftText, selectedHeatmapKeyword)
                ));
                const pulsingSection = Boolean(activeHit && pulsingHeatmapKeyword);
                const diff = buildListingTextDiffSegments(section.currentText, section.draftText);
                const draftLength = section.draftText.length;
                const draftGenerating = loading === 'draft';
                return (
                  <section className={listingHeatmapSectionClass(activeHit, pulsingSection, heatmapPulseSerial)} key={section.key}>
                    <div className="listing-heatmap-section-head">
                      <div>
                        <span>{section.label}</span>
                        <strong>{section.draftHits.length ? `命中 ${section.draftHits.length} 个词根` : '未命中词根'}</strong>
                      </div>
                      <StatusPill tone={section.draftHits.length ? 'ready' : section.currentText ? 'warning' : 'pending'}>
                        {activeHit ? '当前命中' : section.draftHits.length ? '有覆盖' : '待覆盖'}
                      </StatusPill>
                    </div>
                    <div className="listing-heatmap-text-grid">
                      <div>
                        <span>线上原文</span>
                        <p>{renderHeatmapSegments(section.currentText, selectedHeatmapKeyword, pulsingSection)}</p>
                      </div>
                      <div className={listingDraftPanelClass(draftGenerating)} aria-busy={draftGenerating}>
                        <span>本地草案 / 复核文本</span>
                        <p>{renderHeatmapSegments(section.draftText, selectedHeatmapKeyword, pulsingSection)}</p>
                        {section.charLimit && (
                          <small className={listingCharacterLimitClass(draftLength, section.charLimit)}>
                            {draftLength} / {section.charLimit}
                          </small>
                        )}
                      </div>
                    </div>
                    {renderListingDiffPreview(diff)}
                  </section>
                );
              })}
            </div>
          </div>
          {selectedHeatmapKeyword && (
            <p aria-atomic="true" aria-live="polite" className="muted-line listing-heatmap-focus-status">
              {heatmapFocusAnnouncement} {heatmapModel.keywords.find((item) => item.keyword === selectedHeatmapKeyword)?.evidence || '暂无命中证据。'}
            </p>
          )}
        </Panel>

        <Panel title="当前 Listing 内容">
          <div className="detail-grid">
            <div><span>ASIN</span><strong>{listing?.asin || '-'}</strong></div>
            <div><span>目标 ASIN</span><strong>{expectedAsin || '-'}</strong></div>
            <div><span>页面匹配</span><strong>{listing ? (pageMatched ? '通过' : '阻断：ASIN 不一致') : '未读取'}</strong></div>
            <div><span>来源</span><strong>{listing?.source || '-'}</strong></div>
            <div><span>页面 URL</span><strong>{listing?.pageUrl || '-'}</strong></div>
            <div><span>版本</span><strong>{listing?.versionLabel || listing?.versionId || '-'}</strong></div>
            <div><span>后台词</span><strong>{listing?.backendTerms || '-'}</strong></div>
            <div><span>详情</span><strong>{listing?.description || '-'}</strong></div>
            <div><span>A+</span><strong>{listing?.aPlus || '-'}</strong></div>
            <div><span>图片文案</span><strong>{listing?.imageCopy || '-'}</strong></div>
          </div>
          <div className="listing-copy-block">
            <h3>标题</h3>
            <p>{listing?.title || '尚未读取标题。'}</p>
            <h3>五点</h3>
            {(listing?.bullets?.length ? listing.bullets : ['尚未读取五点。']).map((item, index) => (
              <p key={`${index}-${item}`}>{index + 1}. {item}</p>
            ))}
          </div>
        </Panel>

        <Panel title="Listing 版本历史" tone={listingVersions.length ? 'success' : 'default'}>
          {listingVersions.length ? (
            <div className="business-card-list">
              {listingVersions.map((version) => (
                <div className="business-card" key={version.versionId}>
                  <div className="business-split">
                    <div>
                      <strong>{version.versionLabel || `版本 #${version.versionId}`}</strong>
                      <p className="muted-line">{version.createdAt || '-'} / {version.source || 'manual'} / {version.storeName || scope.storeName || '-'} / {version.marketplaceCode || scope.marketplaceCode || '-'}</p>
                      <p>{version.changeSummary || '未填写修改说明'}</p>
                    </div>
                    <StatusPill tone="ready">#{version.versionId}</StatusPill>
                  </div>
                  <div className="detail-grid">
                    <div><span>标题</span><strong>{version.title || '-'}</strong></div>
                    <div><span>五点</span><strong>{version.bullets?.filter(Boolean).length || 0}</strong></div>
                    <div><span>后台词</span><strong>{version.backendTerms || '-'}</strong></div>
                    <div><span>详情/A+</span><strong>{version.description || version.aPlus || '-'}</strong></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-line">当前 ASIN 还没有版本历史。保存手工 Listing 后会在这里显示每次修改记录。</p>
          )}
        </Panel>

        <Panel title="关键词与本地草案工作台" tone={quantReady ? 'success' : 'warning'}>
          <div className="listing-draft-workbench" aria-label="Listing 关键词与本地草案工作台">
            <section className="listing-draft-pane listing-draft-keyword-pane">
              <div className="listing-draft-pane-head">
                <div>
                  <span>01 关键词输入</span>
                  <strong>{handoffPayload ? '来自关键词机会' : '手工粘贴或待带入'}</strong>
                </div>
                <StatusPill tone={keywords.length ? 'ready' : 'pending'}>{draftWorkspaceCopy.keywordStatusLabel}</StatusPill>
              </div>
              <label className="textarea-label">
                粘贴关键词机会（逗号或换行分隔）
                <textarea
                  value={keywordsText}
                  onChange={(event) => setKeywordsText(event.target.value)}
                  placeholder={draftWorkspaceCopy.keywordPlaceholder}
                />
              </label>
              <p className="muted-line" aria-live="polite">
                已输入 {keywords.length} 个关键词；生成前请删除不相关词、竞品误匹配词和跨产品词。
              </p>
            </section>

            <section className="listing-draft-pane">
              <div className="listing-draft-pane-head">
                <div>
                  <span>02 数据门槛与用途</span>
                  <strong>{draftWorkspaceCopy.draftUseLabel}</strong>
                </div>
                <StatusPill tone={draftWorkspaceCopy.dataGateTone}>{draftWorkspaceCopy.dataGateLabel}</StatusPill>
              </div>
              <div className="listing-draft-gate-grid">
                <div className={`listing-draft-gate listing-draft-gate-${draftWorkspaceCopy.dataGateTone}`}>
                  <span>数据门槛</span>
                  <strong>{draftWorkspaceCopy.dataGateLabel}</strong>
                  <p>{draftWorkspaceCopy.dataGateDetail}</p>
                </div>
                <div className={`listing-draft-gate listing-draft-gate-${quantReady ? 'ready' : 'warning'}`}>
                  <span>草案用途</span>
                  <strong>{draftWorkspaceCopy.draftUseLabel}</strong>
                  <p>{draftWorkspaceCopy.draftUseDetail}</p>
                </div>
              </div>
            </section>

            <section className="listing-draft-pane listing-draft-action-pane">
              <div className="listing-draft-pane-head">
                <div>
                  <span>03 生成与导出</span>
                  <strong>{draftWorkspaceCopy.sourceLabel}</strong>
                </div>
                <StatusPill tone={draftReady ? 'ready' : listingReady && keywords.length ? aiStatus.tone : 'blocked'}>
                  {draftReady ? '草案已生成' : aiStatus.label}
                </StatusPill>
              </div>
              <p className="muted-line">{draftWorkspaceCopy.sourceDetail}</p>
              <div className="listing-draft-metrics" aria-label="Listing 草案来源统计">
                <div><span>AI 草案</span><strong>{aiDraftCount}</strong></div>
                <div><span>本地规则参考</span><strong>{ruleDraftCount}</strong></div>
                <div><span>可导出草案</span><strong>{drafts.length}</strong></div>
              </div>
              <div className="action-row">
                <button aria-busy={generateDraftButton.ariaBusy} className={generateDraftButton.className} disabled={generateDraftButton.disabled} onClick={generateDrafts} type="button">
                  {generateDraftButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                  <span>{generateDraftButton.label}</span>
                </button>
                <button aria-busy={exportDraftButton.ariaBusy} className={exportDraftButton.className} disabled={exportDraftButton.disabled} onClick={exportDrafts} type="button">
                  {exportDraftButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                  <span>{exportDraftButton.label}</span>
                </button>
              </div>
            </section>
          </div>
          <p className="blocked-line">本地草案不会自动提交 Amazon，不修改 Lingxing Listing；缺真实广告数据时也不会进入交付证据包。</p>
          <div className="listing-draft-table-title">
            <div>
              <span>草案明细</span>
              <strong>{draftReady ? `${drafts.length} 条待人工复核` : '尚未生成草案'}</strong>
            </div>
            <StatusPill tone={draftReady ? 'ready' : 'pending'}>{draftReady ? '可导出' : '待草案'}</StatusPill>
          </div>
          <div className="table-wrap">
            <table className="business-table">
              <thead>
                <tr>
                  <th>位置</th>
                  <th>当前文本</th>
                  <th>草案文本</th>
                  <th>关键词</th>
                  <th>来源</th>
                  <th>原因/证据</th>
                  <th>风险</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft, index) => (
                  <tr key={`${draft.section}-${index}`}>
                    <td>{sectionLabel(draft.section)}</td>
                    <td>{draft.currentText || '-'}</td>
                    <td>{draft.draftedText || '-'}</td>
                    <td>{draft.keywords?.join(', ') || '-'}</td>
                    <td>{draftSourceLabel(draft)}{draft.aiFallbackReason ? ` / ${draft.aiFallbackReason}` : ''}</td>
                    <td>{draft.evidence || '-'}</td>
                    <td>{draft.riskWarnings?.join(', ') || '需人工复核'}</td>
                  </tr>
                ))}
                {!drafts.length && (
                  <tr>
                    <td colSpan={7}>尚未生成草案。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        {message && <p className={message.includes('失败') || message.includes('请先') ? 'blocked-line' : 'muted-line'}>{message}</p>}
      </div>
    </div>
  );
}
