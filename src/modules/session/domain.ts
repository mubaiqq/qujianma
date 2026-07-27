import { createHash } from 'node:crypto';

export interface SessionUser {
  id: number;
  username: string;
}

export interface SessionRecord extends SessionUser {
  expiresAt: Date;
}

export interface SessionRepository {
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  renew(tokenHash: string, expiresAt: Date, usedAt: Date): Promise<boolean>;
}

export type SessionAuthentication =
  | { authenticated: true; user: SessionUser; token: string }
  | { authenticated: false; clearCookie: boolean };

const YEAR_IN_SECONDS = 365 * 24 * 60 * 60;

export async function authenticateSession(
  cookieValue: string | undefined,
  repository: SessionRepository,
  now: Date,
): Promise<SessionAuthentication> {
  const token = (cookieValue ?? '').trim();
  if (token === '') return { authenticated: false, clearCookie: false };

  const tokenHash = createHash('sha256').update(token).digest('hex');
  try {
    const record = await repository.findByTokenHash(tokenHash);
    if (record === null || record.expiresAt.getTime() <= now.getTime()) {
      return { authenticated: false, clearCookie: true };
    }
    const expiresAt = new Date(now.getTime() + YEAR_IN_SECONDS * 1000);
    const renewed = await repository.renew(tokenHash, expiresAt, now);
    if (!renewed) return { authenticated: false, clearCookie: true };
    return { authenticated: true, user: { id: record.id, username: record.username }, token };
  } catch {
    return { authenticated: false, clearCookie: true };
  }
}
