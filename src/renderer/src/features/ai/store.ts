import { create } from 'zustand'
import {
  SELECTION_TRANSFORMS,
  type AiProposal,
  type CaptureDraft,
  type FileEdit,
  type TransformSelectionInput
} from '@shared/ai'
import { api } from '@/platform/api'
import { useUiStore } from '@/platform/app-settings'
import { pushToast, useNotificationsStore } from '@/platform/notifications'
import { describeIpcFailure } from '@/platform/ipc-error'

/**
 * The open AI proposals — every reviewed change the app is waiting on a person
 * to accept or dismiss, from any feature. There is one of these stores and one
 * `ProposalDock` rendering it, so a linter fix and a selection rewrite look and
 * behave identically. Nothing in the AI layer writes to a note without putting
 * one of these here first.
 */

interface AiProposalsState {
  proposals: AiProposal[]
  /** Put a new proposal in front of the person. Returns its id. */
  add(
    proposal: Omit<AiProposal, 'status' | 'createdAt'> & { status?: AiProposal['status'] }
  ): string
  update(id: string, patch: Partial<AiProposal>): void
  /** Apply one file's edit. Handles the conflict case with a toast + reload. */
  applyEdit(id: string, path: string): Promise<void>
  applyAll(id: string): Promise<void>
  discard(id: string): void
  /**
   * Ask for a passage to be rewritten and put the answer up for review.
   *
   * `pending` is the transform currently in flight, so the menu that started
   * it can show it is working and refuse a second click. One at a time is
   * deliberate: the answer replaces a specific passage, and a second rewrite
   * launched over the first would be anchored to text the first is about to
   * change.
   */
  pendingTransform: string | null
  requestTransform(input: TransformSelectionInput): Promise<void>
  /**
   * The note a capture is offering, and whether one is being worked out.
   *
   * One at a time, like a rewrite: the clipboard is a single thing, and a
   * second capture launched over the first would be about the same contents.
   */
  /** Whether the capture window is up at all. */
  captureOpen: boolean
  capturing: boolean
  captureDraft: CaptureDraft | null
  /** Why the last capture produced nothing. Kept on screen, not toasted. */
  captureError: string | null
  /**
   * What was handed in, kept for as long as the window is open.
   *
   * So a failure can offer the material back rather than swallowing it. A
   * capture that failed used to be a dead end: the window showed the reason and
   * a Close button, and whatever had been pasted was gone — which for a long
   * passage means finding it again.
   */
  captureText: string
  openCapture(): void
  runCapture(text: string): Promise<void>
  clearCapture(): void
  /** Back to the field, with what was handed in still in it. */
  retryCapture(): void
}

