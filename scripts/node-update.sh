#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"; source "$SCRIPT_DIR/node-ops-lib.sh"
need git; need node; need npm; need curl
APP_ROOT="${APP_ROOT:-/opt/qujianma-node}"; REPO_URL="${REPO_URL:-https://github.com/mubaiqq/qujianma.git}"; REF="${REF:-main}"; SERVICE_API="${SERVICE_API:-qujianma-node-api}"; SERVICE_WORKER="${SERVICE_WORKER:-qujianma-node-worker}"
[[ -f "$APP_ROOT/shared/app.env" ]] || die '共享 app.env 不存在'; old="$(readlink -f "$APP_ROOT/current" || true)"; [[ -n "$old" ]] || die 'current 发布不存在'
lock="$APP_ROOT/.update.lock"; exec 9>"$lock"; flock -n 9 || die '另一个更新正在运行'
set -a; source "$APP_ROOT/shared/app.env"; set +a
BACKUP_DIR="$APP_ROOT/backups" "$old/scripts/node-backup.sh" >/dev/null
release="$APP_ROOT/releases/$(date '+%Y%m%d%H%M%S')"; db_changed=0
rollback(){
  local rc=$?; (( rc == 0 )) && return
  log "更新失败，回滚 current 到 $old"
  ln -sfn "$old" "$APP_ROOT/current"
  if [[ "${APPLY_SYSTEMD:-0}" == 1 ]]; then sudo systemctl restart "$SERVICE_API" "$SERVICE_WORKER" || true; fi
  (( db_changed == 0 )) || log '警告: 数据库迁移可能已提交；出于数据安全不自动恢复，请按恢复手册评估备份'
  exit "$rc"
}
trap rollback EXIT
urls=()
[[ -n "${GITHUB_ACCELERATOR:-}" ]] && urls+=("${GITHUB_ACCELERATOR%/}/$REPO_URL")
urls+=("$REPO_URL")
for url in "${urls[@]}"; do
  log "尝试拉取 $url"
  if timeout "${GIT_TIMEOUT_SECONDS:-180}" git -c http.version=HTTP/1.1 clone --filter=blob:none --depth=1 --branch "$REF" "$url" "$release"; then break; fi
  rm -rf "$release"
done
[[ -d "$release/.git" ]] || die '所有 GitHub 地址均失败'
ln -sfn "$APP_ROOT/shared/app.env" "$release/.env"; cd "$release"
run_npm_ci; npm run build; node scripts/node-migrate.mjs dry-run; node scripts/node-migrate.mjs up; db_changed=1
npm test
ln -sfn "$release" "$APP_ROOT/current"
if [[ "${APPLY_SYSTEMD:-0}" == 1 ]]; then sudo systemctl restart "$SERVICE_API" "$SERVICE_WORKER"; else log 'APPLY_SYSTEMD!=1，跳过服务重启'; fi
probe
find "$APP_ROOT/releases" -mindepth 1 -maxdepth 1 -type d ! -path "$release" ! -path "$old" -mtime "+${RELEASE_RETENTION_DAYS:-14}" -exec rm -rf -- {} +
trap - EXIT; log "更新成功: $release"
