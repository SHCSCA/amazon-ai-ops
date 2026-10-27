import { BusinessDataConfigurationGuard } from '../components/business-data-configuration';
import { rendererRuntimeLog } from '../runtime-log';
import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import { usePageOperation } from './use-page-operation';
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useBusinessDataPipeline,
  ScopeText,
} from '../components/business-data';
import { ProgressiveDetails } from '../components/progressive-details';
import {
  PageHeader,
  Panel,
  StatusPill,
} from '../components/ui';
import { TaskBanner } from '../components/workspace';
import { useOverlayFocusScope } from '../components/workspace/overlay-focus-scope';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import {
  VirtualDataTable,
  type VirtualDataTableColumn,
} from '../components/virtual-data-table';
import {
  formatPercent,
  formatUsd,
} from '../formatters';
import {
  hasFormalReportCoverage,
  hasRealReportCoverage,
  importedReportTypeCoverageCount,
  realReportCoverageCount,
} from '../report-coverage';
import { useScopeStore } from '../scope-store';
import type {
  KeywordOpportunityView,
  ListingHandoffPayload,
  OperationScope,
} from '../types';
import {
  errorMessage,
  buildKeywordOpportunityFilterFeedback,
  keywordOpportunityActionButtonView,
  navigate,
  keywordOpportunityTableFeedbackClass,
  KeywordOpportunityFilterCell,
} from "./keyword-opportunities-feedback";
import {
  type KeywordOpportunitySortState,
  type KeywordOpportunityTaskIntent,
} from "./keyword-opportunities-contracts";
import {
  sortKeywordOpportunities,
  keywordOpportunitySortLabel,
  isKeywordOpportunitySortKey,
  nextKeywordOpportunitySort,
} from "./keyword-opportunities-sorting";
import { EMPTY_KEYWORD_FILTERS } from "./keyword-opportunities-constants";
import { buildKeywordOpportunityTaskModel } from "./keyword-opportunities-task-model";
import {
  createKeywordOpportunityRequestGate,
  keywordOpportunityScopeKey,
} from "./keyword-opportunities-scope";

