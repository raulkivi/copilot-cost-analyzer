// Credential-bearing header names stripped (not merely masked) before any
// captured exchange reaches a MitmExchangeDecoder, the enricher, or the API
// response (architecture.md §11.2/§6.2.3, phase-9-log-providers-
// implementation.md §4). Matched case-insensitively since HTTP header names
// are case-insensitive and HAR captures don't normalize casing.
const CREDENTIAL_HEADER_NAMES = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "proxy-authorization",
  "cookie",
  "set-cookie",
]);

// New providers bring header names the fixed list cannot anticipate, so names that
// look like credentials are stripped too. `tokens` (plural) is deliberately not
// matched: rate-limit headers such as `x-ratelimit-limit-tokens` carry no secret.
const CREDENTIAL_NAME_PATTERN = /(api[-_]?key|secret|(?:^|[-_])token$|(?:^|[-_])auth(?:[-_]|$)|security-token)/i;

function isCredentialHeader(name: string): boolean {
  return CREDENTIAL_HEADER_NAMES.has(name.toLowerCase()) || CREDENTIAL_NAME_PATTERN.test(name);
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (isCredentialHeader(name)) {
      continue;
    }
    redacted[name] = value;
  }
  return redacted;
}
