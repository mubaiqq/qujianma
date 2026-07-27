import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { MysqlAccountRepository } from '../../../src/modules/account/repository.js';
import { UsernameConflictError } from '../../../src/modules/account/service.js';

const now = new Date('2026-07-25T12:34:56.000Z');

type ExecuteResult = [RowDataPacket[] | ResultSetHeader, unknown];

function result(affectedRows: number, insertId = 0): ResultSetHeader {
  return { affectedRows, insertId } as ResultSetHeader;
}

function connectionMock(results: ExecuteResult[] = []) {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    execute: vi.fn().mockImplementation(() => Promise.resolve(results.shift() ?? [result(1), []])),
  };
}

function poolMock(connection = connectionMock()) {
  return {
    execute: vi.fn(),
    getConnection: vi.fn().mockResolvedValue(connection),
  };
}

describe('MysqlAccountRepository SQL contract', () => {
  it('finds the minimal account user by exact username', async () => {
    const pool = poolMock();
    pool.execute.mockResolvedValue([[{ id: 42, password_hash: 'legacy-hash' }], []]);
    const repository = new MysqlAccountRepository(pool);

    await expect(repository.findUserByUsername('alice')).resolves.toEqual({ id: 42, passwordHash: 'legacy-hash' });
    expect(pool.execute).toHaveBeenCalledWith(
      'SELECT id, password_hash FROM users WHERE username = ? LIMIT 1',
      ['alice'],
    );
  });

  it('returns null when the username does not exist', async () => {
    const pool = poolMock();
    pool.execute.mockResolvedValue([[], []]);
    await expect(new MysqlAccountRepository(pool).findUserByUsername('nobody')).resolves.toBeNull();
  });

  it('creates user, API token, and login token in one transaction with Shanghai DATETIME values', async () => {
    const connection = connectionMock([[result(1, 7), []]]);
    const pool = poolMock(connection);
    const repository = new MysqlAccountRepository(pool, () => now);

    await repository.transaction(async (transaction) => {
      const userId = await transaction.createUser('alice', 'password-hash');
      await transaction.createApiToken({
        userId, name: '我的 iPhone', tokenHash: 'api-hash', tokenCiphertext: 'ciphertext', tokenPrefix: 'prefix12',
      });
      await transaction.createLoginToken(userId, 'login-hash');
    });

    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.execute).toHaveBeenNthCalledWith(1,
      'INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ['alice', 'password-hash', '2026-07-25 20:34:56', '2026-07-25 20:34:56'],
    );
    expect(connection.execute).toHaveBeenNthCalledWith(2,
      'INSERT INTO api_tokens (user_id, name, token_hash, token_ciphertext, token_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [7, '我的 iPhone', 'api-hash', 'ciphertext', 'prefix12', '2026-07-25 20:34:56'],
    );
    expect(connection.execute).toHaveBeenNthCalledWith(3,
      'INSERT INTO login_tokens (user_id, token_hash, expires_at, last_used_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [7, 'login-hash', '2027-07-25 20:34:56', '2026-07-25 20:34:56', '2026-07-25 20:34:56'],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('rolls back, releases, and maps ER_DUP_ENTRY to UsernameConflictError', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
    const connection = connectionMock();
    connection.execute.mockRejectedValue(duplicate);
    const repository = new MysqlAccountRepository(poolMock(connection), () => now);

    await expect(repository.transaction((transaction) => transaction.createUser('alice', 'hash')))
      .rejects.toBeInstanceOf(UsernameConflictError);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('preserves non-duplicate errors and still rolls back and releases', async () => {
    const failure = new Error('write failed');
    const connection = connectionMock();
    connection.execute.mockRejectedValue(failure);
    const repository = new MysqlAccountRepository(poolMock(connection), () => now);

    await expect(repository.transaction((transaction) => transaction.createUser('alice', 'hash'))).rejects.toBe(failure);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('preserves the business error and releases when rollback also fails', async () => {
    const failure = new Error('write failed');
    const connection = connectionMock();
    connection.execute.mockRejectedValue(failure);
    connection.rollback.mockRejectedValue(new Error('rollback failed'));
    const repository = new MysqlAccountRepository(poolMock(connection), () => now);

    await expect(repository.transaction((transaction) => transaction.createUser('alice', 'hash'))).rejects.toBe(failure);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('preserves UsernameConflictError and releases when rollback also fails', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
    const connection = connectionMock();
    connection.execute.mockRejectedValue(duplicate);
    connection.rollback.mockRejectedValue(new Error('rollback failed'));
    const repository = new MysqlAccountRepository(poolMock(connection), () => now);

    await expect(repository.transaction((transaction) => transaction.createUser('alice', 'hash')))
      .rejects.toBeInstanceOf(UsernameConflictError);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });
});
