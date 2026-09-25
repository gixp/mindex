import { spawn } from 'node:child_process'
import path from 'node:path'
import { dialog } from 'electron'
import { providerSpec } from './registry'
import { ensureProviderPath, providerSearchPaths } from './paths'
import type { ProviderId } from './types'

/**
 * The exact runnable command from a spec's `loginHint`, stripped of any
 * human-readable aside appended after a double space — Gemini's hint reads
 * `'gemini  (then complete the browser sign-in)'`, where only `gemini` is
 * meant to actually run. Claude/Codex have no aside, so this is a no-op for
 * them.
 */
function loginCommand(id: ProviderId): string {
  const hint = providerSpec(id).loginHint
  return (hint.split('  ')[0] ?? hint).trim()
}

function escapeForAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function spawnAndWaitForExit(
  bin: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: 'ignore', env })
    child.on('error', (e) => resolve({ ok: false, error: e.message }))
    child.on('exit', (code) =>
      resolve(code === 0 ? { ok: true } : { ok: false, error: `${bin} exited ${code}` })
    )
  })
}

/** Resolves once the terminal process itself has launched — waiting for it
 *  to *exit* would block until the user closes the window. */
function trySpawnTerminal(bin: string, args: string[], env?: NodeJS.ProcessEnv): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: 'ignore', env })
    child.on('error', () => resolve(false))
    child.once('spawn', () => resolve(true))
  })
}

/**
 * Opens the OS's own terminal with a provider's login command pre-filled —
 * the user only has to press Enter. There is no in-app way to drive a CLI's
 * interactive/browser-based login flow, so this is the honest alternative to
 * a dead "Not signed in" label.
 */
export async function openLoginTerminal(id: ProviderId): Promise<{ ok: boolean; error?: string }> {
  const command = loginCommand(id)
  // A terminal window knows nothing about where Mindex keeps things. An
  // assistant installed through the welcome screen lives in Mindex's own
  // private directory, which is on no one's PATH, so the window opened for the
  // sign-in could not find the program it was told to run — install an
  // assistant, press Sign in, and the terminal answers "not recognized". On
  // macOS and Linux the same directory holds the Node those CLIs need, so even
  // naming the program by its full path would not have been enough; the
  // directory itself has to be on PATH.
  const env = ensureProviderPath(process.env, id)

  if (process.platform === 'darwin') {
    // Terminal is already running and is nobody's child, so it inherits
    // nothing from here: the path has to travel inside the script it is asked
    // to run. Single-quoted, because a home directory can have a space in it.
    const prefix = `export PATH='${providerSearchPaths(id).join(path.delimiter)}':"$PATH"; `
    const script = [
      'tell application "Terminal"',
      `  do script "${escapeForAppleScript(prefix + command)}"`,
      '  activate',
      'end tell'
    ].join('\n')
    return await spawnAndWaitForExit('osascript', ['-e', script])
  }

  // Windows and Linux open a terminal as a child of this process, and a child
  // inherits the environment — so the prepared PATH reaches the window without
  // anything having to be quoted into the command line.
  if (process.platform === 'win32') {
    return await spawnAndWaitForExit('cmd', ['/c', 'start', 'cmd', '/k', command], env)
  }

  // Linux has no single universal terminal emulator — try common ones in
  // order before falling back to a dialog the user can copy the command
  // from.
  const candidates: [string, string[]][] = [
    ['x-terminal-emulator', ['-e', command]],
    ['gnome-terminal', ['--', 'bash', '-lc', command]],
    ['konsole', ['-e', command]],
    ['xterm', ['-e', command]]
  ]
  for (const [bin, args] of candidates) {
    if (await trySpawnTerminal(bin, args, env)) return { ok: true }
  }
  void dialog.showMessageBox({
    type: 'info',
    message: 'No terminal emulator found',
    detail: `Run this command in a terminal:\n\n${command}`
  })
  return { ok: false, error: 'No terminal emulator found on this system' }
}
