import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AccountService } from '../../../src/modules/account/service.js';
import { registerAccountRoutes, type AccountSessionResolver } from '../../../src/modules/account/routes.js';

const yearInSeconds = 365 * 24 * 60 * 60;

type AccountMethods = Pick<AccountService, 'login' | 'register'>;

function buildAccountApp(
  service: AccountMethods,
  resolveSession: AccountSessionResolver = vi.fn().mockResolvedValue(false),
  cookieSecure = true,
) {
  const app = Fastify({ logger: false });
  registerAccountRoutes(app, { service, resolveSession, cookieSecure });
  return app;
}

function service(overrides: Partial<AccountMethods> = {}): AccountMethods {
  return {
    login: vi.fn().mockResolvedValue({ status: 200, body: { code: 0, message: '登录成功' }, loginToken: 'login-token' }),
    register: vi.fn().mockResolvedValue({ status: 200, body: { code: 0, message: '注册成功' }, loginToken: 'register-token' }),
    ...overrides,
  };
}

describe('POST /api/account contract', () => {
  it('allows a persistent login cookie on an explicitly configured HTTP deployment', async () => {
    const app = buildAccountApp(service(), vi.fn().mockResolvedValue(false), false);
    const response = await app.inject({ method: 'POST', url: '/api/account', payload: { action: 'login', username: 'alice', password: 'password' } });
    expect(response.headers['set-cookie']).toContain('pickup_login=login-token');
    expect(response.headers['set-cookie']).not.toContain('Secure');
    await app.close();
  });

  it('rejects non-POST methods with the exact legacy response', async () => {
    const account = service();
    const app = buildAccountApp(account);

    const response = await app.inject({ method: 'GET', url: '/api/account' });

    expect(response.statusCode).toBe(405);
    expect(response.json()).toEqual({ code: 1, message: '仅支持POST' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(vi.mocked(account.login)).not.toHaveBeenCalled();
    await app.close();
  });

  it('passes login input and injected session state to the account service', async () => {
    const account = service();
    const resolveSession = vi.fn().mockResolvedValue(true);
    const app = buildAccountApp(account, resolveSession);

    const response = await app.inject({
      method: 'POST', url: '/api/account',
      payload: { action: 'login', username: ' alice ', password: 'secret' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ code: 0, message: '登录成功' });
    expect(resolveSession).toHaveBeenCalledOnce();
    expect(vi.mocked(account.login)).toHaveBeenCalledWith(
      { username: ' alice ', password: 'secret' }, { isLoggedIn: true },
    );
    await app.close();
  });

  it('maps confirm_password and preserves the service registration response', async () => {
    const account = service({
      register: vi.fn().mockResolvedValue({ status: 409, body: { code: 1, message: '该用户名已被注册' } }),
    });
    const app = buildAccountApp(account);

    const response = await app.inject({
      method: 'POST', url: '/api/account',
      payload: { action: 'register', username: 'alice', password: 'password', confirm_password: 'password' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 1, message: '该用户名已被注册' });
    expect(vi.mocked(account.register)).toHaveBeenCalledWith(
      { username: 'alice', password: 'password', confirmPassword: 'password' }, { isLoggedIn: false },
    );
    await app.close();
  });

  it.each([
    ['login', 'login-token', '登录成功'],
    ['register', 'register-token', '注册成功'],
  ] as const)('sets a secure 365-day login cookie after successful %s', async (action, token, message) => {
    const app = buildAccountApp(service());

    const response = await app.inject({
      method: 'POST', url: '/api/account',
      payload: { action, username: 'alice', password: 'password', confirm_password: 'password' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ code: 0, message });
    expect(response.headers['set-cookie']).toContain(`pickup_login=${token}`);
    expect(response.headers['set-cookie']).toContain(`Max-Age=${yearInSeconds}`);
    expect(response.headers['set-cookie']).toContain('Path=/');
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('Secure');
    expect(response.headers['set-cookie']).toContain('SameSite=Lax');
    await app.close();
  });

  it('does not set a cookie when success has no newly issued token', async () => {
    const account = service({
      login: vi.fn().mockResolvedValue({ status: 200, body: { code: 0, message: '已经登录' } }),
    });
    const app = buildAccountApp(account, vi.fn().mockResolvedValue(true));

    const response = await app.inject({ method: 'POST', url: '/api/account', payload: { action: 'login' } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ code: 0, message: '已经登录' });
    expect(response.headers['set-cookie']).toBeUndefined();
    await app.close();
  });

  it('returns the exact unknown-action response without calling the account service', async () => {
    const account = service();
    const app = buildAccountApp(account);

    const response = await app.inject({ method: 'POST', url: '/api/account', payload: { action: 'logout' } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: 1, message: '未知操作' });
    expect(vi.mocked(account.login)).not.toHaveBeenCalled();
    expect(vi.mocked(account.register)).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns a stable non-leaking 500 when login service execution throws', async () => {
    const secret = 'synthetic SQL credentials and host';
    const account = service({ login: vi.fn().mockRejectedValue(new Error(secret)) });
    const app = buildAccountApp(account);

    const response = await app.inject({
      method: 'POST', url: '/api/account', payload: { action: 'login', username: 'alice', password: 'password' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 1, message: '登录失败，请稍后重试' });
    expect(response.body).not.toContain(secret);
    expect(response.headers['set-cookie']).toBeUndefined();
    await app.close();
  });
});

describe('legacy request_json compatibility', () => {
  it.each(['text/plain', 'application/octet-stream'])('parses valid JSON even when Content-Type is %s', async (contentType) => {
    const account = service();
    const app = buildAccountApp(account);

    const response = await app.inject({
      method: 'POST', url: '/api/account', headers: { 'content-type': contentType },
      payload: JSON.stringify({ action: 'login', username: 'plain-user', password: 'plain-password' }),
    });

    expect(response.statusCode).toBe(200);
    expect(vi.mocked(account.login)).toHaveBeenCalledWith(
      { username: 'plain-user', password: 'plain-password' }, { isLoggedIn: false },
    );
    await app.close();
  });

  it.each(['text/plain', 'application/json'])('returns exact JSON error for malformed %s input', async (contentType) => {
    const account = service();
    const app = buildAccountApp(account);

    const response = await app.inject({
      method: 'POST', url: '/api/account', headers: { 'content-type': contentType }, payload: '{bad json',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: 1, message: 'JSON格式错误' });
    expect(vi.mocked(account.login)).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ['', undefined],
    ['null', 'application/json'],
    ['"login"', 'application/json'],
    ['[]', 'application/json'],
  ])('treats empty or non-object JSON body %j as an empty request', async (payload, contentType) => {
    const account = service();
    const app = buildAccountApp(account);

    const response = await app.inject({
      method: 'POST', url: '/api/account',
      ...(contentType === undefined ? {} : { headers: { 'content-type': contentType } }), payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: 1, message: '未知操作' });
    await app.close();
  });
});
