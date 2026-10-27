import {
  describe,
  expect,
  it,
  restoreWorkspaceScrollTop,
  waitForRendererComposite,
  waitForWorkspaceSettled,
} from './package-ui-test-context.mjs';

describe('packaged renderer settle contract', () => {
  it('restores the shared workspace scroll owner after keyboard focus moves it', async () => {
    let scrollTop = 180;
    const page = {
      evaluate: async (callback) => {
        expect(String(callback)).toContain("document.querySelector('.app-content')");
        const before = scrollTop;
        scrollTop = 0;
        return { after: scrollTop, before };
      },
      waitForFunction: async (callback) => {
        expect(String(callback)).toContain('Math.abs(content.scrollTop) <= 1');
        expect(scrollTop).toBe(0);
      },
    };

    await expect(restoreWorkspaceScrollTop(page)).resolves.toEqual({
      after: 0,
      before: 180,
    });
    expect(scrollTop).toBe(0);
  });

  it('waits for stable non-busy workspace text across four samples', async () => {
    const waits = [];
    const page = {
      evaluate: async () => ({
        busyCount: 0,
        busyLabels: [],
        navigationBusy: false,
        rootVisible: true,
        routeHandoffVisible: false,
        text: '稳定业务内容',
      }),
      waitForTimeout: async (ms) => { waits.push(ms); },
    };

    const result = await waitForWorkspaceSettled(page, '[data-workspace="diagnosis"]', 800);

    expect(result).toEqual(expect.objectContaining({
      minimumWaitMs: 2500,
      passed: true,
      sampleCount: 4,
      stableSamples: 3,
    }));
    expect(waits[0]).toBe(2500);
    expect(waits.slice(1)).toEqual([400, 400, 400]);
  });

  it('forces an Electron repaint between double animation frames and retains the required surface', async () => {
    let rendererFrames = 0;
    let invalidations = 0;
    const page = {
      evaluate: async (callback) => {
        expect(String(callback)).toContain('requestAnimationFrame');
        rendererFrames += 1;
      },
      waitForTimeout: async (ms) => { expect(ms).toBe(180); },
    };
    const electronApp = {
      evaluate: async (callback) => {
        expect(String(callback)).toContain('webContents.invalidate');
        invalidations += 1;
      },
    };
    const locator = {
      isVisible: async () => true,
      waitFor: async (options) => { expect(options.state).toBe('visible'); },
    };

    await expect(waitForRendererComposite(page, electronApp, locator)).resolves.toEqual({
      passed: true,
      requiredVisible: true,
    });
    expect(rendererFrames).toBe(2);
    expect(invalidations).toBe(1);
  });
});
