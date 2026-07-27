import type { FastifyInstance } from 'fastify';
import type { AuthContext } from '../../platform/auth-context.js';
import { ParcelStateConflictError, getRecordsQuery } from './domain.js';
import type { MysqlParcelsRepository } from './repository.js';

type ParcelsRepository = Pick<MysqlParcelsRepository, 'getHome' | 'getRecords' | 'markPicked' | 'undoPicked'> & { deleteRecord: MysqlParcelsRepository['deleteRecord'] };
export interface ParcelsRouteOptions { repository: ParcelsRepository; auth: AuthContext; now?: () => Date }

function bodyObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function registerParcelsRoutes(app: FastifyInstance, options: ParcelsRouteOptions): void {
  app.all('/api/parcels', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await options.auth.require(request, reply);
    if (context === null) return reply;
    if (request.method === 'GET') {
      const query = request.query as Record<string, unknown>;
      const data = query.view === 'records'
        ? await options.repository.getRecords(context.user.id, getRecordsQuery(query.period, query.status, options.now?.()))
        : await options.repository.getHome(context.user.id);
      return { code: 0, data };
    }
    if (request.method !== 'POST') return reply.status(405).send({ code: 1, message: '仅支持GET或POST' });
    if (!options.auth.requireCsrf(request, reply, context)) return reply;
    const body = bodyObject(request.body);
    const action = body.action;
    const id = typeof body.id === 'number'
      ? Math.trunc(body.id)
      : Number.parseInt(typeof body.id === 'string' ? body.id : '0', 10);
    const messageId = Number(body.message_id ?? 0);
    if ((action !== 'mark_picked' && action !== 'undo_picked' && action !== 'delete_record') || (action !== 'delete_record' && id < 1) || (action === 'delete_record' && messageId < 1)) {
      return reply.status(422).send({ code: 1, message: '参数错误' });
    }
    try {
      if (action === 'delete_record') return await options.repository.deleteRecord(id, messageId, context.user.id);
      return action === 'mark_picked'
        ? await options.repository.markPicked(id, context.user.id)
        : await options.repository.undoPicked(id, context.user.id);
    } catch (error) {
      if (error instanceof ParcelStateConflictError) return reply.status(404).send({ code: 1, message: error.message });
      throw error;
    }
  });
}
