#!/bin/sh
# Local Postgres 17 + pgvector cluster inside the repo (.pgdata), port 54317.
# Production runs Postgres in Docker Compose; this is for development only.
set -e
export LC_ALL=en_US.UTF-8
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$DIR/.pgdata"
PORT=54317

case "$1" in
  init)
    if [ -d "$DATA" ]; then echo "already initialised: $DATA"; exit 0; fi
    "$PG_BIN/initdb" -D "$DATA" -E UTF8 --locale=en_US.UTF-8 -A trust -U "$(whoami)" >/dev/null
    "$PG_BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA/server.log" -w start
    "$PG_BIN/createdb" -h localhost -p $PORT polyradar
    echo "ready: postgres://localhost:$PORT/polyradar"
    ;;
  start)
    "$PG_BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA/server.log" -w start
    ;;
  stop)
    "$PG_BIN/pg_ctl" -D "$DATA" -w stop
    ;;
  *)
    echo "usage: pg.sh init|start|stop"; exit 1
    ;;
esac
