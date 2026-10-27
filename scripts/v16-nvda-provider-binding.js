const path = require('node:path');
const { isDeepStrictEqual: same } = require('node:util');
const { insist } = require('./v16-performance-artifacts');

const KIND = 'nvda-main-window-accessibility';
const SCHEMA = 'v16.nvda-provider-binding/1';
const SPEECH_PROTOCOL = Object.freeze({ schemaVersion: 'v16.nvda-report-focus/1',
  automaticMethod: 'automatic-focus-announcement', namedDialogMethod: 'nvda-report-current-focus' });
const PRECISION = 'cim-microsecond+handle-100ns';
const CONTEXT = ['storeId', 'browserProfileId', 'marketplace', 'currency', 'businessTimezone', 'businessDate', 'sessionGeneration'];
const pid = value => Number.isSafeInteger(value) && value > 0;
const text = value => typeof value === 'string' && value.length > 0;
const token = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const hwnd = value => typeof value === 'string' && /^[1-9]\d*$/.test(value) && BigInt(value) <= 0xffffffffffffffffn;
const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const birth = value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/.test(value ?? '') && stamp(value.slice(0, 23) + 'Z');
const localPath = value => text(value) && path.win32.isAbsolute(value) && !value.includes('\0');
const pathEqual = (left, right) => localPath(left) && localPath(right)
  && path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
function keys(value, allowed, code) {
  insist(value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...allowed].sort()), code);
}
function ref(value) { return value && text(value.path) && /^[a-f0-9]{64}$/i.test(value.sha256 ?? '') && Number.isSafeInteger(value.sizeBytes) && value.sizeBytes > 0; }
function domEqual(value, node) { return value && value.id === node.id && value.name === node.name && value.role === node.role && value.activeElementId === node.id; }

function validateProviderBinding(binding, nativeLaunch, expected = {}) {
  const code = 'UI_NVDA_PROVIDER_BINDING_INVALID';
  keys(binding, ['schemaVersion', 'providerKind', 'runToken', 'main', 'renderer', 'window', 'storeContext', 'nativeLaunch'], code);
  insist(binding.schemaVersion === SCHEMA && binding.providerKind === KIND && token(binding.runToken), code);
  keys(binding.main, ['pid', 'creationTimeUtc', 'handleCreationTimeUtc', 'creationPrecision', 'executablePath', 'userDataDir', 'ownerToken'], code);
  keys(binding.renderer, ['pid', 'creationTime', 'creationTimeSource'], code);
  keys(binding.window, ['id', 'url', 'rootHwnd'], code); keys(binding.storeContext, CONTEXT, code);
  const main = binding.main, renderer = binding.renderer, window = binding.window;
  insist(pid(main.pid) && birth(main.creationTimeUtc) && birth(main.handleCreationTimeUtc) && main.creationPrecision === PRECISION
    && main.creationTimeUtc.slice(0, 26) === main.handleCreationTimeUtc.slice(0, 26)
    && localPath(main.executablePath) && localPath(main.userDataDir) && token(main.ownerToken), code);
  insist(pid(renderer.pid) && renderer.pid !== main.pid && Number.isFinite(renderer.creationTime) && renderer.creationTime > 0
    && renderer.creationTimeSource === 'electron.app.getAppMetrics.creationTime' && pid(window.id) && text(window.url) && hwnd(window.rootHwnd), code);
  const context = binding.storeContext;
  insist(text(context.storeId) && text(context.browserProfileId) && context.marketplace === 'US' && context.currency === 'USD'
    && text(context.businessTimezone) && /^\d{4}-\d{2}-\d{2}$/.test(context.businessDate ?? '')
    && Number.isSafeInteger(context.sessionGeneration) && context.sessionGeneration >= 0, code);
  insist(ref(binding.nativeLaunch) && ref(expected.nativeLaunchRef) && same(binding.nativeLaunch, expected.nativeLaunchRef),
    'UI_NVDA_PROVIDER_TRUSTED_NATIVE_LAUNCH_REQUIRED');
  const identity = nativeLaunch?.identity, processMain = nativeLaunch?.processBinding?.main;
  const held = nativeLaunch?.verification?.mainExitObserver;
  const kind = expected.nativeLaunchKind;
  insist(['v16-nfr-native-launch', 'v16-package-ui-native-launch'].includes(kind), 'UI_NVDA_PROVIDER_TRUSTED_NATIVE_LAUNCH_KIND_REQUIRED');
  const methods = kind === 'v16-nfr-native-launch' ? ['windows-shell'] : ['windows-shell', 'windows-direct'];
  insist(nativeLaunch?.kind === kind && nativeLaunch.schemaVersion === 1 && identity?.packaged === true
    && methods.includes(nativeLaunch.processBinding.method) && held?.handleAcquired === true && pid(held.watcherPid)
    && held.watcherPid !== main.pid && held.pid === main.pid && processMain?.pid === main.pid && identity.pid === main.pid
    && processMain.creationTimeUtc === main.creationTimeUtc && held.creationTimeUtc === main.creationTimeUtc
    && held.handleCreationTimeUtc === main.handleCreationTimeUtc && held.creationPrecision === main.creationPrecision
    && held.ownerToken === main.ownerToken && pathEqual(processMain.executablePath, main.executablePath)
    && pathEqual(identity.executablePath, main.executablePath) && pathEqual(identity.userDataDir, main.userDataDir)
    && identity.windows?.length === 1 && identity.windows[0].id === window.id && identity.windows[0].url === window.url
    && identity.windows[0].rendererPid === renderer.pid && identity.windows[0].creationTime === renderer.creationTime,
  'UI_NVDA_PROVIDER_NATIVE_LAUNCH_MISMATCH');
  if (expected.pid !== undefined) insist(main.pid === expected.pid, 'UI_NVDA_PROVIDER_MAIN_MISMATCH');
  if (expected.packageIdentity !== undefined) insist(same(nativeLaunch.packageIdentity, expected.packageIdentity), 'UI_NVDA_PROVIDER_PACKAGE_MISMATCH');
  return binding;
}

