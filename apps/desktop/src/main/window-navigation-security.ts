import * as path from 'path';
import { fileURLToPath } from 'url';

export const NAVIGATION_SECURITY_CONTRACT = 'amazon-ai-ops:navigation-security/v1' as const;

export type TrustedRendererTarget =
  | { kind: 'development'; rendererUrl: string }
  | { kind: 'packaged'; rendererFilePath: string };

export interface SafeNavigationTarget {
  protocol: string;
  hostname: string;
  port: string;
  pathname: string;
}

export type NavigationSecurityReason =
  | 'trusted-renderer-document'
  | 'unexpected-renderer-document'
  | 'invalid-trusted-renderer'
  | 'invalid-packaged-renderer'
  | 'invalid-url'
  | 'allowed-external-url'
  | 'disallowed-external-url'
  | 'external-open-failed';

export interface NavigationSecurityDecision {
  contract: typeof NAVIGATION_SECURITY_CONTRACT;
  allowed: boolean;
  reason: NavigationSecurityReason;
  safeTarget: SafeNavigationTarget | null;
}

export type NavigationSecuritySurface = 'will-navigate' | 'will-redirect' | 'window-open';
export type NavigationSecurityOutcome = 'blocked' | 'external-open-started' | 'external-open-failed';

export interface NavigationSecurityReport {
  contract: typeof NAVIGATION_SECURITY_CONTRACT;
  surface: NavigationSecuritySurface;
  outcome: NavigationSecurityOutcome;
  reason: NavigationSecurityReason;
  safeTarget: SafeNavigationTarget | null;
}

export type NavigationSecurityReporter = (report: NavigationSecurityReport) => void;

export interface MainWindowNavigationEvent {
  preventDefault(): void;
}

export interface WindowOpenDetails {
  url: string;
}

export type ExternalUrlOpener = (url: string) => Promise<void> | void;

function safeTarget(url: URL): SafeNavigationTarget {
  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
  };
}

function isCanonicalAbsoluteUrlText(rawUrl: unknown, kind: TrustedRendererTarget['kind']): rawUrl is string {
  if (
    typeof rawUrl !== 'string'
    || rawUrl.length === 0
    || rawUrl !== rawUrl.trim()
    || /[\u0000-\u001f\u007f]/.test(rawUrl)
  ) {
    return false;
  }
  return kind === 'development'
    ? /^https?:\/\//i.test(rawUrl)
    : /^file:\/\//i.test(rawUrl);
}

