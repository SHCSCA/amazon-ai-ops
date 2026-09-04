/**
 * Analysis Runs Preload API
 *
 * Exposes analysis runs operations to the Renderer through the Preload bridge.
 *
 * @module analysis-runs-api
 */

import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type {
  CreateRunResponse,
  UpdateRunResponse,
  QueryRunResponse,
  ListRunsResponse,
} from '../main/analysis-runs-ipc';

export interface AnalysisRunsIpcInvoker {
  invoke(channel: string, request: unknown): Promise<unknown>;
}

type ScopedCall = (
  storeContext: StoreContextEnvelope,
  input?: Record<string, unknown>,
) => Promise<unknown>;

export interface AnalysisRunsPreloadApi {
  /** Create a new analysis run */
  readonly create: ScopedCall;
  /** Update an analysis run */
  readonly update: ScopedCall;
  /** Query a specific analysis run by ID */
  readonly query: ScopedCall;
  /** List analysis runs for current store */
  readonly list: ScopedCall;
}

/**
 * Create Analysis Runs API for Preload
 *
 * Returns a frozen object with scoped calls that automatically include storeContext.
 */
export function createAnalysisRunsPreloadApi(
  ipc: AnalysisRunsIpcInvoker,
): AnalysisRunsPreloadApi {
  const call = (channel: string): ScopedCall => (storeContext, input = {}) =>
    ipc.invoke(channel, { storeContext, input });

  return Object.freeze({
    create: call('analysis-runs:create'),
    update: call('analysis-runs:update'),
    query: call('analysis-runs:query'),
    list: call('analysis-runs:list'),
  });
}

export type { CreateRunResponse, UpdateRunResponse, QueryRunResponse, ListRunsResponse };
