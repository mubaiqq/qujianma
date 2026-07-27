#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"; source "$SCRIPT_DIR/node-ops-lib.sh"
need node; need npm; need curl
APP_ROOT="${APP_ROOT:-/opt/qujianma-node}"; SOURCE_DIR="${SOURCE_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"; SERVICE_USER="${SERVICE_USER:-qujianma}"
[[ -f "$SOURCE_DIR/package-lock.json" ]] || die "源码目录无效: $SOURCE_DIR"
install -d -m 0750 "$APP_ROOT/releases" "$APP_ROOT/shared" "$APP_ROOT/backups"
if [[ ! -f "$APP_ROOT/shared/app.env" ]]; then
  install -m 0640 "$SOURCE_DIR/deploy/node/app.env.example" "$APP_ROOT/shared/app.env"
  die "已创建 $APP_ROOT/shared/app.env，请填写真实配置后重新运行"
fi
release="$APP_ROOT/releases/$(date '+%Y%m%d%H%M%S')"
mkdir -p "$release"; trap '[[ -L "$APP_ROOT/current" ]] || rm -rf "$release"' EXIT
( cd "$SOURCE_DIR" && tar --exclude=.git --exclude=node_modules --exclude=dist -cf - . ) | tar -xf - -C "$release"
ln -sfn "$APP_ROOT/shared/app.env" "$release/.env"
cd "$release"; run_npm_ci; npm run build; node scripts/node-migrate.mjs status
ln -sfn "$release" "$APP_ROOT/current"
log "首次部署已准备: $release"
log "本脚本未修改 systemd/Nginx；请审阅 deploy/node/systemd 后手工安装，再执行 node-migrate.mjs up"
