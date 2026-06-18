const path = require('path');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (rootError) {
    try {
      return require(path.join(__dirname, '..', 'apps', 'desktop', 'node_modules', 'playwright'));
    } catch (desktopError) {
      const message = [
        'Unable to load Playwright for smoke tests.',
        `Root resolution failed: ${rootError && rootError.message ? rootError.message : String(rootError)}`,
        `Desktop package resolution failed: ${desktopError && desktopError.message ? desktopError.message : String(desktopError)}`,
        'Run pnpm install, or ensure apps/desktop/node_modules/playwright exists.',
      ].join('\n');
      const error = new Error(message);
      error.cause = desktopError;
      throw error;
    }
  }
}

module.exports = loadPlaywright();
