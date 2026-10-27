import { BusinessDataConfigurationNotice } from '../components/business-data-configuration';
import { rendererRuntimeLog } from '../runtime-log';
import { usePageOperation } from './use-page-operation';
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import {
  parseReadbackRepairIntent,
  READBACK_REPAIR_INTENT_EVENT,
  READBACK_REPAIR_INTENT_STORAGE_KEY,
  readbackRepairIntentMessage,
  readbackRepairIntentStep,
  type ReadbackRepairIntent,
} from '../readback-repair-intent';
import {
  readbackWizardSteps,
  type ReadbackWizardStepId,
} from '../readback-wizard';
import {
  buildReadbackQueryKey,
  readbackAuthorityForMode,
  readbackGlobalBusyView,
  readbackRepairBlockersForMissing,
  readbackRepairActions,
  resolveReadbackScreenshotRepairAction,
  resolveReadbackExportRoute,
  type ReadbackRepairAction,
  type ReadbackRequestSnapshot,
  type ReadbackWorkspaceActionKey,
} from './readback-workspace-model';
import type { RecommendationView } from '../types';
import {
  type ReadbackPageProps,
  type ReadbackFormState,
  type ReadbackCaptureSlot,
  type ReadbackCopyCommandKey,
  type ReadbackActionKey,
} from "./readback-contracts";
import {
  readbackVerifierPassed,
  readbackOpenPathButtonView,
  readbackPathActionKey,
  readbackActionButtonView,
  readbackActionBusyLabel,
  readbackCopyCommandButtonView,
  readbackPrimaryTaskCopy,
} from "./readback-feedback";
import {
  EMPTY_FORM,
} from "./readback-constants";
import {
  captureFileList,
  nextEvidenceCaptureSlot,
} from "./readback-capture";
import {
  readbackSessionWorkflow,
} from "./readback-commands";
import {
  sourceFileLines,
} from "./readback-form";
import {
  requiredMissing,
  groupMissing,
  readbackPrecheckCopy,
  readbackContractChecks,
} from "./readback-contract-gates";
import {
  readbackRepairFieldClass,
} from "./readback-repair";
import {
  updateReadbackPageAction,
  captureEvidenceReadbackPageAction,
  loadApprovedRowsReadbackPageAction,
} from "./readback-capture-actions";
import {
  runWorkspaceActionReadbackPageAction,
  exportEvidenceReadbackPageAction,
  verifyReadbackEvidenceReadbackPageAction,
  runFinalVerificationReadbackPageAction,
} from "./readback-execution-actions";
import {
  openReadbackPathReadbackPageAction,
  openExportReadbackPageAction,
  openSessionPacketReadbackPageAction,
  openSessionInputFileReadbackPageAction,
  openSessionInputGuideReadbackPageAction,
  focusRepairTargetReadbackPageAction,
  activateRepairActionReadbackPageAction,
} from "./readback-navigation-actions";
import {
  prepareSessionPacketReadbackPageAction,
  verifySessionPacketReadbackPageAction,
  fillSessionPacketReadbackPageAction,
} from "./readback-session-actions";
import {
  copyFillCommandReadbackPageAction,
  copySessionCommandReadbackPageAction,
} from "./readback-command-actions";
import {
  type ReadbackPageActionContext,
} from "./readback-ports";
import {
  renderReadbackPageView,
} from "./readback-view";

