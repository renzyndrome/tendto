#!/usr/bin/env bash
# Set the release version in every file that carries one, then print the tag command.
#
# There are FIVE copies and nothing keeps them together. The one that decides what users see is
# tauri.conf.json: the installer is named from it, so a stale value there ships "TendTo 0.1.0"
# forever while the tag says otherwise.
set -euo pipefail

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: scripts/bump-version.sh <x.y.z>" >&2
  exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# npm writes the version and nothing else; --no-git-tag-version because the tag is made below,
# once, for the whole repo rather than per package.
for app in web desktop auth; do
  (cd "apps/$app" && npm version "$version" --no-git-tag-version --allow-same-version >/dev/null)
  echo "  apps/$app/package.json        → $version"
done

conf="apps/desktop/src-tauri/tauri.conf.json"
python3 - "$conf" "$version" <<'PY'
import json, sys
path, version = sys.argv[1], sys.argv[2]
with open(path) as handle:
    config = json.load(handle)
config["version"] = version
with open(path, "w") as handle:
    json.dump(config, handle, indent=2)
    handle.write("\n")
PY
echo "  $conf → $version"

cargo="apps/desktop/src-tauri/Cargo.toml"
# Only the first `version =` — the one in [package]. Dependency versions must not move.
python3 - "$cargo" "$version" <<'PY'
import re, sys
path, version = sys.argv[1], sys.argv[2]
text = open(path).read()
text, count = re.subn(r'^version = "[^"]+"', f'version = "{version}"', text, count=1, flags=re.M)
if count != 1:
    raise SystemExit(f"could not find the package version in {path}")
open(path, "w").write(text)
PY
echo "  $cargo   → $version"

# Keeps Cargo.lock in step so the build does not rewrite it and dirty the tree.
(cd apps/desktop/src-tauri && cargo update --workspace --offline >/dev/null 2>&1) || true

cat <<EOF

Now check the diff, commit, and tag:

    git add -A && git commit -m "chore: release v$version"
    git tag v$version && git push origin main --tags

The tag starts the desktop release workflow, which leaves a DRAFT release to test
before publishing. See "Releasing" in docs/desktop.md.
EOF
