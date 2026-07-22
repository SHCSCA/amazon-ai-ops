import { useEffect, useMemo, useRef, useState } from 'react';
import { useScopeStore } from '../scope-store';
import { toUserFacingError } from '../user-facing-error';
import type {
  BusinessDataPipeline,
  BusinessReportOptionStatus,
  OperationEventView,
  OperationScope,
} from '../types';

export const DEFAULT_BUSINESS_REPORT_OPTIONS: BusinessReportOptionStatus[] = [
  { type: 'campaign', label: '广告活动报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
  { type: 'ad_group', label: '广告组报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
  { type: 'placement', label: '广告位报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
  { type: 'advertised_product', label: '广告（推广的商品）报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
  { type: 'auto_targeting', label: '自动投放报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
  { type: 'keyword', label: '关键词报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
  { type: 'product_targeting', label: '商品投放报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
  { type: 'user_search_term', label: '用户搜索词报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
];

export const BUSINESS_PIPELINE_SCOPE_DEBOUNCE_MS = 300;

export type BusinessPipelineMode = 'scope' | 'portfolio';

export function businessPipelineRequestScope(
  scope: OperationScope,
  mode: BusinessPipelineMode = 'scope',
): OperationScope {
  if (mode === 'scope') return scope;
  return { ...scope, asin: undefined };
}

export function businessPipelineScopeKey(
  scope: OperationScope,
  mode: BusinessPipelineMode = 'scope',
): string {
  return [
    scope.dateFrom,
    scope.dateTo,
    scope.storeName,
    scope.marketplaceCode,
    mode === 'portfolio' ? '' : scope.asin || '',
    scope.batchId || '',
  ].join('|');
}

export function businessPipelineLoadDelay(input: { firstLoad: boolean; reloadChanged: boolean }): number {
  if (input.firstLoad || input.reloadChanged) return 0;
  return BUSINESS_PIPELINE_SCOPE_DEBOUNCE_MS;
}

function emptyPipeline(scope: OperationScope, reason: string): BusinessDataPipeline {
  return {
    scope,
    generatedAt: new Date().toISOString(),
    collection: {
      status: 'blocked',
      latestBatch: null,
      sourceBatchIds: [],
      availableBatches: [],
      reportOptions: DEFAULT_BUSINESS_REPORT_OPTIONS,
      realReportFiles: [],
      evidenceArtifacts: [],
      fileAudit: {
        totalFileRecords: 0,
        downloadedFileRecords: 0,
        existingFileRecords: 0,
        realReportFileCount: 0,
        importedRowCount: 0,
        rejectedEvidenceFileCount: 0,
        missingReportLabels: DEFAULT_BUSINESS_REPORT_OPTIONS.map((item) => item.label),
      },
      blockers: ['当前范围还没有可量化的真实广告数据', reason],
      audit: {
        databaseReady: false,
        acceptedExtensions: ['.xlsx', '.xls', '.csv'],
        rejectedEvidenceExtensions: ['.json', '.png', '.html'],
        notes: ['桌面端数据接口不可用时，前端会保持阻断状态，防止把空数据当成可量化数据。'],
      },
    },
    quant: {
      hasImportedMetrics: false,
      importedRows: 0,
      summarySource: 'blocked',
      totalSpend: 0,
      totalSales: 0,
      totalOrders: 0,
      totalClicks: 0,
      totalImpressions: 0,
      acos: 0,
      cvr: 0,
      cpc: 0,
      wastedSpend: null,
      highRiskCount: 0,
      adObjectTimelines: [],
      diagnostics: [],
      blockers: ['没有真实报表文件和导入指标，本页不生成建议。'],
    },
    operations: {
      events: [],
      eventCount: 0,
      notes: ['运营事件接口不可用时，AI 诊断不会获得活动、价格、Listing、库存等人工背景。'],
    },
    productContext: {
      products: [],
      productCount: 0,
      notes: ['产品配置接口不可用时，AI 阈值建议不会获得成本、利润和产品阶段背景。'],
    },
  };
}

export function useBusinessDataPipeline(options: { mode?: BusinessPipelineMode } = {}) {
  const scope = useScopeStore((state) => state.scope);
  const mode = options.mode ?? 'scope';
  const [data, setData] = useState<BusinessDataPipeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const firstLoadRef = useRef(true);
  const previousReloadTokenRef = useRef(reloadToken);

  const scopeKey = useMemo(
    () => businessPipelineScopeKey(scope, mode),
    [mode, scope.asin, scope.batchId, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName],
  );
  // In portfolio mode the request scope intentionally remains stable when only
  // the globally locked ASIN changes. The hook still returns the live global
  // scope below so callers never lose the authoritative selection context.
  const requestScope = useMemo(
    () => businessPipelineRequestScope(scope, mode),
    [mode, scopeKey],
  );

  useEffect(() => {
    let cancelled = false;
    const reloadChanged = reloadToken !== previousReloadTokenRef.current;
    const loadDelay = businessPipelineLoadDelay({ firstLoad: firstLoadRef.current, reloadChanged });
    previousReloadTokenRef.current = reloadToken;
    firstLoadRef.current = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const api = (window as any).electronAPI;
        if (!api?.getBusinessUiDataPipeline) {
          throw new Error('只读数据接口未暴露');
        }
        const nextData = await api.getBusinessUiDataPipeline(requestScope);
        let operationEvents: OperationEventView[] | null = null;
        let operationNotes = nextData?.operations?.notes || [];
        // Product-scoped pipeline events already include global events; ASIN list queries do not.
        if (api.listOperationEvents && !requestScope.asin) {
          try {
            const rows = await api.listOperationEvents({ ...requestScope, limit: 300 });
            operationEvents = Array.isArray(rows) ? rows : [];
          } catch (caught) {
            operationNotes = [
              ...operationNotes,
              toUserFacingError(caught, '读取运营事件失败，AI 上下文将缺少活动/价格/Listing/库存背景。'),
            ];
          }
        }
        const mergedData: BusinessDataPipeline = {
          ...nextData,
          operations: {
            events: operationEvents ?? nextData?.operations?.events ?? [],
            eventCount: operationEvents?.length ?? nextData?.operations?.eventCount ?? nextData?.operations?.events?.length ?? 0,
            notes: operationNotes,
          },
        };
        if (!cancelled) {
          setData(mergedData);
        }
      } catch (caught) {
        const message = toUserFacingError(caught, '读取当前运营范围数据失败。');
        if (!cancelled) {
          setError(message);
          setData(emptyPipeline(requestScope, message));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    setError(null);
    const timeout = window.setTimeout(load, loadDelay);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [requestScope, scopeKey, reloadToken]);

  useEffect(() => {
    const refresh = () => setReloadToken((current) => current + 1);
    window.addEventListener('business-ui:data-updated', refresh);
    return () => window.removeEventListener('business-ui:data-updated', refresh);
  }, []);

  return {
    data,
    error,
    loading,
    scope,
    reload: () => setReloadToken((current) => current + 1),
  };
}

export function ScopeText({ scope }: { scope: OperationScope }) {
  return (
    <span>
      {scope.dateFrom} ~ {scope.dateTo} / {scope.storeName || '-'} / {scope.marketplaceCode || '-'} / USD
      {scope.asin ? ` / ${scope.asin}` : ''}
    </span>
  );
}
