import os from 'node:os'
import path from 'node:path'
import type { ProviderId } from './types'
import { nodeRuntimeSearchPath } from './node-runtime'

/**
 * PATH repair for spawned agent CLIs.
 *
 * A GUI app on macOS inherits launchd's PATH, not the shell's, so none of the
 * places these tools actually install to are visible. This was already solved
 * twice — once in `claude/engine/spawn.ts` and again, copy-pasted, inside
 * `terminal/pty.ts` — and both were Claude-only. One implementation now, taking
 * the provider's own install locations into account.
 */

/**
 * Directories every provider might live in, **most specific first**.
 *
 * The order is the whole point. A user who ran the CLI's own installer has the
 * current version under their home directory, while a Homebrew cask installed
 * once and forgotten sits in /opt/homebrew going stale — this machine has
 * Claude 2.1.226 in ~/.local/bin and 2.1.185 in /opt/homebrew/bin. The newer,
 * user-managed install must win.
 */
export function commonPaths(): string[] {
  const home = os.homedir()
  const userLocal = [path.join(home, '.local', 'bin'), path.join(home, 'bin')]
  // First, ahead of everything else: Mindex's own private Node.js runtime
  // (see node-runtime.ts). A CLI installed through its bundled npm lands
  // here, and — just as important — npm's own shebang (`#!/usr/bin/env
  // node`) needs `node` resolvable on PATH even when npm itself is invoked
  // by its full path, so this has to win the lookup, not just be present.
  const bundled = [nodeRuntimeSearchPath()]
  if (process.platform === 'darwin') {
    return [...bundled, ...userLocal, '/opt/homebrew/bin', '/usr/local/bin']
  }
  return [...bundled, ...userLocal]
}

/** Where each CLI puts its own managed install, on top of the common ones. */
function providerPaths(id: ProviderId): string[] {
  const home = os.homedir()
  switch (id) {
    case 'claude':
      return [path.join(home, '.claude', 'local')]
    case 'gemini':
      return [path.join(home, '.gemini', 'bin')]
    case 'codex':
      return [path.join(home, '.codex', 'bin')]
  }
}

export function providerSearchPaths(id: ProviderId): string[] {
  // The CLI's own managed install directory outranks even ~/.local/bin.
  return [...providerPaths(id), ...commonPaths()]
}

/** Every directory any provider could be in — for the PTY, which may run any of them. */
export function allProviderSearchPaths(): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of [
    ...providerPaths('claude'),
    ...providerPaths('gemini'),
    ...providerPaths('codex'),
    ...commonPaths()
  ]) {
    if (!seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  return out
}

/**
 * Markers that say "you are running inside a Claude Code session".
 *
 * Set by Claude Code for the processes it spawns. If Mindex is itself launched
 * from a terminal inside such a session — which is exactly how it is run
 * during development — they are inherited by the app and passed on again to
 * every CLI the app spawns. The CLI then believes it is a nested child of
 * somebody else's session and changes behaviour: it announced
 * `Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION`, which
 * quietly breaks `--resume`, and it points `CLAUDE_CODE_MESSAGING_SOCKET` at a
 * socket belonging to a completely unrelated process.
 *
 * An agent CLI Mindex starts is a fresh session, not a continuation of
 * whatever happened to launch Mindex, so these are cleared.
 *
 * A denylist rather than a `CLAUDE_*` prefix sweep on purpose: `CLAUDE_CONFIG_DIR`
 * and `ANTHROPIC_API_KEY` are the user's real configuration and must survive.
 */
const INHERITED_SESSION_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_ENABLE_TASKS',
  'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'MCP_CONNECTION_NONBLOCKING',
  'AI_AGENT'
]

/**
 * Prepend the search paths to `env.PATH`, and drop `ELECTRON_RUN_AS_NODE`.
 *
 * That variable is set in the packaged app's own environment; inherited by a
 * child it turns any Electron-based CLI into a bare Node process that exits 0
 * having done nothing — a silent success that is much harder to diagnose than
 * a crash.
 */
export function ensureProviderPath(env: NodeJS.ProcessEnv, id?: ProviderId): NodeJS.ProcessEnv {
  const next = { ...env }
  const wanted = id ? providerSearchPaths(id) : allProviderSearchPaths()

  // Move the search paths to the front even when they are already present,
  // rather than skipping them.
  //
  // The previous implementation left an existing entry where it was, which made
  // resolution depend on the inherited PATH: this machine has Claude twice
  // (~/.local/bin/claude 2.1.226 and a Homebrew 2.1.185), and a dev run
  // inheriting a shell PATH picked the older one while the packaged app,
  // inheriting launchd's near-empty PATH, picked the newer. Same code, two
  // different binaries, and no way to tell from the outside which one answered.
  const rest = (next.PATH ?? '').split(':').filter((p) => p && !wanted.includes(p))
  next.PATH = [...wanted, ...rest].join(':')

  delete next.ELECTRON_RUN_AS_NODE
  for (const key of INHERITED_SESSION_MARKERS) delete next[key]
  return next
}
