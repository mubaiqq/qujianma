import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/platform/config.js';

const testConfig: AppConfig = {
  NODE_ENV: 'test' as const,
  HOST: '127.0.0.1',
  PORT: 32200,
  LOG_LEVEL: 'silent',
  TZ: 'Asia/Shanghai',
  APP_VERSION: '0.1.0-test',
  APP_BASE_URL: 'https://pickup-next.mubaiyun.xyz',
  DB_HOST: '127.0.0.1',
  DB_PORT: 3306,
  DB_NAME: 'express_pickup',
  DB_USER: 'test',
  DB_PASSWORD: 'test',
  COOKIE_NAME: 'pickup_login',
  WORKER_ENABLED: false,
  WORKER_HEARTBEAT_SECONDS: 15,
};

describe('health endpoints', () => {
  it('reports process liveness without requiring database', async () => {
    const app = buildApp({ config: testConfig });
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'qujianma-node-api', version: '0.1.0-test' });
    await app.close();
  });

  it('returns the legacy JSON error shape for unknown routes', async () => {
    const app = buildApp({ config: testConfig });
    const response = await app.inject({ method: 'GET', url: '/missing' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 1, message: '接口不存在' });
    await app.close();
  });
});
