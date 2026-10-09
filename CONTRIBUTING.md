# Contributing

Thanks for helping improve Copilot Cost Analyzer. This is a personal project
maintained on a best-effort basis, so replies may take a few days.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
Report security problems privately as described in [SECURITY.md](SECURITY.md),
never in a public issue.

## Read first

The docs are the source of truth. Skim these before a non-trivial change:

- [docs/vision.md](docs/vision.md): scope and non-goals
- [docs/architecture.md](docs/architecture.md): design, guiding constraints,
  and the engineering practices (TDD and SOLID, section 11)
- [docs/implementation-plan.md](docs/implementation-plan.md): phase order and
  exit criteria

If your change conflicts with them, update the relevant doc in the same PR.

## Getting started

You need Node.js 22 or newer.

```sh
git clone https://github.com/raulkivi/copilot-cost-analyzer
cd copilot-cost-analyzer
npm ci
npm test         # vitest for every workspace
npm run lint     # eslint across the repo
npm run typecheck # tsc --noEmit for every workspace, test files included
npm run build    # type-check and build every workspace
npm run dev      # server and web app together
```

The repo is an npm workspace: `packages/domain` (shared zod schemas),
`packages/server` (Express API and log providers), `packages/web` (Vite and
React UI) and `packages/pi-system-prompt-logger` (optional Pi extension).

## Making a change

1. Open an issue first for anything larger than a small fix, so we can agree
   on the approach before you invest time.
2. Fork the repo and branch from `main`.
3. Follow test-driven development: write the failing test first, then the code
   that makes it pass. Keep to the SOLID principles described in
   `docs/architecture.md`.
4. Run `npm run lint`, `npm run typecheck`, `npm run build` and `npm test`. CI
   runs the same four.
5. Update the README or `docs/` when behavior changes, and add a line under
   `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
6. Open a pull request using the template.

Pull requests also run a Claude code review, the OpenSSF Scorecard and
[unicode-smuggling-guard](https://github.com/raulkivi/unicode-smuggling-guard),
which rejects hidden Unicode characters in code, docs and agent files. Keep to
plain visible characters.

## Privacy

The app reads local session logs and never uploads them. When you file an issue
or PR, do not paste real chat text, API keys, tokens or captures that contain
them. Redact first, or describe the shape of the data instead. Test fixtures
must be synthetic.

## License

Contributions are licensed under the [MIT License](LICENSE).
