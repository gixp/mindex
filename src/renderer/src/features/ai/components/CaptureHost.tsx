import { useState } from 'react'
import { useAiProposalsStore } from '@/features/ai/store'
import { api } from '@/platform/api'
import { pushToast } from '@/platform/notifications'
import { CaptureDialog } from '@/features/ai/components/CaptureDialog'
import type { NoteTypeId } from '@shared/types/notes'
import { openDocument } from '@/platform/documents'

/**
 * Mounts the capture window when there is a draft, and creates the note.
 *
 * Creation is an ordinary note creation, not an AI write: by this point the
 * draft has been read and corrected by a person, so it is their note. That is
 * also why it is not filed as the assistant's edit in the version history —
 * nobody's edit is being attributed here, the note simply begins.
 */
export function CaptureHost(): JSX.Element | null {
  const draft = useAiProposalsStore((s) => s.captureDraft)
  const open = useAiProposalsStore((s) => s.captureOpen)
  const capturing = useAiProposalsStore((s) => s.capturing)
  const error = useAiProposalsStore((s) => s.captureError)
  const runCapture = useAiProposalsStore((s) => s.runCapture)
  const clearCapture = useAiProposalsStore((s) => s.clearCapture)
  const retryCapture = useAiProposalsStore((s) => s.retryCapture)
  const text = useAiProposalsStore((s) => s.captureText)
  const [busy, setBusy] = useState(false)

  if (!open) return null
  // The window is up from the click and only changes what it shows: the field,
  // then the wait, then the draft or the reason. Opening it on the answer
  // meant the click produced nothing at all for the seconds that took, which
  // reads as a button that does not work.
  if (!draft) {
    if (error) {
      // Back to the field with the material still in it, rather than a dead end
      // that swallows whatever was pasted.
      return (
        <CaptureDialog
          failure={error}
          onRetry={() => retryCapture()}
          onCancel={() => clearCapture()}
        />
      )
    }
    if (capturing) return <CaptureDialog working material={text} onCancel={() => clearCapture()} />
    return (
      <CaptureDialog
        input
        initialText={text}
        onSubmit={(next) => void runCapture(next)}
        onCancel={() => clearCapture()}
      />
    )
  }

  return (
    <CaptureDialog
      draft={draft}
      busy={busy}
      onCancel={() => clearCapture()}
      onCreate={(edits) => {
        setBusy(true)
        // Every field comes from the window, not from the draft. The draft is
        // what the assistant proposed; by this point a person has read it and
        // may have changed any of it — including the type and the body, which
        // this used to take from the draft regardless of what was on screen.
        const wikilinks = edits.links.map((p) => `[[${p.replace(/\.md$/i, '')}]]`)
        const body = [
          edits.body,
          draft.source ? `\nSource: ${draft.source}` : '',
          wikilinks.length ? `\nRelated: ${wikilinks.join(' · ')}` : ''
        ]
          .filter(Boolean)
          .join('\n')

        void api()
          .notes.create({
            type: edits.type as NoteTypeId,
            title: edits.title,
            ...(edits.folder ? { folder: edits.folder } : {}),
            frontmatter: {
              ...draft.frontmatter,
              ...(edits.tags.length ? { tags: edits.tags } : {}),
              ...(draft.source ? { source: draft.source } : {})
            },
            body
          })
          .then((r) => {
            if (r.ok && r.data) {
              clearCapture()
              void openDocument(r.data.path)
              return
            }
            pushToast(r.error ?? 'The note could not be created.')
          })
          .finally(() => setBusy(false))
      }}
    />
  )
}
