const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createNativeGeometryObserver } = require('./v16-ui-native-geometry');
const { resizeMotionWindow, settleMotionMain } = require('./v16-ui-motion-main');
const { captureNativeMotionScreenshot } = require('./v16-ui-motion-capture');
const { insist, fileRecord } = require('./v16-performance-artifacts');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');

function logMotionRestoreFailure(writer, error) {
  try { writer.log('v16.ui_motion_restore_failed', error); }
  catch (loggingError) {
    try { process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'v16.ui_motion_restore_log_failed', { error: loggingError, originalError: error })) + '\n'); }
    catch { /* 日志出口关闭时仍保留首错并继续本次自有窗口回收。 */ }
  }
}

async function readSameFrameBounds(page, ids) {
  const bounds = await page.evaluate(ids => ids.map(id => {
    const element = document.querySelector('[data-v16-a11y-node="' + CSS.escape(id) + '"]');
    const box = element?.getBoundingClientRect();
    return { id, visible: Boolean(element?.checkVisibility() && box && box.width > 0 && box.height > 0
      && box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight), bounds: box?.toJSON() };
  }), ids);
  insist(bounds.every(node => node.visible), 'UI_MOTION_TWO_CONTROLS_NOT_VISIBLE_IN_SAME_FRAME');
  return bounds;
}

async function captureOwnedMotionScreenshot(electronApp, screenshotPath, request, readPngDimensions) {
  if (typeof readPngDimensions !== 'function' || !request || request.schemaVersion !== 'v16.owned-motion-capture-request/1'
    || JSON.stringify(Object.keys(request).sort()) !== JSON.stringify(['owner', 'schemaVersion'])
    || !request.owner || JSON.stringify(Object.keys(request.owner).sort()) !== JSON.stringify([
      'electronVersion', 'mainCreationTime', 'mainPid', 'rendererCreationTime', 'rendererPid', 'url', 'windowId'])
    || !['mainPid', 'rendererPid', 'windowId'].every(field => Number.isSafeInteger(request.owner[field]) && request.owner[field] > 0)
    || request.owner.mainPid === request.owner.rendererPid
    || !['mainCreationTime', 'rendererCreationTime'].every(field => Number.isFinite(request.owner[field]) && request.owner[field] > 0)
    || typeof request.owner.url !== 'string' || !request.owner.url.startsWith('file:')
    || typeof request.owner.electronVersion !== 'string' || !request.owner.electronVersion) {
    insist(false, 'UI_MOTION_CAPTURE_REQUEST_INVALID');
  }
  const capture = await electronApp.evaluate(async ({ app, BrowserWindow, screen }, owner) => {
    const window = BrowserWindow.fromId(owner.windowId);
    const owned = () => {
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) throw new Error('UI_MOTION_OWNED_WINDOW_REQUIRED');
      const metrics = app.getAppMetrics(), rendererPid = window.webContents.getOSProcessId();
      if (process.pid !== owner.mainPid || window.id !== owner.windowId || rendererPid !== owner.rendererPid
        || metrics.find(row => row.pid === process.pid)?.creationTime !== owner.mainCreationTime
        || metrics.find(row => row.pid === rendererPid)?.creationTime !== owner.rendererCreationTime
        || window.webContents.getURL() !== owner.url || process.versions.electron !== owner.electronVersion) {
        throw new Error('UI_MOTION_OWNED_IDENTITY_CHANGED');
      }
    };
    const snapshot = async () => {
      owned();
      const renderer = await window.webContents.executeJavaScript('({url:location.href,innerWidth,innerHeight,devicePixelRatio})');
      owned();
      const bounds = window.getBounds(), contentBounds = window.getContentBounds();
      const [width, height] = window.getContentSize(), [minimumWidth, minimumHeight] = window.getMinimumSize();
      const display = screen.getDisplayMatching(bounds);
      return { ...owner, bounds, contentBounds, contentSize: { width, height }, minimumSize: { width: minimumWidth, height: minimumHeight },
        zoomFactor: window.webContents.getZoomFactor(), maximized: window.isMaximized(), fullScreen: window.isFullScreen(),
        minimized: window.isMinimized(), visible: window.isVisible(), display: { id: display.id, scaleFactor: display.scaleFactor },
        forceDeviceScaleFactor: app.commandLine.getSwitchValue('force-device-scale-factor'), renderer, observedAt: new Date().toISOString() };
    };
    const before = await snapshot(), captureStartedAt = new Date().toISOString();
    const image = await window.webContents.capturePage();
    const empty = image.isEmpty(), nativeSize = image.getSize(), nativeScaleFactors = image.getScaleFactors();
    const data = image.toPNG().toString('base64'), captureFinishedAt = new Date().toISOString();
    const after = await snapshot();
    return { data, empty, nativeSize, geometryWitness: { schemaVersion: 'v16.owned-motion-geometry/1',
      method: 'electron-webcontents-capture-page', imageSemantics: process.versions.electron === '44.2.0'
        ? 'electron-44-capture-1x-pixels' : 'unrecognized-capture-semantics',
      before, captureStartedAt, captureFinishedAt, after, nativeSize, nativeScaleFactors } };
  }, request.owner);
  if (capture?.empty || !capture?.data) insist(false, 'UI_MOTION_CAPTURE_PAYLOAD_REQUIRED');
  const withoutTime = value => { const { observedAt, ...rest } = value; return rest; };
  if (JSON.stringify(withoutTime(capture.geometryWitness.before)) !== JSON.stringify(withoutTime(capture.geometryWitness.after))) {
    insist(false, 'UI_MOTION_CAPTURE_GEOMETRY_CHANGED');
  }
  fs.writeFileSync(screenshotPath, Buffer.from(capture.data, 'base64'));
  const dimensions = readPngDimensions(fs.readFileSync(screenshotPath));
  if (!dimensions) insist(false, 'UI_MOTION_CAPTURE_PNG_REQUIRED');
  if (dimensions.width !== capture.nativeSize.width || dimensions.height !== capture.nativeSize.height) {
    insist(false, 'UI_MOTION_CAPTURE_NATIVE_SIZE_MISMATCH');
  }
  return { dimensions, method: 'electron-webcontents-capture-page', nativeSize: capture.nativeSize, geometryWitness: capture.geometryWitness };
}

