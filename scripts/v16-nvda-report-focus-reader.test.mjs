import { describe, expect, it } from 'vitest';
import readerPorts from './v16-nvda-reader-test-model.cjs';
import provider from './v16-nvda-provider-binding.js';
import { governanceFixture } from './v16-native-ui-governance-fixture.mjs';
import nativeKeys from './v16-ui-nvda-native-keys.js';
import accessible from './v16-ui-accessible-node.js';
import axPorts from './v16-ui-ax-test-model.cjs';

const { readerModel } = readerPorts;
const clone = value => JSON.parse(JSON.stringify(value));
async function captureDialog(options = {}) {
  const f = readerModel(); Object.assign(f, options);
  const reader = await f.open(); f.dialogContainer = true;
  const node = { ...f.node(), role: 'dialog' };
  return { f, reader, node, run: () => reader.capture(f.runtime, f.locator(node), node) };
}
function verification(f, observation, node) {
  const witness = clone(observation.providerWitness), rows = clone(observation.rows);
  const nativeLaunch = clone(f.readArtifact(witness.nativeLaunch));
  const inputReceipt = witness.speechSource.input ? clone(f.readArtifact(witness.speechSource.input)) : undefined;
  const options = { nativeLaunch, readerLaunch: clone(f.launchReceipt()), rawRows: clone(f.rawRows()),
    focusModeReceipt: clone(f.readArtifact(witness.speechSource.focusModeReceipt)), focusModeReceiptRef: clone(witness.speechSource.focusModeReceipt),
    inputReceipt, inputReceiptRef: witness.speechSource.input ? clone(witness.speechSource.input) : undefined,
    expected: { pid: nativeLaunch.identity.pid, packageIdentity: nativeLaunch.packageIdentity,
      nativeLaunchRef: witness.nativeLaunch, readerLaunchRef: witness.readerLaunch, nativeLaunchKind: nativeLaunch.kind },
    execution: { startedAt: witness.request.startedAt, finishedAt: witness.hostAfter.observedAt },
    spoken: rows.map(row => row.spoken).join(' '), seenNonces: new Set(), sequenceState: new Map() };
  return { witness, rows, node: clone(node), options, verify: () => provider.validateProviderObservation(witness, rows, node, options) };
}

