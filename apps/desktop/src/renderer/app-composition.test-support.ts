import { readFileSync } from 'node:fs';

const APP_MODULES = [
  'app-login-state.ts',
  'app-login-styles.ts',
  'app-connection-presentations.ts',
  'app-authority.ts',
  'app-navigation.ts',
  'app-bootstrap.ts',
  'app-store-connection-workbench.tsx',
  'app-store-connection-controller.tsx',
  'app-store-connection-view.tsx',
  'app-runtime.tsx',
  'app-session-boundary.tsx',
  'App.tsx',
] as const;

// 静态合同读取实际生产模块；这里只组合断言文本，不执行或重建应用实现。
export function appCompositionSource(): string {
  return APP_MODULES.map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
}