export function ReadbackPage({
  authority = readbackAuthorityForMode('production'),
  previewScenarioId,
}: ReadbackPageProps = {}) {
  const readbackActionContext: ReadbackPageActionContext = {
    get captureReadbackContext() { return pageOperation.capture; },
    get beginOperation() { return () => {
      if (!pageOperation.hasAuthority) { setMessage(pageOperation.blockedReason); return null; }
      return pageOperation.begin();
    }; },
    get formEpochRef() { return formEpochRef; },
    get activeExportRequestRef() { return activeExportRequestRef; },
    get exportRequestIdRef() { return exportRequestIdRef; },
    get queryKey() { return queryKey; },
    get activeCaptureRequestRef() { return activeCaptureRequestRef; },
    get captureRequestIdRef() { return captureRequestIdRef; },
    get activeFinalRequestRef() { return activeFinalRequestRef; },
    get finalRequestIdRef() { return finalRequestIdRef; },
    get activeVerifyRequestRef() { return activeVerifyRequestRef; },
    get verifyRequestIdRef() { return verifyRequestIdRef; },
    get activeSessionRequestRef() { return activeSessionRequestRef; },
    get sessionRequestIdRef() { return sessionRequestIdRef; },
    get setForm() { return guardSetter(setForm); },
    get setExportResult() { return guardSetter(setExportResult); },
    get setSessionResult() { return guardSetter(setSessionResult); },
    get setSessionCheck() { return guardSetter(setSessionCheck); },
    get setSessionFillResult() { return guardSetter(setSessionFillResult); },
    get setSessionVerifyResult() { return guardSetter(setSessionVerifyResult); },
    get authority() { return authority; },
    get setCopyNotice() { return guardSetter(setCopyNotice); },
    get runWorkspaceAction() { return runWorkspaceAction; },
    get setActiveCaptureSlot() { return guardSetter(setActiveCaptureSlot); },
    get sessionResult() { return sessionResult; },
    get update() { return update; },
    get setCapturePreviews() { return guardSetter(setCapturePreviews); },
    get rowsRequestIdRef() { return rowsRequestIdRef; },
    get activeRowsRequestRef() { return activeRowsRequestRef; },
    get setLoading() { return guardSetter(setLoading); },
    get setMessage() { return guardSetter(setMessage); },
    get scope() { return scope; },
    get currentBatchId() { return currentBatchId; },
    get setApprovedRows() { return guardSetter(setApprovedRows); },
    get previewScenarioId() { return previewScenarioId; },
    get setActiveStep() { return guardSetter(setActiveStep); },
    get activeActionRef() { return activeActionRef; },
    get setActiveAction() { return guardSetter(setActiveAction); },
    get form() { return form; },
    get setActivePathKey() { return guardSetter(setActivePathKey); },
    get openReadbackPath() { return openReadbackPath; },
    get exportOpenPath() { return exportOpenPath; },
    get exportRoute() { return exportRoute; },
    get sessionFillResult() { return sessionFillResult; },
    get activateReadbackStep() { return activateReadbackStep; },
    get exportEvidence() { return exportEvidence; },
    get verifyReadbackEvidence() { return verifyReadbackEvidence; },
    get setTechnicalInspectorOpen() { return guardSetter(setTechnicalInspectorOpen); },
    get focusRepairTarget() { return focusRepairTarget; },
    get runFinalVerification() { return runFinalVerification; },
    get exportResult() { return exportResult; },
    get setActiveCopyCommand() { return guardSetter(setActiveCopyCommand); },
  };
const { data, scope, configurationRequired } = useBusinessDataPipeline();
const currentBatchId = scope.batchId || data?.collection.latestBatch?.id;
const pageOperation = usePageOperation(JSON.stringify([scope, currentBatchId]));
const [publishedContextKey, setPublishedContextKey] = useState<string | null>(null);

const [approvedRowsValue, setApprovedRows] = useState<RecommendationView[]>([]);

const [formValue, setForm] = useState<ReadbackFormState>(EMPTY_FORM);

const [exportResultValue, setExportResult] = useState<{
    jsonPath?: string;
    markdownPath?: string;
    sha256?: string;
    status?: string;
    readyForVerifier?: boolean;
    nextAction?: 'verify' | 'prepare';
  } | null>(null);

const [sessionResultValue, setSessionResult] = useState<Record<string, any> | null>(null);

const [sessionCheckValue, setSessionCheck] = useState<Record<string, any> | null>(null);

const [sessionFillResultValue, setSessionFillResult] = useState<Record<string, any> | null>(null);

const [sessionVerifyResultValue, setSessionVerifyResult] = useState<Record<string, any> | null>(null);

const [loading, setLoading] = useState(false);

const [messageValue, setMessage] = useState<string | null>(null);

const [copyNoticeValue, setCopyNotice] = useState<string | null>(null);

const [activeStep, setActiveStep] = useState<ReadbackWizardStepId>('target-source');

const [repairIntent, setRepairIntent] = useState<ReadbackRepairIntent | null>(null);

const [repairPulse, setRepairPulse] = useState(false);

const [capturePreviewsValue, setCapturePreviews] = useState<Partial<Record<ReadbackCaptureSlot, string>>>({});

const [activeActionValue, setActiveAction] = useState<ReadbackWorkspaceActionKey | null>(null);

const [activeCaptureSlotValue, setActiveCaptureSlot] = useState<ReadbackCaptureSlot | null>(null);

const [activeCopyCommandValue, setActiveCopyCommand] = useState<ReadbackCopyCommandKey | null>(null);

const [activePathKeyValue, setActivePathKey] = useState<string | null>(null);

const [technicalInspectorOpenValue, setTechnicalInspectorOpen] = useState(false);

const activeActionRef = useRef<ReadbackWorkspaceActionKey | null>(null);

const approvedRows = publishedContextKey === pageOperation.contextKey ? approvedRowsValue : [];
const form = publishedContextKey === pageOperation.contextKey ? formValue : EMPTY_FORM;
const exportResult = publishedContextKey === pageOperation.contextKey ? exportResultValue : null;
const sessionResult = publishedContextKey === pageOperation.contextKey ? sessionResultValue : null;
const sessionCheck = publishedContextKey === pageOperation.contextKey ? sessionCheckValue : null;
const sessionFillResult = publishedContextKey === pageOperation.contextKey ? sessionFillResultValue : null;
const sessionVerifyResult = publishedContextKey === pageOperation.contextKey ? sessionVerifyResultValue : null;
const message = publishedContextKey === pageOperation.contextKey ? messageValue : null;
const copyNotice = publishedContextKey === pageOperation.contextKey ? copyNoticeValue : null;
const activeAction = publishedContextKey === pageOperation.contextKey ? activeActionValue : null;
const activeCaptureSlot = publishedContextKey === pageOperation.contextKey ? activeCaptureSlotValue : null;
const activeCopyCommand = publishedContextKey === pageOperation.contextKey ? activeCopyCommandValue : null;
const activePathKey = publishedContextKey === pageOperation.contextKey ? activePathKeyValue : null;
const capturePreviews: Partial<Record<ReadbackCaptureSlot, string>> = publishedContextKey === pageOperation.contextKey ? capturePreviewsValue : {};

const technicalInspectorOpen = publishedContextKey === pageOperation.contextKey && technicalInspectorOpenValue;

const readbackActionBusy = activeAction as ReadbackActionKey | null;

const copyCommandBusy = activeAction === 'copy-command' ? activeCopyCommand : null;

const pathOpenKey = activeAction === 'open-path' ? activePathKey : null;

const captureSavingSlot = activeAction === 'capture-evidence' ? activeCaptureSlot : null;

const rowsRequestIdRef = useRef(0);

const captureRequestIdRef = useRef(0);

const exportRequestIdRef = useRef(0);

const finalRequestIdRef = useRef(0);

const sessionRequestIdRef = useRef(0);

const verifyRequestIdRef = useRef(0);

const formEpochRef = useRef(0);

const activeRowsRequestRef = useRef<ReadbackRequestSnapshot | null>(null);

const activeCaptureRequestRef = useRef<ReadbackRequestSnapshot | null>(null);

const activeExportRequestRef = useRef<ReadbackRequestSnapshot | null>(null);

const activeFinalRequestRef = useRef<ReadbackRequestSnapshot | null>(null);

const activeSessionRequestRef = useRef<ReadbackRequestSnapshot | null>(null);

const activeVerifyRequestRef = useRef<ReadbackRequestSnapshot | null>(null);

const stepTabRefs = useRef<Partial<Record<ReadbackWizardStepId, HTMLButtonElement | null>>>({});

const focusStepTab = (stepId: ReadbackWizardStepId) => {
    const focusTab = () => stepTabRefs.current[stepId]?.focus();
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focusTab);
      return;
    }
    focusTab();
  };

