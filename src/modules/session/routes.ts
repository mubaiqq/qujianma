import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { csrfForCookie } from '../../platform/legacy-crypto.js';
import { authenticateSession, type SessionRepository } from './domain.js';

const YEAR_IN_SECONDS = 365 * 24 * 60 * 60;

export interface SessionRouteOptions {
  repository: SessionRepository;
  cookieName?: string;
  now?: () => Date;
  cookieRegistered?: boolean;
}

const secureCookie = {
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'lax' as const,
};

export function registerSessionRoutes(app: FastifyInstance, options: SessionRouteOptions): void {
  if (!options.cookieRegistered) void app.register(fastifyCookie);
  const cookieName = options.cookieName ?? 'pickup_login';
  const now = options.now ?? (() => new Date());

  app.get('/api/session', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const originalCookie = request.cookies[cookieName];
    const result = await authenticateSession(originalCookie, options.repository, now());
    if (result.authenticated === false) {
      if (result.clearCookie) reply.clearCookie(cookieName, secureCookie);
      return reply.status(401).send({ code: 1, message: '请先登录' });
    }

    reply.setCookie(cookieName, result.token, { ...secureCookie, maxAge: YEAR_IN_SECONDS });
    return {
      code: 0,
      data: {
        user: result.user,
        csrf: csrfForCookie(originalCookie ?? result.token),
      },
    };
  });
}
