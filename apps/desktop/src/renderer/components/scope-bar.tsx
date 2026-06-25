import React, { useEffect, useMemo, useState } from 'react';
import { useScopeStore } from '../scope-store';
import { toUserFacingError } from '../user-facing-error';
import type { BusinessBatchOption } from '../types';
import { ProgressiveDetails } from './progressive-details';

const AUTO_BATCH_VALUE = '__auto__';
const MANUAL_BATCH_VALUE = '__manual__';
const REQUIRED_REPORT_COUNT = 8;

function cleanCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

function formatReportCoverage(batch: Partial<BusinessBatchOption>): string {
  const coverage = cleanCount(batch.realReportFileCount);
  if (coverage === null) return '报表覆盖待校验';
  const cappedCoverage = Math.min(REQUIRED_REPORT_COUNT, coverage);
  const fileCount = cleanCount(batch.totalFileRecords);
  const fileSuffix = fileCount !== null && fileCount > cappedCoverage ? ` · ${fileCount} 个文件` : '';
  return `${cappedCoverage}/${REQUIRED_REPORT_COUNT} 类真实报表${fileSuffix}`;
}

function formatImportedRows(value: unknown, importedSuffix = ' 行已导入'): string {
  const rows = cleanCount(value);
  if (rows === null) return '指标待校验';
  return rows > 0 ? `${rows}${importedSuffix}` : '未导入';
}

export function formatBatchOption(batch: BusinessBatchOption): string {
  return `${batch.id} · ${formatReportCoverage(batch)} · ${formatImportedRows(batch.importedRowCount)}`;
}

type ScopeSummaryFact = {
  label: string;
  value: string;
  title?: string;
};

type ProductLabelRow = {
  asin?: string;
  title?: string;
  store_name?: string;
  marketplace_code?: string;
  storeName?: string;
  marketplaceCode?: string;
};

export function buildScopeSummaryFacts(input: {
  batchId?: string;
  batchModeLabel: string;
  reportCoverage: string;
  importedRows: string;
  asin?: string;
  productLabel?: string;
}): ScopeSummaryFact[] {
  return [
    {
      label: '批次',
      value: input.batchId || '自动匹配',
      title: input.batchModeLabel,
    },
    { label: '报表', value: input.reportCoverage },
    { label: '指标', value: input.importedRows },
    { label: '产品', value: input.productLabel || input.asin?.trim() || '全部产品' },
  ];
}

export function buildScopeWarningSummary(input: {
  batchOptionsError?: string | null;
  scopePersistError?: string | null;
}): string | null {
  if (input.batchOptionsError?.trim() || input.scopePersistError?.trim()) {
    return '范围或批次需要处理，展开查看详情。';
  }
  return null;
}

