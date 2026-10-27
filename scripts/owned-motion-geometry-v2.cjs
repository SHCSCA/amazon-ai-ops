'use strict';

const { isDeepStrictEqual: equal } = require('node:util');
const { PACKAGE_UI_VIEWPORT, PACKAGE_UI_VIEWPORT_TOLERANCE, PACKAGE_UI_MINIMUM_WINDOW,
  PACKAGE_UI_NATIVE_GEOMETRY_LIMITS } = require('./package-ui-viewport-contract.cjs');
const ERROR = 'UI_MOTION_V2_GEOMETRY_INVALID';
const EPOCH_TICKS = 621355968000000000n;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const OWNER_KEYS = ['mainPid', 'mainCreationTime', 'windowId', 'rendererPid', 'rendererCreationTime', 'url', 'electronVersion'];
const MAIN_KEYS = [...OWNER_KEYS, 'hwnd', 'nativeHandleBytes', 'bounds', 'contentBounds', 'contentSize', 'minimumSize',
  'maximumSize', 'zoomFactor', 'maximized', 'minimized', 'fullScreen', 'visible', 'resizable', 'menuBarVisible',
  'menuBarAutoHide', 'display', 'forceDeviceScaleFactor', 'chromiumFeatureSwitches', 'renderer', 'appMetrics', 'observedAt'];

