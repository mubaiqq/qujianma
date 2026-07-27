import Fastify, { type FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../../../src/platform/auth-context.js';
import { registerTokenRoutes } from '../../../src/modules/tokens/routes.js';
import { ApiTokenService } from '../../../src/modules/tokens/service.js';

const context = { user: { id: 7, username: 'alice' }, token: 'login' };
const auth = (csrf = true): AuthContext => ({
  authenticate: vi.fn(), require: vi.fn().mockResolvedValue(context),
  requireCsrf: vi.fn((_request, reply: FastifyReply) => { if (!csrf) void reply.status(403).send({ code: 1, message: 'CSRF验证失败' }); return csrf; }),
  csrf: vi.fn(), clear: vi.fn(),
});

describe('API token service and legacy route', () => {
  it('returns the newest active decrypted token and legacy ingest URL', async () => {
    const repository = { findLatestActive: vi.fn().mockResolvedValue({ id: 3, name: '我的 iPhone', tokenCiphertext: 'cipher', tokenPrefix: 'abcdef12', lastUsedAt: null, createdAt: new Date('2026-07-25T00:00:00Z') }), regenerate: vi.fn() };
    const service = new ApiTokenService(repository, { baseUrl: 'https://pickup.example/', decrypt: () => 'raw token', generate: vi.fn(), hash: vi.fn(), encrypt: vi.fn() });
    expect(await service.get(7)).toMatchObject({ id: 3, token: 'raw token', url: 'https://pickup.example/api/ingest?k=raw%20token', token_prefix: 'abcdef12' });
  });

  it('regenerates atomically and returns the exact success contract', async () => {
    const repository = { findLatestActive: vi.fn(), regenerate: vi.fn().mockResolvedValue(undefined) };
    const service = new ApiTokenService(repository, { baseUrl: 'https://pickup.example', generate: () => 'a'.repeat(48), hash: v => `hash:${v}`, encrypt: v => `enc:${v}`, decrypt: vi.fn() });
    const app = Fastify(); registerTokenRoutes(app, { auth: auth(), service });
    const response = await app.inject({ method: 'POST', url: '/api/tokens', payload: { action: 'regenerate' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ code: 0, message: 'API连接已重新生成', data: { url: `https://pickup.example/api/ingest?k=${'a'.repeat(48)}`, token: 'a'.repeat(48) } });
    expect(repository.regenerate).toHaveBeenCalledWith({ userId: 7, name: '我的 iPhone', tokenHash: `hash:${'a'.repeat(48)}`, tokenCiphertext: `enc:${'a'.repeat(48)}`, tokenPrefix: 'aaaaaaaa' });
    await app.close();
  });

  it('enforces login, CSRF, methods and action compatibility', async () => {
    const service = { get: vi.fn().mockResolvedValue(null), regenerate: vi.fn() };
    const app = Fastify(); registerTokenRoutes(app, { auth: auth(false), service });
    expect((await app.inject({ method: 'GET', url: '/api/tokens' })).json()).toEqual({ code: 0, data: null });
    expect((await app.inject({ method: 'PUT', url: '/api/tokens' })).statusCode).toBe(405);
    expect((await app.inject({ method: 'POST', url: '/api/tokens', payload: { action: 'regenerate' } })).statusCode).toBe(403);
    await app.close();
  });
});
