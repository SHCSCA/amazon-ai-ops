import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowsClockwise,
  Check,
  ClockCounterClockwise,
  Database,
  NotePencil,
  Plus,
  Trash,
  X,
} from '@phosphor-icons/react';
import {
  canonicalizeAmazonAsin,
  inspectAmazonAsin,
  missionControlContextKey,
  type StoreContextEnvelope,
  type StoreId,
} from '@amazon-ai-ops/shared-types';
import {
  PriorityDataTable,
  WorkbenchPanel,
  WorkspaceState,
  type PriorityDataTableColumn,
} from '../../components/workspace';
import './store-scoped-ad-listing-panel.css';

export type AdObjectKind = 'campaign' | 'ad_group' | 'target' | 'search_term';

export type StoreAdObjectFactView = {
  storeId: StoreId;
  marketplace: 'US';
  currency: 'USD';
  kind: AdObjectKind;
  objectKey: string;
  entityId?: string;
  resolved?: boolean;
  nonExecutable?: boolean;
  resolutionReason?: 'STABLE_ENTITY_ID_UNAVAILABLE';
  name: string;
  campaignName?: string;
  adGroupName?: string;
  asin?: string;
  firstDate?: string;
  lastDate?: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  acos: number;
  cpc: number;
  cvr: number;
  sourceRowCount: number;
  sourceFileCount: number;
  reportTypeCount: number;
};

export type StoreKeywordFactView = {
  storeId: StoreId;
  marketplace: 'US';
  currency: 'USD';
  keyword: string;
  asin?: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  acos: number;
  cvr: number;
  sourceRowCount: number;
  opportunityLevel?: string;
  opportunityScore?: number;
  opportunityStatus?: string;
  evidence?: string;
  riskFlags: string[];
  recommendedSections: string[];
  lastObservedAt?: string;
};

export type StoreListingContentView = {
  id: number;
  storeId: StoreId;
  storeName: string;
  marketplace: 'US';
  currency: 'USD';
  asin: string;
  asinValid: boolean;
  title: string;
  bullets: string[];
  description: string;
  aPlus: string;
  imageCopy: string;
  backendTerms: string;
  source: string;
  versionLabel: string;
  changeSummary: string;
  createdAt: string;
  updatedAt: string;
  revision: string;
};

export type StoreListingContentVersionView = {
  id: number;
  listingContentId?: number;
  storeId: StoreId;
  asin: string;
  asinValid?: boolean;
  title: string;
  bullets: string[];
  description: string;
  aPlus: string;
  imageCopy: string;
  backendTerms: string;
  source: string;
  versionLabel: string;
  changeSummary: string;
  createdAt: string;
};

export type ListingContentDraft = {
  asin: string;
  title: string;
  bulletsText: string;
  description: string;
  aPlus: string;
  imageCopy: string;
  backendTerms: string;
  source: string;
  versionLabel: string;
  changeSummary: string;
};

export type StoreAdListingRendererApi = {
  listStoreAdObjects(
    context: StoreContextEnvelope,
    input?: { kind?: AdObjectKind; query?: string; asin?: string; limit?: number },
  ): Promise<StoreAdObjectFactView[]>;
  listStoreKeywordFacts(
    context: StoreContextEnvelope,
    input?: { query?: string; asin?: string; limit?: number },
  ): Promise<StoreKeywordFactView[]>;
  listStoreListingContent(
    context: StoreContextEnvelope,
    input?: { query?: string; asin?: string; limit?: number },
  ): Promise<StoreListingContentView[]>;
  getStoreListingContent(
    context: StoreContextEnvelope,
    input: { id?: number; asin?: string },
  ): Promise<StoreListingContentView>;
  createStoreListingContent(
    context: StoreContextEnvelope,
    input: Record<string, unknown>,
  ): Promise<StoreListingContentView>;
  updateStoreListingContent(
    context: StoreContextEnvelope,
    input: { id: number; expectedRevision: string; patch: Record<string, unknown> },
  ): Promise<StoreListingContentView>;
  deleteStoreListingContent(
    context: StoreContextEnvelope,
    input: { id: number; expectedRevision: string },
  ): Promise<{ id: number; deleted: true }>;
  listStoreListingContentVersions(
    context: StoreContextEnvelope,
    input?: { listingContentId?: number; asin?: string; limit?: number; offset?: number },
  ): Promise<StoreListingContentVersionView[]>;
};

export type StoreScopedPanelProps = {
  storeContext: StoreContextEnvelope | null;
  api?: Partial<StoreAdListingRendererApi>;
};

export function storeResultBelongsToContext(
  result: { storeId?: unknown; marketplace?: unknown; currency?: unknown },
  context: StoreContextEnvelope,
): boolean {
  return result.storeId === context.storeId
    && result.marketplace === 'US'
    && result.currency === 'USD';
}

export function buildListingCreateInput(draft: ListingContentDraft): Record<string, unknown> {
  return {
    asin: canonicalizeAmazonAsin(draft.asin),
    title: draft.title.trim(),
    bullets: listingBullets(draft.bulletsText),
    description: draft.description.trim(),
    aPlus: draft.aPlus.trim(),
    imageCopy: draft.imageCopy.trim(),
    backendTerms: draft.backendTerms.trim(),
    source: draft.source.trim() || 'manual',
    versionLabel: draft.versionLabel.trim(),
    changeSummary: draft.changeSummary.trim(),
    marketplace: 'US',
    currency: 'USD',
  };
}

export function buildListingUpdateInput(
  current: StoreListingContentView,
  draft: ListingContentDraft,
): { id: number; expectedRevision: string; patch: Record<string, unknown> } {
  const create = buildListingCreateInput(draft);
  const { asin: _asin, ...patch } = create;
  return {
    id: current.id,
    expectedRevision: current.revision,
    patch,
  };
}

export const LISTING_VERSION_PAGE_SIZE = 100;

export function buildListingVersionHistoryInput(
  target: Pick<StoreListingContentView, 'id'>,
): { listingContentId: number; limit: number; offset: number } {
  return {
    listingContentId: target.id,
    limit: LISTING_VERSION_PAGE_SIZE,
    offset: 0,
  };
}

