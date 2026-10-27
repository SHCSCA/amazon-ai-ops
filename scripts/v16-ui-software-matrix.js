const { insist } = require('./v16-performance-artifacts');

async function captureSoftwareMatrix(runtime, writer, binding, ui = require('./package-ui-evidence')) {
  const results = [], issues = [];
  const profiles = [{ id: '100-percent', zoom: 1, width: 1366, height: 768 },
    { id: '125-percent', zoom: 1.25, width: 1366, height: 768 },
    { id: 'wide', zoom: 1, width: 1400, height: 900 }, { id: 'minimum-window', zoom: 1, minimum: true }];
  for (const profile of profiles) {
    await runtime.app.evaluate(({ BrowserWindow }, settings) => {
      const window = BrowserWindow.getAllWindows().find(window => !window.isDestroyed());
      if (!window) throw new Error('UI_SOFTWARE_NATIVE_WINDOW_REQUIRED');
      if (window.isMaximized()) window.unmaximize();
      if (window.isFullScreen()) window.setFullScreen(false);
      window.webContents.setZoomFactor(settings.zoom);
      if (settings.minimum) { const [width, height] = window.getMinimumSize(); window.setSize(width - 1, height - 1, false); }
      else window.setContentSize(settings.width, settings.height, false);
      window.show(); window.focus();
    }, profile);
    await runtime.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const nativeWindow = await runtime.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(window => !window.isDestroyed());
      return { minimum: window.getMinimumSize(), bounds: window.getBounds(), content: window.getContentSize(), zoom: window.webContents.getZoomFactor() };
    });
    for (const entry of ui.EXPECTED_PACKAGE_UI_ENTRIES) {
      const label = `${profile.id}/${entry.workspace}-${entry.subview}`;
      try {
        await ui.navigateToWorkspace(runtime.page, entry, 2500, { deferSettle: true });
        const keyboard = await ui.exerciseWorkspaceTabKeyboard(runtime.page, entry);
        const selector = `[data-workspace-evidence-root][data-workspace="${entry.workspace}"][data-workspace-subview="${entry.subview}"]`;
        // 键盘恢复会重新挂载页面，只在恢复后使用原预算确认稳定状态。
        const settled = await ui.waitForWorkspaceSettled(runtime.page, selector, 2500);
        const root = runtime.page.locator(selector);
        await ui.waitForRendererComposite(runtime.page, runtime.app, root);
        const dom = await runtime.page.evaluate(() => {
          const visible = element => element.checkVisibility() && !element.closest('[hidden],[inert]');
          const controls = [...document.querySelectorAll('button,input,select,textarea,[role="tab"]')].filter(visible).map(element => {
            const fieldset = element.closest('fieldset:disabled');
            const ids = (element.getAttribute('aria-describedby') || fieldset?.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
            return { tag: element.tagName, name: element.getAttribute('aria-label') || element.closest('label')?.innerText || element.textContent?.trim(),
              disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true', busy: element.getAttribute('aria-busy') === 'true',
              reason: ids.map(id => document.getElementById(id)?.textContent || '').join(' ') || element.getAttribute('aria-description') || '',
              bounds: element.getBoundingClientRect().toJSON() };
          });
          return { capturedAt: new Date().toISOString(), title: document.querySelector('h1')?.textContent,
            viewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio }, controls,
            errorStates: [...document.querySelectorAll('[data-workspace-state="error"]')].filter(visible).map(element => element.innerText),
            focused: { name: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent, id: document.activeElement?.id } };
        });
        const name = label.replace(/[^a-zA-Z0-9/_-]/g, '-');
        const imagePath = require('node:path').join(writer.root, name + '.png');
        require('node:fs').mkdirSync(require('node:path').dirname(imagePath), { recursive: true });
        await ui.captureViewportScreenshot(runtime.app, imagePath);
        const missingReasons = dom.controls.filter(control => control.disabled && !control.reason);
        const screenshot = require('./v16-performance-artifacts').fileRecord(imagePath);
        const record = writer.json(name + '.json', { kind: 'v16-software-ui-entry', schemaVersion: 1, formalCredit: false,
          binding: { ...binding, profileId: profile.id }, entry, nativeWindow, settled, keyboard, dom, screenshot, missingReasons });
        if (missingReasons.length) issues.push({ entry: `${entry.workspace}/${entry.subview}`, profile: profile.id, code: 'UI_DISABLED_CONTROL_REASON_MISSING', controls: missingReasons });
        if (dom.errorStates.length) issues.push({ entry: `${entry.workspace}/${entry.subview}`, profile: profile.id, code: 'UI_WORKSPACE_ERROR_STATE_OBSERVED', errors: dom.errorStates });
        results.push({ profileId: profile.id, entry: `${entry.workspace}/${entry.subview}`, record, screenshot, observed: dom.errorStates.length === 0 });
      } catch (error) {
        writer.log('v16.ui_matrix_entry_failed', error, { label, pid: runtime.identity.pid });
        issues.push({ profile: profile.id, entry: `${entry.workspace}/${entry.subview}`, code: error.message });
        results.push({ profileId: profile.id, entry: `${entry.workspace}/${entry.subview}`, observed: false });
      }
    }
  }
  insist(results.length === profiles.length * ui.EXPECTED_PACKAGE_UI_ENTRIES.length, 'UI_SOFTWARE_MATRIX_INVENTORY_INCOMPLETE');
  return { profiles: profiles.map(profile => profile.id), entries: ui.EXPECTED_PACKAGE_UI_ENTRIES.length, results, issues };
}
module.exports = { captureSoftwareMatrix };
