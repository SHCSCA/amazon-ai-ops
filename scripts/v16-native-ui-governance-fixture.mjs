import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import native from './v16-native-artifacts.js';
import governance from './v16-ui-governance.js';
import { pngBytes } from './v16-native-test-fixture.mjs';
import adapter from './v16-native-ui-governance.js';
import provider from './v16-nvda-provider-binding.js';
import { buildOwnedMotionV2Model } from './owned-motion-geometry-v2.test-support.mjs';

// 全部原件只在临时目录生成，协议字段均为隔离替身，不构成原生或当前包实证。
export function governanceFixture({ launchMethod = 'windows-shell', deviceScaleFactor = 1, electronVersion = '44.2.0', wide = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v16-governance-fixture-'));
  const write = (name, bytes) => {
    const file = path.resolve(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
    return { path: file, sha256: native.digest(bytes), sizeBytes: Buffer.byteLength(bytes) };
  };
  const json = (name, value) => write(name, JSON.stringify(value));
  const update = (record, change) => {
    const value = JSON.parse(fs.readFileSync(record.path, 'utf8')); change(value);
    Object.assign(record, json(record.path, value));
  };
  const source = fs.readFileSync(fileURLToPath(new URL('../docs/v16_companion_verification_traceability.md', import.meta.url)), 'utf8');
  const definition = write(governance.SOURCE, source);
  const register = write('packet/register.md', source.replace(/\| PENDING \|/g, '| PASS |'));
  const parsed = governance.parseUiGovernance(fs.readFileSync(register.path, 'utf8'));
  const now = Date.now() - 10_000;
  const execution = { startedAt: new Date(now).toISOString(), finishedAt: new Date(now + 9_000).toISOString() };
  const capturedAt = new Date(now + 1_000).toISOString();
  const packageIdentity = { executableSha256: '1'.repeat(64), appContentSha256: '2'.repeat(64), mainBundleSha256: '3'.repeat(64) };
  const profileId = wide ? 'wide' : deviceScaleFactor === 1 ? '100-compact' : '125-compact';
  const ui = { runGroup: { runGroupId: 'fixture-ui-run' }, runs: [{ profileId, ...(wide ? {} : { scalePercent: deviceScaleFactor * 100 }), actualDeviceScaleFactor: deviceScaleFactor,
    schedulerReadOnlyRuntime: { main: { pid: 123 } }, session: { storeAuthorityReadback: { actualIdSha256: '4'.repeat(64) } } }] };
  const raw = { kind: 'v16-ui-governance', schemaVersion: 1, runId: 'fixture-governance-run', sourceSha256: '5'.repeat(64),
    packageIdentity, definitionSha256: definition.sha256, registeredAt: new Date(now + 500).toISOString(),
    register: { ...register }, uiRunGroupId: ui.runGroup.runGroupId, deltas: [] };
  const descriptor = { runId: raw.runId, path: path.join(root, 'packet/governance.json'), packageUiArtifactId: 'fixture-ui' };
  const context = { root, execution, identity: { sourceSha256: raw.sourceSha256 }, current: { packageIdentity },
    load(id, expected) { if (id !== 'fixture-ui' || expected !== 'package-ui') throw new Error('FIXTURE_UNEXPECTED_DEPENDENCY'); return ui; } };
  const timestamp = offset => new Date(now + offset).toISOString();
  const creationTimeUtc = timestamp(-1000).replace('Z', '0000Z');
  const handleCreationTimeUtc = creationTimeUtc.replace(/0Z$/, '7Z');
  const executablePath = path.join(root, 'fixture-package/AmazonAIOpsAgent.exe'), userDataDir = path.join(root, 'fixture-profile');
  const ownerToken = '11111111-1111-4111-8111-111111111111';
  const main = { pid: 123, parentPid: 122, executablePath, creationTimeUtc };
  const nativeLaunch = json('packet/native-launch.json', { kind: 'v16-package-ui-native-launch', schemaVersion: 1,
    packageIdentity, startedAt: timestamp(0), finishedAt: timestamp(100),
    processBinding: { method: launchMethod, main, query: { powershell: {
      realPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', sha256: 'a'.repeat(64), signature: { status: 'Valid' } } } },
    verification: { mainExitObserver: { ...main, kind: 'v16-main-exit-ready', schemaVersion: 1, ownerToken, watcherPid: 124,
      handleCreationTimeUtc, creationPrecision: 'cim-microsecond+handle-100ns', handleAcquired: true, observedAt: timestamp(100) } },
    identity: { pid: 123, creationTime: now - 1000, electronVersion, packaged: true, executablePath, appRoot: path.join(root, 'fixture-package'), userDataDir, windows: [{ id: 1, visible: true,
      url: 'file:///fixture-package/dist/renderer/index.html', rendererPid: 456, creationTime: now,
      preferences: { contextIsolation: true, nodeIntegration: false } }] } });
  ui.runs[0].nativeLaunch = nativeLaunch;
  const providerBinding = { schemaVersion: 'v16.nvda-provider-binding/1', providerKind: 'nvda-main-window-accessibility',
    runToken: '22222222-2222-4222-8222-222222222222',
    main: { pid: 123, creationTimeUtc, handleCreationTimeUtc, creationPrecision: 'cim-microsecond+handle-100ns', executablePath, userDataDir, ownerToken },
    renderer: { pid: 456, creationTime: now, creationTimeSource: 'electron.app.getAppMetrics.creationTime' },
    window: { id: 1, url: 'file:///fixture-package/dist/renderer/index.html', rootHwnd: '1000' },
    storeContext: { storeId: 'fixture-store', browserProfileId: 'fixture-browser', marketplace: 'US', currency: 'USD',
      businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-20', sessionGeneration: 1 }, nativeLaunch };
  const ready = { kind: 'nvda-observer-ready', engine: 'NVDA', version: 'fixture-only', pid: 789,
    timestamp: timestamp(200), rawIndex: 0, binding: providerBinding };
  const readerLaunch = json('packet/reader-launch.json', { kind: 'v16-nvda-observer-launch', schemaVersion: 1,
    binding: providerBinding, ready, nativeLaunch, speechProtocol: provider.SPEECH_PROTOCOL,
    runtimeSnapshot: { pid: 123, creationTime: now - 1000, executablePath, appRoot: path.join(root, 'fixture-package'), userDataDir, packaged: true,
      renderer: providerBinding.renderer, window: { ...providerBinding.window, visible: true, preferences: { contextIsolation: true, nodeIntegration: false } },
      storeContext: providerBinding.storeContext } });
  ui.runs[0].readerLaunch = readerLaunch;
  const rawSpeechRows = [ready];
  let sequence = 0;
  const speechEvidence = node => {
    sequence += 1;
    const startedAt = timestamp(1000 + sequence * 100), observedAt = timestamp(1010 + sequence * 100);
    const request = { sequence, nonce: `33333333-3333-4333-8333-${String(sequence).padStart(12, '0')}`,
      nodeId: node.id, name: node.name, role: node.role, rawOffset: rawSpeechRows.length,
      startedAt, deadlineAt: timestamp(2000 + sequence * 100) };
    const row = { kind: 'nvda-synth-speech', engine: 'NVDA', version: ready.version, pid: ready.pid,
      timestamp: observedAt, binding: providerBinding, request, rawIndex: rawSpeechRows.length,
      focusPid: 123, focusHwnd: '1001', rootOwnerPid: 123, focusOwnerPid: 123, foregroundHwnd: '1000',
      ancestorHwnd: '1000', isChild: true, mainAlive: true, handleCreationTimeUtc,
      focusName: node.name, focusRole: node.role, synthesizer: 'fixture-only', spoken: `按钮 ${node.name}` };
    rawSpeechRows.push(row);
    const host = observedAt => ({ observedAt, binding: providerBinding, dom: { id: node.id, name: node.name, role: node.role, activeElementId: node.id } });
    const focusModeReceipt = json(`packet/focus-mode-${sequence}.json`, { kind: 'v16-nvda-focus-mode', schemaVersion: 1,
      formalCredit: false, binding: providerBinding, request, mode: 'sequential',
      node: { id: node.id, name: node.name, role: node.role, tabIndex: 0, disabled: false, inert: false } });
    return { event: 'spoken-node', timestamp: observedAt, targetId: node.id, role: node.role, spoken: row.spoken,
      actualNvdaRows: [row], providerWitness: { binding: providerBinding, ready, nativeLaunch, readerLaunch, request,
        speechSource: { schemaVersion: provider.SPEECH_PROTOCOL.schemaVersion, method: provider.SPEECH_PROTOCOL.automaticMethod,
          focusMode: 'sequential', focusModeReceipt, input: null, focusBefore: null },
        rawSpeech: write(`packet/raw-${sequence}.jsonl`, rawSpeechRows.map(value => JSON.stringify(value)).join('\n') + '\n'),
        hostBefore: host(startedAt), hostAfter: host(timestamp(1020 + sequence * 100)) } };
  };
  const storeIdSha256 = native.digest(Buffer.from(providerBinding.storeContext.storeId));
  const sourceHelperPath = fileURLToPath(new URL('./v16-ui-native-geometry.ps1', import.meta.url));
  const sourceHelperBytes = fs.readFileSync(sourceHelperPath);
  const sourceHelperStat = fs.lstatSync(sourceHelperPath);
  const sourceHelper = { path: sourceHelperPath, sha256: native.digest(sourceHelperBytes), sizeBytes: sourceHelperBytes.length,
    stat: Object.fromEntries(['ino', 'size', 'mtimeMs', 'ctimeMs', 'birthtimeMs', 'mode', 'nlink'].map(key => [key, sourceHelperStat[key]])) };
  const motionOwner = { mainPid: 123, mainCreationTime: now - 1000, windowId: 1,
    rendererPid: 456, rendererCreationTime: now, url: providerBinding.window.url, electronVersion: '44.2.0' };
  const motionGeometry = (kind, index) => {
    // 压缩的时标仅用于隔离模型；不改变任何真实采集或退出预算。
    const model = buildOwnedMotionV2Model({ owner: motionOwner, nativeMain: { birthUtc: handleCreationTimeUtc, executablePath },
      execution, deviceScaleFactor, kind, timeScale: 0.1, capturedAt, nonceSeed: index });
    const geometry = model.witness;
    for (const [side, observation] of [['before', geometry.nativeBefore], ['after', geometry.nativeAfter]]) {
      const call = observation.invocation;
      call.tool = { ...sourceHelper }; call.command.args[3] = sourceHelper.path;
      call.stdout = write('packet/' + index + '/' + kind + '/native-' + side + '.stdout', JSON.stringify(observation.native));
      call.stderr = write('packet/' + index + '/' + kind + '/native-' + side + '.stderr', '');
    }
    return geometry;
  };
  ui.runs[0].session.storeAuthorityReadback.actualIdSha256 = storeIdSha256;
  for (const [index, delta] of parsed.accessibility.entries()) {
    const binding = { primitive: delta.primitive, runId: raw.runId, uiRunGroupId: raw.uiRunGroupId, sourceSha256: raw.sourceSha256,
      packageIdentity, profileId, pid: 123, storeIdSha256,
      governanceDefinitionSha256: definition.sha256, registerSha256: register.sha256 };
    const nodes = [{ id: 'control', role: 'button', name: '当前操作', focusable: true, bounds: { x: 10, y: 20, width: 80, height: 30 } },
      { id: 'trigger', role: 'button', name: '返回操作', focusable: true, bounds: { x: 110, y: 20, width: 80, height: 30 } }];
    const dom = { schemaVersion: 'v16.accessibility-dom/1', binding, capturedAt, nodes };
    const log = (category, events) => write(`packet/${index}/${category}.jsonl`, events.map(event => JSON.stringify({ binding, timestamp: capturedAt, ...event })).join('\n'));
    const keyboardEvents = delta.primitive === 'ReasonRequiredDialog'
      ? ['focus-enter', 'tab-wrap', 'shift-tab-wrap', 'escape', 'focus-return'] : ['focus-enter', 'keyboard-action', 'focus-return'];
    const observation = (category, value) => json(`packet/${index}/${category}.json`, { schemaVersion: 'v16.accessibility-observation/1', binding, capturedAt, category, ...value });
    const speech = nodes.map(speechEvidence);
    const observations = {
      keyboard: observation('keyboard', { triggerId: 'trigger', dom: json(`packet/${index}/keyboard-dom.json`, dom),
        log: log('keyboard', keyboardEvents.map((event, n) => ({ event, targetId: n === keyboardEvents.length - 1 ? 'trigger' : 'control', activeElementId: n === keyboardEvents.length - 1 ? 'trigger' : 'control' }))) }),
      'screen-reader': observation('screen-reader', { capturedAt: timestamp(5000), engine: { name: 'NVDA', version: 'fixture-only' }, dom: json(`packet/${index}/screen-reader-dom.json`, dom),
        log: log('screen-reader', [{ event: 'screen-reader-start', timestamp: speech[0].timestamp }, ...speech,
          { event: 'screen-reader-end', timestamp: speech.at(-1).providerWitness.hostAfter.observedAt }]) }),
      'motion-zoom': observation('motion-zoom', { log: log('motion-zoom', ['reduced-motion-enabled', '125-percent-capture', 'minimum-window-capture'].map(event => ({ event }))),
        viewports: ['125-percent', 'minimum-window'].map((kind, n) => {
          const geometryWitness = motionGeometry(kind, index), factor = geometryWitness.before.renderer.devicePixelRatio;
          const dimensions = geometryWitness.nativeSize;
          return { kind, screenshot: write(`packet/${index}/${kind}.png`, pngBytes(index + n, dimensions.width, dimensions.height)),
            dom: json(`packet/${index}/${kind}-dom.json`, { ...dom, schemaVersion: 'v16.accessibility-motion-dom/3', geometryWitness,
              reducedMotion: true, stateText: '当前阶段已完成', animations: [{ durationMs: 0 }],
              coordinateSpace: 'physical-pixels', cssToPhysicalFactor: factor,
              nodes: nodes.map(node => ({ ...node, cssBounds: { ...node.bounds }, bounds: Object.fromEntries(Object.entries(node.bounds).map(([field, value]) => [field, value * factor])) })),
              viewport: { ...dimensions, scaleFactor: n === 0 ? 1.25 : 1 } }) };
        }) }),
    };
    raw.deltas.push({ primitive: delta.primitive, owner: delta.owner, method: delta.method, status: 'PASS', profileId: binding.profileId, pid: binding.pid,
      storeIdSha256: binding.storeIdSha256, observations,
      approval: json(`packet/${index}/approval.json`, { schemaVersion: 'v16.accessibility-approval/1', primitive: delta.primitive, owner: delta.owner,
        approvedBy: 'fixture-reviewer', status: 'approved', sourceSha256: raw.sourceSha256, packageIdentity, binding,
        definitionSha256: definition.sha256, registerSha256: register.sha256,
        observations: adapter.CATEGORIES.map(category => ({ category, sha256: observations[category].sha256 })), approvedAt: new Date(now + 8_000).toISOString() }) });
  }
  const changeObservation = (category, change, index = 0) => {
    const delta = raw.deltas[index]; update(delta.observations[category], change);
    update(delta.approval, approval => { approval.observations = adapter.CATEGORIES.map(name => ({ category: name, sha256: delta.observations[name].sha256 })); });
  };
  const changeSpeech = (change, index = 0) => changeObservation('screen-reader', observation => {
    const lines = fs.readFileSync(observation.log.path, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    change(lines, observation);
    observation.log = write(`packet/${index}/screen-reader.jsonl`, lines.map(line => JSON.stringify(line)).join('\n') + '\n');
  }, index);
  const rewriteRaw = (witness, change) => {
    const rows = fs.readFileSync(witness.rawSpeech.path, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    change(rows); witness.rawSpeech = write(witness.rawSpeech.path, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  };
  const updateReader = (witness, change) => {
    update(witness.readerLaunch, change); Object.assign((ui.runs[0] ?? ui.wideProfile).readerLaunch, witness.readerLaunch);
  };
  const changeProviderBinding = (line, change) => {
    const witness = line.providerWitness, binding = structuredClone(witness.binding); change(binding);
    witness.binding = binding; witness.ready.binding = binding; witness.hostBefore.binding = binding; witness.hostAfter.binding = binding;
    for (const row of line.actualNvdaRows) row.binding = binding;
    updateReader(witness, reader => { reader.binding = binding; reader.ready.binding = binding; });
    rewriteRaw(witness, rows => { rows[0] = witness.ready; for (const row of line.actualNvdaRows) rows[row.rawIndex] = row; });
  };
  if (wide) ui.wideProfile = ui.runs.pop();
  return { root, raw, descriptor, context, ui, source, definition, register, write, json, update, changeObservation, changeSpeech, rewriteRaw, updateReader, changeProviderBinding,
    verify: () => adapter.verifyUiGovernance(raw, descriptor, context),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
