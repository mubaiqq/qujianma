import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = 1,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof AppError) {
    void reply.status(error.statusCode).send({ code: error.code, message: error.message });
    return;
  }
  request.log.error({ err: error }, 'request failed');
  void reply.status(500).send({ code: 1, message: '服务器内部错误' });
}
