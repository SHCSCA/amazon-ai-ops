import React, { useEffect, useMemo, useState } from 'react';
import { useBusinessDataPipeline, ScopeText } from '../components/business-data';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import type { ListingContentView, ListingDraftView, ListingHandoffPayload, ListingSection, ListingSuggestionView } from '../types';
import { toUserFacingError } from '../user-facing-error';

interface ListingReadEvidence {
  pageUrl?: string;
  screenshotPath?: string;
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

function readStatus(ok: boolean): string {
  return ok ? '已读取' : '未读取';
}

function draftSourceLabel(draft: ListingDraftView): string {
  if (draft.aiFallbackReason) return '规则 fallback';
  return draft.source === 'ai' ? 'AI' : '规则';
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

function normalizeBaseUrl(value: unknown): string {
  return readString(value).replace(/\/+$/, '');
}

function listingAiStatusFromSettings(settings: Record<string, unknown> | null | undefined): ListingAiStatus {
  if (!settings) {
    return {
      label: 'Listing AI 状态未读取',
      detail: '无法读取设置时仍可生成规则 fallback 草案，但不会声称 AI 已参与。',
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
      detail: '未配置 API Key，Listing 草案只能使用规则 fallback。',
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
      detail: lastMessage || '最近一次 AI 连接测试失败，草案会回落到规则 fallback。',
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
  const [listing, setListing] = useState<ListingContentView | null>(null);
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
  const pageMatched = Boolean(listingAsin && (!expectedAsin || listingAsin === expectedAsin));
  const titleRead = Boolean(readEvidence?.completeness?.title ?? listing?.title);
  const bulletsRead = Boolean(readEvidence?.completeness?.bullets ?? listing?.bullets?.length);
  const backendTermsRead = Boolean(readEvidence?.completeness?.backendTerms ?? listing?.backendTerms);
  const probeAsinMatched = readEvidence?.detailProbe?.asinMatched ?? true;
  const asinMatched = Boolean(pageMatched && probeAsinMatched);
  const detailProbeStatus = readEvidence?.detailProbe?.status;
  const quantReady = Boolean(data?.collection.realReportFiles.length && data?.quant.hasImportedMetrics);
  const aiDraftCount = drafts.filter((draft) => draft.source === 'ai' && !draft.aiFallbackReason).length;
  const ruleDraftCount = drafts.length - aiDraftCount;
  const listingReady = Boolean(listing && pageMatched && asinMatched && (titleRead || bulletsRead || backendTermsRead));
  const draftReady = drafts.length > 0;
  const workflowBlocker = !keywords.length
    ? '先从关键词机会带入或粘贴关键词'
    : !listingReady
      ? '先读取并核对当前领星 Listing'
      : !draftReady
        ? '下一步生成本地草案'
        : '可导出草案给运营复核';
  const handoffScope = handoffPayload?.scope;
  const handoffScopeText = handoffScope
    ? `${handoffScope.dateFrom || '-'} 至 ${handoffScope.dateTo || '-'} / ${handoffScope.storeName || '-'} / ${handoffScope.marketplaceCode || '-'} / ${handoffScope.batchId || '-'}`
    : '未从关键词机会带入';
  const handoffContext = handoffPayload?.context;

  async function readFromLingxing() {
    setLoading('read');
    setMessage(null);
    try {
      const api = (window as any).electronAPI;
      if (!api?.extractListingFromLingxing) {
        throw new Error('Listing 读取接口未暴露');
      }
      const result = await api.extractListingFromLingxing({ expectedAsin: expectedAsin || undefined });
      if (!result || result.ready === false) {
        throw new Error(result?.reason || '领星页面未返回可用 Listing 读取结果');
      }
      const content = result?.listing || result?.content || result;
      const nextListing: ListingContentView = {
        asin: content?.asin,
        title: content?.title,
        bullets: Array.isArray(content?.bullets) ? content.bullets : [],
        aPlus: content?.aPlus,
        imageCopy: content?.imageCopy,
        backendTerms: content?.backendTerms,
        source: content?.source || 'lingxing',
      };
      const blocker = getListingContentBlocker(nextListing);
      if (blocker) {
        throw new Error(blocker);
      }
      const evidence = result?.evidence || {};
      setListing({
        ...nextListing,
        pageUrl: evidence?.pageUrl || result?.pageUrl || result?.url,
        screenshotPath: evidence?.screenshotPath,
        updatedAt: content?.updatedAt,
      });
      setReadEvidence({
        pageUrl: evidence?.pageUrl || result?.pageUrl || result?.url,
        screenshotPath: evidence?.screenshotPath,
        completeness: evidence?.completeness,
        detailProbe: evidence?.detailProbe,
      });
      setMessage('已从当前领星页面读取 Listing 内容；请核对 ASIN、标题、五点和后台词。');
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
        evidence: quantReady ? '当前范围真实广告指标 + 关键词机会池' : '规则 fallback：当前范围未满足真实广告指标门槛',
        riskWarnings: quantReady ? ['需人工复核相关性'] : ['缺当前真实广告数据门槛，不能声明 AI 已验证'],
        status: 'pending',
      };
      });
      const result = await (window as any).electronAPI?.generateListingDrafts?.(suggestions);
      setDrafts(Array.isArray(result) ? result : []);
      setMessage(
        quantReady
          ? `已生成 ${Array.isArray(result) ? result.length : 0} 条 Listing 草案。草案只保存在本地，不会自动提交 Amazon。`
          : `已生成 ${Array.isArray(result) ? result.length : 0} 条规则 fallback 草案。当前范围缺真实广告数据，不能声明 AI 已验证。`,
      );
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
        description="读取 Lingxing Listing，结合关键词机会检查覆盖并生成 AI/规则标记的本地草案。不会自动提交 Amazon。"
        primaryTask="生成可导出的 Listing 草案"
        nextAction={listing ? '生成草案并导出' : '先读取 Listing'}
      />

      <div className="business-stack">
        <Panel title="Listing 工作流状态" tone={draftReady ? 'success' : keywords.length && listingReady ? 'warning' : 'default'}>
          <div className="workflow-strip workflow-strip-readonly">
            <div className="workflow-step workflow-step-static">
              <span>1 关键词机会</span>
              <strong>{keywords.length ? `${keywords.length} 个关键词已进入草案输入` : '未带入关键词'}</strong>
              <p>{handoffPayload ? '来自关键词机会页，已绑定当前业务范围。' : '可从关键词机会页带入，也可手工粘贴后复核。'}</p>
              <StatusPill tone={keywords.length ? 'ready' : 'pending'}>{keywords.length ? '已就绪' : '待输入'}</StatusPill>
            </div>
            <div className="workflow-step workflow-step-static">
              <span>2 领星 Listing 读取</span>
              <strong>{listing ? (listingReady ? '当前页面内容可用' : '已读取但需要核对') : '尚未读取当前页面'}</strong>
              <p>{listing ? `页面 ASIN：${listing.asin || '-'}，目标 ASIN：${expectedAsin || '-'}` : '必须在真实领星 Listing 页面读取标题、五点或后台词。'}</p>
              <StatusPill tone={listingReady ? 'ready' : listing ? 'warning' : 'pending'}>{listingReady ? '通过' : listing ? '待核对' : '待读取'}</StatusPill>
            </div>
            <div className="workflow-step workflow-step-static">
              <span>3 AI / 规则草案</span>
              <strong>{draftReady ? `${aiDraftCount} AI / ${ruleDraftCount} 规则` : aiStatus.label}</strong>
              <p>{quantReady ? aiStatus.detail : '缺真实广告数据时只允许规则 fallback 标记。'}</p>
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

        <Panel title="Listing 来源" tone={listing ? (pageMatched ? 'success' : 'warning') : 'blocked'}>
          <div className="business-split">
            <div>
              <div className="business-scope-line"><ScopeText scope={data?.scope || scope} /></div>
              <p className="muted-line">读取后必须核对 ASIN 是否匹配、标题、五点、后台词和页面 URL。</p>
              <p className="blocked-line">草案只保存在本地，不会自动提交 Amazon。</p>
            </div>
            <StatusPill tone={listing ? (pageMatched ? 'ready' : 'pending') : 'blocked'}>
              {listing ? (pageMatched ? 'ASIN 匹配' : '待核对 ASIN') : '未读取'}
            </StatusPill>
          </div>
          <div className="action-row">
            <button className="primary-button" disabled={loading === 'read'} onClick={readFromLingxing} type="button">
              {loading === 'read' ? '读取中...' : '从当前领星页面读取'}
            </button>
          </div>
          <div className="evidence-grid">
            <div><span>ASIN matched/status</span><strong>{listing ? `${asinMatched ? 'ASIN 匹配' : 'ASIN 待核对'}${detailProbeStatus ? ` / ${detailProbeStatus}` : ''}` : '未读取'}</strong></div>
            <div><span>Title read</span><strong>{readStatus(titleRead)}</strong></div>
            <div><span>Bullets read</span><strong>{readStatus(bulletsRead)}</strong></div>
            <div><span>Backend terms read</span><strong>{readStatus(backendTermsRead)}</strong></div>
            <div><span>Page URL</span><strong>{readEvidence?.pageUrl || listing?.pageUrl || '-'}</strong></div>
            <div><span>Screenshot path</span><strong>{readEvidence?.screenshotPath || listing?.screenshotPath || '-'}</strong></div>
          </div>
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
              <p>DeepSeek 不可用时会标记规则 fallback，不能当作 AI 已验证。</p>
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
            <div><span>后台词</span><strong>{listing?.backendTerms || '-'}</strong></div>
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

        <Panel title="关键词覆盖">
          <label className="textarea-label">
            粘贴关键词机会（逗号或换行分隔）
            <textarea value={keywordsText} onChange={(event) => setKeywordsText(event.target.value)} placeholder="keyword one&#10;keyword two" />
          </label>
          <p className="muted-line">已输入 {keywords.length} 个关键词；生成草案前请确认关键词来自当前范围的真实广告数据。当前门槛：{quantReady ? '真实广告数据可用' : '缺真实广告数据，生成时按规则 fallback 标记'}。</p>
        </Panel>

        <Panel title="本地修改建议与草案导出" tone={quantReady ? 'default' : 'warning'}>
          <div className="context-summary-grid">
            <div>
              <span>草案可信度</span>
              <strong>{quantReady ? '可引用当前广告数据' : '规则 fallback'}</strong>
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
            <button className="primary-button" disabled={!listing || loading === 'draft'} onClick={generateDrafts} type="button">
              {loading === 'draft' ? '生成中...' : quantReady ? '生成本地草案' : '生成规则 fallback 草案'}
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
