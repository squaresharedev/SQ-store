#!/usr/bin/env bash
# THE SMOKE CHECK every deploy runs (.github/workflows/deploy.yml), twice:
#
#   scripts/smoke-check.sh --version <id> --build-id <BUILD_ID>
#       the NEW version while it serves no traffic, reached through
#       Cloudflare's version-override header on the real hostname. First it
#       proves the override was honoured: the page must carry this build's ID.
#       Without that proof a request that fell through to the live version
#       would pass the checks on the OLD code.
#   scripts/smoke-check.sh
#       production, once the new version is live.
#
# Each request is a different layer:
#   /login            the Worker boots and renders (200)
#   a product page    the public route reaches the database and answers "no
#                     such product" (404). A Worker that cannot read (a bad
#                     service-role key, the database down) renders the buyer's
#                     "could not load this" page instead, which is not a 404.
#   billing webhook   the route handlers are mounted (404 while Stripe is
#                     unconfigured, 400 for the unsigned body once it is). A
#                     5xx means the handler crashed.
#
# The origin is read from the committed .env.production, the value the build
# inlined; the Worker name from wrangler.jsonc.
set -euo pipefail

VERSION=""
BUILD_ID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --build-id) BUILD_ID="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

APP_URL=$(grep '^NEXT_PUBLIC_APP_URL=' .env.production | cut -d= -f2- | tr -d '"')
WORKER=$(grep -m1 -E '^\s*"name":' wrangler.jsonc | sed -E 's/.*"name":\s*"([^"]+)".*/\1/')
NOBODY=00000000-0000-4000-8000-000000000000

HEADERS=()
if [ -n "$VERSION" ]; then
  HEADERS=(-H "Cloudflare-Workers-Version-Overrides: ${WORKER}=\"${VERSION}\"")
  echo "Checking version $VERSION of $WORKER on $APP_URL (serves no traffic yet)"
else
  echo "Checking $APP_URL (live)"
fi

if [ -n "$BUILD_ID" ]; then
  # A new deployment takes a few seconds to reach every edge location.
  for attempt in $(seq 1 12); do
    if curl -s --max-time 20 "${HEADERS[@]}" "$APP_URL/login" | grep -qF "$BUILD_ID"; then
      echo "ok   build $BUILD_ID answers"
      break
    fi
    if [ "$attempt" = 12 ]; then
      echo "::error::Build $BUILD_ID never answered: the version override was not applied, so nothing below would have tested the new code."
      exit 1
    fi
    sleep 5
  done
fi

# expect "<codes>" METHOD PATH
expect() {
  local want="$1" method="$2" path="$3" got=""
  for attempt in 1 2 3 4 5; do
    got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${HEADERS[@]}" -X "$method" "$APP_URL$path" || true)
    case " $want " in *" $got "*) echo "ok   $got $method $path"; return 0 ;; esac
    sleep 5
  done
  echo "::error::Smoke check failed: $method $path answered $got, expected one of: $want"
  return 1
}

# expect_redirect PATH LOCATION: a signed-out request is sent exactly there.
expect_redirect() {
  local path="$1" want="$2" got=""
  for attempt in 1 2 3 4 5; do
    got=$(curl -s -o /dev/null -D - --max-time 20 "${HEADERS[@]}" "$APP_URL$path" | tr -d '\r' | sed -n 's/^[Ll]ocation: //p' | head -1 || true)
    [ "$got" = "$want" ] && { echo "ok   $path -> $got"; return 0; }
    sleep 5
  done
  echo "::error::Smoke check failed: $path redirected to '$got', expected '$want'"
  return 1
}

expect "200" GET /login
expect "404" GET "/s/$NOBODY/p/$NOBODY"
expect "400 404" POST /api/billing/webhook
echo "The app answers."
