import {
  canPublishReadbackResult,
  type ReadbackRequestSnapshot,
} from './readback-workspace-model';
import {
  type ReadbackFormState,
  type ReadbackCaptureSlot,
} from "./readback-contracts";
import {
  readbackErrorMessage,
} from "./readback-feedback";
import {
  CAPTURE_SLOT_LABELS,
} from "./readback-constants";
import {
  firstImageFile,
  readFileAsDataUrl,
  captureSlotPatch,
} from "./readback-capture";
import {
  readbackPreviewFormFromRecommendation,
} from "./readback-form";
import {
  type ReadbackPageActionContext,
} from "./readback-ports";

export function updateReadbackPageAction(this: ReadbackPageActionContext,
  patch: Partial<ReadbackFormState>,
  options: { preserveSession?: boolean } = {}): void {
  const {
    captureReadbackContext,
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
  } = this;

    formEpochRef.current += 1;
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
    setForm((current) => ({ ...current, ...patch }));
    setExportResult(null);
    if (!options.preserveSession) {
      setSessionResult(null);
      setSessionCheck(null);
      setSessionFillResult(null);
      setSessionVerifyResult(null);
    }
  }

export async function captureEvidenceReadbackPageAction(this: ReadbackPageActionContext,
  slot: ReadbackCaptureSlot,
  files: File[]): Promise<void> {
  const {
    captureReadbackContext,
    authority,
    setCopyNotice,
    runWorkspaceAction,
    captureRequestIdRef,
    queryKey,
    formEpochRef,
    activeCaptureRequestRef,
    setActiveCaptureSlot,
    sessionResult,
    update,
    setCapturePreviews,
    setSessionCheck,
    setSessionFillResult,
    setSessionVerifyResult,
  } = this;

    if (!authority.capabilities.captureEvidence) {
      setCopyNotice('仅开发预览为只读布局，不能写入截图证据。');
      return;
    }
    const file = firstImageFile(files);
    if (!file) {
      setCopyNotice('请粘贴或拖入 PNG/JPG/WebP 截图。');
      return;
    }
    const api = (window as any).electronAPI;
    if (!api?.saveReadbackCapture) {
      setCopyNotice('当前运行环境不支持截图存证。');
      return;
    }
    await runWorkspaceAction('capture-evidence', async () => {
      const request: ReadbackRequestSnapshot = {
        contextCurrent: captureReadbackContext(),
        kind: 'capture',
        requestId: ++captureRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeCaptureRequestRef.current = request;
      setActiveCaptureSlot(slot);
      setCopyNotice(`${CAPTURE_SLOT_LABELS[slot].title}正在存证...`);
      try {
        const dataUrl = await readFileAsDataUrl(file);
        if (!activeCaptureRequestRef.current || !canPublishReadbackResult(request, activeCaptureRequestRef.current)) return;
        const result = await api.saveReadbackCapture({
          slot,
          dataUrl,
          fileName: file.name,
          sessionDir: sessionResult?.sessionDir,
        });
        if (!activeCaptureRequestRef.current || !canPublishReadbackResult(request, activeCaptureRequestRef.current)) return;
        update(captureSlotPatch(slot, result.filePath, result.savedAt), { preserveSession: true });
        setCapturePreviews((current) => ({ ...current, [slot]: dataUrl }));
        setSessionCheck(null);
        setSessionFillResult(null);
        setSessionVerifyResult(null);
        setCopyNotice(`${CAPTURE_SLOT_LABELS[slot].title}已保存到本地证据目录。`);
      } catch (caught) {
        if (activeCaptureRequestRef.current && canPublishReadbackResult(request, activeCaptureRequestRef.current)) {
          setCopyNotice(readbackErrorMessage(caught, `${CAPTURE_SLOT_LABELS[slot].title}存证失败。`));
        }
      } finally {
        setActiveCaptureSlot(null);
      }
    });
  }

export async function loadApprovedRowsReadbackPageAction(this: ReadbackPageActionContext): Promise<void> {
  const {
    captureReadbackContext,
    rowsRequestIdRef,
    queryKey,
    formEpochRef,
    activeRowsRequestRef,
    setLoading,
    setMessage,
    scope,
    currentBatchId,
    setApprovedRows,
    authority,
    previewScenarioId,
    setForm,
    setActiveStep,
    setExportResult,
    setSessionVerifyResult,
  } = this;

    const request: ReadbackRequestSnapshot = {
        contextCurrent: captureReadbackContext(),
      kind: 'rows',
      requestId: ++rowsRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    activeRowsRequestRef.current = request;
    setLoading(true);
    setMessage(null);
    try {
      const rows = await (window as any).electronAPI?.getRecommendations?.({
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        storeName: scope.storeName,
        marketplaceCode: scope.marketplaceCode,
        asin: scope.asin,
        batchId: currentBatchId,
        status: 'approved',
        limit: 100,
      });
      if (activeRowsRequestRef.current && canPublishReadbackResult(request, activeRowsRequestRef.current)) {
        const nextRows = Array.isArray(rows) ? rows : [];
        setApprovedRows(nextRows);
        if (authority.previewOnly && nextRows[0] && (previewScenarioId === 'missing-readback-evidence' || previewScenarioId === 'delivery-ready')) {
          const complete = previewScenarioId === 'delivery-ready';
          const previewForm = readbackPreviewFormFromRecommendation(nextRows[0], scope, currentBatchId, complete);
          formEpochRef.current += 1;
          setForm(previewForm);
          setActiveStep(complete ? 'verify-export' : 'evidence');
          if (complete) {
            setExportResult({
              jsonPath: 'D:/preview/readback/readback-pass.json',
              markdownPath: 'D:/preview/readback/readback-pass.md',
              sha256: 'PREVIEW_ONLY_NOT_A_REAL_HASH',
              status: 'PASS',
              readyForVerifier: true,
              nextAction: 'verify',
            });
            setSessionVerifyResult({
              evidencePath: 'D:/preview/readback/readback-pass.json',
              ready: true,
              status: 'PASS',
              issues: [],
              previewOnly: true,
            });
          }
        }
      }
    } catch (caught) {
      if (activeRowsRequestRef.current && canPublishReadbackResult(request, activeRowsRequestRef.current)) {
        setMessage(readbackErrorMessage(caught, '加载已批准动作失败。'));
      }
    } finally {
      if (activeRowsRequestRef.current && canPublishReadbackResult(request, activeRowsRequestRef.current)) {
        setLoading(false);
      }
    }
  }
