import { describe, expect, it, vi } from 'vitest';
import { runWorkerLoop } from '../../src/worker/runtime.js';

describe('runWorkerLoop', () => {
  it('runs immediately, schedules sequentially, and stops without another cycle', async () => {
    const stop = new AbortController();
    const run = vi.fn().mockResolvedValue({ status: 'succeeded' });
    const sleep = vi.fn(() => {
      stop.abort();
      return Promise.resolve();
    });

    await runWorkerLoop(run, { intervalMs: 15_000, signal: stop.signal, sleep });

    expect(run).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(15_000, stop.signal);
  });

  it('does not hide an unexpected cycle exception', async () => {
    await expect(runWorkerLoop(vi.fn().mockRejectedValue(new Error('database down')), {
      intervalMs: 15_000,
      signal: new AbortController().signal,
      sleep: vi.fn(),
    })).rejects.toThrow('database down');
  });
});
