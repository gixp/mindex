import { handle } from '@main/ipc/handle'
import { readTextFile } from '@main/notes/read-any'
import type { TextFile } from '@shared/text-file'
import os from 'node:os'
import path from 'node:path'
import { shell } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { isPathInside } from '@main/util/paths'
import { getVault } from '@main/vault/state'

/**
 * Handing a path to the operating system is the one thing on this side that
 * acts outside the app entirely, so it does not take just any path.
 *
 * `open` used to live here too — it passed whatever it was given to
 * `shell.openPath`, which asks the OS to *run* the file with its default
 * handler. Nothing in the app ever called it (the one place that considered
 * it says in a comment why it went another way), so it was capability with no
 * purpose: a way for anything running in the window to launch a file an agent
 * had just written. Removed rather than guarded — the safest version of an
 * unused door is no door.
 *
 * `reveal` stays, because several screens legitimately use it, but it is
 * bounded. It only shows a file in the OS file browser, so the bound is about
 * keeping it pointed at the user's own material rather than at anything on
 * the machine.
 */

/**
 * Where revealing is allowed to point.
 *
 * The vault root itself counts, not only paths under it — "Reveal in Finder"
 * on the workspace menu targets the root exactly, and `isPathInside` reports
 * false for a path equal to its parent.
 *
 * The home directory is here because skills are real: a global skill lives
 * under the user's home rather than in any vault, and its screen offers the
 * same reveal button as a note's.
 */
function isRevealable(target: string): boolean {
  const abs = path.resolve(target)
  const vaultRoot = getVault()?.root
  if (vaultRoot) {
    const root = path.resolve(vaultRoot)
    if (abs === root || isPathInside(abs, root)) return true
  }
  const home = path.resolve(os.homedir())
  return abs === home || isPathInside(abs, home)
}

export function registerFilesHandlers(): void {
  handle(IPC.files.reveal, (_e, target: string) =>
    safe<void>(async () => {
      if (typeof target !== 'string' || target.length === 0) {
        throw new Error('No path to reveal')
      }
      if (!isRevealable(target)) {
        throw new Error('Refusing to reveal a path outside the workspace and home folder')
      }
      shell.showItemInFolder(path.resolve(target))
    })
  )
  handle(IPC.files.readText, (_e, absPath: string) =>
    safe<TextFile>(async () => {
      if (typeof absPath !== 'string' || absPath.length === 0) {
        throw new Error('No path to read')
      }
      return readTextFile(absPath)
    })
  )
}
