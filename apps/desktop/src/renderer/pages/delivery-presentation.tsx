import { StatusPill } from '../components/ui';
import { sanitizeCausalExportText } from '@amazon-ai-ops/shared-types';
import type { BusinessDataPipeline, DeliveryEvidenceStatusView, DeliveryReadinessGate, DeliveryReadinessView, OperationScope } from '../types';
import { type DeliveryCollectionArtifact, type DeliveryOverviewFact, type DeliveryPreviewState, type DeliveryTone, type EvidenceGovernanceFact, type FinalReadinessRefreshResult } from './delivery-contracts';

export const DELIVERY_BUNDLE_PATH = 'output/delivery-bundles';

export function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function readBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

export function normalizeBaseUrl(value: unknown): string {
  return readString(value).replace(/\/+$/, '');
}

export function aiAvailableFromSettings(settings: Record<string, unknown> | null | undefined): boolean {
  if (!settings) return false;
  const keyConfigured = readBoolean(settings.aiKeyConfigured ?? settings.ai_key_configured)
    || Boolean(readString(settings.aiApiKey ?? settings.ai_api_key));
  if (!keyConfigured) return false;
  const baseUrl = readString(settings.aiBaseUrl ?? settings.ai_base_url) || 'https://api.deepseek.com';
  const model = readString(settings.aiModel ?? settings.ai_model) || 'deepseek-v4-flash';
  return normalizeBaseUrl(settings.aiLastTestBaseUrl ?? settings.ai_last_test_base_url) === normalizeBaseUrl(baseUrl)
    && readString(settings.aiLastTestModel ?? settings.ai_last_test_model) === model
    && readString(settings.aiLastTestStatus ?? settings.ai_last_test_status) === 'available';
}

export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function summarizeScope(data: BusinessDataPipeline | null, fallbackScope: OperationScope): string {
  const scope = data?.scope || fallbackScope;
  return `${scope.storeName} / ${scope.marketplaceCode} / ${scope.dateFrom} - ${scope.dateTo} / USD`;
}

export function statusLabel(tone: DeliveryTone): string {
  const labels: Record<DeliveryTone, string> = {
    ready: '已完成',
    pending: '待处理',
    blocked: '需补齐',
    warning: '需复核',
  };
  return labels[tone];
}

export function readinessStatus(readiness: DeliveryReadinessView | null): string {
  return readiness?.appReady && readiness?.manifestDriven ? '可交付' : '未就绪';
}

export function deliveryPreviewState(
  readiness: DeliveryReadinessView | null,
  evidenceStatus: DeliveryEvidenceStatusView | null | undefined,
): DeliveryPreviewState | null {
  const preview = evidenceStatus?.preview;
  if (!readiness?.previewOnly && !preview?.previewOnly) return null;
  const workflowComplete = Boolean(readiness?.previewReady && preview?.workflowComplete);
  return {
    detail: '此状态只验证开发 fixture 的页面流程，不可视为 APP_READY，也不能满足真实导出或验收 gate。',
    headline: workflowComplete ? '仅开发预览已走通' : '仅开发预览场景未走通',
    scenarioId: preview?.scenarioId || readiness?.previewScenarioId || 'unknown',
    tone: 'warning',
  };
}

export function DeliveryPreviewNotice({ state }: { state: DeliveryPreviewState | null }) {
  if (!state) return null;
  return (
    <div className="delivery-summary-data-line delivery-preview-notice" role="status" aria-live="polite">
      <StatusPill tone={state.tone}>仅开发预览</StatusPill>
      <strong>{state.headline}</strong>
      <small>{state.detail} 当前场景：{state.scenarioId}</small>
    </div>
  );
}

export function deliverySummaryStatusLabel(input: {
  deliveryReady: boolean;
  previewOnly: boolean;
}): string {
  if (input.deliveryReady) return '可以交付';
  return input.previewOnly ? '开发预览' : '当前阻断';
}

