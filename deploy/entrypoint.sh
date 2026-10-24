#!/bin/sh
# Volumes (Fly.io, fresh Docker volumes) are often mounted owned by root, which
# hides the image's /data permissions. When started as root, hand /data to the
# bun user and drop privileges; when started as another user, run as-is.
set -e
if [ "$(id -u)" = "0" ]; then
  chown -R bun:bun "${DATA_DIR:-/data}"
  exec setpriv --reuid=bun --regid=bun --init-groups "$@"
fi
exec "$@"
