import { describe, expect, it, vi } from 'vitest';
import { BrowserController, toUserFacingBrowserLaunchError } from './controller';

describe('toUserFacingBrowserLaunchError', () => {
  it('hides raw Playwright launch arguments and profile paths', () => {
    const error = new Error([
      'browserType.launchPersistentContext: Target page, context or browser has been closed',
      'Call log:',
      '<launching> chrome.exe --disable-background-networking --user-data-dir=C:\\Users\\wz\\AppData\\Roaming\\@amazon-ai-ops\\desktop\\storage\\browser-data',
      '--disable-blink-features=AutomationControlled',
    ].join('\n'));

    const message = toUserFacingBrowserLaunchError(error);

    expect(message).toBe('浏览器启动失败：领星自动化浏览器配置正在被另一个实例占用。请关闭上一个自动化浏览器窗口后重试。');
    expect(message).not.toContain('--user-data-dir');
    expect(message).not.toContain('Call log');
    expect(message).not.toContain('chrome.exe');
  });

  it('returns a specific packaged runtime message for missing Chromium', () => {
    const message = toUserFacingBrowserLaunchError(new Error("Executable doesn't exist at C:/app/resources/playwright-browsers/chrome-win64/chrome.exe"));

    expect(message).toBe('浏览器启动失败：打包浏览器运行时不可用。请重新安装或重新构建桌面应用后重试。');
  });
});

describe('BrowserController.evaluate', () => {
  it('wraps multiple arguments into one Playwright evaluate payload', async () => {
    const controller = new BrowserController({ headless: true });
    const evaluate = vi.fn(async (fn: Function, arg?: unknown) => fn(arg));
    (controller as any).page = { evaluate };

    const result = await controller.evaluate((left: number, right: number) => left + right, 2, 3);

    expect(result).toBe(5);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[0]).toHaveLength(2);
    expect(evaluate.mock.calls[0][1]).toMatchObject({ values: [2, 3] });
    expect(evaluate.mock.calls[0][1]).toHaveProperty('source');
  });

  it('keeps a single argument as the native Playwright evaluate argument', async () => {
    const controller = new BrowserController({ headless: true });
    const evaluate = vi.fn(async (fn: Function, arg?: unknown) => fn(arg));
    (controller as any).page = { evaluate };

    const result = await controller.evaluate((value: number) => value * 2, 4);

    expect(result).toBe(8);
    expect(evaluate.mock.calls[0][1]).toBe(4);
  });
});
