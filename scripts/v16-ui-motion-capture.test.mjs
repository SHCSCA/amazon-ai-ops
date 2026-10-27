import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRequire = createRequire(path.resolve(process.cwd(), 'scripts/motion-capture-unit-loader.cjs'));
function subject() {
  const source = fs.readFileSync(fileURLToPath(new URL('./v16-ui-motion-capture.js', import.meta.url)), 'utf8');
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => {
    if (name === 'node:util') return require(name);
    if (name === './v16-performance-artifacts') return repoRequire('./v16-performance-artifacts');
    throw new Error('UNIT_CAPTURE_UNEXPECTED_REQUIRE:' + name);
  }, module, module.exports);
  return module.exports.captureNativeMotionScreenshot;
}
function model() {
  const calls = [], owner = { mainPid: 11, mainCreationTime: 1000, windowId: 1, rendererPid: 22,
    rendererCreationTime: 1100, url: 'file:///isolated/index.html', electronVersion: '44.2.0' };
  const stamp = value => '2026-10-26T04:00:00.' + String(value).padStart(3, '0') + 'Z';
  const full = observedAt => ({ ...owner, hwnd: '1000', bounds: { x: 100, y: 100, width: 1382, height: 835 },
    contentBounds: { x: 108, y: 159, width: 1366, height: 768 }, contentSize: { width: 1366, height: 768 },
    minimumSize: { width: 1200, height: 700 }, zoomFactor: 1.25, maximized: false, fullScreen: false, minimized: false, visible: true,
    forceDeviceScaleFactor: '1', renderer: { url: owner.url, innerWidth: 1093, innerHeight: 614, devicePixelRatio: 1.25 },
    display: { id: 7, scaleFactor: 1, bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
    menuBarVisible: true, menuBarAutoHide: false, appMetrics: [{ pid: 11, type: 'Browser', creationTime: 1000 }], observedAt });
  const plain = observedAt => {
    const fullValue = full(observedAt);
    const { hwnd, menuBarVisible, menuBarAutoHide, appMetrics, ...value } = fullValue;
    value.display = { id: 7, scaleFactor: 1 }; return value;
  };
  const first = { beforeMain: full(stamp(100)), afterMain: full(stamp(200)), native: { fixtureOnly: true }, invocation: { fixtureOnly: true } };
  const last = { beforeMain: full(stamp(700)), afterMain: full(stamp(800)), native: { fixtureOnly: true }, invocation: { fixtureOnly: true } };
  const legacy = { dimensions: { width: 1366, height: 768 }, nativeSize: { width: 1366, height: 768 },
    method: 'electron-webcontents-capture-page', geometryWitness: { schemaVersion: 'v16.owned-motion-geometry/1',
      method: 'electron-webcontents-capture-page', imageSemantics: 'electron-44-capture-1x-pixels',
      before: plain(stamp(300)), captureStartedAt: stamp(400), captureFinishedAt: stamp(500), after: plain(stamp(600)),
      nativeSize: { width: 1366, height: 768 }, nativeScaleFactors: [1] } };
  const observer = { snapshot: async (_owner, label) => { calls.push(label.endsWith('native-before') ? 'before' : 'after');
    if (label.endsWith('native-before')) return first; return last; } };
  const capture = async (_app, file, request, reader) => { calls.push('capture'); expect(file).toBe('isolated.png');
    expect(request).toEqual({ schemaVersion: 'v16.owned-motion-capture-request/1', owner }); expect(reader).toBe(readPng); return legacy; };
  const readPng = () => ({ width: 1366, height: 768 }), resizeReceipt = { fixtureOnly: true, attemptId: 'unit-attempt' };
  const run = () => subject()({ app: {} }, {}, 'isolated.png', { owner, observer, resizeReceipt, label: 'isolated' }, readPng, capture);
  return { run, calls, first, last, legacy, resizeReceipt, observer };
}

describe('原生motion截图夹读边界', () => {
  it('按真实两侧观察包围原capture，保留内层原时刻并明确只为隔离模型', async () => {
    const m = model(), result = await m.run();
    expect(m.calls).toEqual(['before', 'capture', 'after']);
    expect(result.geometryWitness.schemaVersion).toBe('v16.owned-motion-geometry/2');
    expect(result.geometryWitness.before).toBe(m.first.beforeMain); expect(result.geometryWitness.after).toBe(m.last.afterMain);
    expect(result.geometryWitness.captureStartedAt).toBe(m.legacy.geometryWitness.captureStartedAt);
    expect(result.geometryWitness.captureFinishedAt).toBe(m.legacy.geometryWitness.captureFinishedAt);
    expect(result.geometryWitness.resizeReceipt).toBe(m.resizeReceipt);
    expect(result.geometryWitness.nativeBefore).toBe(m.first); expect(result.geometryWitness.nativeAfter).toBe(m.last);
    expect(result.nativeSize).toBe(m.legacy.nativeSize);
  });
  it.each(['mainPid', 'rendererPid', 'url', 'forceDeviceScaleFactor'])('内层%s改变不能通过外层时间替换被掩盖', async field => {
    const m = model(); m.legacy.geometryWitness.after[field] = typeof m.legacy.geometryWitness.after[field] === 'number' ? 99 : 'changed';
    await expect(m.run()).rejects.toThrow('UI_MOTION_NATIVE_CAPTURE_MAIN_CHANGED');
  });
  it.each(['bounds', 'contentBounds', 'contentSize', 'renderer'])('内层%s改变保留真实首错', async field => {
    const m = model(); m.legacy.geometryWitness.before[field] = { changed: true };
    await expect(m.run()).rejects.toThrow('UI_MOTION_NATIVE_CAPTURE_MAIN_CHANGED');
  });
  it.each(['menuBarVisible', 'menuBarAutoHide', 'appMetrics', 'hwnd'])('外层%s变化不能发布成功见证', async field => {
    const m = model(); m.last.afterMain[field] = field.startsWith('menu') ? !m.last.afterMain[field] : 'changed';
    await expect(m.run()).rejects.toThrow('UI_MOTION_NATIVE_CAPTURE_STATE_CHANGED');
  });
  it('首次native失败不调用capture，保留原错误对象', async () => {
    const m = model(), error = new Error('UNIT_NATIVE_BEFORE_FAILED'); m.observer.snapshot = async () => { throw error; };
    await expect(m.run()).rejects.toBe(error); expect(m.calls).toEqual([]);
  });
  it('后侧native失败仍拒绝，不能仅凭已有PNG成功', async () => {
    const m = model(), original = m.observer.snapshot, error = new Error('UNIT_NATIVE_AFTER_FAILED');
    m.observer.snapshot = async (owner, label) => { if (label.endsWith('native-after')) throw error; return original(owner, label); };
    await expect(m.run()).rejects.toBe(error); expect(m.calls).toEqual(['before', 'capture']);
  });
});
