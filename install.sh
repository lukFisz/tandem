#!/usr/bin/env bash
# Build tdm and install it to /usr/local/bin (override with PREFIX=/some/dir).
# Safe to re-run: the binary is only replaced when the build output differs.
set -euo pipefail

cd "$(dirname "$0")"

PREFIX="${PREFIX:-/usr/local/bin}"
TARGET="$PREFIX/tdm"

command -v go >/dev/null 2>&1 || { echo "error: go is not installed" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Building tdm..."
go build -o "$tmp/tdm" ./cmd/tdm

if [ -f "$TARGET" ] && cmp -s "$tmp/tdm" "$TARGET"; then
  echo "tdm is already up to date at $TARGET"
  exit 0
fi

# Use sudo only when the install directory isn't writable by the current user.
SUDO=""
if [ -d "$PREFIX" ]; then
  [ -w "$PREFIX" ] || SUDO="sudo"
else
  [ -w "$(dirname "$PREFIX")" ] || SUDO="sudo"
fi

$SUDO mkdir -p "$PREFIX"
$SUDO install -m 0755 "$tmp/tdm" "$TARGET"
echo "Installed tdm to $TARGET"

case ":$PATH:" in
  *":$PREFIX:"*) ;;
  *) echo "warning: $PREFIX is not on your PATH" >&2 ;;
esac
