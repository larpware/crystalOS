#!/usr/bin/env bash
# Read-only probe of the Supabase project using the PUBLISHABLE key that Vite
# already inlined into the public frontend bundle. The key is never printed.
set -u
cd "$(dirname "$0")/.."

KEY=$(grep -oE 'sb_publishable_[A-Za-z0-9_-]+' dist/assets/index-*.js | head -1)
URL=$(grep -oE 'https://[a-z0-9]+\.supabase\.co' dist/assets/index-*.js | head -1)

if [ -z "${KEY:-}" ] || [ -z "${URL:-}" ]; then
  echo "no publishable key found in dist bundle"
  exit 1
fi
echo "key present (length ${#KEY}), project: $URL"

probe() {
  local label="$1" path="$2"
  local code body
  code=$(curl -s -o /tmp/sb-body -w '%{http_code}' -H "apikey: $KEY" -H "authorization: Bearer $KEY" "$URL$path")
  body=$(head -c 260 /tmp/sb-body | tr -d '\n')
  printf '%-34s %s  %s\n' "$label" "$code" "$body"
}

probe "auth/health"          "/auth/v1/health"
probe "profiles"             "/rest/v1/profiles?select=id&limit=1"
probe "store_submissions"    "/rest/v1/store_submissions?select=id&limit=1"
probe "servers"              "/rest/v1/servers?select=id&limit=1"
probe "verification tables"  "/rest/v1/verification_tickets?select=id&limit=1"
