import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { SessionRecord, SessionRepository } from './domain.js';

export interface SessionSqlPool {
  execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
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

interface SessionRow extends RowDataPacket {
  id: number;
  username: string;
  expires_at: Date | string;
}

function parseShanghaiDateTime(value: Date | string): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return null;
  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour) - 8, Number(minute), Number(second),
  ));
  return formatShanghaiDateTime(parsed) === value ? parsed : null;
}

export class MysqlSessionRepository implements SessionRepository {
  constructor(
    private readonly pool: SessionSqlPool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const [result] = await this.pool.execute(
      'SELECT u.id, u.username, t.expires_at FROM login_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.expires_at > ? LIMIT 1',
      [tokenHash, formatShanghaiDateTime(this.now())],
    );
    const row = (result as SessionRow[])[0];
    if (row === undefined) return null;
    const expiresAt = parseShanghaiDateTime(row.expires_at);
    return expiresAt === null ? null : { id: row.id, username: row.username, expiresAt };
  }

  async renew(tokenHash: string, expiresAt: Date, usedAt: Date): Promise<boolean> {
    const [result] = await this.pool.execute(
      'UPDATE login_tokens SET expires_at = ?, last_used_at = ? WHERE token_hash = ? AND expires_at > ?',
      [formatShanghaiDateTime(expiresAt), formatShanghaiDateTime(usedAt), tokenHash, formatShanghaiDateTime(usedAt)],
    );
    return (result as ResultSetHeader).affectedRows === 1;
  }
}
