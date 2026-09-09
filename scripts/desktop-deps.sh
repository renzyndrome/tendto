#!/usr/bin/env bash
# One-time system setup for building the Tauri desktop shell.
#
# Prints what is missing rather than installing it: the apt step needs root, and a Makefile
# target should never silently sudo on someone's machine.
set -uo pipefail

APT_PACKAGES=(
  libwebkit2gtk-4.1-dev   # the webview Tauri renders into
  build-essential         # cc + linker
  curl wget file          # used by the bundler
  libxdo-dev              # window/input control
  libssl-dev              # TLS for the sync connector
  libayatana-appindicator3-dev  # the tray icon
  librsvg2-dev            # icon rendering
  pkg-config              # how cargo finds all of the above
  patchelf                # required to build the AppImage
  # Not in Tauri's own list: powersync_sqlite_nostd generates its SQLite bindings with bindgen,
  # which needs libclang AND clang's builtin headers (stdarg.h). Without it the build dies with
  # a confusing "'stdarg.h' file not found" from a crate you never asked for.
  libclang-dev
)

missing=()
for package in "${APT_PACKAGES[@]}"; do
  dpkg -s "$package" >/dev/null 2>&1 || missing+=("$package")
done

echo "TendTo desktop shell — system requirements"
echo

if [ ${#missing[@]} -eq 0 ]; then
  echo "  [ok]      system libraries: all present"
else
  echo "  [MISSING] system libraries. Run:"
  echo
  echo "      sudo apt install ${missing[*]}"
fi

echo
# rustup installs to ~/.cargo/bin, which is not on PATH in a plain shell. Look there as well as
# on PATH, so an installed toolchain is never reported as missing (the Makefile adds it to PATH
# for the build targets, so finding it here is enough).
if command -v cargo >/dev/null 2>&1; then
  echo "  [ok]      Rust: $(cargo --version)"
elif [ -x "$HOME/.cargo/bin/cargo" ]; then
  echo "  [ok]      Rust: $("$HOME/.cargo/bin/cargo" --version)  (in ~/.cargo/bin)"
  echo "            Not on this shell's PATH. 'make desktop' adds it; for cargo by hand, run:"
  echo "                source \"\$HOME/.cargo/env\""
else
  echo "  [MISSING] Rust toolchain (>= 1.77.2). Run:"
  echo
  echo "      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  echo
  echo "  then reopen the shell, or:  source \"\$HOME/.cargo/env\""
fi

echo
if command -v npm >/dev/null 2>&1; then
  echo "  [ok]      npm: $(npm --version)"
else
  echo "  [MISSING] npm is not on PATH. Tauri shells out to it for the frontend build;"
  echo "            with nvm, run 'source \"\$NVM_DIR/nvm.sh\"' before 'make desktop'."
fi

echo
echo "Then: make desktop        (dev)"
echo "      make desktop-build  (installers)"
