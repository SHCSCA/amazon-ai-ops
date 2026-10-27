import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import { useWorkspaceOperation } from '../components/workspace/use-workspace-operation';
import { buildDeliveryReadinessMatrix, buildDeliveryReadinessMatrixInput } from '../delivery-readiness-matrix';
import { useMissionControlStoreContext } from '../mission-control/store-context';
import { READBACK_REPAIR_INTENT_EVENT, READBACK_REPAIR_INTENT_STORAGE_KEY, type ReadbackRepairIntent } from '../readback-repair-intent';
import { rendererRuntimeLog } from '../runtime-log';
import { useScopeStore } from '../scope-store';
import type { AiDiagnosisRunView, BusinessDataPipeline, DeliveryEvidenceStatusView, DeliveryReadinessView, RecommendationView, RendererArtifactId } from '../types';
import { toUserFacingError } from '../user-facing-error';
import { api, deliveryActionBusyLabel, deliveryActionButtonView as baseDeliveryActionButtonView, deliveryCopySummaryActionView, deliveryOpenPathButtonView, deliveryPathActionKey, deliveryReadbackVerifierPassed, navigate, readFinalReadinessRefresh, runDeliveryWorkflowMutation } from './delivery-actions';
import { type DataReconciliationExportResult, type DeliveryActionButtonInput, type DeliveryActionKey, type FinalReadinessRefreshResult, type ReadbackEvidenceVerifyResult, type ReadbackSessionCheckResult, type ReadbackSessionFillResult, type ReadbackSessionResult } from './delivery-contracts';
import { buildDeliveryItems, primaryMissingItems } from './delivery-evidence';
import { canExportNonReadyDeliveryEvidence, exportNonReadyDeliveryEvidence } from './delivery-export-policy';
import { deliveryOperationContextKey } from './delivery-operation-state';
import { loadDeliveryState } from './delivery-state-load';
import { aiAvailableFromSettings, buildDeliveryOverviewFacts, buildEvidenceGovernanceFacts, canExportDeliveryBundle, collectionFolderArtifact, collectionManifestArtifact, compactDeliveryMessage, DELIVERY_BUNDLE_PATH, deliveryPreviewState, directoryFromPath, evidenceGovernanceTone, packageEvidenceBrief, packageEvidenceSummary, readNumber, summarizeScope } from './delivery-presentation';
import { buildDeliveryReadbackRepairIntent, findReadbackBlockerGate, formatCaptureMissing } from './delivery-readback';

