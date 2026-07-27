# 备份、恢复与日志

## 备份

`scripts/node-backup.sh` 使用 `--single-transaction --quick`，生成 gzip 与 SHA-256，默认保留 14 天。备份目录必须在独立磁盘或随后同步到对象存储，并定期在隔离库做恢复演练。MyISAM 表不受一致性快照保证。

```bash
set -a; source /opt/qujianma-node/shared/app.env; set +a
BACKUP_DIR=/var/backups/qujianma-node scripts/node-backup.sh
```

## 恢复

先停止所有写入者，创建当前数据库的额外备份，在隔离实例验证文件与业务数据。恢复脚本要求双重确认且不会重启服务：

```bash
CONFIRM_RESTORE=RESTORE scripts/node-restore.sh /path/backup.sql.gz
node scripts/node-migrate.mjs status
scripts/node-health-probe.sh
```

恢复后验证核心记录数、首尾样本、API readiness 与 Worker 实际任务结果。不要因探针绿色就认为数据完整。

## 日志

systemd 模板输出 journald：`journalctl -u qujianma-node-api -u qujianma-node-worker --since today`。通过 `/etc/systemd/journald.conf` 统一限制容量。只有改为文件日志时才安装 `deploy/node/logrotate-qujianma-node`，安装前运行 `logrotate -d`；模板使用 `copytruncate`，避免发送错误信号。
