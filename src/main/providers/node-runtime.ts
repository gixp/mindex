import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type { NodeRuntimeStatus } from '@shared/types'
import { downloadWithProgress, verifySha256, runCommand } from '@main/util/download'

// A private Node.js runtime under Mindex's own directory — never touching
// the system PATH, the registry, or requiring admin/elevation. Every CLI
// install (`npm install -g <pkg>`, see ../providers/install.ts) runs through
// *this* npm specifically, so it no longer depends on whatever Node state
// (working, broken, or absent) happens to exist on the user's machine.
//
// Pinned to a major LTS line, not an exact patch — `latest-v<major>.x` is
// nodejs.org's own always-current alias for that line, so this can't go
// stale by pointing at a withdrawn patch release.
const NODE_MAJOR = '22'

export function nodeRuntimeDir(): string {
  return path.join(os.homedir(), '.mindex', 'node-runtime')
}

function nodeBinDir(): string {
  const dir = nodeRuntimeDir()
  // Windows' official archives put the binaries at the extracted root;
  // macOS/Linux nest them under bin/.
  return process.platform === 'win32' ? dir : path.join(dir, 'bin')
}

export function nodeBinPath(): string {
  return path.join(nodeBinDir(), process.platform === 'win32' ? 'node.exe' : 'node')
}

export function npmBinPath(): string {
  return path.join(nodeBinDir(), process.platform === 'win32' ? 'npm.cmd' : 'npm')
}

/**
 * The bundled `npx`, which is how ACP adapters are run (see ../acp/launch.ts).
 *
 * Windows ships both an extensionless `npx` — a shell script Windows cannot
 * execute — and `npx.cmd`; naming the `.cmd` explicitly is what lets it start.
 */
export function npxBinPath(): string {
  return path.join(nodeBinDir(), process.platform === 'win32' ? 'npx.cmd' : 'npx')
}

/** Added to the front of a spawned CLI's PATH once the runtime exists, so a
 *  CLI installed through it can be found by name afterwards (see paths.ts). */
export function nodeRuntimeSearchPath(): string {
  return nodeBinDir()
}

function distTarget(): { platform: string; arch: string; ext: 'tar.gz' | 'zip' } {
  const platform =
    process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz'
  return { platform, arch, ext }
}

function isRuntimeReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(nodeBinPath(), ['--version'], { stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('exit', (code) => resolve(code === 0))
  })
}

/**
 * Finds the exact current build for this platform/arch under nodejs.org's
 * `latest-v<major>.x` alias, without hardcoding a specific patch version.
 * Parses the published checksum manifest — which doubles as the sha256 the
 * download is verified against, essentially for free.
 */
async function resolveLatestBuild(): Promise<{ url: string; filename: string; sha256: string }> {
  const { platform, arch, ext } = distTarget()
  const base = `https://nodejs.org/dist/latest-v${NODE_MAJOR}.x`
  const res = await fetch(`${base}/SHASUMS256.txt`)
  if (!res.ok) throw new Error(`Could not reach nodejs.org (HTTP ${res.status}).`)
  const text = await res.text()
  const suffix = `-${platform}-${arch}.${ext}`
  const line = text.split('\n').find((l) => l.trim().endsWith(suffix))
  if (!line) throw new Error(`No Node.js build found for ${platform}-${arch}.`)
  const [sha256, filename] = line.trim().split(/\s+/)
  if (!sha256 || !filename) throw new Error('Could not parse the Node.js build manifest.')
  return { url: `${base}/${filename}`, filename, sha256 }
}

async function extractArchive(
  archivePath: string,
  ext: 'tar.gz' | 'zip',
  destDir: string
): Promise<void> {
  if (ext === 'zip') {
    new AdmZip(archivePath).extractAllTo(destDir, true)
    return
  }
  // `tar` is a system utility on macOS/Linux, not a Node dependency — safe
  // to shell out to even before Node.js itself exists on this machine.
  await runCommand('tar', ['-xzf', archivePath, '-C', destDir])
}

/**
 * Downloads and installs the private runtime if it isn't already there and
 * working. Safe to call every time before an install — the ready-check at
 * the top makes repeat calls cheap once it exists.
 */
export async function ensureNodeRuntime(
  onStatus?: (status: NodeRuntimeStatus) => void
): Promise<{ ok: boolean; error?: string }> {
  onStatus?.({ phase: 'checking' })
  if (await isRuntimeReady()) {
    onStatus?.({ phase: 'ready' })
    return { ok: true }
  }

  const mindexDir = path.join(os.homedir(), '.mindex')
  let work: string | null = null
  try {
    await fs.mkdir(mindexDir, { recursive: true })
    // Staged inside ~/.mindex itself (not the system tmpdir) so the final
    // move is a same-filesystem rename, not a cross-device copy that could
    // fail partway through.
    work = await fs.mkdtemp(path.join(mindexDir, '.tmp-node-'))

    const { url, filename, sha256 } = await resolveLatestBuild()
    const archivePath = path.join(work, filename)

    onStatus?.({ phase: 'downloading', progress: 0 })
    await downloadWithProgress(url, archivePath, (progress) =>
      onStatus?.({ phase: 'downloading', progress })
    )

    if (!(await verifySha256(archivePath, sha256))) {
      throw new Error('Downloaded Node.js build failed its integrity check.')
    }

    onStatus?.({ phase: 'extracting' })
    const { ext } = distTarget()
    await extractArchive(archivePath, ext, work)

    // The archive's own top-level folder is named after its exact version
    // (e.g. `node-v22.14.0-darwin-arm64`) — moved to a version-independent
    // path so nothing else needs to know which patch got installed.
    const extractedName = (await fs.readdir(work)).find((n) => n.startsWith('node-v'))
    if (!extractedName) throw new Error('Extracted Node.js archive had an unexpected layout.')
    const runtimeDir = nodeRuntimeDir()
    await fs.rm(runtimeDir, { recursive: true, force: true })
    await fs.rename(path.join(work, extractedName), runtimeDir)

    if (!(await isRuntimeReady())) throw new Error('Node.js was extracted but did not run.')
    onStatus?.({ phase: 'ready' })
    return { ok: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    onStatus?.({ phase: 'error', error })
    return { ok: false, error }
  } finally {
    if (work) await fs.rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}
