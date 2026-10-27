import {
  captureViewportScreenshot,
  describe,
  expect,
  it,
  mkdtempSync,
  path,
  readFileSync,
  rmSync,
  tmpdir,
} from './package-ui-test-context.mjs';

describe('captureViewportScreenshot', () => {
  it('captures the verified packaged BrowserWindow through Electron webContents', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-screenshot-'));
    const screenshotPath = path.join(root, 'electron-window.png');
    const payload = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const electronApp = {
      evaluate: async (callback) => {
        expect(String(callback)).toContain('webContents.capturePage()');
        return {
          data: payload.toString('base64'),
          empty: false,
          nativeSize: { height: 1, width: 1 },
        };
      },
    };

    try {
      const result = await captureViewportScreenshot(electronApp, screenshotPath);

      expect(result).toEqual({
        dimensions: { height: 1, width: 1 },
        method: 'electron-webcontents-capture-page',
        nativeSize: { height: 1, width: 1 },
      });
      expect(readFileSync(screenshotPath)).toEqual(payload);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
