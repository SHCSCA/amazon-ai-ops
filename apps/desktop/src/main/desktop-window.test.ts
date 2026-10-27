import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopWindowFactory } from './desktop-window';
import { runtimeLogger } from './runtime-logger';
import { PACKAGE_LAUNCH_WINDOW_READY_MARKER } from './evidence-user-data-path';

const state = vi.hoisted(() => ({ trace: [] as string[], loadError: null as Error | null }));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeWindow extends EventEmitter {
    id = 1;
    visible = false;
    webContents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      getURL: () => 'file:///app/index.html',
      openDevTools: vi.fn(),
      setWindowOpenHandler: () => { state.trace.push('open-guard'); },
    });
    constructor(readonly options: unknown) {
      super();
      this.webContents.on('newListener', (event) => { state.trace.push(`guard:${String(event)}`); });
    }
    show() { this.visible = true; state.trace.push('show'); }
    focus() { state.trace.push('focus'); }
    isDestroyed() { return false; }
    loadFile() {
      state.trace.push('load');
      return state.loadError ? Promise.reject(state.loadError) : Promise.resolve();
    }
    loadURL() { return this.loadFile(); }
  }
  return { BrowserWindow: FakeWindow, dialog: { showErrorBox: vi.fn() } };
});

function factory(userDataDir = 'unused', packageLaunchSmoke = false) {
  const onCreated = vi.fn();
  const onClosed = vi.fn();
  const createWindow = createDesktopWindowFactory({
    development: false, preloadPath: 'preload.cjs', rendererFilePath: 'renderer.html',
    userDataDir, packageLaunchSmoke, onCreated, onClosed,
  });
  return { createWindow, onCreated, onClosed };
}

describe('desktop window lifecycle', () => {
  beforeEach(() => {
    state.trace.length = 0;
    state.loadError = null;
    vi.spyOn(runtimeLogger, 'info').mockImplementation(() => {});
    vi.spyOn(runtimeLogger, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('keeps isolation and installs every navigation boundary before loading', () => {
    const { createWindow, onCreated, onClosed } = factory();
    const window = createWindow();
    const options = (window as BrowserWindow & { options: Record<string, unknown> }).options;
    expect(options).toMatchObject({ minWidth: 1200, minHeight: 700, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    for (const guard of ['guard:will-navigate', 'guard:will-redirect', 'open-guard']) {
      expect(state.trace.indexOf(guard)).toBeLessThan(state.trace.indexOf('load'));
      expect(state.trace).toContain(guard);
    }
    expect(onCreated).toHaveBeenCalledWith(window);
    window.emit('closed');
    expect(onClosed).toHaveBeenCalledWith(window);
  });

  it('shows the recovery window before load and contains a rejected renderer load', async () => {
    state.loadError = new Error('load rejected');
    factory().createWindow({ forceVisible: true });
    expect(state.trace.indexOf('show')).toBeLessThan(state.trace.indexOf('load'));
    await Promise.resolve();
    expect(runtimeLogger.error).toHaveBeenCalledWith('window.renderer_load_failed', { error: state.loadError });
    expect(dialog.showErrorBox).toHaveBeenCalledWith('界面加载失败', expect.stringContaining('load rejected'));
  });

  it('writes a launch marker only after both load and visible-window events', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'amazon-window-marker-'));
    try {
      const { createWindow } = factory(directory, true);
      const window = createWindow();
      const markerPath = path.join(directory, PACKAGE_LAUNCH_WINDOW_READY_MARKER);
      window.webContents.emit('did-finish-load');
      expect(existsSync(markerPath)).toBe(false);
      window.emit('ready-to-show');
      expect(JSON.parse(readFileSync(markerPath, 'utf8'))).toMatchObject({ pid: process.pid, browserWindowId: 1, evidenceMode: 'package-launch-smoke' });
      const firstMarker = readFileSync(markerPath, 'utf8');
      const next = createWindow();
      next.webContents.emit('did-finish-load');
      next.emit('ready-to-show');
      expect(readFileSync(markerPath, 'utf8')).toBe(firstMarker);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('records marker write failure without manufacturing launch evidence', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'amazon-window-failure-'));
    try {
      const missingDirectory = path.join(directory, 'missing');
      const window = factory(missingDirectory, true).createWindow();
      window.webContents.emit('did-finish-load');
      expect(() => window.emit('ready-to-show')).not.toThrow();
      expect(runtimeLogger.error).toHaveBeenCalledWith('window.launch_marker_write_failed', expect.objectContaining({ windowId: 1 }));
      expect(existsSync(path.join(missingDirectory, PACKAGE_LAUNCH_WINDOW_READY_MARKER))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
