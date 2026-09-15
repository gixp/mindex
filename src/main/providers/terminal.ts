import { spawn } from 'node:child_process'
import { dialog } from 'electron'
import { providerSpec } from './registry'
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
  args: string[]
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: 'ignore' })
    child.on('error', (e) => resolve({ ok: false, error: e.message }))
    child.on('exit', (code) =>
      resolve(code === 0 ? { ok: true } : { ok: false, error: `${bin} exited ${code}` })
    )
  })
}

/** Resolves once the terminal process itself has launched — waiting for it
 *  to *exit* would block until the user closes the window. */
function trySpawnTerminal(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: 'ignore' })
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

  if (process.platform === 'darwin') {
    const script = [
      'tell application "Terminal"',
      `  do script "${escapeForAppleScript(command)}"`,
      '  activate',
      'end tell'
    ].join('\n')
    return await spawnAndWaitForExit('osascript', ['-e', script])
  }

  if (process.platform === 'win32') {
    return await spawnAndWaitForExit('cmd', ['/c', 'start', 'cmd', '/k', command])
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
    if (await trySpawnTerminal(bin, args)) return { ok: true }
  }
  void dialog.showMessageBox({
    type: 'info',
    message: 'No terminal emulator found',
    detail: `Run this command in a terminal:\n\n${command}`
  })
  return { ok: false, error: 'No terminal emulator found on this system' }
}
