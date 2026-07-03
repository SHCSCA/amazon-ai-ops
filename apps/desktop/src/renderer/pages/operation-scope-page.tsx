import React, { useEffect, useMemo, useState } from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { OperatorTaskPanel } from '../components/operator-task-panel';
import { scopeFieldFeedbackClass, scopeFieldFeedbackLabel, type ScopeFieldFeedbackKey } from '../components/scope-bar';
import { FormTable, FormTableRow, KpiCard, PageHeader, Panel, StateLightGrid, StatusPill } from '../components/ui';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import { useScopeStore } from '../scope-store';
import { toUserFacingError } from '../user-facing-error';
import type { AppRoute, BusinessBatchOption, OperationScope } from '../types';

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

function openScopeEditor() {
  window.dispatchEvent(new CustomEvent('amazon-ai-ops:open-scope-editor'));
}

export type OperationScopeSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface OperationScopeTaskState {
  title: string;
  detail: string;
  tone: 'ready' | 'warning' | 'blocked';
  primaryActionLabel: string;
  primaryActionBusy: boolean;
  primaryActionBusyLabel?: string;
  nextActionLabel: string;
  nextRoute: AppRoute;
}

export function operationScopeSaveFeedbackLabel(status: OperationScopeSaveStatus): string {
  if (status === 'saving') return '正在保存范围...';
  if (status === 'saved') return '范围已保存，后续页面会按此读取';
  if (status === 'error') return '范围保存失败，请展开处理';
  return '范围尚未手动确认';
}

export function normalizeOperationScopeDraft(draft: OperationScope): OperationScope {
  return {
    dateFrom: draft.dateFrom.trim(),
    dateTo: draft.dateTo.trim(),
    storeName: draft.storeName.trim(),
    marketplaceCode: draft.marketplaceCode.trim(),
    asin: draft.asin?.trim() || undefined,
    batchId: draft.batchId?.trim() || undefined,
    currency: 'USD',
  };
}

