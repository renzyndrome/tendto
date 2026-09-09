#!/usr/bin/env bash
# Boot the backend stack, then run the Tauri desktop shell in dev mode.
#
# Why this wrapper exists: a terminal running inside a snap-packaged editor (VS Code's snap is the
# common one) exports GTK/GLib variables that point at the snap's OWN runtime — GTK_PATH,
# GTK_EXE_PREFIX, GDK_PIXBUF_MODULE_FILE, LD_LIBRARY_PATH and friends, all under /snap. Those
# libraries are built against a different glibc, so a normally-built binary loads them and dies at
# startup with:
#
#   symbol lookup error: /snap/core20/.../libpthread.so.0: undefined symbol: __libc_pthread_init
#
# The build itself is fine — only the launch is poisoned, and only for a GUI binary. Rather than
# telling people "run it from a different terminal", the snap's entries are stripped here so
# `make desktop` works from wherever you happen to be.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Drop /snap paths out of a colon-separated variable, unsetting it if nothing is left.
strip_snap_paths() {
  local name="$1" value="${!1:-}" filtered
  [ -n "$value" ] || return 0
  filtered="$(printf '%s' "$value" | tr ':' '\n' | grep -v '^/snap/' | paste -sd: -)"
  if [ -z "$filtered" ]; then unset "$name"; else export "$name=$filtered"; fi
}

if [ -n "${SNAP:-}" ] || printf '%s' "${LD_LIBRARY_PATH:-}${GTK_PATH:-}" | grep -q '/snap/'; then
  echo "▶ snap environment detected — stripping it so the shell can start"
  # Pointers straight at the snap's runtime: no useful non-snap value, so drop them entirely.
  unset GTK_PATH GTK_EXE_PREFIX GDK_PIXBUF_MODULE_FILE GDK_PIXBUF_MODULEDIR \
        GSETTINGS_SCHEMA_DIR GIO_MODULE_DIR GIO_EXTRA_MODULES LOCPATH \
        GST_PLUGIN_PATH GST_PLUGIN_SYSTEM_PATH GST_PLUGIN_SCANNER \
        LD_LIBRARY_PATH || true
  # Mixed lists: keep the system entries, drop the snap ones.
  for var in XDG_DATA_DIRS XDG_CONFIG_DIRS PATH; do strip_snap_paths "$var"; done
  # SNAP_* only confuses child processes into thinking they are confined.
  while IFS='=' read -r name _; do unset "$name" || true; done < <(env | grep '^SNAP')
fi

bash "$repo_root/scripts/e2e-stack.sh"
cd "$repo_root/apps/desktop"
exec npm run dev