export function ScopeBar() {
  const { scope, setScope } = useScopeStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(scope);
  const [batchOptions, setBatchOptions] = useState<BusinessBatchOption[]>([]);
  const [batchOptionsError, setBatchOptionsError] = useState<string | null>(null);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [editError, setEditError] = useState('');
  const [scopeHydrated, setScopeHydrated] = useState(false);
  const [scopePersistError, setScopePersistError] = useState('');
  const [products, setProducts] = useState<ProductLabelRow[]>([]);

  const selectedBatch = useMemo(
    () => batchOptions.find((batch) => batch.id === scope.batchId),
    [batchOptions, scope.batchId],
  );
  const autoMatchedBatch = useMemo(() => batchOptions[0], [batchOptions]);

  const save = () => {
    const normalizedDraft = {
      ...draft,
      dateFrom: draft.dateFrom.trim(),
      dateTo: draft.dateTo.trim(),
      storeName: draft.storeName.trim(),
      marketplaceCode: draft.marketplaceCode.trim(),
      asin: draft.asin?.trim() || undefined,
      batchId: draft.batchId?.trim() || undefined,
      currency: 'USD' as const,
    };
    if (!normalizedDraft.dateFrom || !normalizedDraft.dateTo) {
      setEditError('请填写开始日期和结束日期。');
      return;
    }
    if (normalizedDraft.dateFrom > normalizedDraft.dateTo) {
      setEditError('开始日期不能晚于结束日期。');
      return;
    }
    if (!normalizedDraft.storeName) {
      setEditError('请填写店铺。');
      return;
    }
    if (!normalizedDraft.marketplaceCode) {
      setEditError('请填写站点。');
      return;
    }
    setScope(normalizedDraft);
    setDraft(normalizedDraft);
    setEditing(false);
    setEditError('');
  };

  const applyScopePatch = (patch: Partial<typeof scope>) => {
    const nextScope = { ...scope, ...patch, currency: 'USD' as const };
    setScope(nextScope);
    setDraft(nextScope);
  };

  const updateRangeDraft = (patch: Partial<typeof scope>) => {
    setEditError('');
    setDraft((current) => ({ ...current, ...patch, batchId: undefined, currency: 'USD' as const }));
  };

  useEffect(() => {
    let cancelled = false;
    async function loadPersistedScope() {
      try {
        const api = (window as any).electronAPI;
        const savedScope = await api?.getOperationScope?.();
        if (cancelled) return;
        if (savedScope?.dateFrom && savedScope?.dateTo && savedScope?.storeName && savedScope?.marketplaceCode) {
          const normalizedScope = { ...savedScope, currency: 'USD' as const };
          setScope(normalizedScope);
          setDraft(normalizedScope);
        }
      } catch (caught) {
        if (!cancelled) {
          setScopePersistError(toUserFacingError(caught, '读取已保存运营范围失败。'));
        }
      } finally {
        if (!cancelled) setScopeHydrated(true);
      }
    }
    loadPersistedScope();
    return () => {
      cancelled = true;
    };
  }, [setScope]);

  useEffect(() => {
    if (!scopeHydrated) return;
    const api = (window as any).electronAPI;
    if (!api?.saveOperationScope) return;
    api.saveOperationScope(scope)
      .then(() => setScopePersistError(''))
      .catch((caught: unknown) => {
        setScopePersistError(toUserFacingError(caught, '保存运营范围失败。'));
      });
  }, [
    scopeHydrated,
    scope.dateFrom,
    scope.dateTo,
    scope.storeName,
    scope.marketplaceCode,
    scope.asin,
    scope.batchId,
    scope.currency,
  ]);

  useEffect(() => {
    const refresh = () => setReloadToken((current) => current + 1);
    window.addEventListener('business-ui:data-updated', refresh);
    return () => window.removeEventListener('business-ui:data-updated', refresh);
  }, []);

  useEffect(() => {
    const openEditor = () => {
      setDraft(scope);
      setEditError('');
      setEditing(true);
    };
    window.addEventListener('amazon-ai-ops:open-scope-editor', openEditor);
    return () => window.removeEventListener('amazon-ai-ops:open-scope-editor', openEditor);
  }, [scope]);

  useEffect(() => {
    let cancelled = false;
    async function loadProducts() {
      try {
        const rows = await (window as any).electronAPI?.getProducts?.();
        if (!cancelled) setProducts(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setProducts([]);
      }
    }
    loadProducts();
    window.addEventListener('business-ui:data-updated', loadProducts);
    return () => {
      cancelled = true;
      window.removeEventListener('business-ui:data-updated', loadProducts);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadBatchOptions() {
      setLoadingBatches(true);
      setBatchOptionsError(null);
      try {
        const api = (window as any).electronAPI;
        if (!api?.getBusinessBatchOptions) {
          throw new Error('批次列表接口未暴露');
        }
        const batches = await api.getBusinessBatchOptions(scope);
        if (!cancelled) {
          setBatchOptions(Array.isArray(batches) ? batches : []);
        }
      } catch (caught) {
        if (!cancelled) {
          setBatchOptions([]);
          setBatchOptionsError(toUserFacingError(caught, '读取当前范围批次失败。'));
        }
      } finally {
        if (!cancelled) setLoadingBatches(false);
      }
    }

    loadBatchOptions();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, scope.dateFrom, scope.dateTo, scope.storeName, scope.marketplaceCode]);

  const batchSelectValue = scope.batchId
    ? (selectedBatch ? scope.batchId : MANUAL_BATCH_VALUE)
    : AUTO_BATCH_VALUE;
  const batchModeLabel = scope.batchId
    ? (selectedBatch ? '手动指定已校验批次' : '手动批次待校验')
    : autoMatchedBatch ? '自动使用当前范围最新完整批次' : '自动匹配当前范围';
  const manualBatchUnmatched = Boolean(scope.batchId && !selectedBatch);
  const activeBatch = selectedBatch || (!scope.batchId ? autoMatchedBatch : undefined);
  const batchDataLabel = activeBatch
    ? formatReportCoverage(activeBatch)
    : manualBatchUnmatched ? '手动批次待校验'
    : loadingBatches ? '正在读取批次...' : '暂无匹配批次';
  const importedLabel = selectedBatch
    ? formatImportedRows(selectedBatch.importedRowCount, ' 行')
    : activeBatch ? formatImportedRows(activeBatch.importedRowCount, ' 行') : manualBatchUnmatched ? '待校验' : '0 行';
  const scopeHelperText = activeBatch
    ? `当前数据批次：${activeBatch.id}。批次只决定读取哪批真实报表和入库指标，不会自动重新下载。`
    : manualBatchUnmatched
      ? `当前使用手动批次：${scope.batchId}。该批次不在当前范围自动匹配列表中，后续页面会按这个 ID 尝试读取；如不确定，请切回“自动”。`
      : '当前未匹配到数据批次；需要先在数据采集页下载并导入真实广告表格。';
  const activeProduct = products.find((product) =>
    String(product.asin || '').trim().toUpperCase() === String(scope.asin || '').trim().toUpperCase()
    && (!(product.store_name || product.storeName) || (product.store_name || product.storeName) === scope.storeName)
    && (!(product.marketplace_code || product.marketplaceCode) || (product.marketplace_code || product.marketplaceCode) === scope.marketplaceCode)
  );
  const productLabel = scope.asin
    ? [activeProduct?.title, scope.asin].filter(Boolean).join(' / ') || scope.asin
    : '全部产品';
  const summaryFacts = buildScopeSummaryFacts({
    batchId: activeBatch?.id || scope.batchId,
    batchModeLabel,
    reportCoverage: batchDataLabel,
    importedRows: importedLabel,
    asin: scope.asin,
    productLabel,
  });
  const warningSummary = buildScopeWarningSummary({ batchOptionsError, scopePersistError });

  return (
    <section className="scope-bar" aria-label="当前运营范围">
      <div className="scope-title-row">
        <div className="scope-title-main">
          <span>当前操作范围</span>
          <strong>{scope.dateFrom} 至 {scope.dateTo} / {scope.storeName || '未选店铺'} / {scope.marketplaceCode || '未选站点'} / USD</strong>
        </div>
        <div className="scope-title-actions">
          <select
            aria-label="数据批次来源"
            value={batchSelectValue}
            onChange={(event) => {
              const value = event.target.value;
              if (value === AUTO_BATCH_VALUE) {
                applyScopePatch({ batchId: undefined });
                return;
              }
              if (value === MANUAL_BATCH_VALUE) {
                setDraft(scope);
                setEditing(true);
                return;
              }
              applyScopePatch({ batchId: value });
            }}
          >
            <option value={AUTO_BATCH_VALUE}>自动：使用当前范围最新完整批次</option>
            {batchOptions.map((batch) => (
              <option key={batch.id} value={batch.id}>{formatBatchOption(batch)}</option>
            ))}
            {scope.batchId && !selectedBatch && (
              <option value={MANUAL_BATCH_VALUE}>手动批次：{scope.batchId}</option>
            )}
            <option value={MANUAL_BATCH_VALUE}>手动输入批次 ID</option>
          </select>
          <button type="button" className="secondary-button compact-button" onClick={() => { setDraft(scope); setEditError(''); setEditing((value) => !value); }}>
            编辑范围
          </button>
        </div>
      </div>
      <div className="scope-compact-facts">
        {summaryFacts.map((fact) => (
          <span className="scope-fact" key={fact.label} title={fact.title}>
            <b>{fact.label}</b>
            {fact.value}
          </span>
        ))}
      </div>
      {warningSummary && (
        <div className="scope-visible-warning" role="status">
          {warningSummary}
        </div>
      )}
      <div className="scope-details-panel">
        <ProgressiveDetails title="范围与批次说明">
          <p>这是全局范围。数据采集、导入校验、广告量化、优化建议、审批回读、关键词机会和 Listing 草案都会按这里读取。</p>
          <p className="scope-helper">{scopeHelperText}</p>
          {(scope.batchId || batchOptionsError || scopePersistError) && (
            <div className="scope-batch-note" aria-label="范围与批次详情">
              {scope.batchId && (
                <span>{manualBatchUnmatched ? `手动批次未自动校验：${scope.batchId}` : `当前批次：${scope.batchId}`}</span>
              )}
              {batchOptionsError && (
                <span className="blocked-line">批次列表读取失败：{batchOptionsError}</span>
              )}
              {scopePersistError && (
                <span className="blocked-line">范围保存失败：{scopePersistError}</span>
              )}
            </div>
          )}
        </ProgressiveDetails>
      </div>
      {editing && (
        <div className="scope-editor">
          <label>
            开始日期
            <input type="date" value={draft.dateFrom} onChange={(event) => updateRangeDraft({ dateFrom: event.target.value })} />
          </label>
          <label>
            结束日期
            <input type="date" value={draft.dateTo} onChange={(event) => updateRangeDraft({ dateTo: event.target.value })} />
          </label>
          <label>
            店铺
            <input value={draft.storeName} onChange={(event) => updateRangeDraft({ storeName: event.target.value })} />
          </label>
          <label>
            站点
            <input value={draft.marketplaceCode} onChange={(event) => updateRangeDraft({ marketplaceCode: event.target.value })} />
          </label>
          <label>
            ASIN
            <input value={draft.asin || ''} onChange={(event) => setDraft({ ...draft, asin: event.target.value || undefined })} />
          </label>
          <label>
            数据批次
            <input value={draft.batchId || ''} onChange={(event) => setDraft({ ...draft, batchId: event.target.value || undefined })} />
          </label>
          <p className="scope-editor-note">修改日期、店铺或站点会自动清空旧批次；如需固定历史批次，请重新输入批次 ID。</p>
          {editError && <p className="scope-editor-error">{editError}</p>}
          <button type="button" className="primary-button" onClick={save}>保存范围</button>
        </div>
      )}
    </section>
  );
}
