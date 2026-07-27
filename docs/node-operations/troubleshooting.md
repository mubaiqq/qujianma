# 故障排查

1. **更新卡住**：检查 `$APP_ROOT/.update.lock` 持有进程；不要删除活跃锁。查看 DNS、IPv4 出口，分别测试镜像和 GitHub；调整 `GIT_TIMEOUT_SECONDS/NPM_TIMEOUT_MS/RETRY_MAX`。
2. **API 启动失败**：`systemctl status`、`journalctl -u qujianma-node-api -n 200`，确认 Node 22、current 链接、EnvironmentFile 权限和端口。直接运行 `curl -4v --connect-timeout 3 --max-time 10 http://127.0.0.1:32200/health/ready`。
3. **readiness 非绿**：区分进程存活与数据库/schema 就绪。先 `node scripts/node-migrate.mjs status`，核对 DB 主机、授权、时区和缺表；不得通过探针自动 DDL。
4. **迁移失败**：保留日志和备份，禁止修改已执行 SQL。校验 `_node_migrations` checksum。MySQL DDL 可能已提交，先检查实际 schema，再决定向前修复或人工恢复。
5. **Worker 重复通知**：立即停新 Worker，确认旧 PHP Cron/消费者是否仍运行；任何时刻只能有一个副作用 writer。验证锁目录权限、选中记录数、发送成功/失败及持久化时间戳。
6. **更新后探针失败**：脚本应已回切旧 current；确认服务加载旧路径。若迁移已执行，旧代码须保持向后兼容，否则按备份恢复流程评估，禁止盲目恢复。
7. **Docker**：`docker compose ps`、`docker compose logs --tail=200 api worker`。外部库场景显式设置 `DB_HOST`；本地 MySQL 必须启用 `local-mysql` profile。检查容器内 DNS，而非假设 localhost 是宿主机。
8. **磁盘/日志**：检查 journald 与 release/backup 保留策略；不要删除当前和回滚 release。日志中不得打印密码、cookie、消息正文。
