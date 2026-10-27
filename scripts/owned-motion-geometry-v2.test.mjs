import { test, expect } from 'vitest';
import { createRequire } from 'node:module';
import { buildOwnedMotionV2Model, birth, stamp, px, changeQueries, resizeChild } from './owned-motion-geometry-v2.test-support.mjs';

const require = createRequire(import.meta.url);
const { validateOwnedMotionV2, OwnedMotionGeometryV2Error } = require('./owned-motion-geometry-v2.cjs');
const configuration = require('./package-ui-viewport-contract.cjs');
const { PACKAGE_UI_VIEWPORT, PACKAGE_UI_VIEWPORT_TOLERANCE } = configuration;
const fixture = (deviceScaleFactor = 1.25, kind = 'minimum-window') => buildOwnedMotionV2Model({ deviceScaleFactor, kind });

const redraw = (value, operation) => {
  for (const snapshot of [value.witness.before, value.witness.after,
    value.witness.nativeBefore.beforeMain, value.witness.nativeBefore.afterMain,
    value.witness.nativeAfter.beforeMain, value.witness.nativeAfter.afterMain,
    value.witness.nativeBefore.invocation.beforeMain, value.witness.nativeAfter.invocation.beforeMain,
    value.witness.resizeReceipt.before, value.witness.resizeReceipt.afterImmediate]) operation(snapshot);
};
function red(value) {
  let failure;
  try { validateOwnedMotionV2(value.witness, value.expected); }
  catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(OwnedMotionGeometryV2Error);
  expect(failure.code).toBe('UI_MOTION_V2_GEOMETRY_INVALID');
}

