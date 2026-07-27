import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/platform/config.js';

describe('loadConfig', () => {
  it('applies safe local defaults and validates port', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DB_HOST: '127.0.0.1',
      DB_NAME: 'express_pickup',
      DB_USER: 'test',
      DB_PASSWORD: 'secret',
      COOKIE_NAME: 'pickup_login',
    });
    expect(config.PORT).toBe(32200);
    expect(config.TZ).toBe('Asia/Shanghai');
  });

  it('rejects invalid configuration without leaking password', () => {
    expect(() => loadConfig({ DB_PASSWORD: 'very-secret', PORT: '70000' })).toThrow(/配置无效/);
    try { loadConfig({ DB_PASSWORD: 'very-secret', PORT: '70000' }); } catch (error) {
      expect(String(error)).not.toContain('very-secret');
    }
  });
});
