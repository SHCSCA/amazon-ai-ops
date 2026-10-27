import {
  canPublishReadbackResult,
  runCurrentReadbackFinalVerification,
  runReadbackFinalVerificationWorkflow,
  type ReadbackRequestSnapshot,
  type ReadbackWorkspaceActionKey,
} from './readback-workspace-model';
import {
  runReadbackWorkflowMutation,
  readbackErrorMessage,
  readbackVerifierPassed,
} from "./readback-feedback";
import {
  type ReadbackPageActionContext,
} from "./readback-ports";

export async function runWorkspaceActionReadbackPageAction<T>(this: ReadbackPageActionContext,
  action: ReadbackWorkspaceActionKey,
  task: () => Promise<T>): Promise<T | undefined> {
  const {
    captureReadbackContext,
    activeActionRef,
    setActiveAction,
    beginOperation,
  } = this;

    const ticket = beginOperation();
    if (!ticket) return undefined;
    activeActionRef.current = action;
    setActiveAction(action);
    try {
      return await task();
    } finally {
      if (ticket.isCurrent()) {
        if (activeActionRef.current === action) activeActionRef.current = null;
        setActiveAction((current) => current === action ? null : current);
      }
      ticket.finish();
    }
  }

export async function exportEvidenceReadbackPageAction(this: ReadbackPageActionContext,
  options: { withinActiveAction?: boolean } = {}): Promise<any> {
  const {
    captureReadbackContext,
    authority,
    setMessage,
    exportRequestIdRef,
    queryKey,
    formEpochRef,
    activeExportRequestRef,
    form,
    scope,
    currentBatchId,
    setExportResult,
    setSessionResult,
    setSessionCheck,
    setSessionFillResult,
    setSessionVerifyResult,
    runWorkspaceAction,
  } = this;

    if (!authority.capabilities.exportEvidence) {
      setMessage('仅开发预览为只读布局，不能导出真实回读证据，也不代表正式交付就绪。');
      return;
    }
    const task = async () => {
      const request: ReadbackRequestSnapshot = {
        contextCurrent: captureReadbackContext(),
        kind: 'export',
        requestId: ++exportRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeExportRequestRef.current = request;
      setMessage(null);
      try {
        const exportAdReadbackEvidence = (window as any).electronAPI?.exportAdReadbackEvidence;
        if (typeof exportAdReadbackEvidence !== 'function') {
          throw new Error('回读证据导出接口未暴露。');
        }
        const result = await runReadbackWorkflowMutation<any>('create', () => exportAdReadbackEvidence({
          recommendationId: Number(form.recommendationId),
          expectedRevision: form.recommendationRevision,
          scope: {
            dateFrom: scope.dateFrom,
            dateTo: scope.dateTo,
            storeName: scope.storeName,
            marketplaceCode: scope.marketplaceCode,
            asin: scope.asin || form.asin,
            batchId: currentBatchId || '',
          },
          operatorEvidence: {
            approval: {
              operatorConfirmed: form.operatorConfirmed,
              realWriteApproved: form.realWriteApproved,
              approvalArtifactPath: form.approvalArtifactPath,
            },
            risk: {
              allowedByPolicy: form.allowedByPolicy,
            },
            before: {
              value: form.beforeValue,
              capturedAt: form.beforeCapturedAt,
              screenshotPath: form.beforeScreenshotPath,
              liveBidSourceNote: form.liveBidSourceNote,
            },
            after: {
              value: form.afterValue,
              capturedAt: form.afterCapturedAt,
              screenshotPath: form.afterScreenshotPath,
            },
            readback: {
              verified: form.readbackVerified,
              method: 'Ads UI reload',
              readAt: form.readbackReadAt,
              actualValue: form.readbackActualValue,
              evidencePath: form.readbackEvidencePath,
            },
            execution: {
              success: form.executionSuccess,
              verified: form.executionVerified,
              executionId: form.executionId,
              executedAt: form.executionExecutedAt,
              channel: 'manual_ads_ui',
              executedBy: form.executedBy,
              appExecutorUsed: false,
            },
          },
        }), undefined, () => Boolean(
          activeExportRequestRef.current
          && canPublishReadbackResult(request, activeExportRequestRef.current)
        ));
        if (!activeExportRequestRef.current || !canPublishReadbackResult(request, activeExportRequestRef.current)) return;
        setExportResult(result || null);
        setSessionResult(null);
        setSessionCheck(null);
        setSessionFillResult(null);
        setSessionVerifyResult(null);
        setMessage(result?.readyForVerifier ? '回读证据已导出，字段完整，等待最终验收。' : '回读证据已导出，但仍存在缺失项，不能作为最终就绪证据。');
        return result;
      } catch (caught) {
        if (activeExportRequestRef.current && canPublishReadbackResult(request, activeExportRequestRef.current)) {
          setMessage(readbackErrorMessage(caught, '导出回读证据失败。'));
        }
      }
    };
    return options.withinActiveAction ? task() : runWorkspaceAction('export-evidence', task);
  }

export async function verifyReadbackEvidenceReadbackPageAction(this: ReadbackPageActionContext,
  options: { evidencePath?: string; withinActiveAction?: boolean } = {}): Promise<any> {
  const {
    captureReadbackContext,
    authority,
    setCopyNotice,
    exportRoute,
    sessionFillResult,
    verifyRequestIdRef,
    queryKey,
    formEpochRef,
    activeVerifyRequestRef,
    setSessionVerifyResult,
    setActiveStep,
    setMessage,
    runWorkspaceAction,
  } = this;

    if (!authority.capabilities.verifyEvidence) {
      setCopyNotice('仅开发预览为只读布局，不能运行真实回读校验，也不代表正式交付就绪。');
      return;
    }
    const evidencePath = options.evidencePath || (exportRoute.kind === 'direct-verify'
      ? exportRoute.evidencePath
      : sessionFillResult?.jsonPath);
    if (!evidencePath) {
      setCopyNotice(exportRoute.kind === 'prepare-session'
        ? '请先补齐工作包并生成回读证据，再运行最终校验。'
        : '请先导出当前已批准动作的回读证据，再运行最终校验。');
      return;
    }
    const task = async () => {
      const request: ReadbackRequestSnapshot = {
        contextCurrent: captureReadbackContext(),
        kind: 'verify',
        requestId: ++verifyRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeVerifyRequestRef.current = request;
      try {
        const verifyAdReadbackEvidence = (window as any).electronAPI?.verifyAdReadbackEvidence;
        if (typeof verifyAdReadbackEvidence !== 'function') {
          throw new Error('回读证据校验接口未暴露。');
        }
        const result = await runReadbackWorkflowMutation<any>(
          'verify',
          () => verifyAdReadbackEvidence({ evidencePath }),
          undefined,
          () => Boolean(
            activeVerifyRequestRef.current
            && canPublishReadbackResult(request, activeVerifyRequestRef.current)
          ),
        );
        if (!activeVerifyRequestRef.current || !canPublishReadbackResult(request, activeVerifyRequestRef.current)) return;
        setSessionVerifyResult(result || null);
        if (readbackVerifierPassed(result)) {
          setActiveStep('verify-export');
          setMessage(null);
          setCopyNotice('最终证据已校验通过。');
        } else {
          setCopyNotice('回读证据校验未通过。');
        }
        return result;
      } catch (caught) {
        if (activeVerifyRequestRef.current && canPublishReadbackResult(request, activeVerifyRequestRef.current)) {
          setCopyNotice(readbackErrorMessage(caught, '校验回读证据失败。'));
        }
      }
    };
    return options.withinActiveAction ? task() : runWorkspaceAction('verify-evidence', task);
  }

export async function runFinalVerificationReadbackPageAction(this: ReadbackPageActionContext): Promise<void> {
  const {
    captureReadbackContext,
    authority,
    setCopyNotice,
    activateReadbackStep,
    runWorkspaceAction,
    finalRequestIdRef,
    queryKey,
    formEpochRef,
    activeFinalRequestRef,
    setMessage,
    exportEvidence,
    verifyReadbackEvidence,
    setTechnicalInspectorOpen,
  } = this;

    if (!authority.capabilities.exportEvidence || !authority.capabilities.verifyEvidence) {
      setCopyNotice('仅开发预览为只读布局，不能运行真实回读校验，也不代表正式交付就绪。');
      return;
    }
    activateReadbackStep('verify-export');
    await runWorkspaceAction('final-verification', async () => {
      const request: ReadbackRequestSnapshot = {
        contextCurrent: captureReadbackContext(),
        kind: 'final',
        requestId: ++finalRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeFinalRequestRef.current = request;
      setMessage('正在绑定当前已批准动作并导出权威回读证据...');
      setCopyNotice(null);
      try {
        await runCurrentReadbackFinalVerification(
          () => runReadbackFinalVerificationWorkflow({
            exportEvidence: async () => {
              const result = await exportEvidence({ withinActiveAction: true });
              if (!result) throw new Error('导出结果已过期或为空，请重新运行最终校验。');
              return result;
            },
            verifyEvidence: async (evidencePath) => {
              const result = await verifyReadbackEvidence({ evidencePath, withinActiveAction: true });
              if (!result) throw new Error('校验结果已过期或为空，请重新运行最终校验。');
              return result;
            },
          }),
          () => Boolean(
            activeFinalRequestRef.current
            && canPublishReadbackResult(request, activeFinalRequestRef.current)
          ),
          (outcome) => {
            if (outcome.kind === 'verification-result') {
              const passed = readbackVerifierPassed(outcome.verifyResult);
              setMessage(passed
                ? '最终校验通过：权威动作、现场证据和回读结果一致。'
                : '最终校验未通过，请按校验缺口修复后重试。');
              if (!passed) setTechnicalInspectorOpen(true);
              return;
            }
            if (outcome.kind === 'needs-work') {
              setMessage('证据仍需补齐；请在技术详情中创建工作包补证，系统不会自动代填。');
              setTechnicalInspectorOpen(true);
              return;
            }
            setMessage('导出合同不一致，已停止校验；请刷新当前已批准动作后重试。');
            setTechnicalInspectorOpen(true);
          },
        );
      } catch (caught) {
        if (activeFinalRequestRef.current && canPublishReadbackResult(request, activeFinalRequestRef.current)) {
          setMessage(readbackErrorMessage(caught, '运行最终校验失败。'));
          setTechnicalInspectorOpen(true);
        }
      }
    });
  }
