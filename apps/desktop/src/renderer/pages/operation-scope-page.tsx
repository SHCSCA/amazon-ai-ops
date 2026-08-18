import { useEffect, useMemo, useRef, useState } from 'react';
import type { LingxingCollectionJobSnapshot, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { useBusinessDataPipeline } from '../components/business-data';
import { FormTable, FormTableRow, PageHeader, Panel, StatusPill } from '../components/ui';
import { TaskBanner } from '../components/workspace';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import { buildDataReadinessLedger, type DataReadinessLedger } from '../data-readiness-ledger';
import {
  buildProductionCollectionLineageReadiness,
  type ProductionCollectionReportBinding,
} from '../lingxing-collection-lineage';
import { useScopeStore } from '../scope-store';
import { toUserFacingError } from '../user-facing-error';
import type { AppRoute, OperationScope } from '../types';

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
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

export function buildOperationScopeTaskState(input: {
  realReportCount: number;
  importedReportTypeCount: number;
  importedRows: number;
  activeBatch?: string;
  saveStatus: OperationScopeSaveStatus;
  readiness: Pick<DataReadinessLedger, 'status' | 'canEnterDiagnosis' | 'nextStep'>;
}): OperationScopeTaskState {
  const hasReports = input.realReportCount > 0;
  if (input.readiness.canEnterDiagnosis) {
    return {
      title: '确认当前工作范围后查看广告表现',
      detail: `${Math.min(input.realReportCount, 8)}/8 类真实报表，${input.importedRows} 行广告指标已入库；保存后广告表现、建议、审批和结果核对都按这个范围读取。`,
      tone: 'ready',
      primaryActionLabel: '确认并保存范围',
      primaryActionBusy: input.saveStatus === 'saving',
      primaryActionBusyLabel: '保存中...',
      nextActionLabel: '查看广告表现',
      nextRoute: 'ad-quant',
    };
  }
  if (input.readiness.nextStep === 'import') {
    const importedReportTypeCount = Math.min(8, Math.max(0, input.importedReportTypeCount));
    const pendingImportTypeCount = Math.max(0, Math.min(input.realReportCount, 8) - importedReportTypeCount);
    return {
      title: importedReportTypeCount > 0 ? '补齐当前范围的逐类入库' : '先导入当前范围的真实报表',
      detail: importedReportTypeCount > 0
        ? `${importedReportTypeCount}/8 类已形成 ${input.importedRows} 行日级广告指标，仍有 ${pendingImportTypeCount} 类待入库；保存范围后进入导入校验。`
        : `${Math.min(input.realReportCount, 8)}/8 类真实报表已存在，但还没有日级广告指标入库；保存范围后进入导入校验。`,
      tone: 'warning',
      primaryActionLabel: '确认并保存范围',
      primaryActionBusy: input.saveStatus === 'saving',
      primaryActionBusyLabel: '保存中...',
      nextActionLabel: '去导入校验',
      nextRoute: 'data-import-validation',
    };
  }
  if (hasReports) {
    return {
      title: '先补齐当前范围的真实报表',
      detail: `${Math.min(input.realReportCount, 8)}/8 类真实报表、${input.importedRows} 行指标仅构成部分覆盖；完整 8 类逐类入库前不能进入正式诊断。`,
      tone: 'warning',
      primaryActionLabel: '确认并保存范围',
      primaryActionBusy: input.saveStatus === 'saving',
      primaryActionBusyLabel: '保存中...',
      nextActionLabel: '去数据采集',
      nextRoute: 'data-collection',
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

export function OperationScopePage({ storeContext }: { storeContext: StoreContextEnvelope }) {
  const { data, scope, loading, error } = useBusinessDataPipeline();
  const setScope = useScopeStore((state) => state.setScope);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OperationScope>(scope);
  const [saveStatus, setSaveStatus] = useState<OperationScopeSaveStatus>('idle');
  const [saveError, setSaveError] = useState('');
  const [collectionJobs, setCollectionJobs] = useState<LingxingCollectionJobSnapshot[]>([]);
  const [collectionJobsLoading, setCollectionJobsLoading] = useState(false);
  const [collectionJobsError, setCollectionJobsError] = useState('');
  const [collectionJobsPreviewOnly, setCollectionJobsPreviewOnly] = useState(false);
  const collectionJobsLoadSequenceRef = useRef(0);
  const collection = data?.collection;
  const reportOptions = collection?.reportOptions || [];
  const realFiles = collection?.realReportFiles || [];
  const aggregateRealReportCount = collection?.fileAudit?.realReportFileCount ?? realFiles.length;
  const aggregateImportedRows = collection?.fileAudit?.importedRowCount ?? data?.quant?.importedRows ?? 0;
  const scopedCollectionJobs = useMemo(() => {
    const explicitBatchId = String(scope.batchId || '').trim();
    if (!explicitBatchId) return collectionJobs;
    return collectionJobs.filter((job) => (
      job.jobId === explicitBatchId
      || job.lineage?.rootJobId === explicitBatchId
      || job.lineage?.lineageId === explicitBatchId
    ));
  }, [collectionJobs, scope.batchId]);
  const lineageReadiness = useMemo(() => buildProductionCollectionLineageReadiness({
    currentContext: storeContext,
    dateStart: scope.dateFrom,
    dateEnd: scope.dateTo,
    jobs: scopedCollectionJobs,
    files: realFiles,
  }), [realFiles, scope.dateFrom, scope.dateTo, scopedCollectionJobs, storeContext]);
  const productionBindingByType = useMemo(() => new Map(
    lineageReadiness.reportBindings.map((binding) => [binding.reportType, binding]),
  ), [lineageReadiness.reportBindings]);
  const productionReportOptions = useMemo(() => reportOptions.map((option) => {
    const binding = productionBindingByType.get(option.type as ProductionCollectionReportBinding['reportType']);
    return {
      ...option,
      realFileAvailable: Boolean(binding?.fileBatchId && binding.fileBatchId === binding.expectedBatchId),
      importedRows: binding?.state === 'imported' ? binding.importedRows : 0,
      status: binding?.state || 'missing',
    };
  }), [productionBindingByType, reportOptions]);
  const realReportCount = lineageReadiness.sourceMatchedReportCount;
  const importedReportTypeCount = lineageReadiness.importedReportCount;
  const importedRows = lineageReadiness.importedRows;
  const activeBatch = scope.batchId || lineageReadiness.latestJobId || '';
  const dataLedger = useMemo(() => buildDataReadinessLedger({
    requiredReportCount: 8,
    reportOptions: productionReportOptions,
    realReportFileCount: realReportCount,
    importedRowCount: importedRows,
    rejectedEvidenceFileCount: collection?.fileAudit?.rejectedEvidenceFileCount ?? 0,
  }), [collection?.fileAudit?.rejectedEvidenceFileCount, importedRows, productionReportOptions, realReportCount]);
  const canQuantify = !collectionJobsLoading
    && !collectionJobsError
    && dataLedger.canEnterDiagnosis
    && lineageReadiness.canEnterDiagnosis;
  const effectiveReadiness: Pick<DataReadinessLedger, 'status' | 'canEnterDiagnosis' | 'nextStep'> = {
    status: canQuantify ? 'ready' : dataLedger.status,
    canEnterDiagnosis: canQuantify,
    nextStep: canQuantify
      ? 'diagnose'
      : lineageReadiness.sourceMatchedReportCount >= 8 && lineageReadiness.importedReportCount < 8
        ? 'import'
        : 'collect',
  };
  const taskState = buildOperationScopeTaskState({
    realReportCount,
    importedReportTypeCount,
    importedRows,
    activeBatch,
    saveStatus,
    readiness: effectiveReadiness,
  });

  useEffect(() => {
    if (!editing) setDraft(scope);
  }, [editing, scope]);

  useEffect(() => {
    const sequence = ++collectionJobsLoadSequenceRef.current;
    const api = (window as any).electronAPI;
    setCollectionJobs([]);
    setCollectionJobsError('');
    setCollectionJobsLoading(true);
    setCollectionJobsPreviewOnly(api?.lingxingCollectionJobsPreviewOnly === true);
    void (async () => {
      try {
        if (!api?.listLingxingCollectionJobs) {
          throw new Error('生产采集任务接口未暴露，请检查 preload IPC。');
        }
        const jobs = await api.listLingxingCollectionJobs({
          storeContext: { ...storeContext },
          limit: 100,
        });
        if (sequence !== collectionJobsLoadSequenceRef.current) return;
        setCollectionJobs(Array.isArray(jobs) ? jobs : []);
      } catch (caught) {
        if (sequence !== collectionJobsLoadSequenceRef.current) return;
        setCollectionJobs([]);
        setCollectionJobsError(toUserFacingError(caught, '生产采集任务读取失败。'));
      } finally {
        if (sequence === collectionJobsLoadSequenceRef.current) {
          setCollectionJobsLoading(false);
        }
      }
    })();
    return () => {
      if (collectionJobsLoadSequenceRef.current === sequence) {
        collectionJobsLoadSequenceRef.current += 1;
      }
    };
  }, [storeContext.browserProfileId, storeContext.currency, storeContext.marketplace, storeContext.storeId]);

  const confirmScope = async (candidate: OperationScope = scope) => {
    const normalizedDraft = normalizeOperationScopeDraft(candidate);
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
      await api.saveOperationScope(storeContext, normalizedDraft);
      setScope(normalizedDraft);
      setDraft(normalizedDraft);
      setEditing(false);
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
        eyebrow="数据"
        title={PAGE_HEADER_TITLES.operationScope}
        description="确认当前分析口径；全局范围条同步展示，具体修改从范围设置进入。"
      />

      <TaskBanner
        description={saveError
          || (collectionJobsLoading
            ? '正在按当前店铺、日期窗和批次核对生产采集任务；完成前不会放行广告表现。'
            : collectionJobsError
              ? `生产采集任务读取失败：${collectionJobsError}`
              : taskState.detail)}
        meta={`生产血缘文件 ${Math.min(realReportCount, 8)}/8 类 · 逐类入库 ${importedReportTypeCount}/8 类 · ${importedRows} 行指标`}
        primaryAction={{
          label: taskState.primaryActionLabel,
          onClick: () => { void confirmScope(); },
          busy: taskState.primaryActionBusy,
          busyLabel: taskState.primaryActionBusyLabel,
        }}
        secondaryActions={[
          {
            label: editing ? '收起编辑' : '编辑范围',
            onClick: () => {
              setDraft(scope);
              setSaveError('');
              setEditing((current) => !current);
            },
            disabled: taskState.primaryActionBusy,
          },
          { label: taskState.nextActionLabel, onClick: () => navigate(taskState.nextRoute), disabled: taskState.primaryActionBusy },
        ]}
        status={saveStatus !== 'idle'
          ? operationScopeSaveFeedbackLabel(saveStatus)
          : collectionJobsLoading
            ? '核对生产血缘中'
            : canQuantify
              ? operationScopeSaveFeedbackLabel(saveStatus)
              : '生产血缘未闭合'}
        title={taskState.title}
        tone={canQuantify ? 'confirmed' : taskState.tone === 'warning' ? 'attention' : 'blocked'}
      />

      {saveStatus !== 'idle' && (
        <p
          aria-live="polite"
          className="operation-scope-save-feedback"
          data-tone={saveStatus === 'saved' ? 'success' : saveStatus === 'error' ? 'error' : 'pending'}
          role={saveStatus === 'error' ? 'alert' : 'status'}
        >
          {operationScopeSaveFeedbackLabel(saveStatus)}
        </p>
      )}

      <div className="business-stack">
        {editing && (
          <Panel
            className="operation-scope-editor-panel"
            title="编辑当前店铺范围"
            tone={saveStatus === 'error' ? 'blocked' : 'default'}
            titleAccessory={<StatusPill tone="pending">美国站 · USD</StatusPill>}
          >
            <FormTable>
              <FormTableRow label="开始日期" required hint="按美国站业务日期读取领星报表。">
                <input
                  aria-label="运营范围开始日期"
                  max={draft.dateTo}
                  onChange={(event) => setDraft((current) => ({ ...current, dateFrom: event.target.value }))}
                  type="date"
                  value={draft.dateFrom}
                />
              </FormTableRow>
              <FormTableRow label="结束日期" required hint="不得早于开始日期；默认以当前美国站业务日为结束日。">
                <input
                  aria-label="运营范围结束日期"
                  min={draft.dateFrom}
                  onChange={(event) => setDraft((current) => ({ ...current, dateTo: event.target.value }))}
                  type="date"
                  value={draft.dateTo}
                />
              </FormTableRow>
              <FormTableRow label="店铺 / 站点" hint="店铺、站点和币种已按当前店铺锁定，不能跨店修改。">
                <div className="operation-scope-locked-authority" aria-label="当前锁定店铺站点币种">
                  <strong>{scope.storeName}</strong>
                  <StatusPill tone="ready">US</StatusPill>
                  <StatusPill tone="ready">USD</StatusPill>
                </div>
              </FormTableRow>
              <FormTableRow label="ASIN" hint="可选；留空读取当前店铺全部产品。">
                <input
                  aria-label="运营范围 ASIN"
                  maxLength={10}
                  onChange={(event) => setDraft((current) => ({ ...current, asin: event.target.value.toUpperCase() }))}
                  placeholder="例如 B0GTTJFQTM"
                  value={draft.asin || ''}
                />
              </FormTableRow>
              <FormTableRow label="采集批次" hint="可选；留空时自动匹配当前范围最新完整批次。">
                <input
                  aria-label="运营范围采集批次"
                  maxLength={200}
                  onChange={(event) => setDraft((current) => ({ ...current, batchId: event.target.value }))}
                  placeholder="自动匹配"
                  value={draft.batchId || ''}
                />
              </FormTableRow>
            </FormTable>
            <div className="action-row operation-scope-editor-actions" aria-label="范围编辑动作">
              <button
                className="secondary-button"
                disabled={saveStatus === 'saving'}
                onClick={() => {
                  setDraft(scope);
                  setSaveError('');
                  setEditing(false);
                }}
                type="button"
              >
                取消
              </button>
              <button
                aria-busy={saveStatus === 'saving'}
                className="primary-button"
                disabled={saveStatus === 'saving'}
                onClick={() => { void confirmScope(draft); }}
                type="button"
              >
                {saveStatus === 'saving' ? '保存中...' : '保存范围'}
              </button>
            </div>
            {saveError && <p className="blocked-line" role="alert">{saveError}</p>}
          </Panel>
        )}
        <Panel
          className="operation-scope-confirm-panel"
          title="范围字段确认"
          tone={canQuantify ? 'success' : realReportCount > 0 ? 'warning' : 'blocked'}
          titleAccessory={<StatusPill tone={taskState.tone}>{operationScopeSaveFeedbackLabel(saveStatus)}</StatusPill>}
        >
          <div className="operation-scope-card">
            <div className="operation-scope-fields" aria-label="当前范围字段">
              <div className="operation-scope-field-card">
                <span>日期</span>
                <strong>{scope.dateFrom} ~ {scope.dateTo}</strong>
                <p>所有报表和日级趋势按这个时间段读取。</p>
              </div>
              <div className="operation-scope-field-card">
                <span>店铺 / 站点</span>
                <strong>{scope.storeName} / {scope.marketplaceCode}</strong>
                <p>只匹配当前店铺站点的领星广告报表。</p>
              </div>
              <div className="operation-scope-field-card">
                <span>产品</span>
                <strong>{scope.asin || '全部产品'}</strong>
                <p>{scope.asin ? '后续页面默认锁定这个 ASIN。' : '先看全店产品，再到“产品工作台 → 产品”锁定 ASIN。'}</p>
              </div>
              <div className="operation-scope-field-card">
                <span>批次 / 币种</span>
                <strong>{activeBatch || '自动匹配'} / USD</strong>
                <p>{scope.batchId ? '使用手动指定批次。' : '优先使用当前范围最新完整批次。'}</p>
              </div>
              <div className="operation-scope-field-card">
                <span>真实报表</span>
                <strong>{Math.min(realReportCount, 8)}/8 类</strong>
                <p>{realReportCount ? '当前范围已有可用文件。' : '保存后进入数据采集。'}</p>
              </div>
              <div className="operation-scope-field-card">
                <span>入库指标</span>
                <strong>{importedRows} 行</strong>
                <p>{canQuantify ? '8 类逐类入库完成，可进入广告表现。' : importedRows > 0 ? '仅部分覆盖，仍需补齐或导入。' : '需要先导入校验。'}</p>
              </div>
            </div>
          </div>
          {collectionJobsPreviewOnly && (
            <p className="warning-line" role="status">DEV 预览不会注入伪造任务、lineage 或入库成功；此状态不提供生产就绪证明。</p>
          )}
          {collectionJobsError && <p className="blocked-line" role="alert">生产任务读取失败：{collectionJobsError}</p>}
          {!collectionJobsLoading && !collectionJobsError && !canQuantify && (
            <p className="warning-line" role="status">{lineageReadiness.detail}</p>
          )}
          {(aggregateRealReportCount !== realReportCount || aggregateImportedRows !== importedRows) && (
            <p className="warning-line">
              当前日期窗聚合检测到 {aggregateRealReportCount}/8 类文件、{aggregateImportedRows} 行指标；其中只有 {realReportCount}/8 类、{importedRows} 行属于当前生产授权链，其他批次不参与放行。
            </p>
          )}
        </Panel>
        {(loading || collectionJobsLoading) && <p className="muted-line">正在读取当前范围数据与生产任务状态...</p>}
        {error && <p className="blocked-line">范围数据读取异常：{error}</p>}

        <details className="folded-ops-panel operation-scope-impact-panel">
          <summary>
            <span>后续读取与影响页面</span>
            <StatusPill tone={canQuantify ? 'ready' : realReportCount > 0 ? 'warning' : 'blocked'}>
              {taskState.nextActionLabel}
            </StatusPill>
          </summary>
          <div className="folded-ops-body operation-scope-next-panel">
            <div>
              <span>后续读取口径</span>
              <strong>
                {canQuantify
                  ? `${importedRows} 行广告指标可用于当前范围分析`
                  : realReportCount > 0
                    ? `${realReportCount}/8 类真实报表待导入`
                    : '当前范围还缺少领星真实广告报表'}
              </strong>
              <p>
                数据采集、导入校验、广告表现和优化建议都会按这个范围读取；范围变化后，需要重新确认数据是否覆盖。
              </p>
              <div className="scope-impact-tags" aria-label="当前范围影响页面">
                <StatusPill tone="pending">数据采集</StatusPill>
                <StatusPill tone="pending">导入校验</StatusPill>
                <StatusPill tone="pending">广告表现</StatusPill>
                <StatusPill tone="pending">优化建议</StatusPill>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
