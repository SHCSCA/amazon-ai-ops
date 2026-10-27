import fs from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import governance from './v16-ui-governance.js';
import { governanceFixture } from './v16-native-ui-governance-fixture.mjs';

const native = createRequire(import.meta.url)('./v16-native-artifacts.js');

const fixtures = [];
afterEach(() => fixtures.splice(0).forEach(fixture => fixture.cleanup()));
function fixture(options) { const value = governanceFixture(options); fixtures.push(value); return value; }
function changeRow(value, change) {
  value.changeSpeech(lines => {
    const line = lines[1]; change(line.actualNvdaRows[0], line);
    value.rewriteRaw(line.providerWitness, rows => { for (const row of line.actualNvdaRows) rows[row.rawIndex] = row; });
  });
}

describe('当前包无障碍治理原件校验', () => {
  it('仅接受十项登记、真实操作原件和逐项复核均绑定当前包的隔离夹具', () => {
    const value = fixture(), ledger = new Map();
    expect(native.withArtifactLedger(ledger, () => value.verify())).toBe(true);
    expect(ledger.size).toBe(255);
    expect([...ledger.values()].some(record => record.path === value.register.path)).toBe(true);
  });
  it('实际登记仍为PENDING时即使自报PASS也拒绝', () => {
    const value = fixture(); Object.assign(value.register, value.write('packet/register.md', value.source)); value.raw.register = { ...value.register };
    expect(() => value.verify()).toThrow('ACCESSIBILITY_REGISTER_HAS_PENDING_OR_FAILED_DELTA');
  });
  it('可信打包环境只读取固定治理原件并拒绝packet替换登记', () => {
    const value = fixture(); value.context.trustedNativeEnvironment = { uiGovernanceSource: { ...value.definition } };
    expect(value.verify()).toBe(true);
    value.raw.definitionSha256 = '0'.repeat(64);
    expect(() => value.verify()).toThrow('ACCESSIBILITY_DEFINITION_IS_NOT_CURRENT');
  });
  it('打包环境缺少固定治理原件时拒绝退回源码树', () => {
    const value = fixture(); value.context.trustedNativeEnvironment = {};
    expect(() => value.verify()).toThrow('TRUSTED_UI_GOVERNANCE_SOURCE_REQUIRED');
  });
  it.each(['owner', 'method'])('登记%s与原件负责人记录不一致时拒绝', field => {
    const value = fixture(); value.raw.deltas[0][field] = 'other';
    expect(() => value.verify()).toThrow('ACCESSIBILITY_OWNER_METHOD_MISMATCH');
  });
  it('缺项和重复primitive不能用总数或PASS摘要替代', () => {
    const value = fixture(); value.raw.deltas[1] = value.raw.deltas[0];
    expect(() => value.verify()).toThrow('ACCESSIBILITY_DELTA_INVENTORY_MISMATCH');
  });
  it.each(['pid', 'storeIdSha256', 'profileId'])('跨运行或跨店%s不能复用已验证UI', field => {
    const value = fixture(); value.raw.deltas[0][field] = field === 'pid' ? 456 : 'other';
    expect(() => value.verify()).toThrow('ACCESSIBILITY_RUNTIME_STORE_MISMATCH');
  });
  it('原始日志即使重封哈希也必须与当前原件运行身份一致', () => {
    const value = fixture();
    value.changeObservation('keyboard', observation => {
      const lines = fs.readFileSync(observation.log.path, 'utf8').split('\n').map(JSON.parse); lines[0].binding.runId = 'other';
      observation.log = value.write('packet/0/keyboard.jsonl', lines.map(line => JSON.stringify(line)).join('\n'));
    });
    expect(() => value.verify()).toThrow('ACCESSIBILITY_LOG_IDENTITY_MISMATCH');
  });
  it('旧包或过期时间的DOM原件不能因新汇总哈希通过', () => {
    const value = fixture(); value.changeObservation('keyboard', observation => value.update(observation.dom, dom => { dom.capturedAt = '2020-01-01T00:00:00Z'; }));
    expect(() => value.verify()).toThrow(/NATIVE_TIME_OUTSIDE_EXECUTION/);
  });
  it('原始键盘日志缺少焦点恢复或对话框约束时拒绝', () => {
    const value = fixture();
    value.changeObservation('keyboard', observation => {
      const lines = fs.readFileSync(observation.log.path, 'utf8').split('\n').map(JSON.parse); lines.splice(1, 1);
      observation.log = value.write('packet/3/keyboard.jsonl', lines.map(line => JSON.stringify(line)).join('\n'));
    }, 3);
    expect(() => value.verify()).toThrow('ACCESSIBILITY_KEYBOARD_SEQUENCE_MISSING');
  });
  it('只报ARIA通过但没有实际屏幕阅读器和逐节点读出时拒绝', () => {
    const value = fixture(); value.changeObservation('screen-reader', observation => { observation.engine.name = 'DOM-ARIA'; });
    expect(() => value.verify()).toThrow('ACCESSIBILITY_ACTUAL_SCREEN_READER_REQUIRED');
  });
  it('屏幕阅读器读出不得与DOM中的实际中文标签矛盾', () => {
    const value = fixture(); value.changeObservation('screen-reader', observation => {
      const lines = fs.readFileSync(observation.log.path, 'utf8').split('\n').map(JSON.parse); lines[1].spoken = 'unrelated';
      observation.log = value.write('packet/0/screen-reader.jsonl', lines.map(line => JSON.stringify(line)).join('\n'));
    });
    expect(() => value.verify()).toThrow('ACCESSIBILITY_SPOKEN_LABEL_MISMATCH');
  });
  it('缩放后被截断的控件和仍运行的动画均不得通过', () => {
    const value = fixture(); value.changeObservation('motion-zoom', observation => value.update(observation.viewports[0].dom, dom => { dom.nodes[0].bounds.x = 1199; }));
    expect(() => value.verify()).toThrow('ACCESSIBILITY_ZOOM_TARGET_CLIPPED');
    value.changeObservation('motion-zoom', observation => value.update(observation.viewports[0].dom, dom => { dom.animations[0].durationMs = 200; }));
    expect(() => value.verify()).toThrow('ACCESSIBILITY_STATIC_STATE_REQUIRED');
  });
  it('原始截图缺失或同路径改写立即拒绝', () => {
    const value = fixture(); const observation = JSON.parse(fs.readFileSync(value.raw.deltas[0].observations['motion-zoom'].path, 'utf8'));
    fs.writeFileSync(observation.viewports[0].screenshot.path, 'changed');
    expect(() => value.verify()).toThrow(/ARTIFACT_BYTES_CHANGED/);
    fs.unlinkSync(observation.viewports[0].screenshot.path);
    expect(() => value.verify()).toThrow(/ENOENT/);
  });
  it('其他工作包中的观察原件不能替换当前packet原件', () => {
    const value = fixture(); value.changeObservation('keyboard', observation => { observation.dom = value.json('outside/dom.json', JSON.parse(fs.readFileSync(observation.dom.path, 'utf8'))); });
    expect(() => value.verify()).toThrow(/ARTIFACT_OUTSIDE_OWNER/);
  });
  it('复核批准必须引用当前登记和全部观察原件哈希', () => {
    const value = fixture(); value.update(value.raw.deltas[0].approval, approval => { approval.observations[0].sha256 = '0'.repeat(64); });
    expect(() => value.verify()).toThrow('ACCESSIBILITY_CURRENT_APPROVAL_REQUIRED');
  });
  it.each(['keyboardFocusRisk', 'screenReaderRisk', 'motionZoomRisk', 'owner', 'method'])('快照不得通过偷改定义%s取得信用', field => {
    const value = fixture(); const definition = governance.parseUiGovernance(value.source);
    const text = fs.readFileSync(value.raw.register.path, 'utf8').replace(definition.accessibility[0][field], '被篡改的定义字段');
    value.raw.register = value.write('packet/register.md', text);
    expect(() => value.verify()).toThrow('ACCESSIBILITY_REGISTER_DEFINITION_CHANGED');
  });
  it('孤立PASS登记快照不能代替当前逐项原始操作和批准', () => {
    const value = fixture(); value.raw.deltas[0].observations = {};
    expect(() => value.verify()).toThrow('ARTIFACT_DIGEST_REQUIRED');
  });
  it('过期登记快照和另一包体身份均不能复用当前批准', () => {
    const value = fixture(); value.raw.registeredAt = '2020-01-01T00:00:00Z';
    expect(() => value.verify()).toThrow(/NATIVE_TIME_OUTSIDE_EXECUTION/);
    value.raw.registeredAt = value.context.execution.startedAt;
    value.raw.packageIdentity = { ...value.raw.packageIdentity, mainBundleSha256: 'f'.repeat(64) };
    expect(() => value.verify()).toThrow('ACCESSIBILITY_CURRENT_IDENTITY_REQUIRED');
  });
  it('不把局部交互验证升级为未经证明的WCAG等级', () => {
    const value = fixture(); value.raw.wcagLevel = 'AA';
    expect(() => value.verify()).toThrow('ACCESSIBILITY_WCAG_CLAIM_UNSUPPORTED');
  });
  it('NVDA拒绝缺少已验证同次包运行launch锚的旧正式协议', () => {
    const value = fixture(); delete value.ui.runs[0].nativeLaunch;
    expect(() => value.verify()).toThrow('ACCESSIBILITY_NVDA_CURRENT_NATIVE_LAUNCH_REQUIRED');
  });
  it('NVDA不得用witness另选的原件替换同次包运行launch引用', () => {
    const value = fixture(); value.changeSpeech(lines => { lines[1].providerWitness.nativeLaunch.sha256 = 'f'.repeat(64); });
    expect(() => value.verify()).toThrow('ACCESSIBILITY_NVDA_NATIVE_LAUNCH_REFERENCE_MISMATCH');
  });
  it('NVDA旧运行launch即使由当前ref重封也不能越过执行时间门', () => {
    const value = fixture(); value.update(value.ui.runs[0].nativeLaunch, launch => { launch.startedAt = '2020-01-01T00:00:00.000Z'; });
    expect(() => value.verify()).toThrow('NATIVE_TIME_OUTSIDE_EXECUTION');
  });
  it.each(['v16-nfr-native-launch', 'unknown-native-launch'])('正式NVDA入口拒绝%s原件kind并不采用自选策略', kind => {
    const value = fixture(); value.update(value.ui.runs[0].nativeLaunch, launch => { launch.kind = kind; });
    value.changeSpeech(lines => {
      lines[1].providerWitness.nativeLaunch = { ...value.ui.runs[0].nativeLaunch };
      value.changeProviderBinding(lines[1], binding => { binding.nativeLaunch = { ...value.ui.runs[0].nativeLaunch }; });
    });
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_NATIVE_LAUNCH_MISMATCH');
  });
  it('正式windows-direct隔离协议同样保留完整CIM与heldhandle出生门', () => {
    const value = fixture({ launchMethod: 'windows-direct' }); expect(value.verify()).toBe(true);
  });
  it.each(['windows-shell', 'windows-direct'])('正式%s缺失真实heldhandle出生原字段均不能退回PID-only', method => {
    const value = fixture(); value.update(value.ui.runs[0].nativeLaunch, launch => {
      launch.processBinding.method = method; delete launch.verification.mainExitObserver.handleCreationTimeUtc;
    });
    value.changeSpeech(lines => {
      lines[1].providerWitness.nativeLaunch = { ...value.ui.runs[0].nativeLaunch };
      value.changeProviderBinding(lines[1], binding => { binding.nativeLaunch = { ...value.ui.runs[0].nativeLaunch }; });
    });
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_NATIVE_LAUNCH_MISMATCH');
  });
  it('NVDA拒绝缺少当前reader原件锚且不接受witness自选替代', () => {
    const value = fixture(); delete value.ui.runs[0].readerLaunch;
    expect(() => value.verify()).toThrow('ACCESSIBILITY_NVDA_CURRENT_READER_LAUNCH_REQUIRED');
  });
  it('NVDA拒绝witness另选reader launch原件', () => {
    const value = fixture(); value.changeSpeech(lines => { lines[1].providerWitness.readerLaunch.sha256 = 'f'.repeat(64); });
    expect(() => value.verify()).toThrow('ACCESSIBILITY_NVDA_READER_LAUNCH_REFERENCE_MISMATCH');
  });
  it.each(['providerKind', 'providerPids'])('NVDA拒绝伪造provider协议字段%s', field => {
    const value = fixture(); value.changeSpeech(lines => value.changeProviderBinding(lines[1], binding => {
      if (field === 'providerKind') binding.providerKind = 'any-main-or-renderer'; else binding.providerPids = [123, 456];
    }));
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_BINDING_INVALID');
  });
  it.each(['creationTimeUtc', 'handleCreationTimeUtc'])('NVDA同PID旧Main出生字段%s不能由匹配自报替代原launch', field => {
    const value = fixture(); value.changeSpeech(lines => value.changeProviderBinding(lines[1], binding => { binding.main[field] = '2020-01-01T00:00:00.0000000Z'; }));
    expect(() => value.verify()).toThrow(/UI_NVDA_PROVIDER_(BINDING_INVALID|NATIVE_LAUNCH_MISMATCH)/);
  });
  it('NVDA拒绝重封全部观察但与独立原launch不同的Renderer出生时间', () => {
    const value = fixture(); value.changeSpeech(lines => value.changeProviderBinding(lines[1], binding => { binding.renderer.creationTime -= 1; }));
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_NATIVE_LAUNCH_MISMATCH');
  });
  it.each(['id', 'url'])('NVDA拒绝同Main但BrowserWindow原字段%s不同', field => {
    const value = fixture(); value.changeSpeech(lines => value.changeProviderBinding(lines[1], binding => {
      binding.window[field] = field === 'id' ? 2 : 'file:///foreign-window/index.html';
    }));
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_NATIVE_LAUNCH_MISMATCH');
  });
  it('NVDA同Main的另一root HWND不能由逐节点匹配自报替代reader原快照', () => {
    const value = fixture(); value.changeSpeech(lines => value.changeProviderBinding(lines[1], binding => { binding.window.rootHwnd = '2000'; }));
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_RUNTIME_SNAPSHOT_MISMATCH');
  });
  it('NVDA StoreContext当前店铺必须对应已验证UI的实际店铺哈希', () => {
    const value = fixture(); value.changeSpeech(lines => value.changeProviderBinding(lines[1], binding => { binding.storeContext.storeId = 'other-store'; }));
    expect(() => value.verify()).toThrow('ACCESSIBILITY_NVDA_STORE_MISMATCH');
  });
  it.each(['focusPid', 'focusOwnerPid', 'rootOwnerPid', 'ancestorHwnd', 'foregroundHwnd', 'isChild', 'mainAlive'])('NVDA原生关系字段%s不属当前唯一Main窗口时拒绝', field => {
    const value = fixture(); changeRow(value, row => { row[field] = ['isChild', 'mainAlive'].includes(field) ? false : field.endsWith('Pid') ? 456 : '2000'; });
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_NATIVE_WINDOW_MISMATCH');
  });
  it('NVDA允许focus HWND等于同根窗口并继续要求所有身份门', () => {
    const value = fixture(); changeRow(value, row => { row.focusHwnd = '1000'; row.isChild = false; });
    expect(value.verify()).toBe(true);
  });
  it('NVDA拒绝把DOM聚合标签当作缺失actual raw行的语音', () => {
    const value = fixture(); value.changeSpeech(lines => { lines[1].actualNvdaRows = []; });
    expect(() => value.verify()).toThrow(/ACCESSIBILITY_NVDA_ENGINE_OR_OBSERVATION_TIME_MISMATCH|UI_NVDA_PROVIDER_ACTUAL_SPEECH_REQUIRED/);
  });
  it('NVDA实际raw原件仅ready一行仍不能使用嵌入的spoken-node授信', () => {
    const value = fixture(); value.changeSpeech(lines => value.rewriteRaw(lines[1].providerWitness, rows => { rows.splice(1); }));
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_RAW_ORIGINAL_REQUIRED');
  });
  it.each(['nvda-observer-ready', 'nvda-gain-focus', 'nvda-metadata-event'])('NVDA仅%s行不能冒充pre_synthSpeak实际语音', kind => {
    const value = fixture(); changeRow(value, row => { row.kind = kind; });
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_RAW_ROW_MISMATCH');
  });
  it('NVDA拒绝嵌入行与实际raw原件不同', () => {
    const value = fixture(); value.changeSpeech(lines => { lines[1].actualNvdaRows[0].spoken += ' 伪造附文'; });
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_RAW_ROW_MISMATCH');
  });
  it.each(['readerLaunch', 'rawSpeech'])('NVDA缺失%s原件仍须真实读取并拒绝', field => {
    const value = fixture(); value.changeSpeech(lines => { fs.unlinkSync(lines[1].providerWitness[field].path); });
    expect(() => value.verify()).toThrow(/ENOENT/);
  });
  it('NVDA语音raw快照仍必须属于当前packet的原件目录', () => {
    const value = fixture(); value.changeSpeech(lines => {
      const witness = lines[1].providerWitness;
      witness.rawSpeech = value.write('outside/foreign-speech.jsonl', fs.readFileSync(witness.rawSpeech.path));
    });
    expect(() => value.verify()).toThrow('ARTIFACT_OUTSIDE_OWNER');
  });
  it('NVDA版本汇总必须对应同次实际ready原件', () => {
    const value = fixture(); value.changeObservation('screen-reader', observation => { observation.engine.version = 'forged-version'; });
    expect(() => value.verify()).toThrow('ACCESSIBILITY_NVDA_ENGINE_OR_OBSERVATION_TIME_MISMATCH');
  });
  it.each(['Narrator', 'JAWS'])('NVDA实际payload不能改成%s汇总绕开provider合同', name => {
    const value = fixture(); value.changeObservation('screen-reader', observation => { observation.engine.name = name; });
    expect(() => value.verify()).toThrow('ACCESSIBILITY_NVDA_ENGINE_PAYLOAD_MISMATCH');
  });
  it('NVDA reader launch原件就绪身份不符时不能用raw自报弥补', () => {
    const value = fixture(); value.changeSpeech(lines => value.updateReader(lines[1].providerWitness, reader => { reader.ready.pid = 999; }));
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_READER_ORIGINAL_MISMATCH');
  });
  it('NVDA实际语音PID必须等于原reader ready而非其它NVDA进程', () => {
    const value = fixture(); changeRow(value, row => { row.pid = 999; });
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_RAW_ROW_MISMATCH');
  });
  it('NVDA两不同节点不能复用同nonce', () => {
    const value = fixture(); value.changeSpeech(lines => {
      const line = lines[2]; line.providerWitness.request.nonce = lines[1].providerWitness.request.nonce;
      line.actualNvdaRows[0].request.nonce = line.providerWitness.request.nonce;
      value.rewriteRaw(line.providerWitness, rows => { rows[line.actualNvdaRows[0].rawIndex] = line.actualNvdaRows[0]; });
    });
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_NODE_NONCE_REUSED');
  });
  it('NVDA新nonce也不能倒退同run节点序号', () => {
    const value = fixture(); value.changeSpeech(lines => {
      const line = lines[2]; line.providerWitness.request.sequence = lines[1].providerWitness.request.sequence;
      line.actualNvdaRows[0].request.sequence = line.providerWitness.request.sequence;
      value.rewriteRaw(line.providerWitness, rows => { rows[line.actualNvdaRows[0].rawIndex] = line.actualNvdaRows[0]; });
    });
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_SEQUENCE_OR_READER_CHANGED');
  });
  it.each(['focusName', 'focusRole', 'spoken'])('NVDA实际字段%s与当前DOM名或角色不同不能使用聚合中文标签授信', field => {
    const value = fixture(); changeRow(value, row => { row[field] = '不对应的真实字段'; });
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_ACTUAL_NAME_OR_ROLE_MISMATCH');
  });
  it('NVDA聚合spoken必须逐字等于actual raw语音的合并', () => {
    const value = fixture(); value.changeSpeech(lines => { lines[1].spoken += ' 额外自报'; });
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_AGGREGATE_MISMATCH');
  });
  it.each(['rawOffset', 'timestamp', 'deadlineAt'])('NVDA旧行或超原十秒请求%s不能靠重封哈希通过', field => {
    const value = fixture(); changeRow(value, (row, line) => {
      if (field === 'rawOffset') { line.providerWitness.request.rawOffset = row.rawIndex + 1; row.request.rawOffset = row.rawIndex + 1; }
      else if (field === 'timestamp') { row.timestamp = '2020-01-01T00:00:00.000Z'; line.timestamp = row.timestamp; }
      else { const deadlineAt = new Date(Date.parse(row.request.startedAt) + 10_001).toISOString(); row.request.deadlineAt = deadlineAt; line.providerWitness.request.deadlineAt = deadlineAt; }
    });
    expect(() => value.verify()).toThrow(/UI_NVDA_PROVIDER_(RAW_ROW_MISMATCH|TIME_INVALID|REQUEST_INVALID)|ACCESSIBILITY_LOG_ORDER_INVALID|NATIVE_TIME_OUTSIDE_EXECUTION/);
  });
  it('NVDA DOM焦点后读取不能改成同名的另一节点', () => {
    const value = fixture(); value.changeSpeech(lines => { lines[1].providerWitness.hostAfter.dom.activeElementId = 'foreign-control'; });
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_CURRENT_DOM_OR_RENDERER_MISMATCH');
  });
  it('NVDA目标前后Renderer身份变化不能以相同DOM名称忽略', () => {
    const value = fixture(); value.changeSpeech(lines => { lines[1].providerWitness.hostAfter.binding.renderer.creationTime -= 1; });
    expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_CURRENT_DOM_OR_RENDERER_MISMATCH');
  });
  it('NVDA不能把观察捕获时间写在实际后验之前取得提前批准', () => {
    const value = fixture(); value.changeObservation('screen-reader', observation => { observation.capturedAt = value.context.execution.startedAt; });
    expect(() => value.verify()).toThrow('ACCESSIBILITY_NVDA_CAPTURE_PREDATES_OBSERVATION');
  });
});

