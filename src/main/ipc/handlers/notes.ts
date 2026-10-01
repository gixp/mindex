import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { capture } from '@main/telemetry/analytics'
import { currentVault } from '@main/vault/opener'
import { listAllNotes, listAllDirs, searchNotes } from '@main/index/indexer'
import { runQuery } from '@main/index/query'
import { readVaultDef, validateAgainstDef } from '@main/types/definitions'
import { clearAiCreated } from '@main/index/ai-created'
import {
  createNote,
  createFolder,
  deleteNote,
  deleteFolder,
  moveNote,
  moveFolder,
  renameFolder,
  readNote,
  renameNote,
  stripNumberPrefixes,
  writeNote
} from '@main/notes/operations'
import { saveAsset } from '@main/notes/assets'
import { detectType, validateFrontmatter } from '@main/types/registry'
import { requireVault } from '@main/vault/state'
import { markUserWrite } from '@main/history/attribution'

export function registerNotesHandlers(): void {
  handle(IPC.notes.list, () => safe(async () => listAllNotes()))

  handle(IPC.notes.dirs, () => safe(async () => listAllDirs()))

  handle(IPC.notes.read, (_e, p: string) => safe(async () => await readNote(p)))

  handle(
    IPC.notes.validateFrontmatter,
    (_e, relPath: string, frontmatter: Record<string, unknown>) =>
      safe(async () => {
        const type = detectType(frontmatter, relPath)
        // The vault's definition wins where it exists: it is what the user
        // sees in the type editor, so it has to be what the warnings follow.
        const def = await readVaultDef(requireVault().root, type)
        return def ? validateAgainstDef(def, frontmatter) : validateFrontmatter(type, frontmatter)
      })
  )

  handle(
    IPC.notes.write,
    (_e, p: string, body: string, frontmatter?: Record<string, unknown>, expectedMtime?: number) =>
      safe(async () => {
        const meta = await writeNote(p, body, frontmatter, expectedMtime)
        // Marked here rather than inside `writeNote`: arriving over IPC is
        // what makes this the user's edit, and a future internal caller of
        // `writeNote` should not inherit that claim. After the write, not
        // before, so a refused write (a conflict) does not leave a mark that
        // an unrelated external change could then claim.
        markUserWrite(p)
        // Heatmap: count this save as one edit (every edit is recorded).
        return meta
      })
  )

  handle(IPC.notes.create, (_e, input) =>
    safe(async () => {
      const meta = await createNote(input)
      markUserWrite(meta.path)
      return meta
    })
  )

  handle(IPC.notes.createFolder, (_e, input: { folder?: string; name: string }) =>
    safe(async () => await createFolder(input))
  )

  handle(IPC.notes.rename, (_e, p: string, newName: string) =>
    safe(async () => {
      const meta = await renameNote(p, newName)
      return meta
    })
  )

  handle(IPC.notes.move, (_e, p: string, folder: string) =>
    safe(async () => {
      const meta = await moveNote(p, folder)
      return meta
    })
  )

  handle(IPC.notes.delete, (_e, p: string) =>
    safe<void>(async () => {
      await deleteNote(p)
    })
  )

  handle(IPC.notes.moveFolder, (_e, p: string, parent: string) =>
    safe<void>(async () => {
      await moveFolder(p, parent)
    })
  )

  handle(IPC.notes.renameFolder, (_e, p: string, newName: string) =>
    safe(async () => await renameFolder(p, newName))
  )

  handle(IPC.notes.deleteFolder, (_e, p: string) =>
    safe<void>(async () => {
      await deleteFolder(p)
    })
  )

  handle(IPC.notes.search, (_e, q: string, limit?: number) =>
    safe(async () => {
      // Propless on purpose: that someone searched is a product fact, what they
      // searched for is the contents of their vault.
      if (q.trim()) capture('search_used', {})
      return searchNotes(q, limit)
    })
  )

  handle(IPC.notes.query, (_e, expr: string) => safe(async () => runQuery(expr)))

  handle(IPC.notes.saveAsset, (_e, input: { sourceName: string; bytes: ArrayBuffer }) =>
    safe(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      return await saveAsset({
        vaultRoot: v.root,
        sourceName: input.sourceName,
        bytes: input.bytes
      })
    })
  )

  handle(IPC.notes.stripNumberPrefixes, (_e, dryRun?: boolean) =>
    safe(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      const renamed = await stripNumberPrefixes(v.root, dryRun === true)
      return { renamed }
    })
  )

  handle(IPC.notes.clearAiCreated, (_e, relPath: string) =>
    safe<void>(async () => {
      clearAiCreated(relPath)
    })
  )
}
