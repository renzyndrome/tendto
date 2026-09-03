#!/usr/bin/env bash
# Restore a TendTo backup into a NAMED database. See docs/backup-restore.md.
#
#   scripts/restore.sh <dump-file> <target-db> [--replace]
#
# The target is always explicit, and restoring over the database in DATABASE_URL — your live
# data — is refused outright. This is deliberate: the API test suite once pointed at the dev
# database and destroyed real local content, and a restore is the one operation in this repo
# that can do that damage in a single keystroke. Practise restores go to a scratch database;
# a genuine recovery is a rename, done by hand and with your eyes open.
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:?usage: scripts/restore.sh <dump-file> <target-db> [--replace]}"
TARGET="${2:?usage: scripts/restore.sh <dump-file> <target-db> [--replace]}"
REPLACE="${3:-}"

[ -f "$FILE" ] || { echo "✖ no such dump file: $FILE" >&2; exit 1; }

# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a

RAW_URL="${DATABASE_URL:?DATABASE_URL is not set (check .env)}"
URL="${RAW_URL/+asyncpg/}"
IN_CONTAINER_URL="$(printf '%s' "$URL" | sed -E 's#@(localhost|127\.0\.0\.1):[0-9]+/#@db:5432/#')"
LIVE_DB="${IN_CONTAINER_URL##*/}"
LIVE_DB="${LIVE_DB%%\?*}"
ADMIN_URL="${IN_CONTAINER_URL%/*}/postgres"

if [ "$TARGET" = "$LIVE_DB" ]; then
  cat >&2 <<EOF
✖ refusing to restore over "$LIVE_DB" — that is the database DATABASE_URL points at.

  Restore to a scratch name instead:
      scripts/restore.sh $FILE ${LIVE_DB}_restore_check

  To actually recover live data, restore to a scratch name, check it, then swap by hand:
      docker compose exec -T db psql "$ADMIN_URL" -c 'ALTER DATABASE $LIVE_DB RENAME TO ${LIVE_DB}_old'
      docker compose exec -T db psql "$ADMIN_URL" -c 'ALTER DATABASE ${LIVE_DB}_restore_check RENAME TO $LIVE_DB'
  Stop the API, auth and PowerSync first: a rename needs no other session connected.
EOF
  exit 1
fi

psql_admin() { docker compose exec -T db psql -v ON_ERROR_STOP=1 -q "$ADMIN_URL" "$@"; }

EXISTS="$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '$TARGET'" || true)"
if [ "$EXISTS" = "1" ]; then
  if [ "$REPLACE" != "--replace" ]; then
    echo "✖ database \"$TARGET\" already exists. Pass --replace to drop and recreate it." >&2
    exit 1
  fi
  echo "▶ dropping existing $TARGET"
  psql_admin -c "DROP DATABASE \"$TARGET\" WITH (FORCE)"
fi

echo "▶ creating $TARGET"
psql_admin -c "CREATE DATABASE \"$TARGET\""

echo "▶ restoring $FILE → $TARGET"
TARGET_URL="${IN_CONTAINER_URL%/*}/$TARGET"
# Copy the archive in rather than piping it: the custom format needs random access, and a pipe
# cannot seek. Restoring through one silently limits pg_restore to a single forward pass.
CONTAINER_FILE="/tmp/tendto-restore-$$.dump"
docker compose cp "$FILE" "db:$CONTAINER_FILE"
cleanup() { docker compose exec -T db rm -f "$CONTAINER_FILE" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# --exit-on-error: a restore that reports success while having skipped failing objects is the
# trap this whole drill exists to catch.
docker compose exec -T db pg_restore --no-owner --no-privileges --exit-on-error \
  -d "$TARGET_URL" "$CONTAINER_FILE"

ROWS="$(docker compose exec -T db psql -tAq "$TARGET_URL" -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
echo "✓ restored into \"$TARGET\" ($(echo "$ROWS" | tr -d '[:space:]') tables in public)"
echo "  inspect it:  docker compose exec db psql $TARGET_URL"
echo
echo "  ! If you are going to SERVE this database, reset PowerSync's bucket storage first."
echo "    It remembers a replication slot that exists only on the old database, so it will"
echo "    report \"Initial replication already done\" and then replicate nothing at all —"
echo "    while the app still signs in and searches normally. See docs/backup-restore.md."
