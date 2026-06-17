import React from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import type { AppRoute } from '../types';

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

export function OperationScopePage() {
  const { data, scope, loading, error } = useBusinessDataPipeline();
  const collection = data?.collection;
  const quant = data?.quant;
  const activeBatch = scope.batchId || collection?.latestBatch?.id || '';
  const realReportCount = collection?.fileAudit?.realReportFileCount ?? collection?.realReportFiles.length ?? 0;
  const importedRows = collection?.fileAudit?.importedRowCount ?? quant?.importedRows ?? 0;
  const canQuantify = realReportCount > 0 && importedRows > 0;

  return (
    <div>
      <PageHeader
        eyebrow="数据与量化"
        title="工作范围"
        description="统一管理日期、店铺、站点、币种和数据批次。后续采集、导入、量化、建议、审批和 Listing 都按这个范围读取。"
        primaryTask="确认全局范围"
        nextAction={canQuantify ? '进入广告量化' : realReportCount > 0 ? '导入已下载表格' : '获取真实报表'}
      />

      <div className="business-stack">
        <Panel title="当前操作范围" tone={canQuantify ? 'success' : realReportCount > 0 ? 'warning' : 'blocked'}>
          <div className="context-summary-grid">
            <div>
              <span>日期</span>
              <strong>{scope.dateFrom} 至 {scope.dateTo}</strong>
              <p>领星报表、数据库查询和 AI 分析都会使用这个日期范围。</p>
            </div>
            <div>
              <span>店铺/站点</span>
              <strong>{scope.storeName || '-'} / {scope.marketplaceCode || '-'}</strong>
              <p>跨境业务默认使用站点币种，当前固定为 USD。</p>
            </div>
            <div>
              <span>币种</span>
              <strong>USD</strong>
              <p>广告花费、销售额、CPC 和阈值展示均使用美元。</p>
            </div>
            <div>
              <span>数据批次</span>
              <strong>{activeBatch || '自动匹配最新完整批次'}</strong>
              <p>{scope.batchId ? '当前为手动指定批次；请确认它属于当前日期、店铺和站点。' : '未手动指定时，系统自动选择当前范围最新完整批次。'}</p>
            </div>
          </div>
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
              ['数据导入与校验', '只导入这个范围的 xlsx/xls/csv，不读取审计 JSON。', 'data-import-validation'],
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
