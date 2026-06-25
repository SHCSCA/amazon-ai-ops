import React, { useState } from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { OperatorTaskPanel } from '../components/operator-task-panel';
import { PageHeader, Panel, StateLightGrid, StatusPill } from '../components/ui';
import { toUserFacingError } from '../user-facing-error';
import type { AppRoute } from '../types';

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
  const [saveStatus, setSaveStatus] = useState<OperationScopeSaveStatus>('idle');
  const [saveError, setSaveError] = useState('');
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

  const confirmScope = async () => {
    setSaveStatus('saving');
    setSaveError('');
    try {
      const api = (window as any).electronAPI;
      if (!api?.saveOperationScope) throw new Error('范围保存接口未暴露');
      await api.saveOperationScope(scope);
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
        title="全局范围"
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
          <div className="dashboard-task-metrics" aria-label="工作范围任务摘要">
            <StatusPill tone={taskState.tone}>报表 {Math.min(realReportCount, 8)}/8</StatusPill>
            <StatusPill tone={importedRows > 0 ? 'ready' : 'blocked'}>指标 {importedRows} 行</StatusPill>
            <StatusPill tone={activeBatch ? 'ready' : 'pending'}>{activeBatch || '自动匹配批次'}</StatusPill>
            <StatusPill tone="pending">USD</StatusPill>
          </div>
          <div className={`scope-task-feedback scope-task-feedback-${saveStatus}`} aria-live="polite">
            <span>{operationScopeSaveFeedbackLabel(saveStatus)}</span>
            {saveError && <strong>{saveError}</strong>}
          </div>
        </OperatorTaskPanel>

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
