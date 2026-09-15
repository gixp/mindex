import * as pty from 'node-pty'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureProviderPath } from '@main/providers/paths'

type PtySession = {
  id: string
  proc: pty.IPty
  dataDisp: { dispose(): void }
  exitDisp: { dispose(): void }
}

const sessions = new Map<string, PtySession>()

type DataHandler = (id: string, data: string) => void
type ExitHandler = (id: string, code: number) => void

let onData: DataHandler = () => {}
let onExit: ExitHandler = () => {}

export function bindTerminalHandlers(handlers: { onData: DataHandler; onExit: ExitHandler }): void {
  onData = handlers.onData
  onExit = handlers.onExit
}

export interface OpenTerminalOpts {
  cwd?: string
  cols?: number
  rows?: number
  command?: string
  args?: string[]
  env?: Record<string, string>
}

/**
 * Whether a command can actually be started, before trying to start it.
 *
 * A path with a separator in it is taken literally — that is what the shell
 * does — and anything else is looked up in PATH, in order, the same way
 * `posix_spawnp` will. This does not try to reproduce every rule (no PATHEXT
 * handling on Windows beyond the common extensions); it only has to be right
 * often enough to turn the common failure into a sentence instead of a system
 * call name. A false positive here just means the spawn fails as it did
 * before, with its own message.
 */
function resolvable(command: string, env: Record<string, string>): boolean {
  const isPath = command.includes('/') || (process.platform === 'win32' && command.includes('\\'))
  if (isPath) return fs.existsSync(command)

  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  const dirs = (env['PATH'] ?? '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const ext of exts) {
      try {
        if (fs.existsSync(path.join(dir, command + ext))) return true
      } catch {
        // An unreadable directory on PATH is not this function's problem.
      }
    }
  }
  return false
}

export function openTerminal(opts: OpenTerminalOpts = {}): { id: string } {
  const id = randomUUID()
  const defaultShell =
    process.platform === 'darwin'
      ? process.env['SHELL'] || '/bin/zsh'
      : process.platform === 'win32'
        ? 'powershell.exe'
        : process.env['SHELL'] || '/bin/bash'

  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v
  }
  env['TERM'] = env['TERM'] || 'xterm-256color'
  env['COLORTERM'] = env['COLORTERM'] || 'truecolor'
  const home = os.homedir()
  env['HOME'] = home
  if (process.platform !== 'win32') {
    const userInfo = os.userInfo()
    env['USER'] = env['USER'] || userInfo.username
    env['LOGNAME'] = env['LOGNAME'] || userInfo.username
  }
  // PATH repair, shared with the headless engine rather than copied here.
  // This block used to be its own inline copy that only knew Claude's install
  // directories, so a Gemini or Codex tab would have failed to find its binary
  // in the packaged app — where PATH comes from launchd and contains almost
  // nothing. `ensureProviderPath` also drops ELECTRON_RUN_AS_NODE and the
  // inherited Claude Code session markers.
  //
  // Replaced wholesale rather than merged: `ensureProviderPath` works by
  // *deleting* keys as well as setting them, and `Object.assign` only copies
  // what is present — so every variable it removed came straight back.
  const prepared = ensureProviderPath(env)
  for (const key of Object.keys(env)) {
    if (!(key in prepared)) delete env[key]
  }
  for (const [k, v] of Object.entries(prepared)) {
    if (typeof v === 'string') env[k] = v
  }
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) env[k] = v
  }

  // A folder that no longer exists is a spawn failure, not a warning. The
  // catch used to swallow the error and keep the path it had just proved
  // unusable, so opening a tab on a workspace that had been moved or deleted
  // failed with `posix_spawnp failed` and nothing else — a message about a
  // system call, for a missing folder. Home always exists.
  let cwd = opts.cwd && opts.cwd.length ? opts.cwd : home
  try {
    cwd = fs.realpathSync(cwd)
  } catch {
    cwd = home
  }

  const command = opts.command && opts.command.length ? opts.command : defaultShell
  const args = opts.args ?? []

  // What `posix_spawnp` says when it cannot find a binary is `posix_spawnp
  // failed`, with no name in it and no reason. That is what a person saw when
  // an assistant's CLI was not installed, or was installed somewhere the
  // packaged app's PATH does not reach — which is the single most likely way
  // for this to fail and the one with an obvious remedy. Resolving it here
  // costs one lookup and turns the message into something actionable.
  if (!resolvable(command, env)) {
    throw new Error(
      `Could not start \`${command}\`. It is not installed, or not on the PATH this app can see. ` +
        `If it is an assistant CLI, check Settings → AI; otherwise check your shell setting.`
    )
  }

  const proc = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    cwd,
    env
  })

  const dataDisp = proc.onData((data) => onData(id, data))
  const exitDisp = proc.onExit(({ exitCode }) => {
    onExit(id, exitCode)
    sessions.delete(id)
  })

  sessions.set(id, { id, proc, dataDisp, exitDisp })
  return { id }
}

export function writeTerminal(id: string, data: string): void {
  const s = sessions.get(id)
  if (!s) return
  s.proc.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const s = sessions.get(id)
  if (!s) return
  try {
    s.proc.resize(Math.max(1, cols | 0), Math.max(1, rows | 0))
  } catch {}
}

export function closeTerminal(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  try {
    s.dataDisp.dispose()
  } catch {
    /* ignore */
  }
  try {
    s.exitDisp.dispose()
  } catch {
    /* ignore */
  }
  try {
    s.proc.kill()
  } catch {}
}

export function closeAllTerminals(): void {
  for (const id of [...sessions.keys()]) closeTerminal(id)
}
