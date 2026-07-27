import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/platform/config.js';

const config: AppConfig = {
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 32200, LOG_LEVEL: 'silent', TZ: 'Asia/Shanghai',
  APP_VERSION: '0.1.0-test', APP_BASE_URL: 'https://pickup-next.mubaiyun.xyz',
  DB_HOST: '127.0.0.1', DB_PORT: 3306, DB_NAME: 'express_pickup', DB_USER: 'test', DB_PASSWORD: '',
  COOKIE_NAME: 'pickup_login', WORKER_ENABLED: false, WORKER_HEARTBEAT_SECONDS: 15,
};

describe('legacy version endpoint contract', () => {
  it('returns the current PHP version fields and strict no-cache headers', async () => {
    const app = buildApp({ config });
    const response = await app.inject({ method: 'GET', url: '/api/version' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      code: 0,
      version: '2026.07.26.1',
      asset_version: '20260725-android-release-page-1',
    });
    expect(response.headers['cache-control']).toBe('no-store, no-cache, must-revalidate, max-age=0');
    expect(response.headers.pragma).toBe('no-cache');
    await app.close();
  });

  it('rejects unsupported methods like the PHP endpoint', async () => {
    const app = buildApp({ config });
    const response = await app.inject({ method: 'POST', url: '/api/version' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 1, message: '接口不存在' });
    await app.close();
  });
});
