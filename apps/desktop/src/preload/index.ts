import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getState: () => ipcRenderer.invoke('app:get-state'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings:save', settings),
  getRuleConfig: () => ipcRenderer.invoke('settings:get-rule-config'),
  saveRuleConfig: (config: any) => ipcRenderer.invoke('settings:save-rule-config', config),

  // Browser
  browserLogin: (username: string, password: string) =>
    ipcRenderer.invoke('browser:login', { username, password }),
  browserLogout: () => ipcRenderer.invoke('browser:logout'),
  browserScreenshot: (label: 'before' | 'after' | 'error') =>
    ipcRenderer.invoke('browser:screenshot', label),
  isBrowserReady: () => ipcRenderer.invoke('browser:is-ready'),

  // Reports
  downloadReport: (dateRange: { start: string; end: string }) =>
    ipcRenderer.invoke('report:download', dateRange),
  parseReport: (filePath: string) => ipcRenderer.invoke('report:parse', filePath),
  selectReportFile: () => ipcRenderer.invoke('report:select-file'),

  // Recommendations
  getRecommendations: (params: { date?: string; status?: string; limit?: number }) =>
    ipcRenderer.invoke('recommendations:get', params),
  generateRecommendations: () => ipcRenderer.invoke('recommendations:generate'),
  approveRecommendation: (id: number) => ipcRenderer.invoke('recommendations:approve', id),
  rejectRecommendation: (id: number) => ipcRenderer.invoke('recommendations:reject', id),
  executeRecommendation: (id: number) => ipcRenderer.invoke('recommendations:execute', id),

  // Scheduler
  getScheduledTasks: () => ipcRenderer.invoke('scheduler:get-tasks'),
  setTaskEnabled: (name: string, enabled: boolean) =>
    ipcRenderer.invoke('scheduler:set-task-enabled', { name, enabled }),
  runTaskNow: (name: string) => ipcRenderer.invoke('scheduler:run-now', name),

  // Products
  getProducts: () => ipcRenderer.invoke('products:get'),
  addProduct: (product: any) => ipcRenderer.invoke('products:add', product),

  // Logs
  getLogs: (params: { dateFrom: string; dateTo: string; limit?: number }) =>
    ipcRenderer.invoke('logs:get', params),

  // Metrics
  getRecentMetrics: (days: number) => ipcRenderer.invoke('metrics:get-recent', days),
  getMetricsSummary: (date: string) => ipcRenderer.invoke('metrics:get-summary', date),

  // Event listeners
  onSchedulerTaskStart: (callback: (taskName: string) => void) => {
    const handler = (_: any, taskName: string) => callback(taskName);
    ipcRenderer.on('scheduler:task-start', handler);
    return () => ipcRenderer.removeListener('scheduler:task-start', handler);
  },
  onSchedulerTaskComplete: (callback: (data: { taskName: string; duration: number }) => void) => {
    const handler = (_: any, data: { taskName: string; duration: number }) => callback(data);
    ipcRenderer.on('scheduler:task-complete', handler);
    return () => ipcRenderer.removeListener('scheduler:task-complete', handler);
  },
  onSchedulerTaskError: (callback: (data: { taskName: string; error: string }) => void) => {
    const handler = (_: any, data: { taskName: string; error: string }) => callback(data);
    ipcRenderer.on('scheduler:task-error', handler);
    return () => ipcRenderer.removeListener('scheduler:task-error', handler);
  },
  onRecommendationsGenerated: (callback: (count: number) => void) => {
    const handler = (_: any, count: number) => callback(count);
    ipcRenderer.on('recommendations:generated', handler);
    return () => ipcRenderer.removeListener('recommendations:generated', handler);
  },
  onCleanupReport: (callback: (report: any) => void) => {
    const handler = (_: any, report: any) => callback(report);
    ipcRenderer.on('cleanup:report', handler);
    return () => ipcRenderer.removeListener('cleanup:report', handler);
  },
});
