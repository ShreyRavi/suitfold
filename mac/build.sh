#!/usr/bin/env bash
# Build suitfold.app: a Mac that holds a table.
#
# The app is a small Swift window around a compiled copy of the same table
# server the repo runs anywhere else. One implementation of the game, wrapped
# in something that is not a browser tab.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="build/suitfold.app"
ID="${SUITFOLD_SIGN_ID:-Developer ID Application}"

echo "==> building the front end"
# The app carries the client it was built with, so the two can never disagree
# about what a table looks like - and a game works with the internet unplugged.
bun run build

echo "==> compiling the table"
bun build server/table.ts --compile --minify --outfile build/suitfold-table

echo "==> compiling the app"
swiftc -O -parse-as-library mac/Suitfold.swift -o build/Suitfold

echo "==> assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp build/Suitfold "$APP/Contents/MacOS/suitfold"
cp build/suitfold-table "$APP/Contents/Resources/suitfold-table"
rm -rf "$APP/Contents/Resources/web"
cp -R dist "$APP/Contents/Resources/web"
cp mac/Info.plist "$APP/Contents/Info.plist"
[ -f mac/icon.icns ] && cp mac/icon.icns "$APP/Contents/Resources/icon.icns"

echo "==> signing"
# The table server is a separate executable and has to be signed in its own
# right, innermost first, or the outer signature will not verify.
codesign --force --options runtime --timestamp \
  --entitlements mac/suitfold.entitlements \
  --sign "$ID" "$APP/Contents/Resources/suitfold-table"
codesign --force --options runtime --timestamp \
  --entitlements mac/suitfold.entitlements \
  --sign "$ID" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "==> done: $APP"