const activateReadbackStep = (stepId: ReadbackWizardStepId, focusTab = false) => {
    setActiveStep(stepId);
    if (focusTab) focusStepTab(stepId);
  };

const scopeQueryKey = useMemo(() => buildReadbackQueryKey({
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    batchId: currentBatchId,
  }), [currentBatchId, scope.asin, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName]);
const queryKey = pageOperation.contextKey;
const liveContextKeyRef = useRef(queryKey);
if (liveContextKeyRef.current !== queryKey) {
  liveContextKeyRef.current = queryKey;
  activeActionRef.current = null;
}
function guardSetter<T>(setter: React.Dispatch<React.SetStateAction<T>>): React.Dispatch<React.SetStateAction<T>> {
  const canPublish = pageOperation.capture();
  return value => { if (canPublish()) setter(value); };
}




const missing = useMemo(() => requiredMissing(form, currentBatchId), [currentBatchId, form]);

const sourceBatchMatches = Boolean(form.sourceBatchId && currentBatchId && form.sourceBatchId === currentBatchId);

const missingGroups = useMemo(() => groupMissing(missing), [missing]);

const precheckCopy = useMemo(() => readbackPrecheckCopy(missing), [missing]);

const contractChecks = useMemo(() => readbackContractChecks(form), [form]);

