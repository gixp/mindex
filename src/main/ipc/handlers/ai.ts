import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import type { ApplyEditInput, ApplyEditResult, Citation, TransformSelectionInput } from '@shared/ai'
import { SELECTION_TRANSFORMS } from '@shared/ai'
import { safe, WriteConflictError } from '@main/util/result'
import { getVault } from '@main/vault/state'
import { fromRelative } from '@main/util/paths'
import { readNote, writeNote } from '@main/notes/operations'
import { markAgentWrite } from '@main/history/attribution'
import { resolveCitations } from '@main/ai/citations'
import { transformSelection } from '@main/ai/transform'
import { capture, type CaptureChoice } from '@main/ai/capture'

/**
 * The narrow surface the renderer needs for AI proposals.
 *
 * Everything an AI feature *asks* the agent runs in the main process already
 * (`ai/task.ts`), so nothing here spawns anything. What the renderer cannot do
 * on its own is the two things below: apply a reviewed edit with the same
 * conflict check and history attribution every other write in Mindex gets, and
 * turn a `{ path, quote }` the agent returned into a line range to link to.
 */

/**
 * Apply one edit of a proposal.
 *
 * A conflict is returned as data (`{ ok: false, reason: 'conflict' }`), not
 * thrown: the renderer has its own review UI for "the note changed under you",
 * the same one `notes.write` conflicts already flow into, and an IPC error
 * would bypass it.
 */
async function applyEdit(input: ApplyEditInput): Promise<ApplyEditResult> {
  const vault = getVault()
  if (!vault) return { path: input.edit.path, ok: false, reason: 'no-vault' }

  const { edit } = input
  const abs = fromRelative(edit.path, vault.root)

  // Prefer the mtime check — it is what the rest of Mindex uses — but fall back
  // to comparing the body text when the proposal was built without one, so a
  // note edited between proposal and apply is still caught.
  if (edit.expectedMtime === undefined) {
    try {
      const current = await readNote(abs)
      if (current.body !== edit.before) {
        return { path: edit.path, ok: false, reason: 'conflict' }
      }
    } catch {
      // The note is gone. Recreating it from a proposal is not something M0
      // does — proposals edit existing notes — so treat it as a conflict.
      return { path: edit.path, ok: false, reason: 'conflict' }
    }
  }

  try {
    await writeNote(abs, edit.after, undefined, edit.expectedMtime)
  } catch (e) {
    if (e instanceof WriteConflictError) return { path: edit.path, ok: false, reason: 'conflict' }
    return {
      path: edit.path,
      ok: false,
      reason: 'write-failed',
      message: e instanceof Error ? e.message : String(e)
    }
  }

  // After the write, not before: a refused write must not leave a mark a later
  // unrelated change could inherit — the same ordering `notes.write`'s own
  // handler uses for `markUserWrite`.
  markAgentWrite(abs, labelFor(input.kind))
  return { path: edit.path, ok: true }
}

/**
 * Human-readable feature name for the history entry.
 *
 * The rewrites read their label from the same list the menu is drawn from, so
 * a rewrite added there shows up here without a second list to remember.
 */
function labelFor(kind: string): string {
  const transform = SELECTION_TRANSFORMS.find((t) => t.id === kind)
  if (transform) return transform.label
  const known: Record<string, string> = {
    'linter-fix': 'Knowledge linter',
    'assemble-draft': 'Assemble draft',
    refactor: 'Refactor',
    capture: 'Capture'
  }
  return known[kind] ?? 'Assistant'
}

async function resolveCitationRefs(
  raw: Array<{ path: string; quote: string }>
): Promise<Citation[]> {
  const vault = getVault()
  if (!vault) return raw.map((r) => ({ path: r.path, quote: r.quote }))

  const bodies = new Map<string, string>()
  for (const { path } of raw) {
    if (bodies.has(path)) continue
    try {
      const { body } = await readNote(fromRelative(path, vault.root))
      bodies.set(path, body)
    } catch {
      // Fall through — the citation is kept without a line range.
    }
  }
  return resolveCitations(raw, bodies)
}

export function registerAiHandlers(): void {
  handle(IPC.ai.applyEdit, (_e, input: ApplyEditInput) => safe(async () => applyEdit(input)))

  handle(IPC.ai.resolveCitations, (_e, raw: Array<{ path: string; quote: string }>) =>
    safe(async () => resolveCitationRefs(raw))
  )

  // The rewrite itself can fail in ways the window has to explain — the
  // assistant is not set up, the passage is no longer in the file — so those
  // come back inside the result rather than as a rejected call.
  handle(IPC.ai.transformSelection, (_e, input: TransformSelectionInput) =>
    safe(async () => transformSelection(input))
  )

  // One capture at a time — the window will not start a second — so a single
  // controller is the whole of the bookkeeping. Held here rather than inside
  // `capture()` so that aborting does not require reaching into it.
  let capturing: AbortController | null = null

  handle(IPC.ai.capture, (_e, input: string | (CaptureChoice & { text: string })) =>
    safe(async () => {
      capturing?.abort()
      const controller = new AbortController()
      capturing = controller
      try {
        // A bare string is what every build before the window grew a model
        // picker sent. Accepted still, so an app half a version behind is not
        // a broken capture.
        const text = typeof input === 'string' ? input : input.text
        const choice = typeof input === 'string' ? undefined : input
        return await capture(text, controller.signal, choice)
      } finally {
        if (capturing === controller) capturing = null
      }
    })
  )

  handle(IPC.ai.cancelCapture, () =>
    safe(async () => {
      capturing?.abort()
      capturing = null
    })
  )
}
