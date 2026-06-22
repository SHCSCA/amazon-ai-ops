import React, { useEffect, useState } from 'react';
import { useBusinessDataPipeline, ScopeText } from '../components/business-data';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { formatPercent, formatUsd } from '../formatters';
import { hasRealReportCoverage, realReportCoverageCount } from '../report-coverage';
import { useScopeStore } from '../scope-store';
import type { KeywordOpportunityView, ListingHandoffPayload } from '../types';
import { toUserFacingError } from '../user-facing-error';

function errorMessage(caught: unknown, fallback: string): string {
  return `${fallback}: ${toUserFacingError(caught, fallback)}`;
}

export function KeywordOpportunitiesPage() {
  const { data, scope } = useBusinessDataPipeline();
  const setScope = useScopeStore((state) => state.setScope);
  const [rows, setRows] = useState<KeywordOpportunityView[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    asin: '',
    campaign: '',
    adGroup: '',
    coverageStatus: '',
    minClicks: '',
    minSpend: '',
    opportunityLevel: '',
  });
  const quantReady = Boolean(hasRealReportCoverage(data?.collection) && data?.quant.hasImportedMetrics);
  const currentBatchId = scope.batchId || data?.collection.latestBatch?.id;
  const batchId = currentBatchId || '-';
  const requestScope = { ...scope, batchId: currentBatchId };

  async function loadRows() {
    if (!quantReady) {
      setRows([]);
      setExpandedKey(null);
      setMessage('缺少当前范围真实报表和导入指标，关键词机会保持阻断。');
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const result = await (window as any).electronAPI?.getBusinessKeywordOpportunities?.(requestScope);
      setRows(Array.isArray(result) ? result : []);
    } catch (caught) {
      setRows([]);
      setMessage(errorMessage(caught, '加载关键词机会失败'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!quantReady) {
      setRows([]);
      setExpandedKey(null);
      setMessage(null);
      return;
    }
    loadRows();
  }, [currentBatchId, quantReady, scope.asin, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName]);

  const filteredRows = rows.filter((row) => {
    const minClicks = Number(filters.minClicks || 0);
    const minSpend = Number(filters.minSpend || 0);
    return (
      (!filters.asin || (row.asin || '').toLowerCase().includes(filters.asin.toLowerCase())) &&
      (!filters.campaign || (row.campaignName || '').toLowerCase().includes(filters.campaign.toLowerCase())) &&
      (!filters.adGroup || (row.adGroupName || '').toLowerCase().includes(filters.adGroup.toLowerCase())) &&
      (!filters.coverageStatus || row.coverageStatus === filters.coverageStatus) &&
      (!filters.opportunityLevel || row.opportunityLevel === filters.opportunityLevel) &&
      row.clicks >= minClicks &&
      row.spend >= minSpend
    );
  });

  const coverageOptions = quantReady ? Array.from(new Set(rows.map((row) => row.coverageStatus).filter(Boolean))) : [];
  const visibleRows = quantReady ? filteredRows : [];
  const visibleRowCount = quantReady ? rows.length : 0;
  const highOpportunityCount = visibleRows.filter((row) => row.opportunityLevel === 'high').length;
  const convertingCount = visibleRows.filter((row) => row.orders > 0 || row.sales > 0).length;
  const noOrderSpend = visibleRows.filter((row) => row.spend > 0 && row.orders === 0).reduce((sum, row) => sum + row.spend, 0);
  const sourceReportCount = realReportCoverageCount(data?.collection);
  const importedMetricRows = data?.collection.fileAudit?.importedRowCount ?? data?.quant.importedRows ?? 0;
  const asinCount = new Set(visibleRows.map((row) => row.asin).filter(Boolean)).size;
  const campaignCount = new Set(visibleRows.map((row) => row.campaignName).filter(Boolean)).size;
  const adGroupCount = new Set(visibleRows.map((row) => row.adGroupName).filter(Boolean)).size;
  const sourceBatchText = (scope.batchId ? [scope.batchId] : (data?.collection.sourceBatchIds?.length ? data.collection.sourceBatchIds : [batchId])).filter(Boolean).join(', ');
  const topOpportunity = visibleRows[0];
  const rowKey = (row: KeywordOpportunityView) => [
    row.asin || '-',
    row.campaignName || '-',
    row.adGroupName || '-',
    row.entityType,
    row.keyword,
  ].join('|');

  function sourceImportRows(row: KeywordOpportunityView): number | null {
    if (!row.sourceFile || !hasRealReportCoverage(data?.collection)) return null;
    const collection = data?.collection;
    if (!collection) return null;
    const normalized = row.sourceFile.replace(/\\/g, '/').toLowerCase();
    const sourceFileName = normalized.split('/').filter(Boolean).pop();
    const matched = collection.realReportFiles.find((file) => {
      const normalizedFilePath = file.filePath.replace(/\\/g, '/').toLowerCase();
      const normalizedFileName = (file.fileName || normalizedFilePath.split('/').filter(Boolean).pop() || '').toLowerCase();
      return normalizedFilePath === normalized || (Boolean(sourceFileName) && normalizedFileName === sourceFileName);
    });
    return matched?.importedRows ?? null;
  }

  function handoffToListing(row: KeywordOpportunityView) {
    if (!quantReady) {
      setMessage('缺少当前范围真实报表和导入指标，不能带入 Listing 优化。');
      return;
    }
    const sameAsinRows = filteredRows.filter((item) => (row.asin ? item.asin === row.asin : item.asin === row.asin));
    const keywords = Array.from(new Set([row.keyword, ...sameAsinRows.map((item) => item.keyword)].filter(Boolean))).slice(0, 30);
    const payload: ListingHandoffPayload = {
      asin: row.asin,
      keywords,
      source: 'keyword-opportunities',
      createdAt: new Date().toISOString(),
      scope: {
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        storeName: scope.storeName,
        marketplaceCode: scope.marketplaceCode,
        batchId: currentBatchId,
      },
      context: {
        portfolioName: row.portfolioName,
        campaignName: row.campaignName,
        adGroupName: row.adGroupName,
        entityType: row.entityType,
        keyword: row.keyword,
        sourceFile: row.sourceFile,
        clicks: row.clicks,
        orders: row.orders,
        spend: row.spend,
        sales: row.sales,
      },
    };
    window.localStorage.setItem('amazon-ai-ops-listing-handoff', JSON.stringify(payload));
    if (row.asin) setScope({ asin: row.asin });
    setMessage(`已带入 Listing 优化：${row.asin || '未指定 ASIN'} / ${keywords.length} 个关键词。请打开 Listing 优化继续。`);
  }

  return (
    <div>
      <PageHeader
        eyebrow="关键词与 Listing"
        title="关键词机会"
        description="从当前范围真实导入的 search term / keyword / targeting 指标中去重生成机会，保留 ASIN、广告活动、广告组和来源文件。"
        primaryTask="生成可用关键词机会池"
        nextAction={quantReady ? '复核机会并进入 Listing 覆盖' : '先完成真实报表导入'}
      />

      <div className="business-stack">
        <Panel title="机会来源" tone={quantReady ? 'success' : 'blocked'}>
          <div className="business-split">
            <div>
              <div className="business-scope-line"><ScopeText scope={data?.scope || scope} /></div>
              <p className="muted-line">去重键：店铺 / 站点 / ASIN / 广告活动 / 广告组 / 对象类型 / 标准化关键词。</p>
            </div>
            <StatusPill tone={quantReady ? 'ready' : 'blocked'}>
              {quantReady ? `${visibleRowCount} 个机会` : '缺真实广告数据'}
            </StatusPill>
          </div>
          <div className="action-row">
            <button className="secondary-button" disabled={loading || !quantReady} onClick={loadRows} type="button">
              {loading ? '刷新中...' : '刷新机会'}
            </button>
          </div>
          {message && <p className={message.includes('失败') || message.includes('缺少') || message.includes('不能') ? 'blocked-line' : 'muted-line'}>{message}</p>}
        </Panel>

        <Panel title="关键词机会来源与覆盖关系" tone={quantReady ? 'success' : 'blocked'}>
          <div className="context-summary-grid">
            <div>
              <span>真实广告报表</span>
              <strong>{sourceReportCount}/8 类真实报表</strong>
              <p>只接收当前范围下载目录中的 xlsx/xls/csv；审计文件、截图和 DOM 证据不算广告数据。</p>
            </div>
            <div>
              <span>导入指标行</span>
              <strong>{importedMetricRows}</strong>
              <p>关键词机会来自已导入广告指标，金额统一按 USD 展示。</p>
            </div>
            <div>
              <span>覆盖 ASIN</span>
              <strong>{asinCount}</strong>
              <p>带入 Listing 时按 ASIN 聚合最多 30 个关键词，避免跨产品混用。</p>
            </div>
            <div>
              <span>来源批次</span>
              <strong>{sourceBatchText || '-'}</strong>
              <p>生成机会不混入历史批次；切换范围后需要重新刷新机会。</p>
            </div>
          </div>
          <p className="muted-line">
            这里是广告数据到 Listing 的交接池，不读取 Listing 页面，也不会修改 Amazon；点击“带入 Listing”后仍需在 Listing 优化页读取真实 Listing 并人工复核。
          </p>
        </Panel>

        <Panel title="机会摘要">
          <div className="context-summary-grid">
            <div>
              <span>当前批次</span>
              <strong>{batchId}</strong>
              <p>只读取当前范围导入指标，不混入历史批次。</p>
            </div>
            <div>
              <span>高优先级机会</span>
              <strong>{highOpportunityCount}</strong>
              <p>{convertingCount} 个词或对象已有订单/销售，可优先进入 Listing 覆盖复核。</p>
            </div>
            <div>
              <span>无订单花费</span>
              <strong>{formatUsd(noOrderSpend)}</strong>
              <p>这部分不建议直接扩量，应先否定、降价或继续观察。</p>
            </div>
            <div>
              <span>优先复核对象</span>
              <strong>{topOpportunity?.keyword || '-'}</strong>
              <p>{topOpportunity ? `${topOpportunity.campaignName || '-'} / ${topOpportunity.adGroupName || '-'}` : '暂无机会'}</p>
            </div>
          </div>
        </Panel>

        <Panel title="筛选">
          <div className="context-summary-grid compact-summary">
            <div>
              <span>当前日期范围</span>
              <strong>{scope.dateFrom} ~ {scope.dateTo}</strong>
              <p>日期在顶部“当前操作范围”统一调整。</p>
            </div>
            <div>
              <span>店铺 / 站点</span>
              <strong>{scope.storeName || '-'} / {scope.marketplaceCode || '-'}</strong>
              <p>关键词机会不会跨店铺或跨站点混合。</p>
            </div>
            <div>
              <span>广告上下文</span>
              <strong>{campaignCount} 个活动 / {adGroupCount} 个广告组</strong>
              <p>同一关键词在不同广告活动/广告组会拆成独立行。</p>
            </div>
            <div>
              <span>数据批次</span>
              <strong>{batchId}</strong>
              <p>批次来自当前工作范围，不在本页修改。</p>
            </div>
          </div>
          <div className="filter-grid">
            <label>
              ASIN
              <input value={filters.asin} onChange={(event) => setFilters({ ...filters, asin: event.target.value })} placeholder="B0..." />
            </label>
            <label>
              Campaign
              <input value={filters.campaign} onChange={(event) => setFilters({ ...filters, campaign: event.target.value })} placeholder="广告活动名称" />
            </label>
            <label>
              Ad Group
              <input value={filters.adGroup} onChange={(event) => setFilters({ ...filters, adGroup: event.target.value })} placeholder="广告组名称" />
            </label>
            <label>
              覆盖状态
              <select value={filters.coverageStatus} onChange={(event) => setFilters({ ...filters, coverageStatus: event.target.value })}>
                <option value="">全部</option>
                {coverageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label>
              最低点击
              <input min="0" type="number" value={filters.minClicks} onChange={(event) => setFilters({ ...filters, minClicks: event.target.value })} />
            </label>
            <label>
              最低花费 USD
              <input min="0" step="0.01" type="number" value={filters.minSpend} onChange={(event) => setFilters({ ...filters, minSpend: event.target.value })} />
            </label>
            <label>
              机会等级
              <select value={filters.opportunityLevel} onChange={(event) => setFilters({ ...filters, opportunityLevel: event.target.value })}>
                <option value="">全部</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
            </label>
          </div>
          <p className="muted-line">当前显示 {visibleRows.length} / {visibleRowCount} 个机会；所有金额均为 USD。</p>
        </Panel>

        <Panel title="关键词机会表">
          <div className="table-wrap">
            <table className="business-table recommendation-table">
              <thead>
                <tr>
                  <th>ASIN</th>
                  <th>广告组合</th>
                  <th>广告活动</th>
                  <th>广告组</th>
                  <th>关键词/搜索词/投放对象</th>
                  <th>覆盖状态</th>
                  <th>点击/订单</th>
                  <th>花费/销售</th>
                  <th>ACOS</th>
                  <th>机会等级</th>
                  <th>建议位置</th>
                  <th>风险</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const key = rowKey(row);
                  const importedRows = sourceImportRows(row);
                  return (
                    <React.Fragment key={key}>
                      <tr>
                        <td>{row.asin || '-'}</td>
                        <td>{row.portfolioName || '-'}</td>
                        <td>{row.campaignName || '-'}</td>
                        <td>{row.adGroupName || '-'}</td>
                        <td>
                          <strong>{row.keyword}</strong>
                          <div className="muted-cell">{row.entityType}</div>
                        </td>
                        <td>{row.coverageStatus}</td>
                        <td>{row.clicks} / {row.orders}</td>
                        <td>{formatUsd(row.spend)} / {formatUsd(row.sales)}</td>
                        <td>{formatPercent(row.acos * 100)}</td>
                        <td>{row.opportunityLevel}</td>
                        <td>{row.recommendedPlacement}</td>
                        <td>
                          <div>{row.risk}</div>
                          <div className="table-action-row">
                            <button className="compact-button secondary-button" onClick={() => setExpandedKey(expandedKey === key ? null : key)} type="button">
                              {expandedKey === key ? '收起详情' : '来源详情'}
                            </button>
                            <button className="compact-button primary-button" disabled={!quantReady} onClick={() => handoffToListing(row)} type="button">
                              带入 Listing
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedKey === key && (
                        <tr className="detail-row">
                          <td colSpan={12}>
                            <div className="detail-grid">
                              <div><span>数据批次</span><strong>{batchId}</strong></div>
                              <div><span>报表类型</span><strong>{row.entityType}</strong></div>
                              <div><span>导入行数</span><strong>{importedRows === null ? '当前文件未匹配' : importedRows}</strong></div>
                              <div><span>来源文件</span><strong><code>{row.sourceFile || '-'}</code></strong></div>
                              <div><span>数据口径</span><strong>店铺/站点/ASIN/广告活动/广告组/对象类型/关键词去重</strong></div>
                              <div><span>下一步</span><strong>{row.orders > 0 || row.sales > 0 ? '进入 Listing 覆盖复核' : '先控制投放风险'}</strong></div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {!visibleRows.length && (
                  <tr>
                    <td colSpan={12}>{quantReady ? '当前筛选条件没有可展示的关键词机会。' : '缺少真实报表和导入指标，关键词机会保持阻断。'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
