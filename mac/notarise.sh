#!/usr/bin/env bash
# Notarise this app. The work is in ~/bin/notarise-mac-app, which is not
# specific to suitfold and is the one to reach for on the next Mac app.
#
# Credentials are an App Store Connect team key stored in the keychain under
# the profile "suitfold". See ~/bin/NOTARISING.md for setting that up once.
set -euo pipefail
cd "$(dirname "$0")/.."
exec ~/bin/notarise-mac-app build/suitfold.app "${SUITFOLD_NOTARY_PROFILE:-suitfold}"
