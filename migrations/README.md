# Node 数据库迁移

迁移文件命名为 `YYYYMMDDHHMMSS_description.sql`，仅允许新增，禁止修改或重命名已经执行的文件。`scripts/node-migrate.mjs` 会把 SHA-256 写入 `_node_migrations` 并在发现历史文件漂移时失败关闭。

```bash
node scripts/node-migrate.mjs status
node scripts/node-migrate.mjs dry-run
node scripts/node-migrate.mjs up
```

连接参数来自 `DB_HOST/DB_PORT/DB_NAME/DB_WRITE_USER/DB_WRITE_PASSWORD`（用户缺省回退到 `DB_USER/DB_PASSWORD`）。`status` 与 `dry-run` 不执行迁移 SQL；首次使用会创建迁移账本表。DDL 在 MySQL 中可能隐式提交，因此迁移应尽量小、向后兼容，并在上线前备份。
