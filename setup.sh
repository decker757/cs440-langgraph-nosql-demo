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
#   ./setup.sh logs      Show MongoDB's own log of checkpoint queries (add -f to follow)
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

# Independent, database-side evidence: MongoDB's OWN log of every checkpoint
# query, showing the exact filter each one carried. `--slowms 0` in compose.yaml
# makes mongod log all operations. Pass -f/--follow to tail live during a demo.
cmd_logs() {
  check_docker

  local grep_find='"find":"checkpoints"'

  # jq: one readable line per query. Flags a filter whose thread_id is an object
  # (i.e. a smuggled operator) instead of a plain string.
  local line_jq='
    (.attr.ns | sub("\\.checkpoints$";"")) as $db
    | (.t["$date"] | split("T")[1] | split(".")[0]) as $t
    | (.attr.command.filter.thread_id) as $tid
    | (if ($tid|type)=="object" then "  <- INJECTED OPERATOR" else "" end) as $flag
    | "\($t)  \($db)  thread_id=\($tid|tojson)  \(.attr.planSummary // "-")  scanned \(.attr.docsExamined // 0) -> returned \(.attr.nreturned // 0)\($flag)"'

  if [ "${2:-}" = "-f" ] || [ "${2:-}" = "--follow" ]; then
    printf 'Following checkpoint queries live (Ctrl+C to stop)...\n\n'
    if command -v jq >/dev/null 2>&1; then
      docker compose logs --no-color --no-log-prefix --follow mongo 2>/dev/null \
        | grep --line-buffered -F "$grep_find" | jq --unbuffered -r "$line_jq"
    else
      docker compose logs --no-color --no-log-prefix --follow mongo 2>/dev/null \
        | grep --line-buffered -F "$grep_find"
    fi
    return
  fi

  local raw
  raw="$(docker compose logs --no-color --no-log-prefix mongo 2>/dev/null | grep -F "$grep_find" || true)"
  if [ -z "$raw" ]; then
    printf 'No checkpoint queries logged yet. Start the demo and run a trial first.\n'
    return
  fi

  if ! command -v jq >/dev/null 2>&1; then
    printf 'MongoDB-side record of every checkpoint query (install jq for a nicer view):\n\n'
    printf '%s\n' "$raw"
    return
  fi

  local use_color=0
  [ -t 1 ] && use_color=1

  printf "\nMongoDB's own log of every checkpoint query\n"
  printf '(read straight from the database — independent of the app)\n\n'

  # Emit tab-separated fields, group by database, then pretty-print aligned rows.
  printf '%s\n' "$raw" \
    | jq -r '[
        (.attr.ns | sub("\\.checkpoints$";"")),
        (.t["$date"] | split("T")[1] | split(".")[0]),
        (if (.attr.command.filter.thread_id | type) == "object" then "1" else "0" end),
        (.attr.command.filter.thread_id | tojson),
        (.attr.planSummary // "-"),
        (.attr.docsExamined // 0 | tostring),
        (.attr.nreturned // 0 | tostring)
      ] | @tsv' \
    | sort -t "$(printf '\t')" -k1,1 -k2,2 \
    | awk -F'\t' -v color="$use_color" '
        BEGIN {
          if (color) { R="\033[1;31m"; DIM="\033[2m"; B="\033[1m"; X="\033[0m" }
        }
        {
          db=$1; t=$2; inj=$3; tid=$4; plan=$5; exa=$6; ret=$7
          if (db != prevdb) { if (NR>1) print ""; printf "  %s%s%s\n", B, db, X; prevdb=db }
          lab = "thread_id=" tid
          if (inj=="1") lab = lab "   <- INJECTED OPERATOR"
          row = sprintf("    %s   %-46s %-9s scanned %-2s -> returned %s", t, lab, plan, exa, ret)
          if (inj=="1")      print R row "   ** LEAK **" X
          else if (ret=="0") print DIM row X
          else               print row
        }
        END { print "" }'

  printf 'A filter value like {"$gt":""} is the injected operator: it appears only on\n'
  printf 'the vulnerable database. The patched saver rejected it before any query ran.\n'
}

usage() {
  sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'
}

# --- Dispatch -------------------------------------------------------------

case "${1:-start}" in
  start)      cmd_start ;;
  stop)       cmd_stop ;;
  test)       cmd_test ;;
  logs)       cmd_logs "$@" ;;
  help|-h|--help) usage ;;
  *)          fail "Unknown command: $1 (try: ./setup.sh help)" ;;
esac
