import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsClockwise, Database } from '@phosphor-icons/react';
import { missionControlContextKey } from '@amazon-ai-ops/shared-types';
import { PriorityDataTable, WorkbenchPanel, WorkspaceState, type PriorityDataTableColumn } from '../../components/workspace';
import { type StoreScopedPanelProps, type AdObjectKind, type StoreAdObjectFactView } from "./store-scoped-ad-listing-contracts";
import { resolveApi, storeResultBelongsToContext, userError, integer, usd, percent } from "./store-scoped-ad-listing-values";
import { MissingStoreContext } from "./store-scoped-panel-view";
import { StoreAdObjectIdentity } from './store-ad-object-identity';
import { WorkspaceActionButton } from '../../components/workspace/action-feedback';
import { useWorkspaceOperation } from '../../components/workspace/use-workspace-operation';
import { rendererRuntimeLog } from '../../runtime-log';

export function StoreScopedAdObjectsPanel({ storeContext, api }: StoreScopedPanelProps) {
  const [kind, setKind] = useState<AdObjectKind>('campaign');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<StoreAdObjectFactView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : '';
  const operationKey = `${authorityKey}|${kind}|${query}`;
  const operation = useWorkspaceOperation(operationKey);
  const authorityKeyRef = useRef(authorityKey);
  authorityKeyRef.current = authorityKey;

  const load = useCallback(async () => {
    if (!storeContext) return;
    const isCurrent = operation.capture();
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
      if (!isCurrent() || request !== requestRef.current || capturedKey !== authorityKeyRef.current) return;
      if (!Array.isArray(result) || result.some((row) => !storeResultBelongsToContext(row, storeContext))) {
        throw new Error('返回的广告对象与当前店铺或美国站范围不一致');
      }
      setRows(result);
    } catch (caught) {
      rendererRuntimeLog.error('objects.ad_facts_load_failed', { error: caught });
      if (!isCurrent() || request !== requestRef.current || capturedKey !== authorityKeyRef.current) return;
      setRows([]);
      setError(userError(caught, '广告对象读取失败'));
    } finally {
      if (isCurrent() && request === requestRef.current && capturedKey === authorityKeyRef.current) setLoading(false);
    }
  }, [api, authorityKey, kind, query, storeContext]);

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

  const columns = useMemo<Array<PriorityDataTableColumn<StoreAdObjectFactView>>>(() => [
    {
      key: 'object',
      header: '广告对象',
      priority: 'anchor',
      width: '30%',
      cell: (row) => <StoreAdObjectIdentity row={row} />,
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
            <label className="store-fact-filter"><span>对象层级</span><select aria-label="广告对象层级" aria-describedby={operation.busy ? 'ad-object-read-pending' : undefined} disabled={operation.busy} onChange={(event) => setKind(event.target.value as AdObjectKind)} value={kind}><option value="campaign">广告活动</option><option value="ad_group">广告组</option><option value="target">关键词/投放</option><option value="search_term">搜索词</option></select></label>
            <label className="store-fact-filter"><span>查询</span><input aria-label="查询广告对象" aria-describedby={operation.busy ? 'ad-object-read-pending' : undefined} disabled={operation.busy} onChange={(event) => setQuery(event.target.value)} placeholder="名称 / 广告活动" value={query} /></label>
            <WorkspaceActionButton busy={loading} busyLabel="读取中…" className="workspace-button workspace-button--primary" data-action-priority="primary" disabled={loading || operation.busy} disabledReason="正在读取当前店铺广告对象，请等待返回后刷新。" onClick={() => void refresh()}><ArrowsClockwise aria-hidden="true" size={16} />刷新</WorkspaceActionButton>
          </>
        )}
      >
        {operation.busy && <p id="ad-object-read-pending" role="note">当前广告对象刷新尚未返回，筛选条件暂时锁定；完成后可修改对象层级或查询词。</p>}
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
