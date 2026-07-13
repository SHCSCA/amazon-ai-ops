import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBusinessDataPipeline, ScopeText } from '../components/business-data';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import { VirtualDataTable, type VirtualDataTableColumn } from '../components/virtual-data-table';
import { formatPercent, formatUsd } from '../formatters';
import { hasRealReportCoverage, realReportCoverageCount } from '../report-coverage';
import { useScopeStore } from '../scope-store';
import type { AppRoute, KeywordOpportunityView, ListingHandoffPayload } from '../types';
import { toUserFacingError } from '../user-facing-error';

function errorMessage(caught: unknown, fallback: string): string {
  return `${fallback}: ${toUserFacingError(caught, fallback)}`;
}

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

export type KeywordOpportunitySortKey =
  | 'asin'
  | 'portfolioName'
  | 'campaignName'
  | 'adGroupName'
  | 'keyword'
  | 'coverageStatus'
  | 'clicks'
  | 'orders'
  | 'spend'
  | 'sales'
  | 'acos'
  | 'opportunityLevel'
  | 'recommendedPlacement';

export interface KeywordOpportunitySortState {
  key: KeywordOpportunitySortKey;
  direction: 'asc' | 'desc';
}

const keywordTextSortKeys = new Set<KeywordOpportunitySortKey>([
  'asin',
  'portfolioName',
  'campaignName',
  'adGroupName',
  'keyword',
  'coverageStatus',
  'recommendedPlacement',
]);

const opportunityLevelRank: Record<KeywordOpportunityView['opportunityLevel'], number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const keywordSortKeys = new Set<KeywordOpportunitySortKey>([
  'asin',
  'portfolioName',
  'campaignName',
  'adGroupName',
  'keyword',
  'coverageStatus',
  'clicks',
  'orders',
  'spend',
  'sales',
  'acos',
  'opportunityLevel',
  'recommendedPlacement',
]);

const keywordOpportunitySortLabels: Record<KeywordOpportunitySortKey, string> = {
  asin: 'ASIN',
  portfolioName: '广告组合',
  campaignName: '广告活动',
  adGroupName: '广告组',
  keyword: '关键词',
  coverageStatus: '覆盖状态',
  clicks: '点击',
  orders: '订单',
  spend: '花费',
  sales: '销售',
  acos: 'ACOS',
  opportunityLevel: '机会等级',
  recommendedPlacement: '建议位置',
};

const EMPTY_KEYWORD_FILTERS = {
  asin: '',
  campaign: '',
  adGroup: '',
  coverageStatus: '',
  minClicks: '',
  minSpend: '',
  opportunityLevel: '',
};

function isKeywordOpportunitySortKey(key: string): key is KeywordOpportunitySortKey {
  return keywordSortKeys.has(key as KeywordOpportunitySortKey);
}

function sortValue(row: KeywordOpportunityView, key: KeywordOpportunitySortKey): string | number {
  if (key === 'opportunityLevel') return opportunityLevelRank[row.opportunityLevel] ?? 0;
  const value = row[key];
  if (typeof value === 'number') return value;
  return String(value || '').toLowerCase();
}

export function sortKeywordOpportunities(
  rows: KeywordOpportunityView[],
  sort: KeywordOpportunitySortState,
): KeywordOpportunityView[] {
  const direction = sort.direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftValue = sortValue(left.row, sort.key);
      const rightValue = sortValue(right.row, sort.key);
      let compared = 0;
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        compared = leftValue - rightValue;
      } else {
        compared = String(leftValue).localeCompare(String(rightValue), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
      }
      if (compared !== 0) return compared * direction;
      const tieBreaker = left.row.keyword.localeCompare(right.row.keyword, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
      return tieBreaker || left.index - right.index;
    })
    .map((item) => item.row);
}

