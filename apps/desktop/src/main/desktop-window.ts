import { BrowserWindow, dialog } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isPackageLaunchWindowReadyMarker,
  PACKAGE_LAUNCH_SMOKE_MODE,
  PACKAGE_LAUNCH_WINDOW_READY_MARKER,
} from './evidence-user-data-path';
import {
  EXTERNAL_OPEN_POLICY_MARKER,
  createMainWindowNavigationHandler,
  createSecureWindowOpenHandler,
  type TrustedRendererTarget,
} from './window-navigation-security';
import { installRendererProcessErrorHandler } from './runtime-error-handlers';
import { runtimeLogger } from './runtime-logger';
import { runtimeLog } from './runtime-log-adapter';

interface DesktopWindowRuntime {
  development: boolean;
  preloadPath: string;
  rendererFilePath: string;
  userDataDir: string;
  packageLaunchSmoke: boolean;
  onCreated(window: BrowserWindow): void;
  onClosed(window: BrowserWindow): void;
}

export interface CreateMainWindowOptions {
  forceVisible?: boolean;
}

export function createDesktopWindowFactory(runtime: DesktopWindowRuntime) {
  let packageLaunchWindowReadyWritten = false;
  return function createWindow(options: CreateMainWindowOptions = {}): BrowserWindow {
    const createdWindow = new BrowserWindow({
      width: 1400, height: 900, minWidth: 1200, minHeight: 700,
      webPreferences: {
        preload: runtime.preloadPath, contextIsolation: true, nodeIntegration: false,
      },
      title: 'Amazon AI Ops Agent', show: false,
    });
    runtime.onCreated(createdWindow);
    installRendererProcessErrorHandler(createdWindow, runtimeLogger, runtime.preloadPath);
    createdWindow.on('closed', () => runtime.onClosed(createdWindow));

    let rendererDidFinishLoad = false;
    let windowDidShow = false;
    const writeLaunchReadyMarkerWhenComplete = (): void => {
      if (!runtime.packageLaunchSmoke || packageLaunchWindowReadyWritten
        || !rendererDidFinishLoad || !windowDidShow
        || createdWindow.isDestroyed() || createdWindow.webContents.isDestroyed()) return;
      const marker = {
        kind: 'package-launch-window-ready' as const,
        schemaVersion: 1 as const,
        pid: process.pid,
        browserWindowId: createdWindow.id,
        evidenceMode: PACKAGE_LAUNCH_SMOKE_MODE,
        userDataDir: runtime.userDataDir,
        rendererUrl: createdWindow.webContents.getURL(),
        generatedAt: new Date().toISOString(),
      };
      if (!isPackageLaunchWindowReadyMarker(marker, {
        pid: process.pid, browserWindowId: createdWindow.id, userDataDir: runtime.userDataDir,
      })) throw new Error('PACKAGE_LAUNCH_WINDOW_READY_MARKER_INVALID');
      const markerPath = path.join(runtime.userDataDir, PACKAGE_LAUNCH_WINDOW_READY_MARKER);
      const temporaryPath = `${markerPath}.${process.pid}.${createdWindow.id}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
      fs.renameSync(temporaryPath, markerPath);
      packageLaunchWindowReadyWritten = true;
      runtimeLog.info('[App] package-launch-window-ready', marker);
    };
    const recordLaunchReadiness = (): void => {
      try {
        writeLaunchReadyMarkerWhenComplete();
      } catch (error) {
        runtimeLogger.error('window.launch_marker_write_failed', { windowId: createdWindow.id, error });
      }
    };
    createdWindow.webContents.once('did-finish-load', () => {
      rendererDidFinishLoad = true;
      recordLaunchReadiness();
    });
    createdWindow.once('ready-to-show', () => {
      createdWindow.show();
      windowDidShow = true;
      recordLaunchReadiness();
    });

    if (options.forceVisible) {
      // 恢复窗口必须立即可见，不能依赖可能永远不触发的页面加载事件。
      createdWindow.show();
      createdWindow.focus();
      windowDidShow = true;
    }

    const { development, rendererFilePath } = runtime;
    const trustedRendererTarget: TrustedRendererTarget = development
      ? { kind: 'development', rendererUrl: 'http://localhost:5173' }
      : { kind: 'packaged', rendererFilePath };
    const report: Parameters<typeof createMainWindowNavigationHandler>[0]['report'] = (boundary) => {
      runtimeLogger.warn('security.renderer_navigation_boundary', { boundary });
    };
    createdWindow.webContents.on('will-navigate', createMainWindowNavigationHandler({
      surface: 'will-navigate', target: trustedRendererTarget, report,
    }));
    createdWindow.webContents.on('will-redirect', createMainWindowNavigationHandler({
      surface: 'will-redirect', target: trustedRendererTarget, report,
    }));
    createdWindow.webContents.setWindowOpenHandler(createSecureWindowOpenHandler({
      externalOpenPolicy: EXTERNAL_OPEN_POLICY_MARKER, report,
    }));

    const rendererLoad = development
      ? createdWindow.loadURL('http://localhost:5173')
      : createdWindow.loadFile(rendererFilePath);
    if (development) createdWindow.webContents.openDevTools();
    void rendererLoad.catch((error) => {
      runtimeLogger.error('window.renderer_load_failed', { error });
      if (!createdWindow.isDestroyed()) {
        createdWindow.show();
        createdWindow.focus();
        windowDidShow = true;
      }
      try {
        dialog.showErrorBox(
          '界面加载失败',
          `主界面未能加载，应用已保留可见窗口以便安全退出。\n\n${error instanceof Error ? error.message : String(error)}`,
        );
      } catch (dialogError) {
        runtimeLogger.error('window.renderer_load_dialog_failed', { error: dialogError });
      }
    });
    return createdWindow;
  };
}