class OwnedMotionGeometryV2Error extends Error {
  constructor(code = ERROR, cause) { super(code, cause ? { cause } : undefined); this.name = 'OwnedMotionGeometryV2Error'; this.code = code; }
}
function insist(value, code) { if (!value) throw new OwnedMotionGeometryV2Error(code); }
function keys(value, expected) {
  insist(value && typeof value === 'object' && !Array.isArray(value)
    && equal(Object.keys(value).sort(), [...expected].sort()));
}
function integer(value) { return Number.isSafeInteger(value); }
function positive(value) { return integer(value) && value > 0; }
function hwnd(value, allowZero = false) {
  insist(typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value));
  const n = BigInt(value); insist(n <= 0x7fffffffffffffffn && (allowZero || n > 0n));
}
function contextHandle(value) {
  insist(typeof value === 'string' && /^-?[1-9]\d*$/.test(value));
  const n = BigInt(value); insist(n >= -0x8000000000000000n && n <= 0x7fffffffffffffffn);
}
function ticks(value, precision) {
  insist(typeof value === 'string');
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3}|\d{7})Z$/.exec(value);
  insist(match && (!precision || match[2].length === precision));
  const ms = Date.parse(match[1] + '.000Z');
  insist(integer(ms) && new Date(ms).toISOString() === match[1] + '.000Z');
  return BigInt(ms) * 10000n + BigInt(match[2].padEnd(7, '0'));
}
// 操作时序保持原 Main Date 的毫秒分辨率；进程出生身份仍单独按 100ns 或微秒核对。
function clock(value) { return ticks(value) / 10000n; }
function size(value, zero = false) {
  keys(value, ['width', 'height']);
  insist(['width', 'height'].every(axis => integer(value[axis]) && value[axis] >= (zero ? 0 : 1)));
}
function rect(value) {
  keys(value, ['x', 'y', 'width', 'height']);
  insist(integer(value.x) && integer(value.y)); size({ width: value.width, height: value.height });
}
function physicalRect(value, allowEmpty = false) {
  keys(value, ['left', 'top', 'right', 'bottom']);
  insist(Object.values(value).every(integer) && (allowEmpty ? value.right >= value.left && value.bottom >= value.top
    : value.right > value.left && value.bottom > value.top));
}
function contains(outer, inner) {
  return inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right && inner.bottom <= outer.bottom;
}
function inset(outer, inner) {
  return { left: inner.left - outer.left, top: inner.top - outer.top,
    right: outer.right - inner.right, bottom: outer.bottom - inner.bottom };
}
function noTime(value) { const { observedAt, ...rest } = value; return rest; }
function dipChrome(snapshot) {
  const bounds = snapshot.bounds, content = snapshot.contentBounds;
  return { left: content.x - bounds.x, top: content.y - bounds.y,
    right: bounds.x + bounds.width - content.x - content.width, bottom: bounds.y + bounds.height - content.y - content.height };
}
function samePath(left, right) {
  return typeof left === 'string' && typeof right === 'string'
    && /^[A-Za-z]:[\\/]/.test(left) && /^[A-Za-z]:[\\/]/.test(right)
    && left.replaceAll('/', '\\').toLowerCase() === right.replaceAll('/', '\\').toLowerCase();
}
function timeIn(value, execution) {
  const time = clock(value); insist(time >= clock(execution.startedAt) && time <= clock(execution.finishedAt)); return time;
}
function owner(value) {
  keys(value, OWNER_KEYS);
  insist(['mainPid', 'rendererPid', 'windowId'].every(field => positive(value[field])) && value.mainPid !== value.rendererPid
    && ['mainCreationTime', 'rendererCreationTime'].every(field => Number.isFinite(value[field]) && value[field] > 0)
    && typeof value.url === 'string' && value.url.startsWith('file:') && value.electronVersion === '44.2.0');
}
function main(snapshot, expected) {
  keys(snapshot, MAIN_KEYS);
  for (const field of OWNER_KEYS) insist(snapshot[field] === expected.owner[field]);
  hwnd(snapshot.hwnd); insist([4, 8].includes(snapshot.nativeHandleBytes));
  rect(snapshot.bounds); rect(snapshot.contentBounds); size(snapshot.contentSize); size(snapshot.minimumSize); size(snapshot.maximumSize, true);
  insist(equal(snapshot.minimumSize, PACKAGE_UI_MINIMUM_WINDOW) && snapshot.maximized === false && snapshot.minimized === false
    && snapshot.fullScreen === false && snapshot.visible === true && snapshot.resizable === true
    && typeof snapshot.menuBarVisible === 'boolean' && typeof snapshot.menuBarAutoHide === 'boolean'
    && snapshot.zoomFactor === (expected.kind === '125-percent' ? 1.25 : 1));
  keys(snapshot.display, ['id', 'scaleFactor', 'bounds', 'workArea']);
  insist(integer(snapshot.display.id) && snapshot.display.scaleFactor === expected.deviceScaleFactor
    && snapshot.forceDeviceScaleFactor === String(expected.deviceScaleFactor));
  rect(snapshot.display.bounds); rect(snapshot.display.workArea);
  keys(snapshot.chromiumFeatureSwitches, ['enabled', 'disabled']);
  insist(Object.values(snapshot.chromiumFeatureSwitches).every(value => typeof value === 'string'));
  const content = snapshot.contentBounds, bounds = snapshot.bounds;
  insist(content.width === snapshot.contentSize.width && content.height === snapshot.contentSize.height
    && content.x >= bounds.x && content.y >= bounds.y
    && content.x + content.width <= bounds.x + bounds.width && content.y + content.height <= bounds.y + bounds.height);
  keys(snapshot.renderer, ['url', 'innerWidth', 'innerHeight', 'devicePixelRatio']);
  insist(snapshot.renderer.url === expected.owner.url && positive(snapshot.renderer.innerWidth) && positive(snapshot.renderer.innerHeight)
    && snapshot.renderer.devicePixelRatio === expected.deviceScaleFactor * snapshot.zoomFactor);
  insist(Array.isArray(snapshot.appMetrics) && snapshot.appMetrics.length >= 2);
  for (const [index, metric] of snapshot.appMetrics.entries()) {
    keys(metric, ['pid', 'type', 'creationTime', ...(Object.hasOwn(metric, 'name') ? ['name'] : [])]);
    insist(positive(metric.pid) && typeof metric.type === 'string' && metric.type.length > 0
      && Number.isFinite(metric.creationTime) && metric.creationTime > 0
      && (!Object.hasOwn(metric, 'name') || typeof metric.name === 'string')
      && (index === 0 || snapshot.appMetrics[index - 1].pid < metric.pid));
  }
  insist(snapshot.appMetrics.find(metric => metric.pid === expected.owner.mainPid)?.creationTime === expected.owner.mainCreationTime
    && snapshot.appMetrics.find(metric => metric.pid === expected.owner.rendererPid)?.creationTime === expected.owner.rendererCreationTime);
  for (const axis of ['width', 'height']) {
    const css = snapshot.renderer[axis === 'width' ? 'innerWidth' : 'innerHeight'];
    const value = snapshot.contentSize[axis] / snapshot.zoomFactor;
    insist(css === Math.floor(value) || css === Math.ceil(value));
    const actual = expected.kind === '125-percent' ? snapshot.contentSize[axis] : snapshot.bounds[axis];
    const target = expected.kind === '125-percent' ? PACKAGE_UI_VIEWPORT[axis] : snapshot.minimumSize[axis];
    const tolerance = expected.deviceScaleFactor === 1 ? 0 : PACKAGE_UI_VIEWPORT_TOLERANCE[axis];
    insist(expected.kind === '125-percent' ? Math.abs(actual - target) <= tolerance : actual >= target && actual <= target + tolerance);
  }
  return timeIn(snapshot.observedAt, expected.execution);
}
function processIdentity(actual, expectedPid, expectedBirth, expectedExe) {
  keys(actual, ['pid', 'creationTimeUtcTicks', 'creationTimeUtc', 'executablePath']);
  insist(actual.pid === expectedPid && typeof actual.creationTimeUtcTicks === 'string' && /^\d+$/.test(actual.creationTimeUtcTicks)
    && BigInt(actual.creationTimeUtcTicks) === EPOCH_TICKS + ticks(actual.creationTimeUtc, 7)
    && samePath(actual.executablePath, expectedExe));
  if (expectedBirth !== null) insist(ticks(actual.creationTimeUtc, 7) === ticks(expectedBirth, 7));
}
function nativeWindow(value, root, mainPid, rendererPid, execution) {
  keys(value, ['hwnd', 'pid', 'threadId', 'parentHwnd', 'rootHwnd', 'className', 'visible', 'dpi', 'styleHex', 'exStyleHex',
    'windowRectScreenPhysicalPx', 'clientRectLocalPhysicalPx', 'clientRectScreenPhysicalPx', 'observedAt']);
  hwnd(value.hwnd); hwnd(value.parentHwnd, true); hwnd(value.rootHwnd);
  insist(value.rootHwnd === root && [mainPid, rendererPid].includes(value.pid) && positive(value.threadId)
    && typeof value.className === 'string' && value.className.length > 0 && typeof value.visible === 'boolean' && positive(value.dpi)
    && /^0x[0-9A-F]{8}$/.test(value.styleHex) && /^0x[0-9A-F]{8}$/.test(value.exStyleHex));
  physicalRect(value.windowRectScreenPhysicalPx); physicalRect(value.clientRectScreenPhysicalPx); physicalRect(value.clientRectLocalPhysicalPx);
  const local = value.clientRectLocalPhysicalPx, screen = value.clientRectScreenPhysicalPx;
  insist(local.left === 0 && local.top === 0 && local.right === screen.right - screen.left && local.bottom === screen.bottom - screen.top);
  timeIn(value.observedAt, execution);
}
const QUERY_NAMES = ['isWindow', 'threadProcess', 'root', 'isChild', 'parent', 'className', 'visible',
  'windowRect', 'clientRect', 'clientScreenRect', 'dpi', 'style', 'exStyle'];