function normalizedPathForComparison(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isUncPath(filePath: string): boolean {
  return /^[\\/]{2}/.test(filePath);
}

function safelyReport(
  report: NavigationSecurityReporter | undefined,
  value: NavigationSecurityReport,
): void {
  try {
    report?.(value);
  } catch {
    // Security enforcement must not depend on observability succeeding.
  }
}

export function evaluateMainWindowNavigation(
  rawUrl: string,
  target: TrustedRendererTarget,
): NavigationSecurityDecision {
  if (!isCanonicalAbsoluteUrlText(rawUrl, target.kind)) {
    return {
      contract: NAVIGATION_SECURITY_CONTRACT,
      allowed: false,
      reason: 'invalid-url',
      safeTarget: null,
    };
  }
  let candidate: URL;
  try {
    candidate = new URL(rawUrl);
  } catch {
    return {
      contract: NAVIGATION_SECURITY_CONTRACT,
      allowed: false,
      reason: 'invalid-url',
      safeTarget: null,
    };
  }

  if (target.kind === 'development') {
    if (!isCanonicalAbsoluteUrlText(target.rendererUrl, 'development')) {
      return {
        contract: NAVIGATION_SECURITY_CONTRACT,
        allowed: false,
        reason: 'invalid-trusted-renderer',
        safeTarget: safeTarget(candidate),
      };
    }
    let trusted: URL;
    try {
      trusted = new URL(target.rendererUrl);
    } catch {
      return {
        contract: NAVIGATION_SECURITY_CONTRACT,
        allowed: false,
        reason: 'invalid-trusted-renderer',
        safeTarget: safeTarget(candidate),
      };
    }
    if (
      !['http:', 'https:'].includes(trusted.protocol)
      || !trusted.hostname
      || trusted.username !== ''
      || trusted.password !== ''
    ) {
      return {
        contract: NAVIGATION_SECURITY_CONTRACT,
        allowed: false,
        reason: 'invalid-trusted-renderer',
        safeTarget: safeTarget(candidate),
      };
    }
    const allowed = candidate.username === ''
      && candidate.password === ''
      && candidate.origin === trusted.origin
      && candidate.pathname === trusted.pathname;
    return {
      contract: NAVIGATION_SECURITY_CONTRACT,
      allowed,
      reason: allowed ? 'trusted-renderer-document' : 'unexpected-renderer-document',
      safeTarget: safeTarget(candidate),
    };
  }

  if (
    !path.isAbsolute(target.rendererFilePath)
    || isUncPath(target.rendererFilePath)
    || candidate.protocol !== 'file:'
    || candidate.hostname !== ''
    || candidate.username !== ''
    || candidate.password !== ''
  ) {
    return {
      contract: NAVIGATION_SECURITY_CONTRACT,
      allowed: false,
      reason: 'invalid-packaged-renderer',
      safeTarget: safeTarget(candidate),
    };
  }

  let candidateFilePath: string;
  try {
    candidateFilePath = fileURLToPath(candidate);
  } catch {
    return {
      contract: NAVIGATION_SECURITY_CONTRACT,
      allowed: false,
      reason: 'invalid-url',
      safeTarget: safeTarget(candidate),
    };
  }
  const allowed = normalizedPathForComparison(candidateFilePath)
    === normalizedPathForComparison(path.resolve(target.rendererFilePath));
  return {
    contract: NAVIGATION_SECURITY_CONTRACT,
    allowed,
    reason: allowed ? 'trusted-renderer-document' : 'unexpected-renderer-document',
    safeTarget: safeTarget(candidate),
  };
}

export function createMainWindowNavigationHandler(options: {
  surface: 'will-navigate' | 'will-redirect';
  target: TrustedRendererTarget;
  report?: NavigationSecurityReporter;
}): (event: MainWindowNavigationEvent, url: string) => NavigationSecurityDecision {
  return (event, url) => {
    const decision = evaluateMainWindowNavigation(url, options.target);
    if (!decision.allowed) {
      event.preventDefault();
      safelyReport(options.report, {
        contract: NAVIGATION_SECURITY_CONTRACT,
        surface: options.surface,
        outcome: 'blocked',
        reason: decision.reason,
        safeTarget: decision.safeTarget,
      });
    }
    return decision;
  };
}

export function evaluateWindowOpen(rawUrl: string): NavigationSecurityDecision {
  if (
    typeof rawUrl !== 'string'
    || rawUrl.length === 0
    || rawUrl.length > 2081
    || rawUrl !== rawUrl.trim()
    || /[\u0000-\u001f\u007f]/.test(rawUrl)
    || !/^https?:\/\//i.test(rawUrl)
  ) {
    return {
      contract: NAVIGATION_SECURITY_CONTRACT,
      allowed: false,
      reason: 'invalid-url',
      safeTarget: null,
    };
  }
  let candidate: URL;
  try {
    candidate = new URL(rawUrl);
  } catch {
    return {
      contract: NAVIGATION_SECURITY_CONTRACT,
      allowed: false,
      reason: 'invalid-url',
      safeTarget: null,
    };
  }
  const allowed = ['http:', 'https:'].includes(candidate.protocol)
    && Boolean(candidate.hostname)
    && candidate.username === ''
    && candidate.password === '';
  return {
    contract: NAVIGATION_SECURITY_CONTRACT,
    allowed,
    reason: allowed ? 'allowed-external-url' : 'disallowed-external-url',
    safeTarget: safeTarget(candidate),
  };
}

export function createSecureWindowOpenHandler(options: {
  openExternal: ExternalUrlOpener;
  report?: NavigationSecurityReporter;
}): (details: WindowOpenDetails) => { action: 'deny' } {
  return (details) => {
    const decision = evaluateWindowOpen(details.url);
    if (!decision.allowed) {
      safelyReport(options.report, {
        contract: NAVIGATION_SECURITY_CONTRACT,
        surface: 'window-open',
        outcome: 'blocked',
        reason: decision.reason,
        safeTarget: decision.safeTarget,
      });
      return { action: 'deny' };
    }

    safelyReport(options.report, {
      contract: NAVIGATION_SECURITY_CONTRACT,
      surface: 'window-open',
      outcome: 'external-open-started',
      reason: decision.reason,
      safeTarget: decision.safeTarget,
    });
    const normalizedUrl = new URL(details.url).toString();
    try {
      void Promise.resolve(options.openExternal(normalizedUrl)).catch(() => {
        safelyReport(options.report, {
          contract: NAVIGATION_SECURITY_CONTRACT,
          surface: 'window-open',
          outcome: 'external-open-failed',
          reason: 'external-open-failed',
          safeTarget: decision.safeTarget,
        });
      });
    } catch {
      safelyReport(options.report, {
        contract: NAVIGATION_SECURITY_CONTRACT,
        surface: 'window-open',
        outcome: 'external-open-failed',
        reason: 'external-open-failed',
        safeTarget: decision.safeTarget,
      });
    }
    return { action: 'deny' };
  };
}