export function buildStoreListingVersionLedgerInput(
  offset = 0,
): { limit: number; offset: number } {
  return { limit: LISTING_VERSION_PAGE_SIZE, offset };
}

export async function readListingVersionHistoryForTarget(
  method: NonNullable<StoreAdListingRendererApi['listStoreListingContentVersions']>,
  context: StoreContextEnvelope,
  target: StoreListingContentView,
): Promise<StoreListingContentVersionView[]> {
  const result = await method(context, buildListingVersionHistoryInput(target));
  if (!Array.isArray(result)
    || result.some((row) => !storeListingVersionBelongsToContext(row, context, target))) {
    throw new Error('返回的版本历史与当前店铺或当前商品详情不一致');
  }
  return result;
}

export async function readStoreListingVersionLedgerPage(
  method: NonNullable<StoreAdListingRendererApi['listStoreListingContentVersions']>,
  context: StoreContextEnvelope,
  offset: number,
): Promise<StoreListingContentVersionView[]> {
  const result = await method(context, buildStoreListingVersionLedgerInput(offset));
  if (!Array.isArray(result)
    || result.some((row) => !storeListingVersionBelongsToStoreContext(row, context))) {
    throw new Error('返回的版本记录与当前店铺不一致');
  }
  return result;
}

export function StoreScopedAdObjectsPanel({ storeContext, api }: StoreScopedPanelProps) {
  const [kind, setKind] = useState<AdObjectKind>('campaign');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<StoreAdObjectFactView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : '';
  const authorityKeyRef = useRef(authorityKey);
  authorityKeyRef.current = authorityKey;

  const load = useCallback(async () => {
    if (!storeContext) return;
    const method = resolveApi(api).listStoreAdObjects;
    if (!method) {
      setRows([]);
      setError('广告对象读取服务尚未就绪，请重新打开最新版本后重试。');
      return;
    }
    const request = ++requestRef.current;
    const capturedKey = authorityKey;
    setLoading(true);
    setError(null);
    try {
      const result = await method(storeContext, {
        kind,
        query: query.trim() || undefined,
        limit: 500,
      });
      if (request !== requestRef.current || capturedKey !== authorityKeyRef.current) return;
      if (!Array.isArray(result) || result.some((row) => !storeResultBelongsToContext(row, storeContext))) {
        throw new Error('返回的广告对象与当前店铺或美国站范围不一致');
      }
      setRows(result);
    } catch (caught) {
      if (request !== requestRef.current || capturedKey !== authorityKeyRef.current) return;
      setRows([]);
      setError(userError(caught, '广告对象读取失败'));
    } finally {
      if (request === requestRef.current && capturedKey === authorityKeyRef.current) setLoading(false);
    }
  }, [api, authorityKey, kind, query, storeContext]);

  useEffect(() => {
    setRows([]);
    setError(null);
    void load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const columns = useMemo<Array<PriorityDataTableColumn<StoreAdObjectFactView>>>(() => [
    {
      key: 'object',
      header: '广告对象',
      priority: 'anchor',
      width: '30%',
      cell: (row) => (
        <span className="store-fact-primary">
          <strong>{row.name}</strong>
          <small>{objectHierarchy(row)} · {row.resolved === true && row.nonExecutable === false ? '对象已唯一识别，可用于受控动作' : '对象尚未唯一识别，不可执行'}</small>
        </span>
      ),
    },
    {
      key: 'traffic',
      header: '流量',
      priority: 'primary',
      width: '18%',
      cell: (row) => <span className="store-fact-metric"><strong>{integer(row.clicks)} 点击</strong><small>{integer(row.impressions)} 展现</small></span>,
    },
    {
      key: 'money',
      header: 'USD 产出',
      priority: 'primary',
      width: '22%',
      cell: (row) => <span className="store-fact-metric"><strong>{usd(row.spend)} / {usd(row.sales)}</strong><small>花费 / 广告销售额</small></span>,
    },
    {
      key: 'efficiency',
      header: '效率',
      priority: 'supporting',
      width: '15%',
      cell: (row) => <span className="store-fact-metric"><strong>{percent(row.acos)} ACOS</strong><small>{percent(row.cvr)} CVR</small></span>,
    },
    {
      key: 'source',
      header: '事实来源',
      priority: 'supporting',
      width: '15%',
      cell: (row) => <span className="store-fact-metric"><strong>{row.sourceRowCount} 行</strong><small>{row.sourceFileCount} 文件 · {row.firstDate || '—'}–{row.lastDate || '—'}</small></span>,
    },
  ], []);

  if (!storeContext) return <MissingStoreContext subject="广告对象" />;

  return (
    <div className="store-scoped-ad-listing-panel" data-store-fact-surface="ad-objects">
      <div className="store-fact-authority" role="note"><Database aria-hidden="true" size={15} /><strong>当前店铺</strong><span>Amazon US · USD · 只读事实</span></div>
      {error && <div className="store-fact-feedback store-fact-feedback--error" role="alert">{error}</div>}
      <WorkbenchPanel
        description="只汇总当前店铺已经入库的广告事实；不会读取同名店铺或待归属历史行。"
        status={<span>{loading ? '读取中…' : `${rows.length} 个对象`}</span>}
        title="广告对象事实"
        toolbar={(
          <>
            <label className="store-fact-filter"><span>对象层级</span><select aria-label="广告对象层级" onChange={(event) => setKind(event.target.value as AdObjectKind)} value={kind}><option value="campaign">广告活动</option><option value="ad_group">广告组</option><option value="target">关键词/投放</option><option value="search_term">搜索词</option></select></label>
            <label className="store-fact-filter"><span>查询</span><input aria-label="查询广告对象" onChange={(event) => setQuery(event.target.value)} placeholder="名称 / 广告活动" value={query} /></label>
            <button aria-busy={loading || undefined} className="workspace-button workspace-button--secondary" disabled={loading} onClick={() => void load()} type="button"><ArrowsClockwise aria-hidden="true" size={16} />刷新</button>
          </>
        )}
      >
        <PriorityDataTable
          caption="当前店铺广告对象聚合事实"
          columns={columns}
          emptyState={<WorkspaceState description="当前店铺尚无对应层级的已入库广告事实。" kind={loading ? 'loading' : 'empty'} />}
          getRowKey={(row) => row.objectKey}
          rows={rows}
        />
      </WorkbenchPanel>
    </div>
  );
}

export function StoreScopedKeywordFactsPanel({ storeContext, api }: StoreScopedPanelProps) {
  const [query, setQuery] = useState('');
  const [asin, setAsin] = useState('');
  const [rows, setRows] = useState<StoreKeywordFactView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : '';
  const authorityKeyRef = useRef(authorityKey);
  authorityKeyRef.current = authorityKey;

  const load = useCallback(async () => {
    if (!storeContext) return;
    const method = resolveApi(api).listStoreKeywordFacts;
    if (!method) {
      setRows([]);
      setError('关键词事实读取服务尚未就绪，请重新打开最新版本后重试。');
      return;
    }
    const request = ++requestRef.current;
    const capturedKey = authorityKey;
    setLoading(true);
    setError(null);
    try {
      const result = await method(storeContext, {
        query: query.trim() || undefined,
        asin: asin.trim().toUpperCase() || undefined,
        limit: 500,
      });
      if (request !== requestRef.current || capturedKey !== authorityKeyRef.current) return;
      if (!Array.isArray(result) || result.some((row) => !storeResultBelongsToContext(row, storeContext))) {
        throw new Error('返回的关键词事实与当前店铺或美国站范围不一致');
      }
      setRows(result);
    } catch (caught) {
      if (request !== requestRef.current || capturedKey !== authorityKeyRef.current) return;
      setRows([]);
      setError(userError(caught, '关键词事实读取失败'));
    } finally {
      if (request === requestRef.current && capturedKey === authorityKeyRef.current) setLoading(false);
    }
  }, [api, asin, authorityKey, query, storeContext]);

  useEffect(() => {
    setRows([]);
    setError(null);
    void load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const columns = useMemo<Array<PriorityDataTableColumn<StoreKeywordFactView>>>(() => [
    {
      key: 'keyword',
      header: '关键词事实',
      priority: 'anchor',
      width: '28%',
      cell: (row) => <span className="store-fact-primary"><strong>{row.keyword}</strong><small>{row.asin || '全店'} · {row.opportunityStatus || '仅指标'}</small></span>,
    },
    {
      key: 'opportunity',
      header: '机会',
      priority: 'primary',
      width: '15%',
      cell: (row) => <span className={`store-fact-opportunity store-fact-opportunity--${row.opportunityLevel || 'none'}`}><strong>{opportunityLabel(row.opportunityLevel)}</strong><small>{row.opportunityScore === undefined ? '无评分' : `评分 ${row.opportunityScore.toFixed(2)}`}</small></span>,
    },
    {
      key: 'traffic',
      header: '点击 / 订单',
      priority: 'primary',
      width: '15%',
      cell: (row) => <span className="store-fact-metric"><strong>{integer(row.clicks)} / {integer(row.orders)}</strong><small>{integer(row.impressions)} 展现</small></span>,
    },
    {
      key: 'money',
      header: '花费 / 销售额',
      priority: 'primary',
      width: '20%',
      cell: (row) => <span className="store-fact-metric"><strong>{usd(row.spend)} / {usd(row.sales)}</strong><small>{percent(row.acos)} ACOS</small></span>,
    },
    {
      key: 'placement',
      header: '建议位置',
      priority: 'supporting',
      width: '22%',
      cell: (row) => <span className="store-fact-metric"><strong>{row.recommendedSections.join('、') || '待复核'}</strong><small>{row.riskFlags.join('、') || `${row.sourceRowCount} 行真实指标`}</small></span>,
    },
  ], []);

  if (!storeContext) return <MissingStoreContext subject="关键词事实" />;

  return (
    <div className="store-scoped-ad-listing-panel" data-store-fact-surface="keyword-facts">
      <div className="store-fact-authority" role="note"><Database aria-hidden="true" size={15} /><strong>当前店铺</strong><span>Amazon US · USD · 指标与机会合并</span></div>
      {error && <div className="store-fact-feedback store-fact-feedback--error" role="alert">{error}</div>}
      <WorkbenchPanel
        description="把当前店铺 keyword_metrics 与 keyword_opportunities 合并；待归属历史行不会进入结果。"
        status={<span>{loading ? '读取中…' : `${rows.length} 个关键词`}</span>}
        title="关键词事实与机会"
        toolbar={(
          <>
            <label className="store-fact-filter"><span>ASIN</span><input aria-label="按 ASIN 筛选关键词" onChange={(event) => setAsin(event.target.value)} placeholder="可选" value={asin} /></label>
            <label className="store-fact-filter"><span>关键词</span><input aria-label="查询关键词" onChange={(event) => setQuery(event.target.value)} placeholder="词根" value={query} /></label>
            <button aria-busy={loading || undefined} className="workspace-button workspace-button--secondary" disabled={loading} onClick={() => void load()} type="button"><ArrowsClockwise aria-hidden="true" size={16} />刷新</button>
          </>
        )}
      >
        <PriorityDataTable
          caption="当前店铺关键词指标与机会"
          columns={columns}
          emptyState={<WorkspaceState description="当前店铺尚无匹配的真实关键词事实。" kind={loading ? 'loading' : 'empty'} />}
          getRowKey={(row) => `${row.asin || ''}:${row.keyword}`}
          rows={rows}
        />
      </WorkbenchPanel>
    </div>
  );
}

type ListingEditor = {
  current: StoreListingContentView | null;
  draft: ListingContentDraft;
};

type ListingVersionHistory = {
  target: StoreListingContentView;
  rows: StoreListingContentVersionView[];
  selectedId: number | null;
  loading: boolean;
  error: string | null;
};

type StoreListingVersionLedger = {
  rows: StoreListingContentVersionView[];
  selectedId: number | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  nextOffset: number;
  hasMore: boolean;
};

export function storeListingVersionBelongsToStoreContext(
  version: StoreListingContentVersionView,
  context: StoreContextEnvelope,
): boolean {
  return version.storeId === context.storeId;
}

export function storeListingVersionBelongsToContext(
  version: StoreListingContentVersionView,
  context: StoreContextEnvelope,
  target: StoreListingContentView,
): boolean {
  const sameListing = version.listingContentId === undefined
    || version.listingContentId === target.id;
  return version.storeId === context.storeId
    && sameListing
    && version.asin.trim().toUpperCase() === target.asin.trim().toUpperCase();
}

export function listingVersionResponseIsCurrent(
  request: number,
  latestRequest: number,
  capturedAuthorityKey: string,
  currentAuthorityKey: string,
): boolean {
  return request === latestRequest && capturedAuthorityKey === currentAuthorityKey;
}

type ListingRowActionsProps = {
  row: StoreListingContentView;
  pending: boolean;
  onHistory(): void;
  onEdit(): void;
  onDelete(): void;
};

export function ListingRowActions({ row, pending, onHistory, onEdit, onDelete }: ListingRowActionsProps) {
  const readOnly = row.asinValid === false;
  return (
    <span className="store-fact-row-actions">
      <button aria-label={`查看 ${row.asin} 版本历史`} className="workspace-button workspace-button--secondary" disabled={pending} onClick={onHistory} type="button"><ClockCounterClockwise aria-hidden="true" size={15} />版本</button>
      <button aria-label={`编辑 ${row.asin}`} className="workspace-button workspace-button--secondary" disabled={pending || readOnly} onClick={onEdit} title={readOnly ? '历史 ASIN 无效，需先完成数据对账' : undefined} type="button"><NotePencil aria-hidden="true" size={15} />编辑</button>
      <button aria-label={`删除 ${row.asin}`} className="workspace-button workspace-button--danger" disabled={pending || readOnly} onClick={onDelete} title={readOnly ? '历史 ASIN 无效，仅供对账，禁止删除' : undefined} type="button"><Trash aria-hidden="true" size={15} />删除</button>
      {readOnly && <small aria-label={`${row.asin} 只读原因`}>非法 ASIN · 只读</small>}
    </span>
  );
}

export function StoreScopedListingContentPanel({ storeContext, api }: StoreScopedPanelProps) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<StoreListingContentView[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editor, setEditor] = useState<ListingEditor | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StoreListingContentView | null>(null);
  const [versionHistory, setVersionHistory] = useState<ListingVersionHistory | null>(null);
  const [versionLedger, setVersionLedger] = useState<StoreListingVersionLedger | null>(null);
  const requestRef = useRef(0);
  const mutationRef = useRef(0);
  const versionRequestRef = useRef(0);
  const ledgerRequestRef = useRef(0);
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : '';
  const authorityKeyRef = useRef(authorityKey);
  authorityKeyRef.current = authorityKey;

  const load = useCallback(async () => {
    if (!storeContext) return;
    const method = resolveApi(api).listStoreListingContent;
    if (!method) {
      setRows([]);
      setError('商品详情读取服务尚未就绪，请重新打开最新版本后重试。');
      return;
    }
    const request = ++requestRef.current;
    const capturedKey = authorityKey;
    setLoading(true);
    setError(null);
    try {
      const result = await method(storeContext, { query: query.trim() || undefined, limit: 250 });
      if (request !== requestRef.current || capturedKey !== authorityKeyRef.current) return;
      if (!Array.isArray(result) || result.some((row) => !storeResultBelongsToContext(row, storeContext))) {
        throw new Error('返回的商品详情与当前店铺或美国站范围不一致');
      }
      setRows(result);
    } catch (caught) {
      if (request !== requestRef.current || capturedKey !== authorityKeyRef.current) return;
      setRows([]);
      setError(userError(caught, 'Listing 内容读取失败'));
    } finally {
      if (request === requestRef.current && capturedKey === authorityKeyRef.current) setLoading(false);
    }
  }, [api, authorityKey, query, storeContext]);

  useEffect(() => {
    setRows([]);
    setEditor(null);
    setConfirmDelete(null);
    setVersionHistory(null);
    setVersionLedger(null);
    setError(null);
    setFeedback(null);
    setPending(null);
    void load();
    return () => {
      requestRef.current += 1;
      mutationRef.current += 1;
      versionRequestRef.current += 1;
      ledgerRequestRef.current += 1;
    };
  }, [load]);

  const openVersionHistory = useCallback(async (target: StoreListingContentView) => {
    if (!storeContext) return;
    const method = resolveApi(api).listStoreListingContentVersions;
    const request = ++versionRequestRef.current;
    const capturedKey = authorityKey;
    setVersionHistory({
      target,
      rows: [],
      selectedId: null,
      loading: true,
      error: null,
    });
    if (!method) {
      setVersionHistory((current) => current?.target.id === target.id
        ? { ...current, loading: false, error: '版本历史读取服务尚未就绪，请重新打开最新版本后重试。' }
        : current);
      return;
    }
    try {
      const result = await readListingVersionHistoryForTarget(method, storeContext, target);
      if (!listingVersionResponseIsCurrent(
        request,
        versionRequestRef.current,
        capturedKey,
        authorityKeyRef.current,
      )) return;
      setVersionHistory({
        target,
        rows: result,
        selectedId: result[0]?.id ?? null,
        loading: false,
        error: null,
      });
    } catch (caught) {
      if (!listingVersionResponseIsCurrent(
        request,
        versionRequestRef.current,
        capturedKey,
        authorityKeyRef.current,
      )) return;
      setVersionHistory({
        target,
        rows: [],
        selectedId: null,
        loading: false,
        error: userError(caught, 'Listing 版本历史读取失败'),
      });
    }
  }, [api, authorityKey, storeContext]);

  const closeVersionHistory = () => {
    versionRequestRef.current += 1;
    setVersionHistory(null);
  };

  const loadVersionLedger = useCallback(async (offset: number, replace: boolean) => {
    if (!storeContext) return;
    const method = resolveApi(api).listStoreListingContentVersions;
    const request = ++ledgerRequestRef.current;
    const capturedKey = authorityKey;
    if (replace) {
      setVersionLedger({
        rows: [],
        selectedId: null,
        loading: true,
        loadingMore: false,
        error: null,
        nextOffset: 0,
        hasMore: false,
      });
    } else {
      setVersionLedger((current) => current
        ? { ...current, loadingMore: true, error: null }
        : current);
    }
    if (!method) {
      setVersionLedger((current) => current
        ? {
          ...current,
          loading: false,
          loadingMore: false,
          error: '版本记录读取服务尚未就绪，请重新打开最新版本后重试。',
        }
        : current);
      return;
    }
    try {
      const result = await readStoreListingVersionLedgerPage(method, storeContext, offset);
      if (!listingVersionResponseIsCurrent(
        request,
        ledgerRequestRef.current,
        capturedKey,
        authorityKeyRef.current,
      )) return;
      setVersionLedger((current) => {
        const rows = replace ? result : [...(current?.rows ?? []), ...result];
        return {
          rows,
          selectedId: current?.selectedId ?? rows[0]?.id ?? null,
          loading: false,
          loadingMore: false,
          error: null,
          nextOffset: offset + result.length,
          hasMore: result.length === LISTING_VERSION_PAGE_SIZE,
        };
      });
    } catch (caught) {
      if (!listingVersionResponseIsCurrent(
        request,
        ledgerRequestRef.current,
        capturedKey,
        authorityKeyRef.current,
      )) return;
      setVersionLedger((current) => current
        ? {
          ...current,
          loading: false,
          loadingMore: false,
          error: userError(caught, 'Listing 版本账本读取失败'),
        }
        : current);
    }
  }, [api, authorityKey, storeContext]);

  const openVersionLedger = () => {
    versionRequestRef.current += 1;
    setVersionHistory(null);
    void loadVersionLedger(0, true);
  };

  const closeVersionLedger = () => {
    ledgerRequestRef.current += 1;
    setVersionLedger(null);
  };

  const save = async () => {
    if (!storeContext || !editor) return;
    const rendererApi = resolveApi(api);
    const method = editor.current
      ? rendererApi.updateStoreListingContent
      : rendererApi.createStoreListingContent;
    if (!method) {
      setError(`商品详情${editor.current ? '更新' : '创建'}服务尚未就绪，请重新打开最新版本后重试。`);
      return;
    }
    if (!inspectAmazonAsin(editor.draft.asin).valid) {
      setError('ASIN 必须是 10 位 ASCII 字母或数字。');
      return;
    }
    setPending('save');
    setError(null);
    setFeedback(null);
    const mutation = ++mutationRef.current;
    const capturedKey = authorityKey;
    try {
      const result = editor.current
        ? await rendererApi.updateStoreListingContent!(
          storeContext,
          buildListingUpdateInput(editor.current, editor.draft),
        )
        : await rendererApi.createStoreListingContent!(
          storeContext,
          buildListingCreateInput(editor.draft),
        );
      if (mutation !== mutationRef.current || capturedKey !== authorityKeyRef.current) return;
      if (!storeResultBelongsToContext(result, storeContext)) {
        throw new Error('返回的商品详情与当前店铺或美国站范围不一致');
      }
      setEditor(null);
      setFeedback(`${result.asin} 已保存到当前店铺，本地内容不会自动发布到 Amazon。`);
      await load();
    } catch (caught) {
      if (mutation !== mutationRef.current || capturedKey !== authorityKeyRef.current) return;
      setError(userError(caught, 'Listing 保存失败'));
    } finally {
      if (mutation === mutationRef.current && capturedKey === authorityKeyRef.current) setPending(null);
    }
  };

  const remove = async () => {
    if (!storeContext || !confirmDelete) return;
    if (confirmDelete.asinValid === false) {
      setConfirmDelete(null);
      setError('历史非法 ASIN 仅供对账，不能编辑或删除。');
      return;
    }
    const method = resolveApi(api).deleteStoreListingContent;
    if (!method) {
      setError('商品详情删除服务尚未就绪，请重新打开最新版本后重试。');
      return;
    }
    setPending('delete');
    setError(null);
    setFeedback(null);
    const mutation = ++mutationRef.current;
    const capturedKey = authorityKey;
    try {
      await method(storeContext, {
        id: confirmDelete.id,
        expectedRevision: confirmDelete.revision,
      });
      if (mutation !== mutationRef.current || capturedKey !== authorityKeyRef.current) return;
      setConfirmDelete(null);
      setFeedback(`${confirmDelete.asin} 已从当前店铺内容库删除；历史版本仍保留。`);
      await load();
    } catch (caught) {
      if (mutation !== mutationRef.current || capturedKey !== authorityKeyRef.current) return;
      setError(userError(caught, 'Listing 删除失败'));
    } finally {
      if (mutation === mutationRef.current && capturedKey === authorityKeyRef.current) setPending(null);
    }
  };

  const columns = useMemo<Array<PriorityDataTableColumn<StoreListingContentView>>>(() => [
    {
      key: 'listing',
      header: 'ASIN / 标题',
      priority: 'anchor',
      width: '34%',
      cell: (row) => <span className="store-fact-primary"><strong>{row.asin}</strong><small>{row.asinValid === false ? '历史 ASIN 无效 · 只读待对账' : row.title || '标题待补齐'}</small></span>,
    },
    {
      key: 'coverage',
      header: '内容完整度',
      priority: 'primary',
      width: '18%',
      cell: (row) => <span className="store-fact-metric"><strong>{listingCoverage(row)}/5 项</strong><small>{row.bullets.length} 条 Bullet · {row.backendTerms ? '有后台词' : '无后台词'}</small></span>,
    },
    {
      key: 'version',
      header: '版本',
      priority: 'supporting',
      width: '18%',
      cell: (row) => <span className="store-fact-metric"><strong>{row.versionLabel || '未标版本'}</strong><small>{row.updatedAt || '—'}</small></span>,
    },
    {
      key: 'actions',
      header: '操作',
      priority: 'action',
      width: '30%',
      align: 'end',
      cell: (row) => (
        <ListingRowActions
          onDelete={() => setConfirmDelete(row)}
          onEdit={() => setEditor({ current: row, draft: listingDraft(row) })}
          onHistory={() => void openVersionHistory(row)}
          pending={Boolean(pending)}
          row={row}
        />
      ),
    },
  ], [openVersionHistory, pending]);

  if (!storeContext) return <MissingStoreContext subject="Listing 内容" />;

  return (
    <div className="store-scoped-ad-listing-panel" data-store-fact-surface="listing-content">
      <div className="store-fact-authority" role="note"><Database aria-hidden="true" size={15} /><strong>当前店铺</strong><span>Amazon US · USD · 本地内容库</span></div>
      {error && <div className="store-fact-feedback store-fact-feedback--error" role="alert">{error}</div>}
      {feedback && <div className="store-fact-feedback store-fact-feedback--success" role="status">{feedback}</div>}
      <WorkbenchPanel
        description="Listing 内容按当前店铺与 ASIN 管理；更新、删除必须通过界面读取版本的并发校验。"
        status={<span>{loading ? '读取中…' : `${rows.length} 个 Listing`}</span>}
        title="Listing 内容库"
        toolbar={(
          <>
            <label className="store-fact-filter"><span>查询</span><input aria-label="查询 Listing" onChange={(event) => setQuery(event.target.value)} placeholder="ASIN / 标题" value={query} /></label>
            <button aria-busy={loading || undefined} className="workspace-button workspace-button--secondary" disabled={loading || Boolean(pending)} onClick={() => void load()} type="button"><ArrowsClockwise aria-hidden="true" size={16} />刷新</button>
            <button aria-label="查看当前店铺 Listing 版本账本" className="workspace-button workspace-button--secondary" disabled={Boolean(pending)} onClick={openVersionLedger} type="button"><ClockCounterClockwise aria-hidden="true" size={16} />版本账本</button>
            <button className="workspace-button workspace-button--primary" disabled={Boolean(pending)} onClick={() => setEditor({ current: null, draft: emptyListingDraft() })} type="button"><Plus aria-hidden="true" size={16} />新建 Listing</button>
          </>
        )}
      >
        <PriorityDataTable
          caption="当前店铺 Listing 内容"
          columns={columns}
          emptyState={<WorkspaceState description="当前店铺尚无 Listing 内容，可新建后用于本地分析与草案。" kind={loading ? 'loading' : 'empty'} />}
          getRowKey={(row) => row.id}
          rows={rows}
        />
      </WorkbenchPanel>

      {versionHistory && (
        <ListingVersionHistoryDialog
          error={versionHistory.error}
          loading={versionHistory.loading}
          onClose={closeVersionHistory}
          onRetry={() => void openVersionHistory(versionHistory.target)}
          onSelect={(selectedId) => setVersionHistory((current) => current
            ? { ...current, selectedId }
            : current)}
          rows={versionHistory.rows}
          selectedId={versionHistory.selectedId}
          target={versionHistory.target}
        />
      )}

      {versionLedger && (
        <StoreListingVersionLedgerDialog
          error={versionLedger.error}
          hasMore={versionLedger.hasMore}
          loading={versionLedger.loading}
          loadingMore={versionLedger.loadingMore}
          onClose={closeVersionLedger}
          onLoadMore={() => void loadVersionLedger(versionLedger.nextOffset, false)}
          onRetry={() => void loadVersionLedger(0, true)}
          onSelect={(selectedId) => setVersionLedger((current) => current
            ? { ...current, selectedId }
            : current)}
          rows={versionLedger.rows}
          selectedId={versionLedger.selectedId}
          storeContext={storeContext}
        />
      )}

      {editor && (
        <div className="store-fact-dialog-backdrop">
          <section aria-labelledby="store-listing-editor-title" aria-modal="true" className="store-fact-dialog" role="dialog">
            <header><div><span>STORE-SCOPED LISTING</span><h2 id="store-listing-editor-title">{editor.current ? `编辑 ${editor.current.asin}` : '新建美国站 Listing'}</h2><p>内容只保存在当前店铺本地数据库；不会自动提交 Amazon 或改写领星。</p></div><button aria-label="关闭 Listing 编辑器" disabled={Boolean(pending)} onClick={() => setEditor(null)} type="button"><X aria-hidden="true" size={18} /></button></header>
            <div className="store-listing-form">
              <label><span>ASIN *</span><input autoFocus disabled={Boolean(editor.current)} onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, asin: event.target.value } } : current)} value={editor.draft.asin} /></label>
              <label><span>版本标签</span><input onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, versionLabel: event.target.value } } : current)} placeholder="例如 2026-07-22-v1" value={editor.draft.versionLabel} /></label>
              <label className="store-listing-form__wide"><span>标题</span><textarea onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, title: event.target.value } } : current)} rows={2} value={editor.draft.title} /></label>
              <label className="store-listing-form__wide"><span>Bullet Points（每行一条）</span><textarea onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, bulletsText: event.target.value } } : current)} rows={6} value={editor.draft.bulletsText} /></label>
              <label className="store-listing-form__wide"><span>产品描述</span><textarea onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, description: event.target.value } } : current)} rows={4} value={editor.draft.description} /></label>
              <label className="store-listing-form__wide"><span>A+ 内容</span><textarea onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, aPlus: event.target.value } } : current)} rows={3} value={editor.draft.aPlus} /></label>
              <label className="store-listing-form__wide"><span>图片文案</span><textarea onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, imageCopy: event.target.value } } : current)} rows={3} value={editor.draft.imageCopy} /></label>
              <label className="store-listing-form__wide"><span>后台搜索词</span><textarea onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, backendTerms: event.target.value } } : current)} rows={2} value={editor.draft.backendTerms} /></label>
              <label><span>内容来源</span><select onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, source: event.target.value } } : current)} value={editor.draft.source}><option value="manual">人工录入</option><option value="lingxing">领星读取</option><option value="import">本地导入</option></select></label>
              <label className="store-listing-form__wide"><span>变更说明</span><textarea onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, changeSummary: event.target.value } } : current)} rows={2} value={editor.draft.changeSummary} /></label>
            </div>
            <footer><button className="workspace-button workspace-button--secondary" disabled={Boolean(pending)} onClick={() => setEditor(null)} type="button">取消</button><button aria-busy={pending === 'save' || undefined} className="workspace-button workspace-button--primary" disabled={Boolean(pending)} onClick={() => void save()} type="button"><Check aria-hidden="true" size={16} />{pending === 'save' ? '保存中…' : '保存 Listing'}</button></footer>
          </section>
        </div>
      )}

      {confirmDelete && (
        <div className="store-fact-dialog-backdrop"><section aria-labelledby="store-listing-delete-title" aria-modal="true" className="store-fact-dialog store-fact-dialog--confirm" role="alertdialog"><header><div><span>删除商品内容</span><h2 id="store-listing-delete-title">删除 {confirmDelete.asin}？</h2><p>当前内容行会删除，版本历史保留；本机安全进程会通过版本校验阻止覆盖并发修改。</p></div></header><footer><button className="workspace-button workspace-button--secondary" disabled={Boolean(pending)} onClick={() => setConfirmDelete(null)} type="button">取消</button><button aria-busy={pending === 'delete' || undefined} className="workspace-button workspace-button--danger" disabled={Boolean(pending)} onClick={() => void remove()} type="button"><Trash aria-hidden="true" size={16} />{pending === 'delete' ? '删除中…' : '确认删除'}</button></footer></section></div>
      )}
    </div>
  );
}

