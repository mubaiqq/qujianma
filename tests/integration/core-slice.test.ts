import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { describe, expect, it, vi } from 'vitest';
import { createAuthContext } from '../../src/platform/auth-context.js';
import { registerParcelsRoutes } from '../../src/modules/parcels/routes.js';
import { registerStationsRoutes } from '../../src/modules/stations/routes.js';
import type { SessionRepository } from '../../src/modules/session/domain.js';

const now = new Date('2026-07-25T12:00:00.000Z');
const cookie = 'session-token';
const user = { id: 7, username: 'alice' };

function sessionRepository(): SessionRepository {
  return {
    findByTokenHash: vi.fn().mockResolvedValue({ ...user, expiresAt: new Date('2026-07-26T12:00:00.000Z') }),
    renew: vi.fn().mockResolvedValue(true),
  };
}

async function appWithAuth() {
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  const auth = createAuthContext({ repository: sessionRepository(), cookieName: 'pickup_login', now: () => now });
  return { app, auth };
}

describe('core Node vertical slice routes', () => {
  it('protects parcel reads and preserves legacy GET data contract', async () => {
    const { app, auth } = await appWithAuth();
    const parcels = { getHome: vi.fn().mockResolvedValue({ items: [{ id: 1 }], unparsed_count: 0 }), getRecords: vi.fn(), markPicked: vi.fn().mockResolvedValue({ code: 0, message: '已取件' }), undoPicked: vi.fn(), deleteRecord: vi.fn() };
    registerParcelsRoutes(app, { repository: parcels, auth });
    expect((await app.inject({ url: '/api/parcels' })).statusCode).toBe(401);
    const response = await app.inject({ url: '/api/parcels', headers: { cookie: `pickup_login=${cookie}` } });
    expect(response.json()).toEqual({ code: 0, data: { items: [{ id: 1 }], unparsed_count: 0 } });
    expect(parcels.getHome).toHaveBeenCalledWith(7);
    await app.close();
  });

  it('requires a matching cookie-derived CSRF token for parcel writes', async () => {
    const { app, auth } = await appWithAuth();
    const parcels = { getHome: vi.fn(), getRecords: vi.fn(), markPicked: vi.fn().mockResolvedValue({ code: 0, message: '已取件' }), undoPicked: vi.fn(), deleteRecord: vi.fn() };
    registerParcelsRoutes(app, { repository: parcels, auth });
    const denied = await app.inject({ method: 'POST', url: '/api/parcels', headers: { cookie: `pickup_login=${cookie}` }, payload: { action: 'mark_picked', id: 1 } });
    expect(denied.statusCode).toBe(403);
    const csrf = auth.csrf(cookie);
    const response = await app.inject({ method: 'POST', url: '/api/parcels', headers: { cookie: `pickup_login=${cookie}`, 'x-csrf-token': csrf }, payload: { action: 'mark_picked', id: 1 } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ code: 0, message: '已取件' });
    expect(parcels.markPicked).toHaveBeenCalledWith(1, 7);
    await app.close();
  });

  it('accepts deleting a history card through the authenticated parcel route', async () => {
    const { app, auth } = await appWithAuth();
    const parcels = { getHome: vi.fn(), getRecords: vi.fn(), markPicked: vi.fn(), undoPicked: vi.fn(), deleteRecord: vi.fn().mockResolvedValue({ code: 0, message: '已删除' }) };
    registerParcelsRoutes(app, { repository: parcels, auth });
    const response = await app.inject({ method: 'POST', url: '/api/parcels', headers: { cookie: `pickup_login=${cookie}`, 'x-csrf-token': auth.csrf(cookie) }, payload: { action: 'delete_record', id: 12, message_id: 33 } });
    expect(response.statusCode).toBe(200);
    expect(parcels.deleteRecord).toHaveBeenCalledWith(12, 33, 7);
    await app.close();
  });

  it('mounts both station endpoints with authenticated user scoping', async () => {
    const { app, auth } = await appWithAuth();
    const service = { list: vi.fn().mockResolvedValue({ status: 200, body: { code: 0, data: [] } }), save: vi.fn(), delete: vi.fn(), markAllPicked: vi.fn().mockResolvedValue({ status: 200, body: { code: 0, message: '已全部取出', data: { station: 'A', count: 2 } } }) };
    registerStationsRoutes(app, { service, auth });
    const list = await app.inject({ url: '/api/stations/mine', headers: { cookie: `pickup_login=${cookie}` } });
    expect(list.statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(7);
    const marked = await app.inject({ method: 'POST', url: '/api/stations', headers: { cookie: `pickup_login=${cookie}`, 'x-csrf-token': auth.csrf(cookie) }, payload: { action: 'mark_all_picked', station_id: 3 } });
    expect(marked.statusCode).toBe(200);
    expect(service.markAllPicked).toHaveBeenCalledWith(7, 3);
    await app.close();
  });

  it('omits absent optional station fields while preserving the legacy default id', async () => {
    const { app, auth } = await appWithAuth();
    const service = {
      list: vi.fn(),
      save: vi.fn().mockResolvedValue({ status: 422, body: { code: 1, message: '请填写驿站名称和地址' } }),
      delete: vi.fn(),
      markAllPicked: vi.fn(),
    };
    registerStationsRoutes(app, { service, auth });
    const response = await app.inject({
      method: 'POST',
      url: '/api/stations/mine',
      headers: { cookie: `pickup_login=${cookie}`, 'x-csrf-token': auth.csrf(cookie) },
      payload: { action: 'save' },
    });
    expect(response.statusCode).toBe(422);
    expect(service.save).toHaveBeenCalledWith(7, { id: 0 });
    await app.close();
  });
});
