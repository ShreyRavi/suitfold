#!/usr/bin/env bash
# Notarise and staple suitfold.app, then zip it for release.
#
# Apple has to see the app before other people's Macs will open it without a
# warning. That needs your own credentials, which live in your keychain and
# never in this repo. Set one up once:
#
#   xcrun notarytool store-credentials suitfold \
#     --apple-id you@example.com --team-id LJYUSF5K3D --password <app-specific-password>
#
# The app-specific password comes from appleid.apple.com, not your real one.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="build/suitfold.app"
ZIP="build/suitfold.zip"
PROFILE="${SUITFOLD_NOTARY_PROFILE:-suitfold}"

[ -d "$APP" ] || { echo "build it first: mac/build.sh"; exit 1; }

echo "==> zipping for the notary"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

echo "==> sending to Apple (this takes a few minutes)"
xcrun notarytool submit "$ZIP" --keychain-profile "$PROFILE" --wait

echo "==> stapling the ticket to the app"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"

echo "==> rezipping the stapled app"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

echo "==> done. $ZIP is the thing to upload to a release."
