import { statSync } from "node:fs";
import crypto from "node:crypto";

// A stable hash of one session file's path + mtime — same recipe as
// pi-agent/session-id.ts's computePiFileHash: the same unmodified file
// always resolves to the same hash, and an overwritten file at the same
// path gets a fresh one rather than reusing stale content. No branch-marker
// suffix is needed here (unlike pi's computeBranchSessionId): the plan's
// one-Session-per-file decision means one file always maps to exactly one
// id, since Claude Code's own `last-prompt.leafUuid` already tells us which
// single branch is authoritative — no per-leaf addressing to encode.
export function computeClaudeCodeFileHash(filePath: string): string {
  const stats = statSync(filePath);
  return crypto.createHash("sha256").update(`${filePath}:${stats.mtimeMs}`).digest("hex").slice(0, 16);
}

// Linear scan, no cache — matches every other provider's "reread fresh"
// posture (pi-agent-log-provider.ts's resolveBranch does the same).
export function resolveClaudeCodeSessionFilePath(sessionFiles: string[], sessionId: string): string | undefined {
  return sessionFiles.find((file) => computeClaudeCodeFileHash(file) === sessionId);
}