test('冻结原viewport与容差，不能修改配置总线或传自由容差', () => {
  expect(PACKAGE_UI_VIEWPORT).toStrictEqual({ width: 1366, height: 768 });
  expect(PACKAGE_UI_VIEWPORT_TOLERANCE).toStrictEqual({ width: 2, height: 2, deviceScaleFactor: 0.02 });
  expect(Object.isFrozen(PACKAGE_UI_VIEWPORT) && Object.isFrozen(PACKAGE_UI_VIEWPORT_TOLERANCE)).toBe(true);
  expect(configuration.PACKAGE_UI_MINIMUM_WINDOW).toStrictEqual({ width: 1200, height: 700 });
  expect(configuration.PACKAGE_UI_NATIVE_GEOMETRY_LIMITS).toStrictEqual({ helperTimeoutMs: 20000, wmQueryTimeoutMs: 1000, maxOutputBytes: 524288, maxChildren: 256 });
  expect(configuration.PACKAGE_UI_VIEWPORT_RESTORE_TIMEOUT_MS).toBe(5000);
  expect(configuration.PACKAGE_UI_VIEWPORT_STABILITY_MS).toBe(250);
  expect(configuration.PACKAGE_UI_VIEWPORT_STATE_POLL_MS).toBe(25);
  expect(Object.isFrozen(configuration) && Object.isFrozen(configuration.PACKAGE_UI_MINIMUM_WINDOW)
    && Object.isFrozen(configuration.PACKAGE_UI_NATIVE_GEOMETRY_LIMITS)).toBe(true);
  const value = fixture(); value.expected.tolerance = 200; red(value);
});
for (const dsf of [1, 1.25]) for (const kind of ['125-percent', 'minimum-window']) {
  test(`DSF=${dsf} ${kind}固定协议模型通过且只返回精确pixels`, () => {
    const value = fixture(dsf, kind);
    expect(validateOwnedMotionV2(value.witness, value.expected)).toStrictEqual(value.witness.nativeSize);
  });
}
test('共享support接受既有governance owner与原九秒时间范围，不生成原件', () => {
  const base = Date.parse('2026-10-26T04:00:00.000Z');
  const value = buildOwnedMotionV2Model({ deviceScaleFactor: 1, kind: 'minimum-window', timeScale: 0.1, nonceSeed: 3,
    owner: { mainPid: 123, mainCreationTime: base - 1000, windowId: 1, rendererPid: 456, rendererCreationTime: base,
      url: 'file:///fixture-package/dist/renderer/index.html', electronVersion: '44.2.0' },
    nativeMain: { birthUtc: '2026-10-26T03:59:59.0000007Z', executablePath: 'G:\\fixture-package\\AmazonAIOpsAgent.exe' },
    execution: { startedAt: new Date(base).toISOString(), finishedAt: new Date(base + 9000).toISOString() }, capturedAt: new Date(base + 1000).toISOString() });
  expect(value.witness.before.mainPid).toBe(123); expect(value.witness.before.rendererPid).toBe(456);
  expect(value.witness.after.observedAt).toBe('2026-10-26T04:00:00.550Z');
  expect(validateOwnedMotionV2(value.witness, value.expected)).toStrictEqual({ width: 1184, height: 633 });
});
test('已核GPU的原大surface框不替代Main RenderWidget覆盖，也不要求同client缩小', () => {
  const value = fixture(1, 'minimum-window');
  for (const observation of [value.witness.nativeBefore, value.witness.nativeAfter]) {
    const client = observation.native.native.primaryBefore.clientRectScreenPhysicalPx;
    resizeChild(observation.native.native.children[1], px(client.left, client.top, client.right - client.left + 200, client.bottom - client.top + 200));
  }
  expect(validateOwnedMotionV2(value.witness, value.expected)).toStrictEqual(value.witness.nativeSize);
});
test('DPI context等价别名以真实AreEqual收据为准，不要求句柄字面相同', () => {
  const value = fixture(1.25, '125-percent');
  for (const observation of [value.witness.nativeBefore, value.witness.nativeAfter]) {
    observation.native.native.contextBefore = '2147508240';
    observation.native.contextRestore.expectedContext = '2147508240';
    observation.native.contextRestore.contextAfter = '24592';
  }
  expect(validateOwnedMotionV2(value.witness, value.expected)).toStrictEqual(value.witness.nativeSize);
});
test('操作时序保持原毫秒粒度，原生出生100ns不随之降精度', () => {
  const value = fixture(1.25, '125-percent'), observation = value.witness.nativeBefore;
  observation.native.finishedAt = observation.afterMain.observedAt.replace(/(\d{3})Z$/, '$19000Z');
  observation.invocation.events[1].at = observation.afterMain.observedAt;
  expect(validateOwnedMotionV2(value.witness, value.expected)).toStrictEqual(value.witness.nativeSize);
  value.expected.nativeMain.birthUtc = '2026-10-26T03:59:00.1234568Z'; red(value);
});
for (let remainder = 0; remainder < 10; remainder++) {
  test(`Renderer FILETIME余数${remainder}严格截断微秒，不四舍五入或放宽±1`, () => {
    const value = fixture(1.25, '125-percent');
    const actual = birth(22, `2026-10-26T03:59:01.234567${remainder}Z`);
    for (const observation of [value.witness.nativeBefore, value.witness.nativeAfter]) {
      observation.native.rendererBefore = structuredClone(actual); observation.native.rendererAfter = structuredClone(actual);
    }
    expect(validateOwnedMotionV2(value.witness, value.expected)).toStrictEqual(value.witness.nativeSize);
    const changed = (Math.round(value.expected.owner.rendererCreationTime * 1000) + 1) / 1000;
    value.expected.owner.rendererCreationTime = changed;
    redraw(value, snapshot => { snapshot.rendererCreationTime = changed; snapshot.appMetrics.find(metric => metric.pid === 22).creationTime = changed; }); red(value);
  });
}
for (const [label, mutate] of [
  ['旧schema', value => { value.witness.schemaVersion = 'v16.owned-motion-geometry/1'; }],
  ['缺native', value => { delete value.witness.nativeBefore; }],
  ['Main PID', value => { value.witness.before.mainPid = 99; }],
  ['Renderer birth', value => { value.witness.nativeBefore.native.rendererBefore.creationTimeUtcTicks = '1'; }],
  ['trusted Main birth', value => { value.expected.nativeMain.birthUtc = '2026-10-26T03:59:00.1234568Z'; }],
  ['trusted EXE', value => { value.expected.nativeMain.executablePath = 'G:\\other\\AmazonAIOpsAgent.exe'; }],
  ['Main HWND', value => { value.witness.after.hwnd = '1002'; }],
  ['截图中途geometry变化', value => { value.witness.after.contentSize.width++; }],
  ['force开关', value => { redraw(value, snapshot => { snapshot.forceDeviceScaleFactor = ''; }); }],
  ['DPR', value => { redraw(value, snapshot => { snapshot.renderer.devicePixelRatio = 1.249; }); }],
  ['错误resize参数', value => { value.witness.resizeReceipt.request.width = 1200; }],
  ['minimum下穿', value => { redraw(value, snapshot => { snapshot.bounds.height = 699; }); }],
  ['minimum超2', value => { redraw(value, snapshot => { snapshot.bounds.height = 703; }); }],
  ['capture时序倒置', value => { value.witness.captureStartedAt = stamp(5405); }],
  ['helper失败', value => { value.witness.nativeBefore.native.passed = false; }],
  ['PMv2恢复失败', value => { value.witness.nativeBefore.native.contextRestore.confirmed = false; }],
  ['helper上限扩容', value => { value.witness.nativeBefore.native.limits.helperTimeoutMs++; }],
  ['缺实测limits', value => { delete value.witness.nativeBefore.native.limits; }],
  ['WM上限偏离总线', value => { value.witness.nativeBefore.native.native.minMaxQuery.timeoutMs--; }],
  ['同一native nonce重放', value => {
    const nonce = value.witness.nativeBefore.invocation.nonce;
    value.witness.nativeAfter.invocation.nonce = nonce; value.witness.nativeAfter.native.ownerRequest.requestNonce = nonce;
    value.witness.nativeAfter.invocation.command.args[15] = nonce;
  }],
  ['helper退出非零', value => { value.witness.nativeBefore.invocation.events[1].code = 1; }],
  ['helper冒充Main', value => { value.witness.nativeBefore.invocation.events[0].pid = value.expected.owner.mainPid; }],
  ['helper字节超限', value => { value.witness.nativeBefore.invocation.stdout.sizeBytes = 524289; }],
  ['PS参数扩预算', value => { value.witness.nativeBefore.invocation.command.args[17] = '20001'; }],
  ['重复RenderWidget', value => { const row = structuredClone(value.witness.nativeBefore.native.native.children[0]); row.hwnd = '1003'; value.witness.nativeBefore.native.native.children.push(row); }],
  ['隐藏RenderWidget', value => { const row = value.witness.nativeBefore.native.native.children[0]; changeQueries(row, q => { q.visible.returnValue = false; }); row.isVisibleRenderWidgetCandidate = false; }],
  ['非本窗child', value => { changeQueries(value.witness.nativeBefore.native.native.children[0], q => { q.root.returnValue = '9999'; }); }],
  ['child越出client', value => { changeQueries(value.witness.nativeBefore.native.native.children[0], q => { q.windowRect.outRectScreenPhysicalPx.right++; }); }],
  ['GPU未知class', value => { changeQueries(value.witness.nativeBefore.native.native.children[1], q => { q.className.outText = 'Unknown'; q.className.returnValue = 7; }); }],
  ['GPU不在Main metrics', value => {
    const row = value.witness.nativeBefore.native.native.children[1]; changeQueries(row, q => { q.threadProcess.outPid = 55; }); row.processObservationUntrusted.pid = 55;
  }],
  ['GPU错误metrics type', value => { redraw(value, snapshot => { snapshot.appMetrics.find(metric => metric.pid === 44).type = 'Utility'; }); }],
  ['GPU错误birth', value => {
    const process = value.witness.nativeBefore.native.native.children[1].processObservationUntrusted;
    process.creationTimeUtcTicks = String(BigInt(process.creationTimeUtcTicks) + 10n);
  }],
  ['GPU错误EXE', value => { value.witness.nativeBefore.native.native.children[1].processObservationUntrusted.executablePath = 'G:\\other\\AmazonAIOpsAgent.exe'; }],
  ['GPU不可读identity', value => { value.witness.nativeBefore.native.native.children[1].processObservationUntrusted.success = false; }],
  ['GPU伪admission', value => { value.witness.nativeBefore.native.native.children[1].ownerAdmission = 'ADMITTED_MAIN'; }],
  ['GPU伪authority', value => { value.witness.nativeBefore.native.native.children[1].processObservationUntrusted.authority = 'MAIN'; }],
  ['GPU伪第二可见RenderWidget', value => {
    const row = value.witness.nativeBefore.native.native.children[1];
    changeQueries(row, q => { q.className.outText = 'Chrome_RenderWidgetHostHWND'; q.className.returnValue = q.className.outText.length; });
    row.isVisibleRenderWidgetCandidate = true;
  }],
  ['child API未成功却伪complete', value => { value.witness.nativeBefore.native.native.children[0].beforeQueries.threadProcess.success = false; }],
  ['native frame变化', value => { value.witness.nativeAfter.native.native.primaryBefore.styleHex = '0x00000000'; }],
  ['PNG少1px', value => { value.witness.nativeSize.width--; }],
  ['100%内容偏1', value => { redraw(value, snapshot => { snapshot.contentSize.width++; snapshot.contentBounds.width++; snapshot.renderer.innerWidth++; }); }],
]) {
  test(label + '必须RED且不能借未解决coverage错误取得假阴性信用', () => { const value = fixture(label.startsWith('100%') ? 1 : 1.25); mutate(value); red(value); });
}
test('每视图前后都稳定仍必须跨视图严格匹配原生OS frame', () => {
  const value = fixture();
  for (const observation of [value.witness.nativeBefore, value.witness.nativeAfter])
    for (const primary of [observation.native.native.primaryBefore, observation.native.native.primaryAfter]) primary.windowRectScreenPhysicalPx.left--;
  red(value);
});
test('每视图前后都稳定仍拒绝跨视图菜单状态切换', () => {
  const value = fixture(); redraw(value, snapshot => { snapshot.menuBarVisible = false; }); red(value);
});

