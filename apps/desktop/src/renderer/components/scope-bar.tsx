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
  if (coverage === null) return '待校验';
  const cappedCoverage = Math.min(REQUIRED_REPORT_COUNT, coverage);
  const fileCount = cleanCount(batch.totalFileRecords);
  const fileSuffix = fileCount !== null && fileCount > cappedCoverage ? ` · ${fileCount} 个文件` : '';
  return `${cappedCoverage}/${REQUIRED_REPORT_COUNT} 类${fileSuffix}`;
}

function formatImportedCoverage(batch: Partial<BusinessBatchOption>): string {
  const coverage = cleanCount(batch.importedReportTypeCount);
  if (coverage === null) return '待校验';
  const cappedCoverage = Math.min(REQUIRED_REPORT_COUNT, coverage);
  const rows = cleanCount(batch.importedRowCount);
  const rowsSuffix = rows === null ? '' : ` · ${rows} 行`;
  return `${cappedCoverage}/${REQUIRED_REPORT_COUNT} 类${rowsSuffix}`;
}

export function formatBatchOption(batch: BusinessBatchOption): string {
  const reportCoverage = formatReportCoverage(batch);
  const importedCoverage = formatImportedCoverage(batch);
  return `${batch.id} · ${reportCoverage === '待校验' ? '报表文件待校验' : `报表文件 ${reportCoverage}`} · ${importedCoverage === '待校验' ? '逐类入库待校验' : `逐类入库 ${importedCoverage}`}`;
}

type ScopeSummaryFact = {
  label: string;
  value: string;
  title?: string;
};

export type ScopeFieldFeedbackKey = 'dateFrom' | 'dateTo' | 'storeName' | 'marketplaceCode' | 'asin' | 'batchId';

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
    { label: '产品', value: input.productLabel || input.asin?.trim() || '全部产品' },
    { label: '报表文件', value: input.reportCoverage },
    { label: '逐类入库', value: input.importedRows },
    {
      label: '追溯批次',
      value: input.batchId || '自动匹配',
      title: input.batchModeLabel,
    },
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

export function buildScopeCompactRangeLabel(input: {
  dateFrom?: string;
  dateTo?: string;
}): string {
  const dateFrom = input.dateFrom?.trim();
  const dateTo = input.dateTo?.trim();
  if (dateFrom && dateTo) return `${dateFrom} ~ ${dateTo}`;
  if (dateFrom || dateTo) return dateFrom || dateTo || '日期待设置';
  return '日期待设置';
}

export function buildScopeCompactContextLabel(input: {
  storeName?: string;
  marketplaceCode?: string;
  asin?: string;
}): string {
  return [
    input.storeName?.trim() || '未选店铺',
    input.marketplaceCode?.trim() || '未选站点',
    input.asin?.trim() || '全部产品',
  ].join(' / ');
}

export function scopeFieldFeedbackLabel(field: ScopeFieldFeedbackKey): string {
  const labels: Record<ScopeFieldFeedbackKey, string> = {
    dateFrom: '开始日期已记录为待保存范围',
    dateTo: '结束日期已记录为待保存范围',
    storeName: '店铺已记录为待保存范围',
    marketplaceCode: '站点已记录为待保存范围',
    asin: 'ASIN 已记录为待保存范围',
    batchId: '批次已记录为当前范围',
  };
  return labels[field];
}

export function scopeFieldFeedbackClass(
  field: ScopeFieldFeedbackKey,
  activeField?: ScopeFieldFeedbackKey | null,
  baseClass = 'scope-field-feedback-shell',
): string {
  return [
    baseClass,
    activeField === field ? 'scope-field-confirmed' : '',
  ].filter(Boolean).join(' ');
}

