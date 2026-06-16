import React, { useEffect, useMemo, useState } from 'react';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { useScopeStore } from '../scope-store';
import type { BusinessDataPipeline, DeliveryReadinessGate, DeliveryReadinessView, OperationScope } from '../types';
import { toUserFacingError } from '../user-facing-error';

const DEFAULT_SCOPE: OperationScope = {
  dateFrom: '2026-06-01',
  dateTo: '2026-06-12',
  storeName: 'FT-US-US',
  marketplaceCode: 'US',
  currency: 'USD' as const,
};

const DELIVERY_BUNDLE_PATH = 'output/delivery-bundles';

type DeliveryTone = 'ready' | 'pending' | 'blocked' | 'warning';

interface DeliveryItem {
  title: string;
  tone: DeliveryTone;
  summary: string;
  actions: string[];
  evidence?: string[];
}

interface DataReconciliationExportResult {
  jsonPath?: string;
  markdownPath?: string;
  canonicalSource?: string;
  canonical?: {
    rows?: number;
    spend?: number;
    orders?: number;
    sales?: number;
    clicks?: number;
    impressions?: number;
    currency?: string;
  };
  blockers?: string[];
}

function api(): Record<string, any> {
  return ((window as any).electronAPI || {}) as Record<string, any>;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function summarizeScope(data: BusinessDataPipeline | null, fallbackScope: OperationScope): string {
  const scope = data?.scope || fallbackScope;
  return `${scope.storeName} / ${scope.marketplaceCode} / ${scope.dateFrom} - ${scope.dateTo} / USD`;
}

function statusLabel(tone: DeliveryTone): string {
  const labels: Record<DeliveryTone, string> = {
    ready: '已完成',
    pending: '待处理',
    blocked: '需补齐',
    warning: '需复核',
  };
  return labels[tone];
}

function readinessStatus(readiness: DeliveryReadinessView | null): string {
  return readiness?.appReady && readiness?.manifestDriven ? '可交付' : '未就绪';
}

function readinessTone(readiness: DeliveryReadinessView | null): DeliveryTone {
  if (readiness?.appReady && readiness?.manifestDriven) return 'ready';
  if (readiness?.exists === false || !readiness?.available) return 'blocked';
  if (readiness.manifestDriven) return 'blocked';
  return 'warning';
}

function evidenceFolder(data: BusinessDataPipeline | null): string {
  const paths = data?.collection?.evidencePaths || [];
  return paths.find((item) => item.kind === 'folder')?.path || data?.collection?.latestBatch?.downloadDir || DELIVERY_BUNDLE_PATH;
}

function deliveryTextForDisplay(text: string): string {
  return text
    .replace(/APP_READY/g, '可交付状态')
    .replace(/APP_NEEDS_WORK/g, '未就绪状态')
    .replace(/\bREADY\b/g, '可交付');
}

function deliveryTextsForDisplay(items: string[] | undefined): string[] {
  return (items || []).map((item) => deliveryTextForDisplay(item));
}

function buildManifestActions(readiness: DeliveryReadinessView | null): string[] {
  if (!readiness?.available) return [deliveryTextForDisplay(readiness?.message || '最终验收 manifest 尚未生成')];
  if (!readiness.manifestDriven) return ['重新生成 evidence manifest，并用该 manifest 运行最终验收。'];
  if (readiness.appReady) {
    const passedMessages = readiness.gates
      .filter((gate) => gate.ok && gate.message)
      .map((gate) => deliveryTextForDisplay(gate.message as string));
    return ['最终就绪 manifest 已通过；仍需保留证据包和安装包 hash。', ...passedMessages];
  }
  if (readiness.actionItems && readiness.actionItems.length > 0) return deliveryTextsForDisplay(readiness.actionItems);
  const gateActions = readiness.gates
    .filter((gate) => !gate.ok)
    .map((gate) => deliveryTextForDisplay(gate.message || `${gate.name} 未通过。`));
  return gateActions.length > 0 ? gateActions : ['补齐未通过的 final readiness gate 后重新验收。'];
}

function gateStatusLabel(gate: DeliveryReadinessGate): string {
  if (gate.ok) return '通过';
  return gate.status === 'blocked' ? '阻断' : '未通过';
}

function gateMessageForDisplay(gate: DeliveryReadinessGate, manifestReady: boolean): string {
  const raw = gate.message || '无附加说明';
  return manifestReady ? deliveryTextForDisplay(raw) : deliveryTextForDisplay(raw);
}

function buildDeliveryItems(data: BusinessDataPipeline | null, readiness: DeliveryReadinessView | null): DeliveryItem[] {
  const collection = data?.collection;
  const quant = data?.quant;
  const files = collection?.realReportFiles || [];
  const options = collection?.reportOptions || [];
  const missingReports = options.filter((item) => !item.realFileAvailable);
  const importedRows = readNumber(collection?.fileAudit?.importedRowCount, readNumber(quant?.importedRows, 0));
  const diagnostics = quant?.diagnostics || [];
  const collectionBlockers = collection?.blockers || [];
  const quantBlockers = quant?.blockers || [];
  const hasRealFiles = files.length > 0;
  const hasMetrics = Boolean(quant?.hasImportedMetrics) && importedRows > 0;
  const finalReady = Boolean(readiness?.appReady && readiness?.manifestDriven);

  return [
    {
      title: '原始广告报表',
      tone: hasRealFiles && missingReports.length === 0 ? 'ready' : hasRealFiles ? 'warning' : 'blocked',
      summary: hasRealFiles ? `当前范围可见 ${files.length} 个原始广告报表文件。` : '当前范围没有可用于交付的 .xlsx/.xls/.csv 原始广告报表。',
      actions: missingReports.length > 0
        ? missingReports.map((item) => `下载并导入${item.label}。`)
        : hasRealFiles
          ? ['在交付包中保留原始文件路径和导入记录。']
          : ['先从领星下载真实广告报表，再进入量化和交付验收。'],
      evidence: files.map((file) => `${file.displayName}: ${file.filePath || file.fileName}（${file.importedRows} 行）`),
    },
    {
      title: '广告指标入库',
      tone: hasMetrics ? 'ready' : 'blocked',
      summary: hasMetrics ? `当前范围已有 ${importedRows} 行广告指标。` : '当前范围缺少已导入广告指标。',
      actions: hasMetrics ? ['对账原始报表与本地数据库导入行数。'] : ['导入已下载的原始广告报表到本地指标库。'],
      evidence: [
        `花费：${readNumber(quant?.totalSpend).toFixed(2)} USD`,
        `销售额：${readNumber(quant?.totalSales).toFixed(2)} USD`,
        `订单：${readNumber(quant?.totalOrders)}`,
        `点击：${readNumber(quant?.totalClicks)}`,
      ],
    },
    {
      title: '广告量化',
      tone: diagnostics.length > 0 ? 'warning' : 'blocked',
      summary: diagnostics.length > 0 ? `已有 ${diagnostics.length} 条量化诊断需要业务复核。` : '还没有可交付的实体级广告量化诊断。',
      actions: diagnostics.length > 0 ? ['先复核高风险行，再生成或审批优化建议。'] : ['真实文件和导入指标齐备后运行广告量化。'],
      evidence: diagnostics.slice(0, 3).map((item) => `${item.campaignName || '广告活动'} / ${item.objectName || '对象'}：ACOS ${percent(readNumber(item.acos))}`),
    },
    {
      title: 'AI 业务证据',
      tone: finalReady ? 'ready' : 'blocked',
      summary: finalReady ? '最终 manifest 已接受 AI 相关证据。' : '最终 manifest 尚未证明真实 AI 连接、广告 AI 解释和 Listing AI 草案。',
      actions: finalReady ? ['保留脱敏 AI 证据路径。'] : ['保存脱敏 Provider 配置，完成连接测试，并附加广告解释与 Listing 草案证据。'],
    },
    {
      title: '优化建议证据',
      tone: finalReady ? 'ready' : hasMetrics ? 'pending' : 'blocked',
      summary: finalReady ? '最终 manifest 已接受优化建议证据。' : hasMetrics ? '已有指标，但仍需绑定当前来源文件的建议证据。' : '缺少真实指标时不能生成交付级建议。',
      actions: ['只从当前范围数据批次生成建议，并保留来源文件证据。'],
    },
    {
      title: '审批与回读',
      tone: finalReady ? 'ready' : 'blocked',
      summary: finalReady ? '最终 manifest 已接受审批和回读证据。' : '仍需真实广告动作的审批、before/after 和 readback 证明。',
      actions: ['记录审批人、范围、before 值、after 值、截图和回读值。'],
    },
    {
      title: '关键词机会',
      tone: finalReady ? 'ready' : hasMetrics ? 'pending' : 'blocked',
      summary: finalReady ? '最终 manifest 已接受关键词机会证据。' : hasMetrics ? '可生成关键词机会，但交付证据尚未聚合。' : '关键词机会需要已导入广告指标。',
      actions: ['按 ASIN、campaign、ad group、对象类型和关键词去重生成机会。'],
    },
    {
      title: 'Listing 草案证据',
      tone: finalReady ? 'ready' : 'blocked',
      summary: finalReady ? '最终 manifest 已接受 Listing AI 草案证据。' : '当前最终就绪状态缺少 Listing AI 草案证据。',
      actions: ['从领星读取 Listing，生成本地 AI 草案，并保留导出路径。'],
    },
    {
      title: '安装包',
      tone: finalReady ? 'pending' : 'blocked',
      summary: finalReady ? '可以进入安装包/hash 交付步骤。' : '最终 manifest 未通过前不能声明安装包可交付。',
      actions: ['最终节点生成 no-install exe，并记录路径和 SHA-256。'],
    },
    {
      title: '当前阻塞项',
      tone: finalReady ? 'ready' : 'blocked',
      summary: finalReady ? '最终 manifest gate 已通过。' : '当前范围仍有需要处理的交付阻塞项。',
      actions: [
        ...buildManifestActions(readiness),
        ...deliveryTextsForDisplay(readiness?.missing),
        ...deliveryTextsForDisplay(collectionBlockers),
        ...deliveryTextsForDisplay(quantBlockers),
      ],
    },
  ];
}

export function DeliveryPage() {
  const scope = useScopeStore((state) => state.scope);
  const [data, setData] = useState<BusinessDataPipeline | null>(null);
  const [readiness, setReadiness] = useState<DeliveryReadinessView | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [dataReconciliation, setDataReconciliation] = useState<DataReconciliationExportResult | null>(null);

  const apiSurface = useMemo(() => api(), []);
  const canOpenPath = typeof apiSurface.openReportPath === 'function';
  const items = useMemo(() => buildDeliveryItems(data, readiness), [data, readiness]);
  const reportFolder = evidenceFolder(data);
  const finalManifestPath = readiness?.path || '';
  const realFiles = data?.collection?.realReportFiles || [];
  const reportDownloadDir = data?.collection?.fileAudit?.downloadDir || reportFolder;
  const collectionManifestPath = data?.collection?.fileAudit?.manifestPath || data?.collection?.latestBatch?.manifestPath || '';
  const quant = data?.quant;
  const importedRows = readNumber(data?.collection?.fileAudit?.importedRowCount, readNumber(quant?.importedRows));
  const status = readinessStatus(readiness);
  const tone = readinessTone(readiness);
  const manifestReady = readiness?.appReady && readiness?.manifestDriven;
  const manifestScopeNote = manifestReady
    ? '可交付只代表最终 manifest 选中的证据已通过；如果切换了日期、店铺、站点或批次，需要重新生成当前范围证据。'
    : '当前还不能声明可交付；先按下方缺口补齐证据，再重新生成最终 manifest。';

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      const notes: string[] = [];
      try {
        if (typeof apiSurface.getBusinessUiDataPipeline === 'function') {
          const nextData = await apiSurface.getBusinessUiDataPipeline(scope);
          if (mounted) setData(nextData);
        } else {
          notes.push('数据管道 API 未接入，交付页只显示 manifest 状态。');
        }
        if (typeof apiSurface.getDeliveryReadiness === 'function') {
          const nextReadiness = await apiSurface.getDeliveryReadiness();
          if (mounted) setReadiness(nextReadiness);
        } else {
          notes.push('最终就绪 manifest API 未接入。');
          if (mounted) {
            setReadiness({
              available: false,
              path: null,
              exists: false,
              status: 'APP_NEEDS_WORK',
              appReady: false,
              manifestDriven: false,
              gates: [],
              gatesSummary: { total: 0, passed: 0, failed: 0 },
              missing: ['最终验收 manifest API 未接入'],
              actionItems: ['接入 getDeliveryReadiness API 后重新读取最终验收 manifest。'],
              message: '最终验收 manifest API 未接入。',
            });
          }
        }
      } catch (caught) {
        notes.push(toUserFacingError(caught, '读取交付状态失败。'));
      } finally {
        if (mounted) {
          setMessage(notes.join(' '));
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [apiSurface, scope.asin, scope.batchId, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName]);

  async function openPath(targetPath: string, label: string) {
    if (!targetPath) {
      setMessage(`${label}不可用：最终验收 manifest 尚未生成。`);
      return;
    }
    if (!canOpenPath) {
      setMessage(`${label}不可用：openReportPath 未接入。`);
      return;
    }
    try {
      await apiSurface.openReportPath(targetPath);
      setMessage(`${label}已请求打开：${targetPath}`);
    } catch (caught) {
      setMessage(toUserFacingError(caught, `${label}打开失败。`));
    }
  }

  async function exportBundle() {
    if (typeof apiSurface.exportDeliveryBundle !== 'function') {
      setMessage('导出交付包 API 未接入。请先生成最终就绪 manifest，再运行交付包导出。');
      return;
    }
    try {
      const result = await apiSurface.exportDeliveryBundle(scope);
      if (result?.success) {
        if (result.dataReconciliation) {
          setDataReconciliation(result.dataReconciliation);
        }
        const reconciliationSuffix = result.dataReconciliation?.jsonPath || result.dataReconciliation?.markdownPath
          ? '；已包含当前范围数据口径核对'
          : '';
        setMessage(`交付包已导出：${result.bundleDir || result.manifestPath}${reconciliationSuffix}`);
      } else {
        setMessage(deliveryTextForDisplay(result?.message || '交付包未导出：请先补齐最终就绪证据。'));
      }
    } catch (caught) {
      setMessage(deliveryTextForDisplay(toUserFacingError(caught, '交付包导出失败。')));
    }
  }

  async function exportDataReconciliation() {
    if (typeof apiSurface.exportDataReconciliation !== 'function') {
      setMessage('数据口径核对导出 API 未接入。');
      return;
    }
    try {
      const result = await apiSurface.exportDataReconciliation(scope);
      setDataReconciliation(result || null);
      if (result?.jsonPath || result?.markdownPath) {
        setMessage(`数据口径核对报告已导出：${result.markdownPath || result.jsonPath}`);
      } else {
        setMessage('数据口径核对报告已生成，但未返回文件路径。');
      }
    } catch (caught) {
      setMessage(toUserFacingError(caught, '数据口径核对报告导出失败。'));
    }
  }

  async function copySummary() {
    const summary = [
      `交付状态：${status}`,
      `范围：${summarizeScope(data, scope)}`,
      '最终就绪 manifest 是交付状态的唯一来源。',
      `真实报表文件：${realFiles.length}`,
      `真实报表目录：${reportDownloadDir || '不可用'}`,
      `真实报表清单：${collectionManifestPath || '不可用'}`,
      ...realFiles.slice(0, 8).map((file) => `原始文件：${file.displayName || file.reportType} / ${file.filePath || file.fileName || '-'}`),
      `导入指标行数：${importedRows}`,
      `最终 manifest：${finalManifestPath || '最终验收 manifest 尚未生成'}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(summary);
      setMessage('交付摘要已复制。');
    } catch (caught) {
      setMessage(toUserFacingError(caught, '复制交付摘要失败。'));
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="系统与交付"
        title="交付验收"
        description="交付页把最终验收 manifest 翻译成业务可交付状态；截图、局部检查和数据管道只能作为旁证。"
        primaryTask="补齐交付证据"
        nextAction={readiness?.appReady ? '导出交付包并记录安装包 hash' : '补齐未通过的验收项'}
      />

      <div className="business-stack">
        <Panel title="应用就绪状态" tone={tone === 'ready' ? 'success' : tone === 'blocked' ? 'blocked' : 'warning'}>
          <div className="delivery-readiness-row">
            <div>
              <StatusPill tone={tone}>{status}</StatusPill>
              <p className="delivery-readiness-copy">最终验收 manifest 是交付状态的唯一来源。只有 manifest 驱动且所有验收项通过时，本页才会显示可交付状态。</p>
              <p className={manifestReady ? 'muted-line' : 'blocked-line'}>{manifestScopeNote}</p>
            </div>
            <div className="delivery-action-row">
              <button className="secondary-button" onClick={exportBundle} type="button">
                导出交付包
              </button>
              <button className="secondary-button" onClick={exportDataReconciliation} type="button">
                导出数据口径核对
              </button>
              <button className="secondary-button" onClick={() => openPath(reportFolder, '打开证据目录')} type="button">
                打开证据目录
              </button>
              <button className="secondary-button" onClick={() => openPath(finalManifestPath, '打开最终 manifest')} type="button">
                打开最终 manifest
              </button>
              <button className="primary-button" onClick={copySummary} type="button">
                复制摘要
              </button>
            </div>
          </div>
          <div className="delivery-meta-grid">
            <div>
              <span>运营范围</span>
              <strong>{summarizeScope(data, scope)}</strong>
            </div>
            <div>
              <span>真实文件</span>
              <strong>{realFiles.length} 个 / {reportDownloadDir || '目录不可用'}</strong>
            </div>
            <div>
              <span>导入行数</span>
              <strong>{importedRows}</strong>
            </div>
            <div>
              <span>采集 Manifest</span>
              <strong>{collectionManifestPath || '不可用'}</strong>
            </div>
            <div>
              <span>最终 manifest</span>
              <strong>{finalManifestPath || readiness?.message || '最终验收 manifest 尚未生成'}</strong>
            </div>
          </div>
        </Panel>

        {dataReconciliation && (
          <Panel title="数据口径核对报告" tone={dataReconciliation.blockers?.length ? 'warning' : 'success'}>
            <div className="delivery-meta-grid">
              <div>
                <span>canonical 口径</span>
                <strong>{dataReconciliation.canonicalSource || 'none'}</strong>
              </div>
              <div>
                <span>DB 汇总</span>
                <strong>
                  {dataReconciliation.canonical?.rows ?? 0} 行 / {Number(dataReconciliation.canonical?.spend || 0).toFixed(2)} USD / {dataReconciliation.canonical?.orders ?? 0} 单
                </strong>
              </div>
              <div>
                <span>报告 JSON</span>
                <strong>{dataReconciliation.jsonPath || '-'}</strong>
              </div>
              <div>
                <span>报告 Markdown</span>
                <strong>{dataReconciliation.markdownPath || '-'}</strong>
              </div>
            </div>
            {Boolean(dataReconciliation.blockers?.length) && (
              <ul className="delivery-action-list">
                {dataReconciliation.blockers?.slice(0, 6).map((item) => (
                  <li key={item}>{deliveryTextForDisplay(item)}</li>
                ))}
              </ul>
            )}
            <div className="delivery-action-row">
              <button className="secondary-button" disabled={!dataReconciliation.markdownPath} onClick={() => openPath(dataReconciliation.markdownPath || '', '打开数据口径核对 Markdown')} type="button">
                打开 Markdown
              </button>
              <button className="secondary-button" disabled={!dataReconciliation.jsonPath} onClick={() => openPath(dataReconciliation.jsonPath || '', '打开数据口径核对 JSON')} type="button">
                打开 JSON
              </button>
            </div>
          </Panel>
        )}

        <Panel title="最终证据清单" tone={manifestReady ? 'success' : 'warning'}>
          <p className="muted-line">这里列出 final readiness manifest 采用的证据文件。当前范围的数据卡片只说明本地数据状态，不能替代这些 gate。</p>
          {readiness?.gates?.length ? (
            <div className="delivery-gate-list">
              {readiness.gates.map((gate) => (
                <div className="delivery-gate-row" key={`${gate.name}-${gate.evidencePath || 'missing'}`}>
                  <div>
                    <strong>{gate.name}</strong>
                    <span>{gateMessageForDisplay(gate, Boolean(manifestReady))}</span>
                  </div>
                  <StatusPill tone={gate.ok ? 'ready' : 'blocked'}>{gateStatusLabel(gate)}</StatusPill>
                  <code>{gate.evidencePath || '未绑定证据路径'}</code>
                </div>
              ))}
            </div>
          ) : (
            <p className="blocked-line">尚未读取到 final readiness gate。需要先生成最终验收 manifest。</p>
          )}
        </Panel>

        <div className="delivery-section-grid">
          {items.map((item) => (
            <Panel key={item.title} title={item.title} tone={item.tone === 'ready' ? 'success' : item.tone === 'blocked' ? 'blocked' : item.tone === 'warning' ? 'warning' : 'default'}>
              <div className="delivery-card-header">
                <StatusPill tone={item.tone}>{statusLabel(item.tone)}</StatusPill>
              </div>
              <p>{item.summary}</p>
              <ul className="delivery-action-list">
                {item.actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
              {item.evidence && item.evidence.length > 0 && (
                <div className="delivery-evidence-list">
                  {item.evidence.map((entry) => (
                    <span key={entry}>{entry}</span>
                  ))}
                </div>
              )}
            </Panel>
          ))}
        </div>

        <details className="details-panel">
          <summary>技术细节</summary>
          <div className="details-content">
            <p>数据管道生成时间：{data?.generatedAt || (loading ? '读取中...' : '不可用')}</p>
            <p>最终验收生成时间：{readiness?.generatedAt || '不可用'}</p>
            <p>最终验收检查时间：{readiness?.checkedAt || '不可用'}</p>
            <p>验收项汇总：{readiness?.gatesSummary ? `${readiness.gatesSummary.passed}/${readiness.gatesSummary.total} 通过` : '不可用'}</p>
            <p>证据目录：{reportFolder}</p>
            <p>交付包目标：{DELIVERY_BUNDLE_PATH}</p>
          </div>
        </details>

        {message && <Panel title="交付消息">{message}</Panel>}
      </div>
    </div>
  );
}
