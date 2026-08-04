export type CleanupFailureDecision = 'retry-safe-quit' | 'keep-app-open';

export type AppLifecycleDiagnosticScope =
  | 'startup-bootstrap'
  | 'startup-strict-quit-request'
  | 'shutdown-cleanup'
  | 'shutdown-recovery-dialog'
  | 'shutdown-recovery-strict-quit-request'
  | 'shutdown-recovery-sync-dialog'
  | 'shutdown-recovery-visible-window';

export interface CleanupFailureNotice {
  title: string;
  message: string;
  detail: string;
}

export interface AppLifecycleRecoveryOptions {
  requestStrictQuit(): void;
  ensureVisibleWindow(): void;
  showCleanupFailureDialog(notice: CleanupFailureNotice): Promise<CleanupFailureDecision>;
  showSynchronousError(title: string, message: string): void;
  reportDiagnostic(scope: AppLifecycleDiagnosticScope, error: unknown): void;
}

export interface AppLifecycleRecoveryController {
  runStartupBootstrap(startup: () => Promise<void> | void): Promise<void>;
  handleCleanupFailure(error: unknown): Promise<void>;
  waitForIdle(): Promise<void>;
}

const NO_PENDING_FAILURE = Symbol('no-pending-cleanup-failure');

function errorSummary(error: unknown): string {
  try {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim().slice(0, 500);
    }
  } catch {
    // Lifecycle containment must also tolerate an exotic error object whose
    // prototype or message accessor throws while the app is already failing.
  }
  return '未提供可读取的错误信息。';
}

function cleanupFailureNotice(error: unknown): CleanupFailureNotice {
  return {
    title: '无法安全退出',
    message: '后台任务已停止接收新请求，但尚未完成安全关闭。',
    detail: `为避免浏览器或数据库任务被中途切断，应用将保持可见。请重试安全退出；若暂不退出，需重启应用后才能恢复业务操作。\n\n错误摘要：${errorSummary(error)}`,
  };
}

export function createAppLifecycleRecoveryController(
  options: AppLifecycleRecoveryOptions,
): AppLifecycleRecoveryController {
  let activeCleanupRecovery: Promise<void> | null = null;
  let pendingCleanupFailure: unknown | typeof NO_PENDING_FAILURE = NO_PENDING_FAILURE;

  const reportDiagnostic = (scope: AppLifecycleDiagnosticScope, error: unknown): void => {
    try {
      options.reportDiagnostic(scope, error);
    } catch {
      // Diagnostics must never turn a contained lifecycle failure into an
      // unhandled rejection or bypass the strict shutdown barrier.
    }
  };

  const restoreVisibleFailureSurface = (notice: CleanupFailureNotice, cause: unknown): void => {
    reportDiagnostic('shutdown-recovery-dialog', cause);

    try {
      options.showSynchronousError(notice.title, `${notice.message}\n\n${notice.detail}`);
    } catch (error) {
      reportDiagnostic('shutdown-recovery-sync-dialog', error);
    }

    try {
      options.ensureVisibleWindow();
    } catch (error) {
      reportDiagnostic('shutdown-recovery-visible-window', error);
    }
  };

  const requestStrictQuit = (
    scope: 'startup-strict-quit-request' | 'shutdown-recovery-strict-quit-request',
    fallbackNotice: CleanupFailureNotice,
  ): void => {
    try {
      options.requestStrictQuit();
    } catch (error) {
      reportDiagnostic(scope, error);
      restoreVisibleFailureSurface(fallbackNotice, error);
    }
  };

  const presentCleanupFailure = async (error: unknown): Promise<void> => {
    reportDiagnostic('shutdown-cleanup', error);
    const notice = cleanupFailureNotice(error);

    let decision: CleanupFailureDecision;
    try {
      decision = await options.showCleanupFailureDialog(notice);
      if (decision !== 'retry-safe-quit' && decision !== 'keep-app-open') {
        throw new TypeError('Cleanup failure dialog returned an unknown decision.');
      }
    } catch (dialogError) {
      restoreVisibleFailureSurface(notice, dialogError);
      return;
    }

    if (decision === 'retry-safe-quit') {
      requestStrictQuit('shutdown-recovery-strict-quit-request', notice);
      return;
    }

    try {
      options.ensureVisibleWindow();
    } catch (visibleWindowError) {
      reportDiagnostic('shutdown-recovery-visible-window', visibleWindowError);
      try {
        options.showSynchronousError(notice.title, `${notice.message}\n\n${notice.detail}`);
      } catch (syncDialogError) {
        reportDiagnostic('shutdown-recovery-sync-dialog', syncDialogError);
      }
    }
  };

  const startCleanupRecovery = (error: unknown): Promise<void> => {
    const recovery = Promise.resolve()
      .then(() => presentCleanupFailure(error))
      .catch((recoveryError) => {
        // presentCleanupFailure is designed not to reject. Keep a last-resort
        // containment boundary so UI adapter bugs cannot create an unhandled
        // lifecycle rejection or trigger an unsafe exit.
        restoreVisibleFailureSurface(cleanupFailureNotice(error), recoveryError);
      })
      .finally(() => {
        if (activeCleanupRecovery !== recovery) {
          return;
        }
        activeCleanupRecovery = null;
        if (pendingCleanupFailure !== NO_PENDING_FAILURE) {
          const pendingError = pendingCleanupFailure;
          pendingCleanupFailure = NO_PENDING_FAILURE;
          startCleanupRecovery(pendingError);
        }
      });
    activeCleanupRecovery = recovery;
    return recovery;
  };

  const handleCleanupFailure = (error: unknown): Promise<void> => {
    if (activeCleanupRecovery) {
      // A retry can fail synchronously while the previous native dialog is
      // closing. Retain the newest failure and present it only after the active
      // prompt has settled, so native dialogs never overlap.
      pendingCleanupFailure = error;
      return activeCleanupRecovery;
    }
    return startCleanupRecovery(error);
  };

  const waitForIdle = async (): Promise<void> => {
    while (activeCleanupRecovery) {
      await activeCleanupRecovery;
    }
  };

  const runStartupBootstrap = async (startup: () => Promise<void> | void): Promise<void> => {
    try {
      await startup();
    } catch (error) {
      reportDiagnostic('startup-bootstrap', error);
      const notice = {
        title: '应用启动失败',
        message: '应用未能完成启动，已停止继续加载。',
        detail: `系统将通过同一个安全退出流程关闭已启动的后台资源。\n\n错误摘要：${errorSummary(error)}`,
      };
      try {
        options.showSynchronousError(
          notice.title,
          `${notice.message}\n\n${notice.detail}`,
        );
      } catch (dialogError) {
        reportDiagnostic('shutdown-recovery-sync-dialog', dialogError);
      }
      requestStrictQuit(
        'startup-strict-quit-request',
        notice,
      );
    }
  };

  return {
    runStartupBootstrap,
    handleCleanupFailure,
    waitForIdle,
  };
}
