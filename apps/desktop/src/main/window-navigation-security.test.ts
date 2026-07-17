import * as path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it, vi } from 'vitest';
import {
  NAVIGATION_SECURITY_CONTRACT,
  createMainWindowNavigationHandler,
  createSecureWindowOpenHandler,
  evaluateMainWindowNavigation,
} from './window-navigation-security';

describe('window navigation security', () => {
  it('allows only the configured development renderer document while omitting query and hash from safe evidence', () => {
    const decision = evaluateMainWindowNavigation(
      'http://localhost:5173/?preview=diagnosis#inspector',
      { kind: 'development', rendererUrl: 'http://localhost:5173/' },
    );

    expect(NAVIGATION_SECURITY_CONTRACT).toBe('amazon-ai-ops:navigation-security/v1');
    expect(decision).toEqual({
      contract: NAVIGATION_SECURITY_CONTRACT,
      allowed: true,
      reason: 'trusted-renderer-document',
      safeTarget: {
        protocol: 'http:',
        hostname: 'localhost',
        port: '5173',
        pathname: '/',
      },
    });
  });

  it('fails closed when the configured development renderer URL contains userinfo', () => {
    const decision = evaluateMainWindowNavigation(
      'http://localhost:5173/',
      { kind: 'development', rendererUrl: 'http://operator:secret@localhost:5173/' },
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('invalid-trusted-renderer');
  });

  it('rejects non-canonical renderer URL text instead of relying on URL parser repair', () => {
    const target = { kind: 'development', rendererUrl: 'http://localhost:5173/' } as const;

    expect(evaluateMainWindowNavigation(' http://localhost:5173/', target).allowed).toBe(false);
    expect(evaluateMainWindowNavigation('http:localhost:5173/', target).allowed).toBe(false);
  });

  it('rejects development renderer host, path, and userinfo spoofing', () => {
    const target = { kind: 'development', rendererUrl: 'http://localhost:5173/' } as const;
    const blocked = [
      'http://localhost.evil.example:5173/',
      'http://localhost:5173/other-document',
      'http://operator:secret@localhost:5173/',
      'https://localhost:5173/',
    ];

    for (const url of blocked) {
      expect(evaluateMainWindowNavigation(url, target).allowed).toBe(false);
    }
  });

  it('allows the exact packaged renderer file with query and hash', () => {
    const rendererFilePath = path.resolve('apps/desktop/dist/renderer/index.html');
    const candidate = new URL(pathToFileURL(rendererFilePath));
    candidate.search = '?evidence=package-ui';
    candidate.hash = '#diagnosis';

    const decision = evaluateMainWindowNavigation(candidate.toString(), {
      kind: 'packaged',
      rendererFilePath,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('trusted-renderer-document');
    expect(decision.safeTarget).toEqual({
      protocol: 'file:',
      hostname: '',
      port: '',
      pathname: pathToFileURL(rendererFilePath).pathname,
    });
  });

  it('rejects packaged UNC, forged-host, and different-file destinations', () => {
    const rendererFilePath = path.resolve('apps/desktop/dist/renderer/index.html');
    const target = { kind: 'packaged', rendererFilePath } as const;

    expect(evaluateMainWindowNavigation('file://evil.example/C:/app/renderer/index.html', target).allowed).toBe(false);
    expect(evaluateMainWindowNavigation(pathToFileURL(path.resolve('apps/desktop/dist/renderer/other.html')).toString(), target).allowed).toBe(false);
    expect(evaluateMainWindowNavigation('file:////server/share/index.html', {
      kind: 'packaged',
      rendererFilePath: '//server/share/index.html',
    }).allowed).toBe(false);
  });

  it('prevents and safely reports an unexpected main-frame navigation', () => {
    const report = vi.fn();
    const preventDefault = vi.fn();
    const handler = createMainWindowNavigationHandler({
      surface: 'will-navigate',
      target: { kind: 'development', rendererUrl: 'http://localhost:5173/' },
      report,
    });

    const decision = handler(
      { preventDefault },
      'https://operator:secret@evil.example/workbench?token=hidden#section',
    );

    expect(decision.allowed).toBe(false);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith({
      contract: NAVIGATION_SECURITY_CONTRACT,
      surface: 'will-navigate',
      outcome: 'blocked',
      reason: 'unexpected-renderer-document',
      safeTarget: {
        protocol: 'https:',
        hostname: 'evil.example',
        port: '',
        pathname: '/workbench',
      },
    });
  });

  it('uses the same allow decision for will-navigate and will-redirect without cancelling trusted loads', () => {
    for (const surface of ['will-navigate', 'will-redirect'] as const) {
      const report = vi.fn();
      const preventDefault = vi.fn();
      const handler = createMainWindowNavigationHandler({
        surface,
        target: { kind: 'development', rendererUrl: 'http://localhost:5173/' },
        report,
      });

      expect(handler({ preventDefault }, 'http://localhost:5173/?state=ready#workspace').allowed).toBe(true);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(report).not.toHaveBeenCalled();
    }
  });

  it('denies the Electron child window while opening a valid HTTPS destination externally', () => {
    const openExternal = vi.fn(async () => undefined);
    const report = vi.fn();
    const handler = createSecureWindowOpenHandler({ openExternal, report });

    const response = handler({
      url: 'https://docs.example.com/help?token=hidden#credentials',
    });

    expect(response).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledWith('https://docs.example.com/help?token=hidden#credentials');
    expect(report).toHaveBeenCalledWith({
      contract: NAVIGATION_SECURITY_CONTRACT,
      surface: 'window-open',
      outcome: 'external-open-started',
      reason: 'allowed-external-url',
      safeTarget: {
        protocol: 'https:',
        hostname: 'docs.example.com',
        port: '',
        pathname: '/help',
      },
    });
    expect(JSON.stringify(report.mock.calls)).not.toContain('token=hidden');
    expect(JSON.stringify(report.mock.calls)).not.toContain('credentials');
  });

  it('does not invoke the operating system for malformed, credentialed, or non-HTTP URLs', () => {
    const openExternal = vi.fn(async () => undefined);
    const handler = createSecureWindowOpenHandler({ openExternal });
    const blockedUrls = [
      'https:docs.example.com/help',
      ' https://docs.example.com/help',
      'https://operator:secret@docs.example.com/help',
      'javascript:alert(1)',
      'file:///C:/Windows/System32/calc.exe',
      'ms-settings:privacy',
      'not a URL',
    ];

    for (const url of blockedUrls) {
      expect(handler({ url })).toEqual({ action: 'deny' });
    }

    expect(openExternal).not.toHaveBeenCalled();
  });

  it('swallows openExternal rejection and emits only a structured redacted failure report', async () => {
    const openExternal = vi.fn(() => Promise.reject(new Error('token=do-not-log')));
    const reports: unknown[] = [];
    const handler = createSecureWindowOpenHandler({
      openExternal,
      report: (value) => reports.push(value),
    });

    expect(handler({ url: 'http://support.example.com:8080/help?token=hidden#private' })).toEqual({ action: 'deny' });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(reports[reports.length - 1]).toEqual({
      contract: NAVIGATION_SECURITY_CONTRACT,
      surface: 'window-open',
      outcome: 'external-open-failed',
      reason: 'external-open-failed',
      safeTarget: {
        protocol: 'http:',
        hostname: 'support.example.com',
        port: '8080',
        pathname: '/help',
      },
    });
    expect(JSON.stringify(reports)).not.toContain('token=');
    expect(JSON.stringify(reports)).not.toContain('private');
    expect(JSON.stringify(reports)).not.toContain('do-not-log');
  });
});
