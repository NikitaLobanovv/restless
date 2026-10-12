#!/bin/sh
# Ежедневные резервные копии PostgreSQL: pg_dump -Fc в /backups, ротация до BACKUP_KEEP файлов.
set -eu
KEEP="${BACKUP_KEEP:-7}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"

prune() {
  # оставляем KEEP самых свежих дампов
  ls -1t /backups/restless-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r f; do
    rm -f -- "$f"
  done
}

while true; do
  ts="$(date +%F-%H%M)"
  tmp="/backups/.restless-${ts}.dump.partial"
  if pg_dump -Fc -f "$tmp"; then
    mv "$tmp" "/backups/restless-${ts}.dump"
    echo "[backup] created restless-${ts}.dump"
    prune
  else
    rm -f "$tmp"
    echo "[backup] pg_dump failed" >&2
  fi
  sleep "$INTERVAL"
done