type ListingVersionHistoryDialogProps = {
  target: StoreListingContentView;
  rows: StoreListingContentVersionView[];
  selectedId: number | null;
  loading: boolean;
  error: string | null;
  onSelect(selectedId: number): void;
  onRetry(): void;
  onClose(): void;
};

export function ListingVersionHistoryDialog({
  target,
  rows,
  selectedId,
  loading,
  error,
  onSelect,
  onRetry,
  onClose,
}: ListingVersionHistoryDialogProps) {
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const visibleError = error ? userError(error, '版本历史读取失败') : null;
  return (
    <div className="store-fact-dialog-backdrop">
      <section aria-labelledby="store-listing-version-title" aria-modal="true" className="store-fact-dialog" role="dialog">
        <header>
          <div>
            <span>当前店铺版本历史</span>
            <h2 id="store-listing-version-title">{target.asin} 版本历史</h2>
            <p>当前店铺 · Amazon US · USD · 历史快照只读，不会提交 Amazon 或改写领星。</p>
          </div>
          <button aria-label="关闭 Listing 版本历史" onClick={onClose} type="button"><X aria-hidden="true" size={18} /></button>
        </header>
        <div className="store-listing-form">
          {loading ? (
            <div className="store-listing-form__wide"><WorkspaceState description="正在读取当前店铺的 Listing 版本历史。" kind="loading" title="读取版本历史" /></div>
          ) : visibleError ? (
            <div className="store-listing-form__wide">
              <div className="store-fact-feedback store-fact-feedback--error" role="alert">{visibleError}</div>
              <button className="workspace-button workspace-button--secondary" onClick={onRetry} type="button"><ArrowsClockwise aria-hidden="true" size={16} />重试</button>
            </div>
          ) : rows.length === 0 ? (
            <div className="store-listing-form__wide"><WorkspaceState description="当前 Listing 尚无已保存的历史快照。" kind="empty" title="暂无版本历史" /></div>
          ) : (
            <>
              <section aria-label="版本列表">
                {rows.map((row) => (
                  <button
                    aria-pressed={selected?.id === row.id}
                    className={`workspace-button ${selected?.id === row.id ? 'workspace-button--primary' : 'workspace-button--secondary'}`}
                    key={row.id}
                    onClick={() => onSelect(row.id)}
                    type="button"
                  >
                    <span className="store-fact-primary">
                      <strong>{row.versionLabel || '未命名版本'}</strong>
                      <small>{row.createdAt || '时间未知'} · {listingSourceLabel(row.source)}</small>
                      <small>{row.changeSummary || '未填写变更说明'}</small>
                    </span>
                  </button>
                ))}
              </section>
              {selected && (
                <section aria-label="版本快照">
                  <span className="store-fact-primary"><strong>标题</strong><small>{selected.title || '未填写标题'}</small></span>
                  <span className="store-fact-primary"><strong>商品要点</strong><small>{selected.bullets.length > 0 ? selected.bullets.join('；') : '未填写商品要点'}</small></span>
                  <span className="store-fact-primary"><strong>后台搜索词</strong><small>{selected.backendTerms || '未填写后台搜索词'}</small></span>
                  <span className="store-fact-primary"><strong>来源与变更</strong><small>{listingSourceLabel(selected.source)} · {selected.changeSummary || '未填写变更说明'}</small></span>
                </section>
              )}
            </>
          )}
        </div>
        <footer><button className="workspace-button workspace-button--secondary" onClick={onClose} type="button">关闭</button></footer>
      </section>
    </div>
  );
}

