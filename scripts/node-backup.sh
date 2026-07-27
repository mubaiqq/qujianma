#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"; source "$SCRIPT_DIR/node-ops-lib.sh"
need mysqldump; need gzip
: "${DB_NAME:?缺少 DB_NAME}"; : "${DB_WRITE_USER:=${DB_USER:-}}"; : "${DB_WRITE_USER:?缺少数据库用户}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/qujianma-node}"; mkdir -p "$BACKUP_DIR"
stamp="$(date '+%Y%m%d-%H%M%S')"; out="$BACKUP_DIR/${DB_NAME}-${stamp}.sql.gz"; tmp="$out.tmp"
trap 'rm -f "$tmp"' EXIT
MYSQL_PWD="${DB_WRITE_PASSWORD:-${DB_PASSWORD:-}}" mysqldump --single-transaction --quick --routines --triggers --set-gtid-purged=OFF --host="${DB_HOST:-127.0.0.1}" --port="${DB_PORT:-3306}" --user="$DB_WRITE_USER" "$DB_NAME" | gzip -9 >"$tmp"
test -s "$tmp" || die '备份文件为空'; mv "$tmp" "$out"; sha256sum "$out" >"$out.sha256"; chmod 640 "$out" "$out.sha256"
find "$BACKUP_DIR" -type f \( -name '*.sql.gz' -o -name '*.sql.gz.sha256' \) -mtime "+${BACKUP_RETENTION_DAYS:-14}" -delete
printf '%s\n' "$out"
