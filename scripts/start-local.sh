#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_dir="$project_root/runtime"
pid_file="$runtime_dir/chatpymol.pid"
log_file="$runtime_dir/chatpymol.log"

mkdir -p "$runtime_dir"

if [[ -f "$pid_file" ]]; then
  current_pid="$(<"$pid_file")"
  if [[ "$current_pid" =~ ^[0-9]+$ ]] && kill -0 "$current_pid" 2>/dev/null; then
    echo "ChatPyMOL is already running (PID $current_pid)"
    echo "Local URL: http://127.0.0.1:8787"
    exit 0
  fi
fi

cd "$project_root"
setsid env NODE_ENV=production node "$project_root/server/index.mjs" >>"$log_file" 2>&1 </dev/null &
server_pid=$!
echo "$server_pid" >"$pid_file"

for _ in {1..20}; do
  if curl --noproxy "*" -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    echo "ChatPyMOL started (PID $server_pid)"
    echo "Local URL: http://127.0.0.1:8787"
    echo "Log: $log_file"
    exit 0
  fi
  sleep 0.5
done

echo "ChatPyMOL did not become ready. Check $log_file" >&2
exit 1