async function verifyOwnedMotionWindow(electronApp, owner) {
  await electronApp.evaluate(({ app, BrowserWindow }, owner) => {
    const window = BrowserWindow.fromId(owner.windowId), metrics = app.getAppMetrics();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed() || process.pid !== owner.mainPid
      || window.webContents.getOSProcessId() !== owner.rendererPid || window.webContents.getURL() !== owner.url
      || metrics.find(row => row.pid === process.pid)?.creationTime !== owner.mainCreationTime
      || metrics.find(row => row.pid === owner.rendererPid)?.creationTime !== owner.rendererCreationTime
      || process.versions.electron !== owner.electronVersion) {
      throw new Error('UI_MOTION_NATIVE_WINDOW_REQUIRED');
    }
  }, owner);
}

async function captureMotionZoom(runtime, writer, binding, label, prepare, describe, ui, ports = {}) {
  const windowIdentity = runtime.identity?.windows?.[0];
  insist(runtime.identity?.windows?.length === 1 && runtime.identity.pid === binding.pid && windowIdentity,
    'UI_MOTION_OWNED_RUNTIME_REQUIRED');
  const owner = { mainPid: runtime.identity.pid, mainCreationTime: runtime.identity.creationTime, windowId: windowIdentity.id,
    rendererPid: windowIdentity.rendererPid, rendererCreationTime: windowIdentity.creationTime, url: windowIdentity.url,
    electronVersion: runtime.identity.electronVersion };
  insist(['mainPid', 'rendererPid', 'windowId'].every(field => Number.isSafeInteger(owner[field]) && owner[field] > 0)
    && owner.mainPid !== owner.rendererPid && ['mainCreationTime', 'rendererCreationTime'].every(field => Number.isFinite(owner[field]) && owner[field] > 0)
    && typeof owner.url === 'string' && owner.url.startsWith('file:') && typeof owner.electronVersion === 'string' && owner.electronVersion,
  'UI_MOTION_OWNED_RUNTIME_REQUIRED');
  const viewports = [], events = [];
  let failure, mediaMayHaveChanged = false, windowMayHaveChanged = false;
  const ownedPageAction = async action => { await verifyOwnedMotionWindow(runtime.app, owner); await action(); };
  try {
    await verifyOwnedMotionWindow(runtime.app, owner);
    const observer = await (ports.createObserver ?? createNativeGeometryObserver)(runtime, writer);
    insist(observer && typeof observer.snapshot === 'function', 'UI_MOTION_NATIVE_OBSERVER_REQUIRED');
    mediaMayHaveChanged = true;
    await runtime.page.emulateMedia({ reducedMotion: 'reduce' });
    events.push({ event: 'reduced-motion-enabled', binding, timestamp: new Date().toISOString() });
    for (const kind of ['125-percent', 'minimum-window']) {
      await verifyOwnedMotionWindow(runtime.app, owner);
      // 只读归属已确认后即承担恢复责任，不能把 setter 或回传失败误作无副作用。
      windowMayHaveChanged = true;
      const resizeReceipt = await resizeMotionWindow(runtime.app, owner, { kind, attemptId: randomUUID() });
      await settleMotionMain(runtime.app, owner);
      await ownedPageAction(() => runtime.page.keyboard.press('Escape'));
      const prepared = await prepare(), controls = prepared.root.locator('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]').filter({ visible: true });
      insist(await controls.count() >= 2, 'UI_MOTION_TWO_VISIBLE_CONTROLS_REQUIRED');
      const nodes = [];
      for (let index = 0; index < 2; index++) { const target = controls.nth(index); await target.scrollIntoViewIfNeeded(); nodes.push(await describe(target, label + '-' + kind + '-' + index)); }
      await runtime.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      const bounds = await readSameFrameBounds(runtime.page, nodes.map(node => node.id));
      nodes.forEach((node, index) => { node.bounds = bounds[index].bounds; });
      const live = await runtime.page.evaluate(selector => ({ renderer: { url: location.href, innerWidth, innerHeight, devicePixelRatio }, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        stateText: document.querySelector(selector)?.innerText ?? '', animations: document.getAnimations().map(animation => ({ durationMs: animation.effect?.getComputedTiming().duration })) }), '.app-content');
      insist(live.reducedMotion && live.stateText.trim(), 'UI_MOTION_STATIC_STATE_NOT_OBSERVED');
      const target = path.join(writer.root, label, kind + '.png'); fs.mkdirSync(path.dirname(target), { recursive: true });
      const capture = await captureNativeMotionScreenshot(runtime, writer, target,
        { owner, resizeReceipt, observer, label: label + '/' + kind }, ui.readPngDimensions, captureOwnedMotionScreenshot);
      const geometry = capture.geometryWitness, pixels = ui.readPngDimensions(fs.readFileSync(target));
      insist(geometry && JSON.stringify(geometry.before.renderer) === JSON.stringify(live.renderer)
        && JSON.stringify(geometry.after.renderer) === JSON.stringify(live.renderer), 'UI_MOTION_RENDERER_GEOMETRY_CHANGED');
      const factor = live.renderer.devicePixelRatio;
      const dom = writer.json(label + '/' + kind + '-dom.json', { schemaVersion: 'v16.accessibility-motion-dom/3', binding, capturedAt: new Date().toISOString(),
        viewport: { width: pixels.width, height: pixels.height, scaleFactor: kind === '125-percent' ? 1.25 : 1 }, geometryWitness: geometry,
        coordinateSpace: 'physical-pixels', cssToPhysicalFactor: factor, reducedMotion: live.reducedMotion,
        stateText: live.stateText, animations: live.animations, nodes: nodes.map(node => ({ ...node,
          cssBounds: { x: node.bounds.x, y: node.bounds.y, width: node.bounds.width, height: node.bounds.height }, bounds: { x: node.bounds.x * factor, y: node.bounds.y * factor,
          width: node.bounds.width * factor, height: node.bounds.height * factor } })) });
      viewports.push({ kind, dom, screenshot: fileRecord(target) });
      events.push({ event: kind === '125-percent' ? '125-percent-capture' : 'minimum-window-capture', binding, timestamp: new Date().toISOString() });
    }
    return writer.json(label + '/motion-observation.json', { schemaVersion: 'v16.accessibility-observation/1', category: 'motion-zoom', binding,
      capturedAt: new Date().toISOString(), viewports, log: writer.write(label + '/motion.jsonl', events.map(event => JSON.stringify(event)).join('\n') + '\n') });
  } catch (error) { failure = error; throw error; }
  finally {
    const restoreWindow = () => runtime.app.evaluate(({ app, BrowserWindow }, owner) => {
      const window = BrowserWindow.fromId(owner.windowId);
      const metrics = app.getAppMetrics();
      if (!window || window.isDestroyed() || window.webContents.isDestroyed() || process.pid !== owner.mainPid
        || window.webContents.getOSProcessId() !== owner.rendererPid || window.webContents.getURL() !== owner.url
        || metrics.find(row => row.pid === process.pid)?.creationTime !== owner.mainCreationTime
        || metrics.find(row => row.pid === owner.rendererPid)?.creationTime !== owner.rendererCreationTime
        || process.versions.electron !== owner.electronVersion) {
        throw new Error('UI_MOTION_RESTORE_OWNED_WINDOW_REQUIRED');
      }
      window.webContents.setZoomFactor(1);
    }, owner);
    let restoreFailure;
    const actions = [...(windowMayHaveChanged ? [() => ownedPageAction(() => runtime.page.keyboard.press('Escape'))] : []),
      ...(mediaMayHaveChanged ? [() => ownedPageAction(() => runtime.page.emulateMedia({ reducedMotion: 'no-preference' }))] : []),
      ...(windowMayHaveChanged ? [() => ui.setElectronViewport(runtime.app, { width: 1366, height: 768 }, owner), restoreWindow] : [])];
    for (const action of actions) {
      try { await action(); }
      catch (error) { restoreFailure ??= error; logMotionRestoreFailure(writer, error); }
    }
    if (!failure && restoreFailure) throw restoreFailure;
  }
}
module.exports = { readSameFrameBounds, captureMotionZoom, captureOwnedMotionScreenshot };