const sessionWorkflow = useMemo(() => readbackSessionWorkflow(exportResult?.jsonPath), [exportResult?.jsonPath]);

const exportRoute = useMemo(() => resolveReadbackExportRoute(exportResult), [exportResult]);

const finalVerificationPassed = readbackVerifierPassed(sessionVerifyResult);

const completedViaWorkPackage = finalVerificationPassed
    && exportRoute.kind === 'prepare-session'
    && Boolean(sessionFillResult?.jsonPath);

const readbackStepSummaries = useMemo(() => {
    const missingSet = new Set(missing);
    return readbackWizardSteps.map((step) => {
      const missingCount = finalVerificationPassed
        ? 0
        : step.fields.filter((field) => missingSet.has(field)).length;
      return {
        ...step,
        missingCount,
        status: missingCount ? 'blocked' : 'ready',
        detail: finalVerificationPassed ? '最终核对通过' : missingCount ? `缺 ${missingCount} 项` : '已满足',
      };
    });
  }, [finalVerificationPassed, missing]);

const activeStepSummary = readbackStepSummaries.find((step) => step.id === activeStep) || readbackStepSummaries[0];

const activeStepIndex = Math.max(0, readbackWizardSteps.findIndex((step) => step.id === activeStep));

const readbackStepRailStyle = {
    '--readback-active-step': activeStepIndex,
    '--readback-step-count': readbackWizardSteps.length,
  } as React.CSSProperties;

const activeMissingCount = activeStepSummary?.missingCount || 0;

const capturedEvidenceCount = [
    form.approvalArtifactPath,
    form.beforeScreenshotPath,
    form.afterScreenshotPath,
    form.readbackEvidencePath,
  ].filter((value) => value.trim()).length;

const activeStepDetail = finalVerificationPassed
    ? '最终证据已核对通过；批准记录、报表批次与现场证据保持一致。'
    : activeMissingCount
      ? `当前步骤还有 ${activeMissingCount} 项待补；所有安全缺口仍由本地校验决定。`
      : activeStep === 'verify-export'
        ? '当前步骤已满足；请运行最终校验，核对批准记录、报表批次与现场证据。'
        : '当前步骤已满足；继续下一步前仍保留最终导出校验。';

const sourceFieldCount = [
    form.storeName,
    form.marketplaceCode,
    form.asin,
    form.campaignName,
    form.adGroupName,
    form.entityType,
    form.entityName,
    form.actionType,
    form.currentValue,
    form.recommendedValue,
    form.sourceBatchId,
    form.sourceMetricDate,
    form.sourceRow,
    form.sourceFiles,
  ].filter((value) => value.trim()).length;

const firstScreenshotRepairSlot: ReadbackCaptureSlot | null = !form.approvalArtifactPath.trim()
    ? 'approval'
    : !form.beforeScreenshotPath.trim()
      ? 'before'
      : !form.afterScreenshotPath.trim()
        ? 'after'
        : !form.readbackEvidencePath.trim()
          ? 'readback'
          : missing.some((item) => item.includes('证据文件不能复用')) ? 'before' : null;

const sourceFilesCount = sourceFileLines(form.sourceFiles).length;

const repairIntentStep = readbackRepairIntentStep(repairIntent);

const exportOpenPath = exportResult?.jsonPath || exportResult?.markdownPath || '';

const openExportButton = readbackOpenPathButtonView({
    activePathKey: pathOpenKey,
    disabled: !pageOperation.hasAuthority || authority.previewOnly || !exportOpenPath || Boolean(activeAction && activeAction !== 'open-path'),
    idleLabel: '打开导出文件',
    pathKey: readbackPathActionKey('打开导出文件', exportOpenPath),
  });

