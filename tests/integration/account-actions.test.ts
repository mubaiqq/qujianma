import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { describe, expect, it, vi } from 'vitest';
import { registerAccountRoutes } from '../../src/modules/account/routes.js';
import type { AccountService } from '../../src/modules/account/service.js';
import { createAuthContext } from '../../src/platform/auth-context.js';

const token = 'active-token';
const repository = {
  findByTokenHash: vi.fn().mockResolvedValue({ id: 9, username: 'alice', expiresAt: new Date('2027-01-01T00:00:00Z') }),
  renew: vi.fn().mockResolvedValue(true),
};

async function build(service: Pick<AccountService, 'login' | 'register' | 'logout' | 'changePassword'>) {
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  const auth = createAuthContext({ repository, now: () => new Date('2026-07-25T00:00:00Z') });
  registerAccountRoutes(app, { service, auth });
  return { app, auth };
}

describe('account authenticated actions', () => {
  it('omits absent legacy login fields instead of passing explicit undefined values', async () => {
    const service = {
      login: vi.fn().mockResolvedValue({ status: 422, body: { code: 1, message: '请填写用户名和密码' } }),
      register: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
    };
    const { app } = await build(service);
    const response = await app.inject({ method: 'POST', url: '/api/account', payload: { action: 'login' } });
    expect(response.statusCode).toBe(422);
    expect(service.login).toHaveBeenCalledWith({}, { isLoggedIn: false });
    await app.close();
  });

  it('logs out only the current token and clears the cookie', async () => {
    const service = { login: vi.fn(), register: vi.fn(), changePassword: vi.fn(), logout: vi.fn().mockResolvedValue({ status: 200, body: { code: 0, message: '已退出登录' }, clearLogin: true }) };
    const { app, auth } = await build(service);
    const response = await app.inject({ method: 'POST', url: '/api/account', headers: { cookie: `pickup_login=${token}`, 'x-csrf-token': auth.csrf(token) }, payload: { action: 'logout' } });
    expect(response.statusCode).toBe(200);
    expect(service.logout).toHaveBeenCalledWith(9, token);
    expect(response.headers['set-cookie']).toContain('pickup_login=;');
    await app.close();
  });

  it('requires authentication and CSRF for password changes', async () => {
    const service = { login: vi.fn(), register: vi.fn(), logout: vi.fn(), changePassword: vi.fn().mockResolvedValue({ status: 200, body: { code: 0, message: '密码修改成功，所有设备已退出登录', data: { logged_out: true } }, clearLogin: true }) };
    const { app, auth } = await build(service);
    const denied = await app.inject({ method: 'POST', url: '/api/account', payload: { action: 'change_password' } });
    expect(denied.statusCode).toBe(401);
    const response = await app.inject({ method: 'POST', url: '/api/account', headers: { cookie: `pickup_login=${token}`, 'x-csrf-token': auth.csrf(token) }, payload: { action: 'change_password', old_password: 'old-password', new_password: 'new-password', confirm_password: 'new-password' } });
    expect(response.statusCode).toBe(200);
    expect(service.changePassword).toHaveBeenCalledWith({ oldPassword: 'old-password', newPassword: 'new-password', confirmPassword: 'new-password' }, { userId: 9 });
    await app.close();
  });
});