type StoreListingVersionLedgerDialogProps = {
  storeContext: StoreContextEnvelope;
  rows: StoreListingContentVersionView[];
  selectedId: number | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  onSelect(selectedId: number): void;
  onRetry(): void;
  onLoadMore(): void;
  onClose(): void;
};

export function StoreListingVersionLedgerDialog({
  storeContext,
  rows,
  selectedId,
  loading,
  loadingMore,
  error,
  hasMore,
  onSelect,
  onRetry,
  onLoadMore,
  onClose,
}: StoreListingVersionLedgerDialogProps) {
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const visibleError = error ? userError(error, '版本记录读取失败') : null;
  return (
    <div className="store-fact-dialog-backdrop">
      <section aria-labelledby="store-listing-ledger-title" aria-modal="true" className="store-fact-dialog" role="dialog">
        <header>
          <div>
            <span>当前店铺版本记录</span>
            <h2 id="store-listing-ledger-title">当前店铺 Listing 版本账本</h2>
            <p>当前店铺 · Amazon US · USD · 已删除 Listing 的历史快照也会保留在这里。</p>
          </div>
          <button aria-label="关闭 Listing 版本账本" onClick={onClose} type="button"><X aria-hidden="true" size={18} /></button>
        </header>
        <div className="store-listing-form store-listing-version-layout">
          {loading ? (
            <div className="store-listing-form__wide"><WorkspaceState description="正在读取当前店铺的 Listing 版本账本。" kind="loading" title="读取版本账本" /></div>
          ) : visibleError && rows.length === 0 ? (
            <div className="store-listing-form__wide">
              <div className="store-fact-feedback store-fact-feedback--error" role="alert">{visibleError}</div>
              <button className="workspace-button workspace-button--secondary" onClick={onRetry} type="button"><ArrowsClockwise aria-hidden="true" size={16} />重试</button>
            </div>
          ) : rows.length === 0 ? (
            <div className="store-listing-form__wide"><WorkspaceState description="当前店铺尚无已保存的 Listing 历史快照。" kind="empty" title="版本账本为空" /></div>
          ) : (
            <>
              <section aria-label="店铺版本账本列表" className="store-listing-version-list">
                <div className="store-listing-ledger-meta" role="status">已读取 {rows.length} 条历史快照</div>
                {rows.map((row) => (
                  <button
                    aria-label={`查看 ${row.asin} 的 ${row.versionLabel || '未命名版本'}`}
                    aria-pressed={selected?.id === row.id}
                    className={`workspace-button ${selected?.id === row.id ? 'workspace-button--primary' : 'workspace-button--secondary'}`}
                    key={row.id}
                    onClick={() => onSelect(row.id)}
                    type="button"
                  >
                    <span className="store-fact-primary">
                      <strong>{row.asin} · {row.versionLabel || '未命名版本'}</strong>
                      <small>{row.createdAt || '时间未知'} · {listingSourceLabel(row.source)}</small>
                      <small>{row.changeSummary || '未填写变更说明'}</small>
                    </span>
                  </button>
                ))}
                {visibleError && <div className="store-fact-feedback store-fact-feedback--error" role="alert">{visibleError}</div>}
                {hasMore && (
                  <button
                    aria-busy={loadingMore || undefined}
                    className="workspace-button workspace-button--secondary"
                    disabled={loadingMore}
                    onClick={onLoadMore}
                    type="button"
                  >
                    <ArrowsClockwise aria-hidden="true" size={16} />{loadingMore ? '加载中…' : '加载更多历史'}
                  </button>
                )}
              </section>
              {selected && (
                <section aria-label="店铺版本账本快照" className="store-listing-version-snapshot">
                  <span className="store-fact-primary"><strong>ASIN / 历史对象</strong><small>{selected.asin} · {selected.listingContentId ? '已关联历史版本' : '已解除关联'}</small></span>
                  <span className="store-fact-primary"><strong>标题</strong><small>{selected.title || '未填写标题'}</small></span>
                  <span className="store-fact-primary"><strong>商品要点</strong><small>{selected.bullets.length > 0 ? selected.bullets.join('；') : '未填写商品要点'}</small></span>
                  <span className="store-fact-primary"><strong>后台搜索词</strong><small>{selected.backendTerms || '未填写后台搜索词'}</small></span>
                  <span className="store-fact-primary"><strong>来源与变更</strong><small>{listingSourceLabel(selected.source)} · {selected.changeSummary || '未填写变更说明'}</small></span>
                </section>
              )}
            </>
          )}
        </div>
        <footer><button className="workspace-button workspace-button--secondary" onClick={onClose} type="button">关闭</button></footer>
      </section>
    </div>
  );
}

