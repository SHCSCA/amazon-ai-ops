import {
  describe,
  expect,
  it,
  waitForBoundedElectronClose,
} from './package-ui-test-context.mjs';

describe('bounded packaged Electron shutdown', () => {
  it('fails closed when the packaged Electron close promise never settles', async () => {
    const electronApp = {
      close: () => new Promise(() => undefined),
    };

    await expect(waitForBoundedElectronClose(electronApp, 20)).rejects.toThrow(
      /PACKAGE_UI_ELECTRON_CLOSE_TIMEOUT/,
    );
  });
});
