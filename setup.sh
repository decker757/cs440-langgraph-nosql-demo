#!/usr/bin/env bash
#
# CS440 NoSQL injection demo — one-command control script.
#
# Runs on macOS, Linux, and Windows via Git Bash or WSL (native Windows
# cmd/PowerShell is not supported — bash is required). Everything stays on
# 127.0.0.1 with fictional Alice/Bob data only.
#
# Usage:
#   ./setup.sh [start]   Check prereqs, start MongoDB, seed fixture, serve UI (default)
#   ./setup.sh stop      Stop and remove this demo's MongoDB container + volume
#   ./setup.sh test      Start MongoDB (if needed) and run the four trials as tests
#   ./setup.sh help      Show this help
#
# After `start`, Ctrl+C stops the web server; the MongoDB container keeps
# running so the fixture persists. Use `./setup.sh stop` to remove it.

set -euo pipefail

# Run from the repo root regardless of where the script is invoked from.
cd "$(dirname "$0")"

port="${DEMO_PORT:-4400}"

fail() {
  printf '\nError: %s\n' "$1" >&2
  exit 1
}

# --- Shared checks --------------------------------------------------------

check_node() {
  command -v node >/dev/null 2>&1 || fail "Node.js not found. Install Node.js >= 22 (see README)."
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -lt 22 ]; then
    fail "Node.js >= 22 required, found $(node --version)."
  fi
}

check_docker() {
  command -v docker >/dev/null 2>&1 || fail "Docker not found. Install/start Docker Desktop (see README)."
  if ! docker info >/dev/null 2>&1; then
    fail "Docker daemon not reachable. Start Docker Desktop and try again."
  fi
}

ensure_deps() {
  if [ ! -d node_modules ]; then
    printf 'node_modules missing — installing dependencies...\n'
    npm install
  fi
}

start_db() {
  printf 'Starting local MongoDB container (127.0.0.1:27028)...\n'
  npm run db:up
}

# --- Subcommands ----------------------------------------------------------

cmd_start() {
  check_node
  check_docker
  ensure_deps
  start_db

  printf '\nStarting demo server on http://127.0.0.1:%s\n' "$port"
  printf 'Press Ctrl+C to stop the server (the MongoDB container keeps running).\n'
  printf 'To remove the container + volume afterwards: ./setup.sh stop\n\n'

  exec npm start
}

cmd_stop() {
  check_docker
  printf 'Stopping and removing this demo'\''s MongoDB container + volume...\n'
  npm run db:down
  printf 'Done.\n'
}

cmd_test() {
  check_node
  check_docker
  ensure_deps
  start_db
  printf '\nRunning the four trials as integration tests...\n\n'
  exec npm test
}

usage() {
  sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//'
}

# --- Dispatch -------------------------------------------------------------

case "${1:-start}" in
  start)      cmd_start ;;
  stop)       cmd_stop ;;
  test)       cmd_test ;;
  help|-h|--help) usage ;;
  *)          fail "Unknown command: $1 (try: ./setup.sh help)" ;;
esac
