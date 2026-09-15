import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { atomicWriteText } from '@main/claude/config/atomic'
import { mcpServerSpec, SERVER_NAME } from './index'
import type { ExternalMcpResult, ExternalMcpTargetId } from '@shared/types'

/**
 * The same MCP server `mcp/index.ts` already runs for whichever CLI Mindex
 * itself spawns, registered into other AI apps' own config files too — so
 * the vault is reachable from Claude Desktop, Cursor, or a plain `claude`
 * session started outside Mindex, not only from Mindex's own chat.
 *
 * Deliberately only apps with one well-known, stable, per-user config file —
 * the same read-merge-write shape `gemini-settings.ts` already established
 * for one target (only *our* key touched, everything else in the file left
 * exactly as found; a file that fails to parse is the user's and is left
 * alone rather than risk clobbering it).
 *
 * `~/.claude.json`'s top-level `mcpServers` shape (`{command, args, env}` per
 * entry, no `env` required) was read directly off this machine's own file —
 * `claude mcp add --scope user` already writes real servers there. Claude
 * Desktop's `claude_desktop_config.json` location was likewise confirmed to
 * exist on this machine (though with no `mcpServers` key yet, since none had
 * been added through its own UI); its and Cursor's `mcpServers` shape follow
 * the same, publicly documented Anthropic MCP convention, not a guess at
 * something novel.
 */

interface ExternalTarget {
  id: ExternalMcpTargetId
  label: string
  /** Absolute path to the config file, or null if this platform has no known location for it. */
  configPath(home: string): string | null
}

/**
 * Takes `home` as a parameter rather than calling `os.homedir()` itself, for
 * one reason: a test double for "the user's home directory" needs to be a
 * real, explicit value a caller passes in, not a mocked built-in module. A
 * `vi.mock('node:os', ...)` here would have been the more familiar shape, but
 * it does not reliably intercept `os.homedir()` the way a default import of a
 * `node:`-prefixed core module resolves under Vite/Vitest — tried first, and
 * confirmed the hard way: it silently fell through to the *real* home
 * directory, and a test run actually wrote (empty, then removed again, but
 * still) `mcpServers` keys into this machine's real Claude Desktop and Cursor
 * configs before this was caught. An explicit parameter cannot silently miss.
 */
const TARGETS: ExternalTarget[] = [
  {
    id: 'claudeDesktop',
    label: 'Claude Desktop',
    configPath(home) {
      if (process.platform === 'darwin') {
        return path.join(
          home,
          'Library',
          'Application Support',
          'Claude',
          'claude_desktop_config.json'
        )
      }
      if (process.platform === 'win32') {
        const appData = process.env.APPDATA
        return appData ? path.join(appData, 'Claude', 'claude_desktop_config.json') : null
      }
      // No documented Linux install for Claude Desktop — not guessing a path
      // for an app that may not exist on this platform at all.
      return null
    }
  },
  {
    id: 'cursor',
    label: 'Cursor',
    configPath(home) {
      return path.join(home, '.cursor', 'mcp.json')
    }
  },
  {
    id: 'claudeCli',
    label: 'Claude Code (CLI)',
    configPath(home) {
      return path.join(home, '.claude.json')
    }
  }
]

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch (e) {
    // Absent is normal — the app may just never have been configured with an
    // MCP server before. Malformed is the user's file and not ours to
    // rewrite: null makes both register and unregister leave it alone.
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? {} : null
  }
}

async function writeJson(file: string, settings: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteText(file, `${JSON.stringify(settings, null, 2)}\n`)
}

async function registerOne(
  target: ExternalTarget,
  home: string,
  spec: NonNullable<Awaited<ReturnType<typeof mcpServerSpec>>>
): Promise<ExternalMcpResult> {
  const file = target.configPath(home)
  if (!file)
    return {
      id: target.id,
      label: target.label,
      ok: false,
      reason: 'no known config location on this platform'
    }
  const settings = await readJson(file)
  if (!settings)
    return {
      id: target.id,
      label: target.label,
      ok: false,
      reason: 'existing config file could not be parsed — left untouched'
    }

  const servers =
    typeof settings['mcpServers'] === 'object' && settings['mcpServers'] !== null
      ? { ...(settings['mcpServers'] as Record<string, unknown>) }
      : {}
  servers[SERVER_NAME] = { command: spec.command, args: spec.args, env: spec.env }
  settings['mcpServers'] = servers

  try {
    await writeJson(file, settings)
  } catch (err) {
    return {
      id: target.id,
      label: target.label,
      ok: false,
      reason: err instanceof Error ? err.message : String(err)
    }
  }
  return { id: target.id, label: target.label, ok: true }
}

async function unregisterOne(target: ExternalTarget, home: string): Promise<void> {
  const file = target.configPath(home)
  if (!file) return
  const settings = await readJson(file)
  if (!settings) return
  const servers = settings['mcpServers']
  if (typeof servers !== 'object' || servers === null) return
  if (!(SERVER_NAME in servers)) return
  const next = { ...(servers as Record<string, unknown>) }
  delete next[SERVER_NAME]
  settings['mcpServers'] = next
  await writeJson(file, settings).catch(() => {})
}

/**
 * Registers (or re-registers) into every target with a known location on
 * this platform. Re-registering is not a special case: the bridge's socket
 * address and token rotate every app launch (`mcp/bridge.ts`), so an entry
 * written last session is already stale by the time this runs again.
 *
 * `home` is test-only — every real caller (the IPC handler, app startup, the
 * settings sync) calls this with no argument and gets the real
 * `os.homedir()`.
 */
export async function registerAllExternalMcp(
  home: string = os.homedir()
): Promise<ExternalMcpResult[]> {
  const spec = await mcpServerSpec()
  if (!spec) {
    return TARGETS.map((t) => ({
      id: t.id,
      label: t.label,
      ok: false,
      reason: 'the bridge could not start'
    }))
  }
  const results: ExternalMcpResult[] = []
  for (const target of TARGETS) results.push(await registerOne(target, home, spec))
  return results
}

/** Takes the entry back out of every target, leaving anything else the user has there. */
export async function unregisterAllExternalMcp(home: string = os.homedir()): Promise<void> {
  for (const target of TARGETS) await unregisterOne(target, home)
}
