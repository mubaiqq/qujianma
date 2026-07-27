import type { ResultSetHeader } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { MysqlSessionRepository } from '../../../src/modules/session/repository.js';

const lookupNow = new Date('2026-07-25T12:34:56.000Z');
const renewedUntil = new Date('2027-07-25T12:34:56.000Z');

function poolMock() {
  return { execute: vi.fn() };
}

function result(affectedRows: number): ResultSetHeader {
  return { affectedRows } as ResultSetHeader;
}

describe('MysqlSessionRepository SQL contract', () => {
  it('finds a user only by matching hash and unexpired Shanghai DATETIME', async () => {
    const pool = poolMock();
    pool.execute.mockResolvedValue([[
      { id: 42, username: 'alice', expires_at: new Date('2026-07-26T12:00:00.000Z') },
    ], []]);
    const repository = new MysqlSessionRepository(pool, () => lookupNow);

    await expect(repository.findByTokenHash('token-hash')).resolves.toEqual({
      id: 42, username: 'alice', expiresAt: new Date('2026-07-26T12:00:00.000Z'),
    });
    expect(pool.execute).toHaveBeenCalledWith(
      'SELECT u.id, u.username, t.expires_at FROM login_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.expires_at > ? LIMIT 1',
      ['token-hash', '2026-07-25 20:34:56'],
    );
  });

  it('converts a mysql2 string DATETIME to a valid Date', async () => {
    const pool = poolMock();
    pool.execute.mockResolvedValue([[
      { id: 42, username: 'alice', expires_at: '2026-07-26 20:00:00' },
    ], []]);

    await expect(new MysqlSessionRepository(pool, () => lookupNow).findByTokenHash('token-hash')).resolves.toEqual({
      id: 42, username: 'alice', expiresAt: new Date('2026-07-26T12:00:00.000Z'),
    });
  });

  it('rejects a session whose DATETIME value is invalid', async () => {
    const pool = poolMock();
    pool.execute.mockResolvedValue([[
      { id: 42, username: 'alice', expires_at: 'not-a-datetime' },
    ], []]);

    await expect(new MysqlSessionRepository(pool, () => lookupNow).findByTokenHash('token-hash')).resolves.toBeNull();
  });

  it('returns null when no valid session matches', async () => {
    const pool = poolMock();
    pool.execute.mockResolvedValue([[], []]);
    await expect(new MysqlSessionRepository(pool, () => lookupNow).findByTokenHash('expired-hash')).resolves.toBeNull();
  });

  it('renews atomically only while the token is still valid', async () => {
    const pool = poolMock();
    pool.execute.mockResolvedValue([result(1), []]);
    const repository = new MysqlSessionRepository(pool);

    await expect(repository.renew('token-hash', renewedUntil, lookupNow)).resolves.toBe(true);
    expect(pool.execute).toHaveBeenCalledWith(
      'UPDATE login_tokens SET expires_at = ?, last_used_at = ? WHERE token_hash = ? AND expires_at > ?',
      ['2027-07-25 20:34:56', '2026-07-25 20:34:56', 'token-hash', '2026-07-25 20:34:56'],
    );
  });

  it('reports failed renewal when expiry won the race', async () => {
    const pool = poolMock();
    pool.execute.mockResolvedValue([result(0), []]);
    await expect(new MysqlSessionRepository(pool).renew('token-hash', renewedUntil, lookupNow)).resolves.toBe(false);
  });
});
