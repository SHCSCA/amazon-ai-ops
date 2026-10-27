import { createRequire } from 'node:module';

// 仅验证隔离协议模型，不提供真实应用、批准、执行或 APP_READY 信用。
const require = createRequire(import.meta.url);
const configuration = require('./package-ui-viewport-contract.cjs');
const EPOCH = 621355968000000000n;
export const stamp = n => new Date(Date.parse('2026-10-26T04:00:00.000Z') + n).toISOString();
export const birth = (pid, value, executablePath = 'G:\\package\\AmazonAIOpsAgent.exe') => ({ pid, creationTimeUtc: value,
  creationTimeUtcTicks: String(EPOCH + BigInt(Date.parse(value.slice(0, 19) + '.000Z')) * 10000n + BigInt(value.slice(20, 27))),
  executablePath });
const defaultMainIdentity = birth(11, '2026-10-26T03:59:00.1234567Z');
const defaultRendererIdentity = birth(22, '2026-10-26T03:59:01.2345670Z');
const defaultGpuIdentity = birth(44, '2026-10-26T03:59:02.3333339Z');
const rendererMs = Number((BigInt(defaultRendererIdentity.creationTimeUtcTicks) - EPOCH) / 10n) / 1000;
const defaultOwner = { mainPid: 11, mainCreationTime: Number((BigInt(defaultMainIdentity.creationTimeUtcTicks) - EPOCH) / 10n) / 1000,
  windowId: 1, rendererPid: 22, rendererCreationTime: rendererMs,
  url: 'file:///G:/package/resources/app/dist/renderer/index.html', electronVersion: '44.2.0' };
export const px = (x, y, width, height) => ({ left: x, top: y, right: x + width, bottom: y + height });
function queries(window, at, toTime = stamp) {
  const query = (returnValue, more = {}) => ({ executed: true, success: true, returnValue, lastError: 0, ...more });
  const screen = window.clientRectScreenPhysicalPx, local = window.clientRectLocalPhysicalPx;
  return { startedAt: toTime(at), finishedAt: toTime(at), isWindow: query(true),
    threadProcess: query(window.threadId, { outPid: window.pid }), root: query(window.rootHwnd), isChild: query(true),
    parent: query(window.parentHwnd), className: query(window.className.length, { outText: window.className }), visible: query(window.visible),
    windowRect: query(true, { outRectScreenPhysicalPx: structuredClone(window.windowRectScreenPhysicalPx) }),
    clientRect: query(true, { outRectLocalPhysicalPx: structuredClone(local) }),
    clientScreenRect: { executed: true, success: true, returnValue: true,
      clientQuery: query(true, { outRect: structuredClone(local) }),
      firstQuery: query(true, { outPoint: { x: screen.left, y: screen.top } }),
      lastQuery: query(true, { outPoint: { x: screen.right, y: screen.bottom } }), outRectScreenPhysicalPx: structuredClone(screen) },
    dpi: query(window.dpi), style: query(String(BigInt.asIntN(32, BigInt(window.styleHex))), { hex: window.styleHex }),
    exStyle: query(String(BigInt.asIntN(32, BigInt(window.exStyleHex))), { hex: window.exStyleHex }) };
}
function childRow(window, process, at, mainPid, toTime) {
  const unadmitted = process.pid !== mainPid, { creationTimeUtc, ...identity } = process;
  return { hwnd: window.hwnd, beforeQueries: queries(window, at, toTime), afterQueries: queries(window, at, toTime),
    ownerAdmission: unadmitted ? 'UNADMITTED' : 'ADMITTED_MAIN', complete: true,
    isVisibleRenderWidgetCandidate: window.className === 'Chrome_RenderWidgetHostHWND' && window.visible,
    rejectionReasons: unadmitted ? ['PID_NOT_MAIN_OR_EXPECTED_RENDERER'] : [],
    processObservationUntrusted: { executed: true, success: true, authority: 'NONE', ...identity } };
}
export function changeQueries(row, edit) { edit(row.beforeQueries); edit(row.afterQueries); }
export function resizeChild(row, screen) {
  const local = px(0, 0, screen.right - screen.left, screen.bottom - screen.top);
  changeQueries(row, q => {
    q.windowRect.outRectScreenPhysicalPx = structuredClone(screen); q.clientRect.outRectLocalPhysicalPx = structuredClone(local);
    q.clientScreenRect.outRectScreenPhysicalPx = structuredClone(screen); q.clientScreenRect.clientQuery.outRect = structuredClone(local);
    q.clientScreenRect.firstQuery.outPoint = { x: screen.left, y: screen.top };
    q.clientScreenRect.lastQuery.outPoint = { x: screen.right, y: screen.bottom };
  });
}

