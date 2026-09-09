#!/usr/bin/env bash
# Take a full backup of the TendTo database. See docs/backup-restore.md.
#
# ONE database holds everything: app tables AND better-auth's tables (AUTH_DATABASE_URL points
# at the same database). A dump of only one half would restore content whose every user_id and
# workspace membership referred to people who no longer exist, so this always dumps the whole
# database — never a table list.
#
# The dump runs INSIDE the db container, whose client tools match the server version. The host's
# pg_dump is often a different major version, and a newer client writing an archive a matching
# pg_restore then has to read is a needless way to lose a restore.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT_DIR="${BACKUP_DIR:-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"

# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a

RAW_URL="${DATABASE_URL:?DATABASE_URL is not set (check .env)}"
# SQLAlchemy's driver suffix means nothing to libpq.
URL="${RAW_URL/+asyncpg/}"

# Inside the container, the host's mapped port does not exist — reach Postgres directly.
IN_CONTAINER_URL="$(printf '%s' "$URL" | sed -E 's#@(localhost|127\.0\.0\.1):[0-9]+/#@db:5432/#')"
DB_NAME="${IN_CONTAINER_URL##*/}"
DB_NAME="${DB_NAME%%\?*}"

mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/tendto-$STAMP.dump"

echo "▶ dumping $DB_NAME → $FILE"
# -Fc: the custom format, which pg_restore can read selectively and in parallel.
# --no-owner / --no-privileges: a restore into a differently-named role must not fail on
# GRANTs that mention a role the target does not have.
if ! docker compose exec -T db pg_dump -Fc --no-owner --no-privileges "$IN_CONTAINER_URL" >"$FILE"; then
  rm -f "$FILE"
  echo "  ✖ pg_dump failed — no backup was written" >&2
  exit 1
fi

# An empty or truncated archive is worse than no archive, because it looks like a backup.
# `pg_restore -l` parses the table of contents, so it fails loudly on a corrupt file.
#
# Read on the HOST, not through `docker exec`: a custom-format archive needs random access, and
# a pipe cannot seek — the check "failed" on a perfectly good 2 MB dump the first time it ran.
# Reading a table of contents is version-tolerant, so a newer host pg_restore is fine here even
# though the dump and the restore both use the container's matching tools.
SIZE="$(du -h "$FILE" | cut -f1)"
if command -v pg_restore >/dev/null 2>&1; then
  if ! pg_restore -l "$FILE" >/dev/null 2>&1; then
    echo "  ✖ the archive is not readable by pg_restore — treating it as a failed backup" >&2
    mv "$FILE" "$FILE.corrupt"
    exit 1
  fi
  TABLES="$(pg_restore -l "$FILE" | grep -c "TABLE DATA" || true)"
  echo "✓ backup written: $FILE ($SIZE, $TABLES tables with data)"
else
  echo "✓ backup written: $FILE ($SIZE)"
  echo "  ! no host pg_restore, so the archive was NOT verified — install postgresql-client"
fi
echo "  restore it with: make restore FILE=$FILE TARGET=tendto_restore_check"
