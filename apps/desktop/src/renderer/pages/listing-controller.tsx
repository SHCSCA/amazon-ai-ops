import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWorkspaceOperation } from '../components/workspace/use-workspace-operation';
import { useOptionalMissionControlStoreContext } from '../mission-control/store-context';
import { rendererRuntimeLog } from '../runtime-log';
import { toUserFacingError } from '../user-facing-error';
import { useBusinessDataPipeline, ScopeText } from '../components/business-data';
import { ProgressiveDetails } from '../components/progressive-details';
import { FormTable, FormTableRow, PageHeader, Panel, StatusPill } from '../components/ui';
import { TaskBanner } from '../components/workspace';
import { useOverlayFocusScope } from '../components/workspace/overlay-focus-scope';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import {
  buildListingReadinessIssues,
  buildListingSourceStatus,
  buildListingWorkflowSummary,
  isListingReadyForDraft,
} from '../listing-workflow-summary';
import { hasFormalReportCoverage, hasRealReportCoverage } from '../report-coverage';
import type { AppRoute, ListingContentVersionView, ListingContentView, ListingDraftView, ListingHandoffPayload, ListingSection, ListingSuggestionView } from '../types';
import { ensureFiveBullets, listingAiStatusFromSettings, getListingContentBlocker, hasMeaningfulListingContent, buildSuggestedText, listingManualFieldGroups } from './listing-content';
import { type ListingReadEvidence, type ListingAiStatus, type ListingManualField, type ListingTextDiff, type ListingTextDiffSegment, type ListingTaskIntent } from './listing-contracts';
import { buildListingHeatmapModel, buildListingHeatmapFocusAnnouncement, highlightListingTextSegments, includesKeyword } from './listing-heatmap';
import { listingDraftWorkspaceCopy, listingHeatmapTokenClass, listingDraftGenerationMessage, readStatus, listingHeatmapKeywordButtonClass, listingHeatmapSectionClass, listingDraftPanelClass, listingCharacterLimitClass, sectionLabel, draftSourceLabel } from './listing-presentation';
import { errorMessage, listingHistoryRefreshButtonView, listingLocalActionButtonView, navigate } from './listing-actions';
import { buildListingTaskModel } from './listing-task-model';
import { buildListingTextDiffSegments } from './listing-text-diff';

