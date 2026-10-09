import type { RequestHandler } from "express";

/**
 * DNS-rebinding defence (architecture.md §11.2). Binding to 127.0.0.1 and
 * sending no CORS headers stops cross-origin reads only while the attacker's
 * page has a different origin; a rebinding attack points the attacker's own
 * hostname at 127.0.0.1, making the page same-origin with this server. The
 * browser still sends the attacker's hostname in `Host`, so only requests
 * naming a loopback host literally are served.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

// `hostname` or `hostname:port`, where hostname is a bracketed IPv6 literal
// or a name/IPv4 without colons.
const HOST_HEADER_PATTERN = /^(\[[0-9a-f:.]+\]|[^:[\]]+)(?::(\d{1,5}))?$/i;

/**
 * True when `host` (a raw `Host` header value) names a loopback host and,
 * if `allowedPorts` is given, one of those ports. With no `allowedPorts`,
 * any port on a loopback name is accepted (used where the listening port
 * isn't known up front, e.g. tests on an ephemeral port).
 */
export function isAllowedLoopbackHost(
  host: string | undefined,
  allowedPorts: readonly number[] | undefined,
): boolean {
  if (!host) {
    return false;
  }
  const match = HOST_HEADER_PATTERN.exec(host.trim());
  if (!match) {
    return false;
  }
  const [, hostname, port] = match;
  if (!LOOPBACK_HOSTNAMES.has(hostname.toLowerCase())) {
    return false;
  }
  if (allowedPorts === undefined) {
    return true;
  }
  return port !== undefined && allowedPorts.includes(Number(port));
}

export interface LoopbackHostGuardOptions {
  /** Ports a `Host` header may name; omit to accept any loopback port. */
  allowedPorts?: readonly number[];
}

/**
 * Express middleware rejecting (403) any request whose `Host` header isn't
 * an allowed loopback host. Reads the raw header, never `X-Forwarded-Host`,
 * so a forwarded header can't widen the allow-list.
 */
export function createLoopbackHostGuard(options: LoopbackHostGuardOptions = {}): RequestHandler {
  const { allowedPorts } = options;
  return (req, res, next) => {
    if (isAllowedLoopbackHost(req.headers.host, allowedPorts)) {
      next();
      return;
    }
    res.status(403).json({ error: "Forbidden: requests must use a loopback Host (localhost, 127.0.0.1 or [::1])." });
  };
}