export function useDeliveryPage() {

  const scope = useScopeStore((state) => state.scope);
  const storeAuthority = useMissionControlStoreContext();
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
  const [exportedBundlePath, setExportedBundlePath] = useState('');
  const [deliveryActionBusy, setDeliveryActionBusy] = useState<DeliveryActionKey | null>(null);
  const [openingPathKey, setOpeningPathKey] = useState<string | null>(null);
  const [copySummaryBusy, setCopySummaryBusy] = useState(false);

  const deliveryContextKey = deliveryOperationContextKey(scope, storeAuthority);
  const operations = useWorkspaceOperation(deliveryContextKey);
  const authorityReady = storeAuthority.phase === 'ready' && Boolean(storeAuthority.authoritativeContext);
  const actionBlocked = !authorityReady || loading || operations.busy;
  const actionDisabledReason = !authorityReady ? '请先选择并确认当前店铺，再重试交付操作。'
    : loading ? '正在读取当前店铺的交付状态，请等待完成。' : '当前交付操作正在处理，请等待完成后重试。';
  useLayoutEffect(() => {
    setData(null); setReadiness(null); setDeliveryEvidenceStatus(null); setFinalReadinessRefresh(null);
    setDataReconciliation(null); setReadbackSession(null); setReadbackSessionCheck(null);
    setReadbackSessionFill(null); setReadbackEvidenceVerify(null); setExportedBundlePath('');
    setAiDiagnosisRuns([]); setPendingRecommendations([]); setNeedsReviewRecommendations([]);
    setApprovedRecommendations([]); setAiAvailable(false); setMessage(''); setDeliveryActionBusy(null);
    setOpeningPathKey(null); setCopySummaryBusy(false); setLoading(true);
  }, [deliveryContextKey]);

  const apiSurface = useMemo(() => api(), []);
  const canOpenPath = typeof apiSurface.openReportPath === 'function';
  const canOpenArtifact = typeof apiSurface.openReportArtifact === 'function';
  const items = useMemo(() => buildDeliveryItems(data, readiness, deliveryEvidenceStatus), [data, deliveryEvidenceStatus, readiness]);
  const reportFolderArtifact = collectionFolderArtifact(data);
  const reportManifestArtifact = collectionManifestArtifact(data);
  const finalManifestPath = readiness?.path || '';
  const realFiles = data?.collection?.realReportFiles || [];
  const reportDownloadLabel = reportFolderArtifact?.displayName || '目录工件不可用';
  const collectionManifestLabel = reportManifestArtifact?.displayName || '清单工件不可用';
  const quant = data?.quant;
  const importedRows = readNumber(data?.collection?.fileAudit?.importedRowCount, readNumber(quant?.importedRows));
  const manifestReady = readiness?.appReady && readiness?.manifestDriven;
  const deliveryReady = canExportDeliveryBundle(readiness, deliveryEvidenceStatus?.package);
  const previewState = useMemo(
    () => deliveryPreviewState(readiness, deliveryEvidenceStatus),
    [deliveryEvidenceStatus, readiness],
  );
  const nonReadyEvidenceExportAvailable = canExportNonReadyDeliveryEvidence(readiness, Boolean(previewState));
  const packageSummary = packageEvidenceSummary(deliveryEvidenceStatus?.package);
  const evidenceGovernanceFacts = buildEvidenceGovernanceFacts({
    finalManifestPath,
    finalReadinessRefresh,
    packageSummary,
    readiness,
  });
  const evidenceGovernanceStatus = evidenceGovernanceTone(readiness);
  const gateSummaryText = readiness?.gatesSummary ? `${readiness.gatesSummary.passed}/${readiness.gatesSummary.total} 通过` : '未生成';
  const deliveryOverviewFacts = buildDeliveryOverviewFacts({
    scopeSummary: summarizeScope(data, scope),
    businessDataAvailable: data !== null,
    realFileCount: realFiles.length,
    importedRows,
    readinessStatusText: deliveryReady ? '可以交付' : '还不能交付',
    gateSummaryText,
    packageSummaryText: packageSummary,
  });
  const readbackBlockerGate = useMemo(() => findReadbackBlockerGate(readiness), [readiness]);
  const readbackCandidatePath = readbackBlockerGate?.evidencePath || '';
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
  const topDeliveryGap = deliveryMatrix.items.find((item) => item.tone !== 'ready') || null;
  const deliveryTaskTitle = deliveryReady ? '可以交付' : '还不能交付';
  const deliveryDataFact = deliveryOverviewFacts.find((fact) => fact.label === '真实数据');
  const missingItems = primaryMissingItems(readiness, deliveryMatrix);
  const packageBrief = packageEvidenceBrief(deliveryEvidenceStatus?.package);
  const packagePath = deliveryEvidenceStatus?.package?.portablePath || deliveryEvidenceStatus?.package?.installerPath || '';
  const packageDirectory = directoryFromPath(packagePath);
  const deliveryBundleOpenPath = exportedBundlePath || DELIVERY_BUNDLE_PATH;
  const deliveryTaskDetail = deliveryReady
    ? '最终验收已通过，安装包证据已记录；可以导出交付包。'
    : missingItems[0] || '当前还不能声明可交付；先补齐最关键缺口，再刷新最终验收。';
  const deliveryPrimaryAction = (() => {
    if (deliveryReady) {
      return { kind: 'export', label: '导出交付包', onClick: exportBundle };
    }
    if (topDeliveryGap?.key === 'data') {
      return { kind: 'navigate', label: topDeliveryGap.nextAction || '去数据采集', onClick: () => navigate(topDeliveryGap.route) };
    }
    if (topDeliveryGap?.key === 'readback') {
      return readbackBlockerGate
        ? { kind: 'repair-readback', label: '直达回读补证', onClick: requestReadbackRepair }
        : { kind: 'navigate-readback', label: '去结果核对', onClick: () => navigate('readback') };
    }
    if (topDeliveryGap?.key === 'package') {
      return { kind: 'refresh', label: '刷新最终验收', onClick: refreshFinalReadinessManifest };
    }
    if (topDeliveryGap) {
      return { kind: 'navigate', label: topDeliveryGap.nextAction, onClick: () => navigate(topDeliveryGap.route) };
    }
    return { kind: 'refresh', label: '刷新最终验收', onClick: refreshFinalReadinessManifest };
  })();
  const secondaryTaskActions = [
    ...(deliveryPrimaryAction.kind === 'refresh' ? [] : [{
      label: '刷新最终验收',
      onClick: refreshFinalReadinessManifest,
      busy: deliveryActionBusy === 'refresh-final',
      busyLabel: deliveryActionBusyLabel('refresh-final'),
      disabled: actionBlocked,
    }]),
    deliveryCopySummaryActionView({
      copying: copySummaryBusy,
      disabled: actionBlocked,
      onClick: copySummary,
    }),
  ].slice(0, 2);
  useEffect(() => {
    const isCurrent = operations.capture();
    async function load() {
      setLoading(true);
      if (!authorityReady) { setLoading(false); return; }
      try {
        const loaded = await loadDeliveryState(apiSurface, { ...scope, storeContext: { ...storeAuthority.authoritativeContext! } }, isCurrent);
        if (!loaded || !isCurrent()) return;
        setData(loaded.data); setReadiness(loaded.readiness); setAiAvailable(aiAvailableFromSettings(loaded.settings));
        setAiDiagnosisRuns(loaded.runs); setPendingRecommendations(loaded.pending);
        setNeedsReviewRecommendations(loaded.needsReview); setApprovedRecommendations(loaded.approved);
        setDeliveryEvidenceStatus(loaded.evidence); setMessage(loaded.notes.join(' '));
      } catch (caught) {
        rendererRuntimeLog.error('delivery.operation_failed', { error: caught });
        if (isCurrent()) setMessage(toUserFacingError(caught, '读取交付状态失败，请刷新重试。'));
      } finally {
        if (isCurrent()) setLoading(false);
      }
    }
    load();
  }, [apiSurface, deliveryContextKey]);

  async function openPath(targetPath: string, label: string) {
    if (!authorityReady || loading) return;
    if (!targetPath) {
      setMessage(`${label}不可用：最终验收汇总尚未生成。`);
      return;
    }
    if (!canOpenPath) {
      setMessage(`${label}不可用：openReportPath 未接入。`);
      return;
    }
    const operation = operations.begin();
    if (!operation) return;
    const isCurrent = operation.isCurrent;
    const pathKey = deliveryPathActionKey(label, targetPath);
    setOpeningPathKey(pathKey);
    setMessage(`${label}打开中...`);
    try {
      await apiSurface.openReportPath(targetPath);
      if (!isCurrent()) return;
      setMessage(`${label}已请求打开，路径见详情。`);
    } catch (caught) {
      rendererRuntimeLog.error('delivery.operation_failed', { error: caught });
      if (!isCurrent()) { rendererRuntimeLog.warn('delivery.stale_result_failed', { error: caught }); return; }
      setMessage(compactDeliveryMessage(toUserFacingError(caught, `${label}打开失败。`)));
    } finally {
      if (isCurrent()) {
        setOpeningPathKey(null);
      }
      operation.finish();
    }
  }

  async function openArtifact(artifactId: RendererArtifactId | '', label: string) {
    if (!authorityReady || loading) return;
    if (!artifactId) {
      setMessage(`${label}不可用：当前没有已登记的文件或目录工件。`);
      return;
    }
    if (!canOpenArtifact) {
      setMessage(`${label}不可用：不透明工件打开能力未接入。`);
      return;
    }
    const operation = operations.begin();
    if (!operation) return;
    const isCurrent = operation.isCurrent;
    const artifactKey = deliveryPathActionKey(label, `artifact:${artifactId}`);
    setOpeningPathKey(artifactKey);
    setMessage(`${label}打开中...`);
    try {
      const storeContext = storeAuthority.authoritativeContext;
      if (!storeContext) throw new Error('当前店铺权威不可用。');
      await apiSurface.openReportArtifact(artifactId, { ...storeContext });
      if (!isCurrent()) return;
      setMessage(`${label}已请求打开。`);
    } catch (caught) {
      rendererRuntimeLog.error('delivery.operation_failed', { error: caught });
      if (!isCurrent()) { rendererRuntimeLog.warn('delivery.stale_result_failed', { error: caught }); return; }
      setMessage(compactDeliveryMessage(toUserFacingError(caught, `${label}打开失败。`)));
    } finally {
      if (isCurrent()) {
        setOpeningPathKey(null);
      }
      operation.finish();
    }
  }

  async function runDeliveryAction(action: DeliveryActionKey, task: () => Promise<void>) {
    if (!authorityReady || loading) return;
    const operation = operations.begin();
    if (!operation) return;
    setDeliveryActionBusy(action);
    try {
      await task();
    } catch (error) {
      rendererRuntimeLog.error('delivery.action_failed', { action, error });
      if (operation.isCurrent()) setMessage(toUserFacingError(error, '交付操作失败，请重试。'));
    } finally {
      if (operation.isCurrent()) setDeliveryActionBusy(null);
      operation.finish();
    }
  }

  async function exportBundle() {
    const isCurrent = operations.capture();
    if (!deliveryReady) {
      setMessage('交付包未导出：最终验收、非预览门禁或当前免安装包校验码尚未全部通过。');
      return;
    }
    if (typeof apiSurface.exportDeliveryBundle !== 'function') {
      setMessage('导出交付包能力未连接。请先生成最终验收汇总，再运行交付包导出。');
      return;
    }
    await runDeliveryAction('export-bundle', async () => {
      try {
        const result = await apiSurface.exportDeliveryBundle(scope);
        if (!isCurrent()) return;
        if (result?.success) {
          if (result.dataReconciliation) {
            setDataReconciliation(result.dataReconciliation);
          }
          setExportedBundlePath(result.bundleDir || result.manifestPath || DELIVERY_BUNDLE_PATH);
          const reconciliationSuffix = result.dataReconciliation?.jsonPath || result.dataReconciliation?.markdownPath
            ? '；已包含当前范围数据口径核对'
            : '';
          setMessage(`交付包已导出${reconciliationSuffix}。`);
        } else {
          setMessage(compactDeliveryMessage(result?.message || '交付包未导出：请先补齐最终就绪证据。'));
        }
      } catch (caught) {
        rendererRuntimeLog.error('delivery.operation_failed', { error: caught });
        if (!isCurrent()) { rendererRuntimeLog.warn('delivery.stale_result_failed', { error: caught }); return; }
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '交付包导出失败。')));
      }
    });
    if (!isCurrent()) return;
  }

  async function exportNonReadyEvidence() {
    const isCurrent = operations.capture();
    if (!nonReadyEvidenceExportAvailable || typeof apiSurface.exportDeliveryBundle !== 'function') {
      setMessage('请先刷新当前验收，连接导出能力后再导出未完成验收材料。');
      return;
    }
    await runDeliveryAction('export-non-ready', async () => {
      try {
        const result = await exportNonReadyDeliveryEvidence(readiness, Boolean(previewState), scope,
          currentScope => apiSurface.exportDeliveryBundle(currentScope));
        if (!isCurrent()) return;
        if (!result.success) {
          setMessage(compactDeliveryMessage(result.message || '未完成验收材料导出失败，请刷新验收后重试。'));
          return;
        }
        setExportedBundlePath(result.bundleDir || result.manifestPath || DELIVERY_BUNDLE_PATH);
        setMessage(result.status === 'APP_READY'
          ? '材料已按最新原件重新核验导出，请刷新验收查看最新结论。'
          : '未完成验收材料已导出，包含当前缺口，不能作为生产就绪证明。');
      } catch (caught) {
        rendererRuntimeLog.error('delivery.operation_failed', { error: caught });
        if (!isCurrent()) { rendererRuntimeLog.warn('delivery.stale_result_failed', { error: caught }); return; }
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '未完成验收材料导出失败。')));
      }
    });
    if (!isCurrent()) return;
  }

  async function refreshFinalReadinessManifest() {
    const isCurrent = operations.capture();
    if (typeof apiSurface.refreshFinalReadiness !== 'function') {
      setMessage('刷新最终验收能力未连接。');
      return;
    }
    await runDeliveryAction('refresh-final', async () => {
      try {
        const result = await runDeliveryWorkflowMutation('refresh', () => readFinalReadinessRefresh(() => apiSurface.refreshFinalReadiness()), undefined, isCurrent);
        if (!isCurrent()) return;
        setFinalReadinessRefresh(result || null);
        if (result?.readiness) {
          setReadiness(result.readiness);
        }
        setMessage(result?.readiness?.appReady
          ? '最终验收已刷新并通过。'
          : '最终验收已刷新，仍未就绪。');
      } catch (caught) {
        rendererRuntimeLog.error('delivery.operation_failed', { error: caught });
        if (!isCurrent()) { rendererRuntimeLog.warn('delivery.stale_result_failed', { error: caught }); return; }
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '刷新最终验收失败。')));
      }
    });
    if (!isCurrent()) return;
  }

  async function createReadbackWorkPackage() {
    const isCurrent = operations.capture();
    if (!readbackCandidatePath) {
      setMessage('无法创建回读工作包：当前最终验收没有绑定广告回读候选证据路径。');
      return;
    }
    if (typeof apiSurface.prepareAdReadbackSession !== 'function') {
      setMessage('无法创建回读工作包：本地回读准备能力未连接。');
      return;
    }
    await runDeliveryAction('create-readback', async () => {
      try {
        const result = await runDeliveryWorkflowMutation<any>('create-readback', () => apiSurface.prepareAdReadbackSession({ sourcePath: readbackCandidatePath }), undefined, isCurrent);
        if (!isCurrent()) return;
        setReadbackSession(result || null);
        setReadbackSessionCheck(null);
        setReadbackSessionFill(null);
        setReadbackEvidenceVerify(null);
        setMessage('回读工作包已创建，路径见详情。');
      } catch (caught) {
        rendererRuntimeLog.error('delivery.operation_failed', { error: caught });
        if (!isCurrent()) { rendererRuntimeLog.warn('delivery.stale_result_failed', { error: caught }); return; }
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '创建回读工作包失败。')));
      }
    });
    if (!isCurrent()) return;
  }

  function requestReadbackRepair() {
    const intent = buildDeliveryReadbackRepairIntent(readbackBlockerGate);
    try {
      window.sessionStorage?.setItem(READBACK_REPAIR_INTENT_STORAGE_KEY, JSON.stringify(intent));
    } catch (error) {
      rendererRuntimeLog.warn('delivery.repair_hint_storage_failed', { error });
    }
    window.dispatchEvent(new CustomEvent<ReadbackRepairIntent>(READBACK_REPAIR_INTENT_EVENT, { detail: intent }));
    navigate('readback');
  }

  async function verifyReadbackWorkPackage() {
    const isCurrent = operations.capture();
    const sessionDir = readbackSession?.sessionDir || '';
    if (!sessionDir) {
      setMessage('无法检查回读工作包：请先创建工作包。');
      return;
    }
    if (typeof apiSurface.verifyAdReadbackSession !== 'function') {
      setMessage('无法检查回读工作包：本地工作包检查能力未连接。');
      return;
    }
    await runDeliveryAction('verify-readback-session', async () => {
      try {
        const result = await apiSurface.verifyAdReadbackSession({ sessionDir });
        if (!isCurrent()) return;
        setReadbackSessionCheck(result || null);
        if (result?.ready && result?.captureReady) {
          setMessage('回读工作包结构和现场证据均已通过。');
        } else if (result?.ready) {
          setMessage(`回读工作包结构已通过，但现场证据仍待填写：${formatCaptureMissing(result?.captureMissingFields, result?.unresolvedFields)}`);
        } else {
          setMessage(compactDeliveryMessage(`回读工作包仍需补齐：${(result?.issues || []).slice(0, 2).join('；')}`));
        }
      } catch (caught) {
        rendererRuntimeLog.error('delivery.operation_failed', { error: caught });
        if (!isCurrent()) { rendererRuntimeLog.warn('delivery.stale_result_failed', { error: caught }); return; }
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '检查回读工作包失败。')));
      }
    });
    if (!isCurrent()) return;
  }

  async function fillReadbackWorkPackage() {
    const isCurrent = operations.capture();
    const sessionDir = readbackSession?.sessionDir || '';
    if (!sessionDir) {
      setMessage('无法生成回读证据：请先创建工作包。');
      return;
    }
    if (typeof apiSurface.fillAdReadbackSession !== 'function') {
      setMessage('无法生成回读证据：本地证据生成能力未连接。');
      return;
    }
    await runDeliveryAction('fill-readback-session', async () => {
      try {
        const result = await runDeliveryWorkflowMutation<any>('create-readback', () => apiSurface.fillAdReadbackSession({ sessionDir }), undefined, isCurrent);
        if (!isCurrent()) return;
        setReadbackSessionFill(result || null);
        setMessage(result?.readyForVerifier
          ? '回读证据已生成，可进入校验。'
          : compactDeliveryMessage(`回读证据未生成通过：${(result?.issues || []).slice(0, 2).join('；')}`));
      } catch (caught) {
        rendererRuntimeLog.error('delivery.operation_failed', { error: caught });
        if (!isCurrent()) { rendererRuntimeLog.warn('delivery.stale_result_failed', { error: caught }); return; }
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '生成回读证据失败。')));
      }
    });
    if (!isCurrent()) return;
  }

  async function verifyGeneratedReadbackEvidence() {
    const isCurrent = operations.capture();
    const evidencePath = readbackSessionFill?.jsonPath || readbackSession?.passEvidencePath || '';
    if (!evidencePath) {
      setMessage('无法校验回读证据：请先生成回读证据。');
      return;
    }
    if (typeof apiSurface.verifyAdReadbackEvidence !== 'function') {
      setMessage('无法校验回读证据：本地回读校验能力未连接。');
      return;
    }
    await runDeliveryAction('verify-readback-evidence', async () => {
      try {
        const result = await runDeliveryWorkflowMutation<any>('verify-readback', () => apiSurface.verifyAdReadbackEvidence({ evidencePath }), undefined, isCurrent);
        if (!isCurrent()) return;
        setReadbackEvidenceVerify(result || null);
        const passed = deliveryReadbackVerifierPassed(result);
        setMessage(passed
          ? '回读证据校验通过。'
          : compactDeliveryMessage(`回读证据仍未通过：${(result?.issues || result?.blockers || []).slice(0, 2).join('；')}`));
      } catch (caught) {
        rendererRuntimeLog.error('delivery.operation_failed', { error: caught });
        if (!isCurrent()) { rendererRuntimeLog.warn('delivery.stale_result_failed', { error: caught }); return; }
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '校验回读证据失败。')));
      }
    });
    if (!isCurrent()) return;
  }

  async function refreshFinalReadinessWithReadback() {
    const isCurrent = operations.capture();
    const evidencePath = readbackSessionFill?.jsonPath || readbackSession?.passEvidencePath || '';
    if (!evidencePath) {
      setMessage('无法用回读证据刷新最终验收：请先生成回读证据。');
      return;
    }
    if (typeof apiSurface.refreshFinalReadiness !== 'function') {
      setMessage('刷新最终验收能力未连接。');
      return;
    }
    await runDeliveryAction('refresh-final-with-readback', async () => {
      try {
        const result = await runDeliveryWorkflowMutation('refresh', () => readFinalReadinessRefresh(() => apiSurface.refreshFinalReadiness({ adReadbackPath: evidencePath })), undefined, isCurrent);
        if (!isCurrent()) return;
        setFinalReadinessRefresh(result || null);
        if (result?.readiness) {
          setReadiness(result.readiness);
        }
        setMessage(result?.readiness?.appReady
          ? '已使用回读证据刷新并通过最终验收。'
          : '已使用回读证据刷新最终验收，仍未就绪。');
      } catch (caught) {
        rendererRuntimeLog.error('delivery.operation_failed', { error: caught });
        if (!isCurrent()) { rendererRuntimeLog.warn('delivery.stale_result_failed', { error: caught }); return; }
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '使用回读证据刷新最终验收失败。')));
      }
    });
    if (!isCurrent()) return;
  }

  async function exportDataReconciliation() {
    const isCurrent = operations.capture();
    if (typeof apiSurface.exportDataReconciliation !== 'function') {
      setMessage('数据口径核对导出能力未连接。');
      return;
    }
    await runDeliveryAction('export-reconciliation', async () => {
      try {
        const result = await apiSurface.exportDataReconciliation(scope);
        if (!isCurrent()) return;
        setDataReconciliation(result || null);
        if (result?.jsonPath || result?.markdownPath) {
          setMessage('数据口径核对报告已导出，路径见详情。');
        } else {
          setMessage('数据口径核对报告已生成，但未返回文件路径。');
        }
      } catch (caught) {
        rendererRuntimeLog.error('delivery.operation_failed', { error: caught });
        if (!isCurrent()) { rendererRuntimeLog.warn('delivery.stale_result_failed', { error: caught }); return; }
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '数据口径核对报告导出失败。')));
      }
    });
    if (!isCurrent()) return;
  }

  async function copySummary() {
    if (!authorityReady || loading) return;
    const operation = operations.begin();
    if (!operation) return;
    const isCurrent = operation.isCurrent;
    const summary = [
      `交付状态：${deliveryTaskTitle}`,
      `范围：${summarizeScope(data, scope)}`,
      '最终验收通过且安装包证据已记录时，才可声明可以交付。',
      `真实报表文件：${data ? realFiles.length : '未知（当前业务数据尚未读取）'}`,
      `真实报表目录工件：${reportDownloadLabel}`,
      `真实报表清单工件：${collectionManifestLabel}`,
      ...realFiles.slice(0, 8).map((file) => `原始文件：${file.displayName || file.reportType} / ${file.artifactDisplayName || file.fileName || '工件名称不可用'}`),
      `导入指标行数：${data ? importedRows : '未知（当前业务数据尚未读取）'}`,
      `最终验收汇总：${finalManifestPath || '最终验收汇总尚未生成'}`,
      `安装包：${packageSummary}`,
    ].join('\n');
    setCopySummaryBusy(true);
    setMessage('正在复制交付摘要...');
    try {
      await navigator.clipboard.writeText(summary);
      if (!isCurrent()) return;
      setMessage('交付摘要已复制。');
    } catch (caught) {
      rendererRuntimeLog.error('delivery.operation_failed', { error: caught });
      if (!isCurrent()) { rendererRuntimeLog.warn('delivery.stale_result_failed', { error: caught }); return; }
      setMessage(toUserFacingError(caught, '复制交付摘要失败。'));
    } finally {
      if (isCurrent()) {
        setCopySummaryBusy(false);
      }
      operation.finish();
    }
  }

  function deliveryActionButtonView(input: DeliveryActionButtonInput) {
    const capability: Record<DeliveryActionKey, string> = {
      'export-bundle': 'exportDeliveryBundle', 'export-non-ready': 'exportDeliveryBundle',
      'export-reconciliation': 'exportDataReconciliation', 'refresh-final': 'refreshFinalReadiness',
      'refresh-final-with-readback': 'refreshFinalReadiness', 'create-readback': 'prepareAdReadbackSession',
      'verify-readback-session': 'verifyAdReadbackSession', 'fill-readback-session': 'fillAdReadbackSession',
      'verify-readback-evidence': 'verifyAdReadbackEvidence',
    };
    const prerequisite: Partial<Record<DeliveryActionKey, string>> = {
      'export-bundle': '请先补齐最终验收与当前安装包证据，再导出交付包。',
      'export-non-ready': '请先刷新本次验收，再导出未完成验收材料。',
      'create-readback': '请先绑定真实回读候选证据，再创建工作包。',
      'verify-readback-session': '请先创建回读工作包，再检查结构。',
      'fill-readback-session': '请先创建回读工作包并填写现场证据，再生成。',
      'verify-readback-evidence': '请先生成回读证据，再进行校验。',
      'refresh-final-with-readback': '请先生成回读证据，再刷新最终验收。',
    };
    const connected = typeof apiSurface[capability[input.action]] === 'function';
    return { ...baseDeliveryActionButtonView({ ...input, disabled: input.disabled || actionBlocked || !connected }),
      disabledReason: !connected ? '本地操作能力尚未连接，请重新启动应用后重试。'
        : input.disabled ? prerequisite[input.action] || actionDisabledReason : actionDisabledReason };
  }

  const exportBundleButton = deliveryActionButtonView({
    action: 'export-bundle',
    activeAction: deliveryActionBusy,
    baseClassName: `secondary-button delivery-export-button${deliveryReady ? '' : ' delivery-export-blocked'}`,
    busyLabel: deliveryActionBusyLabel('export-bundle'),
    disabled: !deliveryReady,
    idleLabel: '导出交付包',
  });
  const nonReadyEvidenceExportButton = deliveryActionButtonView({
    action: 'export-non-ready', activeAction: deliveryActionBusy, baseClassName: 'secondary-button',
    busyLabel: '导出中...', idleLabel: '导出未完成验收材料', disabled: !nonReadyEvidenceExportAvailable,
  });
  const exportReconciliationButton = deliveryActionButtonView({
    action: 'export-reconciliation',
    activeAction: deliveryActionBusy,
    baseClassName: 'secondary-button',
    busyLabel: deliveryActionBusyLabel('export-reconciliation'),
    idleLabel: '导出数据口径核对',
  });
  const createReadbackButton = deliveryActionButtonView({
    action: 'create-readback',
    activeAction: deliveryActionBusy,
    baseClassName: 'primary-button',
    busyLabel: deliveryActionBusyLabel('create-readback'),
    disabled: !readbackCandidatePath,
    idleLabel: '创建回读工作包',
  });
  const verifyReadbackSessionButton = deliveryActionButtonView({
    action: 'verify-readback-session',
    activeAction: deliveryActionBusy,
    baseClassName: 'secondary-button',
    busyLabel: deliveryActionBusyLabel('verify-readback-session'),
    disabled: !readbackSession?.sessionDir,
    idleLabel: '检查工作包',
  });
  const fillReadbackSessionButton = deliveryActionButtonView({
    action: 'fill-readback-session',
    activeAction: deliveryActionBusy,
    baseClassName: 'secondary-button',
    busyLabel: deliveryActionBusyLabel('fill-readback-session'),
    disabled: !readbackSession?.sessionDir,
    idleLabel: '生成回读证据',
  });
  const verifyReadbackEvidenceButton = deliveryActionButtonView({
    action: 'verify-readback-evidence',
    activeAction: deliveryActionBusy,
    baseClassName: 'secondary-button',
    busyLabel: deliveryActionBusyLabel('verify-readback-evidence'),
    disabled: !(readbackSessionFill?.jsonPath || readbackSession?.passEvidencePath),
    idleLabel: '校验回读证据',
  });
  const refreshWithReadbackButton = deliveryActionButtonView({
    action: 'refresh-final-with-readback',
    activeAction: deliveryActionBusy,
    baseClassName: 'primary-button',
    busyLabel: deliveryActionBusyLabel('refresh-final-with-readback'),
    disabled: !(readbackSessionFill?.jsonPath || readbackSession?.passEvidencePath),
    idleLabel: '用回读证据刷新最终验收',
  });
  const deliveryPrimaryButtonBase = deliveryPrimaryAction.kind === 'export'
    ? {
      ...exportBundleButton,
      className: exportBundleButton.className.replace('secondary-button', 'primary-button'),
    }
    : deliveryPrimaryAction.kind === 'refresh'
      ? deliveryActionButtonView({
        action: 'refresh-final',
        activeAction: deliveryActionBusy,
        baseClassName: 'primary-button',
        busyLabel: deliveryActionBusyLabel('refresh-final'),
        idleLabel: deliveryPrimaryAction.label,
      })
      : {
        ariaBusy: undefined,
        className: 'primary-button',
        disabled: actionBlocked,
        label: deliveryPrimaryAction.label,
        showSpinner: false,
      };
  const deliveryPrimaryButton = {
    ...deliveryPrimaryButtonBase,
    disabled: Boolean(deliveryPrimaryButtonBase.disabled || actionBlocked),
    disabledReason: 'disabledReason' in deliveryPrimaryButtonBase ? deliveryPrimaryButtonBase.disabledReason : actionDisabledReason,
  };

  function renderOpenPathButton(input: {
    className?: string;
    disabled?: boolean;
    idleLabel: string;
    messageLabel?: string;
    targetPath: string;
  }) {
    const messageLabel = input.messageLabel || input.idleLabel;
    const view = deliveryOpenPathButtonView({
      activePathKey: openingPathKey,
      baseClassName: input.className,
      disabled: input.disabled || !input.targetPath || !canOpenPath || actionBlocked,
      idleLabel: input.idleLabel,
      pathKey: deliveryPathActionKey(messageLabel, input.targetPath),
    });
    return (
      <WorkspaceActionButton
        aria-busy={view.ariaBusy}
        className={view.className}
        disabled={view.disabled}
        disabledReason={!input.targetPath ? '当前尚无此项文件，请先完成对应导出或验收后重试。'
          : !canOpenPath ? '本地打开能力尚未连接，请重新启动应用后重试。' : actionDisabledReason}
        onClick={() => openPath(input.targetPath, messageLabel)}
        type="button"
      >
        {view.showSpinner && <span aria-hidden="true" className="button-spinner" />}
        <span>{view.label}</span>
      </WorkspaceActionButton>
    );
  }

  function renderOpenArtifactButton(input: {
    artifactId?: RendererArtifactId;
    className?: string;
    idleLabel: string;
    messageLabel?: string;
  }) {
    const messageLabel = input.messageLabel || input.idleLabel;
    const artifactId = input.artifactId || '';
    const view = deliveryOpenPathButtonView({
      activePathKey: openingPathKey,
      baseClassName: input.className,
      disabled: !artifactId || !canOpenArtifact || actionBlocked,
      idleLabel: input.idleLabel,
      pathKey: deliveryPathActionKey(messageLabel, `artifact:${artifactId}`),
    });
    return (
      <WorkspaceActionButton
        aria-busy={view.ariaBusy}
        className={view.className}
        disabled={view.disabled}
        disabledReason={!artifactId ? '当前尚无已登记的文件或目录，请先完成采集并导入。'
          : !canOpenArtifact ? '本地打开能力尚未连接，请重新启动应用后重试。' : actionDisabledReason}
        onClick={() => openArtifact(artifactId, messageLabel)}
        type="button"
      >
        {view.showSpinner && <span aria-hidden="true" className="button-spinner" />}
        <span>{view.label}</span>
      </WorkspaceActionButton>
    );
  }

  return {
    nonReadyEvidenceExportAvailable,
    nonReadyEvidenceExportButton,
    exportNonReadyEvidence,
    deliveryReady,
    missingItems,
    previewState,
    deliveryPrimaryButton,
    deliveryPrimaryAction,
    gateSummaryText,
    deliveryTaskTitle,
    deliveryTaskDetail,
    readiness,
    packageBrief,
    deliveryDataFact,
    secondaryTaskActions,
    actionDisabledReason,
    evidenceGovernanceStatus,
    evidenceGovernanceFacts,
    renderOpenPathButton,
    deliveryBundleOpenPath,
    renderOpenArtifactButton,
    reportFolderArtifact,
    reportManifestArtifact,
    packageDirectory,
    finalManifestPath,
    exportReconciliationButton,
    exportDataReconciliation,
    data,
    scope,
    reportDownloadLabel,
    collectionManifestLabel,
    packageSummary,
    finalReadinessRefresh,
    readbackBlockerGate,
    createReadbackButton,
    createReadbackWorkPackage,
    readbackCandidatePath,
    requestReadbackRepair,
    readbackSession,
    verifyReadbackSessionButton,
    verifyReadbackWorkPackage,
    fillReadbackSessionButton,
    fillReadbackWorkPackage,
    verifyReadbackEvidenceButton,
    verifyGeneratedReadbackEvidence,
    refreshWithReadbackButton,
    refreshFinalReadinessWithReadback,
    readbackSessionCheck,
    readbackSessionFill,
    readbackEvidenceVerify,
    deliveryMatrix,
    dataReconciliation,
    manifestReady,
    items,
    loading,
    message,
  };
}
