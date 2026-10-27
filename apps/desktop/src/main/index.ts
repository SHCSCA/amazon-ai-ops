import { app, BrowserWindow } from 'electron';
import { installGlobalRuntimeErrorHandlers } from './runtime-error-handlers';
import { startDesktopApplication } from './desktop-startup';
import { initApp } from './main-application-initialization-runtime';
import { registerIpcHandlers } from './main-ipc-registration-runtime';
import { startStoreBusinessDateAuthorityMonitor } from './main-store-context-runtime';
import { createMainRuntimeContext } from './main-runtime-context';
import { getMainRuntimeContext, installMainRuntimeContext } from './main-runtime-access';

installGlobalRuntimeErrorHandlers(app);
installMainRuntimeContext(createMainRuntimeContext(__filename));
const mainRuntimeContext = getMainRuntimeContext();

app.on('before-quit', mainRuntimeContext.handleBeforeQuit);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

if (mainRuntimeContext.mainStartupAdmission) {
  void startDesktopApplication({
    app,
    lifecycleRecovery: mainRuntimeContext.lifecycleRecovery,
    getMainWindow: () => mainRuntimeContext.mainWindow,
    countWindows: () => BrowserWindow.getAllWindows().length,
    initialize: initApp,
    registerIpcHandlers,
    createWindow: mainRuntimeContext.createWindow,
    startBusinessDateMonitor: startStoreBusinessDateAuthorityMonitor,
  });
}
