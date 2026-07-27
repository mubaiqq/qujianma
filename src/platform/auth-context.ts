import '@fastify/cookie';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { csrfForCookie } from './legacy-crypto.js';
import { authenticateSession, type SessionRepository, type SessionUser } from '../modules/session/domain.js';

const YEAR_IN_SECONDS = 365 * 24 * 60 * 60;
const cookieOptions = { path: '/', secure: true, httpOnly: true, sameSite: 'lax' as const };

export interface AuthenticatedContext { user: SessionUser; token: string }
export interface AuthContext {
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<AuthenticatedContext | null>;
  require(request: FastifyRequest, reply: FastifyReply): Promise<AuthenticatedContext | null>;
  requireCsrf(request: FastifyRequest, reply: FastifyReply, context: AuthenticatedContext): boolean;
  csrf(token: string): string;
  clear(reply: FastifyReply): void;
}

export function createAuthContext(options: { repository: SessionRepository; cookieName?: string; now?: () => Date }): AuthContext {
  const cookieName = options.cookieName ?? 'pickup_login';
  const now = options.now ?? (() => new Date());
  const authenticate = async (request: FastifyRequest, reply: FastifyReply): Promise<AuthenticatedContext | null> => {
    const result = await authenticateSession(request.cookies[cookieName], options.repository, now());
    if (result.authenticated === false) {
      if (result.clearCookie) reply.clearCookie(cookieName, cookieOptions);
      return null;
    }
    reply.setCookie(cookieName, result.token, { ...cookieOptions, maxAge: YEAR_IN_SECONDS });
    return { user: result.user, token: result.token };
  };
  return {
    authenticate,
    async require(request, reply) {
      const context = await authenticate(request, reply);
      if (context === null) void reply.status(401).send({ code: 1, message: '请先登录' });
      return context;
    },
    requireCsrf(request, reply, context) {
      const supplied = request.headers['x-csrf-token'];
      const expected = csrfForCookie(context.token);
      const valid = typeof supplied === 'string' && supplied.length === expected.length
        && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
      if (!valid) void reply.status(403).send({ code: 1, message: 'CSRF验证失败' });
      return valid;
    },
    csrf: csrfForCookie,
    clear(reply) { reply.clearCookie(cookieName, cookieOptions); },
  };
}
