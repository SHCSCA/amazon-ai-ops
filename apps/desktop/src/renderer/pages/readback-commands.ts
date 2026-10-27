import {
  type ReadbackFormState,
} from "./readback-contracts";
import {
  formatCaptureMissing,
} from "./readback-capture";

export function sessionCheckCopy(sessionCheck: Record<string, any> | null): { className: string; title: string; detail: string } {
  if (!sessionCheck) {
    return {
      className: 'readback-session-check-blocked',
      title: '工作包尚未检查',
      detail: '请先创建回读工作包。',
    };
  }
  if (!sessionCheck.ready) {
    return {
      className: 'readback-session-check-blocked',
      title: '工作包结构检查未通过',
      detail: '先修复目录、清单、定位单或输出路径问题，再进行真实广告后台采集。',
    };
  }
  if (!sessionCheck.captureReady) {
    const missing = formatCaptureMissing(sessionCheck);
    return {
      className: 'readback-session-check-blocked',
      title: '工作包结构通过，现场证据待填写',
      detail: missing ? `还需填写：${missing}` : '填写文件尚未完成现场审批、执行前、执行后、执行和回读字段。',
    };
  }
  return {
    className: 'readback-session-check-ready',
    title: '工作包结构和现场证据均已通过',
    detail: '可以生成回读证据；最终可交付仍以本地校验和最终验收汇总为准。',
  };
}

export function psQuote(value: string): string {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

export function defaultPassEvidencePath(sourcePath: string): string {
  if (!sourcePath.trim()) return 'output\\codex-evidence\\real-ad-execution-readback-pass.json';
  return sourcePath.replace(/\.json$/i, '-pass.json');
}

export function defaultSessionDir(sourcePath: string): string {
  if (!sourcePath.trim()) return 'output\\codex-evidence\\ad-readback-session';
  return sourcePath.replace(/\.json$/i, '-session');
}

export function buildFillAdReadbackCommand(form: ReadbackFormState, sourcePath: string, outPath = defaultPassEvidencePath(sourcePath)): string {
  const args = [
    ['--source', sourcePath],
    ['--out', outPath],
    ['--approver-name', form.approverName],
    ['--approval-artifact', form.approvalArtifactPath],
    ['--approval-confirmed-at', form.approvalConfirmedAt],
    ['--before-value', form.beforeValue],
    ['--before-captured-at', form.beforeCapturedAt],
    ['--before-screenshot', form.beforeScreenshotPath],
    ['--live-bid-source-note', form.liveBidSourceNote],
    ['--after-value', form.afterValue],
    ['--after-captured-at', form.afterCapturedAt],
    ['--after-screenshot', form.afterScreenshotPath],
    ['--executed-at', form.executionExecutedAt],
    ['--executed-by', form.executedBy],
    ['--execution-id', form.executionId],
    ['--readback-read-at', form.readbackReadAt],
    ['--readback-evidence', form.readbackEvidencePath],
    ['--readback-actual-value', form.readbackActualValue],
    ['--risk-rationale', form.riskRationale],
  ].filter(([, value]) => String(value || '').trim());
  return `pnpm run fill:ad-readback -- ${args.map(([key, value]) => `${key} ${psQuote(String(value))}`).join(' ')}`;
}

export function buildPrepareAdReadbackSessionCommand(sourcePath: string, sessionDir = defaultSessionDir(sourcePath)): string {
  return `pnpm run prepare:ad-readback-session -- --source ${psQuote(sourcePath)} --out ${psQuote(sessionDir)}`;
}

export function buildVerifyAdReadbackSessionCommand(sourcePath: string, sessionDir = defaultSessionDir(sourcePath)): string {
  return `pnpm run verify:ad-readback-session -- ${psQuote(sessionDir)}`;
}

export function buildFillAdReadbackSessionCommand(sourcePath: string, sessionDir = defaultSessionDir(sourcePath)): string {
  return `pnpm run fill:ad-readback-session -- --session ${psQuote(sessionDir)}`;
}

export function readbackSessionWorkflow(sourcePath?: string) {
  const sessionDir = sourcePath ? defaultSessionDir(sourcePath) : '导出回读证据后自动生成';
  return {
    sessionDir,
    steps: [
      '创建单动作工作包，得到操作清单、填写文件和截图目录。',
      '按操作清单在广告后台确认同一店铺、站点、广告活动、广告组、ASIN、对象和动作。',
      '把审批凭证放入审批目录，把执行前截图放入执行前截图目录。',
      '人工完成一次低风险动作后，把执行后截图放入执行后截图目录。',
      '刷新广告后台回读真实值，把回读截图放入回读截图目录。',
      '填写现场信息后生成可进入最终验收的回读证据。',
    ],
    warning: '检查工作包只证明目录和文件结构安全，不等于最终验收通过；最终仍以生成后的回读证据校验和最终验收汇总为准。',
  };
}

export function readbackSessionSummary(sourcePath?: string): string {
  if (!sourcePath?.trim()) return '先导出回读证据，再创建工作包。';
  return '创建工作包后，按清单补审批、执行前、执行后和回读截图。';
}