function validateProviderReady(ready, binding, readerPid) {
  insist(ready?.kind === 'nvda-observer-ready' && ready.engine === 'NVDA' && text(ready.version) && pid(ready.pid)
    && ready.rawIndex === 0 && stamp(ready.timestamp) && same(ready.binding, binding)
    && (readerPid === undefined || readerPid === ready.pid), 'UI_NVDA_PROVIDER_READY_INVALID');
  return ready;
}

function validateSpeechSelection(witness, rows, node, options, before, keydown) {
  const result = require('./v16-ui-nvda-speech-bracket').selectBracketedSpeech(options.rawRows,
    { binding: witness.binding, ready: witness.ready, request: witness.request, node, hostBefore: before, hostAfter: witness.hostAfter });
  const selected = keydown === undefined ? result.matching
    : result.matching.filter(row => Date.parse(row.timestamp) >= Date.parse(keydown));
  insist(same(selected, rows), 'UI_NVDA_PROVIDER_SPEECH_SELECTION_MISMATCH');
}
function validateSpeechSource(witness, rows, node, reader, options) {
  const code = 'UI_NVDA_PROVIDER_SPEECH_SOURCE_INVALID';
  keys(reader.speechProtocol, Object.keys(SPEECH_PROTOCOL), 'UI_NVDA_PROVIDER_SPEECH_PROTOCOL_REQUIRED');
  insist(same(reader.speechProtocol, SPEECH_PROTOCOL), 'UI_NVDA_PROVIDER_SPEECH_PROTOCOL_REQUIRED');
  const source = witness.speechSource;
  keys(source, ['schemaVersion', 'method', 'focusMode', 'focusModeReceipt', 'input', 'focusBefore'], code);
  insist(source.schemaVersion === SPEECH_PROTOCOL.schemaVersion, code);
  insist(ref(source.focusModeReceipt) && same(source.focusModeReceipt, options.focusModeReceiptRef), code);
  const mode = options.focusModeReceipt;
  keys(mode, ['kind', 'schemaVersion', 'formalCredit', 'binding', 'request', 'mode', 'node'], code);
  keys(mode.node, ['id', 'tabIndex', 'role', 'name', 'disabled', 'inert'], code);
  insist(mode.kind === 'v16-nvda-focus-mode' && mode.schemaVersion === 1 && mode.formalCredit === false
    && same(mode.binding, witness.binding) && same(mode.request, witness.request) && mode.mode === source.focusMode
    && mode.node.id === node.id && mode.node.name === node.name && mode.node.role === node.role && mode.node.disabled === false
    && mode.node.inert === false && Number.isInteger(mode.node.tabIndex), code);
  if (source.method === SPEECH_PROTOCOL.automaticMethod) {
    insist(source.focusMode === 'sequential' && mode.node.tabIndex >= 0 && source.input === null && source.focusBefore === null
      && options.inputReceipt === undefined && options.inputReceiptRef === undefined, code);
    validateSpeechSelection(witness, rows, node, options, witness.hostBefore);
    return;
  }
  insist(source.method === SPEECH_PROTOCOL.namedDialogMethod && source.focusMode === 'named-dialog-container'
    && node.role === 'dialog' && mode.node.role === 'dialog' && mode.node.tabIndex === -1
    && ref(source.input) && same(source.input, options.inputReceiptRef), code);
  const before = source.focusBefore;
  keys(before, ['observedAt', 'binding', 'dom'], code);
  insist(same(before.binding, witness.binding) && domEqual(before.dom, node) && stamp(before.observedAt)
    && Date.parse(before.observedAt) >= Date.parse(witness.hostBefore.observedAt)
    && Date.parse(before.observedAt) <= Date.parse(witness.hostAfter.observedAt), code);
  // 输入收据只证明固定朗读手势，原始合成语音及其身份、名称和时限仍独立验证。
  const input = options.inputReceipt;
  require('./v16-nvda-native-keys-contract').validateReportFocusInputReceipt(input, witness.binding,
    witness.request, witness.ready.pid, { startedAt: witness.request.startedAt, finishedAt: witness.hostAfter.observedAt });
  const keydown = input.ack.result.steps[1].beforeInputAt;
  insist(Date.parse(input.request.phaseStartedAt) >= Date.parse(before.observedAt)
    && rows.every(row => Date.parse(row.timestamp) >= Date.parse(before.observedAt)
      && Date.parse(row.timestamp) >= Date.parse(keydown)), code);
  validateSpeechSelection(witness, rows, node, options, before, keydown);
}