describe('具名容器固定原生朗读与原自动路径显式分流', () => {
  it('无显式role的原生BUTTON仍从同次真实AX给出canonical模式角色', async () => {
    const f = axPorts.axModel(); f.role = 'button'; delete f.target.attrs.role;
    const node = await accessible.describeAccessibleElement(f.locator, 'unit-node');
    const before = f.calls.length;
    const mode = await nativeKeys.readNativeFocusMode(f.locator, node, f.options());
    expect(mode.mode).toBe('sequential'); expect(mode.node.role).toBe('button');
    expect(f.calls.slice(before).filter(row => row.method === 'Accessibility.getPartialAXTree')).toHaveLength(2);
  });
  it('实际AX角色变化或声明role冲突仍由原身份与语义门拒绝', async () => {
    const f = axPorts.axModel(); f.role = 'button'; delete f.target.attrs.role;
    const node = await accessible.describeAccessibleElement(f.locator, 'unit-node');
    f.role = 'checkbox';
    await expect(nativeKeys.readNativeFocusMode(f.locator, node, f.options())).rejects.toThrow(/UI_(AX_|NVDA_PROVIDER_CURRENT_DOM_)/);
    const conflict = axPorts.axModel(); conflict.role = 'button'; conflict.target.attrs.role = 'tab';
    await expect(accessible.describeAccessibleElement(conflict.locator, 'unit-node')).rejects.toThrow('UI_AX_SEMANTIC_ROLE_MISMATCH');
  });
  it('顺序节点仍仅Tab和ShiftTab且原自动公告来源可离线复验', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node();
    try {
      const result = await reader.capture(f.runtime, f.locator(node), node);
      expect(f.nativeKeysRequests.map(row => row.action)).toEqual(['Tab', 'ShiftTab']);
      expect(result.providerWitness.speechSource).toMatchObject({ schemaVersion: 'v16.nvda-report-focus/1',
        method: 'automatic-focus-announcement', focusMode: 'sequential', input: null, focusBefore: null });
      expect(verification(f, result, node).verify().spoken).toContain(node.name);
    } finally { await reader.close(); }
  });
  it('dialog四焦点阶段后固定一次ReportFocus，收据与原raw各自独立', async () => {
    const { f, reader, node, run } = await captureDialog();
    try {
      const result = await run(), source = result.providerWitness.speechSource;
      expect(f.focusRequests.map(row => row.phase)).toEqual(['first-focus', 'tab', 'target-handoff', 'target-focus']);
      expect(f.nativeKeysRequests.map(row => row.action)).toEqual(['Tab', 'ShiftTab', 'ReportFocus']);
      expect(f.focusCounts(node)).toBe(2);
      expect(f.protocolEvents.indexOf('native-report-focus')).toBeGreaterThan(f.protocolEvents.indexOf('focus-ack-target-focus'));
      expect(f.protocolEvents).not.toContain('native-dom-ReportFocus');
      expect(source).toMatchObject({ method: 'nvda-report-current-focus', focusMode: 'named-dialog-container' });
      const input = f.readArtifact(source.input);
      expect(input.inputAcceptanceOnly).toBe(true);
      expect(input.ack.result.steps.map(row => [row.key, row.flags])).toEqual([[45, 1], [9, 0], [9, 2], [45, 3]]);
      expect(input.ack.modifierEvidence).toEqual({ kind: 'nvda-report-focus-modifier', schemaVersion: 1,
        source: 'nvda.config.conf', keyboardLayout: 'desktop', modifierKeys: 4, extendedInsertMask: 4, handleInjectedKeys: true });
      expect(result.rows.every(row => Date.parse(row.timestamp) >= Date.parse(source.focusBefore.observedAt))).toBe(true);
      expect(result.rows.every(row => Date.parse(row.timestamp) >= Date.parse(input.ack.result.steps[1].beforeInputAt))).toBe(true);
      expect(new Set([...f.nativeKeysRequests, ...f.focusRequests].map(row => row.deadlineAt)).size).toBe(1);
      expect(verification(f, result, node).verify().spoken).toContain(node.name);
    } finally { await reader.close(); }
  });
  it('隔离profile固定desktop和扩展Insert，配置不能保存回其它profile', async () => {
    const f = readerModel(), reader = await f.open();
    try {
      expect(f.profileConfiguration()).toContain('[keyboard]\nkeyboardLayout = desktop\nNVDAModifierKeys = 4\nhandleInjectedKeys = True\n');
      expect(f.profileConfiguration()).toContain('saveConfigurationOnExit = False');
    } finally { await reader.close(); }
  });
  it.each([[250, 100], [0, 200]])('ACK延迟%dms和真实语音延迟%dms共用原开始锚', async (reportAckDelayMs, reportSpeechDelayMs) => {
    const { f, reader, node, run } = await captureDialog({ reportAckDelayMs, reportSpeechDelayMs });
    try {
      const result = await run(), input = f.readArtifact(result.providerWitness.speechSource.input);
      if (reportAckDelayMs) expect(Date.parse(result.rows[0].timestamp)).toBeLessThan(Date.parse(input.ack.observedAt));
      else expect(Date.parse(result.rows[0].timestamp)).toBeGreaterThanOrEqual(Date.parse(input.ack.observedAt));
      expect(verification(f, result, node).verify().spoken).toContain(node.name);
    } finally { await reader.close(); }
  });
  it('只有输入ACK和旧自动语音不能通行，也不能超时后再次发手势', async () => {
    const { f, reader, run } = await captureDialog({ reportSpeechMissing: true });
    const started = f.now;
    await expect(run()).rejects.toThrow(/UI_NVDA_(OPERATION_DEADLINE|SPOKEN_NODE|PROVIDER_TIME)/);
    expect(f.now - started).toBeGreaterThanOrEqual(10000);
    expect(f.nativeKeysRequests.filter(row => row.action === 'ReportFocus')).toHaveLength(1);
    expect(f.rawRows().filter(row => row.kind === 'nvda-synth-speech')).toHaveLength(1);
    const inputs = f.nativeKeysRequests.length;
    await expect(run()).rejects.toThrow('UI_NVDA_CAPTURE_SESSION_UNUSABLE');
    expect(f.nativeKeysRequests).toHaveLength(inputs);
    await expect(reader.close()).resolves.toMatchObject({ forced: false, exitCode: 0 });
  });
  it.each(['reportReceiptWriteFails', 'sourceMarkerWriteFails'])('%s立即保留错误并owned STOP，不以语音补记录', async key => {
    const { f, reader, run } = await captureDialog({ [key]: true });
    await expect(run()).rejects.toThrow(/UNIT_(REPORT_RECEIPT|SOURCE_MARKER)_WRITER_FAILED/);
    expect(f.nativeKeysRequests.filter(row => row.action === 'ReportFocus')).toHaveLength(1);
    await expect(reader.close()).resolves.toMatchObject({ forced: false, exitCode: 0 });
  });
});

