import crypto from 'node:crypto'
import type {
  PendingSuggestion,
  PendingSuggestionsFile,
  SaveRewriteInput
} from '@shared/ai-suggestions'
import { PENDING_SUGGESTIONS_VERSION } from '@shared/ai-suggestions'
import { readJson, writeJson } from '@main/util/fs-helpers'
import { rewritesFile, toRelative } from '@main/util/paths'
import { requireVault } from '@main/vault/state'
import fs from 'node:fs/promises'

/**
 * Rewrites that have been offered and not yet accepted or declined.
 *
 * One file per note, beside the note's comments and keyed the same way, so a
 * note carries its undecided offers the way it carries its threads. They are
 * held here rather than in the editor because the editor is the one thing that
 * does not last: a tab switch, a closed tab or a quit used to discard an answer
 * the assistant had already produced, with no way to ask for it back.
 *
 * No positions are stored, only the passage's text and what surrounds it. The
 * offer is therefore found again after edits elsewhere in the note, and after
 * the app has been closed and reopened.
 */
function newId(): string {
  return crypto.randomBytes(8).toString('hex')
}

function keyFor(absPath: string): { vaultRoot: string; relPath: string } {
  const vault = requireVault()
  // A file outside the vault still gets a stable key — the path is only ever
  // hashed — and its offers live in the open vault, as the comments do.
  const rel = toRelative(absPath, vault.root)
  return { vaultRoot: vault.root, relPath: rel && !rel.startsWith('..') ? rel : absPath }
}

async function read(absPath: string): Promise<PendingSuggestionsFile> {
  const { vaultRoot, relPath } = keyFor(absPath)
  const existing = await readJson<PendingSuggestionsFile>(rewritesFile(vaultRoot, relPath))
  if (
    !existing ||
    existing.v !== PENDING_SUGGESTIONS_VERSION ||
    !Array.isArray(existing.suggestions)
  ) {
    return { v: PENDING_SUGGESTIONS_VERSION, relPath, suggestions: [] }
  }
  return existing
}

async function write(absPath: string, file: PendingSuggestionsFile): Promise<void> {
  const { vaultRoot, relPath } = keyFor(absPath)
  // Nothing left to remember: take the file away rather than leaving an empty
  // one behind in every note that has ever been offered a rewrite.
  if (file.suggestions.length === 0) {
    await fs.rm(rewritesFile(vaultRoot, relPath), { force: true }).catch(() => {})
    return
  }
  await writeJson(rewritesFile(vaultRoot, relPath), file)
}

/** Every undecided rewrite for this note, oldest first. */
export async function listPendingRewrites(absPath: string): Promise<PendingSuggestion[]> {
  const file = await read(absPath)
  return [...file.suggestions].sort((a, b) => a.createdAt - b.createdAt)
}

/** Remember an offer, and hand back the record so the editor can key its own
 *  view state to the same id. */
export async function savePendingRewrite(
  absPath: string,
  input: SaveRewriteInput
): Promise<PendingSuggestion> {
  const file = await read(absPath)
  const record: PendingSuggestion = { id: newId(), createdAt: Date.now(), ...input }
  // One offer per passage. A second rewrite of the same words replaces the
  // first rather than stacking two boxes on one sentence.
  const kept = file.suggestions.filter((s) => s.anchor.exact !== input.anchor.exact)
  await write(absPath, { ...file, suggestions: [...kept, record] })
  return record
}

/** Answered — accepted or declined, which are the same thing to this store. */
export async function deletePendingRewrite(absPath: string, id: string): Promise<void> {
  const file = await read(absPath)
  await write(absPath, { ...file, suggestions: file.suggestions.filter((s) => s.id !== id) })
}
