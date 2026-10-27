import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsClockwise, Database } from '@phosphor-icons/react';
import { missionControlContextKey } from '@amazon-ai-ops/shared-types';
import { PriorityDataTable, WorkbenchPanel, WorkspaceState, type PriorityDataTableColumn } from '../../components/workspace';
import { type StoreScopedPanelProps, type StoreKeywordFactView } from "./store-scoped-ad-listing-contracts";
import { resolveApi, storeResultBelongsToContext, userError, opportunityLabel, integer, usd, percent } from "./store-scoped-ad-listing-values";
import { MissingStoreContext } from "./store-scoped-panel-view";
import { WorkspaceActionButton } from '../../components/workspace/action-feedback';
import { useWorkspaceOperation } from '../../components/workspace/use-workspace-operation';
import { rendererRuntimeLog } from '../../runtime-log';

export function StoreScopedKeywordFactsPanel({ storeContext, api }: StoreScopedPanelProps) {
  const [query, setQuery] = useState('');
  const [asin, setAsin] = useState('');
  const [rows, setRows] = useState<StoreKeywordFactView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : '';
  const operationKey = `${authorityKey}|${asin}|${query}`;
  const operation = useWorkspaceOperation(operationKey);
  const authorityKeyRef = useRef(authorityKey);
  authorityKeyRef.current = authorityKey;

  const load = useCallback(async () => {
    if (!storeContext) return;
    const isCurrent = operation.capture();
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
      if (!isCurrent() || request !== requestRef.current || capturedKey !== authorityKeyRef.current) return;
      if (!Array.isArray(result) || result.some((row) => !storeResultBelongsToContext(row, storeContext))) {
        throw new Error('返回的关键词事实与当前店铺或美国站范围不一致');
      }
      setRows(result);
    } catch (caught) {
      rendererRuntimeLog.error('objects.keyword_facts_load_failed', { error: caught });
      if (!isCurrent() || request !== requestRef.current || capturedKey !== authorityKeyRef.current) return;
      setRows([]);
      setError(userError(caught, '关键词事实读取失败'));
    } finally {
      if (isCurrent() && request === requestRef.current && capturedKey === authorityKeyRef.current) setLoading(false);
    }
  }, [api, asin, authorityKey, query, storeContext]);

  async function refresh() {
    const ticket = operation.begin();
    if (!ticket) return;
    try { await load(); } finally { ticket.finish(); }
  }

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
        description="汇总当前店铺的关键词指标与机会；尚未确认归属的历史数据不会进入结果。"
        status={<span>{loading ? '读取中…' : `${rows.length} 个关键词`}</span>}
        title="关键词事实与机会"
        toolbar={(
          <>
            <label className="store-fact-filter"><span>ASIN</span><input aria-label="按 ASIN 筛选关键词" aria-describedby={operation.busy ? 'keyword-read-pending' : undefined} disabled={operation.busy} onChange={(event) => setAsin(event.target.value)} placeholder="可选" value={asin} /></label>
            <label className="store-fact-filter"><span>关键词</span><input aria-label="查询关键词" aria-describedby={operation.busy ? 'keyword-read-pending' : undefined} disabled={operation.busy} onChange={(event) => setQuery(event.target.value)} placeholder="词根" value={query} /></label>
            <WorkspaceActionButton busy={loading} busyLabel="读取中…" className="workspace-button workspace-button--primary" data-action-priority="primary" disabled={loading || operation.busy} disabledReason="正在读取当前店铺关键词事实，请等待返回后刷新。" onClick={() => void refresh()}><ArrowsClockwise aria-hidden="true" size={16} />刷新</WorkspaceActionButton>
          </>
        )}
      >
        {operation.busy && <p id="keyword-read-pending" role="note">当前关键词刷新尚未返回，筛选条件暂时锁定；完成后可修改 ASIN 或查询词。</p>}
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
