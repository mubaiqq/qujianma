import type { FastifyInstance, FastifyRequest } from 'fastify';
/* eslint-disable @typescript-eslint/no-base-to-string */
import type { AiProviderService } from './domain.js';
export type AiUserResolver = (request: FastifyRequest) => Promise<number | null>;
export type AiCsrfVerifier = (request: FastifyRequest) => Promise<boolean>;
export interface AiRoutesOptions { service: Pick<AiProviderService, 'status' | 'list' | 'save' | 'select' | 'delete' | 'fetchModels' | 'test'>; resolveUserId: AiUserResolver; verifyCsrf: AiCsrfVerifier }
const failure = (message: string) => ({ code: 1 as const, message });
function body(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function registerAiRoutes(app: FastifyInstance, options: AiRoutesOptions): void {
  app.get('/api/ai/status', async (request, reply) => { reply.header('Cache-Control', 'no-store'); const userId = await options.resolveUserId(request); if (userId === null) return reply.status(401).send(failure('请先登录')); const result = await options.service.status(userId); return reply.status(result.status).send(result.body); });
  app.all('/api/ai/settings', async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); const userId = await options.resolveUserId(request); if (userId === null) return reply.status(401).send(failure('请先登录'));
    const input = body(request.body); const action = request.method === 'GET' ? 'list' : String(input.action ?? 'list');
    if (request.method !== 'GET' && request.method !== 'POST') return reply.status(405).send(failure('仅支持GET或POST'));
    if (request.method === 'POST' && !await options.verifyCsrf(request)) return reply.status(403).send(failure('CSRF校验失败'));
    let result;
    switch (action) { case 'list': result = await options.service.list(userId); break; case 'save': result = await options.service.save(userId, input); break; case 'select': result = await options.service.select(userId, Number(input.id ?? 0)); break; case 'delete': result = await options.service.delete(userId, Number(input.id ?? 0)); break; case 'fetch_models': result = await options.service.fetchModels(userId, input); break; case 'test': result = await options.service.test(userId, input); break; default: result = { status: 400, body: failure('未知操作') }; }
    return reply.status(result.status).send(result.body);
  });
}