export function nextKeywordOpportunitySort(
  current: KeywordOpportunitySortState,
  nextKey: KeywordOpportunitySortKey,
): KeywordOpportunitySortState {
  if (current.key === nextKey) {
    return { key: nextKey, direction: current.direction === 'desc' ? 'asc' : 'desc' };
  }
  return { key: nextKey, direction: keywordTextSortKeys.has(nextKey) ? 'asc' : 'desc' };
}

export function keywordOpportunitySortLabel(key: KeywordOpportunitySortKey): string {
  return keywordOpportunitySortLabels[key] || key;
}

export function buildKeywordOpportunityFilterFeedback(input: {
  activeFilterCount: number;
  sortDirection: KeywordOpportunitySortState['direction'];
  sortLabel: string;
  totalCount: number;
  visibleCount: number;
}): string {
  const filterText = input.activeFilterCount > 0
    ? `已应用 ${input.activeFilterCount} 个筛选条件`
    : '未设置筛选条件';
  const directionText = input.sortDirection === 'asc' ? '升序' : '降序';
  return `${filterText}，按${input.sortLabel}${directionText}展示 ${input.visibleCount}/${input.totalCount} 个机会。`;
}

export function keywordOpportunityTableFeedbackClass(refreshing: boolean): string {
  return refreshing
    ? 'keyword-opportunity-table-shell keyword-opportunity-table-refreshing'
    : 'keyword-opportunity-table-shell';
}

interface KeywordOpportunityActionButtonInput {
  active: boolean;
  baseClassName: string;
  label: string;
  busyLabel: string;
  disabled?: boolean;
  groupBusy?: boolean;
}

export interface KeywordOpportunityActionButtonView {
  ariaBusy?: true;
  className: string;
  disabled: boolean;
  label: string;
  showSpinner: boolean;
}

function KeywordOpportunityFilterCell({
  children,
  hint,
  label,
}: {
  children: React.ReactNode;
  hint: string;
  label: string;
}) {
  return (
    <label className="keyword-filter-cell">
      <span className="keyword-filter-cell-label">{label}</span>
      <span className="keyword-filter-cell-control">{children}</span>
      <span className="keyword-filter-cell-hint">{hint}</span>
    </label>
  );
}

