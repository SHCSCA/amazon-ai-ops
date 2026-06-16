import React, { useMemo, useState } from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { compactPath, formatUsd } from '../formatters';
import { toUserFacingError } from '../user-facing-error';

type ImportMode = 'current' | 'local';

function fileExtension(fileName: string, filePath: string): string {
  const target = fileName || filePath;
  const dotIndex = target.lastIndexOf('.');
  return dotIndex >= 0 ? target.slice(dotIndex).toLowerCase() : '-';
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function reportStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    missing: '缺少真实文件',
    downloaded: '本地已下载',
    imported: '已入库',
    import_failed: '导入失败',
    failed: '失败',
    ready: '可下载',
  };
  return labels[status] || status;
}

export function DataImportValidationPage() {
  const { data, error, loading, scope, reload } = useBusinessDataPipeline();
  const [runningImport, setRunningImport] = useState<ImportMode | null>(null);
  const [notice, setNotice] = useState('');
  const [importError, setImportError] = useState('');
  const [pathNotice, setPathNotice] = useState('');
  const collection = data?.collection;
  const quant = data?.quant;
  const reportOptions = collection?.reportOptions || [];
  const realFiles = collection?.realReportFiles || [];
  const fileAudit = collection?.fileAudit;
  const realReportCount = fileAudit?.realReportFileCount ?? realFiles.length;
  const importedRows = fileAudit?.importedRowCount ?? quant?.importedRows ?? 0;
  const rejectedEvidenceCount = fileAudit?.rejectedEvidenceFileCount ?? 0;
  const hasRealFiles = realReportCount > 0;
  const hasImportedMetrics = importedRows > 0;
  const totalSpend = quant?.totalSpend ?? 0;
  const totalSales = quant?.totalSales ?? 0;
  const totalOrders = quant?.totalOrders ?? 0;
  const reportRows = useMemo(() => reportOptions.map((option) => {
    const files = realFiles.filter((file) => file.reportType === option.type);
    const firstFile = files[0];
    const importedForType = files.reduce((sum, file) => sum + Number(file.importedRows || 0), 0) || option.importedRows;
    return {
      ...option,
      fileName: firstFile?.fileName || '',
      filePath: firstFile?.filePath || '',
      fileSizeBytes: firstFile?.fileSizeBytes || 0,
      importedRows: importedForType,
      importError: firstFile?.importError || '',
      status: firstFile?.importError ? 'import_failed' : importedForType > 0 ? 'imported' : firstFile?.status || option.status,
    };
  }), [realFiles, reportOptions]);

  async function openPath(targetPath?: string) {
    if (!targetPath) return;
    try {
      await (window as any).electronAPI?.openReportPath?.(targetPath);
      setPathNotice(`已请求打开：${compactPath(targetPath)}`);
    } catch (caught) {
      setPathNotice(`打开失败：${toUserFacingError(caught, '打开路径失败。')}`);
    }
  }

  async function runImport(mode: ImportMode) {
    const api = (window as any).electronAPI;
    setRunningImport(mode);
    setNotice(mode === 'current'
      ? '正在导入当前范围已下载的 Lingxing 原始表格...'
      : '请选择本地已有的 Lingxing xlsx/xls/csv 原始广告表格...');
    setImportError('');
    try {
      if (mode === 'current') {
        if (!api?.importCurrentBusinessReports) throw new Error('导入当前范围接口未暴露。');
        const result = await api.importCurrentBusinessReports(scope);
        const inserted = Number(result?.metricsImport?.inserted || 0);
        const parsedFiles = Number(result?.metricsImport?.parsedFiles || 0);
        const errors = Number(result?.metricsImport?.errors?.length || 0);
        if (inserted <= 0 || errors > 0) {
          setImportError(`导入未形成可量化广告数据：解析 ${parsedFiles} 个表，写入 ${inserted} 行，错误 ${errors} 个。`);
        } else {
          setNotice(`导入完成：解析 ${parsedFiles} 个真实报表，写入 ${inserted} 行广告指标。`);
        }
      } else {
        if (!api?.importLocalBusinessReportFiles) throw new Error('导入本地报表接口未暴露。');
        const result = await api.importLocalBusinessReportFiles(scope);
        if (result?.cancelled) {
          setNotice('已取消本地报表选择。');
          return;
        }
        const inserted = Number(result?.metricsImport?.inserted || 0);
        const parsedFiles = Number(result?.metricsImport?.parsedFiles || 0);
        const errors = Number(result?.metricsImport?.errors?.length || 0);
        if (inserted <= 0 || errors > 0) {
          setImportError(`本地导入未形成可量化广告数据：解析 ${parsedFiles} 个表，写入 ${inserted} 行，错误 ${errors} 个。`);
        } else {
          setNotice(`本地导入完成：解析 ${parsedFiles} 个真实报表，写入 ${inserted} 行广告指标。`);
        }
      }
      window.dispatchEvent(new Event('business-ui:data-updated'));
      reload();
    } catch (caught) {
      setImportError(toUserFacingError(caught, '真实报表导入未完成。'));
      setNotice('真实报表导入未完成。');
    } finally {
      setRunningImport(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="数据与量化"
        title="数据导入与校验"
        description="只处理真实 Lingxing xlsx/xls/csv 表格入库和口径校验。审计 JSON、截图、HTML 和 Manifest 不会被当作广告数据。"
        primaryTask="把真实表格写入每日广告数据库"
        nextAction={hasImportedMetrics ? '进入广告量化' : hasRealFiles ? '导入已下载表格' : '先到数据采集获取报表'}
      />

      <div className="business-stack">
        <Panel title="当前范围数据状态" tone={hasImportedMetrics ? 'success' : hasRealFiles ? 'warning' : 'blocked'}>
          <div className="context-summary-grid">
            <div>
              <span>当前范围</span>
              <strong>{scope.dateFrom} 至 {scope.dateTo} / {scope.storeName} / {scope.marketplaceCode} / USD</strong>
              <p>{scope.batchId ? `手动批次：${scope.batchId}` : '自动使用当前范围最新完整批次。'}</p>
            </div>
            <div>
              <span>真实表格</span>
              <strong>{realReportCount}/8</strong>
              <p>只统计 .xlsx/.xls/.csv 原始广告报表。</p>
            </div>
            <div>
              <span>已导入广告指标</span>
              <strong>{importedRows} 行</strong>
              <p>{hasImportedMetrics ? '广告量化和 AI 分析会从 SQLite 读取这些每日指标。' : '未导入前不会生成 ACOS、建议或 AI 结论。'}</p>
            </div>
            <div>
              <span>主分析口径</span>
              <strong>keyword / search term / target</strong>
              <p>不把 campaign、ad group、placement 与明细粒度重复相加。</p>
            </div>
          </div>
          <div className="business-pill-row">
            <StatusPill tone={hasRealFiles ? 'ready' : 'blocked'}>真实文件 {realReportCount}/8</StatusPill>
            <StatusPill tone={hasImportedMetrics ? 'ready' : 'blocked'}>DB 指标 {importedRows} 行</StatusPill>
            <StatusPill tone={rejectedEvidenceCount > 0 ? 'warning' : 'pending'}>审计/诊断 {rejectedEvidenceCount} 个，不参与量化</StatusPill>
          </div>
          {loading && <p className="muted-line">正在读取当前范围文件和数据库状态...</p>}
          {error && <p className="blocked-line">读取异常：{error}</p>}
        </Panel>

        <Panel title="导入动作" tone={hasRealFiles ? 'warning' : 'blocked'}>
          <div className="judgment-panel">
            <div>
              <span>下一步</span>
              <strong>{hasImportedMetrics ? '当前范围已经有入库指标' : hasRealFiles ? '导入已下载表格' : '先获取真实报表'}</strong>
              <p>
                {hasImportedMetrics
                  ? `当前 DB 已有 ${importedRows} 行指标；如果重新下载过表格，可再次导入刷新。`
                  : hasRealFiles
                    ? '把当前范围下载目录中的真实表格解析并写入 SQLite，每天的广告数据会沉淀到数据库。'
                    : '当前没有真实表格，不能导入。请先到数据采集页下载或重新创建报表。'}
              </p>
            </div>
            <div className="table-action-row">
              <button className="primary-button" disabled={!hasRealFiles || Boolean(runningImport)} onClick={() => runImport('current')} type="button">
                {runningImport === 'current' ? '正在导入...' : '导入已下载表格'}
              </button>
              <button className="secondary-button" disabled={Boolean(runningImport)} onClick={() => runImport('local')} type="button">
                {runningImport === 'local' ? '正在选择...' : '导入本地报表'}
              </button>
            </div>
          </div>
          {notice && <p className="muted-line">{notice}</p>}
          {importError && <p className="blocked-line">{importError}</p>}
        </Panel>

        {hasImportedMetrics && (
          <Panel title="量化前口径快照" tone="success">
            <div className="context-summary-grid">
              <div><span>广告花费</span><strong>{formatUsd(totalSpend)}</strong><p>来自当前范围已导入指标。</p></div>
              <div><span>广告销售</span><strong>{formatUsd(totalSales)}</strong><p>用于 ACOS 和阶段判断。</p></div>
              <div><span>广告订单</span><strong>{totalOrders}</strong><p>后续建议会结合订单和花费阈值。</p></div>
              <div><span>可行动行</span><strong>{quant?.actionableRows ?? 0}</strong><p>只有可绑定 keyword/search term/target 的行能进入建议。</p></div>
            </div>
          </Panel>
        )}

        <Panel title="8 类报表入库明细" tone={hasRealFiles ? 'default' : 'blocked'}>
          <div className="table-wrap">
            <table className="business-table">
              <thead>
                <tr>
                  <th>报表</th>
                  <th>真实文件</th>
                  <th>类型</th>
                  <th>大小</th>
                  <th>入库行数</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.map((row) => (
                  <tr key={row.type}>
                    <td>{row.label}</td>
                    <td>{row.filePath ? <code>{compactPath(row.filePath)}</code> : '缺少真实文件'}</td>
                    <td><code>{row.filePath ? fileExtension(row.fileName, row.filePath) : '-'}</code></td>
                    <td>{formatFileSize(row.fileSizeBytes)}</td>
                    <td>{row.importedRows}</td>
                    <td>
                      {reportStatusLabel(row.status)}
                      {row.importError && <div className="blocked-line table-subtext">{row.importError}</div>}
                    </td>
                    <td>
                      <button className="secondary-button compact-button" disabled={!row.filePath} onClick={() => openPath(row.filePath)} type="button">
                        打开表格
                      </button>
                    </td>
                  </tr>
                ))}
                {!reportRows.length && (
                  <tr>
                    <td colSpan={7}>当前范围还没有报表状态。请先完成数据采集。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="文件位置" tone={hasRealFiles ? 'default' : 'blocked'}>
          <div className="path-list">
            <div className="path-row">
              <span>真实广告表格目录</span>
              <code>{fileAudit?.downloadDir ? compactPath(fileAudit.downloadDir) : '暂无'}</code>
              <button className="secondary-button compact-button" disabled={!fileAudit?.downloadDir} onClick={() => openPath(fileAudit?.downloadDir)} type="button">打开</button>
            </div>
            <div className="path-row">
              <span>Manifest</span>
              <code>{fileAudit?.manifestPath ? compactPath(fileAudit.manifestPath) : '暂无'}</code>
              <button className="secondary-button compact-button" disabled={!fileAudit?.manifestPath} onClick={() => openPath(fileAudit?.manifestPath)} type="button">打开</button>
            </div>
          </div>
          <p className="warning-line">Manifest 和审计证据只用于追溯流程；广告量化只读取上方真实表格和 SQLite 指标。</p>
          {pathNotice && <p className={pathNotice.startsWith('打开失败') ? 'blocked-line' : 'muted-line'}>{pathNotice}</p>}
        </Panel>
      </div>
    </div>
  );
}
