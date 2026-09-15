import { app, BrowserWindow, shell } from 'electron'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { IPC } from '@shared/ipc-channels'
import { DOWNLOAD_PAGE, fetchMacRelease, fetchReleaseNotes, isNewer } from './feed'
import { downloadWithProgress, runCommand } from '@main/util/download'

/**
 * Updates, offered and never imposed.
 *
 * What this used to do: read a floor from a database on launch and every five
 * minutes, and if the installed version was below it, download and install by
 * itself — on macOS a ~180 MB fetch nobody asked for — behind a screen the
 * person could not dismiss until it finished.
 *
 * That was removed on 2026-09-02, on two grounds. The founder's: a release
 * should be offered and accepted, not administered. And a structural one that
 * settles it either way — with the source published, a floor the client
 * enforces against itself is bypassed by editing one line and rebuilding. It
 * never held against anyone unwilling; it only cost everyone else a choice
 * they would have made anyway.
 *
 * The shape below is borrowed, deliberately, from two comparable products that
 * arrived at it independently (`inkeep/open-knowledge`, `refactoringhq/tolaria`
 * — both open source, both shipping this today):
 *
 *  - **Nothing downloads unasked.** `autoDownload` is off.
 *  - **It installs when the app closes**, not when the app demands. The person
 *    agrees once and never thinks about it again — no restart, no progress bar
 *    across their work. Linux is excluded: there the package manager owns
 *    installation, and an app that swaps its own files fights it.
 *  - **Checked hourly, with jitter.** Once at launch is wrong for the people
 *    who never close the app — precisely the ones a fix is aimed at. The
 *    random spread matters on its own: without it every installed copy asks
 *    in the same second after a release lands.
 *  - **A nudge after a week**, once, if something staged never got installed.
 *  - **Quiet for ten minutes after installing one**, so the first thing a new
 *    version does is not talk about updates.
 *  - **A relaunch watchdog**, so a relaunch that does not happen re-arms the
 *    button instead of leaving a dead one.
 */

const CHECK_INTERVAL_MS = 60 * 60 * 1000
/** Spread, so a release does not summon every copy at once. */
const CHECK_JITTER_MS = 5 * 60 * 1000
/** How long a staged update may sit uninstalled before the app mentions it. */
/** No update talk for this long after one was applied. */
const QUIET_AFTER_UPDATE_MS = 10 * 60 * 1000
/** If the app has not gone away by now, the relaunch did not take. */
const RELAUNCH_WATCHDOG_MS = 15_000

let status: UpdateStatus = { phase: 'idle', currentVersion: app.getVersion() }
/** The macOS artefact to install, once a check has found one. */
let macRelease: { version: string; url: string; sha512: string } | null = null
let busy = false
let checkTimer: ReturnType<typeof setTimeout> | null = null
let watchdog: ReturnType<typeof setTimeout> | null = null
let quietUntil = 0

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(IPC.updateEvents.status, status)
  }
}

