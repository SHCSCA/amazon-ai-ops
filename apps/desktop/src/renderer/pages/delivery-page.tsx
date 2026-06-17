import React, { useEffect, useMemo, useState } from 'react';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { buildDeliveryReadinessMatrix, buildDeliveryReadinessMatrixInput } from '../delivery-readiness-matrix';
import { useScopeStore } from '../scope-store';
import type { AiDiagnosisRunView, AppRoute, BusinessDataPipeline, DeliveryEvidenceStatusView, DeliveryReadinessGate, DeliveryReadinessView, OperationScope, RecommendationView } from '../types';
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

interface FinalReadinessRefreshResult {
  success?: boolean;
  evidenceManifestPath?: string;
  finalReadinessPath?: string;
  readiness?: DeliveryReadinessView;
}

interface ReadbackSessionResult {
  sessionDir?: string;
  sourceCandidatePath?: string;
  passEvidencePath?: string;
  checklistPath?: string;
  locatorGuidePath?: string;
  sessionInputPath?: string;
  sessionInputGuidePath?: string;
}

interface ReadbackSessionCheckResult {
  sessionDir?: string;
  ready?: boolean;
  captureReady?: boolean;
  checks?: Array<{ label?: string; passed?: boolean; details?: string }>;
  issues?: string[];
  unresolvedFields?: string[];
  captureMissingFields?: Array<{ field?: string; label?: string; group?: string }>;
  captureIssues?: string[];
}

interface ReadbackSessionFillResult {
  sessionDir?: string;
  jsonPath?: string;
  markdownPath?: string;
  status?: string;
  readyForVerifier?: boolean;
  issues?: string[];
}

interface ReadbackEvidenceVerifyResult {
  status?: string;
  ok?: boolean;
  verified?: boolean;
  ready?: boolean;
  issues?: string[];
  blockers?: string[];
  checks?: Array<{ label?: string; passed?: boolean; details?: string }>;
}

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readbackSessionStatusCopy(result: ReadbackSessionCheckResult | null): { className: string; title: string; detail: string } {
  if (!result) {
    return {
      className: 'readback-session-check-blocked',
      title: '工作包尚未检查',
      detail: '请先创建并检查回读工作包。',
    };
  }
  if (!result.ready) {
    return {
      className: 'readback-session-check-blocked',
      title: '工作包结构仍需补齐',
      detail: (result.issues || []).slice(0, 3).join('；') || '目录、清单、定位单或输出路径缺失。',
    };
  }
  if (!result.captureReady) {
    const missing = formatCaptureMissing(result.captureMissingFields, result.unresolvedFields);
    return {
      className: 'readback-session-check-blocked',
      title: '结构通过，现场证据待填写',
      detail: missing ? `还需填写：${missing}` : ((result.captureIssues || []).slice(0, 2).join('；') || 'session-input.json 尚未完成现场证据填写。'),
    };
  }
  return {
    className: 'readback-session-check-ready',
    title: '结构与现场证据均已通过',
    detail: 'session-input.json 已补齐，可生成回读证据并进入 verifier。',
  };
}

