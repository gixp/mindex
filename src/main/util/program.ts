import { ChildProcess, spawn, type SpawnOptions } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'

/**
 * What it takes to start a program here: the file to execute and the
 * arguments to give it.
 *
 * On macOS and Linux that is exactly what was asked for.
 *
 * Windows is different for one family of programs — npm, npx, and every CLI
 * installed through npm, which includes Claude Code, Codex and Gemini CLI when
 * they were installed that way. None of those are programs. Each is a `.cmd`
 * launcher script whose whole job is to start something else — `node` with a
 * JavaScript file, or a native `.exe` shipped inside the package — and Node
 * treats those scripts in two ways that each break us:
 *
 *  - given one by path (`npm.cmd`), it refuses: `spawn EINVAL`. That is the
 *    April 2024 fix for CVE-2024-27980, and it is permanent — batch files are
 *    only allowed through the shell.
 *  - given a bare name (`claude`), it does not look for one at all. libuv
 *    searches PATH for `.com` and `.exe` only, so a CLI installed through npm
 *    was reported as not installed rather than as failing.
 *
 * The shell would make both work, and would put every argument through
 * cmd.exe's parsing on the way: a path with a space in it comes apart, and
 * anything that reaches an argument becomes a way to run other commands. So
 * the launcher is read instead of run. It says what it would start, and we
 * start exactly that ourselves — no shell in between, so nothing to quote and
 * nothing to escape. It also means no intermediate process: stopping the child
 * stops the CLI, rather than a cmd.exe that leaves the CLI running behind it.
 */
export interface Program {
  file: string
  args: string[]
  /**
   * Set when `file` is a launcher script that could not be read. Windows will
   * not start it without the shell (spawn EINVAL, thrown rather than
   * reported), so it must not be spawned at all — see `spawnProgram`.
   */
  refused?: string
}

/** What resolution reads from the machine. Injectable so the Windows rules can
 *  be tested from any platform. */
export interface ProgramHost {
  platform: NodeJS.Platform
  isFile(p: string): boolean
  read(p: string): string
}

const realHost: ProgramHost = {
  platform: process.platform,
  isFile: (p) => {
    try {
      return statSync(p).isFile()
    } catch {
      return false
    }
  },
  read: (p) => readFileSync(p, 'utf8')
}

/**
 * Only the extensions that are programs, or launchers this file knows how to
 * read. A stock PATHEXT also lists `.js`, `.vbs` and similar, which Windows
 * hands to Script Host — not something to start by accident because a file
 * happened to share a CLI's name.
 */
const RUNNABLE = ['.com', '.exe', '.bat', '.cmd']
const PROGRAMS_ONLY = ['.com', '.exe']

export function resolveProgram(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  host: ProgramHost = realHost
): Program {
  const asAsked = { file: command, args: [...args] }
  if (host.platform !== 'win32') return asAsked

  // Not found is left to spawn, so it fails exactly the way it always has —
  // ENOENT, which the callers already turn into "not installed".
  const found = locate(command, env, host, RUNNABLE)
  if (!found) return asAsked

  const ext = path.win32.extname(found).toLowerCase()
  if (ext !== '.cmd' && ext !== '.bat') return { file: found, args: [...args] }

  const target = readLauncher(found, host)
  if (!target) {
    return {
      file: found,
      args: [...args],
      refused: `${found} is a launcher script Mindex cannot read, and Windows only runs those through the shell`
    }
  }
  if (!target.viaNode) return { file: target.program, args: [...args] }

  const node = nodeFor(found, env, host)
  if (!node) {
    return {
      file: found,
      args: [...args],
      refused: `${found} needs Node.js, and there is no node.exe beside it or on PATH`
    }
  }
  return { file: node, args: [target.program, ...args] }
}

/**
 * `spawn`, with `command` resolved first (see `resolveProgram`).
 *
 * `windowsHide` because the program may now be `node.exe` itself, and a console
 * program started from a windowed app is given a console window of its own
 * unless told otherwise — a black window standing open for as long as a chat
 * session lasts.
 *
 * A launcher that could not be read is never handed to spawn: Windows refuses
 * it by *throwing*, and every caller here listens for an `error` event
 * instead — detection would have crashed where it should have said "not
 * installed". It gets a child that never starts and reports the reason the
 * way a missing program is reported: asynchronously, as `error`.
 */
export function spawnProgram(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
  host: ProgramHost = realHost
): ChildProcess {
  const resolved = resolveProgram(command, args, options.env ?? process.env, host)
  if (resolved.refused) {
    console.warn(`[program] not starting: ${resolved.refused}`)
    return failedChild(Object.assign(new Error(resolved.refused), { code: 'EINVAL' }))
  }
  return spawn(
    resolved.file,
    resolved.args,
    host.platform === 'win32' ? { windowsHide: true, ...options } : options
  )
}

/**
 * A child process that was never started and says why.
 *
 * It has all three streams, empty, because callers attach to them the moment
 * they get the child — the chat connection reads `stdout` in its constructor —
 * and a null there would turn a clear reason into a TypeError.
 */
function failedChild(error: Error): ChildProcess {
  const child = new ChildProcess()
  for (const name of ['stdin', 'stdout', 'stderr'] as const) {
    Object.defineProperty(child, name, { value: new PassThrough(), configurable: true })
  }
  process.nextTick(() => {
    child.emit('error', error)
    child.stdout?.emit('end')
    child.stderr?.emit('end')
  })
  return child
}

