#!/usr/bin/env bash
# LedgerPro release flow — one command: version bump → verify → DMG → optional install.
# Usage:
#   npm run release -- <x.y.z>             build dist/LedgerPro-<x.y.z>-arm64.dmg
#   npm run release -- <x.y.z> --install   ...and replace /Applications/LedgerPro.app
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=""
INSTALL=0
for arg in "$@"; do
  if [ "$arg" = "--install" ]; then INSTALL=1; fi
done
for arg in "$@"; do
  if [ "$arg" != "--install" ]; then VERSION="$arg"; fi
done

if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'; then
  echo "Usage: npm run release -- <x.y.z> [--install]"
  exit 1
fi

OLD_VERSION=$(node -p "require('./package.json').version")
echo "==> Releasing LedgerPro v$OLD_VERSION -> v$VERSION"

if [ ! -f node_modules/better-sqlite3/build/Release/better_sqlite3.node ]; then
  echo "==> Native module missing; rebuilding for Electron"
  npm run rebuild:electron
fi

echo "==> Bumping version in package.json"
node -e "
const fs = require('fs');
const p = 'package.json';
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
d.version = process.argv[1];
fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
" "$VERSION"

echo "==> Syntax check"
for f in main.js preload.js db.js js/*.js scripts/*.js; do
  node --check "$f"
done

echo "==> Smoke test (boots the real app, temp profile)"
npm run smoke

echo "==> Building DMG"
npm run dist

DMG="dist/LedgerPro-$VERSION-arm64.dmg"
if [ ! -f "$DMG" ]; then
  echo "ERROR: expected DMG not found: $DMG"
  exit 1
fi
echo "==> Built $DMG ($(du -h "$DMG" | cut -f1))"

if [ "$INSTALL" = "1" ]; then
  echo "==> Installing to /Applications"
  MOUNT_OUT=$(hdiutil attach "$DMG" -nobrowse)
  MOUNT=$(printf '%s\n' "$MOUNT_OUT" | awk -F'\t' '/\/Volumes\// {print $NF; exit}')
  if [ -z "$MOUNT" ]; then echo "ERROR: could not mount DMG"; exit 1; fi
  rm -rf /Applications/LedgerPro.app
  cp -R "$MOUNT/LedgerPro.app" /Applications/
  hdiutil detach "$MOUNT" -quiet
  xattr -dr com.apple.quarantine /Applications/LedgerPro.app 2>/dev/null || true
  PLIST_VER=$(defaults read /Applications/LedgerPro.app/Contents/Info.plist CFBundleShortVersionString)
  if [ "$PLIST_VER" != "$VERSION" ]; then
    echo "ERROR: installed version '$PLIST_VER' != '$VERSION'"
    exit 1
  fi
  echo "==> Installed /Applications/LedgerPro.app v$PLIST_VER"
fi

echo ""
echo "Release v$VERSION complete."
echo "  DMG:  $DMG"
echo "  Ship: share the DMG (users drag LedgerPro.app into /Applications;"
echo "        books stay safe in ~/Library/Application Support/LedgerPro/)"