const openSessionPacketButton = readbackOpenPathButtonView({
    activePathKey: pathOpenKey,
    disabled: !pageOperation.hasAuthority || authority.previewOnly || !sessionResult?.sessionDir || Boolean(activeAction && activeAction !== 'open-path'),
    idleLabel: '打开工作包',
    pathKey: readbackPathActionKey('打开工作包', sessionResult?.sessionDir),
  });

const openSessionInputFileButton = readbackOpenPathButtonView({
    activePathKey: pathOpenKey,
    disabled: !pageOperation.hasAuthority || authority.previewOnly || !sessionResult?.sessionInputPath || Boolean(activeAction && activeAction !== 'open-path'),
    idleLabel: '打开填写文件',
    pathKey: readbackPathActionKey('打开填写文件', sessionResult?.sessionInputPath),
  });

const openSessionInputGuideButton = readbackOpenPathButtonView({
    activePathKey: pathOpenKey,
    disabled: !pageOperation.hasAuthority || authority.previewOnly || !sessionResult?.sessionInputGuidePath || Boolean(activeAction && activeAction !== 'open-path'),
    idleLabel: '打开填写说明',
    pathKey: readbackPathActionKey('打开填写说明', sessionResult?.sessionInputGuidePath),
  });

function update(patch: Partial<ReadbackFormState>, options: { preserveSession?: boolean } = {}): void {
    return updateReadbackPageAction.call(readbackActionContext, patch, options);
  }

const repairFieldClass = (label: string, baseClassName = '') => [
    baseClassName,
    readbackRepairFieldClass(label, missing, Boolean(repairIntent), repairPulse),
  ].filter(Boolean).join(' ');

useEffect(() => {
    let clearPulseTimer: number | null = null;
    function applyIntent(intent: ReadbackRepairIntent | null) {
      if (!intent) return;
      setRepairIntent(intent);
      setActiveStep(readbackRepairIntentStep(intent));
      setRepairPulse(true);
      setMessage(readbackRepairIntentMessage(intent));
      if (clearPulseTimer) window.clearTimeout(clearPulseTimer);
      clearPulseTimer = window.setTimeout(() => setRepairPulse(false), 150);
    }
    function handleRepairIntent(event: Event) {
      applyIntent((event as CustomEvent<ReadbackRepairIntent>).detail || null);
    }
    window.addEventListener(READBACK_REPAIR_INTENT_EVENT, handleRepairIntent);
    try {
      const storedIntent = parseReadbackRepairIntent(window.sessionStorage?.getItem(READBACK_REPAIR_INTENT_STORAGE_KEY));
      if (storedIntent) {
        window.sessionStorage?.removeItem(READBACK_REPAIR_INTENT_STORAGE_KEY);
        applyIntent(storedIntent);
      }
    } catch (caught) {
      rendererRuntimeLog.error('renderer.readback_workspace.failed', { error: caught });
      // 修复意图仅用于便捷交接，缺失时仍可使用回读页面。
    }
    return () => {
      window.removeEventListener(READBACK_REPAIR_INTENT_EVENT, handleRepairIntent);
      if (clearPulseTimer) window.clearTimeout(clearPulseTimer);
    };
  }, []);

function captureEvidence(slot: ReadbackCaptureSlot, files: File[]): Promise<void> {
    return captureEvidenceReadbackPageAction.call(readbackActionContext, slot, files);
  }

function loadApprovedRows(): Promise<void> {
    if (!pageOperation.hasAuthority) { setLoading(false); setMessage(pageOperation.blockedReason); return Promise.resolve(); }
    return loadApprovedRowsReadbackPageAction.call(readbackActionContext);
  }

function runWorkspaceAction<T>(action: ReadbackWorkspaceActionKey, task: () => Promise<T>): Promise<T | undefined> {
    return (runWorkspaceActionReadbackPageAction<T>).call(readbackActionContext, action, task);
  }

function exportEvidence(options: { withinActiveAction?: boolean } = {}): Promise<any> {
    return exportEvidenceReadbackPageAction.call(readbackActionContext, options);
  }

function openReadbackPath(targetPath?: string, label = '打开路径'): Promise<void> {
    return openReadbackPathReadbackPageAction.call(readbackActionContext, targetPath, label);
  }

function openExport(): Promise<void> {
    return openExportReadbackPageAction.call(readbackActionContext);
  }

function prepareSessionPacket(): Promise<void> {
    return prepareSessionPacketReadbackPageAction.call(readbackActionContext);
  }

