#!/usr/bin/env bash
# LedgerPro release flow — verify-first, then version bump → DMG → optional install.
# Usage:
#   npm run release -- <x.y.z>             verify, bump, build dist/LedgerPro-<x.y.z>-<arch>.dmg
#   npm run release -- <x.y.z> --install   ...and safely replace /Applications/LedgerPro.app
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=""
INSTALL=0
for arg in "$@"; do
  if [ "$arg" = "--install" ]; then INSTALL=1; else VERSION="$arg"; fi
done

if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'; then
  echo "Usage: npm run release -- <x.y.z> [--install]"
  exit 1
fi

ARCH=$(uname -m)
echo "==> Host architecture: $ARCH"
DMG="dist/LedgerPro-$VERSION-$ARCH.dmg"

ROLLBACKED=0
rollback() {
  if [ "$ROLLBACKED" = "1" ]; then return; fi
  ROLLBACKED=1
  echo "==> Rolling back version bump"
  git checkout -- package.json package-lock.json 2>/dev/null || true
}
trap rollback ERR
trap 'ROLLBACKED=1' EXIT

if ! git diff --quiet package.json; then
  echo "ERROR: package.json has uncommitted changes; commit or stash first."
  exit 1
fi

OLD_VERSION=$(node -p "require('./package.json').version")
echo "==> Releasing LedgerPro v$OLD_VERSION -> v$VERSION"

echo "==> Pre-verification (current tree)"
npm run lint
npm test
npm run check:native
npm run test:persistence
npm run smoke
npx electron scripts/test-export.js
npx electron scripts/test-reports.js

echo "==> Bumping version in package.json"
node -e "
const fs = require('fs');
const p = 'package.json';
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
d.version = process.argv[1];
fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
" "$VERSION"

echo "==> Rebuilding native module for Electron (target via node_modules/electron)"
ELECTRON_VERSION=$(node -p "require('./node_modules/electron/package.json').version")
NODE_GYP=./node_modules/.bin/node-gyp
(cd node_modules/better-sqlite3 && ../../$NODE_GYP rebuild --release \
  --target="$ELECTRON_VERSION" --arch="$ARCH" --runtime=electron \
  --dist-url=https://electronjs.org/headers)

echo "==> Syntax check"
for f in main.js preload.js db.js js/*.js scripts/*.js; do
  node --check "$f"
done

echo "==> Smoke test on the new version (boots the real app, temp profile)"
npm run smoke

echo "==> Building DMG"
npm run dist -- --$ARCH

if [ ! -f "$DMG" ]; then
  echo "ERROR: expected DMG not found: $DMG"
  echo "Available arches in dist/:"
  ls dist/*.dmg 2>/dev/null || true
  exit 1
fi
echo "==> Built $DMG ($(du -h "$DMG" | cut -f1))"

echo "==> Verifying version inside the DMG"
MOUNT_OUT=$(hdiutil attach "$DMG" -nobrowse)
MOUNT=$(printf '%s\n' "$MOUNT_OUT" | awk -F'\t' '/\/Volumes\// {print $NF; exit}')
if [ -z "$MOUNT" ]; then echo "ERROR: could not mount DMG"; exit 1; fi
PLIST_VER=$(defaults read "$MOUNT/LedgerPro.app/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || true)
hdiutil detach "$MOUNT" -quiet
if [ "$PLIST_VER" != "$VERSION" ]; then
  echo "ERROR: DMG version '$PLIST_VER' != '$VERSION'"
  exit 1
fi
echo "==> DMG version verified: $PLIST_VER"

if [ "$INSTALL" = "1" ]; then
  echo "==> Installing to /Applications (atomic swap)"
  MOUNT_OUT=$(hdiutil attach "$DMG" -nobrowse)
  MOUNT=$(printf '%s\n' "$MOUNT_OUT" | awk -F'\t' '/\/Volumes\// {print $NF; exit}')
  if [ -z "$MOUNT" ]; then echo "ERROR: could not mount DMG"; exit 1; fi
  cp -R "$MOUNT/LedgerPro.app" /Applications/.LedgerPro-new.app
  rm -rf /Applications/LedgerPro.app
  mv /Applications/.LedgerPro-new.app /Applications/LedgerPro.app
  hdiutil detach "$MOUNT" -quiet
  INSTALLED_VER=$(defaults read /Applications/LedgerPro.app/Contents/Info.plist CFBundleShortVersionString)
  if [ "$INSTALLED_VER" != "$VERSION" ]; then
    echo "ERROR: installed version '$INSTALLED_VER' != '$VERSION'"
    exit 1
  fi
  echo "==> Installed /Applications/LedgerPro.app v$INSTALLED_VER"
  echo "    Note: the app is unsigned; if launched via right-click->Open on first run,"
  echo "          right-click -> Open again to confirm. Gatekeeper quarantine is expected."
fi

echo "==> Purging stale DMGs (keeping the 3 newest)"
ls -1t dist/*.dmg 2>/dev/null | tail -n +4 | while read -r stale; do
  echo "    removing $stale"
  rm -f "$stale"
done

echo ""
echo "Release v$VERSION complete."
echo "  DMG:  $DMG"
echo "  Ship: share the DMG (users drag LedgerPro.app into /Applications;"
echo "        books stay safe in ~/Library/Application Support/LedgerPro/)"