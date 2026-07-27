import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/platform/config.js';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

const config: AppConfig = {
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 32200, LOG_LEVEL: 'silent', TZ: 'Asia/Shanghai',
  APP_VERSION: '0.1.0-test', APP_BASE_URL: 'https://pickup-next.mubaiyun.xyz',
  DB_HOST: '127.0.0.1', DB_PORT: 3306, DB_NAME: 'express_pickup', DB_USER: 'test', DB_PASSWORD: '',
  COOKIE_NAME: 'pickup_login', WORKER_ENABLED: false, WORKER_HEARTBEAT_SECONDS: 15,
};

describe('login page migration contract', () => {
  it('keeps the legacy visual structure, fields, and asset paths in a static template', () => {
    const html = read('views/login.html');

    expect(html).toContain('<body class="login-body">');
    expect(html).toContain('<main class="login-wrap">');
    expect(html).toContain('<div class="brand-mark"><i class="fa-solid fa-box"></i></div>');
    expect(html).toContain('<h1>取件助手</h1>');
    expect(html).toContain('<div class="auth-tabs" role="tablist">');
    expect(html).toContain('<form id="loginForm" class="login-form">');
    expect(html).toMatch(/<input id="username" autocomplete="username" minlength="3" maxlength="30" required>/);
    expect(html).toMatch(/<input id="password" type="password" autocomplete="current-password" minlength="8" maxlength="72" required>/);
    expect(html).toMatch(/<input id="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="72">/);
    expect(html).toContain('<div id="loginError" class="form-error" role="alert"></div>');
    expect(html).toContain('<button id="loginButton" class="primary-button" type="submit"><span>登录</span></button>');
    expect(html).toContain('href="/favicon.ico?v=20260724-icon-1"');
    expect(html).toContain('href="/assets/icons/apple-touch-icon-v2.png?v=20260724-icon-2"');
    expect(html).toContain('href="/assets/css/app.css?v=20260723-ios26-1"');
    expect(html).toContain('src="/assets/js/login.js?v=20260723-3"');
  });

  it('uses no native dialogs and retains the existing mobile input sizing contract', () => {
    const html = read('views/login.html');
    const script = read('public/assets/js/login.js');
    const css = read('public/assets/css/app.css');

    expect(`${html}\n${script}`).not.toMatch(/\b(?:alert|prompt|confirm)\s*\(/);
    expect(css).toMatch(/\.input-wrap input\{[^}]*font-size:16px!important[^}]*}/);
  });

  it('shows success feedback before the existing delayed redirect', () => {
    const script = read('public/assets/js/login.js');

    expect(script).toMatch(
      /button\.classList\.add\('success'\);button\.querySelector\('span'\)\.textContent=register\?'注册成功':'登录成功';setTimeout\(\(\)=>location\.href='\/',700\)/,
    );
  });

  it('does not expose the template through app routes before the account API migrates', async () => {
    const app = buildApp({ config });
    for (const url of ['/login', '/login', '/views/login.html']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(404);
      expect(response.body, url).not.toContain('loginForm');
    }
    await app.close();
  });
});
