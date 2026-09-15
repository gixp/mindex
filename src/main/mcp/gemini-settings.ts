import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText } from '@main/claude/config/atomic'
import { mcpServerSpec } from './index'

/**
 * Mindex's MCP server, registered for Gemini through the one door it has.
 *
 * Claude and Codex both take the server on the command line, for one run, and
 * forget it. Gemini has no such flag — `gemini mcp add` writes a file and
 * `--allowed-mcp-server-names` only filters servers that are already
 * configured. So for Gemini the server has to live on disk.
 *
 * It goes in `<vault>/.gemini/settings.json` — project scope, not the user's
 * home directory. That is a folder Mindex already writes to: the generated
 * `mindex-note-types` skill lives beside it. Writing here is managing our own
 * territory; writing to `~/.gemini/settings.json` would be reaching into the
 * user's global configuration, which is a different thing entirely and is not
 * done.
 *
 * Two rules follow from it being a real file rather than an argument:
 *
 *  - **only our key.** The file is read, `mcpServers.mindex` is replaced, and
 *    everything else is written back untouched. A user's own servers, their
 *    theme, their model — none of it is ours to lose.
 *  - **cleaned up.** Turning the setting off, or switching away from Gemini,
 *    removes the key again, and the file and folder go with it if that leaves
 *    them empty. A stale entry would point at a socket that no longer exists.
 */

const SERVER_KEY = 'mindex'

export function geminiSettingsFile(vaultRoot: string): string {
  return path.join(vaultRoot, '.gemini', 'settings.json')
}

async function readSettings(file: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch (e) {
    // Absent is normal. Malformed is the user's file and not ours to rewrite:
    // returning null makes both `register` and `unregister` leave it alone.
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? {} : null
  }
}

async function write(file: string, settings: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteText(file, `${JSON.stringify(settings, null, 2)}\n`)
}

/** Remove the folder and file we created, if nothing of ours is left in them. */
async function removeIfOurs(file: string, settings: Record<string, unknown>): Promise<void> {
  const servers = settings['mcpServers']
  const noServersLeft =
    !servers || (typeof servers === 'object' && Object.keys(servers).length === 0)
  if (noServersLeft) delete settings['mcpServers']

  if (Object.keys(settings).length > 0) {
    await write(file, settings)
    return
  }
  await fs.rm(file, { force: true })
  // Only if empty — the generated skill may well be next door.
  await fs.rmdir(path.dirname(file)).catch(() => {})
}

/** Point Gemini at the live bridge. Returns false if it could not be done. */
export async function registerGeminiMcp(vaultRoot: string): Promise<boolean> {
  const spec = await mcpServerSpec()
  if (!spec) return false

  const file = geminiSettingsFile(vaultRoot)
  const settings = await readSettings(file)
  if (!settings) return false

  const servers =
    typeof settings['mcpServers'] === 'object' && settings['mcpServers'] !== null
      ? ({ ...(settings['mcpServers'] as Record<string, unknown>) } as Record<string, unknown>)
      : {}

  servers[SERVER_KEY] = {
    command: spec.command,
    args: spec.args,
    env: spec.env
  }
  settings['mcpServers'] = servers
  await write(file, settings)
  return true
}

/** Take it back out, leaving anything the user put there. */
export async function unregisterGeminiMcp(vaultRoot: string): Promise<void> {
  const file = geminiSettingsFile(vaultRoot)
  const settings = await readSettings(file)
  if (!settings) return
  const servers = settings['mcpServers']
  if (typeof servers !== 'object' || servers === null) {
    if (Object.keys(settings).length === 0) await removeIfOurs(file, settings)
    return
  }
  const next = { ...(servers as Record<string, unknown>) }
  if (!(SERVER_KEY in next)) return
  delete next[SERVER_KEY]
  settings['mcpServers'] = next
  await removeIfOurs(file, settings)
}

/**
 * Bring the file in line with the active provider and the setting.
 *
 * Called wherever the generated skill is synced, and for the same reason: both
 * write into the vault on behalf of whichever CLI is currently answering, and
 * both have to clean up after a switch. The folder is created only when Gemini
 * is the provider actually in use — there is no reason to leave `.gemini/` in
 * the vault of somebody running Claude.
 */
export async function syncGeminiMcp(
  vaultRoot: string,
  opts: {
    provider: string
    enabled: boolean
  }
): Promise<void> {
  if (opts.provider === 'gemini' && opts.enabled) {
    await registerGeminiMcp(vaultRoot)
    return
  }
  await unregisterGeminiMcp(vaultRoot)
}