export function scopeEditorSaveButtonView(saving: boolean): {
  label: string;
  disabled: boolean;
  ariaBusy: boolean;
  showSpinner: boolean;
  className: string;
} {
  return {
    label: saving ? '正在保存...' : '保存范围',
    disabled: saving,
    ariaBusy: saving,
    showSpinner: saving,
    className: ['primary-button', saving ? 'button-loading' : ''].filter(Boolean).join(' '),
  };
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
  const [confirmedField, setConfirmedField] = useState<{ field: ScopeFieldFeedbackKey; tick: number } | null>(null);
  const [scopeEditorSaving, setScopeEditorSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const selectedBatch = useMemo(
    () => batchOptions.find((batch) => batch.id === scope.batchId),
    [batchOptions, scope.batchId],
  );
  const autoMatchedBatch = useMemo(() => batchOptions[0], [batchOptions]);

  const save = async () => {
    if (scopeEditorSaving) return;
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
    setScopeEditorSaving(true);
    try {
      const api = (window as any).electronAPI;
      if (api?.saveOperationScope) {
        await api.saveOperationScope(normalizedDraft);
      }
      setScope(normalizedDraft);
      setDraft(normalizedDraft);
      setEditing(false);
      setEditError('');
      setScopePersistError('');
    } catch (caught) {
      const message = toUserFacingError(caught, '保存运营范围失败。');
      setEditError(message);
      setScopePersistError(message);
    } finally {
      setScopeEditorSaving(false);
    }
  };

  const markFieldConfirmed = (field: ScopeFieldFeedbackKey) => {
    setConfirmedField({ field, tick: Date.now() });
  };

  const applyScopePatch = (patch: Partial<typeof scope>) => {
    const nextScope = { ...scope, ...patch, currency: 'USD' as const };
    setScope(nextScope);
    setDraft(nextScope);
  };

  const updateRangeDraft = (field: ScopeFieldFeedbackKey, patch: Partial<typeof scope>) => {
    setEditError('');
    markFieldConfirmed(field);
    setDraft((current) => ({ ...current, ...patch, batchId: undefined, currency: 'USD' as const }));
  };

  const updateDraftField = (field: ScopeFieldFeedbackKey, patch: Partial<typeof scope>) => {
    setEditError('');
    markFieldConfirmed(field);
    setDraft((current) => ({ ...current, ...patch, currency: 'USD' as const }));
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
    if (!confirmedField) return undefined;
    const timer = window.setTimeout(() => setConfirmedField(null), 900);
    return () => window.clearTimeout(timer);
  }, [confirmedField]);

  useEffect(() => {
    const openEditor = () => {
      setDraft(scope);
      setEditError('');
      setDetailsOpen(false);
      setEditing(true);
    };
    window.addEventListener('amazon-ai-ops:open-scope-editor', openEditor);
    return () => window.removeEventListener('amazon-ai-ops:open-scope-editor', openEditor);
  }, [scope]);

  useEffect(() => {
    if (!detailsOpen && !editing) return;
    function handleWindowKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || scopeEditorSaving) return;
      setDetailsOpen(false);
      setEditing(false);
      setEditError('');
    }
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [detailsOpen, editing, scopeEditorSaving]);

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
  const importedLabel = activeBatch
    ? formatImportedCoverage(activeBatch)
    : manualBatchUnmatched ? '待校验' : '0/8 类 · 0 行';
  const scopeHelperText = activeBatch
    ? `当前数据批次：${activeBatch.id}。批次只决定读取哪批真实报表和入库指标，不会自动重新下载。`
    : manualBatchUnmatched
      ? `当前使用手动批次：${scope.batchId}。该批次不在当前范围自动匹配列表中，后续页面会按这个 ID 尝试读取；如不确定，请切回“自动”。`
      : '当前未匹配到数据批次；需要先到“数据准备 → 报表采集”下载真实广告表格，再到“导入检查”完成入库。';
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
  const confirmedFieldName = confirmedField?.field ?? null;
  const editorSaveButton = scopeEditorSaveButtonView(scopeEditorSaving);
  const renderFieldConfirmation = (field: ScopeFieldFeedbackKey) => (
    <span className="scope-field-confirmation" aria-live="polite">
      {confirmedFieldName === field ? scopeFieldFeedbackLabel(field) : '\u00A0'}
    </span>
  );
  const renderBatchSelect = () => (
    <label className={scopeFieldFeedbackClass('batchId', confirmedFieldName, 'scope-title-action-field')}>
      <span>数据批次</span>
      <select
        aria-label="数据批次来源"
        value={batchSelectValue}
        onChange={(event) => {
          markFieldConfirmed('batchId');
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
        <option value={AUTO_BATCH_VALUE}>自动批次</option>
        {batchOptions.map((batch) => (
          <option key={batch.id} value={batch.id}>{formatBatchOption(batch)}</option>
        ))}
        {scope.batchId && !selectedBatch && (
          <option value={MANUAL_BATCH_VALUE}>手动批次：{scope.batchId}</option>
        )}
        <option value={MANUAL_BATCH_VALUE}>手动输入批次 ID</option>
      </select>
      {renderFieldConfirmation('batchId')}
    </label>
  );

  const scopeRangeLabel = buildScopeCompactRangeLabel(scope);
  const scopeContextLabel = buildScopeCompactContextLabel(scope);
  const scopeFullLine = `${scopeRangeLabel} / ${scope.storeName || '未选店铺'} / ${scope.marketplaceCode || '未选站点'} / USD${scope.asin?.trim() ? ` / ASIN ${scope.asin.trim()}` : ' / 全部产品'}`;
  const topbarFacts = summaryFacts.filter((fact) => fact.label === '报表文件' || fact.label === '逐类入库');

  return (
    <section className="scope-bar" aria-label="当前工作范围">
      <div className="scope-title-row">
        <button
          aria-expanded={detailsOpen}
          className="scope-title-main scope-compact-trigger"
          onClick={() => {
            setEditing(false);
            setDetailsOpen((value) => !value);
          }}
          title={scopeFullLine}
          type="button"
        >
          <span>范围</span>
          <strong>{scopeRangeLabel}</strong>
          <em>{scopeContextLabel}</em>
          {warningSummary && (
            <span className="scope-visible-warning" role="status" title={warningSummary}>
              范围待处理
            </span>
          )}
        </button>
        <div className="scope-title-actions">
          {topbarFacts.map((fact) => (
            <span className="scope-topbar-fact" key={fact.label} title={fact.title || fact.value}>
              <b>{fact.label}</b>
              {fact.value}
            </span>
          ))}
          <button
            type="button"
            aria-expanded={editing}
            className="secondary-button compact-button scope-settings-button"
            onClick={() => {
              setDraft(scope);
              setEditError('');
              setDetailsOpen(false);
              setEditing((value) => !value);
            }}
          >
            范围设置
          </button>
        </div>
      </div>
      <div className="scope-compact-facts" aria-hidden="true" />
      {detailsOpen && (
      <div className="scope-details-panel">
        <ProgressiveDetails title="范围与批次说明" defaultOpen>
          <div className="scope-details-facts" aria-label="当前范围详情">
            <span><b>日期</b>{scopeRangeLabel}</span>
            <span><b>店铺/站点</b>{scope.storeName || '未选店铺'} / {scope.marketplaceCode || '未选站点'}</span>
            <span><b>币种</b>USD</span>
            <span><b>产品</b>{productLabel}</span>
            <span><b>批次</b>{activeBatch?.id || scope.batchId || '自动匹配'}</span>
          </div>
          <p>这是当前工作范围。数据采集、导入校验、广告表现、优化建议、审批中心、结果核对、关键词机会和 Listing 草案都会按这里读取。</p>
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
      )}
      {editing && (
        <div className="scope-editor">
          <div className="scope-editor-summary" aria-label="当前范围摘要">
            {summaryFacts.map((fact) => (
              <span className="scope-fact" key={fact.label} title={fact.title}>
                <b>{fact.label}</b>
                {fact.value}
              </span>
            ))}
            <p>{scopeHelperText}</p>
          </div>
          <label className={scopeFieldFeedbackClass('dateFrom', confirmedFieldName)}>
            <span>开始日期</span>
            <input type="date" value={draft.dateFrom} onChange={(event) => updateRangeDraft('dateFrom', { dateFrom: event.target.value })} />
            {renderFieldConfirmation('dateFrom')}
          </label>
          <label className={scopeFieldFeedbackClass('dateTo', confirmedFieldName)}>
            <span>结束日期</span>
            <input type="date" value={draft.dateTo} onChange={(event) => updateRangeDraft('dateTo', { dateTo: event.target.value })} />
            {renderFieldConfirmation('dateTo')}
          </label>
          <label className={scopeFieldFeedbackClass('storeName', confirmedFieldName)}>
            <span>店铺</span>
            <input value={draft.storeName} onChange={(event) => updateRangeDraft('storeName', { storeName: event.target.value })} />
            {renderFieldConfirmation('storeName')}
          </label>
          <label className={scopeFieldFeedbackClass('marketplaceCode', confirmedFieldName)}>
            <span>站点</span>
            <input value={draft.marketplaceCode} onChange={(event) => updateRangeDraft('marketplaceCode', { marketplaceCode: event.target.value })} />
            {renderFieldConfirmation('marketplaceCode')}
          </label>
          <label className={scopeFieldFeedbackClass('asin', confirmedFieldName)}>
            <span>ASIN</span>
            <input value={draft.asin || ''} onChange={(event) => updateDraftField('asin', { asin: event.target.value || undefined })} />
            {renderFieldConfirmation('asin')}
          </label>
          {renderBatchSelect()}
          <label className={scopeFieldFeedbackClass('batchId', confirmedFieldName)}>
            <span>手动批次 ID</span>
            <input value={draft.batchId || ''} onChange={(event) => updateDraftField('batchId', { batchId: event.target.value || undefined })} />
            {renderFieldConfirmation('batchId')}
          </label>
          <p className="scope-editor-note">修改日期、店铺或站点会自动清空旧批次；如需固定历史批次，请重新输入批次 ID。</p>
          {editError && <p className="scope-editor-error">{editError}</p>}
          <button
            type="button"
            aria-busy={editorSaveButton.ariaBusy}
            className={editorSaveButton.className}
            disabled={editorSaveButton.disabled}
            onClick={() => { void save(); }}
          >
            <span className={editorSaveButton.showSpinner ? 'button-content' : undefined}>
              {editorSaveButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
              {editorSaveButton.label}
            </span>
          </button>
        </div>
      )}
    </section>
  );
}
