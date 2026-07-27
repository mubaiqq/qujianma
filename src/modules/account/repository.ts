import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { UsernameConflictError, type AccountRepository, type AccountTransaction, type ApiTokenRecord } from './service.js';

const loginLifetimeMs = 365 * 24 * 60 * 60 * 1000;

export interface SqlExecutor {
  execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
}

export interface TransactionConnection extends SqlExecutor {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

export interface TransactionPool extends SqlExecutor {
  getConnection(): Promise<TransactionConnection>;
}

function formatShanghaiDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}:${value('second')}`;
}

function isDuplicateEntry(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'ER_DUP_ENTRY';
}

interface AccountUserRow extends RowDataPacket {
  id: number;
  password_hash: string;
}

export class MysqlAccountRepository implements AccountRepository {
  constructor(
    private readonly pool: TransactionPool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async findUserByUsername(username: string) {
    const [result] = await this.pool.execute(
      'SELECT id, password_hash FROM users WHERE username = ? LIMIT 1',
      [username],
    );
    const row = (result as AccountUserRow[])[0];
    return row === undefined ? null : { id: row.id, passwordHash: row.password_hash };
  }

  async findUserById(userId: number) {
    const [result] = await this.pool.execute(
      'SELECT id, password_hash FROM users WHERE id = ? LIMIT 1', [userId],
    );
    const row = (result as AccountUserRow[])[0];
    return row === undefined ? null : { id: row.id, passwordHash: row.password_hash };
  }

  async deleteLoginToken(userId: number, tokenHash: string): Promise<void> {
    await this.pool.execute('DELETE FROM login_tokens WHERE user_id = ? AND token_hash = ?', [userId, tokenHash]);
  }

  async transaction<T>(work: (transaction: AccountTransaction) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const transaction = this.createTransaction(connection);
      const result = await work(transaction);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  private createTransaction(connection: TransactionConnection): AccountTransaction {
    const timestamp = this.now();
    const now = formatShanghaiDateTime(timestamp);
    return {
      createUser: async (username: string, passwordHash: string): Promise<number> => {
        try {
          const [result] = await connection.execute(
            'INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)',
            [username, passwordHash, now, now],
          );
          return (result as ResultSetHeader).insertId;
        } catch (error) {
          if (isDuplicateEntry(error)) throw new UsernameConflictError();
          throw error;
        }
      },
      createApiToken: async (record: ApiTokenRecord): Promise<void> => {
        await connection.execute(
          'INSERT INTO api_tokens (user_id, name, token_hash, token_ciphertext, token_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [record.userId, record.name, record.tokenHash, record.tokenCiphertext, record.tokenPrefix, now],
        );
      },
      createLoginToken: async (userId: number, tokenHash: string): Promise<void> => {
        const expiresAt = formatShanghaiDateTime(new Date(timestamp.getTime() + loginLifetimeMs));
        await connection.execute(
          'INSERT INTO login_tokens (user_id, token_hash, expires_at, last_used_at, created_at) VALUES (?, ?, ?, ?, ?)',
          [userId, tokenHash, expiresAt, now, now],
        );
      },
      updatePassword: async (userId: number, passwordHash: string): Promise<void> => {
        await connection.execute('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [passwordHash, now, userId]);
      },
      deleteLoginTokens: async (userId: number): Promise<void> => {
        await connection.execute('DELETE FROM login_tokens WHERE user_id = ?', [userId]);
      },
    };
  }
}
