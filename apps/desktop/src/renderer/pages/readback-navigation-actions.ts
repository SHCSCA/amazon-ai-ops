import { type ReadbackRepairAction } from './readback-workspace-model';
import {
  readbackPathActionKey,
  readbackErrorMessage,
} from "./readback-feedback";
import {
  type ReadbackPageActionContext,
} from "./readback-ports";

export async function openReadbackPathReadbackPageAction(this: ReadbackPageActionContext,
  targetPath?: string,
  label = '打开路径'): Promise<void> {
  const {
    setCopyNotice,
    runWorkspaceAction,
    setActivePathKey,
  } = this;

    if (!targetPath) return;
    const openReportPath = (window as any).electronAPI?.openReportPath;
    if (typeof openReportPath !== 'function') {
      setCopyNotice(`${label}不可用：当前安全版本未提供路径打开能力，请按界面显示的工作包路径手动打开。`);
      return;
    }
    const key = readbackPathActionKey(label, targetPath);
    await runWorkspaceAction('open-path', async () => {
      setActivePathKey(key);
      setCopyNotice(`${label}打开中...`);
      try {
        await openReportPath(targetPath);
        setCopyNotice(`${label}已请求打开。`);
      } catch (caught) {
        setCopyNotice(readbackErrorMessage(caught, `${label}打开失败。`));
      } finally {
        setActivePathKey(null);
      }
    });
  }

export async function openExportReadbackPageAction(this: ReadbackPageActionContext): Promise<void> {
  const {
    openReadbackPath,
    exportOpenPath,
  } = this;

    await openReadbackPath(exportOpenPath, '打开导出文件');
  }

export async function openSessionPacketReadbackPageAction(this: ReadbackPageActionContext): Promise<void> {
  const {
    openReadbackPath,
    sessionResult,
  } = this;

    await openReadbackPath(sessionResult?.sessionDir, '打开工作包');
  }

export async function openSessionInputFileReadbackPageAction(this: ReadbackPageActionContext): Promise<void> {
  const {
    openReadbackPath,
    sessionResult,
  } = this;

    await openReadbackPath(sessionResult?.sessionInputPath, '打开填写文件');
  }

export async function openSessionInputGuideReadbackPageAction(this: ReadbackPageActionContext): Promise<void> {
  const {
    openReadbackPath,
    sessionResult,
  } = this;

    await openReadbackPath(sessionResult?.sessionInputGuidePath, '打开填写说明');
  }

export function focusRepairTargetReadbackPageAction(this: ReadbackPageActionContext,
  action: ReadbackRepairAction): void {
  const {
    activateReadbackStep,
  } = this;

    activateReadbackStep(action.stepId);
    const focusTarget = () => {
      const target = document.getElementById(action.focusTarget);
      const reducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
      target?.focus({ preventScroll: true });
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focusTarget);
      return;
    }
    focusTarget();
  }

export function activateRepairActionReadbackPageAction(this: ReadbackPageActionContext,
  action: ReadbackRepairAction): void {
  const {
    focusRepairTarget,
    runFinalVerification,
  } = this;

    focusRepairTarget(action);
    if (action.blocker === 'verification') void runFinalVerification();
  }
