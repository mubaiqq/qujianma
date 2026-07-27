import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthContext } from '../../platform/auth-context.js';
import type { AccountResult, AccountService } from './service.js';

const YEAR_IN_SECONDS = 365 * 24 * 60 * 60;
const secureCookie = { path: '/', secure: true, httpOnly: true, sameSite: 'lax' as const };
type AccountMethods = Pick<AccountService, 'login' | 'register'> & Partial<Pick<AccountService, 'logout' | 'changePassword'>>;
export type AccountSessionResolver = (request: FastifyRequest) => Promise<boolean>;
export interface AccountRouteOptions { service: AccountMethods; auth?: AuthContext; resolveSession?: AccountSessionResolver; cookieName?: string }
type RequestBody = Record<string, unknown>;

const failure = (message: string) => ({ code: 1 as const, message });
function legacyBody(body: unknown): RequestBody | null {
  if (body === undefined || body === null) return {};
  if (typeof body === 'string') {
    if (body === '') return {};
    try { const parsed: unknown = JSON.parse(body); return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as RequestBody : {}; }
    catch { return null; }
  }
  return typeof body === 'object' && !Array.isArray(body) ? body as RequestBody : {};
}
const optionalString = (body: RequestBody, key: string): string | undefined => typeof body[key] === 'string' ? body[key] : undefined;
function sendResult(reply: FastifyReply, result: AccountResult & { clearLogin?: boolean }, cookieName: string) {
  if (result.loginToken !== undefined && result.status === 200 && result.body.code === 0) reply.setCookie(cookieName, result.loginToken, { ...secureCookie, maxAge: YEAR_IN_SECONDS });
  if (result.clearLogin) reply.clearCookie(cookieName, secureCookie);
  return reply.status(result.status).send(result.body);
}

function install(app: FastifyInstance, options: AccountRouteOptions): void {
  const cookieName = options.cookieName ?? 'pickup_login';
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) => { done(null, body); });
  app.all('/api/account', { errorHandler: (_error, _request, reply) => { void reply.header('Cache-Control', 'no-store').status(400).send(failure('JSON格式错误')); } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.method !== 'POST') return reply.status(405).send(failure('仅支持POST'));
    const body = legacyBody(request.body);
    if (body === null) return reply.status(400).send(failure('JSON格式错误'));
    const action = optionalString(body, 'action') ?? '';
    if (!['login', 'register', 'logout', 'change_password'].includes(action)) return reply.status(400).send(failure('未知操作'));
    try {
      if (action === 'login' || action === 'register') {
        const authenticated = options.auth ? await options.auth.authenticate(request, reply) : null;
        const isLoggedIn = authenticated !== null || await (options.resolveSession?.(request) ?? Promise.resolve(false));
        const username = optionalString(body, 'username');
        const password = optionalString(body, 'password');
        const confirmPassword = optionalString(body, 'confirm_password');
        const result = action === 'login'
          ? await options.service.login({ ...(username === undefined ? {} : { username }), ...(password === undefined ? {} : { password }) }, { isLoggedIn })
          : await options.service.register({
            ...(username === undefined ? {} : { username }),
            ...(password === undefined ? {} : { password }),
            ...(confirmPassword === undefined ? {} : { confirmPassword }),
          }, { isLoggedIn });
        return sendResult(reply, result, cookieName);
      }
      if (!options.auth) return reply.status(400).send(failure('未知操作'));
      const context = await options.auth.require(request, reply);
      if (context === null) return reply;
      if (!options.auth.requireCsrf(request, reply, context)) return reply;
      if (action === 'logout' && options.service.logout) return sendResult(reply, await options.service.logout(context.user.id, context.token), cookieName);
      if (action === 'change_password' && options.service.changePassword) {
        const oldPassword = optionalString(body, 'old_password');
        const newPassword = optionalString(body, 'new_password');
        const confirmPassword = optionalString(body, 'confirm_password');
        return sendResult(reply, await options.service.changePassword({
          ...(oldPassword === undefined ? {} : { oldPassword }),
          ...(newPassword === undefined ? {} : { newPassword }),
          ...(confirmPassword === undefined ? {} : { confirmPassword }),
        }, { userId: context.user.id }), cookieName);
      }
      return reply.status(400).send(failure('未知操作'));
    } catch {
      const message = action === 'register' ? '注册失败，请稍后重试' : action === 'login' ? '登录失败，请稍后重试' : '操作失败，请稍后重试';
      return reply.status(500).send(failure(message));
    }
  });
}

export function registerAccountRoutes(app: FastifyInstance, options: AccountRouteOptions): void {
  void app.register(async (routes) => {
    if (!options.auth) await routes.register(fastifyCookie);
    install(routes, options);
  });
}