function setStatus(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  broadcast()
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

function inQuietWindow(): boolean {
  return Date.now() < quietUntil
}

/**
 * Ask the feed whether there is something newer. Never throws, and never
 * downloads.
 *
 * `quiet` skips the visible 'checking' phase, so the hourly re-read does not
 * flicker a spinner over a session that is fine.
 */
export async function checkForUpdate({ quiet = false } = {}): Promise<void> {
  if (busy) return
  // 'ready' means something is already staged for the next close. Re-checking
  // underneath it would drop that back to 'available' and lose the fact that
  // the person already said yes.
  if (status.phase === 'ready' || status.phase === 'downloading') return
  if (!quiet) setStatus({ phase: 'checking' })

  const notes = await fetchReleaseNotes()
  const latest =
    process.platform === 'darwin'
      ? ((macRelease = await fetchMacRelease()), macRelease?.version)
      : notes?.version

  if (!latest || !isNewer(latest)) {
    setStatus({ phase: 'idle', latestVersion: undefined, description: undefined, notes: undefined })
    return
  }
  if (inQuietWindow()) return

  setStatus({
    phase: 'available',
    latestVersion: latest,
    description: notes?.description,
    notes: notes?.notes
  })
}

/** Check now, then hourly with jitter. Call once, at startup. */
export function startUpdateChecks(): void {
  void checkForUpdate({ quiet: true })
  const schedule = (): void => {
    const delay = CHECK_INTERVAL_MS + Math.floor(Math.random() * CHECK_JITTER_MS)
    checkTimer = setTimeout(() => {
      void checkForUpdate({ quiet: true }).finally(schedule)
    }, delay)
    // Never the reason the process stays alive at quit.
    checkTimer.unref?.()
  }
  schedule()
}

export function stopUpdateChecks(): void {
  if (checkTimer) clearTimeout(checkTimer)
  if (watchdog) clearTimeout(watchdog)
  checkTimer = watchdog = null
}

/**
 * Download the update the person just accepted.
 *
 * Only ever reached from a deliberate press. On Windows and Linux the staged
 * file installs itself when the app next closes; on macOS the bundle has to be
 * swapped, which means quitting now.
 */
export async function startUpdate(): Promise<void> {
  if (busy) return
  busy = true
  try {
    if (process.platform === 'darwin') await runMacUpdate()
    else await runElectronUpdater()
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }
}

/** Close now so a staged update applies, instead of waiting for the next quit. */
export function installNow(): void {
  if (status.phase !== 'ready') return
  applyAndRelaunch()
}

/**
 * Finish the job: quit, install, come back.
 *
 * Pressing Install means installing, and an update that is downloaded and then
 * left to wait for a quit is an update that has not happened — for the people
 * who never close the app, which is exactly who a fix is aimed at, it may not
 * happen for weeks. macOS has always ended this way, because a bundle swap
 * cannot be done from inside the running bundle; now the others do too.
 *
 * Linux is still not here: a package manager owns what is installed there, and
 * the download ends by saying so.
 */
function applyAndRelaunch(): void {
  setStatus({ phase: 'installing' })
  armRelaunchWatchdog()
  if (process.platform === 'darwin') {
    // The mac path already staged a helper that waits for this process.
    app.quit()
    return
  }
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}

/**
 * If the app is still here after fifteen seconds, the relaunch did not take.
 *
 * Leaving the screen on 'installing' forever is the worst outcome: nothing is
 * happening and the button that would try again is gone. Re-arming costs
 * nothing and the update is still staged.
 */
function armRelaunchWatchdog(): void {
  if (watchdog) clearTimeout(watchdog)
  watchdog = setTimeout(() => {
    if (status.phase !== 'installing') return
    setStatus({
      phase: 'ready',
      error: 'The app did not restart. Quit and reopen it to finish updating.'
    })
  }, RELAUNCH_WATCHDOG_MS)
  watchdog.unref?.()
}

/** Record that a version was just installed, so the new one starts quietly. */
export function noteUpdateApplied(): void {
  quietUntil = Date.now() + QUIET_AFTER_UPDATE_MS
}

function fail(message: string): void {
  busy = false
  setStatus({ phase: 'manual', error: message })
}

/** Open the download page — the way through when the app cannot install. */
export async function openDownloadPage(): Promise<void> {
  await shell.openExternal(DOWNLOAD_PAGE)
}

// --- Windows / Linux: electron-updater --------------------------------------

async function runElectronUpdater(): Promise<void> {
  if (!app.isPackaged) {
    fail('Updates are only available in the installed app.')
    return
  }
  autoUpdater.autoDownload = false
  // One feed, and pre-release builds are not offered: there is one kind of
  // release now.
  autoUpdater.channel = 'latest'
  autoUpdater.allowPrerelease = false
  // The whole point: it lands on close, with nothing demanded. Not on Linux —
  // there a package manager owns what is installed, and an app rewriting its
  // own files behind one causes exactly the mess it looks like.
  autoUpdater.autoInstallOnAppQuit = process.platform !== 'linux'
  autoUpdater.removeAllListeners()

  autoUpdater.on('update-available', () => {
    setStatus({ phase: 'downloading', progress: 0 })
    void autoUpdater.downloadUpdate().catch((e: unknown) => {
      fail(e instanceof Error ? e.message : String(e))
    })
  })
  autoUpdater.on('update-not-available', () => {
    busy = false
    setStatus({ phase: 'idle' })
  })
  autoUpdater.on('download-progress', (p) => {
    setStatus({ phase: 'downloading', progress: (p.percent ?? 0) / 100 })
  })
  autoUpdater.on('update-downloaded', () => {
    busy = false
    if (process.platform === 'linux') {
      // Nothing was staged for a quit that will not apply it.
      setStatus({ phase: 'manual', error: 'Install the new package to finish updating.' })
      return
    }
    // Straight through rather than staging and waiting for a quit. The person
    // pressed Install, which is one decision, not two.
    applyAndRelaunch()
  })
  autoUpdater.on('error', (e) => {
    fail(e instanceof Error ? e.message : String(e))
  })

  await autoUpdater.checkForUpdates()
}

// --- macOS: download + bundle swap ------------------------------------------
//
// Squirrel.Mac refuses to install an unsigned build, so the update is applied
// by replacing the bundle. This whole path is deleted when the Apple
// certificate arrives and electron-updater can handle macOS like the others.

async function runMacUpdate(): Promise<void> {
  if (!app.isPackaged) {
    fail('Updates are only available in the installed app.')
    return
  }
  const release = macRelease
  if (!release) {
    fail('No update was found for this platform.')
    return
  }

  setStatus({ phase: 'downloading', progress: 0 })
  const work = await mkdtemp(path.join(tmpdir(), 'mindex-update-'))
  const zipPath = path.join(work, 'update.zip')
  await downloadWithProgress(release.url, zipPath, (progress) =>
    setStatus({ phase: 'downloading', progress })
  )

  // The feed publishes a checksum for every artefact, so there is no reason to
  // install bytes that do not match it. A mismatch is usually a CDN edge still
  // holding the previous object mid-release rather than anything sinister —
  // and it fixes itself, which is why this fails rather than retries.
  if (!(await verifySha512(zipPath, release.sha512))) {
    throw new Error('The downloaded update did not match its published checksum.')
  }

  setStatus({ phase: 'installing' })
  // `ditto -x -k` extracts a zip while preserving macOS bundle metadata.
  await runCommand('/usr/bin/ditto', ['-x', '-k', zipPath, work])
  const newApp = await findDotApp(work)
  if (!newApp) throw new Error('No .app bundle found inside the update package.')

  const destApp = currentAppBundlePath()
  if (!destApp) throw new Error('Could not locate the installed app bundle.')

  // A detached helper waits for THIS process to exit, swaps the bundle, relaunches.
  const helper = path.join(work, 'apply-update.sh')
  await writeFile(helper, MAC_REPLACE_SCRIPT, 'utf8')
  await chmod(helper, 0o755)

  const child = spawn('/bin/bash', [helper, String(process.pid), newApp, destApp], {
    detached: true,
    stdio: 'ignore'
  })
  child.unref()
  armRelaunchWatchdog()
  // Quit so the helper can replace the (now closed) bundle and reopen it.
  setTimeout(() => app.quit(), 400)
}

/** electron-builder publishes base64 SHA-512, not hex. */
async function verifySha512(file: string, expectedBase64: string): Promise<boolean> {
  const hash = createHash('sha512')
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve())
      .on('error', reject)
  })
  return hash.digest('base64') === expectedBase64
}

// Waits for the running app to exit, replaces the bundle, strips quarantine so the
// swapped (unsigned) app isn't blocked by Gatekeeper on relaunch, then reopens it.
const MAC_REPLACE_SCRIPT = `#!/bin/bash
set -e
TARGET_PID="$1"
NEW_APP="$2"
DEST_APP="$3"
while kill -0 "$TARGET_PID" 2>/dev/null; do sleep 0.3; done
sleep 0.5
rm -rf "$DEST_APP"
/usr/bin/ditto "$NEW_APP" "$DEST_APP"
/usr/bin/xattr -dr com.apple.quarantine "$DEST_APP" 2>/dev/null || true
open "$DEST_APP"
`

function currentAppBundlePath(): string | null {
  const exe = app.getPath('exe') // /Applications/Mindex.app/Contents/MacOS/Mindex
  const idx = exe.indexOf('.app/')
  if (idx === -1) return null
  return exe.slice(0, idx + '.app'.length)
}

async function findDotApp(dir: string): Promise<string | null> {
  const entries = await readdir(dir)
  const appName = entries.find((e) => e.endsWith('.app'))
  return appName ? path.join(dir, appName) : null
}