function querySample(value, root, execution) {
  keys(value, ['startedAt', ...QUERY_NAMES, 'finishedAt']);
  const common = ['executed', 'success', 'returnValue', 'lastError'];
  const extra = { threadProcess: ['outPid'], className: ['outText'], windowRect: ['outRectScreenPhysicalPx'],
    clientRect: ['outRectLocalPhysicalPx'], style: ['hex'], exStyle: ['hex'] };
  for (const name of QUERY_NAMES) {
    const query = value[name];
    keys(query, name === 'clientScreenRect'
      ? ['executed', 'success', 'returnValue', 'clientQuery', 'firstQuery', 'lastQuery', 'outRectScreenPhysicalPx']
      : [...common, ...(extra[name] || [])]);
    insist(query.executed === true && query.success === true
      && (name === 'clientScreenRect' || integer(query.lastError)));
  }
  insist(value.isWindow.returnValue === true && positive(value.threadProcess.returnValue) && positive(value.threadProcess.outPid)
    && value.root.returnValue === root && value.isChild.returnValue === true && typeof value.visible.returnValue === 'boolean'
    && positive(value.className.returnValue) && value.className.returnValue < 255
    && typeof value.className.outText === 'string' && value.className.outText.length === value.className.returnValue
    && value.windowRect.returnValue === true && value.clientRect.returnValue === true && value.clientScreenRect.returnValue === true
    && positive(value.dpi.returnValue));
  hwnd(value.parent.returnValue);
  for (const name of ['style', 'exStyle']) {
    const query = value[name]; insist(typeof query.returnValue === 'string' && /^-?(0|[1-9]\d*)$/.test(query.returnValue)
      && /^0x[0-9A-F]{8}$/.test(query.hex) && BigInt.asUintN(32, BigInt(query.returnValue)) === BigInt(query.hex));
  }
  const converted = value.clientScreenRect;
  for (const name of ['clientQuery', 'firstQuery', 'lastQuery']) {
    const query = converted[name], field = name === 'clientQuery' ? 'outRect' : 'outPoint';
    keys(query, [...common, field]);
    insist(query.executed === true && query.success === true && query.returnValue === true && integer(query.lastError));
  }
  insist(equal(value.clientRect.outRectLocalPhysicalPx, converted.clientQuery.outRect));
  physicalRect(value.windowRect.outRectScreenPhysicalPx, true);
  physicalRect(value.clientRect.outRectLocalPhysicalPx, true); physicalRect(converted.outRectScreenPhysicalPx, true);
  keys(converted.firstQuery.outPoint, ['x', 'y']); keys(converted.lastQuery.outPoint, ['x', 'y']);
  insist(equal(converted.outRectScreenPhysicalPx, { left: converted.firstQuery.outPoint.x, top: converted.firstQuery.outPoint.y,
    right: converted.lastQuery.outPoint.x, bottom: converted.lastQuery.outPoint.y }));
  const local = value.clientRect.outRectLocalPhysicalPx, screen = converted.outRectScreenPhysicalPx;
  insist(local.left === 0 && local.top === 0 && local.right === screen.right - screen.left && local.bottom === screen.bottom - screen.top);
  insist(timeIn(value.startedAt, execution) <= timeIn(value.finishedAt, execution));
}
function withoutQueryTime(value) { const { startedAt, finishedAt, ...rest } = value; return rest; }
function childInventory(native, expected, snapshot) {
  const rows = native.children, root = snapshot.hwnd;
  insist(Array.isArray(rows) && rows.length > 0 && rows.length <= PACKAGE_UI_NATIVE_GEOMETRY_LIMITS.maxChildren
    && new Set(rows.map(row => row.hwnd)).size === rows.length);
  const candidates = [], projected = [], admissions = [];
  for (const row of rows) {
    keys(row, ['hwnd', 'beforeQueries', 'afterQueries', 'ownerAdmission', 'complete', 'isVisibleRenderWidgetCandidate',
      'rejectionReasons', 'processObservationUntrusted']);
    hwnd(row.hwnd); insist(row.hwnd !== root && row.complete === true);
    querySample(row.beforeQueries, root, expected.execution); querySample(row.afterQueries, root, expected.execution);
    insist(equal(withoutQueryTime(row.beforeQueries), withoutQueryTime(row.afterQueries))
      && clock(row.beforeQueries.finishedAt) <= clock(row.afterQueries.startedAt));
    const q = row.beforeQueries, pid = q.threadProcess.outPid;
    const candidate = q.className.outText === 'Chrome_RenderWidgetHostHWND' && q.visible.returnValue;
    insist(row.isVisibleRenderWidgetCandidate === candidate);
    if (candidate) candidates.push(row.hwnd);
    admissions.push({ row, q, pid, candidate });
    projected.push({ hwnd: row.hwnd, pid, threadId: q.threadProcess.returnValue, parentHwnd: q.parent.returnValue,
      rootHwnd: q.root.returnValue, className: q.className.outText, visible: q.visible.returnValue, dpi: q.dpi.returnValue,
      styleHex: q.style.hex, exStyleHex: q.exStyle.hex, windowRectScreenPhysicalPx: q.windowRect.outRectScreenPhysicalPx,
      clientRectLocalPhysicalPx: q.clientRect.outRectLocalPhysicalPx, clientRectScreenPhysicalPx: q.clientScreenRect.outRectScreenPhysicalPx,
      observedAt: row.afterQueries.finishedAt });
  }
  // 先数所有可见同类 HWND，再核唯一 Main；未准入行永远不能成为控件或动作授权来源。
  insist(candidates.length === 1);
  for (const { row, q, pid, candidate } of admissions) {
    const admission = pid === expected.owner.mainPid ? 'ADMITTED_MAIN' : pid === expected.owner.rendererPid ? 'ADMITTED_RENDERER' : 'UNADMITTED';
    insist(row.ownerAdmission === admission && row.processObservationUntrusted?.authority === 'NONE'
      && equal(row.rejectionReasons, admission === 'UNADMITTED' ? ['PID_NOT_MAIN_OR_EXPECTED_RENDERER'] : []));
    if (admission === 'UNADMITTED') {
      const process = row.processObservationUntrusted, metric = snapshot.appMetrics.find(item => item.pid === pid);
      keys(process, ['executed', 'success', 'authority', 'pid', 'creationTimeUtcTicks', 'executablePath']);
      insist(!candidate && q.className.outText === 'Intermediate D3D Window' && metric?.type === 'GPU'
        && process.executed === true && process.success === true && process.pid === pid
        && samePath(process.executablePath, expected.nativeMain.executablePath)
        && typeof process.creationTimeUtcTicks === 'string' && /^\d+$/.test(process.creationTimeUtcTicks)
        && (BigInt(process.creationTimeUtcTicks) - EPOCH_TICKS) / 10n === BigInt(Math.round(metric.creationTime * 1000)));
    }
  }
  const verdict = native.childInventoryVerdict;
  keys(verdict, ['rawChildCount', 'visibleRenderWidgetCandidateCount', 'visibleRenderWidgetCandidateHwnds', 'selectedWidgetHwnd',
    'selectedWidgetOwnerAdmission', 'completed', 'accepted', 'authority', 'rejectionReasons']);
  insist(verdict.rawChildCount === rows.length && verdict.visibleRenderWidgetCandidateCount === candidates.length
    && equal(verdict.visibleRenderWidgetCandidateHwnds, candidates) && verdict.selectedWidgetHwnd === candidates[0]
    && verdict.selectedWidgetOwnerAdmission === 'ADMITTED_MAIN' && verdict.completed === true && verdict.accepted === true
    && verdict.authority === 'DIAGNOSTIC_MAIN_OR_EXPECTED_RENDERER_ONLY' && equal(verdict.rejectionReasons, []));
  const widget = projected.find(row => row.hwnd === candidates[0]);
  nativeWindow(widget, root, expected.owner.mainPid, expected.owner.rendererPid, expected.execution);
  insist(widget.pid === expected.owner.mainPid && widget.parentHwnd === root);
  return { widget, projected };
}
function artifactRecord(value, allowEmpty = false, tool = false) {
  keys(value, ['path', 'sha256', 'sizeBytes', ...(tool ? ['stat'] : [])]);
  insist(samePath(value.path, value.path) && typeof value.sha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(value.sha256)
    && integer(value.sizeBytes) && value.sizeBytes >= (allowEmpty ? 0 : 1));
  if (tool) {
    const metadata = value.stat;
    keys(metadata, ['ino', 'size', 'mtimeMs', 'ctimeMs', 'birthtimeMs', 'mode', 'nlink']);
    // 工具记录保留生产读取器的完整七项元数据，文件身份再由独立原件入口核验。
    insist(Number.isInteger(metadata.ino) && metadata.ino > 0 && integer(metadata.size)
      && metadata.size === value.sizeBytes && metadata.nlink === 1 && integer(metadata.mode)
      && (metadata.mode & 0o170000) === 0o100000
      && ['mtimeMs', 'ctimeMs', 'birthtimeMs'].every(field => Number.isFinite(metadata[field])));
  }
}
function invocation(value, raw, expected, observation) {
  keys(value, ['kind', 'diagnosticOnly', 'formalCredit', 'nonce', 'startedAt', 'beforeMain', 'tool', 'command', 'events',
    'timedOut', 'finishedAt', 'stdout', 'stderr', 'error']);
  insist(value.kind === 'v16-native-physical-helper-invocation/1' && value.diagnosticOnly === true && value.formalCredit === false
    && value.timedOut === false && value.error === null && equal(value.beforeMain, observation.beforeMain));
  artifactRecord(value.tool, false, true); artifactRecord(value.stdout); artifactRecord(value.stderr, true);
  insist(value.stdout.sizeBytes + value.stderr.sizeBytes <= PACKAGE_UI_NATIVE_GEOMETRY_LIMITS.maxOutputBytes);
  keys(value.command, ['executable', 'args', 'shell', 'windowsHide']);
  insist(samePath(value.command.executable, value.command.executable) && value.command.shell === false && value.command.windowsHide === true);
  const args = value.command.args;
  insist(Array.isArray(args) && args.length === 24 && args.every(item => typeof item === 'string')
    && equal(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-File']) && samePath(args[3], value.tool.path));
  const parameters = Object.fromEntries(Array.from({ length: 10 }, (_, index) => args.slice(4 + 2 * index, 6 + 2 * index)));
  insist(equal(parameters, { '-MainPid': String(expected.owner.mainPid), '-MainCreationTimeUtcTicks': raw.ownerRequest.mainCreationTimeUtcTicks,
    '-MainExecutablePath': raw.ownerRequest.mainExecutablePath, '-Hwnd': raw.ownerRequest.hwnd,
    '-ExpectedRendererPid': String(expected.owner.rendererPid), '-RequestNonce': value.nonce,
    '-HelperTimeoutMs': String(PACKAGE_UI_NATIVE_GEOMETRY_LIMITS.helperTimeoutMs), '-WmQueryTimeoutMs': String(PACKAGE_UI_NATIVE_GEOMETRY_LIMITS.wmQueryTimeoutMs),
    '-MaxOutputBytes': String(PACKAGE_UI_NATIVE_GEOMETRY_LIMITS.maxOutputBytes), '-MaxChildren': String(PACKAGE_UI_NATIVE_GEOMETRY_LIMITS.maxChildren) }));
  const events = value.events;
  insist(Array.isArray(events) && equal(events.map(event => event.event), ['spawn', 'exit', 'close']) && positive(events[0].pid)
    && events[0].pid !== expected.owner.mainPid && events[0].pid !== expected.owner.rendererPid
    && events.slice(1).every(event => event.code === 0 && event.signal === null));
  const sequence = [observation.beforeMain.observedAt, value.startedAt, events[0].at, raw.startedAt, raw.finishedAt,
    events[1].at, events[2].at, value.finishedAt, observation.afterMain.observedAt].map(time => timeIn(time, expected.execution));
  insist(sequence.every((time, index) => index === 0 || sequence[index - 1] <= time)
    && clock(value.finishedAt) - clock(value.startedAt) <= BigInt(PACKAGE_UI_NATIVE_GEOMETRY_LIMITS.helperTimeoutMs));
}
function nativeProjection(observation, expected, snapshot) {
  // 文件、工具哈希和独立进程调用链由正式 artifact 入口核验；此处核对同一原始读数的全部几何锚。
  keys(observation, ['beforeMain', 'native', 'afterMain', 'invocation']);
  main(observation.beforeMain, expected); main(observation.afterMain, expected);
  insist(equal(noTime(observation.beforeMain), noTime(snapshot)) && equal(noTime(observation.afterMain), noTime(snapshot)));
  const raw = observation.native, native = raw.native, root = snapshot.hwnd, mainPid = expected.owner.mainPid;
  keys(raw.limits, ['helperTimeoutMs', 'wmQueryTimeoutMs', 'maxOutputBytes', 'maxChildren']);
  insist(equal(raw.limits, PACKAGE_UI_NATIVE_GEOMETRY_LIMITS)
    && native.minMaxQuery?.timeoutMs === PACKAGE_UI_NATIVE_GEOMETRY_LIMITS.wmQueryTimeoutMs);
  insist(raw.schemaVersion === 'v16.native-physical-geometry/2' && raw.passed === true && raw.coordinateSpace === 'physical-pixels'
    && native?.pmv2Verified === true && native.requestedContext === '-4' && raw.contextRestore?.attempted === true
    && raw.contextRestore.confirmed === true && native.threadId === raw.contextRestore.threadId && !raw.error && !raw.restoreError
    && raw.contextRestore.expectedContext === native.contextBefore);
  // DPI context 存在等价句柄别名；还原由同线程 AreDpiAwarenessContextsEqual 的实际结果证明。
  for (const value of [native.contextBefore, native.contextActive, raw.contextRestore.contextAfter, raw.contextRestore.returnValue]) contextHandle(value);
  keys(raw.ownerRequest, ['mainPid', 'mainCreationTimeUtcTicks', 'mainExecutablePath', 'hwnd', 'requestNonce', 'expectedRendererPid']);
  insist(raw.ownerRequest.mainPid === mainPid && raw.ownerRequest.expectedRendererPid === expected.owner.rendererPid
    && raw.ownerRequest.hwnd === root && samePath(raw.ownerRequest.mainExecutablePath, expected.nativeMain.executablePath)
    && typeof raw.ownerRequest.requestNonce === 'string' && UUID.test(raw.ownerRequest.requestNonce)
    && raw.ownerRequest.requestNonce === observation.invocation.nonce
    && raw.ownerRequest.mainCreationTimeUtcTicks === String(EPOCH_TICKS + ticks(expected.nativeMain.birthUtc, 7)));
  const cleanOwner = value => { const { hwnd: handle, windowPid, windowThreadId, ...rest } = value;
    insist(handle === root && windowPid === mainPid && positive(windowThreadId)); return rest; };
  processIdentity(cleanOwner(raw.ownerBefore), mainPid, expected.nativeMain.birthUtc, expected.nativeMain.executablePath);
  processIdentity(cleanOwner(raw.ownerAfter), mainPid, expected.nativeMain.birthUtc, expected.nativeMain.executablePath);
  processIdentity(raw.rendererBefore, expected.owner.rendererPid, null, expected.nativeMain.executablePath);
  processIdentity(raw.rendererAfter, expected.owner.rendererPid, null, expected.nativeMain.executablePath);
  insist(equal(raw.ownerBefore, raw.ownerAfter) && equal(raw.rendererBefore, raw.rendererAfter));
  // Chromium 将 FILETIME 严格截断到微秒；不以四舍五入或毫秒 Date 改写出生身份。
  insist((BigInt(raw.rendererBefore.creationTimeUtcTicks) - EPOCH_TICKS) / 10n
    === BigInt(Math.round(expected.owner.rendererCreationTime * 1000)));
  nativeWindow(native.primaryBefore, root, mainPid, expected.owner.rendererPid, expected.execution);
  nativeWindow(native.primaryAfter, root, mainPid, expected.owner.rendererPid, expected.execution);
  insist(native.primaryBefore.hwnd === root && native.primaryBefore.pid === mainPid && native.primaryBefore.visible === true
    && equal(noTime(native.primaryBefore), noTime(native.primaryAfter)));
  const primary = native.primaryBefore;
  insist(contains(primary.windowRectScreenPhysicalPx, primary.clientRectScreenPhysicalPx));
  const inventory = childInventory(native, expected, snapshot), widget = inventory.widget;
  insist(widget.hwnd !== root && widget.parentHwnd === root && widget.pid === mainPid);
  const monitor = native.monitor;
  keys(monitor, ['handle', 'device', 'flags', 'monitorRectScreenPhysicalPx', 'workRectScreenPhysicalPx']);
  hwnd(monitor.handle); insist(typeof monitor.device === 'string' && monitor.device.length > 0 && integer(monitor.flags));
  physicalRect(monitor.monitorRectScreenPhysicalPx); physicalRect(monitor.workRectScreenPhysicalPx);
  const started = timeIn(raw.startedAt, expected.execution), finished = timeIn(raw.finishedAt, expected.execution);
  insist(main(observation.beforeMain, expected) <= started && started <= finished && finished <= main(observation.afterMain, expected));
  insist(finished - started <= BigInt(PACKAGE_UI_NATIVE_GEOMETRY_LIMITS.helperTimeoutMs));
  const firstWindow = clock(primary.observedAt), lastWindow = clock(native.primaryAfter.observedAt);
  insist(started <= firstWindow && firstWindow <= lastWindow && lastWindow <= finished
    && native.children.every(child => firstWindow <= clock(child.beforeQueries.startedAt) && clock(child.afterQueries.finishedAt) <= lastWindow)
    && ticks(raw.ownerBefore.creationTimeUtc, 7) <= ticks(raw.startedAt) && ticks(raw.rendererBefore.creationTimeUtc, 7) <= ticks(raw.startedAt));
  invocation(observation.invocation, raw, expected, observation);
  return { primary: noTime(primary), widget: noTime(widget), monitor, started, finished,
    chrome: inset(primary.windowRectScreenPhysicalPx, primary.clientRectScreenPhysicalPx) };
}
function resizeReceipt(receipt, expected, snapshot) {
  keys(receipt, ['attemptId', 'kind', 'startedAt', 'before', 'request', 'zoomRequest', 'setterStartedAt', 'setterReturnedAt', 'afterImmediate', 'finishedAt']);
  insist(typeof receipt.attemptId === 'string' && UUID.test(receipt.attemptId) && receipt.kind === expected.kind);
  for (const value of [receipt.before, receipt.afterImmediate]) {
    keys(value, MAIN_KEYS); for (const field of OWNER_KEYS) insist(value[field] === expected.owner[field]);
    insist(value.hwnd === snapshot.hwnd && equal(value.minimumSize, PACKAGE_UI_MINIMUM_WINDOW));
    rect(value.bounds); rect(value.contentBounds); size(value.contentSize);
    insist(value.maximized === false && value.minimized === false && value.fullScreen === false && value.visible === true && value.resizable === true);
    timeIn(value.observedAt, expected.execution);
  }
  insist(receipt.before.zoomFactor === 1 || receipt.before.zoomFactor === 1.25);
  const request = expected.kind === '125-percent' ? { method: 'setContentSize', ...PACKAGE_UI_VIEWPORT, animate: false }
    : { method: 'setSize', width: PACKAGE_UI_MINIMUM_WINDOW.width - 1, height: PACKAGE_UI_MINIMUM_WINDOW.height - 1, animate: false };
  insist(equal(receipt.request, request) && receipt.zoomRequest === snapshot.zoomFactor && receipt.afterImmediate.zoomFactor === snapshot.zoomFactor);
  const sequence = [receipt.before.observedAt, receipt.startedAt, receipt.setterStartedAt, receipt.setterReturnedAt,
    receipt.afterImmediate.observedAt, receipt.finishedAt, snapshot.observedAt].map(value => timeIn(value, expected.execution));
  insist(sequence.every((value, index) => index === 0 || sequence[index - 1] <= value));
}
function enclosingRect(value, scale) {
  if (scale === 1) return { ...value };
  const multiplier = Math.fround(scale), product = edge => Math.fround(Math.fround(edge) * multiplier);
  const result = { left: Math.floor(product(value.left)), top: Math.floor(product(value.top)),
    right: Math.ceil(product(value.right)), bottom: Math.ceil(product(value.bottom)) };
  insist(Object.values(result).every(edge => integer(edge) && edge >= -2147483648 && edge <= 2147483647));
  return result;
}
function nativeCoverage(native, snapshot, expected) {
  const client = native.primary.clientRectScreenPhysicalPx, widget = native.widget.windowRectScreenPhysicalPx;
  const dsf = expected.deviceScaleFactor;
  // 固定 Chromium 的 float 算子先包围绝对客户区，再包围菜单后的 DIP 内容；不加 epsilon。
  const logicalRect = enclosingRect(client, Math.fround(1 / Math.fround(dsf)));
  const logicalClient = { width: logicalRect.right - logicalRect.left, height: logicalRect.bottom - logicalRect.top };
  const content = snapshot.contentSize, menuDip = logicalClient.height - content.height;
  insist(content.width === logicalClient.width && integer(menuDip) && menuDip >= 0
    && (snapshot.menuBarVisible && !snapshot.menuBarAutoHide ? menuDip > 0 : menuDip === 0));
  const local = enclosingRect({ left: 0, top: menuDip, right: content.width, bottom: logicalClient.height }, dsf);
  const reconstructed = { left: client.left + local.left, top: client.top + local.top,
    right: client.left + local.right, bottom: client.top + local.bottom };
  insist(equal(widget, reconstructed) && equal(native.widget.clientRectScreenPhysicalPx, reconstructed));
  const visible = { width: Math.min(client.right, widget.right) - Math.max(client.left, widget.left),
    height: Math.min(client.bottom, widget.bottom) - Math.max(client.top, widget.top) };
  size(visible); return { menuDip, visible };
}
function validateCore(witness, expected) {
  keys(expected, ['kind', 'owner', 'deviceScaleFactor', 'referenceGeometry', 'execution', 'capturedAt', 'nativeMain']);
  owner(expected.owner); keys(expected.nativeMain, ['birthUtc', 'executablePath']); ticks(expected.nativeMain.birthUtc, 7);
  insist(samePath(expected.nativeMain.executablePath, expected.nativeMain.executablePath)
    && ['125-percent', 'minimum-window'].includes(expected.kind) && [1, 1.25].includes(expected.deviceScaleFactor));
  insist(clock(expected.execution.startedAt) <= clock(expected.execution.finishedAt));
  keys(witness, ['schemaVersion', 'method', 'imageSemantics', 'before', 'after', 'captureStartedAt', 'captureFinishedAt',
    'nativeSize', 'nativeScaleFactors', 'resizeReceipt', 'nativeBefore', 'nativeAfter']);
  insist(witness.schemaVersion === 'v16.owned-motion-geometry/2' && witness.method === 'electron-webcontents-capture-page'
    && witness.imageSemantics === 'electron-44-capture-1x-pixels' && equal(witness.nativeScaleFactors, [1]));
  const before = main(witness.before, expected), after = main(witness.after, expected);
  insist(equal(noTime(witness.before), noTime(witness.after)));
  resizeReceipt(witness.resizeReceipt, expected, witness.before);
  const nativeBefore = nativeProjection(witness.nativeBefore, expected, witness.before);
  const nativeAfter = nativeProjection(witness.nativeAfter, expected, witness.after);
  insist(equal(nativeBefore.primary, nativeAfter.primary) && equal(nativeBefore.widget, nativeAfter.widget)
    && equal(nativeBefore.monitor, nativeAfter.monitor)
    && witness.nativeBefore.invocation.nonce !== witness.nativeAfter.invocation.nonce);
  const start = timeIn(witness.captureStartedAt, expected.execution), finish = timeIn(witness.captureFinishedAt, expected.execution);
  insist(before <= nativeBefore.started && nativeBefore.finished <= start && start <= finish && finish <= nativeAfter.started
    && nativeAfter.finished <= after && after <= timeIn(expected.capturedAt, expected.execution));
  const coverage = nativeCoverage(nativeBefore, witness.before, expected);
  if (expected.kind === 'minimum-window') {
    const reference = expected.referenceGeometry;
    validateOwnedMotionV2(reference, { ...expected, kind: '125-percent', referenceGeometry: null });
    const previous = nativeProjection(reference.nativeBefore, { ...expected, kind: '125-percent' }, reference.before);
    const previousCoverage = nativeCoverage(previous, reference.before, { ...expected, kind: '125-percent' });
    insist(previousCoverage.menuDip === coverage.menuDip);
    insist(new Set([reference.nativeBefore, reference.nativeAfter, witness.nativeBefore, witness.nativeAfter]
      .map(observation => observation.invocation.nonce)).size === 4);
    insist(reference.before.hwnd === witness.before.hwnd && reference.before.display.id === witness.before.display.id
      && reference.before.menuBarVisible === witness.before.menuBarVisible && reference.before.menuBarAutoHide === witness.before.menuBarAutoHide
      && equal(reference.before.chromiumFeatureSwitches, witness.before.chromiumFeatureSwitches)
      && equal(previous.chrome, nativeBefore.chrome) && equal(previous.monitor, nativeBefore.monitor)
      && ['hwnd', 'pid', 'className', 'styleHex', 'exStyleHex', 'dpi', 'parentHwnd', 'rootHwnd']
        .every(field => previous.primary[field] === nativeBefore.primary[field])
      && clock(reference.after.observedAt) <= clock(witness.resizeReceipt.startedAt));
    if (expected.deviceScaleFactor === 1) insist(equal(dipChrome(reference.before), dipChrome(witness.before)));
  } else insist(expected.referenceGeometry === null);
  const pixels = { width: Math.ceil(witness.before.contentSize.width * expected.deviceScaleFactor),
    height: Math.ceil(witness.before.contentSize.height * expected.deviceScaleFactor) };
  size(witness.nativeSize); insist(equal(witness.nativeSize, pixels));
  const visibleViewport = { width: Math.min(pixels.width, coverage.visible.width), height: Math.min(pixels.height, coverage.visible.height) };
  size(visibleViewport);
  return Object.freeze({ pixels: Object.freeze(pixels), visibleViewport: Object.freeze(visibleViewport) });
}

function validateOwnedMotionV2Frame(witness, expected) {
  try { return validateCore(witness, expected); }
  catch (error) {
    if (error instanceof OwnedMotionGeometryV2Error) throw error;
    throw new OwnedMotionGeometryV2Error(ERROR, error);
  }
}

function validateOwnedMotionV2(witness, expected) {
  return validateOwnedMotionV2Frame(witness, expected).pixels;
}

module.exports = Object.freeze({ validateOwnedMotionV2, validateOwnedMotionV2Frame, OwnedMotionGeometryV2Error });
