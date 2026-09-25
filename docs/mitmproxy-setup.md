# Setting up mitmproxy captures

How to actually produce a `.har` file the app's `mitmproxy` `LogProvider`
can read, and drop it where the app looks for it. `architecture.md`
documents *what* the app does with a capture (§6.2.3, "mitmproxy capture
configuration convention"); this doc is the missing *how* — installing
mitmproxy, trusting its CA, routing traffic through it, exporting HAR, and
placing the file.

**Read this first:** [`log-provider-alternatives.md`](providers/log-provider-alternatives.md)
(#4, "Decision" section) — as of 2026-08-10, `mitmproxy` is Phase 9's
provider for **non-Copilot coding agents that call vendor APIs directly**
(Claude Code, aider, etc.), not the recommended path for GitHub Copilot
Chat's own token/cache data. Copilot Chat's traffic is GitHub-routed
(`api.githubcopilot.com`), and the richer numbers (cache-write, reasoning
tokens) are already available with far less setup via
`agent-traces.db` — see the README's ["Enabling richer cache-write/
reasoning numbers"](../README.md#enabling-richer-cache-writereasoning-numbers-optional)
section. There's also no confirmed/built decoder for
`api.githubcopilot.com`'s specific wire shape yet (only direct Anthropic
and OpenAI API shapes are recognized today — see
`data-sources/log-providers/mitmproxy/decoders`), so a raw Copilot capture
may show up as an unrecognized exchange. If what you actually want is
Copilot's own cost/cache numbers, use the `agent-traces.db` route instead;
use mitmproxy for a direct-API agent or to inspect the raw wire traffic.

## 1. Install mitmproxy

```sh
pip install mitmproxy
# or, on most distros:
# sudo apt install mitmproxy
```

## 2. Start it and trust its CA certificate

Start the web UI variant, which makes filtering and exporting flows easier
than the terminal UI. Scope interception to just the host(s) you care about
with `--allow-hosts` — connections to any other host are passed through as
an opaque, undecrypted tunnel (never MITM'd, never shown as a flow, and the
client doesn't need to trust the CA for them), which is cleaner than
capturing everything and filtering afterward. For GitHub Copilot Chat
specifically, `copilot-chat-source-investigation.md` §4 identifies
`api.githubcopilot.com` (the confirmed LLM backend) and `api.github.com`
(still-open empirical question — worth capturing too, to see what shape
GitHub's backend actually forwards):

```sh
mitmweb --no-web-open-browser --allow-hosts '^api\.githubcopilot\.com(:\d+)?$|^api\.github\.com(:\d+)?$'
```

For **Claude Code** specifically, its LLM traffic goes to `api.anthropic.com`
(a custom `ANTHROPIC_BASE_URL` — e.g. a Bedrock/Vertex proxy — changes this;
scope to that host instead if you've set one):

```sh
mitmweb --no-web-open-browser --allow-hosts '^api\.anthropic\.com(:\d+)?$'
```

**Anchor gotcha:** `--allow-hosts` matches against `host:port`, not the bare
hostname — a pattern anchored with a trailing `$` (like the once-recommended
`^api\.anthropic\.com$`) never matches anything, because the string being
tested always has a `:443` (or other port) suffix. mitmproxy MITMs the
connection just fine in that case (TLS decrypts, the client gets a real
response) but silently never builds an HTTPFlow for it — so nothing shows up
in the flow list, in `GET /flows`, or in a `hardump` HAR export, with no
error anywhere. Always include `(:\d+)?` before a trailing `$`, or drop the
trailing anchor entirely (accepting the minor risk of a longer hostname
matching as a prefix).

Claude Code also talks to a couple of non-LLM hosts as part of normal
operation — `console.anthropic.com` (OAuth login/token refresh) and
`statsig.anthropic.com` plus `sentry.io` (feature flags and error
telemetry). None of these carry the request/response exchanges the app's
decoder cares about, so leave them out of `--allow-hosts` for a capture
aimed at this app; include them only if you're debugging Claude Code's own
network behavior rather than producing a HAR for this project.

For any other direct-API agent, use that vendor's host the same way, e.g.
`--allow-hosts '^api\.openai\.com(:\d+)?$'`. Not sure of the exact host(s) a given
tool uses, or want to catch auxiliary endpoints (telemetry, auth) alongside
the main one? Run once with `--allow-hosts` omitted (intercepts everything),
generate a bit of traffic, and read the actual hostnames off mitmweb's flow
list — then relaunch scoped to just the ones you care about. Omit
`--allow-hosts` entirely to intercept everything for the rest of this
walkthrough too (see step 4's filtering note if you do).

`--no-web-open-browser` skips auto-launching a browser tab each time you
start `mitmweb` — useful if you're running it headless/remote, restarting
it often while narrowing `--allow-hosts`, or just don't want a new tab every
time. The flow viewer is still there whenever you want it, but visiting
plain `http://127.0.0.1:8081` isn't enough — mitmweb requires a token in the
URL and refuses the connection without it. On startup it prints the exact
URL to use to the terminal, e.g. `http://127.0.0.1:8081/?token=<random-hex>`
— copy that whole line (with your own token, not this placeholder) into
your browser. The proxy itself listens on
`127.0.0.1:8080`. On first run `mitmweb` also writes a CA certificate to
`~/.mitmproxy/mitmproxy-ca-cert.pem`.

HTTPS interception fails with a TLS trust error until that CA is trusted
by whatever will be making the request:

- **System-wide (Linux):**
  ```sh
  sudo cp ~/.mitmproxy/mitmproxy-ca-cert.pem /usr/local/share/ca-certificates/mitmproxy.crt
  sudo update-ca-certificates
  ```
- **For a specific Node/Electron process** (VS Code and its extensions run
  in one) without touching the system trust store:
  ```sh
  export NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem
  ```
  Set this before launching whatever process you're capturing from (e.g.
  `code` for VS Code, or a terminal agent binary), not after.

## 3. Route the target process's traffic through the proxy

Set the standard proxy environment variables before launching the process
you want to capture, e.g. for Claude Code:

```sh
export HTTPS_PROXY=http://127.0.0.1:8080
export HTTP_PROXY=http://127.0.0.1:8080
export NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem  # it's a Node binary — see step 2
claude
```

Same pattern for aider or any other agent binary that talks to the vendor
API directly — just swap the last line.

**Scoping the proxy to one Claude Code project instead of a whole shell:**
rather than exporting env vars in your shell (which affects everything you
run from it), add an `env` block to that project's `.claude/settings.json`
(team-wide, checked in) or `.claude/settings.local.json` (local-only,
gitignored — the better fit for a one-off capture):

```json
{
  "env": {
    "HTTPS_PROXY": "http://127.0.0.1:8080",
    "HTTP_PROXY": "http://127.0.0.1:8080",
    "NODE_EXTRA_CA_CERTS": "~/.mitmproxy/mitmproxy-ca-cert.pem"
  }
}
```

These only apply when Claude Code runs from that project directory, and
subprocesses/MCP servers it spawns inherit them too. There's no dedicated
`httpProxy`/`httpsProxy` config key — it's these same standard env var
names, just settings-file-scoped instead of shell-scoped. One caveat: in
Desktop app sessions specifically (not terminal/SSH/WSL), Claude Code
ignores these network vars from project-level settings and only reads them
from the global `~/.claude/settings.json` — a deliberate guard against a
checked-out repo hijacking a Desktop session's TLS path.

For VS Code itself, either launch it with the same env vars set, or set
its own proxy setting in user `settings.json`:

```json
"http.proxy": "http://127.0.0.1:8080",
"http.proxySupport": "on"
```

then reload the window. This is a global VS Code networking setting, not
Copilot-specific — it proxies VS Code's own traffic (marketplace, updates,
telemetry) and every extension's Node-based HTTP calls from the extension
host, Copilot Chat included, all mixed together. Native subprocesses an
extension spawns (compiled language-server binaries, `git`, etc.) don't go
through it unless they separately read `HTTP_PROXY`/`HTTPS_PROXY`. Expect a
noisy flow list — this is why step 4 filters by host before exporting.

## 4. Generate traffic

Use the agent/tool normally with the proxy running so mitmweb's flow list
fills up. Redaction of credential-bearing headers (`authorization`,
`x-api-key`, `cookie`, etc.) happens later, when the app reads the HAR
(`redact-headers.ts`) — mitmweb's own capture is unredacted. If you used
`--allow-hosts` in step 2, the flow list is already scoped to just the
host(s) you asked for. If you skipped it and captured everything, narrow
the flow list before exporting instead, e.g. filter on `~d api.anthropic.com`
or `~d api.githubcopilot.com` in mitmweb's filter box.

## 5. Export as HAR

HAR export (`hardump`) is a built-in mitmproxy option as of the versions
this project has tested against — no separate addon script needed (the
`har_dump.py` example script some older guides reference is deprecated
upstream; it's been folded into mitmproxy core as `addons/savehar.py`):

```sh
mitmdump --allow-hosts '^api\.anthropic\.com(:\d+)?$' --set hardump=./capture.har
```

Run your capture session through `mitmdump` with that flag instead of (or
in addition to) `mitmweb`, then stop it (Ctrl-C) once you have the
exchanges you want — `hardump` writes the file on exit. If you were using
`mitmweb` for the earlier steps, stop it first and start `mitmdump` instead
for this step; `mitmweb`'s browser-based flow list doesn't have an
in-browser bulk HAR export by default.

## 6. Stop mitmproxy and undo the routing

Ctrl-C the terminal running `mitmweb`/`mitmdump` (closing the mitmweb
browser tab alone does not stop the process). Then, in whichever shell you
set them, `unset HTTPS_PROXY HTTP_PROXY NODE_EXTRA_CA_CERTS` — otherwise the
next thing you run in that shell will try to reach a proxy that's no longer
listening and fail to connect. If you set VS Code's `http.proxy`, remove it
from `settings.json` and reload the window too, or VS Code and every
extension (Copilot Chat included) keeps routing through the dead proxy.

## 7. Drop the file where the app looks for it

The app watches a fixed directory (no in-app path setting). Each `.har`
file becomes one or more sessions: if you captured multiple separate
coding-agent runs into one long-running `mitmdump` capture, the app
automatically splits them at any gap of more than 30 minutes between two
captured exchanges.

```sh
mkdir -p ~/.config/copilot-cost-analyzer/mitmproxy-captures
cp capture.har ~/.config/copilot-cost-analyzer/mitmproxy-captures/
```

(`~/.config` is `$XDG_CONFIG_HOME` if you have it set; macOS/Windows use
different app-settings roots — see `resolve-app-settings-dir.ts` — but this
project's README currently only documents/supports Linux.)

## 8. Switch the app to the mitmproxy provider

In the app header's provider select, choose **mitmproxy**, or:

```sh
curl -X PUT http://127.0.0.1:3001/api/log-providers/active \
  -H 'Content-Type: application/json' \
  -d '{"id":"mitmproxy"}'
```

Each `.har` file in the captures directory shows up as one session in
Analyze mode, or several if the app detected an idle gap of more than 30
minutes between exchanges within it (e.g. you left `mitmdump` running
across more than one coding-agent run) — split sessions are titled
`<filename> (session i of N)` to tell them apart. An exchange whose vendor
shape isn't recognized by any registered decoder is reported as unavailable
rather than guessed
(architecture.md's decoder-registry contract) — expected for any vendor
without a matching decoder yet.
