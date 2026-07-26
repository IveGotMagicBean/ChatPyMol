#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pid_file="$project_root/runtime/chatpymol.pid"

if [[ ! -f "$pid_file" ]]; then
  echo "ChatPyMOL is not running"
  exit 1
fi

server_pid="$(<"$pid_file")"
if [[ ! "$server_pid" =~ ^[0-9]+$ ]] || ! kill -0 "$server_pid" 2>/dev/null; then
  echo "ChatPyMOL is not running (stale PID file)"
  exit 1
fi

echo "ChatPyMOL is running (PID $server_pid)"
curl --noproxy "*" -fsS http://127.0.0.1:8787/api/health
echo