export const useAiProposalsStore = create<AiProposalsState>((set, get) => ({
  proposals: [],
  pendingTransform: null,
  captureOpen: false,
  capturing: false,
  captureDraft: null,
  captureError: null,
  captureText: '',

  add(proposal) {
    const full: AiProposal = {
      status: 'ready',
      createdAt: Date.now(),
      results: [],
      ...proposal
    }
    set((s) => ({ proposals: [full, ...s.proposals.filter((p) => p.id !== full.id)] }))
    return full.id
  },

  update(id, patch) {
    set((s) => ({ proposals: s.proposals.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  },

  async applyEdit(id, path) {
    const proposal = get().proposals.find((p) => p.id === id)
    const edit = proposal?.edits.find((e) => e.path === path)
    if (!proposal || !edit) return

    get().update(id, { status: 'applying' })
    const res = await api().ai.applyEdit({ kind: proposal.kind, edit })
    const result =
      res.ok && res.data ? res.data : { path, ok: false as const, reason: 'write-failed' as const }

    const results = [
      ...(get().proposals.find((p) => p.id === id)?.results ?? []).filter((r) => r.path !== path),
      {
        path,
        ok: result.ok,
        reason: result.ok ? undefined : result.reason
      }
    ]

    if (!result.ok && result.reason === 'conflict') {
      pushToast(`"${path}" changed since this was proposed — reopen it and try again.`)
    } else if (!result.ok) {
      pushToast(`Could not apply the change to "${path}".`)
    }

    const remaining = proposal.edits.filter((e) => !results.some((r) => r.path === e.path && r.ok))
    get().update(id, {
      results,
      status: remaining.length === 0 ? 'applied' : result.ok ? 'partially-applied' : 'ready'
    })

    if (remaining.length === 0) {
      // Leave the applied card up for a beat so the person sees it took, then
      // clear it — an accepted proposal that lingers reads as "still pending".
      setTimeout(() => get().discard(id), 1500)
    }
  },

  async applyAll(id) {
    const proposal = get().proposals.find((p) => p.id === id)
    if (!proposal) return
    for (const edit of proposal.edits) {
      const already = get()
        .proposals.find((p) => p.id === id)
        ?.results?.some((r) => r.path === edit.path && r.ok)
      if (!already) await get().applyEdit(id, edit.path)
    }
  },

  discard(id) {
    set((s) => ({ proposals: s.proposals.filter((p) => p.id !== id) }))
  },

  openCapture() {
    set({ captureOpen: true, captureDraft: null, captureError: null, captureText: '' })
  },

  async runCapture(text) {
    if (get().capturing) return
    set({ capturing: true, captureDraft: null, captureError: null, captureText: text })
    try {
      const app = useUiStore.getState().settings
      const chosen = app?.ai?.captureModel
      const res = await api().ai.capture({
        text,
        ...(app?.ai?.captureProvider ? { provider: app.ai.captureProvider } : {}),
        ...(chosen ? { model: chosen } : {}),
        ...(app?.ai?.captureEffort ? { effort: app.ai.captureEffort } : {})
      })
      if (!res.ok || !res.data) {
        set({ captureError: describeIpcFailure(res.error ?? 'The capture could not be started.') })
        return
      }
      if (!res.data.ok) {
        // Each of these is something a person can act on — put something on the
        // clipboard, set an assistant up — so it stays on screen in the window
        // it belongs to. A toast for it lasts four seconds and is gone by the
        // time anyone looks at the empty space where a note should have been.
        set({ captureError: res.data.message })
        return
      }
      set({ captureDraft: res.data.draft })
    } catch (err) {
      // A capture that was cancelled is not a failure to report — the window
      // it would report into is already closed.
      if (get().captureOpen) set({ captureError: describeIpcFailure(err) })
    } finally {
      set({ capturing: false })
    }
  },

  retryCapture() {
    set({ captureError: null, captureDraft: null })
  },

  clearCapture() {
    // Closing the window stops the work. It used to only hide it: the request
    // carried on to the assistant, was paid for, and answered into nothing.
    if (get().capturing) void api().ai.cancelCapture()
    set({
      captureOpen: false,
      captureDraft: null,
      captureError: null,
      capturing: false,
      captureText: ''
    })
  },

  async requestTransform(input) {
    if (get().pendingTransform) return
    const transform = SELECTION_TRANSFORMS.find((t) => t.id === input.transformId)
    set({ pendingTransform: input.transformId })

    // Nothing goes on screen while the request is out. The passage itself is
    // lit where it sits, which says both that something is happening and what
    // it is happening to; a card in the corner could only ever say the first,
    // and said it a long way from where the person was looking. A card appears
    // only once there is something to decide or something went wrong.
    // A failure is not a proposal. It used to put a card in the corner with
    // its own way of showing a message, its own copy button and its own pair
    // of buttons — a second error design living next to the one every other
    // failure in the app already goes through. Errors go to that one.
    const fail = (message: string): void => {
      useNotificationsStore
        .getState()
        .showError(transform?.title ?? 'Rewrite', describeIpcFailure(message))
    }

    try {
      const res = await api().ai.transformSelection(input)
      if (!res.ok || !res.data) {
        fail(res.error ?? 'The rewrite could not be started.')
        return
      }
      if (!res.data.ok) {
        fail(res.data.message)
        return
      }
      get().add(res.data.proposal)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    } finally {
      set({ pendingTransform: null })
    }
  }
}))

/** Convenience for features building a single-file proposal. */
export function singleEditProposal(input: {
  id: string
  kind: string
  title: string
  rationale: string
  edit: FileEdit
  citations?: AiProposal['citations']
}): Omit<AiProposal, 'status' | 'createdAt'> {
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    rationale: input.rationale,
    edits: [input.edit],
    citations: input.citations ?? []
  }
}
