import { bootstrapBrowserPreview } from './dev-preview-api';
import { installRendererRuntimeErrorHandlers } from './runtime-log';

export function bootstrapAppBrowserPreview(username = 'SHC001') {
  if (typeof window === 'undefined') return { enabled: false } as const;
  return bootstrapBrowserPreview({
    dev: import.meta.env.DEV,
    target: window as any,
    username,
  });
}

export const browserPreviewBootstrap = bootstrapAppBrowserPreview();

export function appElectronApi(username = 'SHC001') {
  bootstrapAppBrowserPreview(username);
  return (window as any).electronAPI;
}

installRendererRuntimeErrorHandlers();
