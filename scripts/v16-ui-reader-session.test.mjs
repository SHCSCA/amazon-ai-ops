import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import governance from './v16-ui-governance.js';

const require = createRequire(import.meta.url), root = process.cwd();
const format = require('../packages/shared-types/src/runtime-log-format.cjs');
const { axModel } = require('./v16-ui-ax-test-model.cjs');
const digest = value => createHash('sha256').update(value).digest('hex');
function insist(value, code) { if (!value) throw new Error(code); }
function loadProduction(relative, ports, stderr = []) {
  const file = path.join(root, relative), module = { exports: {} };
  const localRequire = name => { if (Object.hasOwn(ports, name)) return ports[name]; throw new Error('UNIT_SESSION_UNEXPECTED_REQUIRE:' + name); };
  // 真实生产 CJS 仅经显式内存端口运行，不访问数据库、系统 PID 或实际窗口。
  vm.runInNewContext('(function(require,module,exports,__dirname){' + fs.readFileSync(file, 'utf8') + '\n})', {
    Buffer, Date, process: { cwd: () => root, env: {}, stderr: { write: value => stderr.push(JSON.parse(value)) } },
  }, { filename: file })(localRequire, module, module.exports, path.dirname(file));
  return module.exports;
}
function accessibleProductionPorts(stderr) {
  const artifacts = { insist }, identity = loadProduction('scripts/v16-ui-ax-identity.js', {
    'node:crypto': require('node:crypto'), 'node:util': require('node:util'), './v16-performance-artifacts': artifacts,
    '../packages/shared-types/src/runtime-log-format.cjs': format,
  }, stderr);
  const accessible = loadProduction('scripts/v16-ui-accessible-node.js', { './v16-performance-artifacts': artifacts, './v16-ui-ax-identity': identity }, stderr);
  const setup = loadProduction('scripts/v16-ui-reader-target-setup.js', { './v16-performance-artifacts': artifacts, './v16-ui-accessible-node': accessible }, stderr);
  return { './v16-ui-accessible-node': accessible, './v16-ui-reader-target-setup': setup };
}
function memoryWriter() {
  const records = new Map(), logs = [], writerRoot = path.join(root, 'unit-reader-session-memory');
  const writer = { root: writerRoot,
    write(name, value) {
      const bytes = Buffer.from(value), record = { path: path.join(writerRoot, name), sha256: digest(bytes), sizeBytes: bytes.length };
      records.set(record.path, bytes); return record;
    },
    json(name, value) { return this.write(name, JSON.stringify(value)); },
    copy() {}, log(event, error, details) { logs.push({ event, error, details }); },
  };
  return { writer, records, logs, json: name => JSON.parse(records.get(path.join(writerRoot, name)).toString('utf8')) };
}
async function governanceModel(options = {}) {
  const memory = memoryWriter(), actions = [], stderr = [], captureError = new Error('UNIT_FIRST_READER_CAPTURE_FAILED');
  const ax = axModel();
  let activeId, controls, reader, captures = 0, motions = 0;
  const record = event => actions.push({ event, afterSessionFailure: Boolean(reader?.sessionFailure) });
  class Locator {
    constructor(kind, number = 0) {
      this.kind = kind; this.number = number;
      this.element = ax.element(undefined, kind === 'root' ? 'dialog' : 'button');
      this.element.axName = kind === 'trigger' ? '隔离返回控件' : '隔离具名节点' + number;
      this.element.backend = 20 + (kind === 'trigger' ? 0 : kind === 'root' ? 1 : 2 + number);
      if (kind === 'root') { this.element.tabIndex = -1; this.element.attrs['aria-labelledby'] = 'isolated-title'; }
      this.element.getBoundingClientRect = () => ({ toJSON: () => ({ x: 20 + number * 100, y: 20, width: 80, height: 30 }) });
    }
    get id() { return this.element.getAttribute('data-v16-a11y-node'); }
    page() { return page; }
    async evaluate(callback, request) { ax.target = this.element; return ax.locator.evaluate(callback, request); }
    async focus() { record('focus'); activeId = this.id; ax.document.activeElement = this.element; }
    async waitFor() {}
    async isEnabled() { return true; }
    async isVisible() { return true; }
    async count() { return 1; }
    async getAttribute(name) { return this.kind === 'root' ? ({ role: 'dialog', tabindex: '-1', 'aria-labelledby': 'isolated-title' }[name] ?? null) : null; }
    async click() { record('click'); }
    filter() { return this; }
    first() { return this; }
    getByRole(_, options) { return this.kind === 'root' && options?.name === '关闭详情检查器' ? nodes[0] : trigger; }
    locator() { return controls; }
  }
  const trigger = new Locator('trigger'), container = new Locator('root'), nodes = [new Locator('control', 0), new Locator('control', 1)];
  controls = { filter() { return this; }, count: async () => nodes.length, first: () => nodes[0], nth: index => nodes[index],
    evaluateAll: async callback => callback(nodes.map(() => ({ tabIndex: 0, matches: () => false, closest: () => null }))) };
  const locators = [trigger, container, ...nodes];
  // 每次读取同一元素的真实模型元数据；未知标记拒绝，不回退到容器或伪造AX结果。
  ax.onSend = () => { ax.name = ax.target.axName; ax.role = ax.target.getAttribute('role'); ax.backend = ax.target.backend; };
  const page = { ...ax.page, getByRole: () => trigger,
    locator: selector => {
      if (selector.startsWith('[data-v16-a11y-node=')) {
        insist(selector.endsWith(']'), 'UNIT_SESSION_MARKER_SELECTOR_INVALID');
        const id = JSON.parse(selector.slice('[data-v16-a11y-node='.length, -1)), matches = locators.filter(locator => locator.id === id);
        insist(matches.length === 1, 'UNIT_SESSION_MARKER_NOT_UNIQUE'); return matches[0];
      }
      return selector === '[role="dialog"],[role="alertdialog"]' ? { filter() { return this; }, count: async () => 0 }
        : selector.includes('.app-sidebar [data-operator-entry]') ? trigger : container;
    },
    waitForFunction: async (_, id) => insist(activeId === id, 'UNIT_SESSION_FOCUS_MISMATCH'),
    keyboard: { press: async key => {
      record('key-' + key);
      if (key === 'Escape') activeId = trigger.id;
      else if (key === 'Tab' || key === 'Shift+Tab') {
        const position = nodes.findIndex(node => node.id === activeId);
        activeId = nodes[(position + (key === 'Tab' ? 1 : nodes.length - 1)) % nodes.length].id;
      }
      ax.document.activeElement = locators.find(locator => locator.id === activeId)?.element || null;
    } },
  };
  reader = { sessionFailure: options.preFailed ? captureError : null, capture: async (_, __, node) => {
    captures++;
    if (captures === options.failAt) {
      if (options.markFailure !== false) reader.sessionFailure = captureError;
      throw captureError;
    }
    const row = { timestamp: new Date().toISOString(), spoken: '隔离语音端口 ' + node.name };
    return { rows: [row], observedAt: row.timestamp, engine: { name: 'ISOLATED_PORT', version: 'unit-only' }, providerWitness: { formalCredit: false } };
  } };
  if (options.writerLogFailure) memory.writer.log = (event, error, details) => {
    memory.logs.push({ event, error, details }); throw new Error('UNIT_SESSION_LOG_WRITER_FAILED');
  };
  const actual = loadProduction('scripts/v16-ui-software-governance.js', {
    'node:fs': fs, 'node:path': path, './v16-performance-artifacts': { digest, insist, fileRecord() { throw new Error('UNIT_UNUSED_FILE_RECORD'); } },
    './v16-ui-governance': governance, '../packages/shared-types/src/runtime-log-format.cjs': format,
    ...accessibleProductionPorts(stderr),
    './v16-ui-software-motion': { captureMotionZoom: async (_, writer, binding, label) => {
      motions++; record('motion'); return writer.json(label + '/isolated-motion.json', { binding, formalCredit: false });
    } },
  }, stderr);
  const result = await actual.collectSoftwareGovernance({ page, identity: { pid: 123 } }, memory.writer, {
    runId: 'isolated-run', uiRunGroupId: 'isolated-group', sourceSha256: 'a'.repeat(64), packageIdentity: { isolated: true },
    profileId: 'isolated-profile', pid: 123, storeIdSha256: 'b'.repeat(64),
  }, { root, screenReader: options.noReader ? undefined : reader, blockedError: options.setupBlocked ? captureError : undefined,
    ui: { EXPECTED_PACKAGE_UI_ENTRIES: actual.CATALOG.map(item => { const [workspace, subview] = item.entry.split('/'); return { workspace, subview }; }),
      navigateToWorkspace: async () => record('prepare-navigation') },
  });
  return { result, actions, captures, motions, captureError, stderr, ...memory };
}

