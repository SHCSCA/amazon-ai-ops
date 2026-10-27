import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { loadWithAccessiblePort } = require('./v16-ui-accessible-test-loader.cjs');
const native = loadWithAccessiblePort('./v16-ui-nvda-native-keys.js');

const cases = ['success', 'sequential', 'wrong-role', 'focus-not-final', 'keys-not-complete', 'sequence', 'node-nonce', 'nonce',
  'unknown', 'wrong-action', 'expired', 'over-budget', 'modifier-disabled', 'modifier-extra', 'modifier-bool', 'layout', 'injected',
  'config-error', 'config-late', 'enum', 'held-insert', 'held-control', 'foreground', 'birth', 'desktop',
  'partial-0', 'partial-1', 'partial-2', 'partial-3', 'owner-after-down', 'expired-after-down', 'stop-after-down', 'stop-priority',
  'repeat', 'repeat-new-nonce', 'cleanup-send-failure', 'cleanup-query-failure'];

async function execute(scenario) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-report-focus-model-'));
  const args = ['-B', path.resolve('scripts/v16-nvda-report-focus-model.py'), directory,
    path.resolve('scripts/v16-nvda-speech-observer.py'), scenario, path.resolve('scripts/v16-nvda-observer-test-harness.py')];
  const host = { scenario, args, startedAt: new Date().toISOString(), events: [] };
  let stdout = '', stderr = '';
  await new Promise(resolve => {
    const child = spawn('python', args, { windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', bytes => { stdout += bytes.toString('utf8'); });
    child.stderr.on('data', bytes => { stderr += bytes.toString('utf8'); });
    child.once('spawn', () => { host.pid = child.pid; host.events.push({ type: 'spawn', pid: child.pid }); });
    child.once('error', error => { host.error = { name: error.name, message: error.message }; host.events.push({ type: 'error' }); });
    child.once('exit', (code, signal) => host.events.push({ type: 'exit', code, signal }));
    child.once('close', (code, signal) => { Object.assign(host, { code, signal, finishedAt: new Date().toISOString() });
      host.events.push({ type: 'close', code, signal }); resolve(); });
  });
  fs.writeFileSync(path.join(directory, 'MODEL-HOST.json'), JSON.stringify(host, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, 'MODEL-stdout.txt'), stdout);
  fs.writeFileSync(path.join(directory, 'MODEL-stderr.txt'), stderr);
  expect(host.error).toBeUndefined(); expect(host.events.map(row => row.type)).toEqual(['spawn', 'exit', 'close']);
  expect(host.code, stderr).toBe(0); expect(host.signal).toBeNull();
  const result = JSON.parse(stdout); expect(result.pid).toBe(host.pid); return result;
}

function receipt() {
  const startedAt = '2020-01-01T00:00:00.000Z', phaseStartedAt = '2020-01-01T00:00:01.000Z';
  const binding = { runToken: '22222222-2222-4222-8222-222222222222', main: { pid: 1234,
    handleCreationTimeUtc: '2020-01-01T00:00:00.1234567Z' }, window: { rootHwnd: '1000' } };
  const node = { sequence: 9, nonce: '44444444-4444-4444-8444-444444444444', nodeId: 'dialog-9', role: 'dialog',
    name: '技术与证据详情', startedAt, deadlineAt: '2020-01-01T00:00:10.000Z' };
  const request = { kind: 'nvda-owned-native-keys-request', schemaVersion: 1, runToken: binding.runToken, pid: 789,
    nonce: '33333333-3333-4333-8333-333333333333', nodeSequence: node.sequence, nodeNonce: node.nonce, nodeId: node.nodeId,
    phase: 'report-focus', focusMode: 'named-dialog-container', action: 'ReportFocus', phaseStartedAt, startedAt, deadlineAt: node.deadlineAt };
  const held = [], owner = () => ({ mainPid: 1234, mainAlive: true, handleCreationTimeUtc: binding.main.handleCreationTimeUtc,
    mainExeMatches: true, rootHwnd: '1000', activeHwnd: '1000', focusHwnd: '1001', focusOwnerPid: 1234,
    focusAncestorHwnd: '1000', inputDesktopMatched: true, otherInputReleased: true, heldKeys: [...held] });
  const steps = [[45, 1], [9, 0], [9, 2], [45, 3]].map(([key, flags], index) => {
    const step = { index, key, flags, accepted: 1, proof: owner(), beforeInputAt: phaseStartedAt, timestamp: phaseStartedAt };
    if ((flags & 2) === 0) held.push(key); else held.splice(held.indexOf(key), 1);
    return step;
  });
  const ack = { ...request, observedAt: '2020-01-01T00:00:02.000Z', modifierEvidence: {
    kind: 'nvda-report-focus-modifier', schemaVersion: 1, source: 'nvda.config.conf', keyboardLayout: 'desktop',
    modifierKeys: 4, extendedInsertMask: 4, handleInjectedKeys: true }, result: { passed: true, reason: 'COMPLETE',
    requestedEvents: 4, acceptedEvents: 4, sendInputCalls: 4, steps, afterProof: owner(), cleanupOnly: false,
    cleanupAttempted: false, cleanupAcceptedEvents: 0, cleanupKeys: [], cleanupKeysReleased: true, cleanupErrors: [], atomicTargetGuarantee: false } };
  return { binding, node, artifact: { kind: 'v16-nvda-native-keys', schemaVersion: 1, formalCredit: false,
    inputAcceptanceOnly: true, request, ack }, execution: { startedAt, finishedAt: '2020-01-01T00:00:03.000Z' } };
}

describe('固定NVDA用户当前焦点朗读只授本次原生输入', () => {
  it.each(cases)('真实Python生产场景 %s 保留owner/10秒/STOP和逐事件回收', async scenario => {
    const result = await execute(scenario);
    expect(result).toMatchObject({ isolatedModel: true, actualSourceExecuted: true, scenario, inputSent: false,
      actualNvdaCredit: false, speechStateUnchanged: true, ownerHandleClosed: true });
    expect(result.accepted).toBe(['success', 'repeat', 'repeat-new-nonce'].includes(scenario));
  });
  it('离线专用复验以原执行时窗检查固定动作且不读当前壁钟', () => {
    const value = receipt();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('不得读取当前壁钟'); });
    try { expect(native.validateReportFocusInputReceipt(value.artifact, value.binding, value.node, 789, value.execution)).toBe(value.artifact); }
    finally { clock.mockRestore(); }
    expect(() => native.validateNativeKeysAck(value.artifact.ack, value.artifact.request, value.binding)).toThrow('ACK_EXPIRED');
  });
  it('各步单独合法但跨步时间倒退仍拒绝', () => {
    const value = receipt();
    value.artifact.ack.result.steps[0].timestamp = '2020-01-01T00:00:01.500Z';
    expect(() => native.validateReportFocusInputReceipt(value.artifact, value.binding, value.node, 789, value.execution))
      .toThrow('UI_NVDA_REPORT_INPUT_SEQUENCE_INVALID');
  });
  it.each(['kind', 'credit', 'input-only', 'unknown', 'action', 'mode', 'phase', 'reader', 'token', 'node', 'node-nonce',
    'reused-nonce', 'deadline', 'execution-start', 'execution-end', 'observed', 'modifier', 'modifier-source', 'layout', 'injected',
    'missing-modifier', 'extra-modifier', 'not-extended', 'wrong-keyup', 'held', 'owner', 'cleanup', 'partial', 'atomic', 'step-time'])(
    '拒绝%s而不把旧ACK或清理当作固定用户gesture', scenario => {
      const value = receipt(), a = value.artifact, r = a.request, ack = a.ack;
      const changes = {
        kind: () => { a.kind = 'other'; }, credit: () => { a.formalCredit = true; }, 'input-only': () => { a.inputAcceptanceOnly = false; },
        unknown: () => { a.extra = true; }, action: () => { r.action = ack.action = 'Tab'; }, mode: () => { r.focusMode = ack.focusMode = 'sequential'; },
        phase: () => { r.phase = ack.phase = 'target-focus'; }, reader: () => { r.pid = ack.pid = 1234; },
        token: () => { r.runToken = ack.runToken = 'foreign'; }, node: () => { r.nodeId = ack.nodeId = 'other'; },
        'node-nonce': () => { r.nodeNonce = ack.nodeNonce = r.nonce; }, 'reused-nonce': () => { r.nonce = ack.nonce = r.nodeNonce; },
        deadline: () => { r.deadlineAt = ack.deadlineAt = value.node.deadlineAt = '2020-01-01T00:00:11.000Z'; },
        'execution-start': () => { value.execution.startedAt = '2019-12-31T23:59:59.999Z'; },
        'execution-end': () => { value.execution.finishedAt = '2020-01-01T00:00:10.001Z'; },
        observed: () => { ack.observedAt = '2020-01-01T00:00:00.999Z'; }, modifier: () => { ack.modifierEvidence.modifierKeys = 6; },
        'modifier-source': () => { ack.modifierEvidence.source = 'assumed'; }, layout: () => { ack.modifierEvidence.keyboardLayout = 'laptop'; },
        injected: () => { ack.modifierEvidence.handleInjectedKeys = false; }, 'missing-modifier': () => { delete ack.modifierEvidence; },
        'extra-modifier': () => { ack.modifierEvidence.extra = true; }, 'not-extended': () => { ack.result.steps[0].flags = 0; },
        'wrong-keyup': () => { ack.result.steps[3].flags = 2; }, held: () => { ack.result.steps[1].proof.heldKeys = []; },
        owner: () => { ack.result.afterProof.focusOwnerPid = 9999; }, cleanup: () => { ack.result.cleanupOnly = true; },
        partial: () => { ack.result.acceptedEvents = 3; }, atomic: () => { ack.result.atomicTargetGuarantee = true; },
        'step-time': () => { ack.result.steps[1].beforeInputAt = '2020-01-01T00:00:00.999Z'; },
      };
      changes[scenario]();
      expect(() => native.validateReportFocusInputReceipt(a, value.binding, value.node, 789, value.execution)).toThrow(/UI_NVDA_/);
    });
});

it('生产语音证据校验依赖图只包含纯按键合同，不引入键盘执行或AX采集', () => {
  const desktopRequire = createRequire(path.resolve('apps/desktop/package.json'));
  const built = desktopRequire('esbuild').buildSync({ entryPoints: [require.resolve('./v16-nvda-provider-binding.js')],
    bundle: true, platform: 'node', write: false, metafile: true, logLevel: 'silent' });
  const names = Object.keys(built.metafile.inputs).map(file => path.basename(file));
  expect(names.filter(file => ['v16-ui-nvda-native-keys.js', 'v16-ui-accessible-node.js', 'v16-ui-ax-identity.js'].includes(file))).toEqual([]);
  expect(names.filter(file => file === 'v16-nvda-native-keys-contract.js')).toHaveLength(1);
});
