/* eslint-disable @typescript-eslint/unbound-method -- repository methods are Vitest spies and are never invoked by these assertions */
import { createHash, createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { authenticateSession, type SessionRepository } from '../../../src/modules/session/domain.js';
import { registerSessionRoutes } from '../../../src/modules/session/routes.js';

const now = new Date('2026-07-25T12:00:00.000Z');
const yearInSeconds = 365 * 24 * 60 * 60;
const syntheticCookie = 'synthetic-session-token';
const syntheticUser = { id: 42, username: 'test-reviewer' };

function repository(overrides: Partial<SessionRepository> = {}): SessionRepository {
  return {
    findByTokenHash: vi.fn().mockResolvedValue({ ...syntheticUser, expiresAt: new Date('2026-07-26T12:00:00.000Z') }),
    renew: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function buildSessionApp(repo: SessionRepository, cookieSecure = true) {
  const app = Fastify({ logger: false });
  registerSessionRoutes(app, { repository: repo, now: () => now, cookieSecure });
  return app;
}

describe('session domain', () => {
  it('trims the cookie before hashing and renews a non-expired session before authenticating it', async () => {
    const repo = repository();

    const result = await authenticateSession(`  ${syntheticCookie}\t`, repo, now);

    const expectedHash = createHash('sha256').update(syntheticCookie).digest('hex');
    expect(vi.mocked(repo.findByTokenHash)).toHaveBeenCalledWith(expectedHash);
    expect(vi.mocked(repo.renew)).toHaveBeenCalledWith(expectedHash, new Date(now.getTime() + yearInSeconds * 1000), now);
    expect(result).toEqual({ authenticated: true, user: syntheticUser, token: syntheticCookie });
  });

  it('does not query for an absent or whitespace-only cookie', async () => {
    const repo = repository();
    await expect(authenticateSession(' \t ', repo, now)).resolves.toEqual({ authenticated: false, clearCookie: false });
    expect(vi.mocked(repo.findByTokenHash)).not.toHaveBeenCalled();
    expect(vi.mocked(repo.renew)).not.toHaveBeenCalled();
  });

  it('rejects and clears unknown or expired cookies without renewal', async () => {
    const unknown = repository({ findByTokenHash: vi.fn().mockResolvedValue(null) });
    const expired = repository({
      findByTokenHash: vi.fn().mockResolvedValue({ ...syntheticUser, expiresAt: new Date(now.getTime()) }),
    });

    await expect(authenticateSession(syntheticCookie, unknown, now)).resolves.toEqual({ authenticated: false, clearCookie: true });
    await expect(authenticateSession(syntheticCookie, expired, now)).resolves.toEqual({ authenticated: false, clearCookie: true });
    expect(vi.mocked(unknown.renew)).not.toHaveBeenCalled();
    expect(vi.mocked(expired.renew)).not.toHaveBeenCalled();
  });

  it('fails closed when renewal reports failure or throws', async () => {
    const rejected = repository({ renew: vi.fn().mockResolvedValue(false) });
    const failed = repository({ renew: vi.fn().mockRejectedValue(new Error('synthetic database detail')) });

    await expect(authenticateSession(syntheticCookie, rejected, now)).resolves.toEqual({ authenticated: false, clearCookie: true });
    await expect(authenticateSession(syntheticCookie, failed, now)).resolves.toEqual({ authenticated: false, clearCookie: true });
  });
});

describe('GET /api/session contract', () => {
  it('renews the cookie without Secure on an explicitly configured HTTP deployment', async () => {
    const app = buildSessionApp(repository(), false);
    const response = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: `pickup_login=${syntheticCookie}` } });
    expect(response.headers['set-cookie']).not.toContain('Secure');
    await app.close();
  });

  it('returns the exact legacy user and CSRF contract only after renewal', async () => {
    const repo = repository();
    const app = buildSessionApp(repo);
    const originalCookie = `%20${syntheticCookie}%20`;

    const response = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: `pickup_login=${originalCookie}` } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      code: 0,
      data: {
        user: syntheticUser,
        csrf: createHmac('sha256', ` ${syntheticCookie} `).update('pickup-csrf').digest('hex'),
      },
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toContain(`pickup_login=${syntheticCookie}`);
    expect(response.headers['set-cookie']).toContain(`Max-Age=${yearInSeconds}`);
    expect(response.headers['set-cookie']).toContain('Path=/');
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('Secure');
    expect(response.headers['set-cookie']).toContain('SameSite=Lax');
    await app.close();
  });

  it('returns the exact 401 contract when the cookie is missing', async () => {
    const app = buildSessionApp(repository());
    const response = await app.inject({ method: 'GET', url: '/api/session' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: 1, message: '请先登录' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toBeUndefined();
    await app.close();
  });

  it('clears an invalid cookie using the security attributes without reflecting its value', async () => {
    const secretInvalidValue = 'synthetic-invalid-cookie-secret';
    const app = buildSessionApp(repository({ findByTokenHash: vi.fn().mockResolvedValue(null) }));
    const response = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: `pickup_login=${secretInvalidValue}` } });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: 1, message: '请先登录' });
    expect(response.body).not.toContain(secretInvalidValue);
    expect(response.headers['set-cookie']).not.toContain(secretInvalidValue);
    expect(response.headers['set-cookie']).toContain('pickup_login=;');
    expect(response.headers['set-cookie']).toContain('Max-Age=0');
    expect(response.headers['set-cookie']).toContain('Path=/');
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('Secure');
    expect(response.headers['set-cookie']).toContain('SameSite=Lax');
    await app.close();
  });

  it('never returns success or leaks repository errors when renewal fails', async () => {
    const leakedDetail = 'synthetic SQL host and credential detail';
    const app = buildSessionApp(repository({ renew: vi.fn().mockRejectedValue(new Error(leakedDetail)) }));
    const response = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: `pickup_login=${syntheticCookie}` } });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: 1, message: '请先登录' });
    expect(response.body).not.toContain(leakedDetail);
    expect(response.body).not.toContain(syntheticCookie);
    await app.close();
  });
});