function validateProviderObservation(witness, rows, node, options = {}) {
  insist(witness && ref(witness.nativeLaunch) && ref(witness.readerLaunch) && ref(witness.rawSpeech), 'UI_NVDA_PROVIDER_ORIGINAL_REFS_REQUIRED');
  const binding = validateProviderBinding(witness.binding, options.nativeLaunch, options.expected);
  insist(same(witness.nativeLaunch, binding.nativeLaunch), 'UI_NVDA_PROVIDER_NATIVE_REF_MISMATCH');
  const ready = validateProviderReady(witness.ready, binding);
  const reader = options.readerLaunch;
  insist(ref(options.expected?.readerLaunchRef) && same(witness.readerLaunch, options.expected.readerLaunchRef),
    'UI_NVDA_PROVIDER_TRUSTED_READER_LAUNCH_REQUIRED');
  insist(reader?.kind === 'v16-nvda-observer-launch' && reader.schemaVersion === 1 && same(reader.binding, binding)
    && same(reader.nativeLaunch, binding.nativeLaunch) && same(reader.ready, ready), 'UI_NVDA_PROVIDER_READER_ORIGINAL_MISMATCH');
  const runtime = reader.runtimeSnapshot, original = options.nativeLaunch.identity;
  insist(runtime?.pid === binding.main.pid && runtime.creationTime === original.creationTime && runtime.packaged === true
    && pathEqual(runtime.executablePath, original.executablePath) && pathEqual(runtime.appRoot, original.appRoot)
    && pathEqual(runtime.userDataDir, binding.main.userDataDir) && same(runtime.renderer, binding.renderer)
    && runtime.window?.id === binding.window.id && runtime.window.url === binding.window.url && runtime.window.rootHwnd === binding.window.rootHwnd
    && runtime.window.visible === true && runtime.window.preferences?.contextIsolation === true
    && runtime.window.preferences.nodeIntegration === false && same(runtime.storeContext, binding.storeContext),
  'UI_NVDA_PROVIDER_RUNTIME_SNAPSHOT_MISMATCH');
  insist(Array.isArray(options.rawRows) && options.rawRows.length > 1 && same(options.rawRows[0], ready), 'UI_NVDA_PROVIDER_RAW_ORIGINAL_REQUIRED');
  const request = witness.request;
  keys(request, ['sequence', 'nonce', 'nodeId', 'name', 'role', 'rawOffset', 'startedAt', 'deadlineAt'], 'UI_NVDA_PROVIDER_REQUEST_INVALID');
  insist(pid(request.sequence) && token(request.nonce) && request.nodeId === node?.id && request.name === node?.name && request.role === node?.role
    && text(node.id) && text(node.name) && text(node.role) && Number.isSafeInteger(request.rawOffset) && request.rawOffset >= 1
    && stamp(request.startedAt) && stamp(request.deadlineAt) && Date.parse(request.deadlineAt) > Date.parse(request.startedAt)
    && Date.parse(request.deadlineAt) - Date.parse(request.startedAt) <= 10_000, 'UI_NVDA_PROVIDER_REQUEST_INVALID');
  insist(options.seenNonces instanceof Set && !options.seenNonces.has(request.nonce), 'UI_NVDA_PROVIDER_NODE_NONCE_REUSED');
  insist(options.sequenceState instanceof Map, 'UI_NVDA_PROVIDER_SEQUENCE_STATE_REQUIRED');
  const previous = options.sequenceState.get(binding.nativeLaunch.sha256);
  insist(!previous || (previous.runToken === binding.runToken && previous.readerPid === ready.pid && request.sequence > previous.sequence),
    'UI_NVDA_PROVIDER_SEQUENCE_OR_READER_CHANGED');
  const before = witness.hostBefore, after = witness.hostAfter, execution = options.execution;
  insist(before && after && same(before.binding, binding) && same(after.binding, binding)
    && domEqual(before.dom, node) && domEqual(after.dom, node), 'UI_NVDA_PROVIDER_CURRENT_DOM_OR_RENDERER_MISMATCH');
  const start = Date.parse(request.startedAt), end = Date.parse(request.deadlineAt), first = Date.parse(before.observedAt), last = Date.parse(after.observedAt);
  insist(stamp(before.observedAt) && stamp(after.observedAt) && first >= start && last >= first && last <= end
    && Date.parse(ready.timestamp) <= start
    && stamp(execution?.startedAt) && stamp(execution?.finishedAt) && start >= Date.parse(execution.startedAt) && last <= Date.parse(execution.finishedAt),
  'UI_NVDA_PROVIDER_TIME_INVALID');
  insist(Array.isArray(rows) && rows.length > 0, 'UI_NVDA_PROVIDER_ACTUAL_SPEECH_REQUIRED');
  let previousIndex = request.rawOffset - 1, previousTime = first;
  for (const row of rows) {
    insist(row?.kind === 'nvda-synth-speech' && row.engine === 'NVDA' && row.version === ready.version && row.pid === ready.pid
      && same(row.binding, binding) && same(row.request, request) && Number.isSafeInteger(row.rawIndex) && row.rawIndex >= request.rawOffset
      && row.rawIndex > previousIndex && same(options.rawRows[row.rawIndex], row), 'UI_NVDA_PROVIDER_RAW_ROW_MISMATCH');
    insist(row.focusPid === binding.main.pid && row.focusOwnerPid === binding.main.pid && row.rootOwnerPid === binding.main.pid
      && row.foregroundHwnd === binding.window.rootHwnd && row.ancestorHwnd === binding.window.rootHwnd && hwnd(row.focusHwnd)
      && (row.focusHwnd === binding.window.rootHwnd || row.isChild === true) && row.mainAlive === true
      && row.handleCreationTimeUtc === binding.main.handleCreationTimeUtc, 'UI_NVDA_PROVIDER_NATIVE_WINDOW_MISMATCH');
    const actualRole = ({ editabletext: 'textbox', radiobutton: 'radio', propertypage: 'tabpanel' })[row.focusRole] ?? row.focusRole;
    insist(row.focusName === node.name && actualRole === node.role && text(row.synthesizer) && text(row.spoken) && row.spoken.includes(node.name),
      'UI_NVDA_PROVIDER_ACTUAL_NAME_OR_ROLE_MISMATCH');
    const time = Date.parse(row.timestamp);
    insist(stamp(row.timestamp) && time >= previousTime && time <= last && time >= start && time <= end, 'UI_NVDA_PROVIDER_TIME_INVALID');
    previousIndex = row.rawIndex; previousTime = time;
  }
  const spoken = rows.map(row => row.spoken).join(' ');
  insist(options.spoken === spoken && (!options.observedAt || options.observedAt === rows.at(-1).timestamp)
    && (!options.readerVersion || options.readerVersion === ready.version), 'UI_NVDA_PROVIDER_AGGREGATE_MISMATCH');
  validateSpeechSource(witness, rows, node, reader, options);
  options.seenNonces.add(request.nonce);
  options.sequenceState.set(binding.nativeLaunch.sha256, { runToken: binding.runToken, readerPid: ready.pid, sequence: request.sequence });
  return { binding, ready, spoken, observedAt: rows.at(-1).timestamp };
}

module.exports = { validateProviderBinding, validateProviderReady, validateProviderObservation, SPEECH_PROTOCOL };
