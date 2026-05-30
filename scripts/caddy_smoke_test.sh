#!/usr/bin/env bash
set -euo pipefail

PUBLIC_HOST=${PUBLIC_HOST:?PUBLIC_HOST is required, for example ats.34.21.188.225.nip.io}
SCHEME=${SCHEME:-https}
BASE_URL="${SCHEME}://${PUBLIC_HOST}"
SKIP_HTTP_REDIRECT=${SKIP_HTTP_REDIRECT:-0}

fail() {
  echo "[FAIL] $*" >&2
  exit 1
}

expect_status() {
  local url=$1
  local expected=$2
  local status
  status=$(curl -sk -o /dev/null -w '%{http_code}' "$url") || fail "curl failed for $url"
  [[ "$status" == "$expected" ]] || fail "$url expected HTTP $expected, got $status"
  echo "[OK] $url -> $status"
}

expect_body() {
  local url=$1
  local expected=$2
  local body
  body=$(curl -sk "$url") || fail "curl failed for $url"
  [[ "$body" == "$expected" ]] || fail "$url expected body '$expected', got '$body'"
  echo "[OK] $url -> $body"
}

expect_header() {
  local url=$1
  local header_regex=$2
  curl -skI "$url" | grep -Ei "$header_regex" >/dev/null || fail "$url missing header matching /$header_regex/"
  echo "[OK] $url has header /$header_regex/"
}

expect_status "$BASE_URL/" 200
expect_status "$BASE_URL/health" 200
expect_body "$BASE_URL/health" '{"status":"ok"}'
expect_status "$BASE_URL/api/health" 200
expect_body "$BASE_URL/api/health" '{"status":"ok"}'
expect_status "$BASE_URL/version" 200
expect_status "$BASE_URL/api/version" 200
expect_status "$BASE_URL/dashboard" 200
if [[ "$SKIP_HTTP_REDIRECT" != "1" ]]; then
  expect_status "http://${PUBLIC_HOST}" 308
fi
expect_header "$BASE_URL/" 'strict-transport-security'

# If the backend route is reaching the API, the version payload should mention ats-api.
api_version=$(curl -sk "$BASE_URL/api/version") || fail "curl failed for $BASE_URL/api/version"
[[ "$api_version" == *'"service":"ats-api"'* ]] || fail "$BASE_URL/api/version did not come from the backend: $api_version"

echo "Deployment smoke test passed for $BASE_URL"
