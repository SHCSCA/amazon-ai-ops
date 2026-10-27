import type { createMainRuntimeContext } from './main-runtime-context';

export type MainRuntimeContext = ReturnType<typeof createMainRuntimeContext>;
let currentRuntime: MainRuntimeContext | null = null;

export function installMainRuntimeContext(runtime: MainRuntimeContext): void {
  if (currentRuntime) throw new Error('MAIN_RUNTIME_ALREADY_INSTALLED');
  currentRuntime = runtime;
}

export function getMainRuntimeContext(): MainRuntimeContext {
  if (!currentRuntime) throw new Error('MAIN_RUNTIME_NOT_INSTALLED');
  return currentRuntime;
}
