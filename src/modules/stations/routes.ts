import type { FastifyInstance } from 'fastify';
import type { AuthContext } from '../../platform/auth-context.js';
import type { StationsService } from './domain.js';

type StationMethods = Pick<StationsService, 'list' | 'save' | 'delete' | 'markAllPicked'>;
export interface StationsRouteOptions { service: StationMethods; auth: AuthContext }

function bodyObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const integer = (value: unknown): number => {
  if (typeof value === 'number') return Math.trunc(value);
  if (typeof value === 'string') return Number.parseInt(value, 10);
  return 0;
};
const optionalString = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;

export function registerStationsRoutes(app: FastifyInstance, options: StationsRouteOptions): void {
  app.all('/api/stations/mine', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await options.auth.require(request, reply);
    if (context === null) return reply;
    if (request.method === 'GET') {
      const result = await options.service.list(context.user.id);
      return reply.status(result.status).send(result.body);
    }
    if (request.method !== 'POST') return reply.status(405).send({ code: 1, message: '仅支持GET或POST' });
    if (!options.auth.requireCsrf(request, reply, context)) return reply;
    const body = bodyObject(request.body);
    let result;
    if (body.action === 'save') {
      const name = optionalString(body.name);
      const address = optionalString(body.address);
      const courierNames = optionalString(body.courier_names);
      result = await options.service.save(context.user.id, {
        id: integer(body.id),
        ...(name === undefined ? {} : { name }),
        ...(address === undefined ? {} : { address }),
        ...(courierNames === undefined ? {} : { courier_names: courierNames }),
      });
    } else if (body.action === 'delete') result = await options.service.delete(context.user.id, integer(body.id));
    else return reply.status(400).send({ code: 1, message: '未知操作' });
    return reply.status(result.status).send(result.body);
  });

  app.all('/api/stations', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await options.auth.require(request, reply);
    if (context === null) return reply;
    if (request.method !== 'POST') return reply.status(405).send({ code: 1, message: '仅支持POST' });
    if (!options.auth.requireCsrf(request, reply, context)) return reply;
    const body = bodyObject(request.body);
    if (body.action !== 'mark_all_picked') return reply.status(400).send({ code: 1, message: '未知操作' });
    const result = await options.service.markAllPicked(context.user.id, integer(body.station_id));
    return reply.status(result.status).send(result.body);
  });
}
