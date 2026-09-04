/**
 * Analysis Runs IPC Handlers Tests
 *
 * Tests IPC contract between Main and Renderer for Analysis Runs operations.
 * Verifies request/response types and error handling through the service layer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnalysisRunRecord, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';

// Mock Electron's ipcMain before any imports
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

import {
  registerAnalysisRunsIpcHandlers,
  ANALYSIS_RUNS_CHANNELS,
  type CreateRunResponse,
  type UpdateRunResponse,
  type QueryRunResponse,
  type ListRunsResponse,
} from './analysis-runs-ipc';
import { AnalysisRunsServiceError } from './analysis-runs-service';

// Mock service — only the methods the IPC layer calls
type MockService = {
  createRun: ReturnType<typeof vi.fn>;
  updateStage: ReturnType<typeof vi.fn>;
  completeRun: ReturnType<typeof vi.fn>;
  failRun: ReturnType<typeof vi.fn>;
  blockRun: ReturnType<typeof vi.fn>;
  getRun: ReturnType<typeof vi.fn>;
  listRuns: ReturnType<typeof vi.fn>;
};

// Mock IPC registrar
type MockHandler = (event: unknown, request?: unknown) => unknown;
const handlers = new Map<string, MockHandler>();

const mockRegistrar = {
  handle: vi.fn((channel: string, handler: MockHandler) => {
    handlers.set(channel, handler);
  }),
};

describe('Analysis Runs IPC', () => {
  let service: MockService;

  const storeContext: StoreContextEnvelope = {
    storeId: 'store-a',
    marketplace: 'US',
    currency: 'USD',
    businessDate: '2026-09-03',
    sessionGeneration: 1,
  };

  const mockRun: AnalysisRunRecord = {
    runId: 'run_1',
    storeId: 'store-a',
    marketplace: 'US',
    currency: 'USD',
    reportSnapshotId: 'snapshot-1',
    status: 'pending',
    recommendationsCount: 0,
    createdAt: '2026-09-03T10:00:00Z',
    updatedAt: '2026-09-03T10:00:00Z',
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    service = {
      createRun: vi.fn(),
      updateStage: vi.fn(),
      completeRun: vi.fn(),
      failRun: vi.fn(),
      blockRun: vi.fn(),
      getRun: vi.fn(),
      listRuns: vi.fn(),
    };
    registerAnalysisRunsIpcHandlers(
      mockRegistrar as unknown as Parameters<typeof registerAnalysisRunsIpcHandlers>[0],
      service as unknown as Parameters<typeof registerAnalysisRunsIpcHandlers>[1],
    );
  });

  describe('registerAnalysisRunsIpcHandlers', () => {
    it('registers all four channel handlers', () => {
      expect(mockRegistrar.handle).toHaveBeenCalledWith(
        ANALYSIS_RUNS_CHANNELS.CREATE,
        expect.any(Function),
      );
      expect(mockRegistrar.handle).toHaveBeenCalledWith(
        ANALYSIS_RUNS_CHANNELS.UPDATE,
        expect.any(Function),
      );
      expect(mockRegistrar.handle).toHaveBeenCalledWith(
        ANALYSIS_RUNS_CHANNELS.QUERY,
        expect.any(Function),
      );
      expect(mockRegistrar.handle).toHaveBeenCalledWith(
        ANALYSIS_RUNS_CHANNELS.LIST,
        expect.any(Function),
      );
    });
  });

  describe('CREATE handler', () => {
    it('returns success response when service.createRun succeeds', async () => {
      service.createRun.mockReturnValue(mockRun);

      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.CREATE)!;
      const response = await handler({}, {
        storeContext,
        input: { reportSnapshotId: 'snapshot-1' },
      }) as CreateRunResponse;

      expect(response.success).toBe(true);
      expect(response.run).toBeDefined();
      expect(response.run?.runId).toBe('run_1');
      expect(response.error).toBeUndefined();
      expect(service.createRun).toHaveBeenCalled();
    });

    it('returns error response when service.createRun throws', async () => {
      service.createRun.mockImplementation(() => {
        throw new AnalysisRunsServiceError('DB write failed', 'SERVICE_ERROR');
      });

      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.CREATE)!;
      const response = await handler({}, {
        storeContext,
        input: { reportSnapshotId: 'snapshot-1' },
      }) as CreateRunResponse;

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('DB write failed');
    });

    it('returns error when storeContext or input is missing', async () => {
      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.CREATE)!;
      const response = await handler({}, {}) as CreateRunResponse;

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('SERVICE_ERROR');
    });
  });

  describe('UPDATE handler', () => {
    it('routes completed status to completeRun', async () => {
      const updatedRun = { ...mockRun, status: 'completed' as const };
      service.completeRun.mockReturnValue(updatedRun);

      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.UPDATE)!;
      const response = await handler({}, {
        storeContext,
        input: { runId: 'run_1', status: 'completed', recommendationsCount: 3 },
      }) as UpdateRunResponse;

      expect(response.success).toBe(true);
      expect(response.run?.status).toBe('completed');
      expect(service.completeRun).toHaveBeenCalledWith({
        storeContext,
        runId: 'run_1',
        recommendationsCount: 3,
      });
    });

    it('routes failed status to failRun', async () => {
      const failedRun = { ...mockRun, status: 'failed' as const, blockedReason: 'boom' };
      service.failRun.mockReturnValue(failedRun);

      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.UPDATE)!;
      const response = await handler({}, {
        storeContext,
        input: { runId: 'run_1', status: 'failed', blockedReason: 'boom' },
      }) as UpdateRunResponse;

      expect(response.success).toBe(true);
      expect(response.run?.status).toBe('failed');
      expect(service.failRun).toHaveBeenCalledWith({
        storeContext,
        runId: 'run_1',
        reason: 'boom',
      });
    });

    it('routes blocked status to blockRun', async () => {
      const blockedRun = { ...mockRun, status: 'blocked' as const, blockedReason: 'waiting' };
      service.blockRun.mockReturnValue(blockedRun);

      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.UPDATE)!;
      const response = await handler({}, {
        storeContext,
        input: { runId: 'run_1', status: 'blocked', blockedReason: 'waiting' },
      }) as UpdateRunResponse;

      expect(response.success).toBe(true);
      expect(service.blockRun).toHaveBeenCalledWith({
        storeContext,
        runId: 'run_1',
        reason: 'waiting',
      });
    });

    it('routes generic status to updateStage', async () => {
      service.updateStage.mockReturnValue({ ...mockRun, status: 'analyzing' });

      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.UPDATE)!;
      const response = await handler({}, {
        storeContext,
        input: { runId: 'run_1', status: 'analyzing' },
      }) as UpdateRunResponse;

      expect(response.success).toBe(true);
      expect(service.updateStage).toHaveBeenCalledWith({
        storeContext,
        runId: 'run_1',
        status: 'analyzing',
        recommendationsCount: undefined,
        blockedReason: undefined,
        completedAt: undefined,
      });
    });

    it('returns error when service throws', async () => {
      service.completeRun.mockImplementation(() => {
        throw new AnalysisRunsServiceError('RUN_NOT_FOUND', 'RUN_NOT_FOUND', 'run_1');
      });

      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.UPDATE)!;
      const response = await handler({}, {
        storeContext,
        input: { runId: 'run_1', status: 'completed' },
      }) as UpdateRunResponse;

      expect(response.success).toBe(false);
    });
  });

  describe('QUERY handler', () => {
    it('returns success with run when found in same store', async () => {
      service.getRun.mockReturnValue(mockRun);

      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.QUERY)!;
      const response = await handler({}, {
        storeContext,
        input: { runId: 'run_1' },
      }) as QueryRunResponse;

      expect(response.success).toBe(true);
      expect(response.run).toEqual(mockRun);
    });

    it('returns success with null when run not found', async () => {
      service.getRun.mockReturnValue(null);

      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.QUERY)!;
      const response = await handler({}, {
        storeContext,
        input: { runId: 'nonexistent' },
      }) as QueryRunResponse;

      expect(response.success).toBe(true);
      expect(response.run).toBeNull();
    });

    it('returns error when service throws STORE_MISMATCH', async () => {
      service.getRun.mockImplementation(() => {
        throw new AnalysisRunsServiceError('different store', 'STORE_MISMATCH', 'run_1');
      });

      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.QUERY)!;
      const response = await handler({}, {
        storeContext,
        input: { runId: 'run_1' },
      }) as QueryRunResponse;

      expect(response.success).toBe(false);
    });

    it('returns error when service throws generic error', async () => {
      service.getRun.mockImplementation(() => { throw new Error('DB read failed'); });

      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.QUERY)!;
      const response = await handler({}, {
        storeContext,
        input: { runId: 'run_1' },
      }) as QueryRunResponse;

      expect(response.success).toBe(false);
    });
  });

  describe('LIST handler', () => {
    it('returns success with runs array', async () => {
      const runs = [mockRun, { ...mockRun, runId: 'run_2' }];
      service.listRuns.mockReturnValue(runs);

      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.LIST)!;
      const response = await handler({}, {
        storeContext,
        input: {},
      }) as ListRunsResponse;

      expect(response.success).toBe(true);
      expect(response.runs).toHaveLength(2);
      expect(service.listRuns).toHaveBeenCalledWith({
        storeContext,
        missionId: undefined,
        status: undefined,
        limit: undefined,
      });
    });

    it('returns empty array when no runs exist', async () => {
      service.listRuns.mockReturnValue([]);

      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.LIST)!;
      const response = await handler({}, {
        storeContext,
        input: {},
      }) as ListRunsResponse;

      expect(response.success).toBe(true);
      expect(response.runs).toEqual([]);
    });

    it('passes missionId and status filters to service', async () => {
      service.listRuns.mockReturnValue([{ ...mockRun, missionId: 'mission-1', status: 'completed' as const }]);

      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.LIST)!;
      const response = await handler({}, {
        storeContext,
        input: { missionId: 'mission-1', status: 'completed' },
      }) as ListRunsResponse;

      expect(response.success).toBe(true);
      expect(service.listRuns).toHaveBeenCalledWith({
        storeContext,
        missionId: 'mission-1',
        status: 'completed',
        limit: undefined,
      });
    });

    it('respects limit parameter', async () => {
      service.listRuns.mockReturnValue([mockRun]);

      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.LIST)!;
      await handler({}, {
        storeContext,
        input: { limit: 10 },
      });

      expect(service.listRuns).toHaveBeenCalledWith({
        storeContext,
        missionId: undefined,
        status: undefined,
        limit: 10,
      });
    });

    it('returns error when service throws', async () => {
      service.listRuns.mockImplementation(() => { throw new Error('DB error'); });

      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.LIST)!;
      const response = await handler({}, {
        storeContext,
        input: {},
      }) as ListRunsResponse;

      expect(response.success).toBe(false);
    });

    it('returns error when storeContext is missing', async () => {
      const handler = handlers.get(ANALYSIS_RUNS_CHANNELS.LIST)!;
      const response = await handler({}, {}) as ListRunsResponse;

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('SERVICE_ERROR');
    });
  });
});
