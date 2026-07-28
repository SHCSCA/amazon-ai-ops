import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { stagePlaywrightChromiumRuntime } = require('./stage-playwright-chromium.js');

describe('stagePlaywrightChromiumRuntime', () => {
  it('creates a clean complete packaged Chromium directory from the Playwright executable', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-playwright-chromium-'));
    try {
      const sourceRoot = path.join(temporaryRoot, 'ms-playwright', 'chromium-1223', 'chrome-win64');
      const sourceExecutablePath = path.join(sourceRoot, 'chrome.exe');
      const stagingRoot = path.join(temporaryRoot, 'desktop', 'playwright-browsers');
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.mkdirSync(stagingRoot, { recursive: true });
      fs.writeFileSync(sourceExecutablePath, 'chromium-binary');
      fs.writeFileSync(path.join(sourceRoot, 'resources.pak'), 'runtime-resource');
      fs.writeFileSync(path.join(stagingRoot, 'stale.txt'), 'stale');

      const result = stagePlaywrightChromiumRuntime({ sourceExecutablePath, stagingRoot });

      expect(result).toMatchObject({
        revision: '1223',
        stagedExecutablePath: path.join(stagingRoot, 'chrome-win64', 'chrome.exe'),
      });
      expect(fs.readFileSync(result.stagedExecutablePath, 'utf8')).toBe('chromium-binary');
      expect(fs.readFileSync(path.join(stagingRoot, 'chrome-win64', 'resources.pak'), 'utf8')).toBe(
        'runtime-resource',
      );
      expect(fs.existsSync(path.join(stagingRoot, 'stale.txt'))).toBe(false);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
