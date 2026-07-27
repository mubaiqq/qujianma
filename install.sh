#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${REPO_URL:-https://github.com/mubaiqq/qujianma.git}"
REF="${REF:-main}"
APP_ROOT="${APP_ROOT:-/opt/qujianma-node}"
SOURCE_DIR="$APP_ROOT/source"
SHARED_DIR="$APP_ROOT/shared"
PORT="${PORT:-38765}"

log() { printf '\n[取件助手] %s\n' "$*"; }
die() { log "错误：$*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "请使用 sudo bash 运行"
command -v apt-get >/dev/null 2>&1 || die "当前仅支持 Ubuntu/Debian"

export DEBIAN_FRONTEND=noninteractive
log "安装系统依赖"
apt-get update -y
apt-get install -y ca-certificates curl git
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(`.`)[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! id qujianma >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_ROOT" --shell /usr/sbin/nologin qujianma
fi
install -d -o qujianma -g qujianma -m 0750 "$APP_ROOT" "$SHARED_DIR" "$SHARED_DIR/recognition-uploads"

if [[ -d "$SOURCE_DIR/.git" ]]; then
  log "更新现有源码"
  git -C "$SOURCE_DIR" remote set-url origin "$REPO_URL"
  git -C "$SOURCE_DIR" fetch origin "$REF" --depth=1
  git -C "$SOURCE_DIR" reset --hard "origin/$REF"
  git -C "$SOURCE_DIR" clean -fdx
else
  log "下载源码"
  rm -rf "$SOURCE_DIR"
  git -c http.version=HTTP/1.1 clone --depth=1 --branch "$REF" "$REPO_URL" "$SOURCE_DIR"
fi

log "安装依赖并构建"
cd "$SOURCE_DIR"
npm ci --include=dev --registry="${NPM_REGISTRY:-https://registry.npmmirror.com}" || npm ci --include=dev --registry=https://registry.npmjs.org
npm run build
ln -sfn "$SOURCE_DIR" "$APP_ROOT/current"
chown -R qujianma:qujianma "$SOURCE_DIR" "$SHARED_DIR"

log "安装 systemd 服务"
install -m 0644 deploy/node/systemd/qujianma-node-api.service /etc/systemd/system/qujianma-node-api.service
install -m 0644 deploy/node/systemd/qujianma-node-worker.service /etc/systemd/system/qujianma-node-worker.service
install -m 0644 deploy/node/systemd/qujianma-node-recognition-worker.service /etc/systemd/system/qujianma-node-recognition-worker.service
systemctl daemon-reload
systemctl enable --now qujianma-node-api.service qujianma-node-worker.service qujianma-node-recognition-worker.service

for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$PORT/" >/dev/null && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/" >/dev/null || { journalctl -u qujianma-node-api.service -n 60 --no-pager; die "服务未能正常启动"; }

IP="$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
log "部署完成"
printf '请打开：http://%s:%s\n' "${IP:-服务器IP}" "$PORT"
printf '首次打开填写 MySQL 数据库和管理员账号。安装完成后 API 会自动重启。\n'
printf '如需反向代理，目标地址为：http://127.0.0.1:%s\n' "$PORT"
