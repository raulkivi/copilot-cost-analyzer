// Masks credential-shaped substrings before any tool output leaves the
// server (architecture.md §11.2: captured terminal output can contain
// secrets). Pattern list mirrors the mitmproxy provider's header-stripping
// intent for free-text output; errs on masking too much.
const REDACTED = "[REDACTED]";

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

const BEARER = /\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KEY_VALUE = /\b((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\s*[=:]\s*)["']?[^\s"']{4,}["']?/gi;

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED);
  }
  redacted = redacted.replace(BEARER, (_match, scheme: string) => `${scheme} ${REDACTED}`);
  redacted = redacted.replace(KEY_VALUE, (_match, prefix: string) => `${prefix}${REDACTED}`);
  return redacted;
}

export function excerptOf(text: string, maxLength: number): string {
  const redacted = redactSecrets(text).trim();
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength - 1)}…`;
}