export function keywordOpportunityActionButtonView({
  active,
  baseClassName,
  label,
  busyLabel,
  disabled = false,
  groupBusy = false,
}: KeywordOpportunityActionButtonInput): KeywordOpportunityActionButtonView {
  return {
    ariaBusy: active ? true : undefined,
    className: [baseClassName, active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(disabled || active || groupBusy),
    label: active ? busyLabel : label,
    showSpinner: active,
  };
}

export function KeywordOpportunitiesPage() {
  const { data, scope } = useBusinessDataPipeline();
  const setScope = useScopeStore((state) => state.setScope);
  const didMountFilterFeedback = useRef(false);
  const [rows, setRows] = useState<KeywordOpportunityView[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedOpportunityKey, setSelectedOpportunityKey] = useState<React.Key | null>(null);
  const [opportunityDetailOpen, setOpportunityDetailOpen] = useState(false);
  const [tableRefreshing, setTableRefreshing] = useState(false);
  const [filters, setFilters] = useState({ ...EMPTY_KEYWORD_FILTERS });
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [sortState, setSortState] = useState<KeywordOpportunitySortState>({ key: 'opportunityLevel', direction: 'desc' });
  const quantReady = Boolean(hasRealReportCoverage(data?.collection) && data?.quant.hasImportedMetrics);
  const currentBatchId = scope.batchId || data?.collection.latestBatch?.id;
  const batchId = currentBatchId || '-';
  const requestScope = { ...scope, batchId: currentBatchId };

  async function loadRows() {
    if (!quantReady) {
      setRows([]);
      setSelectedOpportunityKey(null);
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
      setSelectedOpportunityKey(null);
      setMessage(null);
      return;
    }
    loadRows();
  }, [currentBatchId, quantReady, scope.asin, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName]);

  const filteredRows = useMemo(() => rows.filter((row) => {
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
  }), [filters, rows]);

  const coverageOptions = quantReady ? Array.from(new Set(rows.map((row) => row.coverageStatus).filter(Boolean))) : [];
  const sortedRows = useMemo(() => sortKeywordOpportunities(filteredRows, sortState), [filteredRows, sortState]);
  const visibleRows = quantReady ? sortedRows : [];
  const visibleRowCount = quantReady ? rows.length : 0;
  const activeFilterCount = Object.values(filters).filter((value) => String(value).trim().length > 0).length;
  const filterFeedback = buildKeywordOpportunityFilterFeedback({
    activeFilterCount,
    sortDirection: sortState.direction,
    sortLabel: keywordOpportunitySortLabel(sortState.key),
    totalCount: visibleRowCount,
    visibleCount: visibleRows.length,
  });
  const keywordActionBusy = loading;
  const refreshOpportunityButton = keywordOpportunityActionButtonView({
    active: loading,
    baseClassName: 'secondary-button',
    busyLabel: '刷新中...',
    disabled: !quantReady,
    label: '刷新机会',
  });
  const highOpportunityCount = visibleRows.filter((row) => row.opportunityLevel === 'high').length;
  const convertingCount = visibleRows.filter((row) => row.orders > 0 || row.sales > 0).length;
  const noOrderSpend = visibleRows.filter((row) => row.spend > 0 && row.orders === 0).reduce((sum, row) => sum + row.spend, 0);
  const sourceReportCount = realReportCoverageCount(data?.collection);
  const importedMetricRows = data?.collection.fileAudit?.importedRowCount ?? data?.quant.importedRows ?? 0;
  const asinCount = new Set(visibleRows.map((row) => row.asin).filter(Boolean)).size;
  const campaignCount = new Set(visibleRows.map((row) => row.campaignName).filter(Boolean)).size;
  const adGroupCount = new Set(visibleRows.map((row) => row.adGroupName).filter(Boolean)).size;
  const sourceBatchText = (scope.batchId ? [scope.batchId] : (data?.collection.sourceBatchIds?.length ? data.collection.sourceBatchIds : [batchId])).filter(Boolean).join(', ');

  useEffect(() => {
    if (!filterModalOpen) return undefined;
    function handleWindowKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setFilterModalOpen(false);
    }
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [filterModalOpen]);

  useEffect(() => {
    if (!opportunityDetailOpen) return undefined;
    function handleWindowKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpportunityDetailOpen(false);
    }
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [opportunityDetailOpen]);

  function closeFilterModal() {
    setFilterModalOpen(false);
  }

  function closeOpportunityDetail() {
    setOpportunityDetailOpen(false);
  }

  function handleOpportunityDetailKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setOpportunityDetailOpen(false);
  }

  function handleFilterModalKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setFilterModalOpen(false);
  }

  const topOpportunity = visibleRows[0];
  const rowKey = (row: KeywordOpportunityView) => [
    row.asin || '-',
    row.campaignName || '-',
    row.adGroupName || '-',
    row.entityType,
    row.keyword,
    row.coverageStatus || '-',
    row.clicks,
    row.orders,
    row.spend,
    row.sales,
  ].join('|');
  const selectedOpportunity = visibleRows.find((row) => rowKey(row) === selectedOpportunityKey) || null;

  useEffect(() => {
    if (!visibleRows.length) {
      setSelectedOpportunityKey(null);
      setOpportunityDetailOpen(false);
      return;
    }
    const selectedStillVisible = selectedOpportunityKey !== null && visibleRows.some((row) => rowKey(row) === selectedOpportunityKey);
    if (!selectedStillVisible) {
      setSelectedOpportunityKey(rowKey(visibleRows[0]));
    }
  }, [selectedOpportunityKey, visibleRows]);

  useEffect(() => {
    if (!quantReady) {
      setTableRefreshing(false);
      didMountFilterFeedback.current = false;
      return;
    }
    if (!didMountFilterFeedback.current) {
      didMountFilterFeedback.current = true;
      return;
    }
    setTableRefreshing(true);
    const timer = window.setTimeout(() => setTableRefreshing(false), 120);
    return () => window.clearTimeout(timer);
  }, [
    filters.adGroup,
    filters.asin,
    filters.campaign,
    filters.coverageStatus,
    filters.minClicks,
    filters.minSpend,
    filters.opportunityLevel,
    quantReady,
    sortState.direction,
    sortState.key,
  ]);

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

  function handleSortChange(key: string) {
    if (!isKeywordOpportunitySortKey(key)) return;
    setSortState((current) => nextKeywordOpportunitySort(current, key));
  }

  const selectedOpportunityBar = !loading && (
    selectedOpportunity ? (() => {
      const importedRows = sourceImportRows(selectedOpportunity);
      const listingHandoffButton = keywordOpportunityActionButtonView({
        active: false,
        baseClassName: 'compact-button primary-button',
        busyLabel: '处理中...',
        disabled: !quantReady,
        groupBusy: keywordActionBusy,
        label: '带入 Listing',
      });
      return (
        <div className="keyword-opportunity-selection-bar">
          <div className="keyword-opportunity-selection-main">
            <div>
              <span>已选机会</span>
              <strong>{selectedOpportunity.keyword}</strong>
            </div>
            <StatusPill tone={selectedOpportunity.opportunityLevel === 'high' ? 'warning' : 'pending'}>{selectedOpportunity.opportunityLevel}</StatusPill>
          </div>
          <p>
            {selectedOpportunity.asin || '-'} / {selectedOpportunity.campaignName || '-'} / {selectedOpportunity.orders > 0 || selectedOpportunity.sales > 0 ? '可复核 Listing 覆盖' : '先处理投放风险'}
            {importedRows === null ? '' : ` / 导入 ${importedRows} 行`}
          </p>
          <div className="keyword-opportunity-selection-actions">
            <button className="secondary-button compact-button" onClick={() => setOpportunityDetailOpen(true)} type="button">
              查看来源
            </button>
            <button aria-busy={listingHandoffButton.ariaBusy} className={listingHandoffButton.className} disabled={listingHandoffButton.disabled} onClick={() => handoffToListing(selectedOpportunity)} type="button">
              {listingHandoffButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
              <span>{listingHandoffButton.label}</span>
            </button>
          </div>
        </div>
      );
    })() : null
  );

  const opportunityColumns: Array<VirtualDataTableColumn<KeywordOpportunityView>> = [
    { key: 'asin', header: 'ASIN', width: '112px', sticky: 'left', sortable: true, cell: (row) => row.asin || '-' },
    {
      key: 'keyword',
      header: '关键词/投放对象',
      width: 'minmax(240px, 1.2fr)',
      sortable: true,
      sortLabel: '关键词',
      cell: (row) => (
        <div>
          <strong>{row.keyword}</strong>
          <div className="muted-cell">{row.entityType}</div>
        </div>
      ),
    },
    {
      key: 'campaignName',
      header: '广告单元',
      width: '220px',
      sortable: true,
      sortLabel: '广告活动',
      cell: (row) => (
        <div>
          <strong>{row.campaignName || '-'}</strong>
          <div className="muted-cell">{row.adGroupName || '-'}</div>
        </div>
      ),
    },
    { key: 'coverageStatus', header: '覆盖', width: '92px', sortable: true, cell: (row) => row.coverageStatus },
    { key: 'clicks', header: '点击/订单', width: '92px', sortable: true, sortLabel: '点击', cell: (row) => `${row.clicks} / ${row.orders}` },
    {
      key: 'spend',
      header: '花费/销售/ACOS',
      width: '150px',
      sortable: true,
      sortLabel: '花费',
      cell: (row) => (
        <div>
          <strong>{formatUsd(row.spend)} / {formatUsd(row.sales)}</strong>
          <div className="muted-cell">ACOS {formatPercent(row.acos * 100)}</div>
        </div>
      ),
    },
    {
      key: 'opportunityLevel',
      header: '机会',
      width: '112px',
      sortable: true,
      cell: (row) => (
        <div>
          <strong>{row.opportunityLevel}</strong>
          <div className="muted-cell">{row.recommendedPlacement}</div>
        </div>
      ),
    },
    {
      key: 'risk',
      header: '判断',
      width: '230px',
      cell: (row) => (
        <div>
          <strong>{row.risk}</strong>
          <div className="muted-cell">{row.orders > 0 || row.sales > 0 ? '可进入 Listing 覆盖' : '先控制投放风险'}</div>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="增长"
        title={PAGE_HEADER_TITLES.keywordOpportunities}
        description="复核可带入 Listing 的关键词机会；只从当前范围真实导入的 search term / keyword / targeting 指标中去重生成。"
      />

      <div className="business-stack keyword-opportunity-page-stack">
        <Panel title="关键词机会池" tone={quantReady ? 'success' : 'blocked'}>
          <div className="object-workbench-header">
            {quantReady ? (
              <>
                <div className="keyword-opportunity-summary-grid" aria-label="关键词机会核心状态">
                  <div><span>真实报表</span><strong>{sourceReportCount}/8</strong><p>{importedMetricRows} 行指标</p></div>
                  <div><span>机会</span><strong>{visibleRowCount}</strong><p>{highOpportunityCount} 个高优先级</p></div>
                  <div><span>ASIN</span><strong>{asinCount}</strong><p>{campaignCount} 个活动 / {adGroupCount} 个广告组</p></div>
                  <div><span>风险花费</span><strong>{formatUsd(noOrderSpend)}</strong><p>有花费无订单</p></div>
                </div>
                <div className="object-workbench-actions">
                  <StatusPill tone={visibleRowCount ? 'ready' : 'pending'}>{visibleRowCount} 个机会</StatusPill>
                  <button aria-busy={refreshOpportunityButton.ariaBusy} className={refreshOpportunityButton.className} disabled={refreshOpportunityButton.disabled} onClick={loadRows} type="button">
                    {refreshOpportunityButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                    <span>{refreshOpportunityButton.label}</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="keyword-opportunity-blocker-strip" role="status" aria-live="polite">
                <div>
                  <span>关键词机会阻断</span>
                  <strong>先完成真实报表入库</strong>
                  <p>关键词机会只能从当前范围真实导入的 search term / keyword / targeting 指标生成；截图、HTML 或审计文件不能替代广告数据。</p>
                </div>
                <div className="keyword-opportunity-blocker-actions">
                  <StatusPill tone="blocked">真实报表 {sourceReportCount}/8 · 入库 {importedMetricRows} 行</StatusPill>
                  <button className="secondary-button compact-button" onClick={() => navigate('data-collection')} type="button">去数据采集</button>
                  <button className="primary-button compact-button" onClick={() => navigate('data-import-validation')} type="button">去导入校验</button>
                </div>
              </div>
            )}
          </div>
          {message && <p className={message.includes('失败') || message.includes('缺少') || message.includes('不能') ? 'blocked-line' : 'muted-line'}>{message}</p>}
          {quantReady && (
            <div className="keyword-filter-strip" aria-live="polite">
              <div>
                <span>当前视图</span>
                <p className="keyword-opportunity-filter-feedback">{filterFeedback}</p>
              </div>
              <div className="keyword-filter-actions" aria-label="关键词机会筛选动作">
                <StatusPill tone={activeFilterCount ? 'warning' : 'pending'}>{activeFilterCount ? `${activeFilterCount} 个筛选` : '未筛选'}</StatusPill>
                <button className="secondary-button compact-button" onClick={() => setFilterModalOpen(true)} type="button">
                  筛选条件
                </button>
                <button className="secondary-button compact-button" disabled={!activeFilterCount} onClick={() => setFilters({ ...EMPTY_KEYWORD_FILTERS })} type="button">
                  清空筛选
                </button>
              </div>
            </div>
          )}
          {quantReady && (visibleRows.length > 0 || loading) ? (
            <div className={keywordOpportunityTableFeedbackClass(tableRefreshing)}>
              {selectedOpportunityBar}
              <VirtualDataTable
                columns={opportunityColumns}
                emptyMessage={quantReady ? '当前筛选条件没有可展示的关键词机会。' : '缺少真实报表和导入指标，关键词机会保持阻断。'}
                estimateSize={72}
                getRowKey={rowKey}
                loading={loading}
                minWidth="1180px"
                onSortChange={handleSortChange}
                onRowSelect={(row) => setSelectedOpportunityKey(rowKey(row))}
                rowAriaLabel={(row) => `选择关键词机会 ${row.keyword}`}
                rows={visibleRows}
                selectedRowKey={selectedOpportunityKey}
                sortDirection={sortState.direction}
                sortKey={sortState.key}
              />
            </div>
          ) : quantReady ? (
            <div className="keyword-opportunity-empty-state" role="status" aria-live="polite">
              <div>
                <span>{quantReady ? '当前没有关键词机会' : '关键词机会阻断'}</span>
                <strong>{activeFilterCount ? '筛选后没有结果' : quantReady ? '未识别到可带入 Listing 的对象' : '先完成真实报表入库'}</strong>
                <p>
                  {activeFilterCount
                    ? '清空高级筛选后再复核全量机会。'
                    : quantReady
                      ? '可以刷新机会识别；如果仍为空，说明当前范围暂时没有符合规则的 search term / keyword / targeting。'
                      : '需要先完成 8 类真实报表采集和导入校验，不能用截图或审计文件生成关键词机会。'}
                </p>
              </div>
              <div className="action-row">
                <button className="secondary-button" disabled={!activeFilterCount} onClick={() => setFilters({ ...EMPTY_KEYWORD_FILTERS })} type="button">清空筛选</button>
                <button aria-busy={refreshOpportunityButton.ariaBusy} className={refreshOpportunityButton.className} disabled={refreshOpportunityButton.disabled} onClick={loadRows} type="button">
                  {refreshOpportunityButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                  <span>{refreshOpportunityButton.label}</span>
                </button>
              </div>
            </div>
          ) : null}
          {quantReady && <p className="muted-line">筛选、排序和选中行只改变当前视图；点击“带入 Listing”后仍需在 Listing 优化页读取真实 Listing 并人工复核。</p>}
        </Panel>

        {filterModalOpen && (
          <div
            className="product-config-modal-backdrop keyword-filter-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeFilterModal();
            }}
            role="presentation"
          >
            <section
              aria-labelledby="keyword-filter-modal-title"
              aria-modal="true"
              className="product-config-modal keyword-filter-modal"
              onKeyDown={handleFilterModalKeyDown}
              onMouseDown={(event) => event.stopPropagation()}
              role="dialog"
            >
              <header className="product-config-modal-header">
                <div>
                  <span>只影响当前关键词机会表，不改报表、不写 Listing</span>
                  <h2 id="keyword-filter-modal-title">筛选关键词机会</h2>
                </div>
                <div className="keyword-filter-modal-header-actions">
                  <StatusPill tone={activeFilterCount ? 'warning' : 'pending'}>{activeFilterCount ? `${activeFilterCount} 个筛选` : '未筛选'}</StatusPill>
                  <button className="secondary-button compact-button" onClick={closeFilterModal} type="button">关闭</button>
                </div>
              </header>
              <div className="product-config-modal-body keyword-filter-modal-body">
                <div className="filter-grid" aria-label="关键词机会筛选字段">
                  <KeywordOpportunityFilterCell hint="只看某个产品的关键词机会；留空显示当前范围全部产品。" label="ASIN">
                    <input value={filters.asin} onChange={(event) => setFilters({ ...filters, asin: event.target.value })} placeholder="B0..." />
                  </KeywordOpportunityFilterCell>
                  <KeywordOpportunityFilterCell hint="按广告活动名称缩小范围，不会修改导入报表。" label="广告活动">
                    <input value={filters.campaign} onChange={(event) => setFilters({ ...filters, campaign: event.target.value })} placeholder="广告活动名称" />
                  </KeywordOpportunityFilterCell>
                  <KeywordOpportunityFilterCell hint="锁定具体测词单元，适合复核同词不同组表现。" label="广告组">
                    <input value={filters.adGroup} onChange={(event) => setFilters({ ...filters, adGroup: event.target.value })} placeholder="广告组名称" />
                  </KeywordOpportunityFilterCell>
                  <KeywordOpportunityFilterCell hint="区分已覆盖、未覆盖和需要补入 Listing 的机会。" label="覆盖状态">
                    <select value={filters.coverageStatus} onChange={(event) => setFilters({ ...filters, coverageStatus: event.target.value })}>
                      <option value="">全部</option>
                      {coverageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </KeywordOpportunityFilterCell>
                  <KeywordOpportunityFilterCell hint="过滤低样本对象，避免点击太少造成误判。" label="最低点击">
                    <input min="0" type="number" value={filters.minClicks} onChange={(event) => setFilters({ ...filters, minClicks: event.target.value })} />
                  </KeywordOpportunityFilterCell>
                  <KeywordOpportunityFilterCell hint="单位 USD；用于优先暴露真实花费风险和高价值机会。" label="最低花费">
                    <input min="0" step="0.01" type="number" value={filters.minSpend} onChange={(event) => setFilters({ ...filters, minSpend: event.target.value })} />
                  </KeywordOpportunityFilterCell>
                  <KeywordOpportunityFilterCell hint="high 优先进入标题/五点覆盖复核，low 只保留观察。" label="机会等级">
                    <select value={filters.opportunityLevel} onChange={(event) => setFilters({ ...filters, opportunityLevel: event.target.value })}>
                      <option value="">全部</option>
                      <option value="high">high</option>
                      <option value="medium">medium</option>
                      <option value="low">low</option>
                    </select>
                  </KeywordOpportunityFilterCell>
                </div>
              </div>
              <footer className="product-config-modal-footer">
                <button className="secondary-button" disabled={!activeFilterCount} onClick={() => setFilters({ ...EMPTY_KEYWORD_FILTERS })} type="button">
                  清空筛选
                </button>
                <button className="primary-button" onClick={closeFilterModal} type="button">
                  应用并返回列表
                </button>
              </footer>
            </section>
          </div>
        )}

        {opportunityDetailOpen && selectedOpportunity && (() => {
          const importedRows = sourceImportRows(selectedOpportunity);
          const listingHandoffButton = keywordOpportunityActionButtonView({
            active: false,
            baseClassName: 'primary-button',
            busyLabel: '处理中...',
            disabled: !quantReady,
            groupBusy: keywordActionBusy,
            label: '带入 Listing',
          });
          return (
            <div
              className="product-config-modal-backdrop keyword-opportunity-detail-backdrop"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeOpportunityDetail();
              }}
              role="presentation"
            >
              <section
                aria-labelledby="keyword-opportunity-detail-title"
                aria-modal="true"
                className="product-config-modal keyword-opportunity-detail-modal"
                onKeyDown={handleOpportunityDetailKeyDown}
                onMouseDown={(event) => event.stopPropagation()}
                role="dialog"
              >
                <header className="product-config-modal-header">
                  <div>
                    <span>来源证据只读，不写 Listing，不改广告</span>
                    <h2 id="keyword-opportunity-detail-title">{selectedOpportunity.keyword}</h2>
                  </div>
                  <div className="keyword-filter-modal-header-actions">
                    <StatusPill tone={selectedOpportunity.opportunityLevel === 'high' ? 'warning' : 'pending'}>{selectedOpportunity.opportunityLevel}</StatusPill>
                    <button className="secondary-button compact-button" onClick={closeOpportunityDetail} type="button">关闭</button>
                  </div>
                </header>
                <div className="product-config-modal-body keyword-opportunity-detail-body">
                  <div className="keyword-opportunity-detail-grid" aria-label="关键词机会来源证据">
                    <div><span>ASIN</span><strong>{selectedOpportunity.asin || '-'}</strong></div>
                    <div><span>广告活动</span><strong>{selectedOpportunity.campaignName || '-'}</strong></div>
                    <div><span>广告组</span><strong>{selectedOpportunity.adGroupName || '-'}</strong></div>
                    <div><span>对象类型</span><strong>{selectedOpportunity.entityType}</strong></div>
                    <div><span>覆盖状态</span><strong>{selectedOpportunity.coverageStatus || '-'}</strong></div>
                    <div><span>点击 / 订单</span><strong>{selectedOpportunity.clicks} / {selectedOpportunity.orders}</strong></div>
                    <div><span>花费 / 销售</span><strong>{formatUsd(selectedOpportunity.spend)} / {formatUsd(selectedOpportunity.sales)}</strong></div>
                    <div><span>ACOS</span><strong>{formatPercent(selectedOpportunity.acos * 100)}</strong></div>
                    <div><span>导入行数</span><strong>{importedRows === null ? '文件未匹配' : `${importedRows} 行`}</strong></div>
                    <div><span>批次</span><strong>{batchId}</strong></div>
                  </div>
                  <div className="keyword-opportunity-source-block">
                    <span>来源文件</span>
                    <strong>{selectedOpportunity.sourceFile || '-'}</strong>
                  </div>
                  <div className="keyword-opportunity-next-block">
                    <span>建议处理</span>
                    <strong>{selectedOpportunity.orders > 0 || selectedOpportunity.sales > 0 ? '带入 Listing 覆盖复核' : '先控投放风险，再决定是否进入 Listing'}</strong>
                    <p>{selectedOpportunity.risk}</p>
                  </div>
                </div>
                <footer className="product-config-modal-footer">
                  <button className="secondary-button" onClick={closeOpportunityDetail} type="button">关闭</button>
                  <button aria-busy={listingHandoffButton.ariaBusy} className={listingHandoffButton.className} disabled={listingHandoffButton.disabled} onClick={() => handoffToListing(selectedOpportunity)} type="button">
                    {listingHandoffButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                    <span>{listingHandoffButton.label}</span>
                  </button>
                </footer>
              </section>
            </div>
          );
        })()}

        <details className="folded-ops-panel">
          <summary>
            <span>机会口径、来源和复核摘要</span>
            <StatusPill tone={quantReady ? 'ready' : 'blocked'}>{sourceBatchText || batchId}</StatusPill>
          </summary>
          <div className="folded-ops-body">
            <div className="context-summary-grid">
              <div>
                <span>真实广告报表</span>
                <strong>{sourceReportCount}/8 类真实报表</strong>
                <p>只接收当前范围下载目录中的 xlsx/xls/csv；审计文件、截图和 DOM 证据不算广告数据。</p>
              </div>
              <div>
                <span>去重口径</span>
                <strong>店铺 / 站点 / ASIN / 活动 / 组 / 对象 / 关键词</strong>
                <p><ScopeText scope={data?.scope || scope} /></p>
              </div>
              <div>
                <span>高优先级机会</span>
                <strong>{highOpportunityCount}</strong>
                <p>{convertingCount} 个词或对象已有订单/销售，可优先进入 Listing 覆盖复核。</p>
              </div>
              <div>
                <span>优先复核对象</span>
                <strong>{topOpportunity?.keyword || '-'}</strong>
                <p>{topOpportunity ? `${topOpportunity.campaignName || '-'} / ${topOpportunity.adGroupName || '-'}` : '暂无机会'}</p>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