export function collectionFolderArtifact(data: BusinessDataPipeline | null): DeliveryCollectionArtifact | null {
  const artifactId = data?.collection?.fileAudit?.downloadArtifactId
    || data?.collection?.latestBatch?.downloadArtifactId;
  if (artifactId) {
    const displayName = data?.collection?.fileAudit?.downloadDisplayName
      || data?.collection?.latestBatch?.downloadDisplayName
      || '原始报表目录';
    return { artifactId, displayName, kind: 'folder', label: '原始报表目录' };
  }
  return (data?.collection?.evidenceArtifacts || []).find((item) => item.kind === 'folder') || null;
}

export function collectionManifestArtifact(data: BusinessDataPipeline | null): DeliveryCollectionArtifact | null {
  const artifactId = data?.collection?.fileAudit?.manifestArtifactId
    || data?.collection?.latestBatch?.manifestArtifactId;
  if (artifactId) {
    const displayName = data?.collection?.fileAudit?.manifestDisplayName
      || data?.collection?.latestBatch?.manifestDisplayName
      || '采集清单';
    return { artifactId, displayName, kind: 'audit', label: '采集清单' };
  }
  return (data?.collection?.evidenceArtifacts || []).find((item) => item.kind === 'audit') || null;
}

export function deliveryTextForDisplay(text: string): string {
  const display = text
    .replace(/appReady=false，不能声明可交付。/gi, '最终验收未通过，不能声明可交付。')
    .replace(/manifestDriven=false，不能声明可交付。/gi, '最终验收汇总不是本次验收来源，不能声明可交付。')
    .replace(/Current candidate is missing before\/after\/reload readback proof\./gi, '当前候选动作缺少执行前、执行后和刷新回读证明。')
    .replace(/最终就绪\s+manifest/gi, '最终验收汇总')
    .replace(/READY\s+交付包/g, '可交付包')
    .replace(/before\s*\/\s*after\s*\/\s*readback/gi, '执行前/执行后/回读')
    .replace(/before\s*\/\s*after\s+readback/gi, '执行前/执行后回读')
    .replace(/before\s*\/\s*after/gi, '执行前/执行后')
    .replace(/\bsession-input\.json\b/gi, '填写文件')
    .replace(/\bfinal readiness gate\b/gi, '最终验收项')
    .replace(/\bfinal readiness\b/gi, '最终验收')
    .replace(/\bverifier\b/gi, '本地校验')
    .replace(/\bmanifest\b/gi, '最终验收汇总')
    .replace(/\bhash\b/gi, '校验码')
    .replace(/\breadback\b/gi, '回读')
    .replace(/APP_READY/g, '可交付状态')
    .replace(/APP_NEEDS_WORK/g, '未就绪状态')
    .replace(/\bREADY\b/g, '可交付');
  return sanitizeCausalExportText(display);
}

export function deliveryTextsForDisplay(items: string[] | undefined): string[] {
  return (items || []).map((item) => deliveryTextForDisplay(item));
}

export function uniqueDisplayTexts(items: Array<string | undefined>): string[] {
  return Array.from(new Set(items.map((item) => deliveryTextForDisplay(String(item || '').trim())).filter(Boolean)));
}

export function packageEvidenceSummary(packageEvidence: DeliveryEvidenceStatusView['package'] | null | undefined): string {
  if (!packageEvidence?.installerAvailable) return '安装包未记录';
  const packageLocation = packageEvidence.portablePath || packageEvidence.installerPath || '安装包路径不可用';
  const hash = packageEvidence.sha256 ? ` / SHA-256 ${packageEvidence.sha256.slice(0, 12)}...` : ' / SHA-256 未记录';
  return `${packageLocation}${hash}`;
}

export function canExportDeliveryBundle(
  readiness: DeliveryReadinessView | null,
  packageEvidence: DeliveryEvidenceStatusView['package'] | null | undefined,
): boolean {
  const portablePath = String(packageEvidence?.portablePath || '').trim();
  const portableSha256 = String(packageEvidence?.sha256 || '').trim();
  return Boolean(
    readiness?.available
    && readiness.exists === true
    && readiness.status === 'APP_READY'
    && readiness.appReady
    && readiness.manifestDriven
    && readiness.previewOnly !== true
    && Array.isArray(readiness.gates)
    && readiness.gates.length > 0
    && readiness.gates.every((gate) => gate.ok === true)
    && Array.isArray(readiness.failures)
    && readiness.failures.length === 0
    && packageEvidence?.installerAvailable === true
    && portablePath
    && /^[A-F0-9]{64}$/i.test(portableSha256)
  );
}

