import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { MainIpcOperationTracker } from './main-ipc-operation-tracker';
import type { RuntimeLogPort } from './runtime-logger';

export type TrackedIpcListener = (
  event: IpcMainInvokeEvent,
  ...args: any[]
) => unknown;

export function createTrackedIpcRegistrar(
  ipcMain: IpcMain,
  operationTracker: MainIpcOperationTracker,
  logger: RuntimeLogPort,
): (channel: string, listener: TrackedIpcListener) => void {
  return (channel, listener) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await operationTracker.run(channel, () => listener(event, ...args));
      } catch (error) {
        logger.error('ipc.handler_failed', { channel, error });
        throw error;
      }
    });
  };
}
