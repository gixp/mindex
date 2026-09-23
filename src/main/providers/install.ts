import { spawnProgram } from '@main/util/program'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { NodeRuntimeStatus } from '@shared/types'
import type { ProviderId } from './types'
import { providerSpec } from './registry'
import { ensureProviderPath } from './paths'
import { ensureNodeRuntime, nodeRuntimeDir, npmBinPath } from './node-runtime'

// A first install fetches a whole CLI bundle — tens of megabytes — over
// whatever connection the person has. Two minutes was short enough that a
// slow link got the install killed mid-write and a report of a timeout.
const INSTALL_TIMEOUT_MS = 300_000

function broadcastNodeRuntimeStatus(status: NodeRuntimeStatus): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(IPC.providerEvents.nodeRuntimeStatus, status)
  }
}

/**
 * The last non-empty stderr line that actually says something — npm's own
 * "A complete log of this run can be found in: ...debug-0.log" trailer (and
 * the indented log-path line after it) is never useful to show, but used to
 * be exactly what `.slice(-1)[0]` picked.
 */
function pickErrorLine(stderr: string): string | null {
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (/a complete log of this run/i.test(line)) continue
    if (/\.log$/i.test(line) || /_logs[/\\]/.test(line)) continue
    return line
  }
  return null
}

/**
 * npm's own configuration, inherited from whoever started Mindex.
 *
 * `npm run dev` and `npm start` export a full set of `npm_config_*` variables
 * into every child process, and `npm_config_prefix` among them names *that*
 * npm's global directory. The bundled npm honours it, so an install ran
 * through Mindex's private runtime and then wrote the package into Homebrew's
 * tree instead — leaving the runtime empty and the CLI wherever the outer npm
 * happened to point. Verified on this machine: a provider installed from the
 * app landed in /opt/homebrew, not in ~/.mindex.
 *
 * Cleared rather than trusted. The prefix is then stated outright below, so
 * neither an inherited variable nor a user's own `.npmrc` can move it.
 */
function withoutInheritedNpmConfig(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env }
  for (const key of Object.keys(next)) {
    if (key.toLowerCase().startsWith('npm_config_')) delete next[key]
  }
  return next
}

function runNpmInstall(npmPackage: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let stderr = ''
    let settled = false
    const done = (r: { ok: boolean; error?: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }

    // The bundled runtime's own npm, by its full path — not the bare
    // `'npm'` string resolved off the user's PATH, which is what made
    // installs depend on whatever Node state happened to exist locally.
    // `--prefix` on the command line, not just a clean environment: a flag
    // outranks both `npm_config_prefix` and any `prefix=` line in the user's
    // own .npmrc, and this install has exactly one correct destination —
    // the private runtime, which is the only directory the detection code
    // below is guaranteed to look in.
    const child = spawnProgram(
      npmBinPath(),
      ['install', '-g', '--prefix', nodeRuntimeDir(), npmPackage],
      {
        env: withoutInheritedNpmConfig(ensureProviderPath(process.env)),
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      done({ ok: false, error: 'Timed out' })
    }, INSTALL_TIMEOUT_MS)

    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') {
        return done({ ok: false, error: 'Could not run the bundled npm — try again.' })
      }
      done({ ok: false, error: e.message })
    })
    child.on('exit', (code) => {
      if (code === 0) return done({ ok: true })
      const line = pickErrorLine(stderr)
      done({
        ok: false,
        error:
          line ?? 'Install failed — try again, or run the command from Settings → Engine manually.'
      })
    })
  })
}

/**
 * `npm install -g <package>`, run through Mindex's own private Node.js
 * runtime (see node-runtime.ts) — set up on demand if it isn't ready yet,
 * so this no longer depends on whatever Node/npm state exists on the user's
 * machine.
 */
export async function installProvider(id: ProviderId): Promise<{ ok: boolean; error?: string }> {
  const spec = providerSpec(id)
  const node = await ensureNodeRuntime(broadcastNodeRuntimeStatus)
  if (!node.ok) return { ok: false, error: node.error ?? 'Could not set up Node.js.' }
  return await runNpmInstall(spec.npmPackage)
}
