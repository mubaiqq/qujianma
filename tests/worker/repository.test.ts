import { describe, expect, it, vi } from 'vitest';
import { MysqlNotificationWorkerRepository } from '../../src/worker/repository.js';

describe('MysqlNotificationWorkerRepository advisory lock', () => {
  it('does not depend on MySQL timezone tables for Asia/Shanghai reminders', async () => {
    const pool = { execute: vi.fn().mockResolvedValue([[], []]), getConnection: vi.fn() };
    const repository = new MysqlNotificationWorkerRepository(pool);
    await repository.eligibleDaily(new Date('2026-07-27T05:10:00.000Z'));
    const sql = String(pool.execute.mock.calls[0]?.[0]);
    expect(sql).toContain("CONVERT_TZ(?, '+00:00', '+08:00')");
    expect(sql).not.toContain('np.timezone');
  });

  it('holds GET_LOCK and RELEASE_LOCK on the same dedicated connection', async () => {
    const connection = { execute: vi.fn().mockResolvedValueOnce([[{ acquired: 1 }], []]).mockResolvedValueOnce([[], []]), release: vi.fn() };
    const pool = { execute: vi.fn(), getConnection: vi.fn().mockResolvedValue(connection) };
    const repository = new MysqlNotificationWorkerRepository(pool);

    await expect(repository.acquireLock('worker', 0)).resolves.toBe(true);
    await repository.releaseLock('worker');

    expect(connection.execute).toHaveBeenNthCalledWith(1, 'SELECT GET_LOCK(?,?) acquired', ['worker', 0]);
    expect(connection.execute).toHaveBeenNthCalledWith(2, 'SELECT RELEASE_LOCK(?)', ['worker']);
    expect(connection.release).toHaveBeenCalledOnce();
    expect(pool.execute).not.toHaveBeenCalled();
  });

  it('releases the dedicated connection when the lock is unavailable', async () => {
    const connection = { execute: vi.fn().mockResolvedValue([[{ acquired: 0 }], []]), release: vi.fn() };
    const repository = new MysqlNotificationWorkerRepository({ execute: vi.fn(), getConnection: vi.fn().mockResolvedValue(connection) });
    await expect(repository.acquireLock('worker', 0)).resolves.toBe(false);
    expect(connection.release).toHaveBeenCalledOnce();
  });
});
