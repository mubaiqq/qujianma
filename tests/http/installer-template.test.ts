import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

describe('first-run installer contract', () => {
  it('renders database fields dynamically while keeping administrator fields in the template', () => {
    const html = read('views/install.html');
    const installer = read('src/installer.ts');

    expect(html).toContain('{{DATABASE_FIELDS}}');
    expect(installer).toContain('name="db_host"');
    expect(installer).toContain('name="db_password"');
    expect(html).toContain('name="username"');
    expect(html).toContain('name="password"');
    expect(html).toContain('name="confirm_password"');
  });


  it('keeps native dialogs out and shows button success before redirecting', () => {
    const html = read('views/install.html');

    expect(html).not.toMatch(/\b(?:alert|prompt|confirm)\s*\(/);
    expect(html).toMatch(/btn\.classList\.add\('success'\)/);
    expect(html).toMatch(/btn\.textContent='✓ 安装成功'/);
    expect(html).toMatch(/setTimeout\(\(\)=>location\.href='\/login',1200\)/);
  });

  it('supports HTTP and HTTPS installs and generates Web Push credentials on first install', () => {
    const installer = read('src/installer.ts');
    expect(installer).toContain("['http:', 'https:']");
    expect(installer).toContain("request.headers['x-forwarded-proto']");
    expect(installer).toContain('generateVapidKeys()');
    expect(installer).toContain("envLine('VAPID_PUBLIC_KEY'");
    expect(installer).toContain("envLine('VAPID_PRIVATE_KEY'");
  });
});