function openSessionPacket(): Promise<void> {
    return openSessionPacketReadbackPageAction.call(readbackActionContext);
  }

function openSessionInputFile(): Promise<void> {
    return openSessionInputFileReadbackPageAction.call(readbackActionContext);
  }

function openSessionInputGuide(): Promise<void> {
    return openSessionInputGuideReadbackPageAction.call(readbackActionContext);
  }

function verifySessionPacket(): Promise<void> {
    return verifySessionPacketReadbackPageAction.call(readbackActionContext);
  }

function fillSessionPacket(): Promise<void> {
    return fillSessionPacketReadbackPageAction.call(readbackActionContext);
  }

function verifyReadbackEvidence(options: { evidencePath?: string; withinActiveAction?: boolean } = {}): Promise<any> {
    return verifyReadbackEvidenceReadbackPageAction.call(readbackActionContext, options);
  }

function runFinalVerification(): Promise<void> {
    return runFinalVerificationReadbackPageAction.call(readbackActionContext);
  }

function focusRepairTarget(action: ReadbackRepairAction): void {
    return focusRepairTargetReadbackPageAction.call(readbackActionContext, action);
  }

function activateRepairAction(action: ReadbackRepairAction): void {
    return activateRepairActionReadbackPageAction.call(readbackActionContext, action);
  }

function copyFillCommand(): Promise<void> {
    return copyFillCommandReadbackPageAction.call(readbackActionContext);
  }

function copySessionCommand(kind: 'prepare' | 'verify' | 'fill'): Promise<void> {
    return copySessionCommandReadbackPageAction.call(readbackActionContext, kind);
  }

