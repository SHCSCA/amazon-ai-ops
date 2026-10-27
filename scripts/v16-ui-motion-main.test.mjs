import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const main = require('./v16-ui-motion-main');
const contract = require('./package-ui-viewport-contract.cjs');
const attemptId = '21f5b684-4bae-4ea7-870c-575cedcb3803';

function model(changes = {}) {
  const owner = { mainPid: 101, mainCreationTime: 1000.123, windowId: 1, rendererPid: 202,
    rendererCreationTime: 1001.234, url: 'file:///model/index.html', electronVersion: '44.2.0' };
  const state = { mainBirth: owner.mainCreationTime, rendererBirth: owner.rendererCreationTime, rendererPid: 202,
    url: owner.url, content: [1366, 768], bounds: { x: 1, y: 2, width: 1382, height: 835 }, minimum: [1200, 700],
    zoom: 1, maximized: false, fullScreen: false, minimized: false, visible: true, destroyed: false,
    force: '', handle: Buffer.from('3412000000000000', 'hex'), calls: [], ...changes };
  const writer = { logs: [], log(event, error) { this.logs.push({ event, error }); } };
  const metrics = () => [{ pid: 303, type: 'GPU', creationTime: 1002.345, name: 'gpu', cpu: Math.random() },
    { pid: 202, type: 'Tab', creationTime: state.rendererBirth }, { pid: 101, type: 'Browser', creationTime: state.mainBirth }];
  const window = { isDestroyed: () => state.destroyed, isMaximized: () => state.maximized, isFullScreen: () => state.fullScreen,
    isMinimized: () => state.minimized, isVisible: () => state.visible, isResizable: () => true,
    unmaximize() { state.calls.push(['unmaximize']); state.maximized = false; },
    setFullScreen(value) { state.calls.push(['fullScreen', value]); state.fullScreen = value; },
    getBounds: () => state.bounds, getContentBounds: () => ({ x: 9, y: 61, width: state.content[0], height: state.content[1] }),
    getContentSize: () => state.content, getMinimumSize: () => state.minimum, getMaximumSize: () => [0, 0],
    getNativeWindowHandle: () => state.handle, isMenuBarVisible: () => true, isMenuBarAutoHide: () => false,
    setSize(...args) { state.calls.push(['setSize', ...args]); if (state.setterError) throw state.setterError; },
    setContentSize(...args) { state.calls.push(['setContentSize', ...args]); state.content = args.slice(0, 2); if (state.setterError) throw state.setterError; },
    webContents: { isDestroyed: () => false, getOSProcessId: () => state.rendererPid, getURL: () => state.url,
      getZoomFactor: () => state.zoom, setZoomFactor(value) { state.zoom = value; state.calls.push(['zoom', value]); },
      async executeJavaScript() { if (state.driftOnRead) state.url = 'file:///changed'; return { url: state.url, innerWidth: 1366, innerHeight: 768, devicePixelRatio: state.zoom }; } } };
  const electron = { app: { getAppMetrics: metrics, commandLine: { getSwitchValue: name => name === 'force-device-scale-factor' ? state.force : '' } },
    BrowserWindow: { fromId: id => id === 1 ? window : null },
    screen: { getDisplayMatching: () => ({ id: 9, scaleFactor: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) } };
  const app = { async evaluate(fn, args) {
    const callable = vm.runInNewContext('(' + fn.toString() + ')', { process: { pid: 101, versions: { electron: '44.2.0' } }, Buffer, setTimeout });
    try {
      const value = await callable(electron, args);
      if (state.returnError) throw state.returnError;
      return JSON.parse(JSON.stringify(value));
    } catch (error) { if (error instanceof Error) throw error; throw new Error(error.message); }
  } };
  return { owner, state, writer, app };
}
describe('motion Main 的真实操作与所属合同', () => {
  test('NFR 空 force 原样记录，稳定 appMetrics 只保留身份字段并排序', async () => {
    const x = model(), value = await main.readMotionMain(x.app, x.owner, { writer: x.writer });
    expect(value.forceDeviceScaleFactor).toBe(''); expect(value.hwnd).toBe('4660');
    expect(value.appMetrics.map(row => row.pid)).toEqual([101, 202, 303]); expect(value.appMetrics[2]).not.toHaveProperty('cpu');
  });
  test.each(['125-percent', 'minimum-window'])('同 Main 接收 attemptId 并记录实际 %s setter', async kind => {
    const x = model(), receipt = await main.resizeMotionWindow(x.app, x.owner, { kind, attemptId, writer: x.writer });
    expect(receipt.attemptId).toBe(attemptId); expect(receipt.kind).toBe(kind);
    expect(receipt.request).toEqual(kind === '125-percent' ? { method: 'setContentSize', ...contract.PACKAGE_UI_VIEWPORT, animate: false }
      : { method: 'setSize', width: 1199, height: 699, animate: false });
    expect(x.state.calls).toContainEqual([receipt.request.method, receipt.request.width, receipt.request.height, false]);
    expect(receipt.before.observedAt <= receipt.setterStartedAt && receipt.setterStartedAt <= receipt.setterReturnedAt).toBe(true);
  });
  test('保留退出最大化和全屏的既有生产语义', async () => {
    const x = model({ maximized: true, fullScreen: true });
    const receipt = await main.resizeMotionWindow(x.app, x.owner, { kind: '125-percent', attemptId, writer: x.writer });
    expect(x.state.calls.slice(0, 2)).toEqual([['unmaximize'], ['fullScreen', false]]);
    expect(receipt.before.maximized).toBe(false); expect(receipt.before.fullScreen).toBe(false);
  });
  test.each([
    ['Main 出生', { mainBirth: 999 }], ['Renderer 出生', { rendererBirth: 999 }], ['Renderer PID', { rendererPid: 999 }],
    ['URL', { url: 'file:///other' }], ['窗口销毁', { destroyed: true }], ['读取期间失去所属', { driftOnRead: true }]
  ])('%s 变化在 setter 前拒绝并记录', async (_label, changes) => {
    const x = model(changes);
    await expect(main.resizeMotionWindow(x.app, x.owner, { kind: '125-percent', attemptId, writer: x.writer })).rejects.toThrow('UI_MOTION_NATIVE_WINDOW_REQUIRED');
    expect(x.state.calls).toEqual([]); expect(x.writer.logs.at(-1).error).toBeInstanceOf(Error);
  });
  test.each([{ handle: Buffer.alloc(3) }, { handle: Buffer.alloc(8) }, { minimum: [1201, 700] }, { minimized: true }, { visible: false }])('无有效 HWND 或窗口状态不满足时不提交 setter %#', async changes => {
    const x = model(changes); await expect(main.resizeMotionWindow(x.app, x.owner, { kind: 'minimum-window', attemptId, writer: x.writer })).rejects.toThrow();
    expect(x.state.calls).toEqual([]);
  });
  test('拒绝未绑定 attemptId', async () => {
    const x = model(); await expect(main.resizeMotionWindow(x.app, x.owner, { kind: '125-percent', attemptId: 'invented', writer: x.writer })).rejects.toThrow('UI_MOTION_RESIZE_REQUEST_INVALID');
    expect(x.state.calls).toEqual([]);
  });
  test.each(['setterError', 'returnError'])('%s 不掩盖已经发生的部分副作用', async errorKind => {
    const error = new Error(errorKind), x = model({ [errorKind]: error });
    await expect(main.resizeMotionWindow(x.app, x.owner, { kind: '125-percent', attemptId, writer: x.writer })).rejects.toBe(error);
    if (errorKind === 'setterError') expect(x.state.calls).toContainEqual(['setContentSize', 1366, 768, false]);
    expect(x.writer.logs.at(-1).error).toBe(error);
  });
  test('恢复只重置 zoom，不合成窗口或读取身份', async () => {
    const x = model({ zoom: 1.25 }); await main.resetMotionZoom(x.app, x.owner, { writer: x.writer });
    expect(x.state.calls).toEqual([['zoom', 1]]);
  });
  test('稳定门使用统一 250ms/25ms，只有真实稳定样本通过', async () => {
    const x = model(), value = await main.readMotionMain(x.app, x.owner, { writer: x.writer }); let now = 0;
    const result = await main.settleMotionMain(x.app, x.owner, { writer: x.writer, dependencies: {
      now: () => now, wait: async ms => { expect(ms).toBe(contract.PACKAGE_UI_VIEWPORT_STATE_POLL_MS); now += ms; }, read: async () => ({ ...value, observedAt: String(now) }) } });
    expect(result.stableForMs).toBe(contract.PACKAGE_UI_VIEWPORT_STABILITY_MS);
  });
  test('持续漂移在统一五秒边界失败并保留异常', async () => {
    const x = model(), value = await main.readMotionMain(x.app, x.owner, { writer: x.writer }); let now = 0, count = 0;
    await expect(main.settleMotionMain(x.app, x.owner, { writer: x.writer, dependencies: {
      now: () => now, wait: async ms => { now += ms; }, read: async () => ({ ...value, hwnd: String(++count) }) } })).rejects.toThrow('UI_MOTION_MAIN_GEOMETRY_NOT_STABLE');
    expect(now).toBe(contract.PACKAGE_UI_VIEWPORT_RESTORE_TIMEOUT_MS);
  });
});

