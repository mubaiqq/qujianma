#!/usr/bin/env bash
set -Eeuo pipefail
umask 027
log(){ printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die(){ log "错误: $*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"; }
retry(){ local max="${RETRY_MAX:-4}" delay="${RETRY_DELAY:-2}" n=1; until "$@"; do (( n >= max )) && return 1; log "第 $n 次失败，${delay}s 后重试: $*"; sleep "$delay"; n=$((n+1)); delay=$((delay*2)); done; }
run_npm_ci(){
  local registry="${NPM_REGISTRY:-https://registry.npmmirror.com}";
  if ! retry npm ci --include=dev --registry="$registry" --fetch-timeout="${NPM_TIMEOUT_MS:-120000}" --fetch-retries=3; then
    log "镜像失败，回退 npm 官方源"; retry npm ci --include=dev --registry=https://registry.npmjs.org --fetch-timeout="${NPM_TIMEOUT_MS:-120000}" --fetch-retries=3;
  fi
}
probe(){ retry curl -4fsS --connect-timeout "${PROBE_CONNECT_TIMEOUT:-3}" --max-time "${PROBE_TIMEOUT:-10}" "${HEALTH_URL:-http://127.0.0.1:32200/health/ready}" >/dev/null; }
