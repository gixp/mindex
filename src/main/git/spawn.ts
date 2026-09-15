import { spawn } from 'node:child_process'
import { commonPaths } from '@main/providers/paths'
import { isCliMissing } from '@main/agent-engine/spawn'

export { isCliMissing }

const DEFAULT_GIT_TIMEOUT_MS = 15_000

export interface GitRunResult {
  code: number | null
  stdout: Buffer
  stderr: Buffer
  timedOut: boolean
}

export interface GitRunOptions {
  cwd: string
  timeoutMs?: number
  /** Push/pull/clone: fail fast instead of hanging on a credential prompt. */
  allowNetwork?: boolean
  /** Piped to the child's stdin, then the stream is closed — used for
   *  `commit -F -` so the message never touches argv escaping/newlines. */
  stdin?: string
  /**
   * A GitHub token to authenticate this one call with.
   *
   * Passed as config through `GIT_CONFIG_*` environment variables rather than
   * `-c` on the command line, because argv is world-readable through `ps` and
   * this is a credential. It is also never written to `.git/config`, so the
   * token does not end up in a file the user might share or commit.
   */
  githubToken?: string
}

/** git isn't one of the three agent-CLI providers, so it gets its own small
 *  PATH-repair helper rather than being folded into `ProviderId` — same
 *  underlying `commonPaths()` Homebrew/`~/.local/bin` list, since a
 *  Homebrew-installed git lives in exactly the same places. */
function ensureGitPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env }
  const wanted = commonPaths()
  const rest = (next.PATH ?? '').split(':').filter((p) => p && !wanted.includes(p))
  next.PATH = [...wanted, ...rest].join(':')
  delete next.ELECTRON_RUN_AS_NODE
  return next
}

/**
 * One-shot `git` invocation, modeled on `providers/detect.ts`'s
 * `probeVersion()` and `providers/install.ts`'s `installProvider()`.
 *
 * `allowNetwork` sets `GIT_TERMINAL_PROMPT=0` + `GIT_ASKPASS=echo` — without
 * it, a push/pull/clone against a repo needing credentials hangs forever
 * waiting for a TTY prompt that will never come, since this spawns with
 * piped stdio, not a PTY. Better a fast, clear failure than a silent hang.
 */
export function runGit(args: string[], opts: GitRunOptions): Promise<GitRunResult> {
  return new Promise((resolve) => {
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let settled = false
    let timedOut = false

    const env = ensureGitPath(process.env)
    if (opts.allowNetwork) {
      env.GIT_TERMINAL_PROMPT = '0'
      env.GIT_ASKPASS = 'echo'
    }
    if (opts.githubToken) {
      // Scoped to github.com so the header cannot leak to some other host a
      // repository happens to have a remote on.
      const basic = Buffer.from(`x-access-token:${opts.githubToken}`).toString('base64')
      env.GIT_CONFIG_COUNT = '1'
      env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader'
      env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`
    }

    const child = spawn('git', args, {
      cwd: opts.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const done = (result: GitRunResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, opts.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS)

    child.stdout?.on('data', (d: Buffer) => {
      stdout = Buffer.concat([stdout, d])
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr = Buffer.concat([stderr, d])
    })
    child.on('error', (e) => {
      // Surface ENOENT (git not installed) the same shape a normal failure
      // would take, so callers only need one error path.
      const message = isCliMissing(e) ? 'git is not installed' : e.message
      stderr = Buffer.concat([stderr, Buffer.from(message)])
      done({ code: null, stdout, stderr, timedOut })
    })
    child.on('exit', (code) => {
      done({ code, stdout, stderr, timedOut })
    })

    if (opts.stdin != null) {
      child.stdin?.end(opts.stdin)
    } else {
      child.stdin?.end()
    }
  })
}

/** The last non-empty stderr line — the same "take git's own tail" idiom
 *  `installProvider()` uses for npm's stderr. */
export function lastStderrLine(result: GitRunResult): string {
  const lines = result.stderr.toString('utf8').trim().split('\n')
  return lines[lines.length - 1] ?? ''
}
