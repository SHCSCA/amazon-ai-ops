import {
  canPublishReadbackResult,
  type ReadbackRequestSnapshot,
} from './readback-workspace-model';
import {
  readbackErrorMessage,
  runReadbackWorkflowMutation,
} from "./readback-feedback";
import {
  type ReadbackPageActionContext,
} from "./readback-ports";

export async function prepareSessionPacketReadbackPageAction(this: ReadbackPageActionContext): Promise<void> {
  const {
    captureReadbackContext,
    authority,
    setCopyNotice,
    exportRoute,
    runWorkspaceAction,
    sessionRequestIdRef,
    queryKey,
    formEpochRef,
    activeSessionRequestRef,
    setSessionResult,
    setSessionCheck,
    setSessionFillResult,
    setSessionVerifyResult,
  } = this;

    if (!authority.capabilities.prepareSession) {
      setCopyNotice('仅开发预览为只读布局，不能创建真实回读工作包。');
      return;
    }
    if (exportRoute.kind !== 'prepare-session') {
      setCopyNotice(exportRoute.kind === 'direct-verify'
        ? '当前证据已完整，请直接运行最终校验，无需创建工作包。'
        : '当前导出合同无效，请刷新已批准动作后重新导出。');
      return;
    }
    const sourcePath = exportRoute.sourcePath;
    await runWorkspaceAction('prepare-session', async () => {
      const request: ReadbackRequestSnapshot = {
        contextCurrent: captureReadbackContext(),
        kind: 'session',
        requestId: ++sessionRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeSessionRequestRef.current = request;
      try {
        const result = await (window as any).electronAPI?.prepareAdReadbackSession?.({ sourcePath });
        if (!activeSessionRequestRef.current || !canPublishReadbackResult(request, activeSessionRequestRef.current)) return;
        setSessionResult(result || null);
        setSessionCheck(null);
        setSessionFillResult(null);
        setSessionVerifyResult(null);
        setCopyNotice('回读工作包已创建。');
      } catch (caught) {
        if (activeSessionRequestRef.current && canPublishReadbackResult(request, activeSessionRequestRef.current)) {
          setCopyNotice(readbackErrorMessage(caught, '创建回读工作包失败。'));
        }
      }
    });
  }

export async function verifySessionPacketReadbackPageAction(this: ReadbackPageActionContext): Promise<void> {
  const {
    captureReadbackContext,
    authority,
    setCopyNotice,
    sessionResult,
    runWorkspaceAction,
    sessionRequestIdRef,
    queryKey,
    formEpochRef,
    activeSessionRequestRef,
    setSessionCheck,
  } = this;

    if (!authority.capabilities.verifySession) {
      setCopyNotice('仅开发预览为只读布局，不能检查真实回读工作包。');
      return;
    }
    const sessionDir = sessionResult?.sessionDir;
    if (!sessionDir) {
      setCopyNotice('请先创建回读工作包，再检查工作包。');
      return;
    }
    await runWorkspaceAction('verify-session', async () => {
      const request: ReadbackRequestSnapshot = {
        contextCurrent: captureReadbackContext(),
        kind: 'session',
        requestId: ++sessionRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeSessionRequestRef.current = request;
      try {
        const result = await (window as any).electronAPI?.verifyAdReadbackSession?.({ sessionDir });
        if (!activeSessionRequestRef.current || !canPublishReadbackResult(request, activeSessionRequestRef.current)) return;
        setSessionCheck(result || null);
        if (result?.ready && result?.captureReady) {
          setCopyNotice('工作包结构和现场证据均已通过。');
        } else if (result?.ready) {
          setCopyNotice('工作包结构检查通过，现场证据仍待填写。');
        } else {
          setCopyNotice('工作包结构检查未通过。');
        }
      } catch (caught) {
        if (activeSessionRequestRef.current && canPublishReadbackResult(request, activeSessionRequestRef.current)) {
          setCopyNotice(readbackErrorMessage(caught, '检查回读工作包失败。'));
        }
      }
    });
  }

export async function fillSessionPacketReadbackPageAction(this: ReadbackPageActionContext): Promise<void> {
  const {
    captureReadbackContext,
    authority,
    setCopyNotice,
    sessionResult,
    runWorkspaceAction,
    sessionRequestIdRef,
    queryKey,
    formEpochRef,
    activeSessionRequestRef,
    setSessionFillResult,
    setSessionVerifyResult,
    setSessionCheck,
  } = this;

    if (!authority.capabilities.fillSession) {
      setCopyNotice('仅开发预览为只读布局，不能生成真实回读证据。');
      return;
    }
    const sessionDir = sessionResult?.sessionDir;
    if (!sessionDir) {
      setCopyNotice('请先创建回读工作包，再生成回读证据。');
      return;
    }
    await runWorkspaceAction('fill-session', async () => {
      const request: ReadbackRequestSnapshot = {
        contextCurrent: captureReadbackContext(),
        kind: 'session',
        requestId: ++sessionRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeSessionRequestRef.current = request;
      try {
        const fillAdReadbackSession = (window as any).electronAPI?.fillAdReadbackSession;
        if (typeof fillAdReadbackSession !== 'function') {
          throw new Error('回读证据生成接口未暴露。');
        }
        const result = await runReadbackWorkflowMutation<any>(
          'create',
          () => fillAdReadbackSession({ sessionDir }),
          undefined,
          () => Boolean(
            activeSessionRequestRef.current
              && canPublishReadbackResult(request, activeSessionRequestRef.current)
          ),
        );
        if (!activeSessionRequestRef.current || !canPublishReadbackResult(request, activeSessionRequestRef.current)) return;
        setSessionFillResult(result || null);
        setSessionVerifyResult(null);
        if (result?.readyForVerifier) setSessionCheck(null);
        setCopyNotice(result?.readyForVerifier ? '回读证据已生成，等待最终校验。' : '回读证据仍未就绪。');
      } catch (caught) {
        if (activeSessionRequestRef.current && canPublishReadbackResult(request, activeSessionRequestRef.current)) {
          setCopyNotice(readbackErrorMessage(caught, '生成回读证据失败。'));
        }
      }
    });
  }