export function buildOperationScopeSelectOptions(current: string | undefined, candidates: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  return [current, ...candidates]
    .map((value) => String(value || '').trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function scopeDraftWithPatch(current: OperationScope, patch: Partial<OperationScope>, clearBatch = false): OperationScope {
  return {
    ...current,
    ...patch,
    batchId: clearBatch ? undefined : (patch.batchId ?? current.batchId),
    currency: 'USD',
  };
}

export function buildOperationScopeTaskState(input: {
  realReportCount: number;
  importedRows: number;
  activeBatch?: string;
  saveStatus: OperationScopeSaveStatus;
}): OperationScopeTaskState {
  const hasReports = input.realReportCount > 0;
  const canQuantify = hasReports && input.importedRows > 0;
  if (canQuantify) {
    return {
      title: '确认当前范围后进入广告量化',
      detail: `${Math.min(input.realReportCount, 8)}/8 类真实报表，${input.importedRows} 行广告指标已入库；保存后广告量化、建议、审批和回读都按这个范围读取。`,
      tone: 'ready',
      primaryActionLabel: '确认并保存范围',
      primaryActionBusy: input.saveStatus === 'saving',
      primaryActionBusyLabel: '保存中...',
      nextActionLabel: '进入广告量化',
      nextRoute: 'ad-quant',
    };
  }
  if (hasReports) {
    return {
      title: '先导入当前范围的真实报表',
      detail: `${Math.min(input.realReportCount, 8)}/8 类真实报表已存在，但还没有日级广告指标入库；保存范围后进入导入校验。`,
      tone: 'warning',
      primaryActionLabel: '确认并保存范围',
      primaryActionBusy: input.saveStatus === 'saving',
      primaryActionBusyLabel: '保存中...',
      nextActionLabel: '去导入校验',
      nextRoute: 'data-import-validation',
    };
  }
  return {
    title: '先获取当前范围的真实报表',
    detail: '当前日期、店铺和站点还没有可用的领星原始广告报表；保存范围后进入数据采集。',
    tone: 'blocked',
    primaryActionLabel: '确认并保存范围',
    primaryActionBusy: input.saveStatus === 'saving',
    primaryActionBusyLabel: '保存中...',
    nextActionLabel: '去数据采集',
    nextRoute: 'data-collection',
  };
}

export function OperationScopePage() {
  const { data, scope, loading, error } = useBusinessDataPipeline();
  const setScope = useScopeStore((state) => state.setScope);
  const [draft, setDraft] = useState<OperationScope>(scope);
  const [saveStatus, setSaveStatus] = useState<OperationScopeSaveStatus>('idle');
  const [saveError, setSaveError] = useState('');
  const [confirmedField, setConfirmedField] = useState<{ field: ScopeFieldFeedbackKey; tick: number } | null>(null);
  const collection = data?.collection;
  const quant = data?.quant;
  const activeBatch = scope.batchId || collection?.latestBatch?.id || '';
  const realReportCount = collection?.fileAudit?.realReportFileCount ?? collection?.realReportFiles.length ?? 0;
  const importedRows = collection?.fileAudit?.importedRowCount ?? quant?.importedRows ?? 0;
  const canQuantify = realReportCount > 0 && importedRows > 0;
  const taskState = buildOperationScopeTaskState({
    realReportCount,
    importedRows,
    activeBatch,
    saveStatus,
  });
  const availableBatches = useMemo(
    () => collection?.availableBatches || [],
    [collection?.availableBatches],
  );
  const storeOptions = useMemo(
    () => buildOperationScopeSelectOptions(scope.storeName, [
      collection?.latestBatch?.storeName,
      ...availableBatches.map((batch: BusinessBatchOption) => batch.storeName),
      'FT-US-US',
    ]),
    [availableBatches, collection?.latestBatch?.storeName, scope.storeName],
  );
  const marketplaceOptions = useMemo(
    () => buildOperationScopeSelectOptions(scope.marketplaceCode, [
      collection?.latestBatch?.marketplaceCode,
      ...availableBatches.map((batch: BusinessBatchOption) => batch.marketplaceCode),
      'US',
    ]),
    [availableBatches, collection?.latestBatch?.marketplaceCode, scope.marketplaceCode],
  );
  const confirmedFieldName = confirmedField?.field ?? null;

  useEffect(() => {
    setDraft(scope);
  }, [scope.asin, scope.batchId, scope.currency, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName]);

  useEffect(() => {
    if (!confirmedField) return undefined;
    const timer = window.setTimeout(() => setConfirmedField(null), 900);
    return () => window.clearTimeout(timer);
  }, [confirmedField]);

  const markDraftField = (field: ScopeFieldFeedbackKey, patch: Partial<OperationScope>, clearBatch = false) => {
    setSaveStatus('idle');
    setSaveError('');
    setConfirmedField({ field, tick: Date.now() });
    setDraft((current) => scopeDraftWithPatch(current, patch, clearBatch));
  };

  const confirmScope = async () => {
    const normalizedDraft = normalizeOperationScopeDraft(draft);
    if (!normalizedDraft.dateFrom || !normalizedDraft.dateTo) {
      setSaveStatus('error');
      setSaveError('请填写开始日期和结束日期。');
      return;
    }
    if (normalizedDraft.dateFrom > normalizedDraft.dateTo) {
      setSaveStatus('error');
      setSaveError('开始日期不能晚于结束日期。');
      return;
    }
    if (!normalizedDraft.storeName) {
      setSaveStatus('error');
      setSaveError('请填写店铺。');
      return;
    }
    if (!normalizedDraft.marketplaceCode) {
      setSaveStatus('error');
      setSaveError('请填写站点。');
      return;
    }
    setSaveStatus('saving');
    setSaveError('');
    try {
      const api = (window as any).electronAPI;
      if (!api?.saveOperationScope) throw new Error('范围保存接口未暴露');
      await api.saveOperationScope(normalizedDraft);
      setScope(normalizedDraft);
      setDraft(normalizedDraft);
      setSaveStatus('saved');
      window.dispatchEvent(new CustomEvent('business-ui:data-updated'));
    } catch (caught) {
      setSaveStatus('error');
      setSaveError(toUserFacingError(caught, '保存当前范围失败。'));
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="数据与量化"
        title={PAGE_HEADER_TITLES.operationScope}
        description="日期、店铺、站点、币种和批次。后续页面统一按这个范围读取。"
        primaryTask="确认全局范围"
        nextAction={canQuantify ? '进入广告量化' : realReportCount > 0 ? '导入已下载表格' : '获取真实报表'}
      />

      <div className="business-stack">
        <OperatorTaskPanel
          eyebrow="范围确认"
          title={taskState.title}
          detail={taskState.detail}
          primaryAction={{
            label: taskState.primaryActionLabel,
            onClick: () => { void confirmScope(); },
            busy: taskState.primaryActionBusy,
            busyLabel: taskState.primaryActionBusyLabel,
          }}
          secondaryActions={[
            { label: '编辑范围', onClick: openScopeEditor },
            { label: taskState.nextActionLabel, onClick: () => navigate(taskState.nextRoute) },
          ]}
        >
          <div className="kpi-row kpi-row--task" aria-label="工作范围任务摘要">
            <KpiCard
              label="真实报表"
              value={`${Math.min(realReportCount, 8)}/8`}
              detail={realReportCount ? '当前范围已有文件' : '保存后去采集'}
              tone={taskState.tone}
            />
            <KpiCard
              label="入库指标"
              value={`${importedRows} 行`}
              detail={importedRows > 0 ? '可进入量化' : '等待导入'}
              tone={importedRows > 0 ? 'ready' : 'blocked'}
            />
            <KpiCard
              label="数据批次"
              value={activeBatch || '自动匹配'}
              detail={scope.batchId ? '手动指定' : '最新完整优先'}
              tone={activeBatch ? 'ready' : 'pending'}
            />
            <KpiCard label="币种" value="USD" detail="全链路统一口径" tone="pending" />
          </div>
          <div className={`scope-task-feedback scope-task-feedback-${saveStatus}`} aria-live="polite">
            <span>{operationScopeSaveFeedbackLabel(saveStatus)}</span>
            {saveError && <strong>{saveError}</strong>}
          </div>
        </OperatorTaskPanel>

        <Panel title="范围表单" tone={saveStatus === 'error' ? 'blocked' : 'default'}>
          <FormTable>
            <FormTableRow
              label="店铺"
              required
              hint="选中后会先写入本页待保存范围；保存后数据采集、导入、广告量化和 AI 建议统一使用。"
            >
              <span className={scopeFieldFeedbackClass('storeName', confirmedFieldName, 'operation-scope-field')}>
                <select
                  aria-label="店铺名称"
                  value={draft.storeName}
                  onChange={(event) => markDraftField('storeName', { storeName: event.target.value }, true)}
                >
                  {storeOptions.map((storeName) => (
                    <option key={storeName} value={storeName}>{storeName}</option>
                  ))}
                </select>
                <span className="scope-field-confirmation" aria-live="polite">
                  {confirmedFieldName === 'storeName' ? scopeFieldFeedbackLabel('storeName') : '\u00A0'}
                </span>
              </span>
            </FormTableRow>
            <FormTableRow
              label="站点"
              required
              hint="当前版本按 Windows 本地 USD 计价口径解释广告花费、销售额、CPC 和 ACOS。"
            >
              <span className={scopeFieldFeedbackClass('marketplaceCode', confirmedFieldName, 'operation-scope-field')}>
                <select
                  aria-label="运营站点"
                  value={draft.marketplaceCode}
                  onChange={(event) => markDraftField('marketplaceCode', { marketplaceCode: event.target.value }, true)}
                >
                  {marketplaceOptions.map((marketplaceCode) => (
                    <option key={marketplaceCode} value={marketplaceCode}>{marketplaceCode}</option>
                  ))}
                </select>
                <span className="scope-field-confirmation" aria-live="polite">
                  {confirmedFieldName === 'marketplaceCode' ? scopeFieldFeedbackLabel('marketplaceCode') : '\u00A0'}
                </span>
              </span>
            </FormTableRow>
            <FormTableRow label="币种" hint="固定 USD，避免多币种混入造成财务判断偏差。">
              <input aria-label="币种" readOnly value="USD" />
            </FormTableRow>
            <FormTableRow
              label="分析周期"
              required
              hint="修改日期会清空手动批次，避免旧批次继续绑定到新时间范围。"
            >
              <span className="operation-scope-date-range">
                <span className={scopeFieldFeedbackClass('dateFrom', confirmedFieldName, 'operation-scope-field')}>
                  <input
                    aria-label="开始日期"
                    type="date"
                    value={draft.dateFrom}
                    onChange={(event) => markDraftField('dateFrom', { dateFrom: event.target.value }, true)}
                  />
                  <span className="scope-field-confirmation" aria-live="polite">
                    {confirmedFieldName === 'dateFrom' ? scopeFieldFeedbackLabel('dateFrom') : '\u00A0'}
                  </span>
                </span>
                <span className={scopeFieldFeedbackClass('dateTo', confirmedFieldName, 'operation-scope-field')}>
                  <input
                    aria-label="结束日期"
                    type="date"
                    value={draft.dateTo}
                    onChange={(event) => markDraftField('dateTo', { dateTo: event.target.value }, true)}
                  />
                  <span className="scope-field-confirmation" aria-live="polite">
                    {confirmedFieldName === 'dateTo' ? scopeFieldFeedbackLabel('dateTo') : '\u00A0'}
                  </span>
                </span>
              </span>
            </FormTableRow>
            <FormTableRow
              label="筛选 ASIN"
              hint="可留空表示全部产品；填写后产品管理、广告量化、事件、关键词和 Listing 都按该 ASIN 过滤。"
            >
              <span className={scopeFieldFeedbackClass('asin', confirmedFieldName, 'operation-scope-field')}>
                <input
                  aria-label="筛选 ASIN"
                  value={draft.asin || ''}
                  onChange={(event) => markDraftField('asin', { asin: event.target.value || undefined })}
                  placeholder="例如 B0..."
                />
                <span className="scope-field-confirmation" aria-live="polite">
                  {confirmedFieldName === 'asin' ? scopeFieldFeedbackLabel('asin') : '\u00A0'}
                </span>
              </span>
            </FormTableRow>
            <FormTableRow
              label="数据批次"
              hint="留空为自动匹配当前范围最新完整批次；手动指定只影响读取，不会重新下载。"
            >
              <span className={scopeFieldFeedbackClass('batchId', confirmedFieldName, 'operation-scope-field')}>
                <select
                  aria-label="数据批次"
                  value={draft.batchId || ''}
                  onChange={(event) => markDraftField('batchId', { batchId: event.target.value || undefined })}
                >
                  <option value="">自动匹配最新完整批次</option>
                  {availableBatches.map((batch: BusinessBatchOption) => (
                    <option key={batch.id} value={batch.id}>
                      {batch.id} · {Math.min(batch.realReportFileCount || 0, 8)}/8 类 · {batch.importedRowCount || 0} 行
                    </option>
                  ))}
                </select>
                <span className="scope-field-confirmation" aria-live="polite">
                  {confirmedFieldName === 'batchId' ? scopeFieldFeedbackLabel('batchId') : '\u00A0'}
                </span>
              </span>
            </FormTableRow>
          </FormTable>
        </Panel>

        <Panel title="当前操作范围" tone={canQuantify ? 'success' : realReportCount > 0 ? 'warning' : 'blocked'}>
          <StateLightGrid
            items={[
              {
                label: '日期',
                value: `${scope.dateFrom} 至 ${scope.dateTo}`,
                detail: '领星报表、数据库查询和 AI 分析共用。',
                tone: 'pending',
              },
              {
                label: '店铺 / 站点',
                value: `${scope.storeName || '-'} / ${scope.marketplaceCode || '-'}`,
                detail: '跨境业务默认使用站点币种。',
                tone: 'pending',
              },
              {
                label: '币种',
                value: 'USD',
                detail: '花费、销售额、CPC 和阈值统一展示。',
                tone: 'pending',
              },
              {
                label: '数据批次',
                value: activeBatch || '自动匹配最新完整批次',
                detail: scope.batchId ? '手动指定批次，请确认日期、店铺和站点一致。' : '未指定时自动选择当前范围最新完整批次。',
                tone: canQuantify ? 'ready' : realReportCount > 0 ? 'warning' : 'blocked',
              },
            ]}
          />
          <div className="business-pill-row">
            <StatusPill tone={realReportCount >= 8 ? 'ready' : realReportCount > 0 ? 'warning' : 'blocked'}>报表覆盖 {realReportCount}/8 类</StatusPill>
            <StatusPill tone={importedRows > 0 ? 'ready' : 'blocked'}>已导入 {importedRows} 行</StatusPill>
            <StatusPill tone="pending">金额展示 USD</StatusPill>
          </div>
          {loading && <p className="muted-line">正在读取当前范围数据状态...</p>}
          {error && <p className="blocked-line">范围数据读取异常：{error}</p>}
        </Panel>

        <Panel title="这个范围会影响哪些页面">
          <div className="workflow-strip">
            {[
              ['数据采集', '只创建/下载这个范围的领星 8 类报表。', 'data-collection'],
              ['数据导入与校验', '只导入这个范围的 xlsx/xls/csv，不读取审计文件。', 'data-import-validation'],
              ['广告量化', '只计算这个范围已入库的每日广告指标。', 'ad-quant'],
              ['优化建议', '只生成这个范围可绑定广告对象的建议。', 'recommendations'],
            ].map(([title, description, route]) => (
              <button className="workflow-step" key={route} onClick={() => navigate(route as AppRoute)} type="button">
                <span>{title}</span>
                <strong>{description}</strong>
                <StatusPill tone="pending">进入</StatusPill>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="推荐下一步" tone={canQuantify ? 'success' : realReportCount > 0 ? 'warning' : 'blocked'}>
          {canQuantify ? (
            <div className="judgment-panel">
              <div>
                <span>当前范围已可量化</span>
                <strong>{importedRows} 行广告指标可用于规则和 AI 分析</strong>
                <p>下一步进入广告量化，先看产品阶段、阈值和风险对象，再生成优化建议。</p>
              </div>
              <button className="primary-button" onClick={() => navigate('ad-quant')} type="button">进入广告量化</button>
            </div>
          ) : realReportCount > 0 ? (
            <div className="judgment-panel">
              <div>
                <span>已有真实报表，尚未入库</span>
                <strong>{realReportCount}/8 类真实报表待导入</strong>
                <p>下一步进入数据导入与校验页，把表格写入 SQLite 每日广告事实表。</p>
              </div>
              <button className="primary-button" onClick={() => navigate('data-import-validation')} type="button">去导入校验</button>
            </div>
          ) : (
            <div className="judgment-panel">
              <div>
                <span>缺少真实广告数据</span>
                <strong>当前范围没有可用的领星原始表格</strong>
                <p>下一步进入数据采集页，创建或下载当前范围 8 类广告报表。</p>
              </div>
              <button className="primary-button" onClick={() => navigate('data-collection')} type="button">去数据采集</button>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
