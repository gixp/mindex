# Contributing

Thank you for looking. This is a small project with one maintainer, so the
most useful thing you can do is talk before you build.

## Before you write code

- **An idea or a request** → [Discussions](https://github.com/gixp/mindex/discussions).
- **Something broken** → [Issues](https://github.com/gixp/mindex/issues), with
  the steps that produce it and what you expected instead.
- **A change of any size** → open an issue or a discussion first. A pull
  request that arrives unannounced may be rejected on grounds that had nothing
  to do with its quality, and that wastes your afternoon rather than mine.

## Running it

Node 20 or newer.

```bash
git clone https://github.com/gixp/mindex.git
cd mindex
npm ci
npm run dev
```

You also need one assistant CLI installed and signed in — Claude Code, Codex or
Gemini CLI — or most of the app has nothing to talk to. A build from a clone
carries no analytics or crash-reporting keys, and each of those integrations
turns itself off when its key is blank.

## Before you open a pull request

All four, and they are what CI runs:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## House rules worth knowing

**Sizes, radii and colours come from the design system.** Arbitrary values like
`text-[13px]` or `rounded-[9px]` fail the lint rule; use the tokens. Colours are
named by their role, not by a palette shade. See [DESIGN.md](DESIGN.md).

**Lint suppressions only ever fall.** `eslint-suppressions.json` is a ratchet
holding the violations that predate a rule. Adding to it is not how a new
violation gets in; fixing one and running
`npx eslint <files> --prune-suppressions --suppressions-location eslint-suppressions.json`
is how the count goes down.

**Tests describe behaviour, not implementation.** A test that would survive the
bug it exists to catch is worse than none. The live tests against real
assistants are opt-in — `RUN_ACP_INTEGRATION=1` — because they start real
processes and spend real tokens.

**Comments say why.** What the code does is in the code. A comment earns its
place by recording the reason a thing is the way it is, especially when the
obvious alternative was tried and failed.

**Never commit a secret.** Nothing in this repository holds one, and
`.env.example` shows what a build reads from the environment.

## Licensing your contribution

The project is [AGPL-3.0-or-later](LICENSE). By opening a pull request you
license your contribution under the same terms.

The name and logo are not covered by that licence — see
[TRADEMARK.md](TRADEMARK.md). Fork freely, under a name of your own.

## Reporting a vulnerability

Not here, and not in an issue. See [SECURITY.md](SECURITY.md).
