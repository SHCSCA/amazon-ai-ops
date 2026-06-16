import React, { useEffect, useMemo, useState } from 'react';
import { useScopeStore } from '../scope-store';
import { toUserFacingError } from '../user-facing-error';
import type { BusinessBatchOption } from '../types';

const AUTO_BATCH_VALUE = '__auto__';
const MANUAL_BATCH_VALUE = '__manual__';

function formatBatchOption(batch: BusinessBatchOption): string {
  const imported = batch.importedRowCount > 0 ? `${batch.importedRowCount} 行已导入` : '未导入';
  return `${batch.id} · ${batch.realReportFileCount}/8 真实表格 · ${imported}`;
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
    ? `${activeBatch.realReportFileCount}/8 真实表格`
    : manualBatchUnmatched ? '手动批次待校验'
    : loadingBatches ? '正在读取批次...' : '暂无匹配批次';
  const importedLabel = selectedBatch
    ? `${selectedBatch.importedRowCount} 行`
    : activeBatch ? `${activeBatch.importedRowCount} 行` : manualBatchUnmatched ? '待校验' : '0 行';
  const scopeHelperText = activeBatch
    ? `当前数据批次：${activeBatch.id}。批次只决定读取哪批真实报表和入库指标，不会自动重新下载。`
    : manualBatchUnmatched
      ? `当前使用手动批次：${scope.batchId}。该批次不在当前范围自动匹配列表中，后续页面会按这个 ID 尝试读取；如不确定，请切回“自动”。`
      : '当前未匹配到数据批次；需要先在数据采集页下载并导入真实广告表格。';

  return (
    <section className="scope-bar" aria-label="当前运营范围">
      <div className="scope-title-row">
        <div>
          <span>当前操作范围</span>
          <strong>{scope.dateFrom} 至 {scope.dateTo} / {scope.storeName || '未选店铺'} / {scope.marketplaceCode || '未选站点'} / USD</strong>
          <p>这是全局范围。数据采集、导入校验、广告量化、优化建议、审批回读、关键词机会和 Listing 草案都会按这里读取。</p>
          <p className="scope-helper">
            {scopeHelperText}
          </p>
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
      <div className="scope-summary">
        <div>
          <span>币种</span>
          <strong>{scope.currency}</strong>
        </div>
        <div>
          <span>批次模式</span>
          <strong>{batchModeLabel}</strong>
        </div>
        <div>
          <span>当前批次</span>
          <strong>{activeBatch?.id || scope.batchId || '-'}</strong>
        </div>
        <div>
          <span>真实表格</span>
          <strong>{batchDataLabel}</strong>
        </div>
        <div>
          <span>已导入指标</span>
          <strong>{importedLabel}</strong>
        </div>
      </div>
      {(scope.batchId || batchOptionsError) && (
        <div className="scope-batch-note">
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
      {!scope.batchId && scopePersistError && (
        <div className="scope-batch-note">
          <span className="blocked-line">范围保存失败：{scopePersistError}</span>
        </div>
      )}
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
