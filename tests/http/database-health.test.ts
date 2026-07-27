import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/platform/config.js';
import type { DatabaseReadiness } from '../../src/platform/database.js';

const config: AppConfig = {
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 32200, LOG_LEVEL: 'silent', TZ: 'Asia/Shanghai',
  APP_VERSION: '0.1.0-test', APP_BASE_URL: 'https://pickup-next.mubaiyun.xyz',
  DB_HOST: '127.0.0.1', DB_PORT: 3306, DB_NAME: 'express_pickup', DB_USER: 'test', DB_PASSWORD: '',
  COOKIE_NAME: 'pickup_login', WORKER_ENABLED: false, WORKER_HEARTBEAT_SECONDS: 15,
};

const readyDatabase: DatabaseReadiness = {
  connected: true,
  timeZone: '+08:00',
  characterSet: 'utf8mb4',
  tables: [],
  missingTables: [],
  writePrivileges: [],
};

describe('database-aware readiness', () => {
  it('reports database ready while worker remains pending migration', async () => {
    const app = buildApp({ config, databaseReadiness: () => Promise.resolve(readyDatabase) });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'degraded', database: 'ready_read_only', worker: 'pending_migration' });
    await app.close();
  });

  it('returns 503 without leaking database errors when readiness fails', async () => {
    const app = buildApp({ config, databaseReadiness: () => Promise.reject(new Error('password=do-not-leak')) });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'unavailable', service: 'qujianma-node-api', version: '0.1.0-test', database: 'unavailable', worker: 'pending_migration',
    });
    expect(response.body).not.toContain('do-not-leak');
    await app.close();
  });
});
