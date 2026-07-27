import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const read = (name: string) => readFile(path.join(root, name), 'utf8');

describe('Node 运维契约', () => {
  it('迁移 CLI 提供三种模式、校验 checksum 并使用互斥锁', async () => {
    const text = await read('scripts/node-migrate.mjs');
    expect(text).toContain("['status', 'dry-run', 'up']");
    expect(text).toContain("createHash('sha256')");
    expect(text).toContain('已执行迁移被修改');
    expect(text).toContain('GET_LOCK');
    expect(text).toContain('RELEASE_LOCK');
  });

  it('迁移文件名使用脚本可识别的14位时间戳', async () => {
    const text = await read('scripts/node-migrate.mjs');
    expect(text).toContain('^\\d{14}_');
    expect(await read('migrations/20260725000000_durable_recognition_jobs.sql')).toContain('CREATE TABLE IF NOT EXISTS recognition_jobs');
    expect(await read('migrations/20260726000000_notification_worker_runtime.sql')).toContain('CREATE TABLE IF NOT EXISTS worker_status');
  });

  it('更新严格包含备份、构建、迁移、测试、切换、重启和探针', async () => {
    const text = await read('scripts/node-update.sh');
    const ordered = ['node-backup.sh', 'run_npm_ci', 'npm run build', 'node scripts/node-migrate.mjs dry-run', 'node scripts/node-migrate.mjs up', 'npm test', 'ln -sfn "$release"', 'systemctl restart', 'probe'];
    let cursor = -1;
    for (const token of ordered) {
      const next = text.indexOf(token, cursor + 1);
      expect(next, token).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(text).toContain('ln -sfn "$old"');
    expect(text).toContain('数据库迁移可能已提交');
  });

  it('网络路径具有 IPv4、超时、重试及镜像回退', async () => {
    const [lib, update] = await Promise.all([read('scripts/node-ops-lib.sh'), read('scripts/node-update.sh')]);
    expect(lib).toContain('curl -4fsS');
    expect(lib).toContain('--connect-timeout');
    expect(lib).toContain('registry.npmmirror.com');
    expect(lib).toContain('registry.npmjs.org');
    expect(update).toContain('GITHUB_ACCELERATOR');
    expect(update).toContain('http.version=HTTP/1.1');
    expect(update).toContain('timeout "${GIT_TIMEOUT_SECONDS:-180}"');
  });

  it('systemd 分离 API/Worker 并以网页安装器启动 API', async () => {
    const [api, worker] = await Promise.all([
      read('deploy/node/systemd/qujianma-node-api.service'),
      read('deploy/node/systemd/qujianma-node-worker.service'),
    ]);
    expect(api).toContain('dist/entrypoint.js');
    expect(worker).toContain('dist/worker.js');
    expect(api).toContain('NoNewPrivileges=true');
    expect(worker).toContain('WORKER_ENABLED=true');
  });
});