function MissingStoreContext({ subject }: { subject: string }) {
  return (
    <div className="store-scoped-ad-listing-panel">
      <WorkspaceState
        description={`当前店铺信息尚未完整确认，${subject}读取已停止。请刷新店铺状态后重试。`}
        kind="blocked"
        title="当前店铺尚未确认"
      />
    </div>
  );
}

function resolveApi(api?: Partial<StoreAdListingRendererApi>): Partial<StoreAdListingRendererApi> {
  if (api) return api;
  if (typeof window === 'undefined') return {};
  return (window as unknown as { electronAPI?: Partial<StoreAdListingRendererApi> }).electronAPI ?? {};
}

function emptyListingDraft(): ListingContentDraft {
  return {
    asin: '',
    title: '',
    bulletsText: '',
    description: '',
    aPlus: '',
    imageCopy: '',
    backendTerms: '',
    source: 'manual',
    versionLabel: '',
    changeSummary: '',
  };
}

function listingDraft(row: StoreListingContentView): ListingContentDraft {
  return {
    asin: row.asin,
    title: row.title,
    bulletsText: row.bullets.join('\n'),
    description: row.description,
    aPlus: row.aPlus,
    imageCopy: row.imageCopy,
    backendTerms: row.backendTerms,
    source: row.source || 'manual',
    versionLabel: row.versionLabel,
    changeSummary: row.changeSummary,
  };
}

