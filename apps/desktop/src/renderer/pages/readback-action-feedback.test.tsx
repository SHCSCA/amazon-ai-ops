import { readStyleComposition } from '../styles/css-source.test-support';
import { transactionPageSource } from './transaction-page-source.test-support';
import {
  describe,
  expect,
  it,
} from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildFillAdReadbackCommand,
  buildFillAdReadbackSessionCommand,
  buildPrepareAdReadbackSessionCommand,
  buildVerifyAdReadbackSessionCommand,
  captureSlotPatch,
  nextEvidenceCaptureSlot,
  readbackCaptureTargetView,
  readbackActionButtonView,
  readbackCopyCommandButtonView,
  readbackOpenPathButtonView,
  readbackSessionSummary,
  readbackSessionWorkflow,
  sessionCheckCopy,
} from './readback-page';
import {
  completeForm,
} from "./readback-page.test-fixtures";

describe('readbackActionButtonView', () => {
  it('locks evidence workflow peers while only the active readback action shows busy feedback', () => {
    const active = readbackActionButtonView({
      action: 'fill-session',
      activeAction: 'fill-session',
      baseClassName: 'primary-button',
      busyLabel: '生成中...',
      label: '生成回读证据',
    });

    expect(active.label).toBe('生成中...');
    expect(active.disabled).toBe(true);
    expect(active.ariaBusy).toBe(true);
    expect(active.showSpinner).toBe(true);
    expect(active.className).toContain('button-loading');

    const lockedPeer = readbackActionButtonView({
      action: 'verify-evidence',
      activeAction: 'fill-session',
      baseClassName: 'secondary-button',
      busyLabel: '校验中...',
      label: '校验回读证据',
    });

    expect(lockedPeer.label).toBe('校验回读证据');
    expect(lockedPeer.disabled).toBe(true);
    expect(lockedPeer.ariaBusy).toBeUndefined();
    expect(lockedPeer.showSpinner).toBe(false);
    expect(lockedPeer.className).not.toContain('button-loading');
  });
});

describe('readbackCopyCommandButtonView', () => {
  it('gives backup copy-command buttons active feedback and locks copy peers', () => {
    const active = readbackCopyCommandButtonView({
      activeCommand: 'prepare',
      command: 'prepare',
      disabled: false,
      label: '复制创建工作包命令',
    });

    expect(active.label).toBe('复制中...');
    expect(active.disabled).toBe(true);
    expect(active.ariaBusy).toBe(true);
    expect(active.showSpinner).toBe(true);
    expect(active.className).toContain('button-loading');

    const lockedPeer = readbackCopyCommandButtonView({
      activeCommand: 'prepare',
      command: 'verify',
      disabled: false,
      label: '复制检查工作包命令',
    });

    expect(lockedPeer.label).toBe('复制检查工作包命令');
    expect(lockedPeer.disabled).toBe(true);
    expect(lockedPeer.ariaBusy).toBeUndefined();
    expect(lockedPeer.showSpinner).toBe(false);
    expect(lockedPeer.className).not.toContain('button-loading');
  });
});

describe('readbackOpenPathButtonView', () => {
  it('gives readback local path buttons explicit opening feedback and locks peers', () => {
    const active = readbackOpenPathButtonView({
      activePathKey: '打开工作包:C:/session',
      idleLabel: '打开工作包',
      pathKey: '打开工作包:C:/session',
    });

    expect(active.label).toBe('打开中...');
    expect(active.disabled).toBe(true);
    expect(active.ariaBusy).toBe(true);
    expect(active.showSpinner).toBe(true);
    expect(active.className).toContain('button-loading');

    const lockedPeer = readbackOpenPathButtonView({
      activePathKey: '打开工作包:C:/session',
      idleLabel: '打开填写文件',
      pathKey: '打开填写文件:C:/session/session-input.json',
    });

    expect(lockedPeer.label).toBe('打开填写文件');
    expect(lockedPeer.disabled).toBe(true);
    expect(lockedPeer.ariaBusy).toBeUndefined();
    expect(lockedPeer.showSpinner).toBe(false);
    expect(lockedPeer.className).not.toContain('button-loading');
  });
});

