#!/usr/bin/env bash
# Read-only production probe. Prints status + a short body for each path.
B=https://crystalos.kiyanxp3.workers.dev

probe() {
  local path="$1"
  local code
  code=$(curl -s -o /tmp/probe-body -w '%{http_code}' "$B$path")
  printf '%-40s %s  %s\n' "$path" "$code" "$(head -c 200 /tmp/probe-body | tr -d '\n')"
}

for p in /api/accounts/rarities /api/accounts/me /api/nope /api/health; do
  probe "$p"
done

echo "--- POST /api/accounts/login ---"
code=$(curl -s -o /tmp/probe-body -w '%{http_code}' -X POST "$B/api/accounts/login" \
  -H 'content-type: application/json' -d '{"username":"probe","password":"x"}')
printf '%-40s %s  %s\n' "/api/accounts/login" "$code" "$(head -c 200 /tmp/probe-body | tr -d '\n')"

echo "--- frontend ---"
code=$(curl -s -o /tmp/probe-index -w '%{http_code} %{content_type}' "$B/")
echo "$code"
grep -o 'assets/[a-zA-Z0-9._-]*\.js' /tmp/probe-index | head -3
