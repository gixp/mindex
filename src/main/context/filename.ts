import { readdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import { ALL_CONTEXT_FILENAMES } from '@shared/context-filename'

const SKIP = new Set([
  '.git',
  '.claude',
  '.gemini',
  '.codex',
  '.mindex',
  '.vault',
  'node_modules',
  '.obsidian',
  '.backups'
])

/**
 * Rename whichever known context filename is present in a directory to
 * `targetFilename` — the file Mindex wrote under a previous active provider
 * becomes the one the newly active provider actually reads.
 *
 * Runs once per vault open, and again whenever the active provider changes.
 * Cheap when there is nothing to do. Rules, unchanged from the original
 * two-name (`CLAUDE.md` → `AGENTS.md`) migration this generalizes:
 *
 *  - never overwrite an existing `targetFilename` — if a directory somehow
 *    ends up with more than one known name present, only one is renamed (or
 *    none, if the target is already there) and the rest are left for the user
 *    to reconcile, logged so it's discoverable either way;
 *  - rename, never copy-and-delete, so an interrupted run cannot lose content;
 *  - skip the CLI config directories, which have their own context files that
 *    belong to that tool and are none of Mindex's business.
 *
 * Returns the paths it renamed, for the caller to log.
 */
export async function syncContextFilenames(
  vaultRoot: string,
  targetFilename: string
): Promise<string[]> {
  const renamed: string[] = []

  async function walk(dir: string): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(dir, { encoding: 'utf8' })
    } catch {
      return
    }

    const present = ALL_CONTEXT_FILENAMES.filter((name) => entries.includes(name))
    let renamedFrom: string | null = null

    if (!entries.includes(targetFilename)) {
      const source = present[0]
      if (source) {
        try {
          await rename(path.join(dir, source), path.join(dir, targetFilename))
          renamed.push(path.join(dir, targetFilename))
          renamedFrom = source
        } catch {
          /* a locked or unreadable file is not worth failing the vault open for */
        }
      }
    }

    // Whatever's left after the rename above (or after nothing was renamed,
    // because the target already existed) that still isn't `targetFilename`
    // is a divergence worth surfacing — including a stray name that was
    // already sitting beside an existing target and so was never touched.
    // It's otherwise silent on disk: never overwritten, never deleted, just
    // quietly out of date.
    const leftover = present.filter((name) => name !== targetFilename && name !== renamedFrom)
    if (leftover.length > 0) {
      console.log(
        `[context] ${dir}: kept ${leftover.join(', ')} alongside ${targetFilename} — not overwritten`
      )
    }

    for (const name of entries) {
      if (SKIP.has(name) || name.startsWith('.')) continue
      const abs = path.join(dir, name)
      try {
        if ((await stat(abs)).isDirectory()) await walk(abs)
      } catch {
        /* vanished between readdir and stat */
      }
    }
  }

  await walk(vaultRoot)
  return renamed
}
