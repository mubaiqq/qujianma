#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"; source "$SCRIPT_DIR/node-ops-lib.sh"
need mysql; need gzip
file="${1:-}"; [[ -f "$file" ]] || die '用法: node-restore.sh backup.sql.gz'
[[ "${CONFIRM_RESTORE:-}" == "RESTORE" ]] || die '必须设置 CONFIRM_RESTORE=RESTORE'
: "${DB_NAME:?缺少 DB_NAME}"; : "${DB_WRITE_USER:=${DB_USER:-}}"; : "${DB_WRITE_USER:?缺少数据库用户}"
[[ ! -f "$file.sha256" ]] || (cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256")
gzip -t "$file"; log "恢复到数据库 $DB_NAME（不会自动重启服务）"
gzip -dc "$file" | MYSQL_PWD="${DB_WRITE_PASSWORD:-${DB_PASSWORD:-}}" mysql --host="${DB_HOST:-127.0.0.1}" --port="${DB_PORT:-3306}" --user="$DB_WRITE_USER" "$DB_NAME"
log '恢复完成，请运行迁移 status 与健康探针'