export function KeywordOpportunitiesPage() {
  const { data, scope, configurationRequired } = useBusinessDataPipeline();
  const setScope = useScopeStore((state) => state.setScope);
  const didMountFilterFeedback = useRef(false);
  const requestGateRef = useRef(createKeywordOpportunityRequestGate());
  const rowsAuthorityScopeRef = useRef<OperationScope | null>(null);
  const [rows, setRows] = useState<KeywordOpportunityView[]>([]);
  const [rowsScopeKey, setRowsScopeKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [readOrigin, setReadOrigin] = useState<'automatic' | 'task' | 'toolbar' | 'empty'>('automatic');
  const [message, setMessage] = useState<string | null>(null);
  const [selectedOpportunityKey, setSelectedOpportunityKey] = useState<React.Key | null>(null);
  const [opportunityDetailOpen, setOpportunityDetailOpen] = useState(false);
  const [tableRefreshing, setTableRefreshing] = useState(false);
  const [filters, setFilters] = useState({ ...EMPTY_KEYWORD_FILTERS });
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [sortState, setSortState] = useState<KeywordOpportunitySortState>({ key: 'opportunityLevel', direction: 'desc' });
  const quantReady = Boolean(hasFormalReportCoverage(data?.collection) && data?.quant.hasImportedMetrics);
  const currentBatchId = scope.batchId || data?.collection.latestBatch?.id;
  const batchId = currentBatchId || '-';
  const requestScope: OperationScope = { ...scope, batchId: currentBatchId };
  const requestScopeKey = keywordOpportunityScopeKey(requestScope);
  const pageOperation = usePageOperation(requestScopeKey);
  requestGateRef.current.activate(requestScopeKey);

  async function loadRows(origin: 'automatic' | 'task' | 'toolbar' | 'empty' = 'toolbar') {
    if (!pageOperation.hasAuthority) {
      setRows([]); setRowsScopeKey(null); setLoading(false);
      setMessage(pageOperation.blockedReason);
      return;
    }
    const ticket = pageOperation.begin();
    if (!ticket) return;
    const requestedScope = { ...requestScope };
    const request = requestGateRef.current.begin(requestScopeKey);
    if (!quantReady) {
      setRows([]);
      setRowsScopeKey(null);
      rowsAuthorityScopeRef.current = null;
      setSelectedOpportunityKey(null);
      setMessage('缺少当前范围真实报表和导入指标，关键词机会保持阻断。');
      setLoading(false);
      ticket.finish();
      return;
    }
    setReadOrigin(origin);
    setLoading(true);
    setMessage(null);
    try {
      const read = (window as any).electronAPI?.getBusinessKeywordOpportunities;
      if (typeof read !== 'function') throw new Error('关键词机会读取接口不可用，请重新连接当前店铺后重试。');
      const result = await read(requestedScope);
      if (!ticket.isCurrent() || !requestGateRef.current.isCurrent(request)) return;
      rowsAuthorityScopeRef.current = requestedScope;
      setRowsScopeKey(pageOperation.contextKey);
      setRows(Array.isArray(result) ? result : []);
    } catch (caught) {
      rendererRuntimeLog.error('renderer.keyword_opportunities_workspace.failed', { error: caught });
      if (!ticket.isCurrent() || !requestGateRef.current.isCurrent(request)) return;
      rowsAuthorityScopeRef.current = null;
      setRowsScopeKey(null);
      setRows([]);
      setMessage(errorMessage(caught, '加载关键词机会失败'));
    } finally {
      if (ticket.isCurrent() && requestGateRef.current.isCurrent(request)) setLoading(false);
      ticket.finish();
    }
  }

  useEffect(() => {
    if (!quantReady) {
      setRows([]);
      setRowsScopeKey(null);
      rowsAuthorityScopeRef.current = null;
      setSelectedOpportunityKey(null);
      setMessage(null);
      setLoading(false);
      return;
    }
    void loadRows('automatic');
  }, [quantReady, requestScopeKey, pageOperation.contextKey]);

  const rowsBelongToCurrentScope = rowsScopeKey === pageOperation.contextKey;
  const filteredRows = useMemo(() => (rowsBelongToCurrentScope ? rows : []).filter((row) => {
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
  }), [filters, rows, rowsBelongToCurrentScope]);

  const coverageOptions = quantReady && rowsBelongToCurrentScope ? Array.from(new Set(rows.map((row) => row.coverageStatus).filter(Boolean))) : [];
  const sortedRows = useMemo(() => sortKeywordOpportunities(filteredRows, sortState), [filteredRows, sortState]);
  const visibleRows = quantReady && rowsBelongToCurrentScope ? sortedRows : [];
  const visibleRowCount = quantReady && rowsBelongToCurrentScope ? rows.length : 0;
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
    active: loading && readOrigin === 'toolbar',
    baseClassName: 'secondary-button',
    busyLabel: '刷新中...',
    disabled: loading || !quantReady || !pageOperation.hasAuthority,
    label: '刷新机会',
  });
  const emptyRefreshButton = keywordOpportunityActionButtonView({
    active: loading && readOrigin === 'empty', baseClassName: 'secondary-button',
    busyLabel: '刷新中...', disabled: loading || !quantReady || !pageOperation.hasAuthority, label: '刷新机会',
  });
  const highOpportunityCount = visibleRows.filter((row) => row.opportunityLevel === 'high').length;
  const convertingCount = visibleRows.filter((row) => row.orders > 0 || row.sales > 0).length;
  const noOrderSpend = visibleRows.filter((row) => row.spend > 0 && row.orders === 0).reduce((sum, row) => sum + row.spend, 0);
  const sourceReportCount = realReportCoverageCount(data?.collection);
  const importedReportTypeCount = importedReportTypeCoverageCount(data?.collection);
  const importedMetricRows = data?.collection.fileAudit?.importedRowCount ?? data?.quant.importedRows ?? 0;
  const asinCount = new Set(visibleRows.map((row) => row.asin).filter(Boolean)).size;
  const campaignCount = new Set(visibleRows.map((row) => row.campaignName).filter(Boolean)).size;
  const adGroupCount = new Set(visibleRows.map((row) => row.adGroupName).filter(Boolean)).size;
  const sourceBatchText = (scope.batchId ? [scope.batchId] : (data?.collection.sourceBatchIds?.length ? data.collection.sourceBatchIds : [batchId])).filter(Boolean).join(', ');

  function closeFilterModal() {
    setFilterModalOpen(false);
  }

  function closeOpportunityDetail() {
    setOpportunityDetailOpen(false);
  }

  const keywordFilterDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    onDismiss: closeFilterModal,
    open: filterModalOpen,
  });
  const opportunityDetailDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    onDismiss: closeOpportunityDetail,
    open: opportunityDetailOpen,
  });

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
  const keywordTaskModel = buildKeywordOpportunityTaskModel({
    quantReady,
    loading,
    rowCount: visibleRows.length,
    selectedKeyword: selectedOpportunity?.keyword,
  });

  function runKeywordTaskIntent(intent: KeywordOpportunityTaskIntent) {
    if (intent === 'import-validation') {
      navigate('data-import-validation');
      return;
    }
    if (intent === 'data-collection') {
      navigate('data-collection');
      return;
    }
    if (intent === 'refresh') {
      void loadRows('task');
      return;
    }
    if (intent === 'filter') {
      setFilterModalOpen(true);
      return;
    }
    if (intent === 'show-source') {
      if (selectedOpportunity) setOpportunityDetailOpen(true);
      return;
    }
    if (intent === 'review-first') {
      if (!topOpportunity) return;
      setSelectedOpportunityKey(rowKey(topOpportunity));
      setOpportunityDetailOpen(true);
      return;
    }
    if (intent === 'handoff-listing' && selectedOpportunity) {
      handoffToListing(selectedOpportunity);
    }
  }

  const keywordSecondaryActions = keywordTaskModel.secondaryIntents.map((intent) => ({
    disabledReason: '正在读取关键词机会，请等待完成后调整筛选或复核对象。',
    label: {
      'data-collection': '去数据采集',
      filter: '调整筛选',
      refresh: '重新读取机会',
      'show-source': '复核来源证据',
      'import-validation': '去导入校验',
      'review-first': '复核首个机会',
      'handoff-listing': '带入 Listing',
    }[intent],
    onClick: () => runKeywordTaskIntent(intent),
  }));

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
      const sourceReferences = [
        file.sourceArtifactId,
        file.artifactId,
        file.artifactDisplayName,
        file.fileName,
        file.displayName,
      ].map((value) => String(value || '').trim().replace(/\\/g, '/').toLowerCase()).filter(Boolean);
      return sourceReferences.includes(normalized)
        || (Boolean(sourceFileName) && sourceReferences.some((value) => value.split('/').filter(Boolean).pop() === sourceFileName));
    });
    return matched?.importedRows ?? null;
  }

  function handoffToListing(row: KeywordOpportunityView) {
    if (!quantReady) {
      setMessage('缺少当前范围真实报表和导入指标，不能带入 Listing 优化。');
      return;
    }
    const authoritativeScope = rowsAuthorityScopeRef.current;
    if (rowsScopeKey !== pageOperation.contextKey || !authoritativeScope) {
      setMessage('关键词机会已因范围变化失效，请先刷新当前范围后再带入 Listing。');
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
        dateFrom: authoritativeScope.dateFrom,
        dateTo: authoritativeScope.dateTo,
        storeName: authoritativeScope.storeName,
        marketplaceCode: authoritativeScope.marketplaceCode,
        batchId: authoritativeScope.batchId,
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
        label: '交接到 Listing',
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
            <WorkspaceActionButton disabledReason={!pageOperation.hasAuthority ? pageOperation.blockedReason : loading ? '正在刷新关键词机会，请等待完成后选择对象。' : '请先在当前关键词队列选择一条带 ASIN 的机会，再交接到 Listing。'} aria-busy={listingHandoffButton.ariaBusy} className={listingHandoffButton.className} disabled={listingHandoffButton.disabled} onClick={() => handoffToListing(selectedOpportunity)} type="button">
              {listingHandoffButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
              <span>{listingHandoffButton.label}</span>
            </WorkspaceActionButton>
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
<BusinessDataConfigurationGuard configurationRequired={configurationRequired}>


      <div className="business-stack keyword-opportunity-page-stack">
        <TaskBanner
          description={keywordTaskModel.description}
          primaryAction={{
            busy: keywordTaskModel.primaryBusy && (readOrigin === 'task' || readOrigin === 'automatic'),
            disabled: loading,
            disabledReason: !pageOperation.hasAuthority ? pageOperation.blockedReason : '正在读取关键词机会，请等待刷新完成后重试。',
            busyLabel: '刷新中...',
            label: keywordTaskModel.primaryLabel,
            onClick: () => runKeywordTaskIntent(keywordTaskModel.primaryIntent),
          }}
          secondaryActions={keywordSecondaryActions}
          status={<StatusPill tone={keywordTaskModel.tone === 'confirmed' ? 'ready' : keywordTaskModel.tone === 'blocked' ? 'blocked' : 'pending'}>{keywordTaskModel.statusLabel}</StatusPill>}
          title={keywordTaskModel.title}
          tone={keywordTaskModel.tone}
        />

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
                  <WorkspaceActionButton disabledReason={!pageOperation.hasAuthority ? pageOperation.blockedReason : loading ? '正在读取关键词机会，请等待刷新完成后重试。' : '请先在报表采集与导入检查中补齐当前范围的真实报表和指标。'} aria-busy={refreshOpportunityButton.ariaBusy} className={refreshOpportunityButton.className} disabled={refreshOpportunityButton.disabled} onClick={() => { void loadRows('toolbar'); }} type="button">
                    {refreshOpportunityButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                    <span>{refreshOpportunityButton.label}</span>
                  </WorkspaceActionButton>
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
                  <StatusPill tone="blocked">报表文件 {sourceReportCount}/8 · 逐类入库 {importedReportTypeCount}/8 · {importedMetricRows} 行</StatusPill>
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
                <WorkspaceActionButton disabledReason={'当前没有筛选条件；请先设置筛选，再清空恢复全部对象。'} className="secondary-button compact-button" disabled={!activeFilterCount} onClick={() => setFilters({ ...EMPTY_KEYWORD_FILTERS })} type="button">
                  清空筛选
                </WorkspaceActionButton>
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
                <WorkspaceActionButton disabledReason={'当前没有筛选条件；请先设置筛选，再清空恢复全部对象。'} className="secondary-button" disabled={!activeFilterCount} onClick={() => setFilters({ ...EMPTY_KEYWORD_FILTERS })} type="button">清空筛选</WorkspaceActionButton>
                <WorkspaceActionButton disabledReason={!pageOperation.hasAuthority ? pageOperation.blockedReason : loading ? '正在读取关键词机会，请等待刷新完成后重试。' : '请先在报表采集与导入检查中补齐当前范围的真实报表和指标。'} aria-busy={emptyRefreshButton.ariaBusy} className={emptyRefreshButton.className} disabled={emptyRefreshButton.disabled} onClick={() => { void loadRows('empty'); }} type="button">
                  {emptyRefreshButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                  <span>{emptyRefreshButton.label}</span>
                </WorkspaceActionButton>
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
            ref={keywordFilterDialogFocus.overlayRootRef}
            role="presentation"
          >
            <section
              aria-labelledby="keyword-filter-modal-title"
              aria-modal="true"
              className="product-config-modal keyword-filter-modal"
              onMouseDown={(event) => event.stopPropagation()}
              ref={keywordFilterDialogFocus.surfaceRef}
              role="dialog"
              tabIndex={-1}
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
                <WorkspaceActionButton disabledReason={'当前没有筛选条件；请先设置筛选，再清空恢复全部对象。'} className="secondary-button" disabled={!activeFilterCount} onClick={() => setFilters({ ...EMPTY_KEYWORD_FILTERS })} type="button">
                  清空筛选
                </WorkspaceActionButton>
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
              ref={opportunityDetailDialogFocus.overlayRootRef}
              role="presentation"
            >
              <section
                aria-labelledby="keyword-opportunity-detail-title"
                aria-modal="true"
                className="product-config-modal keyword-opportunity-detail-modal"
                onMouseDown={(event) => event.stopPropagation()}
                ref={opportunityDetailDialogFocus.surfaceRef}
                role="dialog"
                tabIndex={-1}
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
                  <WorkspaceActionButton disabledReason={!pageOperation.hasAuthority ? pageOperation.blockedReason : loading ? '正在刷新关键词机会，请等待完成后选择对象。' : '请先在当前关键词队列选择一条带 ASIN 的机会，再交接到 Listing。'} aria-busy={listingHandoffButton.ariaBusy} className={listingHandoffButton.className} disabled={listingHandoffButton.disabled} onClick={() => handoffToListing(selectedOpportunity)} type="button">
                    {listingHandoffButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                    <span>{listingHandoffButton.label}</span>
                  </WorkspaceActionButton>
                </footer>
              </section>
            </div>
          );
        })()}

        <ProgressiveDetails title="机会口径、来源和复核摘要">
          <div className="keyword-opportunity-evidence-block">
            <div className="business-split">
              <h3>技术依据与机会口径</h3>
              <StatusPill tone={quantReady ? 'ready' : 'blocked'}>{sourceBatchText || batchId}</StatusPill>
            </div>
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
          </div>
        </ProgressiveDetails>
      </div>
    
</BusinessDataConfigurationGuard>
</div>
  );
}
