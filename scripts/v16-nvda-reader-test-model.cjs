const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

function readerModel() {
  const directory = path.resolve('unit-owned-nvda-config'), executablePath = path.resolve('unit-reader/nvda.exe');
  const output = path.resolve('unit-owned-nvda-output'), readerFile = path.resolve('scripts/v16-ui-software-screen-reader.js');
  const source = fs.readFileSync(readerFile, 'utf8'), files = new Map(), directories = new Set(), logs = [], execCalls = [], kills = [];
  const f = { now: 1792483201000, logs, execCalls, kills, directory, output, noStopAck: false, badAck: false,
    stopExitCode: 0, noSpeech: false, badFocusName: false, badSpeechTime: false, tamperRaw: false, rendererChanged: false, domChanged: false };
  const foregroundRequests = [], foregroundAcks = [], protocolEvents = [];
  const nodeFocusCounts = new Map(); let pendingSpeech = null;
  f.runtimeOperations = 0; f.boundaryError = new Error('UNIT_CAPTURE_BOUNDARY_FAILED');
  f.tabDestination = { name: '下一输入项', role: 'textbox' }; f.foregroundMode = 'success'; f.foregroundElapsedMs = 0; f.protocolEvents = protocolEvents;
  const key = file => path.resolve(String(file));
  const put = (file, data) => files.set(key(file), Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(String(data)));
  const bytes = file => { if (!files.has(key(file))) throw Object.assign(new Error('ENOENT:' + file), { code: 'ENOENT' }); return files.get(key(file)); };
  const stamp = () => new Date(f.now).toISOString();
  let context, clone, uuid = 0, timerId = 0;
  const timers = new Map();
  function schedule(callback, delay) {
    const id = ++timerId; timers.set(id, { callback, at: f.now + Number(delay) });
    if (delay <= 100) queueMicrotask(() => {
      if (!timers.has(id)) return;
      // 短计时器推进到自身到期点，避免更早的截止计时器吞掉本次唤醒。
      f.now = Math.max(f.now, timers.get(id).at);
      for (const [current, timer] of [...timers].filter(([, value]) => value.at <= f.now)) {
        timers.delete(current); timer.callback();
      }
    });
    return id;
  }
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [f.now])); } static now() { return f.now; } }
  const child = new EventEmitter(); Object.assign(child, { pid: 789, exitCode: null, signalCode: null });
  function exit(code = 0, signal = null) { child.exitCode = code; child.signalCode = signal; child.emit('exit', code, signal); child.emit('close', code, signal); }
  child.kill = signal => { kills.push({ child, signal }); if (f.killFails) return false; queueMicrotask(() => exit(null, signal)); return true; };
  const artifact = file => clone({ path: key(file), sha256: createHash('sha256').update(bytes(file)).digest('hex'), sizeBytes: bytes(file).length });
  function readBound(record) {
    const value = bytes(record.path);
    if (createHash('sha256').update(value).digest('hex') !== record.sha256 || value.length !== record.sizeBytes) throw new Error('UNIT_ARTIFACT_CHANGED');
    return { path: key(record.path), bytes: value, json: () => clone(JSON.parse(value.toString('utf8'))) };
  }
  const fakeFs = {
    existsSync: file => files.has(key(file)) || directories.has(key(file)),
    mkdirSync(file) { for (let current = key(file); !directories.has(current); current = path.dirname(current)) {
      directories.add(current); if (current === path.dirname(current)) break;
    } },
    readFileSync: (file, encoding) => encoding ? bytes(file).toString(encoding) : Buffer.from(bytes(file)),
    writeFileSync(file, value, options) {
      if (options?.flag === 'wx' && files.has(key(file))) throw new Error('UNIT_EEXIST');
      put(file, value);
      if (path.basename(file) === 'collector-stop.json') protocolEvents.push('owned-stop-request');
      if (path.basename(file) === 'collector-stop.json' && !f.noStopAck) queueMicrotask(() => {
        const request = JSON.parse(bytes(file).toString('utf8'));
        put(path.join(directory, 'collector-stop-ack.json'), JSON.stringify({ kind: 'nvda-observer-stop-ack', schemaVersion: 1,
          runToken: request.runToken, nonce: f.badAck ? 'foreign-nonce' : request.nonce, pid: child.pid, timestamp: stamp() }));
        if (!f.stopAckWithoutExit) exit(f.stopExitCode);
      });
    },
    copyFileSync: (from, to) => put(to, bytes(from)),
    linkSync(from, to) { if (files.has(key(to))) throw Object.assign(new Error('UNIT_EEXIST'), { code: 'EEXIST' });
      put(to, bytes(from)); if (path.basename(to) === 'collector-focus.json') acknowledgeFocus(to);
      if (path.basename(to) === 'collector-keys.json') acknowledgeNativeKeys(to); },
    unlinkSync(file) { bytes(file); files.delete(key(file)); },
    renameSync(from, to) {
      put(to, bytes(from)); files.delete(key(from));
      if (path.basename(to) === 'collector-foreground.json') acknowledgeForeground(to);
      if (path.basename(to) === 'collector-node.json') protocolEvents.push('speech-request');
      if (path.basename(to) === 'collector-focus.json') acknowledgeFocus(to);
    },
  };
  function acknowledgeForeground(file) {
    const request = JSON.parse(bytes(file).toString('utf8')); foregroundRequests.push(request); protocolEvents.push('foreground-request');
    if (f.foregroundMode === 'timeout' || f.foregroundMode === 'timeoutForeign') {
      if (f.foregroundMode === 'timeoutForeign') put(file, JSON.stringify({ ...request, nonce: '33333333-3333-4333-8333-333333333333' }));
      return;
    }
    f.now += f.foregroundElapsedMs;
    const ack = { kind: 'nvda-observer-foreground-ack', schemaVersion: 1, runToken: request.runToken, nonce: request.nonce,
      pid: child.pid, nodeSequence: request.nodeSequence, startedAt: request.startedAt, deadlineAt: request.deadlineAt,
      timestamp: stamp(), reason: 'EXACT_ROOT_ESTABLISHED', foregroundNull: false, ownerIsBoundMain: true, exactRoot: true, callReturnedTrue: true };
    const modes = {
      alreadyOwned: { reason: 'ALREADY_OWNED', callReturnedTrue: null }, falseExact: { callReturnedTrue: false },
      falseWrong: { reason: 'NOT_ESTABLISHED', exactRoot: false, callReturnedTrue: false },
      trueWrong: { reason: 'NOT_ESTABLISHED', exactRoot: false }, nullWindow: { reason: 'NOT_ESTABLISHED', foregroundNull: true, ownerIsBoundMain: false, exactRoot: false },
      sameMainOtherRoot: { reason: 'NOT_ESTABLISHED', exactRoot: false }, birth: { reason: 'BIRTH', exactRoot: null },
      api: { reason: 'API', exactRoot: null }, expired: { timestamp: '2020-01-01T00:00:00.000Z' },
      crossToken: { runToken: '33333333-3333-4333-8333-333333333333' }, crossPid: { pid: 790 },
      crossNonce: { nonce: '33333333-3333-4333-8333-333333333333' }, crossSequence: { nodeSequence: request.nodeSequence + 1 },
      wrongStartedAt: { startedAt: new Date(Date.parse(request.startedAt) - 1).toISOString() },
      wrongDeadlineAt: { deadlineAt: new Date(Date.parse(request.deadlineAt) + 1).toISOString() }, unknownField: { additionalPid: 790 },
    };
    Object.assign(ack, modes[f.foregroundMode]);
    if (f.foregroundMode === 'replay' && foregroundAcks.length) Object.assign(ack, foregroundAcks[0]);
    files.delete(key(file)); foregroundAcks.push({ ...ack }); protocolEvents.push('foreground-ack');
    put(path.join(directory, 'collector-foreground-ack-' + request.nonce + '.json'), JSON.stringify(ack));
  }
  const focusRequests = [], focusAcks = [];
  function acknowledgeFocus(file) {
    const request = JSON.parse(bytes(file).toString('utf8')); focusRequests.push(request); protocolEvents.push('focus-request-' + request.phase);
    if (f.focusAckMode === 'timeout') return;
    const publish = () => {
      const source = request.allowAlreadyFocused ? 'already-focused' : 'event-gainFocus';
      const generation = Math.max(f.focusGeneration || 0, request.baselineGeneration) + (source === 'event-gainFocus' ? 1 : 0);
      f.focusGeneration = generation; if (source === 'event-gainFocus') f.focusEventAt = stamp();
      const ack = { ...request, source, eventGeneration: generation, eventTimestamp: f.focusEventAt || null,
        observedAt: stamp(), pendingFocusEvents: false, focusMatchesExpected: true,
        proof: { focusPid: 123, focusHwnd: '1001', rootOwnerPid: 123, focusOwnerPid: 123, foregroundHwnd: '1000', ancestorHwnd: '1000',
          isChild: true, mainAlive: true, handleCreationTimeUtc: '2026-10-20T08:00:00.1234567Z' } };
      const mutations = { nonce: { nonce: '33333333-3333-4333-8333-333333333333' }, sequence: { nodeSequence: request.nodeSequence + 1 },
        phase: { phase: 'foreign' }, unknown: { extra: true }, source: { source: 'unit-fabricated-event' }, pending: { pendingFocusEvents: true },
        oldEvent: { source: 'event-gainFocus', eventGeneration: request.baselineGeneration },
        already: { source: 'already-focused' }, future: { observedAt: new Date(f.now + 1).toISOString() } };
      if (generation > 0) put(path.join(directory, 'collector-focus-state.json'), JSON.stringify({ kind: 'nvda-owned-focus-state', schemaVersion: 1,
        runToken: request.runToken, pid: child.pid, binding: JSON.parse(bytes(path.join(directory, 'collector-target.json')).toString('utf8')),
        generation, eventTimestamp: f.focusEventAt }));
      Object.assign(ack, mutations[f.focusAckMode]);
      if (f.focusAckMode === 'owner') ack.proof.focusPid = 456;
      if (f.focusAckMode === 'birth') ack.proof.handleCreationTimeUtc = '2020-01-01T00:00:00.0000000Z';
      if (f.focusAckMode === 'alreadyOnTab' && request.phase === 'tab') ack.source = 'already-focused';
      if (f.focusAckMode === 'alreadyOnTarget' && request.phase === 'target-focus') ack.source = 'already-focused';
      if (f.focusAckMode === 'priorFocusOnTab' && request.phase === 'tab') Object.assign(ack, focusAcks[0]);
      files.delete(key(file)); focusAcks.push(ack); protocolEvents.push('focus-ack-' + request.phase);
      put(path.join(directory, 'collector-focus-ack-' + request.nonce + '.json'), JSON.stringify(ack));
    };
    if (f.focusAckDelayMs) schedule(publish, f.focusAckDelayMs); else publish();
  }
  const nativeKeysRequests = [], nativeKeysAcks = [];
  function acknowledgeNativeKeys(file) {
    const request = JSON.parse(bytes(file).toString('utf8')); nativeKeysRequests.push(request); files.delete(key(file));
    protocolEvents.push('native-key-' + request.action);
    if (f.nativeKeysMode === 'timeout') return;
    const processNative = () => {
      if (request.action === 'ReportFocus') {
        protocolEvents.push('native-report-focus');
        if (!f.noSpeech && !f.reportSpeechMissing) {
          const report = () => {
            const saved = pendingSpeech;
            pendingSpeech = { request: JSON.parse(bytes(path.join(directory, 'collector-node.json')).toString('utf8')).request,
              node: f.nativeTarget.node };
            flushPendingSpeech(); pendingSpeech = saved;
            protocolEvents.push('report-focus-synth');
          };
          if (f.reportSpeechDelayMs) schedule(report, f.reportSpeechDelayMs); else report();
        }
        return;
      }
      if (!f.nativeFocusMissing) performKey(request.action === 'Tab' ? 'Tab' : 'ShiftTab'); protocolEvents.push('native-dom-' + request.action);
      if (!f.nativeDomMissing && f.nativeEvent) Object.assign(f.nativeEvent, { keydownAt: stamp(), keyupAt: stamp(), completedAt: stamp(), trusted: true });
    };
    if (f.nativeDomDelayMs) schedule(processNative, f.nativeDomDelayMs); else processNative();
    const held = [], events = request.action === 'ReportFocus' ? [[45, 1], [9, 0], [9, 2], [45, 3]]
      : request.action === 'Tab' ? [[9, 0], [9, 2]] : [[160, 0], [9, 0], [9, 2], [160, 2]];
    const owner = () => ({ mainPid: 123, mainAlive: true, handleCreationTimeUtc: '2026-10-20T08:00:00.1234567Z', mainExeMatches: true,
      rootHwnd: '1000', activeHwnd: '1000', focusHwnd: '1001', focusOwnerPid: 123, focusAncestorHwnd: '1000',
      inputDesktopMatched: true, otherInputReleased: true, heldKeys: [...held] });
    const steps = events.map(([vk, flags], index) => {
      const step = { index, key: vk, flags, accepted: 1, proof: owner(), beforeInputAt: stamp(), timestamp: stamp() };
      if ((flags & 2) === 0) held.push(vk); else held.splice(held.indexOf(vk), 1); return step;
    });
    const ack = { ...request, result: { passed: true, reason: 'COMPLETE', requestedEvents: events.length,
      acceptedEvents: events.length, sendInputCalls: events.length, steps, afterProof: owner(), cleanupOnly: false,
      cleanupAttempted: false, cleanupAcceptedEvents: 0, cleanupKeys: [], cleanupKeysReleased: true, cleanupErrors: [], atomicTargetGuarantee: false }, observedAt: stamp() };
    if (request.action === 'ReportFocus') {
      ack.modifierEvidence = { kind: 'nvda-report-focus-modifier', schemaVersion: 1, source: 'nvda.config.conf',
        keyboardLayout: 'desktop', modifierKeys: 4, extendedInsertMask: 4, handleInjectedKeys: true };
      if (f.mutateReportAck) f.mutateReportAck(ack);
    }
    if (f.nativeKeysMode === 'nonce') ack.nonce = '33333333-3333-4333-8333-333333333333';
    if (f.nativeKeysMode === 'partial') { ack.result.passed = false; ack.result.acceptedEvents = 1; }
    if (f.nativeKeysMode === 'cleanup') { ack.result.cleanupOnly = true; ack.result.cleanupAttempted = true; }
    if (f.nativeKeysMode === 'owner') ack.result.afterProof.mainPid = 999;
    const publishAck = () => {
      if (request.action === 'ReportFocus') ack.observedAt = stamp();
      nativeKeysAcks.push(ack); put(path.join(directory, 'collector-keys-ack-' + request.nonce + '.json'), JSON.stringify(ack));
    };
    if (request.action === 'ReportFocus' && f.reportAckDelayMs) schedule(publishAck, f.reportAckDelayMs); else publishAck();
  }
  const rawFile = path.join(directory, 'actual-speech.jsonl');
  const emitted = new Set();
  function publishStartup() {
    const binding = JSON.parse(bytes(path.join(directory, 'collector-target.json')).toString('utf8'));
    const row = { kind: 'nvda-observer-startup-complete', schemaVersion: 1, engine: 'NVDA', version: 'unit-only', pid: child.pid,
      runToken: binding.runToken, binding, startupSource: 'core.postNvdaStartup', timestamp: stamp() };
    const modes = { crossPid: { pid: child.pid + 1 }, crossToken: { runToken: '33333333-3333-4333-8333-333333333333' },
      crossBinding: { binding: { ...binding, renderer: { ...binding.renderer, pid: 999 } } }, crossVersion: { version: 'foreign' },
      beforeOpen: { timestamp: new Date(f.now - 30_001).toISOString() }, future: { timestamp: new Date(f.now + 1000).toISOString() },
      unknownField: { spoken: '不得替代语音' }, wrongSource: { startupSource: 'unit-fabricated-startup' } };
    Object.assign(row, modes[f.startupMode]);
    put(path.join(directory, 'nvda-startup-complete.json'), JSON.stringify(row)); protocolEvents.push('startup-complete');
  }
  const childProcess = {
    execFileSync(exe, args, options) { execCalls.push({ exe, args, options }); if (exe === 'powershell.exe') return '0'; throw new Error('UNIT_GLOBAL_QUIT_FORBIDDEN'); },
    spawn(exe, args, options) {
      f.spawn = { exe, args, options };
      const binding = JSON.parse(bytes(path.join(directory, 'collector-target.json')).toString('utf8'));
      put(rawFile, JSON.stringify({ kind: 'nvda-observer-ready', engine: 'NVDA', version: 'unit-only', pid: child.pid,
        timestamp: stamp(), rawIndex: 0, binding }) + '\n');
      if (!f.noStartupComplete) { if (f.startupDelayMs) schedule(publishStartup, f.startupDelayMs); else publishStartup(); }
      if (f.exitBeforeStartup) queueMicrotask(() => exit(0));
      return child;
    },
  };
  const writer = {
    log(event, error, details) { logs.push({ event, error, details, hostObservedAtMs: f.now }); },
    json(name, value) {
      if (f.phaseWriteFails && /^screen-reader\/node-/.test(name)) throw new Error('UNIT_PHASE_WRITER_FAILED');
      if (f.reportReceiptWriteFails && /native-keys-\d+-report-focus\.json$/.test(name)) throw new Error('UNIT_REPORT_RECEIPT_WRITER_FAILED');
      if (f.sourceMarkerWriteFails && /speech-source-\d+\.json$/.test(name)) throw new Error('UNIT_SOURCE_MARKER_WRITER_FAILED');
      const file = path.join(output, name); fakeFs.writeFileSync(file, JSON.stringify(value), { flag: 'wx' }); return artifact(file);
    },
    copy(name, record) {
      let value = readBound(record).bytes;
      if (f.tamperRaw) { const rows = value.toString('utf8').trim().split('\n').map(JSON.parse); rows.at(-1).spoken += ' 篡改'; value = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n'); }
      const file = path.join(output, name); fakeFs.writeFileSync(file, value, { flag: 'wx' }); return artifact(file);
    },
  };
  const ports = {
    './s7-launch-operator-security': { captureTrustedWindowsRuntime: () => ({ executable: { realPath: 'unit-explicit-shell' }, environment: {} }) },
    './v16-ui-owned-caption-contract': { OWNED_CAPTION_PROTOCOL: Object.freeze({ unitPort: true }), validateOwnedCaptionProtocol: value => value },
    './v16-ui-owned-caption': { activateOwnedCaption: async () => {
      protocolEvents.push('caption-setup'); f.captionObservedAt = stamp();
      f.captionSetups = (f.captionSetups || 0) + 1;
      if (f.captionFailure) throw f.captionFailure;
      f.now += f.captionElapsedMs || 0;
      return { passed: true, receipt: { path: 'unit-caption-setup', sha256: 'e'.repeat(64), sizeBytes: 17 } };
    } },
    'node:fs': fakeFs, 'node:path': path, 'node:child_process': childProcess,
    'node:crypto': { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` },
    './v16-performance-artifacts': { insist(condition, code) { if (!condition) throw new Error(code); },
      directPath: file => ({ path: key(file) }), fileRecord: artifact, readBound },
  };
  function load(file, code = fs.readFileSync(file, 'utf8')) {
    const module = { exports: {} };
    const requirePort = request => {
      if (request in ports) return ports[request];
      if (request === './v16-nvda-provider-binding') return load(path.resolve('scripts/v16-nvda-provider-binding.js'));
      if (request === './v16-ui-nvda-speech-bracket') return load(path.resolve('scripts/v16-ui-nvda-speech-bracket.js'));
      if (request === './v16-ui-owned-accessibility') return load(path.resolve('scripts/v16-ui-owned-accessibility-test-port.cjs'));
      if (request === './v16-ui-accessible-node') return load(path.resolve('scripts/v16-ui-accessible-node-test-port.cjs'));
      if (request === './v16-ui-nvda-dom-focus') return load(path.resolve('scripts/v16-ui-nvda-dom-focus.js'));
      if (request === './v16-ui-nvda-focus-phase') return load(path.resolve('scripts/v16-ui-nvda-focus-phase.js'));
      if (request === './v16-ui-nvda-native-keys') return load(path.resolve('scripts/v16-ui-nvda-native-keys.js'));
      if (request === './v16-nvda-native-keys-contract') return load(path.resolve('scripts/v16-nvda-native-keys-contract.js'));
      if (request === './v16-ui-nvda-native-key-events') return load(path.resolve('scripts/v16-ui-nvda-native-key-events.js'));
      if (request === 'node:util') return { isDeepStrictEqual };
      if (request.includes('runtime-log-format')) return { createRuntimeLogRecord: (level, event, details) => ({ level, event, context: details }) };
      throw new Error('UNIT_UNEXPECTED_REQUIRE:' + request);
    };
    vm.runInContext('(function(require,module,exports,__dirname){' + code + '\n})', context, { filename: file })(requirePort, module, module.exports, path.dirname(file));
    return module.exports;
  }
  context = vm.createContext({ Buffer, Date: FakeDate, setTimeout: schedule, clearTimeout: id => timers.delete(id),
    process: { cwd: () => process.cwd(), platform: 'win32', pid: 123, execPath: path.resolve('unit-package/AmazonAIOpsAgent.exe'), stderr: { write() {} } }, document: { hasFocus: () => !f.documentUnfocused, activeElement: null, getElementById() { return null; } } });
  const parse = vm.runInContext('JSON.parse', context); clone = value => parse(JSON.stringify(value));
  const storeContext = clone({ storeId: 'unit-store', browserProfileId: 'unit-browser', marketplace: 'US', currency: 'USD',
    businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-20', sessionGeneration: 1 });
  const mainPath = path.resolve('unit-package/AmazonAIOpsAgent.exe'), appRoot = path.resolve('unit-package'), userDataDir = path.resolve('unit-profile');
  const native = { kind: 'v16-nfr-native-launch', schemaVersion: 1, packageIdentity: { executableSha256: 'A'.repeat(64), appContentSha256: 'B'.repeat(64), mainBundleSha256: 'C'.repeat(64) },
    startedAt: new Date(f.now - 1000).toISOString(), finishedAt: stamp(), processBinding: { method: 'windows-shell', main: { pid: 123, parentPid: 122,
      creationTimeUtc: '2026-10-20T08:00:00.1234560Z', executablePath: mainPath } },
    verification: { mainExitObserver: { pid: 123, parentPid: 122, watcherPid: 124, executablePath: mainPath, handleAcquired: true,
      creationTimeUtc: '2026-10-20T08:00:00.1234560Z', handleCreationTimeUtc: '2026-10-20T08:00:00.1234567Z',
      creationPrecision: 'cim-microsecond+handle-100ns', ownerToken: '11111111-1111-4111-8111-111111111111' } },
    identity: { pid: 123, creationTime: 1792483200123.456, packaged: true, executablePath: mainPath, appRoot, userDataDir,
      windows: [{ id: 1, visible: true, url: 'file:///unit-package/index.html', rendererPid: 456, creationTime: 1792483200124.5 }] } };
  const nativeFile = path.resolve('unit-native-launch.json'); put(nativeFile, JSON.stringify(native)); put(executablePath, 'unit-exe');
  put(path.resolve('scripts/v16-nvda-speech-observer.py'), '# unit-only');
  const window = { id: 1, isDestroyed: () => false, isVisible: () => true, show() {}, focus() {}, getNativeWindowHandle() { const value = Buffer.alloc(8); value.writeBigUInt64LE(1000n); return value; },
    webContents: { getOSProcessId: () => f.rendererChanged ? 457 : 456, getURL: () => 'file:///unit-package/index.html',
      getLastWebPreferences: () => ({ contextIsolation: true, nodeIntegration: false }) } };
  const electron = { app: { isPackaged: true, getAppPath: () => appRoot, getPath: () => userDataDir,
    getAppMetrics: () => [{ pid: 123, creationTime: 1792483200123.456 }, { pid: f.rendererChanged ? 457 : 456, creationTime: 1792483200124.5 }] },
    BrowserWindow: { getAllWindows: () => [window] } };
  context.window = { electronAPI: { getActiveStoreWorkspaceView: async () => ({ context: storeContext }) } };
  const runtime = { identity: { pid: 123, windows: [{ rendererPid: 456 }] }, launch: { receipt: artifact(nativeFile) },
    app: { async evaluate(callback, arg) { f.runtimeOperations++; f.now += 1; return callback(electron, arg); } },
    page: { async evaluate(callback, request) {
      f.runtimeOperations++; f.now += 1;
      if (request?.kind === 'v16-native-key-events-arm') { f.nativeEvent = { nonce: request.nonce, action: request.action,
        closed: false, keydownAt: null, keyupAt: null, completedAt: null, trusted: false }; return; }
      if (request?.kind === 'v16-native-key-events-read') return f.nativeEvent?.completedAt ? clone(f.nativeEvent) : null;
      if (request?.kind === 'v16-native-key-events-close') { if (f.nativeEvent?.nonce === request.nonce) f.nativeEvent.closed = true; return; }
      return callback(request);
    }, keyboard: { async press(key) {
      f.cdpKeyCalls = (f.cdpKeyCalls || 0) + 1; performKey(key);
    } } } };
  function performKey(key) {
    f.runtimeOperations++; f.now += 1; f.lastKey = key; protocolEvents.push('key-' + key);
    if (f.failStep === (key === 'Tab' ? 'tab' : 'target-focus')) throw f.boundaryError;
    if (key === 'Tab') flushPendingSpeech();
    // 同一显式端口模拟原生按键后的DOM焦点，不把输入ACK当作自然语音。
    if (key === 'Tab' && f.tabDestination) {
      const target = f.tabDestination;
      context.document.activeElement = { isConnected: true, tagName: 'INPUT', type: 'text', labels: [], textContent: target.name,
        getAttribute(name) { return name === 'aria-label' ? target.name : name === 'role' ? target.role : null; } };
    }
    if (key === 'ShiftTab' && !f.targetMissing) {
      if (f.dialogContainer) {
        context.document.activeElement = { isConnected: true, tagName: 'INPUT', labels: [], textContent: '容器前的正常控件', getAttribute: name => name === 'role' ? 'textbox' : null };
      } else {
        context.document.activeElement = f.nativeTarget.element;
        const id = f.nativeTarget.node.id; nodeFocusCounts.set(id, (nodeFocusCounts.get(id) || 0) + 1); protocolEvents.push('node-focus');
      }
    }
  }
  function locator(node) {
    const element = { isConnected: true, tagName: f.dialogContainer ? 'DIV' : 'BUTTON', tabIndex: f.negativeTabIndex ? -1 : f.dialogContainer ? -1 : 0,
      matches: () => false, closest: () => null, labels: [], textContent: node.name, getAttribute(name) {
      if (name === 'data-v16-a11y-node') return f.domChanged ? 'another-node' : node.id;
      return name === 'role' ? node.role : name === 'aria-label' ? node.name : null;
    } };
    f.nativeTarget = { node, element };
    if (f.domInitiallyFocused && !context.document.activeElement) context.document.activeElement = element;
    return { async evaluate(callback, request) {
      f.runtimeOperations++; f.now += 1;
      const value = callback(element, request);
      // 仅真实host-read对象注入原边界异常，布尔焦点探测不占用该故障端口。
      const hostRead = value && typeof value === 'object' && !Array.isArray(value)
        && Object.prototype.hasOwnProperty.call(value, 'id') && Object.prototype.hasOwnProperty.call(value, 'activeElementId');
      if (f.failStep === 'host-before' && hostRead && nodeFocusCounts.get(node.id) === 1) throw f.boundaryError;
      return value;
    }, async focus() {
      f.runtimeOperations++; f.now += 1; context.document.activeElement = element;
      const count = (nodeFocusCounts.get(node.id) || 0) + 1; nodeFocusCounts.set(node.id, count);
      protocolEvents.push('node-focus');
      if (f.failStep === (count === 1 ? 'first-focus' : 'target-focus')) throw f.boundaryError;
      // 只有首次焦点触发待发自然语音；再次 focus 不伪造新的语音事件。
      if (count !== 1 || f.noSpeech) return;
      const commandFile = path.join(directory, 'collector-node.json'); if (!files.has(key(commandFile))) return;
      const { request } = JSON.parse(bytes(commandFile).toString('utf8')); if (emitted.has(request.nonce)) return;
      pendingSpeech = { request, node }; protocolEvents.push('first-focus-armed');
      if (f.earlySpeech) flushPendingSpeech();
    } };
  }
  function flushPendingSpeech() {
    if (!pendingSpeech) return;
    const { request, node } = pendingSpeech; pendingSpeech = null; emitted.add(request.nonce);
    if (f.overBudget) f.now += 10001;
    const append = ancestor => {
      const rows = bytes(rawFile).toString('utf8').trim().split('\n').map(JSON.parse), binding = rows[0].binding;
      const row = { kind: 'nvda-synth-speech', engine: 'NVDA', version: 'unit-only', pid: child.pid, binding, request, rawIndex: rows.length,
        timestamp: f.badSpeechTime ? '2020-01-01T00:00:00.000Z' : stamp(), focusPid: 123, focusHwnd: '1001', rootOwnerPid: 123,
        focusOwnerPid: 123, foregroundHwnd: '1000', ancestorHwnd: '1000', isChild: true, mainAlive: true,
        handleCreationTimeUtc: '2026-10-20T08:00:00.1234567Z', focusName: ancestor ? node.name : f.badFocusName ? '另一个按钮' : node.name,
        focusRole: node.role, synthesizer: 'unit-only', spoken: ancestor ? '延迟祖先容器' : f.speechMismatch ? '前一个节点的自然语音' : `按钮 ${node.name}` };
      put(rawFile, bytes(rawFile).toString('utf8') + JSON.stringify(row) + '\n');
      protocolEvents.push(ancestor ? 'ancestor-natural-speech' : 'first-focus-natural-speech');
    };
    if (f.onlyAncestorSpeech || f.ancestorBeforeTarget) append(true);
    if (!f.onlyAncestorSpeech) append(false);
  }
  const api = load(readerFile, source);
  return Object.assign(f, { api, runtime, writer, child, storeContext, locator, exit, foregroundRequests, foregroundAcks, focusRequests, focusAcks, nativeKeysRequests, nativeKeysAcks,
    readArtifact: record => readBound(record).json(),
    putArtifact: (record, value) => { put(record.path, JSON.stringify(value)); return artifact(record.path); },
    profileConfiguration: () => bytes(path.join(directory, 'nvda.ini')).toString('utf8'),
    speechRequest: () => files.has(key(path.join(directory, 'collector-node.json'))) ? JSON.parse(bytes(path.join(directory, 'collector-node.json')).toString('utf8')).request : null,
    foregroundFiles: () => [...files].filter(([file]) => path.basename(file).startsWith('collector-foreground')).map(([file, value]) => ({ file, text: value.toString('utf8') })),
    node: (id = 'unit-node') => ({ id, role: 'button', name: id === 'unit-node' ? '当前操作' : '返回操作' }),
    pendingTimerCount: () => timers.size,
    phaseRows: () => [...files].filter(([file]) => /[\\/]screen-reader[\\/]node-/.test(file)).map(([, value]) => JSON.parse(value.toString('utf8'))),
    focusCounts: node => nodeFocusCounts.get(node.id) || 0,
    rawRows: () => bytes(rawFile).toString('utf8').trim().split('\n').map(JSON.parse),
    launchReceipt: () => JSON.parse(bytes(path.join(output, 'screen-reader/launch.json')).toString('utf8')),
    stopRequest: () => JSON.parse(bytes(path.join(directory, 'collector-stop.json')).toString('utf8')),
    stopTiming: () => JSON.parse(bytes(path.join(output, 'screen-reader/stop-timing.json')).toString('utf8')),
    cleanup: () => JSON.parse(bytes(path.join(output, 'screen-reader/cleanup.json')).toString('utf8')),
    open: () => api.openNvdaObserver({ executablePath, directory, writer, rendererPid: 456, runtime, storeContext, timeoutMs: 30000 }) });
}

module.exports = { readerModel };