export function compactDeliveryPath(value: string): string {
  const normalized = String(value || '').trim().replace(/\\/g, '/');
  if (!normalized) return '';
  if (normalized.length <= 78) return normalized;
  const parts = normalized.split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] || normalized;
  const parent = parts.length > 1 ? parts[parts.length - 2] : '';
  const root = /^[A-Za-z]:$/.test(parts[0] || '') ? parts[0] : parts[0] ? `/${parts[0]}` : '';
  return [root, '...', parent, fileName].filter(Boolean).join('/');
}

export function directoryFromPath(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return index > 0 ? normalized.slice(0, index) : normalized;
}

export function packageEvidenceBrief(packageEvidence: DeliveryEvidenceStatusView['package'] | null | undefined): string {
  if (!packageEvidence?.installerAvailable) return '安装包未记录';
  const packageLocation = packageEvidence.portablePath || packageEvidence.installerPath || '';
  const pathLabel = packageLocation ? compactDeliveryPath(packageLocation) : '安装包路径不可用';
  const hash = packageEvidence.sha256 ? ` / SHA-256 ${packageEvidence.sha256.slice(0, 12)}...` : ' / SHA-256 未记录';
  return `${pathLabel}${hash}`;
}

export function stripPrimaryTechnicalDetails(text: string): string {
  return deliveryTextForDisplay(text)
    .replace(/[A-Za-z]:[\\/][^；。\n]+/g, '证据路径见详情')
    .replace(/\boutput[\\/][^；。\n]+/gi, '证据路径见详情')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compactDeliveryMessage(text: string): string {
  return stripPrimaryTechnicalDetails(text)
    .replace(/：证据路径见详情/g, '，路径见详情')
    .replace(/: 证据路径见详情/g, '，路径见详情');
}

export function reconciliationSourceLabel(source?: string): string {
  if (source === 'canonical_advertised_product') return '推广商品报表口径';
  if (source === 'canonical_ad_group') return '广告组报表口径';
  if (source === 'canonical_user_search_term') return '用户搜索词权威口径';
  if (source === 'canonical_search_term') return '搜索词总盘口径';
  return source || '未记录';
}

export function buildEvidenceGovernanceFacts(input: {
  finalManifestPath: string;
  finalReadinessRefresh: FinalReadinessRefreshResult | null;
  packageSummary: string;
  readiness: DeliveryReadinessView | null;
}): EvidenceGovernanceFact[] {
  const readiness = input.readiness;
  const authoritative = Boolean(readiness?.appReady && readiness?.manifestDriven);
  const manifestPath = input.finalReadinessRefresh?.evidenceManifestPath || input.finalManifestPath;
  const finalReadinessPath = input.finalReadinessRefresh?.finalReadinessPath || input.finalManifestPath;
  const packageRecorded = input.packageSummary && !input.packageSummary.includes('未记录') && !input.packageSummary.includes('不可用');

  return [
    {
      label: '权威来源',
      value: readiness?.manifestDriven ? '最终验收汇总驱动' : '不是权威验收',
      tone: readiness?.manifestDriven ? 'ready' : 'blocked',
    },
    {
      label: '最终验收',
      value: finalReadinessPath ? compactDeliveryPath(finalReadinessPath) : '尚未生成',
      tone: finalReadinessPath ? (authoritative ? 'ready' : 'warning') : 'blocked',
    },
    {
      label: '证据清单',
      value: manifestPath ? compactDeliveryPath(manifestPath) : '等待选择证据',
      tone: manifestPath ? 'ready' : 'warning',
    },
    {
      label: '安装包索引',
      value: packageRecorded ? '已记录并绑定' : '未绑定当前包',
      tone: packageRecorded ? 'ready' : 'blocked',
    },
  ];
}

export function evidenceGovernanceSummary(readiness: DeliveryReadinessView | null): string {
  if (readiness?.appReady && readiness?.manifestDriven) {
    return '交付判断以最终验收汇总为准，README 和用户指南只是摘要说明。';
  }
  if (readiness?.manifestDriven === false) {
    return '当前最终验收不是由最终验收汇总驱动，不能作为可交付声明来源。';
  }
  return '先生成最终验收汇总，再导出交付包并运行可交付安全检查。';
}

export function evidenceGovernanceRules(readiness: DeliveryReadinessView | null): string[] {
  const rules = [
    '真实领星报表才算数据来源；截图、HTML、审计 JSON 只能作为辅助证据。',
    '界面检查和文档状态不能替代最终验收汇总。',
    '安装版和免安装版校验码必须来自当前包索引。',
  ];
  if (!readiness?.manifestDriven) {
    rules.unshift('当前页面不能仅凭最新文件或 README 文案声明可交付状态。');
  }
  return rules;
}

export function evidenceGovernanceTone(readiness: DeliveryReadinessView | null): DeliveryTone {
  if (readiness?.appReady && readiness?.manifestDriven) return 'ready';
  if (readiness?.manifestDriven === false) return 'blocked';
  return 'warning';
}

export function buildDeliveryOverviewFacts(input: {
  scopeSummary: string;
  businessDataAvailable?: boolean;
  realFileCount: number;
  importedRows: number;
  readinessStatusText: string;
  gateSummaryText: string;
  packageSummaryText: string;
}): DeliveryOverviewFact[] {
  const packageRecorded = input.packageSummaryText && !input.packageSummaryText.includes('未记录') && !input.packageSummaryText.includes('不可用');
  return [
    { label: '运营范围', value: input.scopeSummary },
    { label: '真实数据', value: input.businessDataAvailable === false ? '未知（当前业务数据尚未读取）' : `${input.realFileCount} 个文件 / ${input.importedRows} 行` },
    { label: '最终验收', value: `${input.readinessStatusText} / ${input.gateSummaryText}` },
    { label: '安装包', value: packageRecorded ? '已记录' : '未记录' },
  ];
}

export function readinessBlockerTexts(readiness: DeliveryReadinessView | null): string[] {
  if (!readiness) return [];
  const failedGateMessages = (readiness.gates || [])
    .filter((gate) => !gate.ok)
    .map((gate) => gate.message || `${gate.name} 未通过。`);
  return uniqueDisplayTexts([
    ...(readiness.actionItems || []),
    ...(readiness.missing || []),
    ...(readiness.recommendationReviewReasons || []),
    ...(readiness.reviewBlockers || []),
    ...(readiness.deliveryReviewReasons || []),
    ...(readiness.finalReadinessBlockers || []),
    ...failedGateMessages,
  ]);
}

export function buildManifestActions(readiness: DeliveryReadinessView | null): string[] {
  if (!readiness?.available) return [deliveryTextForDisplay(readiness?.message || '最终验收汇总尚未生成')];
  if (!readiness.manifestDriven) return [deliveryTextForDisplay('重新生成最终验收汇总，并用该汇总运行最终验收。')];
  if (readiness.appReady) {
    const passedMessages = readiness.gates
      .filter((gate) => gate.ok && gate.message)
      .map((gate) => deliveryTextForDisplay(gate.message as string));
    return [deliveryTextForDisplay('最终验收汇总已通过；仍需保留证据包和安装包校验码。'), ...passedMessages];
  }
  const blockers = readinessBlockerTexts(readiness);
  return blockers.length > 0 ? blockers : [deliveryTextForDisplay('补齐未通过的 final readiness gate 后重新验收。')];
}

export function gateStatusLabel(gate: DeliveryReadinessGate): string {
  if (gate.ok) return '通过';
  return gate.status === 'blocked' ? '阻断' : '未通过';
}

export function gateMessageForDisplay(gate: DeliveryReadinessGate, manifestReady: boolean): string {
  const raw = gate.message || '无附加说明';
  return manifestReady ? deliveryTextForDisplay(raw) : deliveryTextForDisplay(raw);
}