async function collectorModel(options = {}) {
  const memory = memoryWriter(), calls = [], stderr = [], modelRoot = path.join(root, 'unit-reader-session-collector');
  const profile = path.join(modelRoot, 'fixture/profile'), source = { sourceSha256: 'a'.repeat(64) };
  const context = { storeId: 'isolated-store', browserProfileId: 'isolated-browser', marketplace: 'US', currency: 'USD',
    businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-21', sessionGeneration: 1 };
  const fixture = { sourceSha256: source.sourceSha256, generationState: 'CURRENT', fixture: 'typical', packageHashes: {},
    classification: 'isolated-software-fixture', formalCredit: false, ownerToken: 'isolated-owner', storeIds: [context.storeId],
    logicalDatabase: { path: path.join(modelRoot, 'fixture/input.db'), sha256: 'b'.repeat(64), sizeBytes: 1 } };
  const identity = { pid: 123, windows: [{ rendererPid: 456 }], appRoot: path.join(modelRoot, 'app'), packageIdentity: { isolated: true } };
  const captureError = new Error('UNIT_FIRST_READER_CAPTURE_FAILED'), reader = { sessionFailure: null, receipt: { path: 'isolated-reader-launch' },
    close: async () => { calls.push('reader-close'); if (options.cleanupFailure) throw new Error('UNIT_OWNED_STOP_FAILED'); return { forced: false, exitCode: 0 }; } };
  const runtime = { identity, userDataDir: profile, launch: { receipt: { path: 'isolated-native-launch' } }, rendererErrors: [],
    page: { evaluate: async () => ({ context }) }, close: async () => { calls.push('runtime-close'); } };
  const fakeFs = { constants: { COPYFILE_EXCL: 1 }, existsSync: () => false, mkdirSync() {}, copyFileSync() {}, writeFileSync() {},
    readFileSync: file => JSON.stringify(String(file).endsWith('owner.json') ? { token: fixture.ownerToken, classification: fixture.classification }
      : { schemaVersion: 'v16.build-state/1', status: 'CURRENT', identity: source }) };
  const actual = loadProduction('scripts/v16-ui-software-collector.js', {
    'node:fs': fakeFs, 'node:path': path, 'node:crypto': { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    './v16-performance-artifacts': { createArtifactWriter: () => memory.writer, insist, digest,
      readBound: record => ({ path: record.path, json: () => fixture }), fileRecord: file => ({ path: file }) },
    './verify-v16-required-test-manifest': { sourceIdentity: () => source }, './v16-native-artifacts': { currentPackage: () => identity },
    './v16-performance-runtime': { openNativeRuntime: async () => runtime }, './v16-performance-contract': { validateFixture: value => value },
    './evidence-user-data': { validateEvidenceUserDataPath: value => value },
    './v16-ui-software-matrix': { captureSoftwareMatrix: async () => { calls.push('matrix'); return { issues: [], results: [{ observed: true }] }; } },
    './v16-ui-software-scope': { synchronizeSoftwareScope: async () => ({ context }) },
    './v16-ui-software-screen-reader': { openNvdaObserver: async () => { calls.push('reader-open'); if (options.openFailure) throw captureError; return reader; } },
    './v16-ui-software-governance': { collectSoftwareGovernance: async (_runtime, _writer, _binding, ports) => {
      if (ports?.blockedError) { calls.push('governance'); return { issues: [{ code: ports.blockedError.message }], deltas: Array.from({ length: 10 }, () => ({ status: 'UNVERIFIED', observations: {} })) }; }
      calls.push('governance'); if (options.sessionFailure) reader.sessionFailure = captureError;
      const failed = options.sessionFailure || options.independentGovernanceFailure;
      return { issues: failed ? [{ code: captureError.message }] : [], deltas: Array.from({ length: 10 }, () => ({
        status: failed ? 'UNVERIFIED' : 'OBSERVED_WITHOUT_APPROVAL', observations: failed ? {} : { keyboard: true, 'screen-reader': true, 'motion-zoom': true },
      })) };
    } },
    './v16-ui-software-recovery': { collectSoftwareRecovery: async () => { calls.push('recovery'); return { expectedFaultRecords: [], formalCredit: false }; }, readRuntimeLogs: () => [] },
    './v16-ui-software-integrity': { inspectFinalIdentity() {}, inspectRuntimeLogFailures: () => ({ unexpected: [], missingOrRepeatedExpected: [] }) },
    '../packages/shared-types/src/runtime-log-format.cjs': format,
  }, stderr);
  const value = await actual.collectSoftwareUi({ root: modelRoot, output: memory.writer.root, fixtureRecord: { path: path.join(modelRoot, 'fixture.json') },
    profile, screenReaderExecutable: path.join(modelRoot, 'nvda.exe') });
  return { ...value, ...memory, calls, captureError, stderr };
}

describe('R30真实治理失败会话与collector恢复边界', () => {
  it.each([1, 2])('第%s个真实reader节点失败后停止后续prepare和键盘且完整保留十项UNVERIFIED', async failAt => {
    const value = await governanceModel({ failAt });
    expect(value.result.deltas).toHaveLength(10); expect(value.result.deltas.every(delta => delta.status === 'UNVERIFIED')).toBe(true);
    expect(value.result.deltas.every(delta => delta.blocked?.code === 'UI_NVDA_CAPTURE_SESSION_UNUSABLE')).toBe(true);
    expect(value.result.deltas.every(delta => delta.blocked?.cause === value.captureError.message)).toBe(true);
    expect(value.result.deltas[0].observations.keyboard).toBeDefined();
    expect(value.result.deltas.slice(1).every(delta => Object.keys(delta.observations).length === 0)).toBe(true);
    expect(value.actions.filter(action => action.afterSessionFailure)).toEqual([]); expect(value.captures).toBe(failAt); expect(value.motions).toBe(0);
    expect(value.result.issues[0]).toMatchObject({ code: value.captureError.message }); expect(value.result.issues).toHaveLength(10);
    expect(value.result.pendingApprovals).toHaveLength(10); expect(value.result.pendingApprovals.every(item => item.status === 'PENDING')).toBe(true);
    expect(value.result.formalCredit).toBe(false);
  });
  it('已有真实sessionFailure时零prepare零键盘且十项均明确阻断而不删覆盖', async () => {
    const value = await governanceModel({ preFailed: true });
    expect(value.actions).toEqual([]); expect(value.captures).toBe(0); expect(value.motions).toBe(0);
    expect(value.result.deltas).toHaveLength(10); expect(value.result.issues).toHaveLength(10);
    expect(value.result.deltas.every(delta => delta.status === 'UNVERIFIED' && Object.keys(delta.observations).length === 0)).toBe(true);
  });
  it('真实reader首错的日志writer故障仍保留首错与全部阻断并走统一格式兜底', async () => {
    const value = await governanceModel({ failAt: 1, writerLogFailure: true });
    expect(value.result.issues[0]).toMatchObject({ code: value.captureError.message }); expect(value.result.deltas).toHaveLength(10);
    expect(value.actions.filter(action => action.afterSessionFailure)).toEqual([]);
    expect(value.stderr.some(row => row.event === 'v16.ui_primitive_session_log_failed')).toBe(true);
  });
  it('正常会话仍完整观测十项双节点与十次motion采集且不授人工批准', async () => {
    const value = await governanceModel();
    expect(value.result.issues).toEqual([]); expect(value.result.deltas).toHaveLength(10); expect(value.captures).toBe(20); expect(value.motions).toBe(10);
    expect(value.result.deltas.every(delta => delta.status === 'OBSERVED_WITHOUT_APPROVAL' && Object.keys(delta.observations).length === 3)).toBe(true);
    expect(value.result.pendingApprovals.every(item => item.status === 'PENDING')).toBe(true); expect(value.result.formalCredit).toBe(false);
  });
  it('无reader仍按原合同采键盘和motion并逐项记录未配置屏读', async () => {
    const value = await governanceModel({ noReader: true });
    expect(value.result.deltas).toHaveLength(10); expect(value.captures).toBe(0); expect(value.motions).toBe(10);
    expect(value.result.issues.every(issue => issue.code === 'UI_ACTUAL_SCREEN_READER_NOT_CONFIGURED')).toBe(true);
    expect(value.result.deltas.every(delta => !delta.blocked && Object.keys(delta.observations).length === 2)).toBe(true);
  });
  it('未标记sessionFailure的独立采集失败保持原后续治理合同', async () => {
    const value = await governanceModel({ failAt: 1, markFailure: false });
    expect(value.result.deltas).toHaveLength(10); expect(value.result.issues).toHaveLength(1); expect(value.captures).toBe(19); expect(value.motions).toBe(9);
    expect(value.result.deltas.slice(1).every(delta => delta.status === 'OBSERVED_WITHOUT_APPROVAL' && !delta.blocked)).toBe(true);
  });
  it.each([false, true])('collector真实失败会话不运行recovery且仅存UNVERIFIED原因并保留cleanup失败=%s的事实', async cleanupFailure => {
    const value = await collectorModel({ sessionFailure: true, cleanupFailure });
    expect(value.calls).toEqual(['matrix', 'reader-open', 'governance', 'reader-close', 'runtime-close']);
    expect(value.report.passed).toBe(false); expect(value.report.recovery).toBeUndefined(); expect(value.report.governance.deltas).toHaveLength(10);
    expect(value.report.issues).toContainEqual({ code: 'UI_RECOVERY_NOT_EXECUTED_READER_SESSION_UNUSABLE' });
    const unverified = value.json('recovery/unverified.json');
    expect(unverified).toMatchObject({ kind: 'v16-software-ui-recovery-unverified', status: 'UNVERIFIED', executed: false, formalCredit: false,
      code: 'UI_NVDA_CAPTURE_SESSION_UNUSABLE', cause: value.captureError.message });
    expect([...value.records.keys()].filter(file => file.includes(path.sep + 'recovery' + path.sep))).toEqual([value.report.recoveryUnverified.path]);
    expect(value.report.issues).toContainEqual({ code: value.captureError.message });
    if (cleanupFailure) expect(value.report.issues).toContainEqual({ code: 'UNIT_OWNED_STOP_FAILED' });
  });
  it('collector成功路径仍运行真实恢复入口并完整保留治理结果', async () => {
    const value = await collectorModel();
    expect(value.calls).toEqual(['matrix', 'reader-open', 'governance', 'recovery', 'reader-close', 'runtime-close']);
    expect(value.report.passed).toBe(true); expect(value.report.recovery).toBeDefined(); expect(value.report.recoveryUnverified).toBeUndefined();
    expect(value.report.governance.deltas).toHaveLength(10);
  });
  it('collector只有独立治理错误而无真实sessionFailure时仍按原合同运行恢复', async () => {
    const value = await collectorModel({ independentGovernanceFailure: true });
    expect(value.calls).toContain('recovery'); expect(value.report.passed).toBe(false); expect(value.report.recovery).toBeDefined();
    expect(value.report.recoveryUnverified).toBeUndefined();
  });
});

describe('正式setup失败的显式collector治理阻断', () => {
  it('真实governance收到open阶段首错后保留十项UNVERIFIED且零prepare焦点键盘motion', async () => {
    const value = await governanceModel({ setupBlocked: true });
    expect(value.actions).toEqual([]); expect(value.captures).toBe(0); expect(value.motions).toBe(0);
    expect(value.result.deltas).toHaveLength(10); expect(value.result.issues).toHaveLength(10);
    expect(value.result.deltas.every(row => row.status === 'UNVERIFIED' && Object.keys(row.observations).length === 0
      && row.blocked?.cause === value.captureError.message)).toBe(true);
    expect(value.result.pendingApprovals.every(row => row.status === 'PENDING')).toBe(true);
  });
  it('真实collector在reader open失败后不运行recovery且总是回收runtime', async () => {
    const value = await collectorModel({ openFailure: true });
    expect(value.calls).toEqual(['matrix', 'reader-open', 'governance', 'runtime-close']);
    expect(value.report.passed).toBe(false); expect(value.report.recovery).toBeUndefined();
    expect(value.report.governance.deltas).toHaveLength(10);
    expect(value.json('recovery/unverified.json')).toMatchObject({ status: 'UNVERIFIED', executed: false, formalCredit: false,
      cause: value.captureError.message });
  });
});
