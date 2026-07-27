#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=node-ops-lib.sh
source "$SCRIPT_DIR/node-ops-lib.sh"
need curl
probe
log "健康探针通过: ${HEALTH_URL:-http://127.0.0.1:32200/health/ready}"