describe('readback capture helpers', () => {
  it('maps pasted screenshot paths to the matching evidence field and timestamp', () => {
    expect(captureSlotPatch('before', 'C:/session/screenshots/before/before.png', '2026-06-25T12:00:00.000Z')).toEqual({
      beforeScreenshotPath: 'C:/session/screenshots/before/before.png',
      beforeCapturedAt: '2026-06-25T12:00:00.000Z',
    });
    expect(captureSlotPatch('readback', 'C:/session/screenshots/readback/readback.png', '2026-06-25T12:10:00.000Z')).toEqual({
      readbackEvidencePath: 'C:/session/screenshots/readback/readback.png',
      readbackReadAt: '2026-06-25T12:10:00.000Z',
    });
  });

  it('selects the next missing screenshot slot for global paste capture', () => {
    const form = completeForm();
    form.beforeScreenshotPath = '';
    form.afterScreenshotPath = '';
    form.readbackEvidencePath = '';

    expect(nextEvidenceCaptureSlot(form)).toBe('before');

    form.beforeScreenshotPath = 'C:/session/before.png';
    expect(nextEvidenceCaptureSlot(form)).toBe('after');

    form.afterScreenshotPath = 'C:/session/after.png';
    expect(nextEvidenceCaptureSlot(form)).toBe('readback');

    form.readbackEvidencePath = 'C:/session/readback.png';
    expect(nextEvidenceCaptureSlot(form)).toBe('readback');
  });

  it('builds distinct copy and classes for drop target visual states', () => {
    expect(readbackCaptureTargetView('before')).toMatchObject({
      className: 'readback-capture-target',
      title: '执行前截图',
      helper: '点击此区域后 Ctrl+V，或拖入图片文件',
    });

    expect(readbackCaptureTargetView('before', { dragging: true })).toMatchObject({
      className: expect.stringContaining('readback-capture-dragging'),
      title: '松开即可存证',
      helper: '已识别拖入截图，松开鼠标后写入本地证据目录。',
    });

    const savingView = readbackCaptureTargetView('after', { saving: true, dragging: true });
    expect(savingView).toMatchObject({
      className: expect.stringContaining('readback-capture-saving'),
      title: '正在存证...',
      helper: '正在写入本地证据目录...',
    });
    expect(savingView.className).not.toContain('readback-capture-dragging');

    expect(readbackCaptureTargetView('readback', { value: 'C:/evidence/readback.png' })).toMatchObject({
      className: expect.stringContaining('readback-capture-filled'),
      title: '回读截图已安全固定',
      helper: 'C:/evidence/readback.png',
      preview: {
        alt: '回读截图缩略预览',
        badge: '证据已安全固定',
        fileName: 'readback.png',
        path: 'C:/evidence/readback.png',
      },
    });
  });

  it('keeps the drag-over drop zone animation contract in CSS', () => {
    const stylesheet = readStyleComposition(new URL('../styles.css', import.meta.url));

    expect(stylesheet).toContain('.readback-capture-dragging');
    expect(stylesheet).toContain('readback-capture-marching-ants');
    expect(stylesheet).toContain('readback-capture-breathe');
  });

  it('keeps the fixed screenshot thumbnail and green badge contract in CSS', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');
    const stylesheet = readStyleComposition(new URL('../styles.css', import.meta.url));

    expect(transactionPageSource("readback-capture.tsx")).toContain('readback-capture-fixed-preview');
    expect(transactionPageSource("readback-capture.tsx")).toContain('readback-capture-fixed-badge');
    expect(transactionPageSource("readback-capture.tsx")).toContain('readback-capture-thumbnail');
    expect(stylesheet).toContain('.readback-capture-fixed-preview');
    expect(stylesheet).toContain('.readback-capture-thumbnail');
    expect(stylesheet).toContain('.readback-capture-fixed-badge');
    expect(stylesheet).toContain('var(--tone-ready-bg)');
    expect(transactionPageSource("readback-capture.tsx")).toContain('证据已安全固定');
  });

  it('keeps the active wizard step rail slider contract', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');
    const stylesheet = readStyleComposition(new URL('../styles.css', import.meta.url));

    expect(transactionPageSource("readback-workspace.tsx")).toContain('--readback-active-step');
    expect(transactionPageSource("readback-workspace.tsx")).toContain('--readback-step-count');
    expect(transactionPageSource("readback-view.tsx")).toContain('style={readbackStepRailStyle}');
    expect(stylesheet).toContain('.readback-step-tabs::after');
    expect(stylesheet).toContain('height: 2px');
    expect(stylesheet).toContain('transform: translateX(calc(var(--readback-active-step) * (100% + 6px)))');
    expect(stylesheet).toContain('transition: transform 180ms ease');
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

describe('sessionCheckCopy', () => {
  it('translates backend capture field labels before showing them to operators', () => {
    const copy = sessionCheckCopy({
      ready: true,
      captureReady: false,
      captureMissingFields: [
        { group: '执行前', label: '执行前 Ads UI live bid' },
        { group: '执行后', label: '执行后 Ads UI live bid' },
      ],
    });

    expect(copy.detail).toBe('还需填写：执行前/现场出价、执行后/现场出价');
    expect(copy.detail).not.toContain('Ads UI');
  });
});

describe('buildFillAdReadbackCommand', () => {
  it('builds a quoted fill command from the current form and exported source path', () => {
    const form = completeForm();
    form.approverName = "Ops Owner's Desk";
    form.approvalArtifactPath = 'C:/evidence/approval ticket.png';

    const command = buildFillAdReadbackCommand(
      form,
      'C:/evidence/candidate.json',
      'C:/evidence/readback-pass.json',
    );

    expect(command).toContain('pnpm run fill:ad-readback --');
    expect(command).toContain("--source 'C:/evidence/candidate.json'");
    expect(command).toContain("--out 'C:/evidence/readback-pass.json'");
    expect(command).toContain("--approver-name 'Ops Owner''s Desk'");
    expect(command).toContain("--approval-artifact 'C:/evidence/approval ticket.png'");
    expect(command).toContain("--readback-evidence 'C:/evidence/readback.png'");
    expect(command).not.toContain('undefined');
  });
});

describe('ad readback session command builders', () => {
  it('builds prepare, verify and fill session commands from an exported gap draft path', () => {
    const sourcePath = "C:/evidence/rec 4's gap.json";
    const sessionDir = "C:/evidence/rec 4's gap-session";

    expect(buildPrepareAdReadbackSessionCommand(sourcePath, sessionDir)).toBe(
      "pnpm run prepare:ad-readback-session -- --source 'C:/evidence/rec 4''s gap.json' --out 'C:/evidence/rec 4''s gap-session'",
    );
    expect(buildVerifyAdReadbackSessionCommand(sourcePath, sessionDir)).toBe(
      "pnpm run verify:ad-readback-session -- 'C:/evidence/rec 4''s gap-session'",
    );
    expect(buildFillAdReadbackSessionCommand(sourcePath, sessionDir)).toBe(
      "pnpm run fill:ad-readback-session -- --session 'C:/evidence/rec 4''s gap-session'",
    );
  });

  it('defaults the session folder next to the exported JSON', () => {
    expect(buildPrepareAdReadbackSessionCommand('C:/evidence/readback.json')).toContain(
      "--out 'C:/evidence/readback-session'",
    );
    expect(buildFillAdReadbackSessionCommand('C:/evidence/readback.json')).toContain(
      "--session 'C:/evidence/readback-session'",
    );
  });
});

describe('readbackSessionWorkflow', () => {
  it('summarizes the work package without exposing command names as the primary flow', () => {
    expect(readbackSessionSummary('C:/evidence/readback.json')).toBe('创建工作包后，按清单补审批、执行前、执行后和回读截图。');
    expect(readbackSessionSummary()).toBe('先导出回读证据，再创建工作包。');
  });

  it('explains the operator session packet without claiming final readiness', () => {
    const workflow = readbackSessionWorkflow('C:/evidence/readback.json');

    expect(workflow.sessionDir).toBe('C:/evidence/readback-session');
    expect(workflow.steps.join(' ')).toContain('填写文件');
    expect(workflow.steps.join(' ')).toContain('执行前截图目录');
    expect(workflow.steps.join(' ')).toContain('执行后截图目录');
    expect(workflow.steps.join(' ')).toContain('回读截图目录');
    expect(workflow.warning).toContain('不等于最终验收通过');
    expect(workflow.warning).toContain('最终验收汇总');
    expect(workflow.steps.join(' ')).not.toContain('session-input.json');
    expect(workflow.steps.join(' ')).not.toContain('fill session');
    expect(workflow.steps.join(' ')).not.toContain('readback JSON');
    expect(workflow.warning).not.toContain('manifest');
    expect(workflow.warning).not.toContain('verify:ad-readback');
  });

  it('does not expose a fake session directory before a readback JSON is exported', () => {
    expect(readbackSessionWorkflow().sessionDir).toBe('导出回读证据后自动生成');
  });
});