test('native client内300×300小角落不能冒充minimum完整viewport', () => {
  const value = fixture();
  redraw(value, snapshot => {
    snapshot.contentSize = { width: 300, height: 300 }; snapshot.contentBounds = { x: 106, y: 153, width: 300, height: 300 };
    snapshot.renderer.innerWidth = 300; snapshot.renderer.innerHeight = 300;
  });
  value.witness.nativeSize = { width: 375, height: 375 };
  for (const observation of [value.witness.nativeBefore, value.witness.nativeAfter]) {
    const widget = observation.native.native.children[0], outer = observation.native.native.primaryBefore.clientRectScreenPhysicalPx;
    resizeChild(widget, px(outer.left, outer.top + 30, 375, 375));
  }
  red(value);
});


const { validateOwnedMotionV2Frame } = require('./owned-motion-geometry-v2.cjs');
function rewriteStableWidget(value, edit) {
  for (const observation of [value.witness.nativeBefore, value.witness.nativeAfter]) {
    const row = observation.native.native.children[0], rect = structuredClone(row.beforeQueries.windowRect.outRectScreenPhysicalPx);
    edit(rect); resizeChild(row, rect);
  }
}
for (const dsf of [1, 1.25]) for (const kind of ['125-percent', 'minimum-window']) {
  test('DSF=' + dsf + ' ' + kind + '的frame冻结PNG与真实可见交集，位图边缘不授可见信用', () => {
    const value = fixture(dsf, kind), frame = validateOwnedMotionV2Frame(value.witness, value.expected);
    const expected = dsf === 1 ? (kind === '125-percent' ? { width: 1366, height: 768 } : { width: 1184, height: 633 })
      : kind === '125-percent' ? { width: 1708, height: 961 } : { width: 1484, height: 803 };
    expect(frame.pixels).toStrictEqual(value.witness.nativeSize); expect(frame.visibleViewport).toStrictEqual(expected);
    expect(Object.isFrozen(frame) && Object.isFrozen(frame.pixels) && Object.isFrozen(frame.visibleViewport)).toBe(true);
    expect(validateOwnedMotionV2(value.witness, value.expected)).toStrictEqual(frame.pixels);
  });
}
for (const kind of ['125-percent', 'minimum-window']) {
  test('125% ' + kind + '按原生绝对client包围重建右底各超1，不等价于自由容差', () => {
    const value = fixture(1.25, kind), native = value.witness.nativeBefore.native.native;
    const client = native.primaryBefore.clientRectScreenPhysicalPx;
    const widget = native.children[0].beforeQueries.windowRect.outRectScreenPhysicalPx;
    expect(client.left).toBe(413); expect(client.top).toBe(165);
    expect(widget.left).toBe(client.left); expect(widget.top).toBe(client.top + 35);
    expect(widget.right).toBe(client.right + 1); expect(widget.bottom).toBe(client.bottom + 1);
    expect(validateOwnedMotionV2Frame(value.witness, value.expected).visibleViewport.width).toBe(client.right - widget.left);
  });
}
for (const [label, edit] of [
  ['左侧偏1', rect => { rect.left++; }], ['顶部偏1', rect => { rect.top++; }],
  ['右侧少1', rect => { rect.right--; }], ['底部少1', rect => { rect.bottom--; }],
  ['右侧多1', rect => { rect.right++; }], ['底部多1', rect => { rect.bottom++; }],
]) {
  test(label + '即使两次原始查询和两组观察稳定仍拒绝', () => {
    const value = fixture(1.25, '125-percent'); rewriteStableWidget(value, edit); red(value);
  });
}
test('每视图本身可精确包围仍拒绝跨视图菜单占位DIP变化', () => {
  const value = fixture();
  redraw(value, snapshot => { snapshot.contentSize.height--; snapshot.contentBounds.height--; snapshot.renderer.innerHeight--; });
  value.witness.nativeSize.height = Math.ceil(value.witness.before.contentSize.height * 1.25);
  rewriteStableWidget(value, rect => { rect.top++; }); red(value);
});
test('严格关联GPU三类原始矩形异步更新仍不提供viewport或authority信用', () => {
  const value = fixture(1.25, '125-percent');
  const row = value.witness.nativeAfter.native.native.children[1];
  const rect = row.beforeQueries.windowRect.outRectScreenPhysicalPx;
  resizeChild(row, px(rect.left, rect.top, rect.right - rect.left + 200, rect.bottom - rect.top + 100));
  expect(row.beforeQueries).toStrictEqual(row.afterQueries);
  expect(row.ownerAdmission).toBe('UNADMITTED'); expect(row.processObservationUntrusted.authority).toBe('NONE');
  expect(validateOwnedMotionV2(value.witness, value.expected)).toStrictEqual(value.witness.nativeSize);
});
test('GPU几何可异步更新不放宽同次身份及样式稳定门', () => {
  const value = fixture(1.25, '125-percent'), row = value.witness.nativeAfter.native.native.children[1];
  const rect = row.beforeQueries.windowRect.outRectScreenPhysicalPx;
  resizeChild(row, px(rect.left, rect.top, rect.right - rect.left + 200, rect.bottom - rect.top + 100));
  row.afterQueries.style.hex = '0x00000000'; row.afterQueries.style.returnValue = '0'; red(value);
});

for (const [label, mutate] of [
  ['windowRect', q => { q.windowRect.outRectScreenPhysicalPx.right++; }],
  ['clientRect', q => {
    q.clientRect.outRectLocalPhysicalPx.right++; q.clientScreenRect.clientQuery.outRect.right++;
    q.clientScreenRect.outRectScreenPhysicalPx.right++; q.clientScreenRect.lastQuery.outPoint.x++;
  }],
  ['clientScreenRect', q => {
    q.clientScreenRect.outRectScreenPhysicalPx.left++; q.clientScreenRect.outRectScreenPhysicalPx.right++;
    q.clientScreenRect.firstQuery.outPoint.x++; q.clientScreenRect.lastQuery.outPoint.x++;
  }],
]) {
  test('GPU同raw ' + label + '单边变更不能伪complete通过', () => {
    const value = fixture(1.25, '125-percent'), row = value.witness.nativeBefore.native.native.children[1];
    mutate(row.afterQueries); expect(row.complete).toBe(true); red(value);
  });
}
