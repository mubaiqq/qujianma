#!/bin/sh
set -eu
ENV_FILE="${INSTALL_DATA_ROOT:-/opt/qujianma-node/shared}/app.env"
while [ ! -s "$ENV_FILE" ]; do sleep 2; done
set -a
. "$ENV_FILE"
set +a
exec "$@"
