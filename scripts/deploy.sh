#!/bin/sh
# Builds the site and publishes it to GitHub Pages, from this machine.
#
# The phrase is not in this repository and never leaves this machine. Only its
# sha256 is used, kept in .pages-lock (gitignored). The first run asks for the
# phrase without echoing it, so it never lands in shell history either. Delete
# .pages-lock to change the phrase.
#
# There is no way to deploy without a door: a site built with no hash is open
# to anybody, so the script refuses rather than doing that by accident.
set -eu
cd "$(dirname "$0")/.."

LOCK_FILE=.pages-lock

if [ ! -s "$LOCK_FILE" ]; then
  printf 'Phrase for the site: '
  trap 'stty echo 2>/dev/null' EXIT INT
  stty -echo
  IFS= read -r phrase
  stty echo
  printf '\n'
  # Trimmed, exactly as the site trims what people type.
  phrase=$(printf %s "$phrase" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  [ -n "$phrase" ] || { echo 'No phrase given.' >&2; exit 1; }
  printf %s "$phrase" | shasum -a 256 | cut -d' ' -f1 > "$LOCK_FILE"
  unset phrase
fi

lock=$(tr -d '[:space:]' < "$LOCK_FILE")
case "$lock" in
  *[!0-9a-f]*|'') echo "$LOCK_FILE does not hold a sha256. Delete it and run again." >&2; exit 1 ;;
esac
[ ${#lock} -eq 64 ] || { echo "$LOCK_FILE does not hold a sha256. Delete it and run again." >&2; exit 1; }

if [ -n "$(git status --porcelain)" ]; then
  echo 'Uncommitted changes. Commit or stash them, so the site is a commit you can point at.' >&2
  exit 1
fi

bun run ci

BASE_PATH=/suitfold/ VITE_LOCK=$lock bun run build
# Unknown paths are still the app, and Pages needs telling twice.
cp dist/index.html dist/404.html
# Served as files, not run through Jekyll.
touch dist/.nojekyll

sha=$(git rev-parse --short HEAD)
remote=$(git remote get-url origin)
(
  cd dist
  git init -q
  git checkout -q -b gh-pages
  git add -A
  git commit -q -m "Deploy $sha"
  git push -q -f "$remote" gh-pages
)
rm -rf dist/.git

# Pages used to be published by a workflow. Point it at the branch instead,
# once; after that this is a no-op.
if command -v gh >/dev/null 2>&1; then
  if [ "$(gh api 'repos/{owner}/{repo}/pages' --jq .build_type)" != legacy ]; then
    echo '{"build_type":"legacy","source":{"branch":"gh-pages","path":"/"}}' |
      gh api -X PUT 'repos/{owner}/{repo}/pages' --input - >/dev/null
    echo 'Pages now serves the gh-pages branch.'
  fi
else
  echo 'Set Settings -> Pages -> Source to "Deploy from a branch: gh-pages /" once, if it is not already.'
fi

echo "Deployed $sha. Pages takes a minute or so to serve it."
