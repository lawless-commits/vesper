#!/usr/bin/env bash
# Full end-to-end check: Postgres in Docker, the release binary, a mock model
# server and headless Chromium. Heavy, so it is meant for CI or a GitHub
# runner, e.g. from a small laptop:
#
#   gh offload --get 'e2e/shots/**' -- ./e2e/run.sh
#
# Also seeds 50,000 messages and times the chat list.
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/vesper_e2e
export AUTOPILOT_TOKEN=secret
export PORT=3300
export VESPER_URL=http://127.0.0.1:3300

cleanup() {
  kill "${APP_PID:-}" "${MOCK_PID:-}" 2>/dev/null || true
  docker rm -f vesper-e2e-db >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "› starting Postgres"
docker run -d --name vesper-e2e-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=vesper_e2e -p 127.0.0.1:55432:5432 postgres:16 >/dev/null
until docker exec vesper-e2e-db pg_isready -U postgres -q; do sleep 1; done

echo "› building"
cargo build --release --locked --quiet

echo "› starting the mock model server and Vesper"
node e2e/mock-llm.mjs &
MOCK_PID=$!
./target/release/vesper &
APP_PID=$!
until curl -sf "$VESPER_URL/api/health" >/dev/null; do sleep 0.5; done

echo "› installing Chromium"
(cd e2e && npm install --no-audit --no-fund --silent && npx playwright install --with-deps chromium >/dev/null)

echo "› browser checks"
status=0
node e2e/ui.mjs || status=$?

echo "› load test: 200 conversations, 50,000 messages"
./target/release/seed_load
./target/release/seed_load --clean

exit $status
