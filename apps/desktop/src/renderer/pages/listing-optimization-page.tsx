import React, { useEffect, useMemo, useState } from 'react';
import { useBusinessDataPipeline, ScopeText } from '../components/business-data';
import { PageHeader, Panel, StatusPill } from '../components/ui';
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
  if (draft.aiFallbackReason) return '规则兜底';
  return draft.source === 'ai' ? 'AI' : '规则';
}

export function listingDraftGenerationMessage(quantReady: boolean, drafts: Array<Partial<ListingDraftView>>): string {
  const aiCount = drafts.filter((draft) => draft.source === 'ai' && !draft.aiFallbackReason).length;
  const fallbackDrafts = drafts.filter((draft) => draft.source !== 'ai' || draft.aiFallbackReason);
  const fallbackCount = fallbackDrafts.length;
  const fallbackReasons = Array.from(new Set(fallbackDrafts.map((draft) => draft.aiFallbackReason).filter(Boolean)));
  const parts = [
    aiCount ? `${aiCount} 条 AI 草案` : '',
    fallbackCount ? `${fallbackCount} 条规则兜底草案` : '',
  ].filter(Boolean).join('，') || `${drafts.length} 条 Listing 草案`;
  const reason = fallbackReasons.length ? ` 兜底原因：${fallbackReasons.slice(0, 2).join('；')}。` : '';
  if (!quantReady) {
    return `已生成 ${parts}。当前范围缺真实广告数据，不能声明 AI 已验证。${reason}`;
  }
  return `已生成 ${parts}。${reason}草案只保存在本地，不会自动提交 Amazon。`;
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
      detail: '无法读取设置时仍可生成规则兜底草案，但不会声称 AI 已参与。',
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
      detail: '未配置 API Key，Listing 草案只能使用规则兜底。',
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
      detail: lastMessage || '最近一次 AI 连接测试失败，草案会回落到规则兜底。',
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
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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

  async function loadListingVersions(asin: string) {
    const api = (window as any).electronAPI;
    if (!api?.listListingContentVersions || !asin.trim()) return;
    const versions = await api.listListingContentVersions({
      asin: asin.trim().toUpperCase(),
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      limit: 10,
    });
    setListingVersions(Array.isArray(versions) ? versions : []);
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
        evidence: quantReady ? '当前范围真实广告指标 + 关键词机会池' : '规则兜底：当前范围未满足真实广告指标门槛',
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
    try {
      const exportPath = await (window as any).electronAPI?.exportListingDrafts?.(drafts, 'xlsx');
      setMessage(`已导出 Listing 草案：${exportPath}`);
    } catch (caught) {
      setMessage(errorMessage(caught, '导出 Listing 草案失败'));
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="关键词与 Listing"
        title="Listing 优化"
        description="手工录入当前 Listing，结合关键词机会检查覆盖并生成 AI/规则标记的本地草案。领星读取只作为辅助填充。不会自动提交 Amazon。"
        primaryTask="生成可导出的 Listing 草案"
        nextAction={listing ? '生成草案并导出' : '先录入并保存 Listing'}
      />

      <div className="business-stack">
        <Panel title="Listing 工作流状态" tone={draftReady ? 'success' : keywords.length && listingReady ? 'warning' : 'default'}>
          <div className="evidence-check-panel">
            <div className="business-split">
              <div>
                <h3>当前主任务</h3>
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
                <p>{quantReady ? '草案可引用当前广告数据，但仍需人工复核。' : '缺真实广告数据时，草案只能按规则兜底标记。'}</p>
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
              <span>3 AI / 规则草案</span>
              <strong>{draftReady ? `${aiDraftCount} AI / ${ruleDraftCount} 规则` : aiStatus.label}</strong>
              <p>{quantReady ? aiStatus.detail : '缺真实广告数据时只允许规则兜底标记。'}</p>
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
          <div className="settings-form-grid">
            <label>
              ASIN
              <input value={manualListing.asin || ''} onChange={(event) => updateManualListing({ asin: event.target.value })} placeholder="例如 B0..." />
            </label>
            <label>
              版本名称
              <input value={manualListing.versionLabel || ''} onChange={(event) => updateManualListing({ versionLabel: event.target.value })} placeholder="例如 2026-06-18 标题五点调整" />
            </label>
            <label>
              修改说明
              <input value={manualListing.changeSummary || ''} onChange={(event) => updateManualListing({ changeSummary: event.target.value })} placeholder="例如 补充核心词和场景词" />
            </label>
            <label>
              标题
              <textarea value={manualListing.title || ''} onChange={(event) => updateManualListing({ title: event.target.value })} placeholder="当前 Listing 标题" />
            </label>
          </div>
          <div className="settings-form-grid">
            {ensureFiveBullets(manualListing.bullets).map((bullet, index) => (
              <label key={`manual-bullet-${index + 1}`}>
                五点 {index + 1}
                <textarea value={bullet} onChange={(event) => updateManualBullet(index, event.target.value)} placeholder={`Bullet ${index + 1}`} />
              </label>
            ))}
          </div>
          <div className="settings-form-grid">
            <label>
              详情 / A+ 内容
              <textarea value={manualListing.description || manualListing.aPlus || ''} onChange={(event) => updateManualListing({ description: event.target.value, aPlus: event.target.value })} placeholder="详情描述或 A+ 文案" />
            </label>
            <label>
              后台搜索词
              <textarea value={manualListing.backendTerms || ''} onChange={(event) => updateManualListing({ backendTerms: event.target.value })} placeholder="Search Terms / 后台关键词" />
            </label>
            <label>
              图片文案
              <textarea value={manualListing.imageCopy || ''} onChange={(event) => updateManualListing({ imageCopy: event.target.value })} placeholder="可选：主图/副图文案备注" />
            </label>
          </div>
          <div className="action-row">
            <button className="primary-button" disabled={loading === 'save-manual'} onClick={saveManualListing} type="button">
              {loading === 'save-manual' ? '保存中...' : '保存为新版本'}
            </button>
            <button className="secondary-button" disabled={!manualListing.asin?.trim()} onClick={() => loadListingVersions(manualListing.asin || '')} type="button">
              刷新版本历史
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
            <button className="secondary-button" disabled={loading === 'read'} onClick={readFromLingxing} type="button">
              {loading === 'read' ? '读取中...' : '尝试从当前领星页面填入表单'}
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

        <Panel title="关键词交接与草案边界" tone={keywords.length ? 'success' : 'warning'}>
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
              <strong>{drafts.length ? `${aiDraftCount} AI / ${ruleDraftCount} 规则` : '未生成'}</strong>
              <p>DeepSeek 不可用时会标记规则兜底，不能当作 AI 已验证。</p>
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

        <Panel title="关键词覆盖">
          <label className="textarea-label">
            粘贴关键词机会（逗号或换行分隔）
            <textarea value={keywordsText} onChange={(event) => setKeywordsText(event.target.value)} placeholder="keyword one&#10;keyword two" />
          </label>
          <p className="muted-line">已输入 {keywords.length} 个关键词；生成草案前请确认关键词来自当前范围的真实广告数据。当前门槛：{quantReady ? '真实广告数据可用' : '缺真实广告数据，生成时按规则兜底标记'}。</p>
        </Panel>

        <Panel title="本地修改建议与草案导出" tone={quantReady ? 'default' : 'warning'}>
          <div className="context-summary-grid">
            <div>
              <span>草案可信度</span>
              <strong>{quantReady ? '可引用当前广告数据' : '规则兜底'}</strong>
              <p>{quantReady ? '关键词来自当前范围真实广告数据，仍需人工复核。' : '缺真实广告数据时只生成本地占位草案，不能进入交付证据。'}</p>
            </div>
            <div>
              <span>AI 结果</span>
              <strong>{drafts.length ? `${aiDraftCount} 条 AI` : aiStatus.label}</strong>
              <p>{aiStatus.detail}</p>
            </div>
            <div>
              <span>规则结果</span>
              <strong>{drafts.length ? `${ruleDraftCount} 条规则` : '未生成'}</strong>
              <p>规则结果只能作为编辑参考，不等同于 AI 验证或发布建议。</p>
            </div>
          </div>
          <div className="action-row">
            <button className="primary-button" disabled={!listingReady || loading === 'draft'} onClick={generateDrafts} type="button">
              {loading === 'draft' ? '生成中...' : quantReady ? '生成本地草案' : '生成规则兜底草案'}
            </button>
            <button className="secondary-button" disabled={!drafts.length} onClick={exportDrafts} type="button">导出草案</button>
          </div>
          <p className="blocked-line">草案只保存在本地，不会自动提交 Amazon。</p>
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
