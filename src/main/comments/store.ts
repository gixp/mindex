import crypto from 'node:crypto'
import type {
  CommentAnchor,
  CommentThread,
  CommentThreadView,
  CommentsFile
} from '@shared/comments'
import { COMMENTS_FILE_VERSION, createAnchor, refindAnchor } from '@shared/comments'
import { readJson, writeJson } from '@main/util/fs-helpers'
import { commentsFile, toRelative } from '@main/util/paths'
import { readNoteFile } from '@main/vault/fs-ops'
import { isSkillPath, readSkillFile } from '@main/skills/files'
import { requireVault } from '@main/vault/state'

function newId(): string {
  return crypto.randomBytes(8).toString('hex')
}

async function readFile(vaultRoot: string, relPath: string): Promise<CommentsFile> {
  const existing = await readJson<CommentsFile>(commentsFile(vaultRoot, relPath))
  if (!existing || existing.v !== COMMENTS_FILE_VERSION || !Array.isArray(existing.threads)) {
    return { v: COMMENTS_FILE_VERSION, relPath, threads: [] }
  }
  return existing
}

async function writeFile(vaultRoot: string, relPath: string, file: CommentsFile): Promise<void> {
  await writeJson(commentsFile(vaultRoot, relPath), file)
}

interface Ctx {
  vaultRoot: string
  relPath: string
  body: string
}

async function context(absPath: string): Promise<Ctx> {
  const vault = requireVault()

  // A skill file is not in the vault, so it has no relative path — but the
  // key is only ever hashed (`commentsFile`), and nothing requires it to be
  // relative to anything. Its absolute path is just as stable and unique.
  //
  // The threads themselves still live in the open vault's `.mindex/comments/`,
  // which is where they belong: they are the reader's notes about the file,
  // not the file's own content, and the file belongs to another program.
  if (isSkillPath(absPath)) {
    let body = ''
    try {
      body = (await readSkillFile(absPath)).content
    } catch {}
    return { vaultRoot: vault.root, relPath: absPath, body }
  }

  const relPath = toRelative(absPath, vault.root)
  let body = ''
  try {
    body = await readNoteFile(relPath)
  } catch {
    // A note that cannot be read right now (deleted, being moved) is not a
    // reason to lose its comments — every thread just re-anchors as orphaned
    // until the file comes back.
  }
  return { vaultRoot: vault.root, relPath, body }
}

/**
 * Re-locate every thread against the note as it is now, persisting anything
 * that shifted.
 *
 * Done on read rather than on write because the text can change without
 * Mindex being involved at all — an agent, an external editor, a git pull.
 * There is no write event to hang this off, so the honest moment to recompute
 * is when someone asks.
 */
export async function listComments(absPath: string): Promise<CommentThreadView[]> {
  const { vaultRoot, relPath, body } = await context(absPath)
  const file = await readFile(vaultRoot, relPath)
  if (file.threads.length === 0) return []

  let changed = false
  const views: CommentThreadView[] = []

  for (const thread of file.threads) {
    const result = refindAnchor(body, thread.anchor)
    if (result.status === 'orphaned') {
      if (thread.state !== 'orphaned') {
        thread.state = 'orphaned'
        changed = true
      }
      views.push({ ...thread })
      continue
    }
    if (thread.state !== 'anchored') {
      thread.state = 'anchored'
      changed = true
    }
    if (result.moved) {
      // Recapture the surroundings too, not just the offsets: the context is
      // what disambiguates repeated quotes, and stale context gets worse at
      // that job with every edit.
      thread.anchor = createAnchor(body, result.start, result.end)
      changed = true
    }
    views.push({ ...thread, position: { start: result.start, end: result.end } })
  }

  if (changed) await writeFile(vaultRoot, relPath, file)
  return views
}

export interface QuoteInput {
  exact: string
  prefix: string
  suffix: string
  /** Which match of `exact` the editor's selection was on. */
  occurrence?: number
}