function listingBullets(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function listingCoverage(row: StoreListingContentView): number {
  return [row.title, row.bullets.length > 0, row.description, row.imageCopy, row.backendTerms]
    .filter(Boolean).length;
}

function listingSourceLabel(source: string): string {
  if (source === 'manual') return '人工录入';
  if (source === 'lingxing') return '领星读取';
  if (source === 'import') return '本地导入';
  return source.trim() || '来源未知';
}

function objectHierarchy(row: StoreAdObjectFactView): string {
  const parents = [row.campaignName, row.adGroupName]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  return [...parents, row.asin].filter(Boolean).join(' · ') || '当前店铺';
}

function opportunityLabel(level?: string): string {
  if (level === 'high') return '高机会';
  if (level === 'medium') return '中机会';
  if (level === 'low') return '低机会';
  return '仅指标';
}

function usd(value: unknown): string {
  const numeric = Number(value);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format(Number.isFinite(numeric) ? numeric : 0);
}

function integer(value: unknown): string {
  const numeric = Number(value);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
    .format(Number.isFinite(numeric) ? numeric : 0);
}

function percent(value: unknown): string {
  const numeric = Number(value);
  return `${((Number.isFinite(numeric) ? numeric : 0) * 100).toFixed(1)}%`;
}

function userError(caught: unknown, fallback: string): string {
  const message = caught instanceof Error
    ? caught.message.trim()
    : typeof caught === 'string'
      ? caught.trim()
      : '';
  const internalCopy = /Main|StoreContext|Authority|Renderer|Profile|Mission|Decision|Experiment|UNKNOWN|revision|draft|set_keyword_bid|manifest|fingerprint|dry-run|CRUD|PRODUCTION_NATIVE|PROTOTYPE_ONLY|LEGACY_ADAPTER|sequence|append-only|correction|READBACK|EFFECT|remote method|store-ad-listing/i;
  if (!message || internalCopy.test(message)) {
    return `${fallback}：当前店铺数据校验未通过，请刷新后重试。`;
  }
  if (/请.+重试。?$/.test(message)) return message;
  return `${fallback}：${message.replace(/[。；;:]?$/, '')}。请刷新后重试。`;
}