useEffect(() => {
    setPublishedContextKey(queryKey);
    setTechnicalInspectorOpen(false);
    setActiveAction(null); setActiveCopyCommand(null); setActivePathKey(null); setActiveCaptureSlot(null);
    formEpochRef.current += 1;
    activeRowsRequestRef.current = {
      kind: 'rows',
      requestId: ++rowsRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    activeExportRequestRef.current = {
      kind: 'export',
      requestId: ++exportRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    activeCaptureRequestRef.current = {
      kind: 'capture',
      requestId: ++captureRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    activeFinalRequestRef.current = {
      kind: 'final',
      requestId: ++finalRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    activeVerifyRequestRef.current = {
      kind: 'verify',
      requestId: ++verifyRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    activeSessionRequestRef.current = {
      kind: 'session',
      requestId: ++sessionRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    setApprovedRows([]);
    setForm(EMPTY_FORM);
    setExportResult(null);
    setSessionResult(null);
    setSessionCheck(null);
    setSessionFillResult(null);
    setSessionVerifyResult(null);
    setCapturePreviews({});
    setCopyNotice(null);
    setActiveStep('target-source');
    if (!currentBatchId) {
      setLoading(false);
      return;
    }
    void loadApprovedRows();
  }, [queryKey]);

useEffect(() => {
    if (!form.recommendationId) return;
    const stillApproved = approvedRows.some((row) => String(row.id) === form.recommendationId);
    if (!stillApproved) {
      formEpochRef.current += 1;
      activeSessionRequestRef.current = {
        kind: 'session',
        requestId: ++sessionRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeCaptureRequestRef.current = {
        kind: 'capture',
        requestId: ++captureRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeFinalRequestRef.current = {
        kind: 'final',
        requestId: ++finalRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeExportRequestRef.current = {
        kind: 'export',
        requestId: ++exportRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeVerifyRequestRef.current = {
        kind: 'verify',
        requestId: ++verifyRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      setForm(EMPTY_FORM);
      setExportResult(null);
      setSessionResult(null);
      setSessionCheck(null);
      setSessionFillResult(null);
      setSessionVerifyResult(null);
      setCapturePreviews({});
      setCopyNotice(null);
      setActiveStep('target-source');
      setMessage('已清空结果核对表单：当前范围不再包含该已批准动作。');
    }
  }, [approvedRows, form.recommendationId]);

useEffect(() => {
    if (activeStep !== 'evidence' || !authority.capabilities.captureEvidence) return undefined;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return;
      const files = captureFileList(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      void captureEvidence(nextEvidenceCaptureSlot(form), files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [activeStep, authority.capabilities.captureEvidence, form, sessionResult?.sessionDir, queryKey]);

const exportEvidenceButton = readbackActionButtonView({
    action: 'export-evidence', activeAction: readbackActionBusy, baseClassName: 'secondary-button',
    busyLabel: readbackActionBusyLabel('export-evidence'), label: '导出回读证据',
    disabled: !pageOperation.hasAuthority || !authority.capabilities.exportEvidence || !form.recommendationId,
  });
const prepareSessionButton = readbackActionButtonView({
    action: 'prepare-session',
    activeAction: readbackActionBusy,
    baseClassName: 'primary-button',
    busyLabel: readbackActionBusyLabel('prepare-session'),
    disabled: !pageOperation.hasAuthority || !authority.capabilities.prepareSession || exportRoute.kind !== 'prepare-session',
    label: '创建回读工作包',
  });

const verifySessionButton = readbackActionButtonView({
    action: 'verify-session',
    activeAction: readbackActionBusy,
    baseClassName: 'secondary-button',
    busyLabel: readbackActionBusyLabel('verify-session'),
    disabled: !pageOperation.hasAuthority || !authority.capabilities.verifySession || !sessionResult?.sessionDir,
    label: '检查工作包',
  });

const fillSessionButton = readbackActionButtonView({
    action: 'fill-session',
    activeAction: readbackActionBusy,
    baseClassName: 'primary-button',
    busyLabel: readbackActionBusyLabel('fill-session'),
    disabled: !pageOperation.hasAuthority || !authority.capabilities.fillSession || !sessionResult?.sessionDir,
    label: '生成回读证据',
  });

const verifyEvidenceButton = readbackActionButtonView({
    action: 'verify-evidence',
    activeAction: readbackActionBusy,
    baseClassName: 'primary-button',
    busyLabel: readbackActionBusyLabel('verify-evidence'),
    disabled: !pageOperation.hasAuthority || !authority.capabilities.verifyEvidence
      || (exportRoute.kind !== 'direct-verify' && !sessionFillResult?.jsonPath),
    label: '校验证据文件',
  });

const canCopyCommands = exportRoute.kind === 'prepare-session';

const prepareCopyCommandButton = readbackCopyCommandButtonView({
    activeCommand: copyCommandBusy,
    command: 'prepare',
    disabled: !pageOperation.hasAuthority || !canCopyCommands || Boolean(readbackActionBusy),
    label: '复制创建工作包命令',
  });

const verifyCopyCommandButton = readbackCopyCommandButtonView({
    activeCommand: copyCommandBusy,
    command: 'verify',
    disabled: !pageOperation.hasAuthority || !canCopyCommands || Boolean(readbackActionBusy),
    label: '复制检查工作包命令',
  });

const fillCopyCommandButton = readbackCopyCommandButtonView({
    activeCommand: copyCommandBusy,
    command: 'fill',
    disabled: !pageOperation.hasAuthority || !canCopyCommands || Boolean(readbackActionBusy),
    label: '复制生成回读证据命令',
  });

const longFillCopyCommandButton = readbackCopyCommandButtonView({
    activeCommand: copyCommandBusy,
    command: 'long-fill',
    disabled: !pageOperation.hasAuthority || !canCopyCommands || Boolean(readbackActionBusy),
    label: '复制长参数生成命令',
  });

const repairActions = readbackRepairActions(readbackRepairBlockersForMissing(missing))
    .map((action) => resolveReadbackScreenshotRepairAction(action, form));

const primaryRepairAction = repairActions[0];

const secondaryRepairActions = repairActions.slice(1, 2);

const primaryTaskCopy = readbackPrimaryTaskCopy({
    recommendationId: form.recommendationId,
    finalVerificationPassed,
    primaryRepairAction,
  });

const finalVerificationView = readbackGlobalBusyView({
    action: 'final-verification',
    activeAction,
    disabled: !pageOperation.hasAuthority || !authority.capabilities.verifyEvidence || !form.recommendationId,
  });

const technicalInspectorLocked = Boolean(activeAction);

const taskBannerAction = (action: ReadbackRepairAction) => ({
    label: action.label,
    ariaLabel: action.label,
    busy: action.blocker === 'verification' && finalVerificationView.showSpinner,
    busyLabel: action.blocker === 'verification' ? '正在导出并校验...' : undefined,
    disabled: !pageOperation.hasAuthority || authority.previewOnly || Boolean(activeAction) || !form.recommendationId,
    disabledReason: !pageOperation.hasAuthority ? pageOperation.blockedReason : authority.previewOnly
      ? '仅开发预览为只读布局，不代表正式交付就绪。'
      : !form.recommendationId ? '请先选择一条已批准动作。' : activeAction ? '正在处理回读证据，请等待本次操作完成后重试。' : undefined,
    onClick: () => activateRepairAction(action),
  });

const passedTaskAction = {
    label: '查看核对详情',
    ariaLabel: '查看核对详情',
    disabled: Boolean(activeAction),
    disabledReason: '正在处理回读证据，请等待本次操作完成后查看详情。',
    onClick: () => setTechnicalInspectorOpen(true),
  };

const selectApprovedActionTaskAction = {
    label: '选择已批准动作',
    ariaLabel: '选择已批准动作',
    disabled: !pageOperation.hasAuthority || authority.previewOnly || Boolean(activeAction) || approvedRows.length === 0,
    disabledReason: !pageOperation.hasAuthority ? pageOperation.blockedReason : authority.previewOnly
      ? '仅开发预览为只读布局，不代表正式交付就绪。'
      : approvedRows.length === 0 ? '当前范围没有已批准待执行动作；请到建议与审批完成具体建议的人工决定后刷新。' : activeAction ? '正在处理回读证据，请等待本次操作完成后重试。' : undefined,
    onClick: () => {
      activateReadbackStep('target-source');
      window.requestAnimationFrame(() => document.getElementById('readback-approved-actions')?.focus());
    },
  };
  return <>{configurationRequired && <BusinessDataConfigurationNotice />}{renderReadbackPageView({
    authority,
    previewScenarioId,
    primaryTaskCopy,
    finalVerificationPassed,
    missing,
    precheckCopy,
    form,
    capturedEvidenceCount,
    passedTaskAction,
    taskBannerAction,
    primaryRepairAction,
    selectApprovedActionTaskAction,
    secondaryRepairActions,
    repairIntent,
    activeStepIndex,
    activeStepSummary,
    activeStepDetail,
    readbackStepRailStyle,
    readbackStepSummaries,
    activeStep,
    repairIntentStep,
    activateReadbackStep,
    stepTabRefs,
    activeMissingCount,
    technicalInspectorLocked,
    authorityUnavailableReason: pageOperation.hasAuthority ? null : pageOperation.blockedReason,
    setTechnicalInspectorOpen,
    activeAction,
    currentBatchId,
    sourceBatchMatches,
    approvedRows,
    scope,
    formEpochRef,
    activeExportRequestRef,
    exportRequestIdRef,
    queryKey,
    activeCaptureRequestRef,
    captureRequestIdRef,
    activeFinalRequestRef,
    finalRequestIdRef,
    activeVerifyRequestRef,
    verifyRequestIdRef,
    activeSessionRequestRef,
    sessionRequestIdRef,
    setForm,
    setExportResult,
    setSessionResult,
    setSessionCheck,
    setSessionFillResult,
    setSessionVerifyResult,
    setCapturePreviews,
    setMessage,
    setCopyNotice,
    setActiveStep,
    loading,
    sourceFieldCount,
    sourceFilesCount,
    captureEvidence,
    firstScreenshotRepairSlot,
    capturePreviews,
    captureSavingSlot,
    update,
    repairPulse,
    contractChecks,
    repairFieldClass,
    missingGroups,
    message,
    technicalInspectorOpen,
    exportResult,
    completedViaWorkPackage,
    exportEvidenceButton,
    exportEvidence,
    openExportButton,
    openExport,
    prepareSessionButton,
    prepareSessionPacket,
    verifySessionButton,
    verifySessionPacket,
    fillSessionButton,
    fillSessionPacket,
    verifyEvidenceButton,
    verifyReadbackEvidence,
    sessionWorkflow,
    sessionResult,
    openSessionPacketButton,
    openSessionPacket,
    openSessionInputFileButton,
    openSessionInputFile,
    openSessionInputGuideButton,
    openSessionInputGuide,
    sessionCheck,
    sessionFillResult,
    sessionVerifyResult,
    copyNotice,
    prepareCopyCommandButton,
    copySessionCommand,
    verifyCopyCommandButton,
    fillCopyCommandButton,
    longFillCopyCommandButton,
    copyFillCommand,
  })}</>;
}