function formatCaptureMissing(
  missingFields?: Array<{ field?: string; label?: string; group?: string }>,
  fallbackFields?: string[],
): string {
  if (Array.isArray(missingFields) && missingFields.length > 0) {
    return missingFields
      .slice(0, 8)
      .map((item) => [item.group, item.label || item.field].filter(Boolean).join('/'))
      .filter(Boolean)
      .join('、');
  }
  return (fallbackFields || []).slice(0, 8).join('、');
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function normalizeBaseUrl(value: unknown): string {
  return readString(value).replace(/\/+$/, '');
}

function aiAvailableFromSettings(settings: Record<string, unknown> | null | undefined): boolean {
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

function uniqueDisplayTexts(items: Array<string | undefined>): string[] {
  return Array.from(new Set(items.map((item) => deliveryTextForDisplay(String(item || '').trim())).filter(Boolean)));
}

export function packageEvidenceSummary(packageEvidence: DeliveryEvidenceStatusView['package'] | null | undefined): string {
  if (!packageEvidence?.installerAvailable) return '安装包未记录';
  const filePath = packageEvidence.portablePath || packageEvidence.installerPath || '安装包路径不可用';
  const hash = packageEvidence.sha256 ? ` / SHA-256 ${packageEvidence.sha256.slice(0, 12)}...` : ' / SHA-256 未记录';
  return `${filePath}${hash}`;
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
  if (!readiness?.available) return [deliveryTextForDisplay(readiness?.message || '最终验收 manifest 尚未生成')];
  if (!readiness.manifestDriven) return ['重新生成 evidence manifest，并用该 manifest 运行最终验收。'];
  if (readiness.appReady) {
    const passedMessages = readiness.gates
      .filter((gate) => gate.ok && gate.message)
      .map((gate) => deliveryTextForDisplay(gate.message as string));
    return ['最终就绪 manifest 已通过；仍需保留证据包和安装包 hash。', ...passedMessages];
  }
  const blockers = readinessBlockerTexts(readiness);
  return blockers.length > 0 ? blockers : ['补齐未通过的 final readiness gate 后重新验收。'];
}

function gateStatusLabel(gate: DeliveryReadinessGate): string {
  if (gate.ok) return '通过';
  return gate.status === 'blocked' ? '阻断' : '未通过';
}

function gateMessageForDisplay(gate: DeliveryReadinessGate, manifestReady: boolean): string {
  const raw = gate.message || '无附加说明';
  return manifestReady ? deliveryTextForDisplay(raw) : deliveryTextForDisplay(raw);
}

export function findReadbackBlockerGate(readiness: DeliveryReadinessView | null): DeliveryReadinessGate | null {
  const gates = readiness?.gates || [];
  return gates.find((gate) => {
    if (gate.ok) return false;
    const haystack = `${gate.name || ''} ${gate.message || ''} ${gate.evidencePath || ''}`.toLowerCase();
    return haystack.includes('readback') || haystack.includes('回读') || haystack.includes('广告执行');
  }) || null;
}

export function readbackBlockerSummary(gate: DeliveryReadinessGate | null): string {
  if (!gate) return '当前没有检测到广告回读 gate 阻断。';
  const message = deliveryTextForDisplay(gate.message || '真实广告 readback 证据未通过。');
  const evidence = gate.evidencePath ? `候选证据：${gate.evidencePath}` : '候选证据路径未绑定。';
  return `${message} ${evidence}`;
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
      tone: packageReady ? 'ready' : finalReady ? 'pending' : 'blocked',
      summary: packageReady
        ? '最终 manifest 已通过，安装包/hash 已记录。'
        : finalReady
          ? '最终 manifest 已通过，但安装包/hash 还未记录。'
          : '最终 manifest 未通过前不能声明安装包可交付。',
      actions: packageReady
        ? ['复核安装包路径、免安装 exe 和 SHA-256 是否与本次交付一致。']
        : ['最终节点生成 no-install exe，并记录路径和 SHA-256。'],
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
      summary: finalReady ? '最终 manifest gate 已通过。' : '当前范围仍有需要处理的交付阻塞项。',
      actions: [
        ...readinessBlockers,
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
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiDiagnosisRuns, setAiDiagnosisRuns] = useState<AiDiagnosisRunView[]>([]);
  const [pendingRecommendations, setPendingRecommendations] = useState<RecommendationView[]>([]);
  const [needsReviewRecommendations, setNeedsReviewRecommendations] = useState<RecommendationView[]>([]);
  const [approvedRecommendations, setApprovedRecommendations] = useState<RecommendationView[]>([]);
  const [deliveryEvidenceStatus, setDeliveryEvidenceStatus] = useState<DeliveryEvidenceStatusView | null>(null);
  const [finalReadinessRefresh, setFinalReadinessRefresh] = useState<FinalReadinessRefreshResult | null>(null);
  const [readbackSession, setReadbackSession] = useState<ReadbackSessionResult | null>(null);
  const [readbackSessionCheck, setReadbackSessionCheck] = useState<ReadbackSessionCheckResult | null>(null);
  const [readbackSessionFill, setReadbackSessionFill] = useState<ReadbackSessionFillResult | null>(null);
  const [readbackEvidenceVerify, setReadbackEvidenceVerify] = useState<ReadbackEvidenceVerifyResult | null>(null);

  const apiSurface = useMemo(() => api(), []);
  const canOpenPath = typeof apiSurface.openReportPath === 'function';
  const items = useMemo(() => buildDeliveryItems(data, readiness, deliveryEvidenceStatus), [data, deliveryEvidenceStatus, readiness]);
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
  const packageSummary = packageEvidenceSummary(deliveryEvidenceStatus?.package);
  const readbackBlockerGate = useMemo(() => findReadbackBlockerGate(readiness), [readiness]);
  const readbackCandidatePath = readbackBlockerGate?.evidencePath || '';
  const manifestScopeNote = manifestReady
    ? '可交付只代表最终 manifest 选中的证据已通过；如果切换了日期、店铺、站点或批次，需要重新生成当前范围证据。'
    : '当前还不能声明可交付；先按下方缺口补齐证据，再重新生成最终 manifest。';
  const deliveryMatrix = useMemo(() => buildDeliveryReadinessMatrix(buildDeliveryReadinessMatrixInput({
    data,
    readiness,
    evidenceStatus: deliveryEvidenceStatus,
    aiAvailable,
    aiDiagnosisRuns,
    pendingRecommendations,
    needsReviewRecommendations,
    approvedRecommendations,
  })), [aiAvailable, aiDiagnosisRuns, approvedRecommendations, data, deliveryEvidenceStatus, needsReviewRecommendations, pendingRecommendations, readiness]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      const notes: string[] = [];
      let loadedData: BusinessDataPipeline | null = null;
      try {
        if (typeof apiSurface.getBusinessUiDataPipeline === 'function') {
          const nextData = await apiSurface.getBusinessUiDataPipeline(scope);
          loadedData = nextData || null;
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
        if (typeof apiSurface.getSettings === 'function') {
          const settings = await apiSurface.getSettings();
          if (mounted) setAiAvailable(aiAvailableFromSettings(settings));
        } else if (mounted) {
          setAiAvailable(false);
        }
        const effectiveBatchId = scope.batchId || loadedData?.collection?.latestBatch?.id;
        if (typeof apiSurface.listAiDiagnosisRuns === 'function') {
          const runs = await apiSurface.listAiDiagnosisRuns({
            dateFrom: scope.dateFrom,
            dateTo: scope.dateTo,
            storeName: scope.storeName,
            marketplaceCode: scope.marketplaceCode,
            asin: scope.asin,
            batchId: effectiveBatchId,
            limit: 5,
          });
          if (mounted) setAiDiagnosisRuns(Array.isArray(runs) ? runs : []);
        } else if (mounted) {
          setAiDiagnosisRuns([]);
        }
        if (typeof apiSurface.getRecommendations === 'function') {
          const commonFilter = {
            dateFrom: scope.dateFrom,
            dateTo: scope.dateTo,
            storeName: scope.storeName,
            marketplaceCode: scope.marketplaceCode,
            asin: scope.asin,
            batchId: effectiveBatchId,
            limit: 20,
          };
          const [pending, needsReview, approved] = await Promise.all([
            apiSurface.getRecommendations({ ...commonFilter, status: 'pending' }),
            apiSurface.getRecommendations({ ...commonFilter, status: 'needs_review' }),
            apiSurface.getRecommendations({ ...commonFilter, status: 'approved' }),
          ]);
          if (mounted) {
            setPendingRecommendations(Array.isArray(pending) ? pending : []);
            setNeedsReviewRecommendations(Array.isArray(needsReview) ? needsReview : []);
            setApprovedRecommendations(Array.isArray(approved) ? approved : []);
          }
        } else if (mounted) {
          setPendingRecommendations([]);
          setNeedsReviewRecommendations([]);
          setApprovedRecommendations([]);
        }
        if (typeof apiSurface.getDeliveryEvidenceStatus === 'function') {
          const nextEvidenceStatus = await apiSurface.getDeliveryEvidenceStatus({
            dateFrom: scope.dateFrom,
            dateTo: scope.dateTo,
            storeName: scope.storeName,
            marketplaceCode: scope.marketplaceCode,
            asin: scope.asin,
            batchId: effectiveBatchId,
          });
          if (mounted) setDeliveryEvidenceStatus(nextEvidenceStatus || null);
        } else if (mounted) {
          setDeliveryEvidenceStatus(null);
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

  async function refreshFinalReadinessManifest() {
    if (typeof apiSurface.refreshFinalReadiness !== 'function') {
      setMessage('刷新最终验收 API 未接入。');
      return;
    }
    try {
      const result = await apiSurface.refreshFinalReadiness();
      setFinalReadinessRefresh(result || null);
      if (result?.readiness) {
        setReadiness(result.readiness);
      }
      setMessage(result?.readiness?.appReady
        ? `最终验收已刷新并通过：${result.finalReadinessPath || ''}`
        : `最终验收已刷新，仍未就绪：${result.finalReadinessPath || ''}`);
    } catch (caught) {
      setMessage(toUserFacingError(caught, '刷新最终验收失败。'));
    }
  }

  async function createReadbackWorkPackage() {
    if (!readbackCandidatePath) {
      setMessage('无法创建回读工作包：当前 final readiness 没有绑定广告 readback 候选证据路径。');
      return;
    }
    if (typeof apiSurface.prepareAdReadbackSession !== 'function') {
      setMessage('无法创建回读工作包：prepareAdReadbackSession API 未接入。');
      return;
    }
    try {
      const result = await apiSurface.prepareAdReadbackSession({ sourcePath: readbackCandidatePath });
      setReadbackSession(result || null);
      setReadbackSessionCheck(null);
      setReadbackSessionFill(null);
      setReadbackEvidenceVerify(null);
      setMessage(`回读工作包已创建：${result?.sessionDir || readbackCandidatePath}`);
    } catch (caught) {
      setMessage(toUserFacingError(caught, '创建回读工作包失败。'));
    }
  }

  async function verifyReadbackWorkPackage() {
    const sessionDir = readbackSession?.sessionDir || '';
    if (!sessionDir) {
      setMessage('无法检查回读工作包：请先创建工作包。');
      return;
    }
    if (typeof apiSurface.verifyAdReadbackSession !== 'function') {
      setMessage('无法检查回读工作包：verifyAdReadbackSession API 未接入。');
      return;
    }
    try {
      const result = await apiSurface.verifyAdReadbackSession({ sessionDir });
      setReadbackSessionCheck(result || null);
      if (result?.ready && result?.captureReady) {
        setMessage(`回读工作包结构和现场证据均已通过：${sessionDir}`);
      } else if (result?.ready) {
        setMessage(`回读工作包结构已通过，但现场证据仍待填写：${formatCaptureMissing(result?.captureMissingFields, result?.unresolvedFields)}`);
      } else {
        setMessage(`回读工作包仍需补齐：${(result?.issues || []).slice(0, 2).join('；')}`);
      }
    } catch (caught) {
      setMessage(toUserFacingError(caught, '检查回读工作包失败。'));
    }
  }

  async function fillReadbackWorkPackage() {
    const sessionDir = readbackSession?.sessionDir || '';
    if (!sessionDir) {
      setMessage('无法生成回读证据：请先创建工作包。');
      return;
    }
    if (typeof apiSurface.fillAdReadbackSession !== 'function') {
      setMessage('无法生成回读证据：fillAdReadbackSession API 未接入。');
      return;
    }
    try {
      const result = await apiSurface.fillAdReadbackSession({ sessionDir });
      setReadbackSessionFill(result || null);
      setMessage(result?.readyForVerifier
        ? `回读证据已生成，可进入校验：${result.jsonPath || ''}`
        : `回读证据未生成通过：${(result?.issues || []).slice(0, 2).join('；')}`);
    } catch (caught) {
      setMessage(toUserFacingError(caught, '生成回读证据失败。'));
    }
  }

  async function verifyGeneratedReadbackEvidence() {
    const evidencePath = readbackSessionFill?.jsonPath || readbackSession?.passEvidencePath || '';
    if (!evidencePath) {
      setMessage('无法校验回读证据：请先生成回读证据。');
      return;
    }
    if (typeof apiSurface.verifyAdReadbackEvidence !== 'function') {
      setMessage('无法校验回读证据：verifyAdReadbackEvidence API 未接入。');
      return;
    }
    try {
      const result = await apiSurface.verifyAdReadbackEvidence({ evidencePath });
      setReadbackEvidenceVerify(result || null);
      const passed = Boolean(result?.ok || result?.verified || result?.ready || result?.status === 'PASS');
      setMessage(passed
        ? `回读证据校验通过：${evidencePath}`
        : `回读证据仍未通过：${(result?.issues || result?.blockers || []).slice(0, 2).join('；')}`);
    } catch (caught) {
      setMessage(toUserFacingError(caught, '校验回读证据失败。'));
    }
  }

  async function refreshFinalReadinessWithReadback() {
    const evidencePath = readbackSessionFill?.jsonPath || readbackSession?.passEvidencePath || '';
    if (!evidencePath) {
      setMessage('无法用回读证据刷新最终验收：请先生成回读证据。');
      return;
    }
    if (typeof apiSurface.refreshFinalReadiness !== 'function') {
      setMessage('刷新最终验收 API 未接入。');
      return;
    }
    try {
      const result = await apiSurface.refreshFinalReadiness({ adReadbackPath: evidencePath });
      setFinalReadinessRefresh(result || null);
      if (result?.readiness) {
        setReadiness(result.readiness);
      }
      setMessage(result?.readiness?.appReady
        ? `已使用回读证据刷新并通过最终验收：${result.finalReadinessPath || ''}`
        : `已使用回读证据刷新最终验收，仍未就绪：${result.finalReadinessPath || ''}`);
    } catch (caught) {
      setMessage(toUserFacingError(caught, '使用回读证据刷新最终验收失败。'));
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
      `安装包：${packageSummary}`,
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
              <button className="primary-button" onClick={refreshFinalReadinessManifest} type="button">
                刷新最终验收
              </button>
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
            <div>
              <span>安装包</span>
              <strong>{packageSummary}</strong>
            </div>
          </div>
        </Panel>

        {finalReadinessRefresh && (
          <Panel title="最终验收刷新结果" tone={finalReadinessRefresh.readiness?.appReady ? 'success' : 'warning'}>
            <div className="delivery-meta-grid">
              <div>
                <span>Evidence manifest</span>
                <strong>{finalReadinessRefresh.evidenceManifestPath || '-'}</strong>
              </div>
              <div>
                <span>Final readiness</span>
                <strong>{finalReadinessRefresh.finalReadinessPath || '-'}</strong>
              </div>
              <div>
                <span>状态</span>
                <strong>{readinessStatus(finalReadinessRefresh.readiness || null)}</strong>
              </div>
              <div>
                <span>Gate</span>
                <strong>{finalReadinessRefresh.readiness?.gatesSummary ? `${finalReadinessRefresh.readiness.gatesSummary.passed}/${finalReadinessRefresh.readiness.gatesSummary.total} 通过` : '-'}</strong>
              </div>
            </div>
            <p className={finalReadinessRefresh.readiness?.appReady ? 'muted-line' : 'blocked-line'}>
              {finalReadinessRefresh.readiness?.appReady
                ? '最终验收已通过；导出 READY 包前仍需确认 README delivery 状态和安装包 hash。'
                : '最终验收已生成诊断文件，但仍有 gate 未通过，不能声明可交付。'}
            </p>
          </Panel>
        )}

        {readbackBlockerGate && (
          <Panel title="广告回读补证" tone="blocked">
            <div className="delivery-readiness-row">
              <div>
                <StatusPill tone="blocked">阻断</StatusPill>
                <p className="delivery-readiness-copy">最终验收当前卡在真实广告 readback。需要先为这个候选动作创建工作包，再补审批、before/after 截图和刷新回读证据。</p>
                <p className="blocked-line">{readbackBlockerSummary(readbackBlockerGate)}</p>
              </div>
              <div className="delivery-action-row">
                <button className="primary-button" onClick={createReadbackWorkPackage} type="button">
                  创建回读工作包
                </button>
                <button className="secondary-button" disabled={!readbackCandidatePath} onClick={() => openPath(readbackCandidatePath, '打开 readback 候选证据')} type="button">
                  打开候选证据
                </button>
                <button className="secondary-button" onClick={() => navigate('readback')} type="button">
                  去执行回读页
                </button>
              </div>
            </div>
            {readbackSession && (
              <div className="delivery-meta-grid">
                <div>
                  <span>工作包目录</span>
                  <strong>{readbackSession.sessionDir || '-'}</strong>
                </div>
                <div>
                  <span>待填写文件</span>
                  <strong>{readbackSession.sessionInputPath || '-'}</strong>
                </div>
                <div>
                  <span>填写说明</span>
                  <strong>{readbackSession.sessionInputGuidePath || '-'}</strong>
                </div>
                <div>
                  <span>操作清单</span>
                  <strong>{readbackSession.checklistPath || '-'}</strong>
                </div>
                <div>
                  <span>Ads UI 定位单</span>
                  <strong>{readbackSession.locatorGuidePath || '-'}</strong>
                </div>
                <div>
                  <span>PASS 输出</span>
                  <strong>{readbackSession.passEvidencePath || '-'}</strong>
                </div>
              </div>
            )}
            {readbackSession?.sessionDir && (
              <div className="delivery-action-row">
                <button className="secondary-button" onClick={() => openPath(readbackSession.sessionDir || '', '打开回读工作包')} type="button">
                  打开工作包目录
                </button>
                <button className="secondary-button" onClick={() => openPath(readbackSession.checklistPath || '', '打开操作清单')} type="button">
                  打开操作清单
                </button>
                <button className="secondary-button" onClick={() => openPath(readbackSession.locatorGuidePath || '', '打开 Ads UI 定位单')} type="button">
                  打开定位单
                </button>
                <button className="secondary-button" onClick={() => openPath(readbackSession.sessionInputPath || '', '打开待填写 session-input.json')} type="button">
                  打开填写文件
                </button>
                <button className="secondary-button" onClick={() => openPath(readbackSession.sessionInputGuidePath || '', '打开 session-input 填写说明')} type="button">
                  打开填写说明
                </button>
                <button className="secondary-button" onClick={verifyReadbackWorkPackage} type="button">
                  检查工作包
                </button>
                <button className="secondary-button" onClick={fillReadbackWorkPackage} type="button">
                  生成回读证据
                </button>
                <button className="secondary-button" onClick={verifyGeneratedReadbackEvidence} type="button">
                  校验回读证据
                </button>
                <button className="primary-button" onClick={refreshFinalReadinessWithReadback} type="button">
                  用回读证据刷新最终验收
                </button>
              </div>
            )}
            {readbackSessionCheck && (
              <div className={`readback-session-check ${readbackSessionStatusCopy(readbackSessionCheck).className}`}>
                <strong>工作包检查：{readbackSessionStatusCopy(readbackSessionCheck).title}</strong>
                <span>{readbackSessionStatusCopy(readbackSessionCheck).detail}</span>
                {readbackSessionCheck.ready && !readbackSessionCheck.captureReady && (
                  <p className="muted-line">这只证明目录、清单、定位单和输出路径可用；最终仍必须填写现场审批、before/after、执行和 readback 字段。</p>
                )}
              </div>
            )}
            {readbackSessionFill && (
              <div className={`readback-session-check ${readbackSessionFill.readyForVerifier ? 'readback-session-check-ready' : 'readback-session-check-blocked'}`}>
                <strong>回读证据生成：{readbackSessionFill.readyForVerifier ? '可校验' : '未通过'}</strong>
                <span>{readbackSessionFill.readyForVerifier ? (readbackSessionFill.jsonPath || '-') : (readbackSessionFill.issues || []).slice(0, 3).join('；')}</span>
              </div>
            )}
            {readbackEvidenceVerify && (
              <div className={`readback-session-check ${(readbackEvidenceVerify.ok || readbackEvidenceVerify.verified || readbackEvidenceVerify.ready || readbackEvidenceVerify.status === 'PASS') ? 'readback-session-check-ready' : 'readback-session-check-blocked'}`}>
                <strong>回读证据校验：{(readbackEvidenceVerify.ok || readbackEvidenceVerify.verified || readbackEvidenceVerify.ready || readbackEvidenceVerify.status === 'PASS') ? '通过' : '未通过'}</strong>
                <span>{(readbackEvidenceVerify.issues || readbackEvidenceVerify.blockers || []).slice(0, 3).join('；') || '校验结果已返回。'}</span>
              </div>
            )}
          </Panel>
        )}

        <Panel title="当前范围交付矩阵" tone={deliveryMatrix.status === 'ready' ? 'success' : deliveryMatrix.status === 'blocked' ? 'blocked' : 'warning'}>
          <div className="delivery-readiness-row">
            <div>
              <StatusPill tone={deliveryMatrix.status === 'ready' ? 'ready' : deliveryMatrix.status === 'blocked' ? 'blocked' : 'warning'}>
                {deliveryMatrix.status === 'ready' ? '证据闭环' : deliveryMatrix.status === 'blocked' ? '当前范围阻断' : '仍需补齐'}
              </StatusPill>
              <p className="delivery-readiness-copy">{deliveryMatrix.headline}</p>
              <p className="muted-line">矩阵只说明当前日期、店铺、站点和批次的业务环节；最终是否可交付仍以 final readiness manifest 为准。</p>
            </div>
            <div className="delivery-action-row">
              <button className="primary-button" onClick={() => navigate(deliveryMatrix.status === 'blocked' ? 'data-collection' : 'delivery')} type="button">
                {deliveryMatrix.primaryNextAction}
              </button>
            </div>
          </div>
          <div className="context-summary-grid">
            {deliveryMatrix.items.map((item) => (
              <button className="context-action-card" key={item.key} onClick={() => navigate(item.route)} type="button">
                <span>{item.label}</span>
                <strong>{item.statusLabel}</strong>
                <p>{item.detail}</p>
                <StatusPill tone={item.tone}>{item.nextAction}</StatusPill>
              </button>
            ))}
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
