#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import mysql from 'mysql2/promise';

const command = process.argv[2] ?? 'status';
if (!['status', 'dry-run', 'up'].includes(command)) {
  console.error('用法: node scripts/node-migrate.mjs <status|dry-run|up>');
  process.exit(2);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const directory = path.join(root, 'migrations');
const files = (await readdir(directory)).filter((name) => /^\d{14}_[a-z0-9_-]+\.sql$/i.test(name)).sort();
const migrations = await Promise.all(files.map(async (name) => {
  const sql = await readFile(path.join(directory, name), 'utf8');
  return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
}));
const user = process.env.DB_WRITE_USER ?? process.env.DB_USER;
const password = process.env.DB_WRITE_PASSWORD ?? process.env.DB_PASSWORD ?? '';
if (!user) throw new Error('缺少 DB_WRITE_USER 或 DB_USER');
const connection = await mysql.createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1', port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? 'express_pickup', user, password,
  charset: 'utf8mb4', timezone: '+08:00', multipleStatements: true,
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 10000),
});
let locked = false;
try {
  await connection.execute(`CREATE TABLE IF NOT EXISTS _node_migrations (
    name VARCHAR(255) NOT NULL PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    execution_ms INT UNSIGNED NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const [lockRows] = await connection.query("SELECT GET_LOCK('qujianma_node_migrations', 10) AS acquired");
  locked = Number(lockRows[0]?.acquired) === 1;
  if (!locked) throw new Error('无法取得数据库迁移锁');
  const [rows] = await connection.query('SELECT name, checksum, applied_at FROM _node_migrations ORDER BY name');
  const applied = new Map(rows.map((row) => [row.name, row]));
  for (const row of rows) {
    const local = migrations.find((item) => item.name === row.name);
    if (!local) throw new Error(`已执行迁移文件缺失: ${row.name}`);
    if (local.checksum !== row.checksum) throw new Error(`已执行迁移被修改: ${row.name}`);
  }
  const pending = migrations.filter((item) => !applied.has(item.name));
  if (command === 'status') {
    for (const item of migrations) console.log(`${applied.has(item.name) ? 'up     ' : 'pending'} ${item.name}`);
    console.log(`已执行 ${applied.size}，待执行 ${pending.length}`);
  } else if (command === 'dry-run') {
    if (pending.length === 0) console.log('没有待执行迁移');
    for (const item of pending) console.log(`\n-- ${item.name} sha256:${item.checksum}\n${item.sql.trim()}\n`);
  } else {
    for (const item of pending) {
      const started = Date.now();
      console.log(`执行 ${item.name}`);
      await connection.beginTransaction();
      try {
        await connection.query(item.sql);
        await connection.execute(
          'INSERT INTO _node_migrations(name, checksum, execution_ms) VALUES (?, ?, ?)',
          [item.name, item.checksum, Date.now() - started],
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
    console.log(`迁移完成，共执行 ${pending.length} 个`);
  }
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK('qujianma_node_migrations')");
  await connection.end();
}
