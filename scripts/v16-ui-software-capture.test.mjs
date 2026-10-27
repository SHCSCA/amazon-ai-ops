import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import governance from './v16-ui-governance.js';
import primitives from './v16-ui-software-governance.js';
import cli from './capture-v16-ui-software.js';
import speech from './v16-ui-software-screen-reader.js';
import artifacts from './v16-performance-artifacts.js';
import ui from './package-ui-evidence.js';
import collector from './v16-ui-software-collector.js';
import motion from './v16-ui-software-motion.js';
import motionMain from './v16-ui-motion-main.js';
import recovery from './v16-ui-software-recovery.js';
import { bundleProductionActionFixture, openProductionActionFixture } from '../apps/desktop/src/renderer/mission-control/workspaces/production-action-browser.test-support';

function newDirectory(label) { return path.join(os.tmpdir(), `amazon-ai-ops-ui-unit-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`); }
describe('native software UI producer boundaries', () => {
  it('covers exactly the ten frozen governance primitives through canonical production routes', () => {
    const source = fs.readFileSync(path.resolve(governance.SOURCE), 'utf8');
    expect(primitives.CATALOG.map(item => item.primitive).sort()).toEqual(governance.parseUiGovernance(source).accessibility.map(item => item.primitive).sort());
    expect(primitives.CATALOG.every(item => !/preview|scenario|localhost/.test(JSON.stringify(item)))).toBe(true);
    expect(Array.isArray(ui.EXPECTED_PACKAGE_UI_ENTRIES)).toBe(true);
    for (const name of ['navigateToWorkspace', 'exerciseWorkspaceTabKeyboard', 'waitForRendererComposite',
      'captureViewportScreenshot', 'readPngDimensions', 'setElectronViewport']) {
      expect(typeof ui[name], name).toBe('function');
    }
  });
  it('rejects preview URLs, arbitrary runtime arguments, duplicate flags and missing isolated profiles', () => {
    for (const argv of [['--url', 'http://localhost:1'], ['--app-executable', 'arbitrary.exe'], ['--fixture', 'x', '--fixture', 'y'], []]) {
      expect(() => cli.parseArguments(argv)).toThrow();
    }
  });
  it('does not silently discard corrupted completed NVDA transcript records', () => {
    const directory = newDirectory('transcript'); fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'speech.jsonl');
    fs.writeFileSync(file, '{"kind":"nvda-synth-speech","spoken":"真实读出"}\n{"pending":');
    expect(speech.readSpeech(file)).toEqual([{ kind: 'nvda-synth-speech', spoken: '真实读出' }]);
    fs.writeFileSync(file, '{"kind":"nvda-synth-speech"}\ninvalid\n');
    expect(() => speech.readSpeech(file)).toThrow();
  });
  it('requires a real current source and preserves a NON_READY failure original before starting any native process', async () => {
    const inputRoot = newDirectory('bad-input'); fs.mkdirSync(inputRoot, { recursive: true });
    const fixture = path.join(inputRoot, 'fixture.json'); fs.writeFileSync(fixture, JSON.stringify({ sourceSha256: '0'.repeat(64), packageHashes: {} }));
    const output = newDirectory('failure-original');
    const result = await collector.collectSoftwareUi({ fixtureRecord: artifacts.fileRecord(fixture), output, profile: newDirectory('profile') });
    expect(result.report.passed).toBe(false); expect(result.report.status).toBe('NON_READY'); expect(result.report.formalCredit).toBe(false);
    expect(result.report.issues).toContainEqual({ code: 'UI_SOFTWARE_FIXTURE_SOURCE_IS_NOT_CURRENT' });
    expect(fs.existsSync(path.join(output, 'collector.jsonl'))).toBe(true); expect(fs.existsSync(result.artifact.path)).toBe(true);
  }, 30_000);
  it('captures actual shared ReasonRequiredDialog keyboard focus, wrap, Escape and trigger restoration in Chromium', async () => {
    const contents = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{ReasonRequiredDialog}from'../../components/workspace';
      function App(){const[open,setOpen]=useState(false);return <><button id="trigger" onClick={()=>setOpen(true)}>打开业务原因</button><ReasonRequiredDialog open={open} title="业务原因核验" confirmLabel="确认" onConfirm={()=>{}} onClose={()=>setOpen(false)} description="仅组件隔离测试，不提交业务。" /></>;}createRoot(document.getElementById('root')).render(<App/>);`;
    const { browser, page } = await openProductionActionFixture(await bundleProductionActionFixture(contents));
    try {
      const trigger = page.getByRole('button', { name: '打开业务原因' });
      const triggerNode = await primitives.describeElement(trigger, 'reason-trigger'); await trigger.click();
      const writer = artifacts.createArtifactWriter(newDirectory('keyboard'));
      const evidence = await primitives.captureKeyboard({ page }, { trigger, triggerNode, root: page.getByRole('alertdialog') }, { primitive: 'ReasonRequiredDialog' }, writer, 'reason');
      const rows = fs.readFileSync(evidence.log.path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(rows.map(row => row.event)).toEqual(['focus-enter', 'tab-wrap', 'shift-tab-wrap', 'escape', 'focus-return']);
      expect(rows.every(row => row.targetId === row.activeElementId)).toBe(true);
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('trigger');
    } finally { await browser.close(); }
  }, 30_000);
  it('rereads both viewport nodes in one frame and rejects a stale offscreen first bound after scrolling', async () => {
    const contents = `import React from'react';import{createRoot}from'react-dom/client';createRoot(document.getElementById('root')).render(<div><button data-v16-a11y-node="first">第一个真实控件</button><div style={{height:2000}}/><button data-v16-a11y-node="last">最后一个真实控件</button></div>);`;
    const { browser, page } = await openProductionActionFixture(await bundleProductionActionFixture(contents));
    try {
      await page.locator('[data-v16-a11y-node="first"]').waitFor();
      expect(await motion.readSameFrameBounds(page, ['first'])).toEqual([expect.objectContaining({ id: 'first', visible: true })]);
      await page.locator('[data-v16-a11y-node="last"]').scrollIntoViewIfNeeded();
      await expect(motion.readSameFrameBounds(page, ['first', 'last'])).rejects.toThrow('NOT_VISIBLE_IN_SAME_FRAME');
      expect(await motion.readSameFrameBounds(page, ['last'])).toEqual([expect.objectContaining({ id: 'last', visible: true })]);
    } finally { await browser.close(); }
  }, 30_000);
  it('closes an opened recovery database after initialization fails and logs a faithful failed report', async () => {
    for (const stage of ['construct', 'pragma', 'count', 'count-and-close']) {
      const directory = newDirectory('initialize-' + stage), original = new Error('recovery initialization failed: ' + stage);
      const cleanupFailure = new Error('recovery close failed');
      const calls = [], writer = { log: (...args) => calls.push(args) };
      let connection;
      class Database {
        constructor() { if (stage === 'construct') throw original; connection = this; this.open = true; this.closed = 0; }
        pragma() { if (stage === 'pragma') throw original; }
        prepare() { throw original; }
        close() { this.open = false; this.closed++; if (stage === 'count-and-close') throw cleanupFailure; }
      }
      const runtime = { userDataDir: directory, identity: { pid: 1 }, page: {
        evaluate: async fn => fn.toString().includes('getStoragePaths') ? { localDbPath: path.join(directory, 'amazon-ai-ops.db') } : { storeId: 'software-store' },
        getByRole: () => ({}),
      } };
      let observed;
      try { await recovery.collectSoftwareRecovery(runtime, { classification: 'isolated-software-fixture', formalCredit: false, storeIds: ['software-store'] },
        writer, {}, { EXPECTED_PACKAGE_UI_ENTRIES: [{ workspace: 'memory' }], navigateToWorkspace: async () => undefined }, { Database }); }
      catch (error) { observed = error; }
      if (stage === 'count-and-close') expect(observed.errors).toEqual([original, cleanupFailure]);
      else expect(observed).toBe(original);
      if (stage !== 'construct') { expect(connection.open).toBe(false); expect(connection.closed).toBe(1); }
      expect(calls.some(([event, error]) => event === 'v16.ui_recovery_capture_failed' && error === original)).toBe(true);
      const report = { passed: true, issues: [] }; collector.recordRecoveryFailure(report, writer, observed);
      expect(report).toEqual({ passed: false, issues: [{ code: observed.message }] });
      expect(calls.some(([event, error]) => event === 'v16.ui_software_recovery_failed' && error === observed)).toBe(true);
    }
  });
});

const unitRequire = createRequire(import.meta.url);
const { createGovernanceTransportTestPorts } = unitRequire('./v16-ui-governance-transport-test-port.cjs');
const collectorPath = fileURLToPath(new URL('./v16-ui-software-collector.js', import.meta.url));
const scopeContext = { storeId: 'unit-scope-store', browserProfileId: 'unit-scope-profile', marketplace: 'US', currency: 'USD',
  businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-19', sessionGeneration: 1 };
const scopeStore = { ...scopeContext, displayName: 'FT-US-US', status: 'active', createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z' };
const desiredScope = { dateFrom: '2026-10-01', dateTo: '2026-10-02', storeName: scopeStore.displayName,
  marketplaceCode: 'US', currency: 'USD', asin: 'B000000001', batchId: 'unit-fixture-batch' };
const scopeTimeoutMs = 30_000;
let scopeBundle;

function operationScopeFixture() {
  return `import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{MissionControlStoreContextProvider,useMissionControlStoreContext}from'../store-context';
    import{MissionControlShell,DEFAULT_BLOCKED_AUTONOMY}from'../mission-control-shell';
    import{MissionControlWorkspaceView}from'./mission-control-workspace-view';
    import{LegacyAdapterRouter}from'../router';
    const context=${JSON.stringify(scopeContext)},store=${JSON.stringify(scopeStore)},target=${JSON.stringify(desiredScope)},options={};
    let saved={...target,dateFrom:'2026-06-01',dateTo:'2026-06-12',asin:undefined,batchId:undefined},targetSaved=false,summaryPatched=false;
    const calls=[],routes=[],workspace=()=>({store:{...store},context:{...context},connections:[],sessions:[]});
    const provider={listStores:async()=>[store],listStoreDailyStatuses:async()=>({stores:[],generatedAt:'2026-10-19T12:00:00Z'}),
      getActiveStoreWorkspaceView:async()=>{const view=workspace();if(targetSaved&&options.crossStore){view.context.storeId='other-store';view.store.storeId='other-store';}if(targetSaved&&options.contextPatch)Object.assign(view.context,options.contextPatch);return view;},
      onStoreContextChanged:()=>()=>{},onStoresChanged:()=>()=>{}};
    window.electronAPI={...provider,getOperationScope:async()=>{calls.push({event:'read'});return {...saved,...(targetSaved?options.mainPatch:{})};},
      saveOperationScope:async(ctx,scope)=>{const desired=scope.dateFrom===target.dateFrom&&scope.dateTo===target.dateTo;
        const active=document.activeElement;calls.push({event:'save',context:ctx,scope,source:active?.matches('button')&&active.textContent.trim()==='保存范围'?'ui':'ipc'});
        if(desired&&options.saveFailure)throw new Error('隔离范围保存失败');saved={...scope};targetSaved=desired;return saved;},
      getStoreRuntimeConfig:async()=>({current:null,versions:[]}),listLingxingCollectionJobs:async()=>[],reportRuntimeLog:async record=>calls.push({event:'runtime-log',record})};
    new MutationObserver(()=>{if(options.lockedPatch){const locked=document.querySelector('[aria-label="当前锁定店铺站点币种"] strong');
        if(locked&&locked.textContent!==options.lockedPatch)locked.textContent=options.lockedPatch;}if(!targetSaved)return;
      if(options.fieldPatch){for(const input of document.querySelectorAll('.operation-scope-editor-panel input')){const name=input.getAttribute('aria-label');
        if(Object.hasOwn(options.fieldPatch,name))input.value=options.fieldPatch[name];}}
      if((options.summaryPatch||options.derivedBatch)&&!summaryPatched&&document.querySelector('[aria-label="当前范围字段"]')){summaryPatched=true;
        for(const card of document.querySelector('[aria-label="当前范围字段"]').children){const label=card.querySelector(':scope > span')?.textContent;
          if(options.summaryPatch&&label==='日期')card.querySelector('strong').textContent='错误日期';
          if(options.derivedBatch&&label==='批次 / 币种')card.querySelector('strong').textContent='unit-derived-job / USD';}}
    }).observe(document.getElementById('root'),{subtree:true,childList:true});
    const capabilities=['view','update'].map(action=>({capabilityId:'collection.scope.'+action,workspace:'collection',view:'collection/scope',
      action,state:'LEGACY_ADAPTER',legacyRoute:'operation-scope',detail:'隔离生产页面路由合同。'}));
    function Content(){const authority=useMissionControlStoreContext();const[intent,setIntent]=useState({workspace:'today',subview:'overview'});
      const navigate=next=>{routes.push(next);setIntent(next);};const ctx=authority.authoritativeContext;if(!ctx)return <p>等待隔离店铺上下文</p>;
      return <MissionControlShell activeIntent={intent} activeStore={store} authoritativeContext={ctx} stores={[store]} storePhase="ready"
        capabilities={capabilities} autonomy={DEFAULT_BLOCKED_AUTONOMY} onNavigate={navigate} onSwitchStore={()=>{}} onLogout={()=>{}}>
        {intent.workspace==='collection'&&intent.subview==='scope'?<MissionControlWorkspaceView intent={intent} storeContext={ctx} capabilities={capabilities}
          previewMode={false} bridgePhase="ready" onRefreshAuthority={()=>{}} onNavigate={navigate}
          legacySlot={({route,intent,capabilities})=><LegacyAdapterRouter route={route} intent={intent} capabilities={capabilities} storeContext={ctx}
            previewMode={false} nextSafeAction={{stage:'scope-setup'}} readbackAuthority={{mode:'production',previewOnly:false,appReady:false,capabilities:{}}}/>}/>
          :<p>隔离导航起点；范围页面必须通过真实侧栏进入。</p>}
      </MissionControlShell>;}
    window.scopeUnit={calls,routes,configure:settings=>Object.assign(options,settings),readSaved:()=>saved};
    createRoot(document.getElementById('root')).render(<MissionControlStoreContextProvider api={provider}><Content/></MissionControlStoreContextProvider>);`;
}

function runCollectorModule(file, source, dependencies) {
  // 原样执行 collector/helper；文件与原生端口仅用局部替身，不读取真实 DB 或查询假 PID。
  const module = { exports: {} }, localRequire = name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name.startsWith('node:')) return unitRequire(name);
    throw new Error('UNIT_SCOPE_UNEXPECTED_DEPENDENCY:' + name);
  };
  const wrapper = runInNewContext('(function(exports,require,module,__filename,__dirname){\n' + source + '\n})',
    { process, Buffer, setTimeout, clearTimeout }, { filename: file });
  wrapper(module.exports, localRequire, module, file, path.dirname(file));
  return module.exports;
}

describe('isolated governance transport dependency ports', () => {
  it('rejects an unknown VM dependency without a fallback beyond the two declared model ports', () => {
    const ports = createGovernanceTransportTestPorts();
    expect(Object.keys(ports.dependencies).sort()).toEqual(['./v16-ui-accessible-node', './v16-ui-reader-target-setup']);
    expect(() => runCollectorModule(collectorPath, "module.exports = require('./unit-unknown-accessible-port');", ports.dependencies))
      .toThrow('UNIT_SCOPE_UNEXPECTED_DEPENDENCY:./unit-unknown-accessible-port');
    expect(() => ports.resolveModelLocator('[data-v16-a11y-node="missing"]', [])).toThrow('UNIT_TRANSPORT_MARKER_NOT_UNIQUE');
  });
  it('propagates the exact accessible-port failure and rejects tab preparation absent from the transport fixture', async () => {
    const ports = createGovernanceTransportTestPorts(), original = new Error('UI_AX_ACTUAL_NODE_INVALID');
    await expect(ports.dependencies['./v16-ui-accessible-node'].describeAccessibleElement({ evaluate: async () => { throw original; } }, 'unit-failure'))
      .rejects.toBe(original);
    await expect(ports.dependencies['./v16-ui-reader-target-setup'].prepareReaderTarget(null, null, { id: 'unexpected-tab', role: 'tab' }))
      .rejects.toThrow('UNIT_TRANSPORT_UNEXPECTED_TAB_OR_ROLE');
    expect(ports.calls.map(row => row.method)).toEqual(['describe', 'setup']);
    expect(ports.calls.every(row => row.actualAxCredit === false && row.isolatedModel === true)).toBe(true);
  });
});

async function collectWithScopePage(options = {}) {
  scopeBundle ??= bundleProductionActionFixture(operationScopeFixture());
  const { browser, page } = await openProductionActionFixture(await scopeBundle);
  try {
    await page.locator('nav[aria-label="主业务导航"]').waitFor();
    await page.evaluate(settings => window.scopeUnit.configure(settings), options);
    const root = path.resolve(os.tmpdir(), 'unit-scope-virtual'), profile = path.join(root, 'profile'), appRoot = path.join(root, 'app');
    const identity = { pid: 20_001, creationTime: 1_000, packaged: true, executablePath: path.join(root, 'AmazonAIOpsAgent.exe'), appRoot,
      userDataDir: profile, windows: [{ id: 7, visible: true, url: 'file:///unit-renderer.html', rendererPid: 20_002, creationTime: 1_001,
        preferences: { contextIsolation: true, nodeIntegration: false } }] };
    const calls = [], logs = [], written = [], readerArguments = [], source = { sourceSha256: 'a'.repeat(64) };
    const fixture = { sourceSha256: source.sourceSha256, generationState: 'CURRENT', fixture: 'typical', packageHashes: {},
      classification: 'isolated-software-fixture', formalCredit: false, ownerToken: 'unit-owner', storeIds: [scopeContext.storeId],
      logicalDatabase: { path: path.join(root, 'unit-input.json'), sha256: 'b'.repeat(64) },
      scope: { ...desiredScope, ...(options.fixturePatch || {}) } };
    const writer = { root: path.join(root, 'output'), copy: () => undefined,
      log: (event, error) => { logs.push({ event, error }); if (options.writerLogFailure) throw new Error('UNIT_WRITER_IO_FAILED'); }, write: (name, value) => ({ path: name, value }),
      json: (name, value) => { written.push({ name, value }); if (name === 'native/scope-initialization.json') calls.push('scope-proof'); return { path: name }; } };
    const runtime = { page, identity, userDataDir: profile, launch: { receipt: { path: 'unit-launch' } }, rendererErrors: [],
      close: async () => { calls.push('close'); }, app: { evaluate: async callback => {
        const rendererPid = options.rendererPid ?? 20_002;
        const electron = { app: { isPackaged: true, getAppMetrics: () => [{ pid: identity.pid, creationTime: identity.creationTime }, { pid: rendererPid, creationTime: 1_002 }],
          getAppPath: () => appRoot, getPath: () => profile }, BrowserWindow: { getAllWindows: () => [{ id: options.windowId ?? 7,
          isDestroyed: () => false, isVisible: () => true, webContents: { getOSProcessId: () => rendererPid, getURL: () => identity.windows[0].url,
            getLastWebPreferences: () => ({ contextIsolation: true, nodeIntegration: false }) } }] } };
        return runInNewContext('(' + callback.toString() + ')(electron)', { process: { pid: options.mainPid ?? identity.pid, execPath: identity.executablePath }, electron });
      } } };
    const bindings = [], dependencies = {
      'node:fs': { constants: { COPYFILE_EXCL: 1 }, existsSync: () => false, mkdirSync: () => undefined, copyFileSync: () => undefined, writeFileSync: () => undefined,
        readFileSync: file => JSON.stringify(String(file).endsWith('owner.json') ? { token: fixture.ownerToken, classification: fixture.classification }
          : { schemaVersion: 'v16.build-state/1', status: 'CURRENT', identity: source }) },
      './v16-performance-artifacts': { ...artifacts, createArtifactWriter: () => writer,
        readBound: record => ({ path: record.path || path.join(root, 'fixture.json'), json: () => fixture }), fileRecord: file => ({ path: file }) },
      './verify-v16-required-test-manifest': { sourceIdentity: () => source },
      './v16-native-artifacts': { currentPackage: () => ({ ...identity, packageIdentity: { unitOnly: true } }) },
      './v16-performance-runtime': { openNativeRuntime: async () => runtime },
      './v16-performance-contract': { validateFixture: value => value },
      './evidence-user-data': { validateEvidenceUserDataPath: value => value },
      './v16-ui-software-matrix': { captureSoftwareMatrix: async (_, __, binding) => {
        calls.push('matrix'); bindings.push(binding);
        const proof = written.find(item => item.name === 'native/scope-initialization.json');
        if (!proof) throw new Error('UNIT_SCOPE_MATRIX_ENTERED_BEFORE_VERIFIED_RENDERER_SCOPE');
        return { issues: [], results: [{ observed: true }] };
      } },
      './v16-ui-software-governance': { collectSoftwareGovernance: async () => { calls.push('governance'); return { issues: [], deltas: [{ observations: { keyboard: true, pointer: true, reader: true } }] }; } },
      './v16-ui-software-recovery': { collectSoftwareRecovery: async () => { calls.push('recovery'); return { expectedFaultRecords: [] }; }, readRuntimeLogs: () => [] },
      './v16-ui-software-screen-reader': { openNvdaObserver: async value => {
        if (!options.screenReader) throw new Error('UNIT_SCOPE_NVDA_MUST_NOT_START');
        calls.push('reader-open'); readerArguments.push(value);
        if (options.readerOpenFailure) throw new Error('UNIT_NVDA_BINDING_FAILED');
        return { receipt: { path: 'unit-reader-launch', sha256: 'e'.repeat(64), sizeBytes: 17 }, close: async () => {
          calls.push('reader-close'); if (options.readerCloseFailure) throw new Error('UNIT_NVDA_CLOSE_FAILED');
          return { pid: 20_003, exited: true, exitCode: 0, signalCode: null };
        } };
      } },
      '../packages/shared-types/src/runtime-log-format.cjs': unitRequire('../packages/shared-types/src/runtime-log-format.cjs'),
      './v16-ui-software-integrity': { inspectFinalIdentity: () => undefined, inspectRuntimeLogFailures: () => ({ unexpected: [], missingOrRepeatedExpected: [] }) },
    };
    Object.defineProperty(dependencies, './v16-ui-software-scope', { get() {
      // 旧 collector 不读取新模块；先落测试时 RED 必须来自真实行为断言。
      const file = path.join(path.dirname(collectorPath), 'v16-ui-software-scope.js');
      return runCollectorModule(file, fs.readFileSync(file, 'utf8'), { './v16-performance-artifacts': artifacts, './package-ui-evidence': ui });
    } });
    const actual = runCollectorModule(collectorPath, fs.readFileSync(collectorPath, 'utf8'), dependencies);
    const result = await actual.collectSoftwareUi({ root, output: writer.root, fixtureRecord: { path: path.join(root, 'fixture.json') }, profile,
      timeoutMs: options.timeoutMs ?? scopeTimeoutMs, screenReaderExecutable: options.screenReader ? path.join(root, 'nvda.exe') : undefined });
    return { ...result, calls, logs, written, bindings, identity, runtime, readerArguments, ipc: await page.evaluate(() => window.scopeUnit.calls),
      routes: await page.evaluate(() => window.scopeUnit.routes) };
  } finally { await browser.close(); }
}

describe('isolated collector production operation scope route synchronization', () => {
  it('navigates the real Shell registry router to OperationScopePage and verifies Main and DOM before the matrix', async () => {
    const result = await collectWithScopePage();
    expect(result.report.passed).toBe(true); expect(result.report.formalCredit).toBe(false);
    expect(result.calls).toEqual(['scope-proof', 'matrix', 'governance', 'recovery', 'close']);
    const saved = result.ipc.find(item => item.event === 'save' && item.scope.batchId === desiredScope.batchId);
    expect(saved).toMatchObject({ source: 'ui', context: scopeContext, scope: desiredScope });
    expect(result.routes).toContainEqual({ workspace: 'collection', subview: 'scope' });
    expect(result.report.scopeInitialization).toMatchObject({ formalCredit: false, timeoutMs: scopeTimeoutMs,
      scope: desiredScope, mainSaved: desiredScope,
      lockedAuthority: [scopeStore.displayName, 'US', 'USD'],
      summary: { '批次 / 币种': desiredScope.batchId + ' / USD', '日期': '2026-10-01 ~ 2026-10-02' } });
    expect(result.report.scopeInitialization.fields).toEqual(Object.fromEntries(['dateFrom','dateTo','asin','batchId'].map(key => [key,desiredScope[key]])));
    expect(result.logs).toEqual([]);
  }, 30_000);
  it('binds the current renderer to the same owned Main and window before later screen reader use', async () => {
    const result = await collectWithScopePage({ rendererPid: 20_003 });
    expect(result.report.passed).toBe(true);
    expect(result.report.scopeInitialization.renderer).toMatchObject({ before: { rendererPid: 20_002 }, after: { rendererPid: 20_003, id: 7, creationTime: 1_002 } });
    expect(result.identity.windows).toEqual([result.report.scopeInitialization.renderer.after]);
  }, 30_000);
  it('saves an empty ASIN through the reachable production page when the fixture selects all products', async () => {
    const result = await collectWithScopePage({ fixturePatch: { asin: undefined } });
    expect(result.report.passed).toBe(true);
    expect(result.report.scopeInitialization.scope.asin).toBe('');
    expect(result.report.scopeInitialization.fields.asin).toBe('');
    expect(result.report.scopeInitialization.mainSaved.asin).toBeUndefined();
    expect(result.report.scopeInitialization.summary['产品']).toBe('全部产品');
  }, 30_000);
  it('accepts a derived automatic batch display only after Main and reopened input both prove an empty batch', async () => {
    const result = await collectWithScopePage({ fixturePatch: { batchId: undefined }, derivedBatch: true });
    expect(result.report.passed).toBe(true);
    expect(result.report.scopeInitialization.fields.batchId).toBe('');
    expect(result.report.scopeInitialization.mainSaved.batchId).toBeUndefined();
    expect(result.report.scopeInitialization.summary['批次 / 币种']).toBe('unit-derived-job / USD');
    expect(result.report.scopeInitialization.automaticBatch).toBe(true);
  }, 30_000);
  for (const [field, value] of [['dateFrom', '2026-09-30'], ['dateTo', '2026-10-03'], ['storeName', '其他店铺'],
    ['marketplaceCode', 'CA'], ['asin', 'B000000002'], ['batchId', 'stale-batch'], ['currency', 'CAD']]) {
    it('rejects a Main saved ' + field + ' mismatch before any matrix entry', async () => {
      const result = await collectWithScopePage({ mainPatch: { [field]: value } });
      expect(result.report.passed).toBe(false); expect(result.calls).toEqual(['close']);
      expect(result.report.issues).toContainEqual({ code: 'UI_SOFTWARE_SCOPE_MAIN_SAVED_MISMATCH' });
      expect(result.logs.some(row => row.event === 'v16.ui_software_capture_failed')).toBe(true);
    }, 30_000);
  }
  it('rejects a changed active Main StoreContext after the real UI save', async () => {
    const result = await collectWithScopePage({ crossStore: true });
    expect(result.report.issues).toContainEqual({ code: 'UI_SOFTWARE_SCOPE_AUTHORITY_CHANGED' });
    expect(result.calls).toEqual(['close']); expect(result.report.passed).toBe(false);
  }, 30_000);
  it('rejects a changed same-store session generation after the real UI save', async () => {
    const result = await collectWithScopePage({ contextPatch: { sessionGeneration: 2 } });
    expect(result.report.issues).toContainEqual({ code: 'UI_SOFTWARE_SCOPE_AUTHORITY_CHANGED' });
    expect(result.calls).toEqual(['close']); expect(result.report.passed).toBe(false);
  }, 30_000);
  it('rejects a visible production editor field that differs from Main saved scope', async () => {
    const result = await collectWithScopePage({ fieldPatch: { '运营范围采集批次': 'stale-dom-batch' } });
    expect(result.report.issues).toContainEqual({ code: 'UI_SOFTWARE_SCOPE_RENDERER_FIELDS_MISMATCH' });
    expect(result.calls).toEqual(['close']); expect(result.logs.some(row => row.event === 'v16.ui_software_scope_sync_failed')).toBe(true);
  }, 30_000);
  it('rejects a mismatched read-only store identity before submitting any editable scope fields', async () => {
    const result = await collectWithScopePage({ lockedPatch: '其他店铺' });
    expect(result.report.issues).toContainEqual({ code: 'UI_SOFTWARE_SCOPE_LOCKED_AUTHORITY_MISMATCH' });
    expect(result.calls).toEqual(['close']); expect(result.report.passed).toBe(false);
    expect(result.ipc.some(item => item.event === 'save' && item.scope.dateFrom === desiredScope.dateFrom)).toBe(false);
  }, 30_000);
  it('rejects the actual page summary cards when they disagree with the exact saved scope fields', async () => {
    const result = await collectWithScopePage({ summaryPatch: true });
    expect(result.report.issues).toContainEqual({ code: 'UI_SOFTWARE_SCOPE_RENDERER_SUMMARY_MISMATCH' });
    expect(result.calls).toEqual(['close']); expect(result.report.passed).toBe(false);
  }, 30_000);
  it('logs a real production save rejection and closes without entering the matrix', async () => {
    const result = await collectWithScopePage({ saveFailure: true });
    expect(result.report.passed).toBe(false); expect(result.calls).toEqual(['close']);
    expect(result.report.issues.some(item => item.code.includes('UI_SOFTWARE_SCOPE_SAVE_FAILED'))).toBe(true);
    expect(result.logs.some(row => row.event === 'v16.ui_software_capture_failed')).toBe(true);
  }, 30_000);
  for (const options of [{ mainPid: 20_004 }, { windowId: 8 }]) {
    it('rejects changed ' + (options.mainPid ? 'Main ownership' : 'window ownership') + ' before accepting a current renderer PID', async () => {
      const result = await collectWithScopePage(options);
      expect(result.report.passed).toBe(false); expect(result.calls).toEqual(['close']);
      expect(result.report.issues).toContainEqual({ code: options.mainPid ? 'UI_SOFTWARE_SCOPE_MAIN_IDENTITY_CHANGED' : 'UI_SOFTWARE_SCOPE_RENDERER_BINDING_MISMATCH' });
    }, 30_000);
  }
  it('rejects a fixture marketplace that differs from the authoritative US store', async () => {
    const result = await collectWithScopePage({ fixturePatch: { marketplaceCode: 'CA' } });
    expect(result.report.issues).toContainEqual({ code: 'UI_SOFTWARE_FIXTURE_SCOPE_INVALID' });
    expect(result.calls).toEqual(['close']); expect(result.report.passed).toBe(false);
  }, 30_000);
  it('keeps the original passed operation deadline instead of adding a new synchronization allowance', async () => {
    const result = await collectWithScopePage({ timeoutMs: 1 });
    expect(result.report.passed).toBe(false); expect(result.calls).toEqual(['close']);
    expect(result.logs.some(row => row.event === 'v16.ui_software_capture_failed')).toBe(true);
  }, 30_000);
});

describe('collector current Main provider wiring after production scope synchronization', () => {
  it('passes the actual owned runtime and complete proven StoreContext to the reader and records its real launch ref', async () => {
    const result = await collectWithScopePage({ screenReader: true });
    expect(result.report.passed).toBe(true);
    expect(result.calls).toEqual(['scope-proof', 'matrix', 'reader-open', 'governance', 'recovery', 'reader-close', 'close']);
    expect(result.readerArguments).toHaveLength(1);
    expect(Boolean(result.readerArguments[0].runtime)).toBe(true);
    expect(result.readerArguments[0].runtime === result.runtime).toBe(true);
    expect(result.readerArguments[0].runtime).toBe(result.runtime);
    expect(result.readerArguments[0].runtime.launch.receipt).toEqual(result.report.launch);
    expect(result.readerArguments[0].storeContext).toEqual(result.report.scopeInitialization.context);
    expect(result.readerArguments[0].storeContext).toEqual(scopeContext);
    expect(result.readerArguments[0].rendererPid).toBe(result.identity.windows[0].rendererPid);
    expect(result.readerArguments[0].timeoutMs).toBe(scopeTimeoutMs);
    expect(result.readerArguments[0].nativeLaunchKind).toBe('v16-nfr-native-launch');
    expect(result.report.screenReaderLaunch).toEqual({ path: 'unit-reader-launch', sha256: 'e'.repeat(64), sizeBytes: 17 });
  }, 30_000);
  it('keeps a failed provider binding NON_READY and logs it without inventing a reader launch ref', async () => {
    const result = await collectWithScopePage({ screenReader: true, readerOpenFailure: true });
    expect(result.report.passed).toBe(false); expect(result.report.screenReaderLaunch).toBeUndefined();
    expect(result.report.issues).toContainEqual({ code: 'UNIT_NVDA_BINDING_FAILED' });
    expect(result.logs.some(row => row.event === 'v16.ui_screen_reader_unavailable')).toBe(true);
    expect(result.calls.at(-1)).toBe('close');
  }, 30_000);
  it('still closes the owned application when reader cleanup and the writer logging outlet both fail', async () => {
    const result = await collectWithScopePage({ screenReader: true, readerCloseFailure: true, writerLogFailure: true });
    expect(result.report.passed).toBe(false);
    expect(result.report.issues).toContainEqual({ code: 'UNIT_NVDA_CLOSE_FAILED' });
    expect(result.calls.slice(-2)).toEqual(['reader-close', 'close']);
    expect(result.logs.some(row => row.event === 'v16.ui_screen_reader_cleanup_failed')).toBe(true);
  }, 30_000);
});

describe('software governance original provider witness transport', () => {
  it('preserves every actual reader witness and raw row without rewriting the Main provider into the Renderer', async () => {
    // 此夹具只验证真实治理函数的协议传递，不形成原生界面或屏读信用。
    let activeId, controls;
    class Locator {
      constructor(kind, number = 0) { this.kind = kind; this.number = number; }
      async evaluate(callback, id) {
        this.id = id;
        return { id, name: this.kind === 'trigger' ? '返回业务操作' : '受控业务节点' + this.number,
          role: this.kind === 'root' ? 'dialog' : 'button', focusable: true, bounds: { x: 10 + this.number * 100, y: 20, width: 80, height: 30 } };
      }
      async focus() { activeId = this.id; }
      async waitFor() {}
      async isEnabled() { return true; }
      async isVisible() { return true; }
      async count() { return 1; }
      async getAttribute(name) { return this.kind === 'root' ? ({ role: 'dialog', tabindex: '-1', 'aria-labelledby': 'unit-inspector-title' }[name] ?? null) : null; }
      async click() {}
      filter() { return this; }
      first() { return this; }
      getByRole(_, options) { return this.kind === 'root' && options?.name === '关闭详情检查器' ? nodes[0] : trigger; }
      locator() { return controls; }
    }
    const trigger = new Locator('trigger'), primitiveRoot = new Locator('root');
    const nodes = [new Locator('control', 0), new Locator('control', 1)];
    controls = { filter() { return this; }, count: async () => nodes.length, first: () => nodes[0], nth: number => nodes[number],
      evaluateAll: async callback => callback(nodes.map(() => ({ tabIndex: 0, matches: () => false, closest: () => null }))) };
    const page = { getByRole: () => trigger,
      locator: selector => transportPorts.resolveModelLocator(selector, [trigger, primitiveRoot, ...nodes])
        || (selector === '[role="dialog"],[role="alertdialog"]' ? { filter() { return this; }, count: async () => 0 }
          : selector.includes('.app-sidebar [data-operator-entry]') ? trigger : primitiveRoot),
      evaluate: async () => activeId,
      waitForFunction: async (_, id) => { if (activeId !== id) throw new Error('UNIT_GOVERNANCE_FOCUS_MISMATCH'); },
      keyboard: { press: async key => {
        if (key === 'Escape') activeId = trigger.id;
        else if (key === 'Tab' || key === 'Shift+Tab') {
          const position = nodes.findIndex(node => node.id === activeId);
          activeId = nodes[(position + (key === 'Tab' ? 1 : nodes.length - 1)) % nodes.length].id;
        }
      } } };
    const transportPorts = createGovernanceTransportTestPorts();
    const file = path.join(path.dirname(collectorPath), 'v16-ui-software-governance.js');
    const actual = runCollectorModule(file, fs.readFileSync(file, 'utf8'), {
      'node:fs': fs, './v16-performance-artifacts': artifacts, './v16-ui-governance': governance,
      ...transportPorts.dependencies,
      './v16-ui-software-motion': { captureMotionZoom: async () => ({ unitOnly: true }) },
    });
    const writer = artifacts.createArtifactWriter(newDirectory('provider-witness-transport')), witnesses = [], rows = [];
    const modelReader = { capture: async (_, __, node) => {
      const witness = { binding: { main: { pid: 1234 }, renderer: { pid: 5678 } }, nonce: 'unit-' + witnesses.length,
        nativeLaunch: { path: 'unit-native' }, readerLaunch: { path: 'unit-reader' }, rawSpeech: { path: 'unit-raw-' + witnesses.length } };
      const row = { timestamp: new Date().toISOString(), focusPid: 1234, spoken: '按钮 ' + node.name };
      witnesses.push(witness); rows.push(row);
      return { rows: [row], observedAt: row.timestamp, engine: { name: 'NVDA', version: 'unit-only' }, providerWitness: witness };
    } };
    const result = await actual.collectSoftwareGovernance({ page, identity: { pid: 1234 } }, writer, { pid: 1234 }, {
      screenReader: modelReader, root: process.cwd(), ui: { EXPECTED_PACKAGE_UI_ENTRIES: actual.CATALOG.map(item => {
        const [workspace, subview] = item.entry.split('/'); return { workspace, subview };
      }), navigateToWorkspace: async () => undefined },
    });
    transportPorts.assertUsed();
    expect(result.issues).toEqual([]); expect(witnesses).toHaveLength(20);
    const spoken = result.deltas.flatMap(delta => {
      const observation = artifacts.readBound(delta.observations['screen-reader']).json();
      return artifacts.readBound(observation.log).bytes.toString('utf8').trim().split('\n').map(JSON.parse).filter(line => line.event === 'spoken-node');
    });
    expect(spoken).toHaveLength(20);
    for (const [index, line] of spoken.entries()) {
      expect(line.providerWitness).toEqual(witnesses[index]);
      expect(line.actualNvdaRows).toEqual([rows[index]]);
      expect(line.actualNvdaRows[0].focusPid).toBe(1234);
      expect(line.providerWitness.binding.renderer.pid).toBe(5678);
    }
  });
});

function primitiveNavigationFixture(entry, moduleId) {
  return `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
    function App(){const[open,setOpen]=useState(false);useEffect(()=>{const dismiss=event=>{if(event.key==='Escape')setOpen(false);};
      document.addEventListener('keydown',dismiss);return()=>document.removeEventListener('keydown',dismiss);},[]);
      return <><aside className="app-sidebar"><nav aria-label="主业务导航" aria-busy="false">
        <button data-operator-module=${JSON.stringify(moduleId)} aria-expanded="true">业务模块</button>
        <button data-operator-entry=${JSON.stringify(entry.workspace + '/' + entry.subview)} aria-current="page">当前业务入口</button>
      </nav></aside><main className="app-content" style={{height:180,overflowY:'auto'}}>
        <section data-workspace-evidence-root data-workspace=${JSON.stringify(entry.workspace)} data-workspace-subview=${JSON.stringify(entry.subview)}>
          <button onClick={()=>setOpen(true)}>填写并保存 AI 设置</button>
          <section className="priority-table-scroll"><button>查看内部标识</button></section>
          <div style={{height:2000}}>隔离的滚动范围验证，不连接 Main 或外部服务。</div>
          {open&&<section role="dialog" style={{position:'fixed',top:20,right:20}}><button onClick={()=>setOpen(false)}>关闭</button></section>}
        </section></main></>;}
    createRoot(document.getElementById('root')).render(<App/>);`;
}

let primitiveTabsBundle;
function primitiveTabsFixture() {
  return `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
    import{MissionControlWorkspaceTabs}from'./mission-control-workspace-tabs';
    function App(){const[intent,setIntent]=useState({workspace:'collection',subview:'reports'});
      useEffect(()=>{window.primitiveFixture={breakReturn:false};const move=event=>{
        if(window.primitiveFixture.breakReturn&&event.key==='Tab'&&event.shiftKey){event.preventDefault();document.getElementById('wrong-focus').focus();}};
        document.addEventListener('keydown',move,true);return()=>document.removeEventListener('keydown',move,true);},[]);
      return <><button id="primitive-trigger">返回采集入口</button><button id="wrong-focus">隔离错误焦点</button>
        <MissionControlWorkspaceTabs intent={intent} onNavigate={setIntent} capabilities={[]}><button>真实顺序控件后继</button></MissionControlWorkspaceTabs>
        <section id="non-sequential-controls"><button tabIndex={-1}>仅程序可聚焦</button><span inert=""><button>惰性范围内控件</button></span>
          <button disabled tabIndex={0}>禁用控件</button></section></>;}
    createRoot(document.getElementById('root')).render(<App/>);`;
}
async function openPrimitiveTabsFixture() {
  primitiveTabsBundle ??= bundleProductionActionFixture(primitiveTabsFixture());
  const fixture = await openProductionActionFixture(await primitiveTabsBundle);
  try { await fixture.page.locator('#primitive-trigger').waitFor(); return fixture; }
  catch (error) { await fixture.browser.close(); throw error; }
}

describe('governance repeated preparation and sequential keyboard controls', () => {
  for (const primitive of ['PriorityDataTable / virtual table', 'FormTable / controls']) {
    it('resets the actual scroll owner during both preparations of ' + primitive + ' through the existing single navigation gate', async () => {
      const item = primitives.CATALOG.find(value => value.primitive === primitive);
      const entry = ui.EXPECTED_PACKAGE_UI_ENTRIES.find(value => value.workspace + '/' + value.subview === item.entry);
      const module = ui.EXPECTED_PACKAGE_UI_MODULES.find(value => value.workspaces.includes(entry.workspace));
      const { browser, page } = await openProductionActionFixture(await bundleProductionActionFixture(primitiveNavigationFixture(entry, module.id)));
      try {
        await page.locator('.app-content').waitFor();
        const calls = [], unexpectedRestore = [];
        const port = { ...ui, navigateToWorkspace: async (...args) => {
          calls.push(args); expect(args).toHaveLength(4); expect(args[0] === page).toBe(true); expect(args[1] === entry).toBe(true);
          expect(args[2]).toBeUndefined(); expect(args[3]).toEqual({ resetScroll: true });
          return ui.navigateToWorkspace(...args);
        }, restoreWorkspaceScrollTop: () => { unexpectedRestore.push(true); throw new Error('UNIT_EXTRA_SCROLL_WAIT_FORBIDDEN'); } };
        for (let index = 0; index < 2; index++) {
          expect(await page.evaluate(() => { const content = document.querySelector('.app-content'); content.scrollTop = 700; return content.scrollTop; })).toBeGreaterThan(1);
          const prepared = await primitives.preparePrimitive({ page }, item, port);
          expect(await prepared.root.isVisible()).toBe(true);
          expect(await page.evaluate(() => Math.abs(document.querySelector('.app-content').scrollTop))).toBeLessThanOrEqual(1);
        }
        expect(calls).toHaveLength(2); expect(unexpectedRestore).toEqual([]);
        await page.evaluate(() => document.querySelector('.app-content').classList.remove('app-content'));
        await expect(primitives.preparePrimitive({ page }, item, port)).rejects.toThrow('Shared workspace scroll owner is unavailable before capture');
        expect(calls).toHaveLength(3); expect(unexpectedRestore).toEqual([]);
      } finally { await browser.close(); }
    }, 30_000);
  }
  it('selects the current sequential production workspace tab while retaining actual Tab ShiftTab Arrow and trigger focus assertions', async () => {
    // 真实生产页签组件仅挂入隔离 Chromium；不形成真实包或屏读验收信用。
    const { browser, page } = await openPrimitiveTabsFixture();
    try {
      const root = page.locator('[data-workspace-evidence-root][data-workspace="collection"]'), trigger = page.locator('#primitive-trigger');
      expect(await root.locator('button').first().getAttribute('tabindex')).toBe('-1');
      const evidence = await primitives.captureKeyboard({ page }, { root, trigger }, { primitive: 'Progress / motion' },
        artifacts.createArtifactWriter(newDirectory('sequential-tabs')), 'progress');
      const rows = artifacts.readBound(evidence.log).bytes.toString('utf8').trim().split('\n').map(JSON.parse);
      expect(evidence.nodes[0].role).toBe('tab'); expect(evidence.nodes[0].name).toContain('采集任务');
      expect(await evidence.control.evaluate(element => element.tabIndex)).toBe(0);
      expect(await root.locator('button').first().getAttribute('data-v16-a11y-node')).toBeNull();
      expect(rows.map(row => row.event)).toEqual(['focus-enter', 'keyboard-action', 'focus-return']);
      expect(rows[1].keys).toEqual(['Tab', 'Shift+Tab']); expect(rows.every(row => row.targetId === row.activeElementId)).toBe(true);
      expect(await page.evaluate(() => document.activeElement.id)).toBe('primitive-trigger');
      await evidence.control.focus(); await page.keyboard.press('ArrowRight');
      expect(await root.getByRole('tab', { selected: true }).getAttribute('id')).toBe('collection-workspace-tab-import-check');
      expect(await page.evaluate(() => document.activeElement.id)).toBe('collection-workspace-tab-import-check');
      await page.keyboard.press('ArrowLeft');
      expect(await root.getByRole('tab', { selected: true }).getAttribute('id')).toBe('collection-workspace-tab-reports');
      expect(await page.evaluate(() => document.activeElement.id)).toBe('collection-workspace-tab-reports');
    } finally { await browser.close(); }
  }, 30_000);
  it('rejects a visible root containing only negative tabindex disabled or inert controls before any keyboard credit', async () => {
    const { browser, page } = await openPrimitiveTabsFixture();
    try {
      await expect(primitives.captureKeyboard({ page }, { root: page.locator('#non-sequential-controls'), trigger: page.locator('#primitive-trigger') },
        { primitive: 'Progress / motion' }, artifacts.createArtifactWriter(newDirectory('no-sequential-control')), 'negative'))
        .rejects.toThrow('UI_PRIMITIVE_KEYBOARD_CONTROL_NOT_OBSERVED');
    } finally { await browser.close(); }
  }, 30_000);
  it('still rejects an actual wrong ShiftTab return instead of deleting or satisfying the focus return gate programmatically', async () => {
    const { browser, page } = await openPrimitiveTabsFixture();
    try {
      await page.evaluate(() => { window.primitiveFixture.breakReturn = true; });
      await expect(primitives.captureKeyboard({ page }, { root: page.locator('[data-workspace-evidence-root][data-workspace="collection"]'), trigger: page.locator('#primitive-trigger') },
        { primitive: 'Progress / motion' }, artifacts.createArtifactWriter(newDirectory('wrong-shift-return')), 'wrong'))
        .rejects.toThrow('UI_PRIMITIVE_KEYBOARD_ACTION_RETURN_FAILED');
      expect(await page.evaluate(() => document.activeElement.id)).toBe('wrong-focus');
    } finally { await browser.close(); }
  }, 30_000);
});

function inspectorSpeechFixture(patch) {
  return `import React,{useLayoutEffect,useState}from'react';import{createRoot}from'react-dom/client';
    import{ResponsiveInspector}from'../../components/workspace';
    window.inspectorSpeechUnit={opens:0,patch:${JSON.stringify(patch)}};
    function App(){const[open,setOpen]=useState(false);useLayoutEffect(()=>{if(!open)return;const state=window.inspectorSpeechUnit;state.opens++;
      if(state.opens!==2)return;const surface=document.querySelector('.responsive-inspector');
      if(state.patch==='missing-tabindex')surface.removeAttribute('tabindex');
      if(state.patch==='unresolved-label')surface.setAttribute('aria-labelledby','unit-missing-inspector-label');
      if(state.patch==='wrong-role')surface.setAttribute('role','group');
      if(state.patch==='missing-close')surface.querySelector('.responsive-inspector__close').remove();
    },[open]);return <><button data-action="open-technical-inspector" onClick={()=>setOpen(true)}>查看技术与证据详情</button>
      <ResponsiveInspector open={open} title="只读技术与证据详情" description="隔离真实生产组件；不执行任何业务动作。" onClose={()=>setOpen(false)}>
        <p>当前只读信息不授批准或执行信用。</p><button disabled>业务动作保持禁止</button>
      </ResponsiveInspector></>;}
    createRoot(document.getElementById('root')).render(<App/>);`;
}

async function collectWithActualInspectorSpeech(patch = 'none', ordinaryOneControl = false) {
  const { browser, page } = await openProductionActionFixture(await bundleProductionActionFixture(inspectorSpeechFixture(patch)));
  try {
    await page.locator('[data-action="open-technical-inspector"]').waitFor();
    const actualRoot = page.locator('.responsive-inspector'), actualTrigger = page.locator('[data-action="open-technical-inspector"]');
    let currentEntry, activeId, controls;
    const inspectorActive = () => currentEntry === 'execution/evidence';
    class Locator {
      constructor(kind, number = 0) { this.kind = kind; this.number = number; }
      async evaluate(_, id) { this.id = id; return { id, role: 'button', name: this.kind === 'trigger' ? '隔离业务返回' : '隔离顺序控件' + this.number,
        focusable: true, bounds: { x: 20 + this.number * 100, y: 20, width: 80, height: 30 } }; }
      async focus() { activeId = this.id; }
      async waitFor() {}
      async isEnabled() { return true; }
      async click() {}
      filter() { return this; }
      first() { return this; }
      getByRole() { return trigger; }
      locator() { return controls; }
    }
    const trigger = new Locator('trigger'), primitiveRoot = new Locator('root');
    const modelNodes = [new Locator('control', 0), new Locator('control', 1)];
    const selectedNodes = () => ordinaryOneControl ? modelNodes.slice(0, 1) : modelNodes;
    controls = { filter() { return this; }, count: async () => selectedNodes().length, first: () => modelNodes[0], nth: number => modelNodes[number],
      evaluateAll: async callback => callback(selectedNodes().map(() => ({ tabIndex: 0, matches: () => false, closest: () => null }))) };
    const pagePort = { getByRole: () => trigger,
      locator: selector => {
        if (inspectorActive() && selector.startsWith('[data-v16-a11y-node=')) return page.locator(selector);
        if (inspectorActive()) return selector.includes('[data-action="open-technical-inspector"]') ? actualTrigger
          : selector === '[role="dialog"],[role="alertdialog"]' ? page.locator(selector) : actualRoot;
        return transportPorts.resolveModelLocator(selector, [trigger, primitiveRoot, ...modelNodes])
          || (selector === '[role="dialog"],[role="alertdialog"]' ? { filter() { return this; }, count: async () => 0 }
            : selector.includes('.app-sidebar [data-operator-entry]') ? trigger : primitiveRoot);
      },
      evaluate: (...args) => inspectorActive() ? page.evaluate(...args) : Promise.resolve(activeId),
      waitForFunction: (...args) => inspectorActive() ? page.waitForFunction(...args) : Promise.resolve().then(() => {
        if (activeId !== args[1]) throw new Error('UNIT_INSPECTOR_MODEL_FOCUS_MISMATCH');
      }),
      keyboard: { press: async key => {
        if (inspectorActive()) return page.keyboard.press(key);
        if (key === 'Escape') activeId = trigger.id;
        else if (key === 'Tab' || key === 'Shift+Tab') {
          const nodes = selectedNodes(), position = nodes.findIndex(node => node.id === activeId);
          activeId = nodes[(position + (key === 'Tab' ? 1 : nodes.length - 1)) % nodes.length].id;
        }
      } },
    };
    const transportPorts = createGovernanceTransportTestPorts();
    const file = path.join(path.dirname(collectorPath), 'v16-ui-software-governance.js');
    const actual = runCollectorModule(file, fs.readFileSync(file, 'utf8'), {
      'node:fs': fs, './v16-performance-artifacts': artifacts, './v16-ui-governance': governance,
      ...transportPorts.dependencies,
      './v16-ui-software-motion': { captureMotionZoom: async () => ({ isolatedDomPortOnly: true, formalCredit: false }) },
    });
    const writer = artifacts.createArtifactWriter(newDirectory('inspector-speech-' + patch)), focusedNodes = [];
    const reader = { capture: async (_, target, node) => {
      if (inspectorActive()) {
        await target.focus();
        const observed = await target.evaluate(element => ({ active: document.activeElement === element,
          id: element.getAttribute('data-v16-a11y-node'), role: element.getAttribute('role') || element.tagName.toLowerCase() }));
        expect(observed.active).toBe(true); expect(observed.id).toBe(node.id);
        focusedNodes.push({ ...node, actualDomRole: observed.role });
      }
      // 替身只记录隔离 DOM 聚焦，故意不产出可被原生语音校验器接受的 NVDA 行。
      const row = { kind: 'isolated-dom-focus-port', formalCredit: false, timestamp: new Date().toISOString(), spoken: 'UNIT DOM ' + node.name };
      return { rows: [row], observedAt: row.timestamp, engine: { name: 'ISOLATED_DOM_PORT', version: 'unit-only' } };
    } };
    const result = await actual.collectSoftwareGovernance({ page: pagePort, identity: { pid: 1234 } }, writer, { pid: 1234 }, {
      screenReader: reader, root: process.cwd(), ui: { EXPECTED_PACKAGE_UI_ENTRIES: actual.CATALOG.map(item => {
        const [workspace, subview] = item.entry.split('/'); return { workspace, subview };
      }), navigateToWorkspace: async (_, entry) => { currentEntry = entry.workspace + '/' + entry.subview; } },
    });
    transportPorts.assertUsed();
    const delta = result.deltas.find(item => item.primitive === 'ResponsiveInspector');
    const observed = delta.observations['screen-reader'] ? artifacts.readBound(delta.observations['screen-reader']).json() : null;
    const nodes = observed ? artifacts.readBound(observed.dom).json().nodes : [];
    const logFile = path.join(writer.root, 'collector.jsonl');
    const logs = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    return { result, delta, observed, nodes, focusedNodes, logs };
  } finally { await browser.close(); }
}

describe('Inspector original container and close speech target contract', () => {
  it('collects the real production Inspector named dialog and its only enabled close as two distinct programmatically focused nodes', async () => {
    const result = await collectWithActualInspectorSpeech();
    expect(result.result.issues).toEqual([]); expect(result.delta.observations['screen-reader']).toBeDefined();
    expect(result.nodes.map(node => node.role)).toEqual(['dialog', 'button']);
    expect(result.nodes.map(node => node.name)).toEqual(['只读技术与证据详情', '关闭详情检查器']);
    expect(new Set(result.nodes.map(node => node.id)).size).toBe(2); expect(result.nodes.every(node => node.focusable)).toBe(true);
    expect(result.focusedNodes.map(node => node.id)).toEqual(result.nodes.map(node => node.id));
    expect(result.focusedNodes.map(node => node.actualDomRole)).toEqual(['dialog', 'button']);
    expect(result.observed.engine.name).toBe('ISOLATED_DOM_PORT'); expect(result.result.formalCredit).toBe(false);
  }, 30_000);
  for (const patch of ['missing-tabindex', 'unresolved-label', 'wrong-role']) {
    it('rejects the Inspector container when ' + patch + ' is observed without emitting a screen reader observation', async () => {
      const result = await collectWithActualInspectorSpeech(patch);
      expect(result.delta.observations['screen-reader']).toBeUndefined(); expect(result.focusedNodes).toEqual([]);
      expect(result.result.issues).toContainEqual({ primitive: 'ResponsiveInspector', code: 'UI_SCREEN_READER_INSPECTOR_CONTAINER_INVALID' });
      expect(result.logs.some(row => row.event === 'v16.ui_primitive_observation_failed'
        && row.context.primitive === 'ResponsiveInspector' && row.context.error.message === 'UI_SCREEN_READER_INSPECTOR_CONTAINER_INVALID')).toBe(true);
    }, 30_000);
  }
  it('rejects an Inspector without its unique visible enabled close rather than enabling a disabled business action', async () => {
    const result = await collectWithActualInspectorSpeech('missing-close');
    expect(result.delta.observations['screen-reader']).toBeUndefined(); expect(result.focusedNodes).toEqual([]);
    expect(result.result.issues).toContainEqual({ primitive: 'ResponsiveInspector', code: 'UI_SCREEN_READER_TWO_ACTUAL_NODES_REQUIRED' });
  }, 30_000);
  it('keeps the ordinary primitive descendant two-node gate instead of adding its container as a substitute', async () => {
    const result = await collectWithActualInspectorSpeech('none', true);
    expect(result.result.deltas.find(item => item.primitive === 'App Shell / sidebar').observations['screen-reader']).toBeUndefined();
    expect(result.result.issues).toContainEqual({ primitive: 'App Shell / sidebar', code: 'UI_SCREEN_READER_TWO_ACTUAL_NODES_REQUIRED' });
    expect(result.nodes.map(node => node.role)).toEqual(['dialog', 'button']); expect(result.result.formalCredit).toBe(false);
  }, 30_000);
});
function ownedMotionCaptureModel({ deviceScaleFactor = 1, force = String(deviceScaleFactor), foreign = false, drift = false, cropped = false,
  legacy = false, restoreFailure = false, setupFailure, setupReturnFailure, setupOwnerLoss } = {}) {
  const source = createRequire(import.meta.url)('./package-ui-screenshots.js');
  const calls = [], buttons = new Map();
  const state = { width: 1366, height: 768, zoom: 1.25, captures: 0, reduced: false };
  let setupFailed = false, returnFailed = false;
  const owner = { mainPid: 11, mainCreationTime: 1000, windowId: 1, rendererPid: 22, rendererCreationTime: 1100,
    url: 'file:///owned/resources/app/dist/renderer/index.html', electronVersion: '44.2.0' };
  const renderer = () => ({ url: owner.url, innerWidth: Math.round(state.width / state.zoom),
    innerHeight: Math.round(state.height / state.zoom), devicePixelRatio: deviceScaleFactor * state.zoom });
  const pixels = () => ({ width: Math.ceil(state.width * deviceScaleFactor), height: Math.ceil(state.height * deviceScaleFactor) });
  const image = { isEmpty: () => false, getSize: pixels, getScaleFactors: () => [1], toPNG: () => {
    const size = pixels(), bytes = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
    bytes.writeUInt32BE(size.width - Number(cropped), 16); bytes.writeUInt32BE(size.height, 20); return bytes;
  } };
  const window = { id: 1, isDestroyed: () => false, isMaximized: () => false, isFullScreen: () => false,
    show() {}, focus() {},
    isMinimized: () => false, isVisible: () => true, getMinimumSize: () => [1200, 700],
    getMaximumSize: () => [0, 0], isResizable: () => true, isMenuBarVisible: () => true, isMenuBarAutoHide: () => false,
    getNativeWindowHandle: () => { const handle = Buffer.alloc(8); handle.writeBigUInt64LE(1000n); return handle; },
    getBounds: () => ({ x: 100, y: 100, width: state.width + 16 + Number(drift && state.captures > 0), height: state.height + 67 }),
    getContentBounds: () => ({ x: 108, y: 159, width: state.width, height: state.height }),
    getContentSize: () => [state.width, state.height], setContentSize: (width, height) => {
      calls.push({ event: 'content-set' }); if (restoreFailure && state.captures > 0) throw new Error('MODEL_RESTORE_FAILED');
      if (setupFailure && !setupFailed) { setupFailed = true; throw setupFailure; }
      state.width = width; state.height = height;
    },
    setSize: () => { state.width = 1184; state.height = 633; },
    webContents: { isDestroyed: () => false, getOSProcessId: () => foreign || state.ownerLoss === 'renderer' ? 33 : 22,
      getURL: () => state.ownerLoss === 'url' ? 'file:///changed-document' : owner.url,
      getZoomFactor: () => state.zoom, setZoomFactor: value => { calls.push({ event: 'zoom-set', value }); state.zoom = value; },
      executeJavaScript: async () => { calls.push({ event: 'renderer-read', captures: state.captures }); return renderer(); },
      capturePage: async () => { calls.push({ event: 'capture', captures: state.captures }); state.captures++; return image; } } };
  const electron = { app: { getAppMetrics: () => [{ pid: 11, type: 'Browser', creationTime: state.ownerLoss === 'main-birth' ? 1001 : 1000 },
    { pid: 22, type: 'Tab', creationTime: state.ownerLoss === 'renderer-birth' ? 1101 : 1100 }],
    commandLine: { getSwitchValue: () => force } },
    BrowserWindow: { fromId: id => { calls.push({ event: 'owned-window', id }); return id === 1 ? window : null; },
      getAllWindows: () => { if (!legacy) throw new Error('MODEL_FIRST_WINDOW_SELECTION_FORBIDDEN'); return [window]; } },
    screen: { getDisplayMatching: () => ({ id: 7, scaleFactor: deviceScaleFactor,
      bounds: { x: 0, y: 0, width: 2560, height: 1440 }, workArea: { x: 0, y: 0, width: 2560, height: 1392 } }) } };
  const app = { evaluate: async (callback, argument) => {
    const result = await runInNewContext(`(${callback.toString()})`,
      { process: { pid: 11, versions: { electron: '44.2.0' } }, setTimeout })(electron, argument);
    if (argument?.kind && setupOwnerLoss) state.ownerLoss = setupOwnerLoss;
    if (argument?.kind && setupReturnFailure && !returnFailed) { returnFailed = true; throw setupReturnFailure; }
    // 按真实跨进程传输克隆成功值，错误分支仍保留原对象与顺序。
    return structuredClone(result);
  } };
  const page = { keyboard: { press: async key => { calls.push({ event: 'key', key }); } },
    emulateMedia: async ({ reducedMotion }) => { calls.push({ event: 'media', reducedMotion }); state.reduced = reducedMotion === 'reduce'; },
    evaluate: async (callback, argument) => {
      const live = renderer();
      return runInNewContext(`(${callback.toString()})`, { innerWidth: live.innerWidth, innerHeight: live.innerHeight,
        devicePixelRatio: live.devicePixelRatio, location: { href: owner.url }, matchMedia: () => ({ matches: state.reduced }),
        requestAnimationFrame: next => next(), CSS: { escape: value => value }, document: {
          getAnimations: () => [], querySelector: selector => selector === '.app-content' ? { innerText: '隔离控件当前状态' }
            : buttons.get(selector.match(/data-v16-a11y-node="([^"]+)"/)?.[1]),
        } })(argument);
    } };
  const controls = { filter: () => controls, count: async () => 2, nth: index => ({ index, scrollIntoViewIfNeeded: async () => {} }) };
  const describe = async (target, id) => {
    const bounds = { x: 10 + target.index * 100, y: 20, width: 80, height: 30 };
    buttons.set(id, { checkVisibility: () => true, getBoundingClientRect: () => ({ ...bounds,
      right: bounds.x + bounds.width, bottom: bounds.y + bounds.height, toJSON: () => bounds }) });
    return { id, name: '隔离控件' + target.index, role: 'button', focusable: true, bounds };
  };
  const screenshots = { ...source({ fs, path, fail: (...args) => { throw new Error(args.join(':')); }, sha256Buffer: artifacts.digest }),
    setElectronViewport: ui.setElectronViewport };
  const nativePorts = { createObserver: () => ({ snapshot: async () => ({
    beforeMain: await motionMain.readMotionMain(app, owner), afterMain: await motionMain.readMotionMain(app, owner),
    native: { fixtureOnly: true, formalCredit: false }, invocation: { fixtureOnly: true, formalCredit: false } }) }) };
  return { calls, state, owner, app, page, screenshots, describe, nativePorts, prepare: async () => ({ root: { locator: () => controls } }),
    runtime: { app, page, identity: { pid: 11, creationTime: 1000, electronVersion: '44.2.0', windows: [
      { id: 1, rendererPid: 22, creationTime: 1100, url: owner.url } ] } } };
}

describe('motion截图生产者的所属与原始字段', () => {
  it.each([1, 1.25])('实际执行隔离模型回调并在DSF=%s读取prepare后的两档几何', async deviceScaleFactor => {
    const model = ownedMotionCaptureModel({ deviceScaleFactor }), directory = newDirectory('owned-motion-' + deviceScaleFactor);
    const writer = artifacts.createArtifactWriter(directory);
    const reference = await motion.captureMotionZoom(model.runtime, writer, { pid: 11 }, 'motion', model.prepare, model.describe, model.screenshots, model.nativePorts);
    const observation = JSON.parse(fs.readFileSync(reference.path, 'utf8'));
    expect(observation.viewports.map(view => view.kind)).toEqual(['125-percent', 'minimum-window']);
    for (const view of observation.viewports) {
      const dom = JSON.parse(fs.readFileSync(view.dom.path, 'utf8'));
      expect(dom.schemaVersion).toBe('v16.accessibility-motion-dom/3');
      expect(dom.geometryWitness.nativeBefore.native).toEqual({ fixtureOnly: true, formalCredit: false });
      expect(dom.geometryWitness.before.windowId).toBe(1); expect(dom.geometryWitness.before.forceDeviceScaleFactor).toBe(String(deviceScaleFactor));
      expect(dom.cssToPhysicalFactor).toBe(deviceScaleFactor * dom.viewport.scaleFactor);
      expect(dom.geometryWitness.nativeSize).toEqual({ width: dom.viewport.width, height: dom.viewport.height });
    }
    expect(model.calls.filter(call => call.event === 'capture')).toHaveLength(2);
    const captureReadbacks = model.calls.flatMap((call, index) => call.event === 'capture' ? [
      model.calls.slice(0, index).findLast(row => row.event === 'renderer-read')?.captures,
      model.calls.slice(index + 1).find(row => row.event === 'renderer-read')?.captures] : []);
    expect(captureReadbacks).toEqual([0, 1, 1, 2]);
    expect(model.state).toMatchObject({ width: 1366, height: 768, zoom: 1, reduced: false });
  });
  it('NFR空force被忠实记录且不伪造正式profile开关', async () => {
    const model = ownedMotionCaptureModel({ force: '' }), directory = newDirectory('empty-force'); fs.mkdirSync(directory, { recursive: true });
    const result = await motion.captureOwnedMotionScreenshot(model.app, path.join(directory, 'model.png'),
      { schemaVersion: 'v16.owned-motion-capture-request/1', owner: model.owner }, model.screenshots.readPngDimensions);
    expect(result.geometryWitness.before.forceDeviceScaleFactor).toBe(''); expect(result.geometryWitness.after.forceDeviceScaleFactor).toBe('');
  });
  it('窗口/renderer不属于请求Main时不进行capture', async () => {
    const model = ownedMotionCaptureModel({ foreign: true }), directory = newDirectory('foreign-motion');
    await expect(motion.captureOwnedMotionScreenshot(model.app, path.join(directory, 'model.png'),
      { schemaVersion: 'v16.owned-motion-capture-request/1', owner: model.owner }, model.screenshots.readPngDimensions)).rejects.toThrow('OWNED_IDENTITY_CHANGED');
    expect(model.state.captures).toBe(0); expect(fs.existsSync(directory)).toBe(false);
  });
  it('capture前后原生几何改变时不发布成功截图', async () => {
    const model = ownedMotionCaptureModel({ drift: true }), directory = newDirectory('drift-motion'); fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'model.png');
    await expect(motion.captureOwnedMotionScreenshot(model.app, file,
      { schemaVersion: 'v16.owned-motion-capture-request/1', owner: model.owner }, model.screenshots.readPngDimensions)).rejects.toThrow('CAPTURE_GEOMETRY_CHANGED');
    expect(model.state.captures).toBe(1); expect(fs.existsSync(file)).toBe(false);
  });
  it('旧两参公开截图出口保留原返回形状', async () => {
    const model = ownedMotionCaptureModel({ legacy: true }), directory = newDirectory('legacy-shot'); fs.mkdirSync(directory, { recursive: true });
    const result = await model.screenshots.captureViewportScreenshot(model.app, path.join(directory, 'legacy.png'));
    expect(Object.keys(result).sort()).toEqual(['dimensions', 'method', 'nativeSize']);
    expect(result.method).toBe('electron-webcontents-capture-page');
  });
});

describe('motion恢复错误边界', () => {
  it('首次所属校验失败时不复位未知窗口或发送Escape', async () => {
    const model = ownedMotionCaptureModel({ foreign: true }), directory = newDirectory('unknown-owner-restore');
    await expect(motion.captureMotionZoom(model.runtime, artifacts.createArtifactWriter(directory), { pid: 11 },
      'motion', model.prepare, model.describe, model.screenshots, model.nativePorts)).rejects.toThrow('NATIVE_WINDOW_REQUIRED');
    expect(model.calls.filter(call => ['content-set', 'zoom-set', 'key'].includes(call.event))).toEqual([]);
    expect(model.state).toMatchObject({ captures: 0, reduced: false, zoom: 1.25 });
  });
  it('截图首错保留且独立记录恢复失败，不覆盖为cleanup错误', async () => {
    const model = ownedMotionCaptureModel({ drift: true, restoreFailure: true }), directory = newDirectory('motion-first-error');
    await expect(motion.captureMotionZoom(model.runtime, artifacts.createArtifactWriter(directory), { pid: 11 },
      'motion', model.prepare, model.describe, model.screenshots, model.nativePorts)).rejects.toThrow('CAPTURE_GEOMETRY_CHANGED');
    const log = fs.readFileSync(path.join(directory, 'collector.jsonl'), 'utf8');
    expect(log).toContain('v16.ui_motion_restore_failed'); expect(log).toContain('MODEL_RESTORE_FAILED');
    expect(model.state.reduced).toBe(false);
  });
});

describe('motion setup部分副作用与归属丢失清理', () => {
  it.each(['setter', 'return'])('%s失败后仍按原稳定恢复合同复位同owner并保留首错', async failureKind => {
    const firstError = new Error('MODEL_SETUP_' + failureKind.toUpperCase() + '_FAILED');
    const model = ownedMotionCaptureModel(failureKind === 'setter' ? { setupFailure: firstError } : { setupReturnFailure: firstError });
    model.state.zoom = 1; model.state.width = 1000; model.state.height = 600;
    const directory = newDirectory('motion-partial-' + failureKind);
    await expect(motion.captureMotionZoom(model.runtime, artifacts.createArtifactWriter(directory), { pid: 11 },
      'motion', model.prepare, model.describe, model.screenshots, model.nativePorts)).rejects.toBe(firstError);
    expect(model.calls.filter(call => call.event === 'zoom-set').map(call => call.value)).toEqual([1.25, 1]);
    expect(model.calls.filter(call => call.event === 'content-set').length).toBeGreaterThanOrEqual(2);
    expect(model.calls.filter(call => call.event === 'key').map(call => call.key)).toEqual(['Escape']);
    expect(model.state).toMatchObject({ width: 1366, height: 768, zoom: 1, reduced: false, captures: 0 });
    expect(fs.existsSync(path.join(directory, 'motion', '125-percent.png'))).toBe(false);
  });
  it('setup返回前renderer失效时正常路径与cleanup均不发送Escape或媒体复位', async () => {
    const model = ownedMotionCaptureModel({ setupOwnerLoss: 'renderer' }), directory = newDirectory('motion-setup-lost');
    await expect(motion.captureMotionZoom(model.runtime, artifacts.createArtifactWriter(directory), { pid: 11 },
      'motion', model.prepare, model.describe, model.screenshots, model.nativePorts)).rejects.toThrow('UI_MOTION_NATIVE_WINDOW_REQUIRED');
    expect(model.calls.filter(call => call.event === 'key')).toEqual([]);
    expect(model.calls.filter(call => call.event === 'media').map(call => call.reducedMotion)).toEqual(['reduce']);
    expect(model.state.captures).toBe(0); expect(model.state.reduced).toBe(true);
    const logs = fs.readFileSync(path.join(directory, 'collector.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(logs.filter(row => row.event === 'v16.ui_motion_restore_failed')).toHaveLength(4);
  });
  it.each(['renderer', 'url', 'main-birth', 'renderer-birth'])('setup后%s失效时cleanup零键盘零媒体写并独立记录拒绝', async ownerLoss => {
    const firstError = new Error('MODEL_PREPARE_FAILED_' + ownerLoss), model = ownedMotionCaptureModel();
    const directory = newDirectory('motion-lost-' + ownerLoss); let lossIndex;
    const prepare = async () => { lossIndex = model.calls.length; model.state.ownerLoss = ownerLoss; throw firstError; };
    await expect(motion.captureMotionZoom(model.runtime, artifacts.createArtifactWriter(directory), { pid: 11 },
      'motion', prepare, model.describe, model.screenshots, model.nativePorts)).rejects.toBe(firstError);
    expect(model.calls.slice(lossIndex).filter(call => ['key', 'media', 'content-set', 'zoom-set'].includes(call.event))).toEqual([]);
    expect(model.calls.filter(call => call.event === 'key').map(call => call.key)).toEqual(['Escape']);
    expect(model.calls.filter(call => call.event === 'media').map(call => call.reducedMotion)).toEqual(['reduce']);
    const logs = fs.readFileSync(path.join(directory, 'collector.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(logs.filter(row => row.event === 'v16.ui_motion_restore_failed')).toHaveLength(4);
    expect(model.state.captures).toBe(0); expect(model.state.reduced).toBe(true);
  });
});
