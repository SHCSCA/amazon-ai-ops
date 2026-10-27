import { buildDeliveryReadinessMatrix } from '../delivery-readiness-matrix';
import type { BusinessDataPipeline, DeliveryEvidenceStatusView, DeliveryReadinessView } from '../types';
import { type DeliveryItem } from './delivery-contracts';
import { deliveryTextsForDisplay, percent, readinessBlockerTexts, readNumber, stripPrimaryTechnicalDetails, uniqueDisplayTexts } from './delivery-presentation';

export function primaryMissingItems(
  readiness: DeliveryReadinessView | null,
  matrix: ReturnType<typeof buildDeliveryReadinessMatrix>,
): string[] {
  const matrixGaps = matrix.items
    .filter((item) => item.tone !== 'ready')
    .map((item) => `${item.label}：${item.detail}`);
  return uniqueDisplayTexts([
    ...matrixGaps,
    ...readinessBlockerTexts(readiness),
  ].map(stripPrimaryTechnicalDetails)).slice(0, 3);
}

export function buildDeliveryItems(
  data: BusinessDataPipeline | null,
  readiness: DeliveryReadinessView | null,
  evidenceStatus?: DeliveryEvidenceStatusView | null,
): DeliveryItem[] {
  const collection = data?.collection;
  const quant = data?.quant;
  const files = collection?.realReportFiles || [];
  const options = collection?.reportOptions || [];
  const missingReports = options.filter((item) => !item.realFileAvailable);
  const importedRows = readNumber(collection?.fileAudit?.importedRowCount, readNumber(quant?.importedRows, 0));
  const diagnostics = quant?.diagnostics || [];
  const collectionBlockers = collection?.blockers || [];
  const quantBlockers = quant?.blockers || [];
  const readinessBlockers = readinessBlockerTexts(readiness);
  const hasRealFiles = files.length > 0;
  const hasMetrics = Boolean(quant?.hasImportedMetrics) && importedRows > 0;
  const finalReady = Boolean(readiness?.appReady && readiness?.manifestDriven);
  const packageEvidence = evidenceStatus?.package;
  const packageReady = Boolean(finalReady && packageEvidence?.installerAvailable);

  return [
    {
      title: '原始广告报表',
      tone: hasRealFiles && missingReports.length === 0 ? 'ready' : hasRealFiles ? 'warning' : 'blocked',
      summary: !data ? '当前范围原始广告报表状态未知，业务数据尚未读取。' : hasRealFiles ? `当前范围可见 ${files.length} 个原始广告报表文件。` : '当前范围没有可用于交付的 .xlsx/.xls/.csv 原始广告报表。',
      actions: !data ? ['请先到系统设置检查或创建当前店铺运行配置，再重新读取业务数据。'] : missingReports.length > 0
        ? missingReports.map((item) => `下载并导入${item.label}。`)
        : hasRealFiles
          ? ['在交付包中保留原始报表工件标识和导入记录。']
          : ['先从领星下载真实广告报表，再进入量化和交付验收。'],
      evidence: files.map((file) => `${file.displayName}: ${file.artifactDisplayName || file.fileName || '工件名称不可用'}（${file.importedRows} 行）`),
    },
    {
      title: '广告指标入库',
      tone: hasMetrics ? 'ready' : 'blocked',
      summary: !data ? '当前范围广告指标数量和金额未知，业务数据尚未读取。' : hasMetrics ? `当前范围已有 ${importedRows} 行广告指标。` : '当前范围缺少已导入广告指标。',
      actions: hasMetrics ? ['对账原始报表与本地数据库导入行数。'] : ['导入已下载的原始广告报表到本地指标库。'],
      evidence: !data ? ['指标数值未知，不能据此判断为零。'] : [
        `花费：${readNumber(quant?.totalSpend).toFixed(2)} USD`,
        `销售额：${readNumber(quant?.totalSales).toFixed(2)} USD`,
        `订单：${readNumber(quant?.totalOrders)}`,
        `点击：${readNumber(quant?.totalClicks)}`,
      ],
    },
    {
      title: '广告表现',
      tone: diagnostics.length > 0 ? 'warning' : 'blocked',
      summary: diagnostics.length > 0 ? `已有 ${diagnostics.length} 条广告表现诊断需要业务复核。` : '还没有可交付的实体级广告表现诊断。',
      actions: diagnostics.length > 0 ? ['先复核高风险行，再生成或审批优化建议。'] : ['真实文件和导入指标齐备后查看广告表现。'],
      evidence: diagnostics.slice(0, 3).map((item) => `${item.campaignName || '广告活动'} / ${item.objectName || '对象'}：ACOS ${percent(readNumber(item.acos))}`),
    },
    {
      title: 'AI 业务证据',
      tone: finalReady ? 'ready' : 'blocked',
      summary: finalReady ? '最终验收汇总已接受 AI 相关证据。' : '最终验收汇总尚未证明真实 AI 连接、广告 AI 解释和 Listing AI 草案。',
      actions: finalReady ? ['保留脱敏 AI 证据路径。'] : ['保存脱敏 Provider 配置，完成连接测试，并附加广告解释与 Listing 草案证据。'],
    },
    {
      title: '优化建议证据',
      tone: finalReady ? 'ready' : hasMetrics ? 'pending' : 'blocked',
      summary: finalReady ? '最终验收汇总已接受优化建议证据。' : hasMetrics ? '已有指标，但仍需绑定当前来源文件的建议证据。' : '缺少真实指标时不能生成交付级建议。',
      actions: ['只从当前范围数据批次生成建议，并保留来源文件证据。'],
    },
    {
      title: '审批与回读',
      tone: finalReady ? 'ready' : 'blocked',
      summary: finalReady ? '最终验收汇总已接受审批和回读证据。' : '仍需真实广告动作的审批、执行前/执行后和回读证明。',
      actions: ['记录审批人、范围、执行前值、执行后值、截图和回读值。'],
    },
    {
      title: '关键词机会',
      tone: finalReady ? 'ready' : hasMetrics ? 'pending' : 'blocked',
      summary: finalReady ? '最终验收汇总已接受关键词机会证据。' : hasMetrics ? '可生成关键词机会，但交付证据尚未聚合。' : '关键词机会需要已导入广告指标。',
      actions: ['按 ASIN、广告活动、广告组、对象类型和关键词去重生成机会。'],
    },
    {
      title: 'Listing 草案证据',
      tone: finalReady ? 'ready' : 'blocked',
      summary: finalReady ? '最终验收汇总已接受 Listing AI 草案证据。' : '当前最终就绪状态缺少 Listing AI 草案证据。',
      actions: ['从领星读取 Listing，生成本地 AI 草案，并保留导出路径。'],
    },
    {
      title: '安装包',
      tone: packageReady ? 'ready' : finalReady ? 'pending' : 'blocked',
      summary: packageReady
        ? '最终验收汇总已通过，安装包/校验码已记录。'
        : finalReady
          ? '最终验收汇总已通过，但安装包/校验码还未记录。'
          : '最终验收汇总未通过前不能声明安装包可交付。',
      actions: packageReady
        ? ['复核安装包路径、免安装包和 SHA-256 校验码是否与本次交付一致。']
        : ['最终节点生成免安装包，并记录路径和 SHA-256 校验码。'],
      evidence: packageReady
        ? [
          packageEvidence?.installerPath ? `安装包：${packageEvidence.installerPath}` : '',
          packageEvidence?.portablePath ? `免安装版：${packageEvidence.portablePath}` : '',
          packageEvidence?.sha256 ? `SHA-256：${packageEvidence.sha256}` : '',
          packageEvidence?.latestBuiltAt ? `生成时间：${packageEvidence.latestBuiltAt}` : '',
        ].filter(Boolean)
        : [],
    },
    {
      title: '当前阻塞项',
      tone: finalReady ? 'ready' : 'blocked',
      summary: finalReady ? '最终验收项已通过。' : '当前范围仍有需要处理的交付阻塞项。',
      actions: [
        ...readinessBlockers,
        ...deliveryTextsForDisplay(collectionBlockers),
        ...deliveryTextsForDisplay(quantBlockers),
      ],
    },
  ];
}
