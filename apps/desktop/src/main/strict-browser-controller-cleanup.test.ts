import { describe, expect, it, vi } from 'vitest';
import { StrictBrowserControllerCleanup } from './strict-browser-controller-cleanup';

function controller(input: {
  close: () => Promise<void>;
  page?: unknown | null;
  context?: unknown | null;
}) {
  return {
    close: vi.fn(input.close),
    getPage: vi.fn(() => input.page ?? null),
    getContext: vi.fn(() => input.context ?? null),
  };
}

describe('StrictBrowserControllerCleanup', () => {
  it('forgets a controller only after close resolves with no residue', async () => {
    const cleanup = new StrictBrowserControllerCleanup();
    const target = controller({ close: async () => undefined });

    cleanup.retain([target]);
    await expect(cleanup.closeRetained()).resolves.toBeUndefined();

    expect(target.close).toHaveBeenCalledOnce();
    expect(cleanup.hasRetainedControllers()).toBe(false);
  });

  it('retains a rejected controller and retries the same handle', async () => {
    const cleanup = new StrictBrowserControllerCleanup();
    const target = controller({
      close: vi.fn()
        .mockRejectedValueOnce(new Error('close failed'))
        .mockResolvedValueOnce(undefined),
    });

    cleanup.retain([target]);
    await expect(cleanup.closeRetained()).rejects.toThrow(
      'pending browser controllers did not close strictly',
    );
    expect(cleanup.retainedCount()).toBe(1);

    await expect(cleanup.closeRetained()).resolves.toBeUndefined();
    expect(target.close).toHaveBeenCalledTimes(2);
    expect(cleanup.retainedCount()).toBe(0);
  });

  it('retains a controller whose close resolves but leaves page residue', async () => {
    let page: unknown | null = {};
    const cleanup = new StrictBrowserControllerCleanup();
    const target = {
      close: vi.fn(async () => undefined),
      getPage: vi.fn(() => page),
      getContext: vi.fn(() => null),
    };

    cleanup.retain([target]);
    await expect(cleanup.closeRetained()).rejects.toThrow(
      'pending browser controllers did not close strictly',
    );
    expect(cleanup.retainedCount()).toBe(1);

    page = null;
    await expect(cleanup.closeRetained()).resolves.toBeUndefined();
    expect(target.close).toHaveBeenCalledTimes(2);
    expect(cleanup.retainedCount()).toBe(0);
  });
});
