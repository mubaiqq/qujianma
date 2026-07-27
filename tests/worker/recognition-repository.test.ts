import { describe, expect, it, vi } from 'vitest';
import { MysqlRecognitionWorkerRepository } from '../../src/worker/recognition-repository.js';

describe('recognition worker retry SQL', () => {
  it('uses a short fixed 12-second retry delay and exposes the timeout waiting state', async () => {
    const connection = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
    const pool = { execute: vi.fn(), getConnection: vi.fn().mockResolvedValue(connection) };
    await new MysqlRecognitionWorkerRepository(pool).fail(19, 262, '请求超时（60000ms）', true, 'provider_transient');
    const jobSql = String(connection.execute.mock.calls[0]?.[0]); const messageSql = String(connection.execute.mock.calls[1]?.[0]);
    expect(jobSql).toContain('INTERVAL 12 SECOND'); expect(jobSql).not.toContain('POW('); expect(messageSql).toContain("'AI超时，等待重试'");
    expect(connection.execute.mock.calls[1]?.[1]).toEqual(['pending', 1, '请求超时（60000ms）', 262]);
  });
});