/**
 * An environment variable by name, the way Windows reads it.
 *
 * Names are case-insensitive there, but an env object copied out of
 * `process.env` is a plain object and is not — the usual spelling is `Path`,
 * and code that writes `PATH` beside it leaves two. Node settles that for a
 * child by sorting the keys and taking the first match, so this does the same:
 * whatever value it reads is the value the child will see.
 */
export function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const upper = name.toUpperCase()
  const keys = Object.keys(env)
    .filter((k) => k.toUpperCase() === upper)
    .sort()
  for (const k of keys) {
    const v = env[k]
    if (v !== undefined) return v
  }
  return undefined
}

/**
 * Where `command` is, the way Windows would find it — PATH in order, and within
 * each directory the extensions in PATHEXT order.
 *
 * The current directory is deliberately not searched first, although cmd.exe
 * does. Mindex starts these with a vault as the working directory, and a
 * `claude.cmd` sitting in someone's notes should not outrank the real one.
 */
function locate(
  command: string,
  env: NodeJS.ProcessEnv,
  host: ProgramHost,
  allowed: string[]
): string | null {
  const w = path.win32
  const exts = extensions(env, allowed)
  const names = allowed.includes(w.extname(command).toLowerCase())
    ? [command]
    : exts.map((e) => command + e)

  if (w.isAbsolute(command) || command.includes('\\') || command.includes('/')) {
    return names.find((n) => host.isFile(n)) ?? null
  }
  for (const dir of searchDirs(env)) {
    for (const n of names) {
      const p = w.join(dir, n)
      if (host.isFile(p)) return p
    }
  }
  return null
}

function extensions(env: NodeJS.ProcessEnv, allowed: string[]): string[] {
  const fromEnv = (envValue(env, 'PATHEXT') ?? '')
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => allowed.includes(e))
  return fromEnv.length > 0 ? [...new Set(fromEnv)] : allowed
}

function searchDirs(env: NodeJS.ProcessEnv): string[] {
  return (envValue(env, 'PATH') ?? '')
    .split(';')
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
}

/**
 * What a launcher would start, or null if this is not a launcher it
 * recognises. `viaNode` says whether that is a script to hand to node or a
 * program to start directly.
 *
 * Three shapes exist, all read from real files rather than from memory:
 *
 *  - a CLI written in JavaScript, launcher written by npm's cmd-shim:
 *      "%_prog%"  "%dp0%\node_modules\@google\gemini-cli\dist\index.js" %*
 *    where `_prog` is node. cmd-shim writes this same file for whatever
 *    interpreter a script's first line names, so checking for node is what
 *    keeps a shell script from being handed to node.
 *  - a CLI that ships a native program, also by cmd-shim — Claude Code's npm
 *    package has done this since it stopped shipping JavaScript:
 *      "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*
 *    No interpreter at all; the `.exe` is started as it is. Only a `.exe` or
 *    `.com` is accepted here: the same shape pointing at a `.js` would have
 *    Windows open it with Script Host, not node.
 *  - npm's and npx's own, shipped inside Node:
 *      SET "NPM_CLI_JS=%~dp0\node_modules\npm\bin\npm-cli.js"
 *    Matched by that variable, not by the first `.js` in the file: the first
 *    one is npm-prefix.js, a helper, and running it instead of npm prints a
 *    directory and exits successfully having installed nothing.
 *    (That launcher can also switch to an npm upgraded into the global
 *    prefix. For the runtime Mindex installs that prefix is the runtime
 *    itself, so it names this same file.)
 */
function readLauncher(
  launcher: string,
  host: ProgramHost
): { program: string; viaNode: boolean } | null {
  let text: string
  try {
    text = host.read(launcher)
  } catch {
    return null
  }
  const dir = path.win32.dirname(launcher)
  const existing = (rel: string): string | null => {
    const p = path.win32.join(dir, rel)
    return host.isFile(p) ? p : null
  }

  if (/%_prog%/i.test(text)) {
    const cmdShim = /"%_prog%"\s+"%dp0%\\([^"]+)"/i.exec(text)
    if (!cmdShim?.[1] || !/SET\s+"_prog=node"/i.test(text)) return null
    const script = existing(cmdShim[1])
    return script ? { program: script, viaNode: true } : null
  }

  const npmOwn = /SET\s+"NP[MX]_CLI_JS=%~dp0\\([^"]+)"/i.exec(text)
  if (npmOwn?.[1]) {
    const script = existing(npmOwn[1])
    return script ? { program: script, viaNode: true } : null
  }

  const direct = /"%dp0%\\([^"]+)"\s+%\*/i.exec(text)
  if (direct?.[1] && PROGRAMS_ONLY.includes(path.win32.extname(direct[1]).toLowerCase())) {
    const program = existing(direct[1])
    return program ? { program, viaNode: false } : null
  }

  return null
}

/**
 * The node a launcher would use: the `node.exe` beside it if there is one —
 * both node shapes check that first — and otherwise `node` from PATH. Only a
 * real `node.exe` counts; a `node.cmd` would be the same problem one level
 * down.
 */
function nodeFor(launcher: string, env: NodeJS.ProcessEnv, host: ProgramHost): string | null {
  const beside = path.win32.join(path.win32.dirname(launcher), 'node.exe')
  if (host.isFile(beside)) return beside
  return locate('node', env, host, PROGRAMS_ONLY)
}