export function buildOwnedMotionV2Model(options = {}) {
  const { deviceScaleFactor: dsf = 1.25, kind = 'minimum-window', timeScale = 1, nonceSeed = 0 } = options;
  const owner = structuredClone(options.owner || defaultOwner);
  const baseTime = options.execution?.startedAt || options.baseTime || '2026-10-26T04:00:00.000Z';
  const baseMs = Date.parse(baseTime), stamp = n => new Date(baseMs + n * timeScale).toISOString();
  const fromUnixTicks = ticks => new Date(Number(ticks / 10000n)).toISOString()
    .replace(/(\d{3})Z$/, (_, ms) => ms + String(ticks % 10000n).padStart(4, '0') + 'Z');
  const fromMetric = ms => fromUnixTicks(BigInt(Math.round(ms * 1000)) * 10n);
  const nativeMain = structuredClone(options.nativeMain || (options.owner
    ? { birthUtc: fromMetric(owner.mainCreationTime), executablePath: defaultMainIdentity.executablePath }
    : { birthUtc: defaultMainIdentity.creationTimeUtc, executablePath: defaultMainIdentity.executablePath }));
  const mainIdentity = birth(owner.mainPid, nativeMain.birthUtc, nativeMain.executablePath);
  const rendererIdentity = birth(owner.rendererPid, fromMetric(owner.rendererCreationTime), nativeMain.executablePath);
  const gpuPid = [owner.mainPid, owner.rendererPid].includes(44) ? Math.max(owner.mainPid, owner.rendererPid) + 1 : 44;
  const gpuIdentity = options.owner ? birth(gpuPid, fromUnixTicks(BigInt(Math.round(owner.rendererCreationTime * 1000)) * 10n + 10009n), nativeMain.executablePath)
    : birth(gpuPid, defaultGpuIdentity.creationTimeUtc, nativeMain.executablePath);
  const hwnd = options.hwnd || '1000', widgetHwnd = options.widgetHwnd || '1001', gpuHwnd = options.gpuHwnd || '1002';
  const helperPid = [owner.mainPid, owner.rendererPid].includes(33) ? Math.max(owner.mainPid, owner.rendererPid) + 2 : 33;
  const execution = structuredClone(options.execution || { startedAt: stamp(0), finishedAt: stamp(10000) });

  const main = (view, at) => {
    const normal = view === '125-percent', fractional = dsf === 1.25;
    const contentSize = normal ? { width: fractional ? 1367 : 1366, height: fractional ? 769 : 768 }
      : { width: fractional ? 1188 : 1184, height: fractional ? 643 : 633 };
    const bounds = normal ? { x: 100, y: 100, width: fractional ? 1380 : 1382, height: fractional ? 829 : 835 }
      : { x: 100, y: 100, width: 1200, height: fractional ? 702 : 700 };
    const zoomFactor = normal ? 1.25 : 1;
    return { ...owner, hwnd, nativeHandleBytes: 8, bounds,
      contentBounds: { x: fractional ? 106 : 108, y: fractional ? 153 : 159, ...contentSize }, contentSize,
      minimumSize: { width: 1200, height: 700 }, maximumSize: { width: 0, height: 0 }, zoomFactor,
      maximized: false, minimized: false, fullScreen: false, visible: true, resizable: true,
      menuBarVisible: true, menuBarAutoHide: false,
      display: { id: 7, scaleFactor: dsf, bounds: { x: 0, y: 0, width: 2400, height: 1400 }, workArea: { x: 0, y: 0, width: 2400, height: 1360 } },
      forceDeviceScaleFactor: String(dsf), chromiumFeatureSwitches: { enabled: '', disabled: '' },
      renderer: { url: owner.url, innerWidth: Math.ceil(contentSize.width / zoomFactor), innerHeight: Math.ceil(contentSize.height / zoomFactor),
        devicePixelRatio: dsf * zoomFactor }, appMetrics: [
        { pid: owner.mainPid, type: 'Browser', creationTime: owner.mainCreationTime }, { pid: owner.rendererPid, type: 'Tab', creationTime: owner.rendererCreationTime },
        { pid: gpuPid, type: 'GPU', creationTime: Number((BigInt(gpuIdentity.creationTimeUtcTicks) - EPOCH) / 10n) / 1000 }].sort((a, b) => a.pid - b.pid), observedAt: stamp(at) };
  };
  const nativeWindow = (windowHwnd, outer, client, at) => ({ hwnd: windowHwnd, pid: owner.mainPid, threadId: 101, parentHwnd: windowHwnd === hwnd ? '0' : hwnd,
    rootHwnd: hwnd, className: windowHwnd === hwnd ? 'Chrome_WidgetWin_1' : 'Chrome_RenderWidgetHostHWND', visible: true,
    dpi: 96, styleHex: windowHwnd === hwnd ? '0x16CF0000' : '0x56000000', exStyleHex: '0x00000000',
    windowRectScreenPhysicalPx: outer, clientRectScreenPhysicalPx: client,
    clientRectLocalPhysicalPx: px(0, 0, client.right - client.left, client.bottom - client.top), observedAt: stamp(at) });
  const observation = (view, at) => {
    const snapshot = main(view, at), normal = view === '125-percent';
    const width = dsf === 1 ? snapshot.bounds.width : (normal ? 1724 : 1500);
    const height = dsf === 1 ? snapshot.bounds.height : (normal ? 1035 : 877);
    const x = dsf === 1 ? 100 : 405, y = dsf === 1 ? 100 : 134;
    const outer = px(x, y, width, height), client = px(x + 8, y + 31, width - 16, height - 39);
    const top = Math.floor(28 * dsf), right = Math.ceil(snapshot.contentSize.width * dsf);
    const bottom = Math.ceil((28 + snapshot.contentSize.height) * dsf);
    const widgetRect = px(client.left, client.top + top, right, bottom - top);
    const gpu = { ...nativeWindow(gpuHwnd, client, client, at + 4), pid: gpuPid, className: 'Intermediate D3D Window',
      parentHwnd: hwnd, threadId: 202, styleHex: '0x58000000', exStyleHex: '0x00280024' };
    const native = { threadId: 201, contextBefore: '-3', contextActive: '-4', requestedContext: '-4', pmv2Verified: true,
      primaryBefore: nativeWindow(hwnd, outer, client, at + 3), primaryAfter: nativeWindow(hwnd, outer, client, at + 5),
      children: [childRow(nativeWindow(widgetHwnd, widgetRect, widgetRect, at + 4), mainIdentity, at + 4, owner.mainPid, stamp), childRow(gpu, gpuIdentity, at + 4, owner.mainPid, stamp)],
      childInventoryVerdict: { rawChildCount: 2, visibleRenderWidgetCandidateCount: 1, visibleRenderWidgetCandidateHwnds: [widgetHwnd],
        selectedWidgetHwnd: widgetHwnd, selectedWidgetOwnerAdmission: 'ADMITTED_MAIN', completed: true, accepted: true,
        authority: 'DIAGNOSTIC_MAIN_OR_EXPECTED_RENDERER_ONLY', rejectionReasons: [] },
      monitor: { handle: '7', device: '\\\\.\\DISPLAY1', flags: 1, monitorRectScreenPhysicalPx: px(0, 0, 3000, 1750), workRectScreenPhysicalPx: px(0, 0, 3000, 1700) },
      minMaxQuery: { timeoutMs: 1000 } };
    const boundMain = { ...mainIdentity, hwnd, windowPid: owner.mainPid, windowThreadId: 101 };
    const nonce = `00000000-0000-4000-8000-${String(at + nonceSeed * 100000).padStart(12, '0')}`;
    return { beforeMain: main(view, at + 1), native: { schemaVersion: 'v16.native-physical-geometry/2', passed: true,
      diagnosticOnly: true, formalCredit: false, coordinateSpace: 'physical-pixels', limits: structuredClone(configuration.PACKAGE_UI_NATIVE_GEOMETRY_LIMITS),
      startedAt: stamp(at + 2), finishedAt: stamp(at + 6),
      ownerRequest: { mainPid: owner.mainPid, mainCreationTimeUtcTicks: mainIdentity.creationTimeUtcTicks,
        mainExecutablePath: mainIdentity.executablePath, hwnd, requestNonce: nonce, expectedRendererPid: owner.rendererPid },
      ownerBefore: structuredClone(boundMain), ownerAfter: structuredClone(boundMain), rendererBefore: structuredClone(rendererIdentity), rendererAfter: structuredClone(rendererIdentity), native,
      contextRestore: { attempted: true, confirmed: true, threadId: 201, expectedContext: '-3', contextAfter: '-3', returnValue: '-4', lastError: 0 } },
    afterMain: main(view, at + 7), invocation: {
      kind: 'v16-native-physical-helper-invocation/1', diagnosticOnly: true, formalCredit: false,
      nonce, startedAt: stamp(at + 1), beforeMain: main(view, at + 1), timedOut: false, error: null, finishedAt: stamp(at + 7),
      tool: { path: 'G:\\scripts\\v16-ui-native-geometry.ps1', sha256: 'a'.repeat(64), sizeBytes: 20000,
        stat: { ino: 1, size: 20000, mtimeMs: 1792987200000, ctimeMs: 1792987200000, birthtimeMs: 1792987200000, mode: 33206, nlink: 1 } },
      stdout: { path: 'G:\\evidence\\stdout.log', sha256: 'b'.repeat(64), sizeBytes: 9000 },
      stderr: { path: 'G:\\evidence\\stderr.log', sha256: 'c'.repeat(64), sizeBytes: 0 },
      command: { executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', shell: false, windowsHide: true,
        args: ['-NoProfile', '-NonInteractive', '-File', 'G:\\scripts\\v16-ui-native-geometry.ps1',
          '-MainPid', String(owner.mainPid), '-MainCreationTimeUtcTicks', mainIdentity.creationTimeUtcTicks, '-MainExecutablePath', mainIdentity.executablePath,
          '-Hwnd', hwnd, '-ExpectedRendererPid', String(owner.rendererPid), '-RequestNonce', nonce, '-HelperTimeoutMs', '20000', '-WmQueryTimeoutMs', '1000',
          '-MaxOutputBytes', '524288', '-MaxChildren', '256'] },
      events: [{ event: 'spawn', pid: helperPid, at: stamp(at + 1) }, { event: 'exit', code: 0, signal: null, at: stamp(at + 6) },
        { event: 'close', code: 0, signal: null, at: stamp(at + 7) }] } };
  };
  const witness = view => {
    const base = view === '125-percent' ? 1000 : 5000, snapshot = main(view, base + 100);
    const request = view === '125-percent' ? { method: 'setContentSize', width: 1366, height: 768, animate: false }
      : { method: 'setSize', width: 1199, height: 699, animate: false };
    return { schemaVersion: 'v16.owned-motion-geometry/2', method: 'electron-webcontents-capture-page', imageSemantics: 'electron-44-capture-1x-pixels',
      before: snapshot, after: main(view, base + 500), captureStartedAt: stamp(base + 200), captureFinishedAt: stamp(base + 300),
      nativeSize: { width: Math.ceil(snapshot.contentSize.width * dsf), height: Math.ceil(snapshot.contentSize.height * dsf) }, nativeScaleFactors: [1],
      resizeReceipt: { attemptId: `10000000-0000-4000-8000-${String(base + nonceSeed * 100000).padStart(12, '0')}`, kind: view, startedAt: stamp(base),
        before: main(view, base), request, zoomRequest: snapshot.zoomFactor, setterStartedAt: stamp(base + 1), setterReturnedAt: stamp(base + 2),
        afterImmediate: main(view, base + 3), finishedAt: stamp(base + 4) }, nativeBefore: observation(view, base + 110), nativeAfter: observation(view, base + 400) };
  };
  return { witness: witness(kind), expected: { kind, owner: structuredClone(owner), deviceScaleFactor: dsf,
    nativeMain,
    referenceGeometry: kind === 'minimum-window' ? witness('125-percent') : null,
    execution, capturedAt: options.capturedAt || new Date(Math.min(Date.parse(execution.finishedAt) - 1, Date.parse(stamp(9500)))).toISOString() } };
}