/**
 * Turn a quote captured in the editor into an anchor on the markdown file.
 *
 * The editor holds a ProseMirror tree with the markdown syntax already
 * resolved away, so its positions mean nothing here. What it can hand over is
 * the selected text and its surroundings — enough to find the same passage in
 * the file, using the very same search that later re-locates the anchor.
 */
function anchorFromQuote(body: string, quote: QuoteInput): CommentAnchor {
  if (!quote.exact.trim()) throw new Error('Select some text to comment on')
  const found = refindAnchor(body, {
    exact: quote.exact,
    prefix: quote.prefix,
    suffix: quote.suffix,
    occurrence: quote.occurrence,
    // No remembered position to start from — this passage has never been
    // anchored before, so the search begins at the top.
    start: -1,
    end: -1
  })
  if (found.status === 'orphaned') {
    throw new Error('Could not find the selected text in the note — try selecting plain text')
  }
  // Keep the editor's index rather than recomputing one: it is what makes two
  // comments on the same words two different anchors.
  return createAnchor(body, found.start, found.end, quote.occurrence)
}

export async function addComment(
  absPath: string,
  quote: QuoteInput,
  text: string
): Promise<CommentThreadView> {
  const { vaultRoot, relPath, body } = await context(absPath)
  const anchor = anchorFromQuote(body, quote)

  const now = Date.now()
  const thread: CommentThread = {
    id: newId(),
    anchor,
    state: 'anchored',
    resolved: false,
    createdAt: now,
    updatedAt: now,
    messages: [{ id: newId(), ts: now, text }]
  }

  const file = await readFile(vaultRoot, relPath)
  file.threads.push(thread)
  await writeFile(vaultRoot, relPath, file)
  return { ...thread, position: { start: anchor.start, end: anchor.end } }
}

async function mutate(
  absPath: string,
  threadId: string,
  fn: (thread: CommentThread, body: string) => void
): Promise<void> {
  const { vaultRoot, relPath, body } = await context(absPath)
  const file = await readFile(vaultRoot, relPath)
  const thread = file.threads.find((t) => t.id === threadId)
  if (!thread) throw new Error('Comment not found')
  fn(thread, body)
  thread.updatedAt = Date.now()
  await writeFile(vaultRoot, relPath, file)
}

export async function replyToComment(
  absPath: string,
  threadId: string,
  text: string
): Promise<void> {
  await mutate(absPath, threadId, (thread) => {
    thread.messages.push({ id: newId(), ts: Date.now(), text })
  })
}

export async function setCommentResolved(
  absPath: string,
  threadId: string,
  resolved: boolean
): Promise<void> {
  await mutate(absPath, threadId, (thread) => {
    thread.resolved = resolved
  })
}

/**
 * Point an orphaned thread at a fresh passage — the only way back for a
 * comment whose text was rewritten out of existence.
 */
export async function reanchorComment(
  absPath: string,
  threadId: string,
  quote: QuoteInput
): Promise<void> {
  await mutate(absPath, threadId, (thread, body) => {
    thread.anchor = anchorFromQuote(body, quote)
    thread.state = 'anchored'
  })
}

export async function deleteComment(absPath: string, threadId: string): Promise<void> {
  const { vaultRoot, relPath } = await context(absPath)
  const file = await readFile(vaultRoot, relPath)
  const next = file.threads.filter((t) => t.id !== threadId)
  if (next.length === file.threads.length) return
  file.threads = next
  await writeFile(vaultRoot, relPath, file)
}

/** Keep a note's comments with it when it is renamed or moved. */
export async function rekeyComments(
  vaultRoot: string,
  oldRel: string,
  newRel: string
): Promise<void> {
  if (oldRel === newRel) return
  const file = await readJson<CommentsFile>(commentsFile(vaultRoot, oldRel))
  if (!file || file.threads.length === 0) return
  await writeJson(commentsFile(vaultRoot, newRel), { ...file, relPath: newRel })
  const { promises: fsp } = await import('node:fs')
  await fsp.unlink(commentsFile(vaultRoot, oldRel)).catch(() => {})
}
