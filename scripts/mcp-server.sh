#!/usr/bin/env bash
# Launches the read-only tool-call audit MCP server over stdio, for
# `claude mcp add copilot-cost-analyzer -- /abs/path/to/scripts/mcp-server.sh`
# (or any MCP-capable harness). Run `npm install` in the repo first.
# stdout is reserved for JSON-RPC; the server logs to stderr only.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT/node_modules/.bin/tsx" "$ROOT/packages/server/src/mcp/stdio.ts"