// 仅验证真实治理函数的绑定序列化端口，不构成原生采集或正式批准证据。
async function collectProducerBindingProtocol(base) {
  const vm = await import('node:vm'), records = new Map(), errors = [];
  let activeId, controls;
  class BindingLocator {
    constructor(kind, number = 0) { this.kind = kind; this.number = number; }
    async evaluate(callback, id) {
      this.id = id;
      return { id, role: this.kind === 'root' ? 'dialog' : 'button', name: this.kind === 'trigger' ? '返回操作' : '业务节点' + this.number,
        focusable: true, bounds: { x: 10 + this.number * 100, y: 20, width: 80, height: 30 } };
    }
    async focus() { activeId = this.id; }
    async waitFor() {}
    async isEnabled() { return true; }
    async isVisible() { return true; }
    async count() { return 1; }
    async getAttribute(name) { return this.kind === 'root' ? ({ role: 'dialog', tabindex: '-1', 'aria-labelledby': 'unit-binding-inspector-title' }[name] ?? null) : null; }
    async click() {}
    filter() { return this; }
    first() { return this; }
    getByRole(_, options) { return this.kind === 'root' && options?.name === '关闭详情检查器' ? nodes[0] : trigger; }
    locator() { return controls; }
  }
  const trigger = new BindingLocator('trigger'), rootLocator = new BindingLocator('root');
  const nodes = [new BindingLocator('control', 0), new BindingLocator('control', 1)];
  controls = { filter() { return this; }, count: async () => nodes.length, first: () => nodes[0], nth: number => nodes[number],
    evaluateAll: async callback => callback(nodes.map(() => ({ tabIndex: 0, matches: () => false, closest: () => null }))) };
  const page = { getByRole: () => trigger,
    locator: selector => selector === '[role="dialog"],[role="alertdialog"]' ? { filter() { return this; }, count: async () => 0 }
      : selector.includes('.app-sidebar [data-operator-entry]') ? trigger : rootLocator,
    evaluate: async () => activeId,
    waitForFunction: async (_, id) => { if (activeId !== id) throw new Error('UNIT_BINDING_FOCUS_MISMATCH'); },
    keyboard: { press: async key => {
      if (key === 'Escape') activeId = trigger.id;
      else if (key === 'Tab' || key === 'Shift+Tab') {
        const position = nodes.findIndex(node => node.id === activeId);
        activeId = nodes[(position + (key === 'Tab' ? 1 : nodes.length - 1)) % nodes.length].id;
      }
    } } };
  const writer = {
    write(name, bytes) {
      const value = Buffer.from(bytes), record = { path: 'unit-binding/' + name, sha256: native.digest(value), sizeBytes: value.length };
      records.set(record.path, value); return record;
    },
    json(name, value) { return this.write(name, JSON.stringify(value)); },
    log(event, error) { errors.push({ event, error }); },
  };
  const dependencies = { 'node:fs': fs, 'node:path': createRequire(import.meta.url)('node:path'),
    './v16-performance-artifacts': { digest: native.digest, insist: native.insist, fileRecord() { throw new Error('UNIT_UNEXPECTED_FILE_RECORD'); } },
    './v16-ui-governance': governance,
    './v16-ui-accessible-node': { describeAccessibleElement: (locator, id) => locator.evaluate(null, id),
      refreshAccessibleElement: (locator, node) => locator.evaluate(null, node.id) },
    './v16-ui-reader-target-setup': { prepareReaderTarget: async () => undefined },
    './v16-ui-software-motion': { captureMotionZoom: async (_, writer, binding, label) => writer.json(label + '/motion-binding.json', { binding }) } };
  const file = new URL('./v16-ui-software-governance.js', import.meta.url), module = { exports: {} };
  const requirePort = name => { if (!(name in dependencies)) throw new Error('UNIT_UNEXPECTED_BINDING_DEPENDENCY:' + name); return dependencies[name]; };
  vm.runInThisContext('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file.pathname })(requirePort, module, module.exports);
  const actual = module.exports;
  const reader = { capture: async (_, __, node) => {
    const row = { timestamp: new Date().toISOString(), spoken: '按钮 ' + node.name };
    return { rows: [row], observedAt: row.timestamp, engine: { name: 'NVDA', version: 'isolated-unit-only' }, providerWitness: { isolatedUnitOnly: true } };
  } };
  const result = await actual.collectSoftwareGovernance({ page, identity: { pid: base.pid } }, writer, base, {
    root: process.cwd(), screenReader: reader,
    ui: { EXPECTED_PACKAGE_UI_ENTRIES: actual.CATALOG.map(item => { const [workspace, subview] = item.entry.split('/'); return { workspace, subview }; }),
      navigateToWorkspace: async () => undefined },
  });
  const json = record => JSON.parse(records.get(record.path).toString('utf8'));
  const log = record => records.get(record.path).toString('utf8').trim().split('\n').map(JSON.parse);
  return { result, errors, json, log };
}

function formalBindingOrder(base, primitive, definitionSha256) {
  return { primitive, runId: base.runId, uiRunGroupId: base.uiRunGroupId, sourceSha256: base.sourceSha256,
    packageIdentity: base.packageIdentity, profileId: base.profileId, pid: base.pid, storeIdSha256: base.storeIdSha256,
    governanceDefinitionSha256: definitionSha256, registerSha256: definitionSha256 };
}

describe('真实governance producer与formal binding序列化合同', () => {
  it.each(['software-order', 'reversed-input-order'])('真实producer在%s下保持formal消费者的字段和值与精确键序', async order => {
    const core = { runId: 'unit-binding-run', uiRunGroupId: 'unit-binding-group', profileId: 'unit-profile', pid: 123,
      storeIdSha256: '4'.repeat(64), sourceSha256: '5'.repeat(64), packageIdentity: { executableSha256: '1'.repeat(64), appContentSha256: '2'.repeat(64), mainBundleSha256: '3'.repeat(64) } };
    const base = order === 'software-order' ? core : Object.fromEntries(Object.entries(core).reverse());
    const value = await collectProducerBindingProtocol(base);
    expect(value.errors).toEqual([]); expect(value.result.issues).toEqual([]); expect(value.result.deltas).toHaveLength(10);
    for (const delta of value.result.deltas) {
      const expected = formalBindingOrder(base, delta.primitive, value.result.definition.sha256);
      for (const category of ['keyboard', 'screen-reader', 'motion-zoom']) {
        const observation = value.json(delta.observations[category]);
        expect(Object.keys(observation.binding)).toEqual(Object.keys(expected));
        expect(native.same(observation.binding, expected)).toBe(true);
        if (observation.dom) expect(native.same(value.json(observation.dom).binding, expected)).toBe(true);
        if (observation.log) for (const row of value.log(observation.log)) expect(native.same(row.binding, expected)).toBe(true);
      }
    }
    expect(value.result.formalCredit).toBe(false);
    expect(value.result.pendingApprovals.every(item => item.status === 'PENDING')).toBe(true);
  });
  it.each(['unexpectedBindingField', '__proto__'])('真实producer保留未知%s并由formal原有身份门拒绝而非静默strip', async extra => {
    const value = fixture(), base = { runId: value.raw.runId, uiRunGroupId: value.raw.uiRunGroupId, sourceSha256: value.raw.sourceSha256,
      packageIdentity: value.raw.packageIdentity, profileId: '100-compact', pid: 123, storeIdSha256: value.ui.runs[0].session.storeAuthorityReadback.actualIdSha256,
      [extra]: '必须保留的未知字段' };
    const produced = await collectProducerBindingProtocol(base);
    expect(produced.errors).toEqual([]); expect(produced.result.issues).toEqual([]);
    const delta = produced.result.deltas[0], binding = produced.json(delta.observations.keyboard).binding;
    expect(Object.hasOwn(binding, extra)).toBe(true); expect(binding[extra]).toBe(base[extra]);
    const expected = formalBindingOrder(base, delta.primitive, produced.result.definition.sha256);
    expect(native.same(binding, expected)).toBe(false);
    const known = Object.fromEntries(Object.entries(binding).filter(([key]) => key !== extra));
    expect(native.same(known, expected)).toBe(true);
    value.changeObservation('keyboard', observation => { observation.binding = { ...observation.binding, [extra]: binding[extra] }; });
    expect(() => value.verify()).toThrow('ACCESSIBILITY_ORIGINAL_IDENTITY_MISMATCH');
  });
});
describe('正式motion所属几何见证', () => {
  it.each([1, 1.25])('DSF=%s的同窗125%与最小外框原件保持完整治理门', deviceScaleFactor => {
    const value = fixture({ deviceScaleFactor }), ledger = new Map();
    expect(native.withArtifactLedger(ledger, () => value.verify())).toBe(true);
    expect(ledger.size).toBe(255);
    const observation = JSON.parse(fs.readFileSync(value.raw.deltas[0].observations['motion-zoom'].path, 'utf8'));
    const minimum = JSON.parse(fs.readFileSync(observation.viewports[1].dom.path, 'utf8'));
    expect(minimum.geometryWitness.before.bounds).toMatchObject({ width: 1200, height: deviceScaleFactor === 1 ? 700 : 702 });
    expect(minimum.viewport).toMatchObject({ width: Math.ceil((deviceScaleFactor === 1 ? 1184 : 1188) * deviceScaleFactor),
      height: Math.ceil((deviceScaleFactor === 1 ? 633 : 643) * deviceScaleFactor) });
  });
  it.each([null, '46.0.0'])('launch未有当前可信44.2.0版本%s时不能用witness自报补齐', electronVersion => {
    const value = fixture({ electronVersion });
    expect(() => value.verify()).toThrow('ACCESSIBILITY_MOTION_OWNED_RUN_REQUIRED');
  });
  it('旧motion DOM没有新见证时拒绝而不补写历史字段', () => {
    const value = fixture();
    value.changeObservation('motion-zoom', observation => value.update(observation.viewports[0].dom, dom => {
      dom.schemaVersion = 'v16.accessibility-dom/1'; delete dom.geometryWitness;
    }));
    expect(() => value.verify()).toThrow('ACCESSIBILITY_DOM_SCHEMA_INVALID');
  });
  it('真实像素不能反推出viewport比例并绕过独立DPR', () => {
    const value = fixture();
    value.changeObservation('motion-zoom', observation => value.update(observation.viewports[0].dom, dom => {
      dom.cssToPhysicalFactor = dom.viewport.width / dom.geometryWitness.before.renderer.innerWidth;
    }));
    expect(() => value.verify()).toThrow('ACCESSIBILITY_VIEWPORT_NOT_OBSERVED');
  });
  it.each([
    ['owned renderer', dom => { dom.geometryWitness.after.rendererPid++; }],
    ['empty force', dom => { dom.geometryWitness.before.forceDeviceScaleFactor = ''; dom.geometryWitness.after.forceDeviceScaleFactor = ''; }],
    ['DPR', dom => { dom.geometryWitness.before.renderer.devicePixelRatio = 1; dom.geometryWitness.after.renderer.devicePixelRatio = 1; }],
    ['native size', dom => { dom.geometryWitness.nativeSize.height--; }],
  ])('%s矛盾不能因重封观察和批准hash取得正式信用', (_, change) => {
    const value = fixture(); value.changeObservation('motion-zoom', observation => value.update(observation.viewports[0].dom, change));
    expect(() => value.verify()).toThrow(/owned motion geometry/);
  });
  it('控件同时受原CSS边界和DPR映射约束', () => {
    const value = fixture(); value.changeObservation('motion-zoom', observation => value.update(observation.viewports[0].dom, dom => {
      dom.nodes[0].cssBounds.width = 2000;
    }));
    expect(() => value.verify()).toThrow('ACCESSIBILITY_ZOOM_TARGET_CLIPPED');
  });
});
describe('motion真实裁切边界', () => {
  it.each(['right', 'bottom'])('CSS及物理坐标保持一致但跨%s边界仍拒绝', edge => {
    const value = fixture(); value.changeObservation('motion-zoom', observation => value.update(observation.viewports[0].dom, dom => {
      const renderer = dom.geometryWitness.before.renderer, node = dom.nodes[0];
      if (edge === 'right') node.cssBounds.x = renderer.innerWidth - node.cssBounds.width / 2;
      else node.cssBounds.y = renderer.innerHeight - node.cssBounds.height / 2;
      node.bounds = Object.fromEntries(Object.entries(node.cssBounds).map(([field, number]) => [field, number * renderer.devicePixelRatio]));
    }));
    expect(() => value.verify()).toThrow('ACCESSIBILITY_ZOOM_TARGET_CLIPPED');
  });
});
describe('既有wide固定profile的motion合同', () => {
  it('wide实际结构缺scalePercent但固定DSF1时仍核所属几何', () => {
    const value = fixture({ wide: true });
    expect(value.ui.wideProfile.scalePercent).toBeUndefined(); expect(value.ui.wideProfile.actualDeviceScaleFactor).toBe(1);
    expect(value.verify()).toBe(true);
  });
  it('未知scale不能借wide标签取得fallback', () => {
    const value = fixture({ wide: true, deviceScaleFactor: 1.25 });
    expect(() => value.verify()).toThrow('ACCESSIBILITY_MOTION_OWNED_RUN_REQUIRED');
  });
});

describe('motion v2正式消费者的原始采样接线', () => {
  it('旧DOM/2即使携带v2见证也不能取得新正式信用', () => {
    const value = fixture();
    value.changeObservation('motion-zoom', observation => value.update(observation.viewports[0].dom, dom => {
      dom.schemaVersion = 'v16.accessibility-motion-dom/2';
    }));
    expect(() => value.verify()).toThrow('ACCESSIBILITY_DOM_SCHEMA_INVALID');
  });
  it.each([
    ['tool digest', dom => { dom.geometryWitness.nativeBefore.invocation.tool.sha256 = '0'.repeat(64); }, 'ACCESSIBILITY_MOTION_NATIVE_TOOL_MISMATCH'],
    ['tool path', dom => { dom.geometryWitness.nativeBefore.invocation.tool.path = 'G:\\isolated\\other.ps1'; }, 'ACCESSIBILITY_MOTION_NATIVE_TOOL_MISMATCH'],
    ['executable', dom => { dom.geometryWitness.nativeAfter.invocation.command.executable = 'G:\\isolated\\other.exe'; }, 'ACCESSIBILITY_MOTION_NATIVE_TOOL_MISMATCH'],
    ['inline raw', dom => { dom.geometryWitness.nativeBefore.native.passed = false; }, 'ACCESSIBILITY_MOTION_NATIVE_RAW_MISMATCH'],
  ])('%s不能因重封DOM/观察/批准hash绕过原始文件', (_, change, expectedError) => {
    const value = fixture();
    value.changeObservation('motion-zoom', observation => value.update(observation.viewports[0].dom, change));
    expect(() => value.verify()).toThrow(expectedError);
  });
});

describe('motion原生可见交集的正式裁切门', () => {
  it.each(['right', 'bottom'])('PNG内且CSS合法但跨可见%s边界的最后半像素仍拒绝', edge => {
    const value = fixture({ deviceScaleFactor: 1.25 });
    value.changeObservation('motion-zoom', observation => value.update(observation.viewports[1].dom, dom => {
      const raw = dom.geometryWitness.nativeBefore.native.native;
      const client = raw.primaryBefore.clientRectScreenPhysicalPx;
      const widget = raw.children.find(row => row.hwnd === raw.childInventoryVerdict.selectedWidgetHwnd)
        .beforeQueries.windowRect.outRectScreenPhysicalPx;
      const visible = { width: Math.min(client.right, widget.right) - Math.max(client.left, widget.left),
        height: Math.min(client.bottom, widget.bottom) - Math.max(client.top, widget.top) };
      const axis = edge === 'right' ? 'width' : 'height';
      expect(visible[axis]).toBeLessThan(dom.viewport[axis]);
      const node = dom.nodes[0], factor = dom.geometryWitness.before.renderer.devicePixelRatio;
      node.bounds = { x: edge === 'right' ? visible.width - 0.5 : 20,
        y: edge === 'bottom' ? visible.height - 0.5 : 20, width: 1, height: 1 };
      node.cssBounds = Object.fromEntries(Object.entries(node.bounds).map(([field, number]) => [field, number / factor]));
      expect(node.bounds.x + node.bounds.width).toBeLessThanOrEqual(dom.viewport.width);
      expect(node.bounds.y + node.bounds.height).toBeLessThanOrEqual(dom.viewport.height);
      expect(node.cssBounds.x + node.cssBounds.width).toBeLessThanOrEqual(dom.geometryWitness.before.renderer.innerWidth);
      expect(node.cssBounds.y + node.cssBounds.height).toBeLessThanOrEqual(dom.geometryWitness.before.renderer.innerHeight);
    }));
    expect(() => value.verify()).toThrow('ACCESSIBILITY_ZOOM_TARGET_CLIPPED');
  });
});