const stripCases = [
  ['source', value => { delete value.witness.speechSource; }],
  ['capability', value => { delete value.options.readerLaunch.speechProtocol; }],
  ['both', value => { delete value.options.readerLaunch.speechProtocol; delete value.witness.speechSource; }],
  ['unknown-capability', value => { value.options.readerLaunch.speechProtocol.extra = true; }],
  ['wrong-version', value => { value.options.readerLaunch.speechProtocol.schemaVersion = 'legacy'; }],
  ['input-ref', value => { value.witness.speechSource.input.sha256 = 'f'.repeat(64); }],
  ['missing-input', value => { delete value.options.inputReceipt; }],
  ['mode-ref', value => { value.witness.speechSource.focusModeReceipt.sha256 = 'f'.repeat(64); }],
  ['mode-request', value => { value.options.focusModeReceipt.request.nonce = '33333333-3333-4333-8333-333333333333'; }],
  ['auto-downgrade', value => { Object.assign(value.witness.speechSource, { method: 'automatic-focus-announcement',
    focusMode: 'sequential', input: null, focusBefore: null }); delete value.options.inputReceipt; delete value.options.inputReceiptRef; }],
  ['foreign-modifier', value => { value.options.inputReceipt.ack.modifierEvidence.modifierKeys = 2; }],
  ['foreign-node', value => { value.options.inputReceipt.request.nodeNonce = '33333333-3333-4333-8333-333333333333'; }],
  ['partial-input', value => { value.options.inputReceipt.ack.result.acceptedEvents = 3; }],
  ['focus-before', value => { value.witness.speechSource.focusBefore.dom.activeElementId = 'foreign'; }],
  ['early-row', value => { value.rows[0].timestamp = value.witness.hostBefore.observedAt;
    value.options.rawRows[value.rows[0].rawIndex] = clone(value.rows[0]); }],
  ['early-raw-owner', value => { value.options.rawRows[value.witness.request.rawOffset].focusOwnerPid = 999; }],
  ['early-raw-time', value => { value.options.rawRows[value.witness.request.rawOffset].timestamp = value.witness.request.deadlineAt; }],
  ['omitted-valid-row', value => { value.options.rawRows.push({ ...clone(value.rows[0]), rawIndex: value.options.rawRows.length }); }],
];
describe('当前provider能力、方法和真实输入收据不能删改降级', () => {
  it('自动路径同id/name却mode receipt角色冲突必须拒绝', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node();
    try {
      const result = await reader.capture(f.runtime, f.locator(node), node), value = verification(f, result, node);
      value.options.focusModeReceipt.node.role = 'textbox';
      expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_SPEECH_SOURCE_INVALID');
    } finally { await reader.close(); }
  });
  it('自动来源也不能省略完整同nonce流内的合法目标行', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node();
    try {
      const result = await reader.capture(f.runtime, f.locator(node), node), value = verification(f, result, node);
      value.options.rawRows.push({ ...clone(value.rows[0]), rawIndex: value.options.rawRows.length });
      expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_SPEECH_SELECTION_MISMATCH');
    } finally { await reader.close(); }
  });
  it.each(stripCases)('%s保留原身份和raw门并拒绝不完整主动来源', async (_, mutate) => {
    const { f, reader, node, run } = await captureDialog();
    try {
      const observation = await run(), value = verification(f, observation, node);
      mutate(value);
      expect(() => value.verify()).toThrow(/UI_NVDA_(PROVIDER|REPORT|NATIVE_KEYS)/);
    } finally { await reader.close(); }
  });
  it.each(['source', 'capability'])('最终治理消费者同样拒绝删除%s', key => {
    const value = governanceFixture();
    try {
      value.changeSpeech(lines => {
        if (key === 'source') delete lines[1].providerWitness.speechSource;
        else value.updateReader(lines[1].providerWitness, reader => { delete reader.speechProtocol; });
      });
      expect(() => value.verify()).toThrow(/UI_NVDA_PROVIDER_SPEECH_(SOURCE_INVALID|PROTOCOL_REQUIRED)/);
    } finally { value.cleanup(); }
  });
});
