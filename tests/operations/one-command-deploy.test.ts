import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

describe('bare-metal one-command deployment contract', () => {
  it('publishes one copy-paste command for the qujianma repository', () => {
    const readme = read('README.md');
    expect(readme).toContain('curl -fsSL https://raw.githubusercontent.com/mubaiqq/qujianma/main/install.sh | sudo bash');
  });

  it('installs Node 22, clones the repository, builds, and enables systemd idempotently', () => {
    const script = read('install.sh');
    expect(script).toContain('https://github.com/mubaiqq/qujianma.git');
    expect(script).toContain('setup_22.x');
    expect(script).toContain('npm ci');
    expect(script).toContain('npm run build');
    expect(script).toContain('systemctl enable --now qujianma-node-api.service');
    expect(script).toContain('git -C "$SOURCE_DIR" fetch origin');
    expect(script).toContain('git -C "$SOURCE_DIR" reset --hard "origin/$REF"');
  });

  it('starts the browser installer before database credentials exist', () => {
    const api = read('deploy/node/systemd/qujianma-node-api.service');
    expect(api).toContain('EnvironmentFile=-/opt/qujianma-node/shared/app.env');
    expect(api).toContain('dist/entrypoint.js');
  });

  it('asks for database and administrator settings in bare-metal installer mode', () => {
    const installer = read('src/installer.ts');
    const html = read('views/install.html');
    expect(installer).toContain("INSTALL_MANAGED_DB === 'true'");
    expect(installer).toContain('{{DATABASE_FIELDS}}');
    expect(html).toContain('{{DATABASE_FIELDS}}');
    expect(html).toContain('管理员用户名');
  });
});
