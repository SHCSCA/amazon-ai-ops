import {
  readbackErrorMessage,
} from "./readback-feedback";
import {
  buildFillAdReadbackCommand,
  buildPrepareAdReadbackSessionCommand,
  buildVerifyAdReadbackSessionCommand,
  buildFillAdReadbackSessionCommand,
} from "./readback-commands";
import {
  type ReadbackPageActionContext,
} from "./readback-ports";

export async function copyFillCommandReadbackPageAction(this: ReadbackPageActionContext): Promise<void> {
  const {
    exportResult,
    setCopyNotice,
    runWorkspaceAction,
    setActiveCopyCommand,
    form,
  } = this;

    const sourcePath = exportResult?.jsonPath;
    if (!sourcePath) {
      setCopyNotice('请先导出回读证据，再复制备用命令。');
      return;
    }
    await runWorkspaceAction('copy-command', async () => {
      setActiveCopyCommand('long-fill');
      setCopyNotice('正在复制长参数生成命令...');
      try {
        await navigator.clipboard.writeText(buildFillAdReadbackCommand(form, sourcePath));
        setCopyNotice('长参数生成命令已复制。');
      } catch (caught) {
        setCopyNotice(readbackErrorMessage(caught, '复制生成命令失败。'));
      } finally {
        setActiveCopyCommand(null);
      }
    });
  }

export async function copySessionCommandReadbackPageAction(this: ReadbackPageActionContext,
  kind: 'prepare' | 'verify' | 'fill'): Promise<void> {
  const {
    exportResult,
    setCopyNotice,
    runWorkspaceAction,
    setActiveCopyCommand,
  } = this;

    const sourcePath = exportResult?.jsonPath;
    if (!sourcePath) {
      setCopyNotice('请先导出回读证据，再复制工作包命令。');
      return;
    }
    const builders = {
      prepare: buildPrepareAdReadbackSessionCommand,
      verify: buildVerifyAdReadbackSessionCommand,
      fill: buildFillAdReadbackSessionCommand,
    };
    const labels = {
      prepare: '创建工作包命令已复制。',
      verify: '检查工作包命令已复制。',
      fill: '生成回读证据命令已复制。',
    };
    const runningLabels = {
      prepare: '正在复制创建工作包命令...',
      verify: '正在复制检查工作包命令...',
      fill: '正在复制生成回读证据命令...',
    };
    await runWorkspaceAction('copy-command', async () => {
      setActiveCopyCommand(kind);
      setCopyNotice(runningLabels[kind]);
      try {
        await navigator.clipboard.writeText(builders[kind](sourcePath));
        setCopyNotice(labels[kind]);
      } catch (caught) {
        setCopyNotice(readbackErrorMessage(caught, '复制工作包命令失败。'));
      } finally {
        setActiveCopyCommand(null);
      }
    });
  }
