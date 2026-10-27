import { describe, expect, it, vi } from 'vitest';
import integrity from './v16-ui-software-integrity.js';

function inspect(readers = {}) {
  const report = { issues: [] }, before = { source: { sha: 'source' }, packageIdentity: { sha: 'package' }, canonical: { sha: 'data' } };
  const writer = { log: vi.fn() };
  integrity.inspectFinalIdentity(report, before, { source: () => before.source, packageIdentity: () => before.packageIdentity,
    canonical: () => before.canonical, ...readers }, writer);
  return { report, writer };
}
describe('software native capture currentness and runtime failures', () => {
  it('requires all three independently read identities to remain unchanged', () => {
    expect(inspect().report).toEqual({ issues: [], sourceUnchanged: true, packageUnchanged: true, canonicalDataUnchanged: true });
  });
  it('rejects a replaced ignored release even while tracked source remains unchanged', () => {
    const { report } = inspect({ packageIdentity: () => ({ sha: 'different-package' }) });
    expect(report.sourceUnchanged).toBe(true); expect(report.packageUnchanged).toBe(false);
    expect(report.issues).toEqual([{ code: 'UI_SOFTWARE_PACKAGE_CHANGED_DURING_RUN' }]);
  });
  it('keeps checking canonical data after package validation throws and preserves both failures', () => {
    const { report, writer } = inspect({ packageIdentity: () => { throw new Error('archive changed'); }, canonical: () => ({ sha: 'changed-data' }) });
    expect(report.packageUnchanged).toBe(false); expect(report.canonicalDataUnchanged).toBe(false);
    expect(report.issues).toHaveLength(2); expect(writer.log).toHaveBeenCalledWith('v16.ui_software_final_identity_failed', expect.any(Error), { field: 'packageUnchanged' });
  });
  it('allows only the exact observed recovery records once and rejects extra IPC or nested worker errors', () => {
    const expected = { timestamp: '2026-10-17T00:00:00Z', level: 'error', event: 'ipc.handler_failed', context: { channel: 'mission-domain:causal:list-events', error: { message: 'no such table: causal_events' } } };
    const unrelated = { level: 'error', event: 'ipc.handler_failed', context: { channel: 'stores:list', error: { message: 'unrelated' } } };
    const worker = { level: 'warn', event: 'delivery.worker_diagnostic', context: { diagnostic: { level: 'error', event: 'worker.failed', context: { message: 'failed' } } } };
    expect(integrity.inspectRuntimeLogFailures([expected], [expected])).toEqual({ unexpected: [], missingOrRepeatedExpected: [] });
    expect(integrity.inspectRuntimeLogFailures([expected, unrelated, worker], [expected]).unexpected).toEqual([unrelated, worker]);
    expect(integrity.inspectRuntimeLogFailures([expected, expected], [expected]).missingOrRepeatedExpected).toEqual([{ sha256: expect.any(String), count: 2 }]);
    expect(integrity.inspectRuntimeLogFailures([], [expected]).missingOrRepeatedExpected).toEqual([{ sha256: expect.any(String), count: 0 }]);
  });
  it('retains legacy nested diagnostic error objects without mistaking informational messages for faults', () => {
    expect(integrity.failureRecord({ level: 'warn', diagnostic: { error: { message: 'failure' } } })).toBe(true);
    expect(integrity.failureRecord({ level: 'info', context: { error: null, message: '没有错误' } })).toBe(false);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import softwareMatrix from './v16-ui-software-matrix.js';

function isolatedMatrixSettlePorts(mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-matrix-settle-unit-'));
  const events = [], records = [], screenshots = [], errors = [];
  let loading = false;
  const ready = phase => ({ passed: true, busyCount: 0, busyLabels: [], minimumWaitMs: 2500,
    sampleCount: 4, stableSamples: 3, textLength: 20, textSha256: phase });
  const runtime = { identity: { pid: 1 }, app: { evaluate: async () => ({ minimum: [900, 600],
    bounds: { width: 1366, height: 768 }, content: [1366, 768], zoom: 1 }) }, page: {
    locator: selector => ({ selector }),
    evaluate: async fn => String(fn).includes('requestAnimationFrame') ? undefined : {
      capturedAt: '2026-10-21T00:00:00.000Z', title: '隔离模型交付页',
      viewport: { width: 1366, height: 768, deviceScaleFactor: 1 },
      controls: [{ tag: 'BUTTON', name: '复制摘要', disabled: loading, busy: false,
        reason: loading ? '正在读取当前店铺的交付状态，请等待完成。' : '', bounds: {} }],
      errorStates: [], focused: { id: 'unit-tab', name: '交付验收' },
    },
  } };
  const writer = { root, json: (name, value) => { records.push(value);
    return { path: path.join(root, name), sha256: '0'.repeat(64), sizeBytes: 0 }; },
  log: (...args) => errors.push(args) };
  const ui = {
    EXPECTED_PACKAGE_UI_ENTRIES: [{ workspace: 'settings', subview: 'delivery' }],
    navigateToWorkspace: async (page, entry, settleMs, options) => {
      events.push({ phase: 'navigate', settleMs, options }); loading = false;
      if (options?.deferSettle !== true) { events.push({ phase: 'settle-before-keyboard' }); return ready('before-keyboard'); }
      return null;
    },
    exerciseWorkspaceTabKeyboard: async () => { events.push({ phase: 'keyboard' }); loading = true; return { passed: true }; },
    waitForWorkspaceSettled: async (page, selector, settleMs) => {
      events.push({ phase: 'settle-after-keyboard', selector, settleMs });
      if (mode === 'blocked') throw new Error('UNIT_MATRIX_PASSIVE_READ_STILL_PENDING');
      loading = false; return ready('after-keyboard');
    },
    waitForRendererComposite: async () => events.push({ phase: 'composite' }),
    captureViewportScreenshot: async (app, file) => {
      events.push({ phase: 'screenshot' }); screenshots.push({ loading });
      fs.writeFileSync(file, 'ISOLATED-UNIT-PORT-NOT-VISUAL-EVIDENCE', { flag: 'wx' });
    },
  };
  return { runtime, writer, ui, events, records, screenshots, errors };
}

describe('software matrix final passive-read settling', () => {
  it('uses one original settling budget after the keyboard restores the actual workspace', async () => {
    const model = isolatedMatrixSettlePorts('complete');
    const result = await softwareMatrix.captureSoftwareMatrix(model.runtime, model.writer,
      { runId: 'ISOLATED-UNIT-ONLY', sourceSha256: '0'.repeat(64) }, model.ui);
    expect(result.issues).toEqual([]); expect(result.results).toHaveLength(4);
    expect(model.events.filter(row => row.phase === 'settle-before-keyboard')).toEqual([]);
    expect(model.events.filter(row => row.phase === 'navigate')).toHaveLength(4);
    expect(model.events.filter(row => row.phase === 'navigate').every(row => row.settleMs === 2500
      && row.options?.deferSettle === true)).toBe(true);
    expect(model.events.filter(row => row.phase === 'settle-after-keyboard')).toHaveLength(4);
    expect(model.events.filter(row => row.phase === 'settle-after-keyboard').every(row => row.settleMs === 2500
      && row.selector.includes('data-workspace-subview="delivery"'))).toBe(true);
    expect(model.events.map(row => row.phase)).toEqual(Array.from({ length: 4 }, () =>
      ['navigate', 'keyboard', 'settle-after-keyboard', 'composite', 'screenshot']).flat());
    expect(model.records.every(row => row.settled.textSha256 === 'after-keyboard')).toBe(true);
    expect(model.screenshots).toEqual(Array.from({ length: 4 }, () => ({ loading: false })));
  });
  it('preserves a final settling refusal instead of capturing a still-loading workspace', async () => {
    const model = isolatedMatrixSettlePorts('blocked');
    const result = await softwareMatrix.captureSoftwareMatrix(model.runtime, model.writer,
      { runId: 'ISOLATED-UNIT-ONLY', sourceSha256: '0'.repeat(64) }, model.ui);
    expect(result.issues).toHaveLength(4);
    expect(result.issues.every(row => row.code === 'UNIT_MATRIX_PASSIVE_READ_STILL_PENDING')).toBe(true);
    expect(result.results.every(row => row.observed === false)).toBe(true);
    expect(model.events.filter(row => row.phase === 'settle-after-keyboard')).toHaveLength(4);
    expect(model.events.filter(row => row.phase === 'settle-before-keyboard')).toEqual([]);
    expect(model.screenshots).toEqual([]); expect(model.records).toEqual([]);
    expect(model.errors).toHaveLength(4);
  });
});
