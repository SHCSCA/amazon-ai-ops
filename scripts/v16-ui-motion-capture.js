const { isDeepStrictEqual } = require('node:util');
const { insist } = require('./v16-performance-artifacts');
const FIELDS = ['mainPid', 'mainCreationTime', 'windowId', 'rendererPid', 'rendererCreationTime', 'url', 'electronVersion',
  'bounds', 'contentBounds', 'contentSize', 'minimumSize', 'zoomFactor', 'maximized', 'fullScreen', 'minimized', 'visible',
  'forceDeviceScaleFactor', 'renderer'];
function projection(snapshot) {
  return { ...Object.fromEntries(FIELDS.map(field => [field, snapshot[field]])),
    display: { id: snapshot.display?.id, scaleFactor: snapshot.display?.scaleFactor } };
}
async function captureNativeMotionScreenshot(runtime, writer, file, { owner, resizeReceipt, label, observer }, readPngDimensions, captureLegacy) {
  const nativeBefore = await observer.snapshot(owner, label + '/native-before');
  const capture = await captureLegacy(runtime.app, file, { schemaVersion: 'v16.owned-motion-capture-request/1', owner }, readPngDimensions);
  const nativeAfter = await observer.snapshot(owner, label + '/native-after');
  const legacy = capture.geometryWitness, before = nativeBefore.beforeMain, after = nativeAfter.afterMain;
  // 外层实测时间包围原截图；旧截图的真实 Main 读数也必须与外层共享字段完全一致。
  const noTime = value => { const { observedAt, ...rest } = value; return rest; };
  for (const snapshot of [nativeBefore.afterMain, nativeAfter.beforeMain, after]) {
    insist(isDeepStrictEqual(noTime(before), noTime(snapshot)), 'UI_MOTION_NATIVE_CAPTURE_STATE_CHANGED');
  }
  const shared = projection(before);
  for (const snapshot of [nativeBefore.afterMain, legacy.before, legacy.after, nativeAfter.beforeMain, after]) {
    insist(isDeepStrictEqual(projection(snapshot), shared), 'UI_MOTION_NATIVE_CAPTURE_MAIN_CHANGED');
  }
  return { ...capture, geometryWitness: { ...legacy, schemaVersion: 'v16.owned-motion-geometry/2', before, after,
    resizeReceipt, nativeBefore, nativeAfter } };
}
module.exports = { captureNativeMotionScreenshot, projection };
