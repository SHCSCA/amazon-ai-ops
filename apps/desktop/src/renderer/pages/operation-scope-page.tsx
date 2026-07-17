import { useState } from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { TaskBanner } from '../components/workspace';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import { buildDataReadinessLedger, type DataReadinessLedger } from '../data-readiness-ledger';
import { importedReportTypeCoverageCount } from '../report-coverage';
import { useScopeStore } from '../scope-store';
import { toUserFacingError } from '../user-facing-error';
import type { AppRoute, OperationScope } from '../types';

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

export function OperationScopePage() {
  const { data, scope, loading, error } = useBusinessDataPipeline();
  const setScope = useScopeStore((state) => state.setScope);
  const [saveStatus, setSaveStatus] = useState<OperationScopeSaveStatus>('idle');
  const [saveError, setSaveError] = useState('');
  const collection = data?.collection;
  const quant = data?.quant;
  const activeBatch = scope.batchId || collection?.latestBatch?.id || '';
  const reportOptions = collection?.reportOptions || [];
  const realReportCount = collection?.fileAudit?.realReportFileCount ?? collection?.realReportFiles.length ?? 0;
  const importedReportTypeCount = importedReportTypeCoverageCount(collection);
  const importedRows = collection?.fileAudit?.importedRowCount ?? quant?.importedRows ?? 0;
  const dataLedger = buildDataReadinessLedger({
    requiredReportCount: 8,
    reportOptions,
    realReportFileCount: realReportCount,
    importedRowCount: importedRows,
    rejectedEvidenceFileCount: collection?.fileAudit?.rejectedEvidenceFileCount ?? 0,
  });
  const canQuantify = dataLedger.canEnterDiagnosis;
  const taskState = buildOperationScopeTaskState({
    realReportCount,
    importedReportTypeCount,
    importedRows,
    activeBatch,
    saveStatus,
    readiness: dataLedger,
  });

  const confirmScope = async () => {
    const normalizedDraft = normalizeOperationScopeDraft(scope);
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
        description={saveError || taskState.detail}
        meta={`报表文件 ${Math.min(realReportCount, 8)}/8 类 · 逐类入库 ${importedReportTypeCount}/8 类 · ${importedRows} 行指标`}
        primaryAction={{
          label: taskState.primaryActionLabel,
          onClick: () => { void confirmScope(); },
          busy: taskState.primaryActionBusy,
          busyLabel: taskState.primaryActionBusyLabel,
        }}
        secondaryActions={[
          { label: '编辑范围', onClick: openScopeEditor, disabled: taskState.primaryActionBusy },
          { label: taskState.nextActionLabel, onClick: () => navigate(taskState.nextRoute), disabled: taskState.primaryActionBusy },
        ]}
        status={operationScopeSaveFeedbackLabel(saveStatus)}
        title={taskState.title}
        tone={taskState.tone === 'ready' ? 'confirmed' : taskState.tone === 'warning' ? 'attention' : 'blocked'}
      />

      <div className="business-stack">
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
        </Panel>
        {loading && <p className="muted-line">正在读取当前范围数据状态...</p>}
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