export function useListingOptimizationPage() {

  const { data, loading: pipelineLoading, scope, configurationRequired } = useBusinessDataPipeline();
  const storeAuthority = useOptionalMissionControlStoreContext();
  const workspaceKey = JSON.stringify([storeAuthority?.authorityKey, storeAuthority?.contextEpoch, storeAuthority?.phase, scope]);
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
  const operationKey = JSON.stringify([workspaceKey, manualListing.asin?.trim().toUpperCase()]);
  const operation = useWorkspaceOperation(operationKey);
  const [listing, setListing] = useState<ListingContentView | null>(null);
  const [listingVersions, setListingVersions] = useState<ListingContentVersionView[]>([]);
  const [readEvidence, setReadEvidence] = useState<ListingReadEvidence | null>(null);
  const [drafts, setDrafts] = useState<ListingDraftView[]>([]);
  const [keywordsText, setKeywordsText] = useState('');
  const [keywordEditorOpen, setKeywordEditorOpen] = useState(false);
  const [listingEditorOpen, setListingEditorOpen] = useState(false);
  const [handoffPayload, setHandoffPayload] = useState<ListingHandoffPayload | null>(null);
  const [aiStatus, setAiStatus] = useState<ListingAiStatus>(listingAiStatusFromSettings(null));
  const [activeHeatmapKeyword, setActiveHeatmapKeyword] = useState<string | null>(null);
  const [heatmapPulseKeyword, setHeatmapPulseKeyword] = useState<string | null>(null);
  const [heatmapPulseSerial, setHeatmapPulseSerial] = useState(0);
  const [loading, setLoading] = useState<string | null>(null);
  const [actionOrigin, setActionOrigin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const heatmapPulseTimeoutRef = useRef<number | null>(null);
  const currentBatchId = scope.batchId || data?.collection.latestBatch?.id || data?.scope.batchId;

  useLayoutEffect(() => {
    setListing(null); setListingVersions([]); setReadEvidence(null); setDrafts([]);
    setHandoffPayload(null); setKeywordsText(''); setMessage(null);
    setLoading(null); setActionOrigin(''); setListingEditorOpen(false); setKeywordEditorOpen(false);
    setManualListing({ asin: scope.asin || '', title: '', bullets: ensureFiveBullets(),
      description: '', aPlus: '', imageCopy: '', backendTerms: '', source: 'manual' });
  }, [workspaceKey]);
  useLayoutEffect(() => { setLoading(null); setListingVersions([]); }, [operationKey]);

  useEffect(() => {
    let mounted = true;
    async function loadAiStatus() {
      const isCurrent = operation.capture();
      try {
        const settings = await (window as any).electronAPI?.getSettings?.();
        if (mounted && isCurrent()) setAiStatus(listingAiStatusFromSettings(settings));
      } catch (caught) {
        rendererRuntimeLog.error('listing.ai_status_read_failed', { error: caught });
        if (mounted && isCurrent()) setAiStatus(listingAiStatusFromSettings(null));
      }
    }
    loadAiStatus();
    const onDataUpdated = () => loadAiStatus();
    window.addEventListener('business-ui:data-updated', onDataUpdated);
    return () => {
      mounted = false;
      window.removeEventListener('business-ui:data-updated', onDataUpdated);
    };
  }, [workspaceKey]);

  useEffect(() => {
    let handoffStorage: Storage | undefined;
    try {
      handoffStorage = window.localStorage;
      const raw = handoffStorage.getItem('amazon-ai-ops-listing-handoff');
      if (!raw) return;
      const handoff = JSON.parse(raw) as ListingHandoffPayload;
      const handoffScope = handoff.scope;
      if (handoffScope?.batchId && !currentBatchId && pipelineLoading) return;

      handoffStorage.removeItem('amazon-ai-ops-listing-handoff');
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
    } catch (caught) {
      rendererRuntimeLog.error('listing.keyword_handoff_failed', { error: caught });
      setHandoffPayload(null);
      try { handoffStorage?.removeItem('amazon-ai-ops-listing-handoff'); }
      catch (cleanupError) { rendererRuntimeLog.error('listing.keyword_handoff_cleanup_failed', { error: cleanupError }); }
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
  const quantReady = Boolean(hasFormalReportCoverage(data?.collection) && data?.quant.hasImportedMetrics);
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
    const isCurrent = operation.capture();
    if (!isCurrent()) return [];
    const api = (window as any).electronAPI;
    if (!asin.trim()) return [];
    if (typeof api?.listListingContentVersions !== 'function') throw new Error('本地版本历史服务未连接，请重新打开当前应用。');
    const versions = await api.listListingContentVersions({
      asin: asin.trim().toUpperCase(),
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      storeContext: storeAuthority?.authoritativeContext,
      limit: 10,
    });
    if (!isCurrent()) return [];
    if (!Array.isArray(versions)) throw new Error('本地版本历史响应无效，请刷新后重试。');
    const normalizedVersions = versions;
    setListingVersions(normalizedVersions);
    return normalizedVersions;
  }

  async function refreshListingVersions(origin: 'summary-history' | 'editor-history' = 'summary-history') {
    const asin = manualListing.asin?.trim();
    if (!asin) {
      setMessage('请先填写 ASIN，再刷新本地版本历史。');
      return;
    }
    const ticket = beginListingOperation(origin);
    if (!ticket) return;
    setLoading('history');
    setMessage('正在刷新 Listing 版本历史...');
    try {
      const versions = await loadListingVersions(asin);
      if (!ticket.isCurrent()) return;
      setMessage(`已刷新 Listing 版本历史：${versions.length} 个本地版本。`);
    } catch (caught) {
      rendererRuntimeLog.error('listing.history_refresh_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setMessage(errorMessage(caught, '刷新 Listing 版本历史失败'));
    } finally {
      if (ticket.isCurrent()) setLoading(null);
      ticket.finish();
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
        {control && React.cloneElement(control, {
          readOnly: Boolean(loading || operation.busy),
          'aria-describedby': loading || operation.busy ? 'listing-operation-lock' : undefined,
        })}
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
    const ticket = beginListingOperation('editor-save');
    if (!ticket) return;
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
        storeContext: storeAuthority?.authoritativeContext,
      });
      if (!ticket.isCurrent()) return;
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
      try { await loadListingVersions(nextListing.asin || ''); }
      catch (historyError) {
        rendererRuntimeLog.error('listing.history_after_save_read_failed', { error: historyError });
        if (ticket.isCurrent()) setMessage('当前 Listing 已保存在本地，但版本历史读取失败；请刷新本地版本历史核对，无需重复保存。');
        return;
      }
      if (!ticket.isCurrent()) return;
      setMessage('已保存当前 Listing 本地版本。草案只保存在本地，不会自动提交 Amazon。');
    } catch (caught) {
      rendererRuntimeLog.error('listing.manual_save_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setMessage(errorMessage(caught, '保存手工 Listing 失败'));
    } finally {
      if (ticket.isCurrent()) setLoading(null);
      ticket.finish();
    }
  }

  async function readFromLingxing(origin = 'panel-read') {
    const ticket = beginListingOperation(origin);
    if (!ticket) return;
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
          storeContext: storeAuthority?.authoritativeContext,
        },
      };
      const result = api?.probeLingxingListingDetailAndExtract
        ? await api.probeLingxingListingDetailAndExtract(readOptions)
        : await api.extractListingFromLingxing(readOptions);
      if (!ticket.isCurrent()) return;
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
          setMessage(toUserFacingError(new Error(result?.reason || `页面已探测但内容未完整读取：${blocker}。请切换到正确的领星 Listing 详情页或等待页面加载完成后重试。`), 'Listing 内容未完整读取，请改用手工维护。'));
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
      rendererRuntimeLog.error('listing.source_read_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setListing(null);
      setReadEvidence(null);
      setDrafts([]);
      setMessage(errorMessage(caught, '读取 Lingxing Listing 失败/阻断'));
    } finally {
      if (ticket.isCurrent()) setLoading(null);
      ticket.finish();
    }
  }

  async function generateDrafts(origin = 'panel-generate') {
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
    const ticket = beginListingOperation(origin);
    if (!ticket) return;
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
      const api = (window as any).electronAPI;
      if (typeof api?.generateListingDrafts !== 'function') throw new Error('当前草案生成服务未连接，请重新打开应用后重试。');
      const result = await api.generateListingDrafts(suggestions);
      if (!ticket.isCurrent()) return;
      setDrafts(Array.isArray(result) ? result : []);
      setMessage(listingDraftGenerationMessage(quantReady, Array.isArray(result) ? result : []));
    } catch (caught) {
      rendererRuntimeLog.error('listing.draft_generation_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setMessage(errorMessage(caught, '生成 Listing 草案失败'));
    } finally {
      if (ticket.isCurrent()) setLoading(null);
      ticket.finish();
    }
  }

  async function exportDrafts(origin = 'panel-export') {
    if (!drafts.length) {
      setMessage('暂无可导出的草案。');
      return;
    }
    const ticket = beginListingOperation(origin);
    if (!ticket) return;
    setLoading('export-drafts');
    setMessage(null);
    try {
      const api = (window as any).electronAPI;
      if (typeof api?.exportListingDrafts !== 'function') throw new Error('当前草案导出服务未连接，请重新打开应用后重试。');
      const exportPath = await api.exportListingDrafts(drafts, 'xlsx');
      if (!ticket.isCurrent()) return;
      if (!exportPath) { setMessage('本次没有导出文件；可以重新选择保存位置。'); return; }
      setMessage('本地 Listing 草案已导出，可在所选文件夹查看。');
    } catch (caught) {
      rendererRuntimeLog.error('listing.draft_export_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setMessage(errorMessage(caught, '导出 Listing 草案失败'));
    } finally {
      if (ticket.isCurrent()) setLoading(null);
      ticket.finish();
    }
  }

  function closeKeywordEditor() {
    setKeywordEditorOpen(false);
  }

  function closeListingEditor() {
    if (loading || operation.busy) return;
    setListingEditorOpen(false);
  }

  const listingEditorDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    dismissDisabled: Boolean(loading || operation.busy),
    onDismiss: closeListingEditor,
    open: listingEditorOpen,
  });
  const listingKeywordDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    onDismiss: closeKeywordEditor,
    open: keywordEditorOpen,
  });

  const listingActionBusy = Boolean(loading || operation.busy);
  const listingApi = typeof window === 'undefined' ? undefined : (window as any).electronAPI;
  const canReadLingxing = typeof listingApi?.extractListingFromLingxing === 'function'
    || typeof listingApi?.probeLingxingListingDetailAndExtract === 'function';
  const historyRefreshButton = listingHistoryRefreshButtonView({
    active: loading === 'history' && actionOrigin === 'summary-history',
    canRefresh: Boolean(manualListing.asin?.trim()),
    groupBusy: listingActionBusy,
  });
  const editorHistoryRefreshButton = listingHistoryRefreshButtonView({
    active: loading === 'history' && actionOrigin === 'editor-history',
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
    active: loading === 'read' && actionOrigin === 'panel-read',
    baseClassName: 'secondary-button',
    busyLabel: '读取中...',
    groupBusy: listingActionBusy,
    label: '尝试从当前领星页面填入表单',
    disabled: !canReadLingxing,
  });
  const generateDraftButton = listingLocalActionButtonView({
    active: loading === 'draft' && actionOrigin === 'panel-generate',
    baseClassName: 'primary-button',
    busyLabel: '生成中...',
    disabled: !listingReady,
    groupBusy: listingActionBusy,
    label: draftWorkspaceCopy.primaryActionLabel,
  });
  const exportDraftButton = listingLocalActionButtonView({
    active: loading === 'export-drafts' && actionOrigin === 'panel-export',
    baseClassName: 'secondary-button',
    busyLabel: '导出中...',
    disabled: !drafts.length,
    groupBusy: listingActionBusy,
    label: '导出草案',
  });
  const listingTaskModel = buildListingTaskModel({
    keywordCount: keywords.length,
    listingReady,
    draftCount: drafts.length,
    quantReady,
    loading: actionOrigin.startsWith('task-') ? loading : null,
  });

  function runListingTaskIntent(intent: ListingTaskIntent) {
    if (intent === 'edit-keywords') {
      setKeywordEditorOpen(true);
      return;
    }
    if (intent === 'keyword-opportunities') {
      navigate('keyword-opportunities');
      return;
    }
    if (intent === 'edit-listing') {
      setListingEditorOpen(true);
      return;
    }
    if (intent === 'read-lingxing') {
      void readFromLingxing('task-read');
      return;
    }
    if (intent === 'generate-draft') {
      void generateDrafts('task-generate');
      return;
    }
    if (intent === 'export-draft') {
      void exportDrafts('task-export');
    }
  }

  function listingTaskIntentBusy(intent: ListingTaskIntent): boolean {
    return (intent === 'read-lingxing' && loading === 'read' && actionOrigin === 'task-read')
      || (intent === 'generate-draft' && loading === 'draft' && actionOrigin === 'task-generate')
      || (intent === 'export-draft' && loading === 'export-drafts' && actionOrigin === 'task-export');
  }

  function listingTaskIntentLabel(intent: ListingTaskIntent): string {
    const labels: Record<ListingTaskIntent, string> = {
      'edit-keywords': '编辑关键词',
      'keyword-opportunities': '打开关键词机会',
      'edit-listing': '打开 Listing 编辑',
      'read-lingxing': '辅助读取领星',
      'generate-draft': '重新生成草案',
      'export-draft': '导出本地草案',
    };
    return labels[intent];
  }

  const listingSecondaryActions = listingTaskModel.secondaryIntents.map((intent) => {
    const busy = listingTaskIntentBusy(intent);
    return {
      busy,
      busyLabel: busy ? '处理中...' : undefined,
      disabled: (listingActionBusy && !busy) || (intent === 'read-lingxing' && !canReadLingxing),
      disabledReason: intent === 'read-lingxing' && !canReadLingxing ? '当前版本请通过 Listing 编辑手工维护内容。' : '当前 Listing 动作正在处理，请等待完成。',
      label: listingTaskIntentLabel(intent),
      onClick: () => runListingTaskIntent(intent),
    };
  });

  
  function beginListingOperation(origin: string) {
    if (!storeAuthority?.authoritativeContext || storeAuthority.phase !== 'ready') {
      setMessage('请先选择并确认当前美国站店铺，再处理 Listing。');
      return null;
    }
    const ticket = operation.begin();
    if (ticket) setActionOrigin(origin);
    return ticket;
  }

  return {
    configurationRequired,
    listingActionBusy,
    canReadLingxing,
    workflowSummary,
    listingTaskModel,
    workflowBlocker,
    loading,
    runListingTaskIntent,
    listingSecondaryActions,
    keywords,
    listingReady,
    listingProbeAttempted,
    listing,
    listingSourceStatus,
    draftReady,
    aiStatus,
    data,
    scope,
    manualListing,
    pageMatched,
    expectedAsin,
    titleRead,
    bulletsRead,
    backendTermsRead,
    listingVersions,
    setListingEditorOpen,
    historyRefreshButton,
    editorHistoryRefreshButton,
    refreshListingVersions,
    readLingxingButton,
    readFromLingxing,
    asinMatched,
    detailProbeStatus,
    readEvidence,
    listingScopeMatched,
    currentScopeText,
    readScopeText,
    listingReadinessIssues,
    handoffPayload,
    drafts,
    draftWorkspaceCopy,
    handoffScopeText,
    handoffContext,
    heatmapModel,
    selectedHeatmapKeyword,
    pulsingHeatmapKeyword,
    heatmapPulseSerial,
    focusHeatmapKeyword,
    renderHeatmapSegments,
    renderListingDiffPreview,
    heatmapFocusAnnouncement,
    setKeywordEditorOpen,
    quantReady,
    aiDraftCount,
    ruleDraftCount,
    generateDraftButton,
    generateDrafts,
    exportDraftButton,
    exportDrafts,
    listingEditorOpen,
    closeListingEditor,
    listingEditorDialogFocus,
    renderManualListingField,
    saveManualButton,
    saveManualListing,
    keywordEditorOpen,
    closeKeywordEditor,
    listingKeywordDialogFocus,
    keywordsText,
    setKeywordsText,
    message,
  };
}
