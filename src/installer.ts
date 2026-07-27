import Fastify from 'fastify';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as webpush from 'web-push';

const dataRoot = process.env.INSTALL_DATA_ROOT ?? '/app/data';
const envPath = resolve(dataRoot, 'app.env');
const projectRoot = resolve(import.meta.dirname, '..');
const installSqlPath = resolve(projectRoot, 'database/install.sql');
const execFileAsync = promisify(execFile);

function envLine(key: string, value: string): string {
  return `${key}=${value.replaceAll('\\', '\\\\').replaceAll('\n', '')}`;
}
function jsonError(message: string, status = 400) { return { status, body: { code: 1, message } }; }
const generateVapidKeys = () => webpush.generateVAPIDKeys();

function installBaseUrl(request: { headers: Record<string, unknown>; hostname: string }, supplied: string): string {
  const forwarded = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim().toLowerCase();
  const protocol = forwarded === 'https' ? 'https:' : 'http:';
  const value = supplied || `${protocol}//${request.hostname}`;
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('访问地址格式无效'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('访问地址仅支持 HTTP 或 HTTPS');
  return parsed.toString().replace(/\/$/, '');
}

export async function runInstaller(): Promise<void> {
  const app = Fastify({ logger: true });
  const managedDatabase = process.env.INSTALL_MANAGED_DB === 'true';
  app.get('/', async (_request, reply) => {
    const databaseFields = managedDatabase ? '<div class="database-ready"><span>✓</span><div><strong>数据库已随运行环境自动配置</strong>无需填写数据库连接信息</div></div>' : [
      '<label>数据库主机<input name="db_host" value="127.0.0.1" required></label>',
      '<label>数据库端口<input name="db_port" value="3306" inputmode="numeric" required></label>',
      '<label>数据库名<input name="db_name" value="express_pickup" required></label>',
      '<label>数据库用户名<input name="db_user" required></label>',
      '<label>数据库密码<input name="db_password" type="password" required></label>',
    ].join('');
    const introduction = managedDatabase
      ? '数据库已由运行环境配置，首次打开只需创建管理员账号。'
      : '请填写现有 MySQL 数据库和管理员信息，系统会自动创建数据表并完成初始化。';
    const template = await readFile(resolve(projectRoot, 'views/install.html'), 'utf8');
    return reply.type('text/html; charset=utf-8').send(template.replace('{{INTRODUCTION}}', introduction).replace('{{DATABASE_FIELDS}}', databaseFields));
  });
  app.get('/install', async (_request, reply) => reply.redirect('/'));
  app.post('/install/api', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const text = (key: string) => typeof body[key] === 'string' ? body[key].trim() : '';
    const allowCustomDatabase = !managedDatabase || process.env.INSTALL_ALLOW_CUSTOM_DB === 'true';
    const dbHost = allowCustomDatabase && text('db_host') ? text('db_host') : (process.env.INSTALL_DB_HOST ?? 'mysql');
    const dbPort = Number(allowCustomDatabase && text('db_port') ? text('db_port') : (process.env.INSTALL_DB_PORT ?? 3306));
    const dbName = allowCustomDatabase && text('db_name') ? text('db_name') : (process.env.INSTALL_DB_NAME ?? 'express_pickup');
    const dbUser = allowCustomDatabase && text('db_user') ? text('db_user') : (process.env.INSTALL_DB_USER ?? 'qjm');
    const dbPassword = allowCustomDatabase && typeof body.db_password === 'string'
      ? body.db_password
      : (process.env.INSTALL_DB_PASSWORD ?? '');
    const username = text('username');
    const password = typeof body.password === 'string' ? body.password : '';
    const confirm = typeof body.confirm_password === 'string' ? body.confirm_password : '';
    let baseUrl: string;
    try { baseUrl = installBaseUrl(request, text('app_base_url')); }
    catch (error) { return reply.status(422).send(jsonError(error instanceof Error ? error.message : '访问地址无效').body); }
    if (!dbUser || !dbName || !username || password.length < 8) return reply.status(422).send(jsonError('请完整填写数据库和管理员信息，并设置至少8位管理员密码').body);
    if (password !== confirm) return reply.status(422).send(jsonError('两次管理员密码不一致').body);
    if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) return reply.status(422).send(jsonError('数据库端口无效').body);
    let connection: mysql.Connection | undefined;
    try {
      connection = await mysql.createConnection({ host: dbHost, port: dbPort, user: dbUser, password: dbPassword, database: dbName, multipleStatements: true, charset: 'utf8mb4', timezone: '+08:00' });
      const sql = (await readFile(installSqlPath, 'utf8')).replace(/^CREATE DATABASE[^;]+;\s*USE [^;]+;\s*/i, '');
      await connection.query(sql);
      const hash = await bcrypt.hash(password, 12);
      await connection.execute('INSERT INTO users (username,password_hash) VALUES (?,?) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash)', [username, hash.replace('$2b$', '$2y$')]);
      const key = randomBytes(32).toString('hex');
      const vapid = generateVapidKeys();
      await mkdir(dataRoot, { recursive: true });
      const content = [
        'NODE_ENV=production', 'HOST=0.0.0.0', `PORT=${process.env.PORT ?? '38765'}`, 'LOG_LEVEL=info', 'TZ=Asia/Shanghai',
        'APP_VERSION=1.0.0', envLine('APP_BASE_URL', baseUrl), envLine('DB_HOST', dbHost), `DB_PORT=${dbPort}`, envLine('DB_NAME', dbName),
        envLine('DB_USER', dbUser), envLine('DB_PASSWORD', dbPassword), envLine('DB_WRITE_USER', dbUser), envLine('DB_WRITE_PASSWORD', dbPassword),
        'COOKIE_NAME=pickup_login', `APP_KEY_HEX=${key}`, envLine('VAPID_SUBJECT', `mailto:admin@${new URL(baseUrl).hostname}`),
        envLine('VAPID_PUBLIC_KEY', vapid.publicKey), envLine('VAPID_PRIVATE_KEY', vapid.privateKey), 'WORKER_ENABLED=true', 'WORKER_HEARTBEAT_SECONDS=15',
        'RECOGNITION_WORKER_ENABLED=true', envLine('RECOGNITION_UPLOAD_ROOT', process.env.RECOGNITION_UPLOAD_ROOT ?? resolve(dataRoot, 'recognition-uploads')), '',
      ].join('\n');
      await writeFile(envPath, content, { mode: 0o600 });
      const migrationEnv = Object.fromEntries(content.split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s, 2)));
      await execFileAsync('node', ['scripts/node-migrate.mjs', 'up'], { cwd: projectRoot, env: { ...process.env, ...migrationEnv } });
      void reply.send({ code: 0, message: '安装成功' });
      setTimeout(() => process.exit(0), 1600);
    } catch (error) {
      app.log.error({ err: error }, 'installation failed');
      return reply.status(500).send(jsonError(error instanceof Error ? `安装失败：${error.message}` : '安装失败').body);
    } finally { await connection?.end().catch(() => undefined); }
  });
  await app.listen({ host: process.env.HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 38765) });
}

export function isInstalled(): boolean { return existsSync(envPath); }
