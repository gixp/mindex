import { useState } from 'react'
import type { AiProposal, Citation, FileEdit } from '@shared/ai'
import { useAiProposalsStore } from '@/features/ai/store'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'
import { changedSpan } from '@/features/ai/lib/changedSpan'
import { openCitation, citationLabel } from '@/features/ai/lib/openCitation'

/**
 * The one place every AI proposal in the app is reviewed.
 *
 * A floating stack, not a window: a proposal arrives while the person is in
 * the middle of something — writing a note, reading a report — and taking the
 * whole screen to ask about a one-line rewrite would be the wrong trade. Each
 * card shows the same three things whichever feature produced it: what is
 * changing, why, and where the evidence came from.
 *
 * What it deliberately does **not** show is a two-column diff of the whole
 * file. A rewrite replaces one passage; at the width a card can afford, those
 * columns are unreadable, and nearly every line in them is unchanged. The
 * passage that moved is shown on its own instead.
 */
export function ProposalDock(): JSX.Element | null {
  const proposals = useAiProposalsStore((s) => s.proposals)
  if (proposals.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-docked flex w-[420px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {proposals.map((p) => (
        <ProposalCard key={p.id} proposal={p} />
      ))}
    </div>
  )
}

/**
 * A quiet button.
 *
 * No filled primary here on purpose. The accent tint is spoken for elsewhere —
 * it means "this is the one chosen", and an action is not an answer — and a
 * card that appeared without being asked for should not then press. The two
 * actions are told apart by weight of text alone: accepting is the brighter
 * word, dismissing the quieter one.
 */
function CardButton({
  children,
  onClick,
  disabled,
  lead = false
}: {
  children: React.ReactNode
  onClick(): void
  disabled?: boolean
  lead?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-r3 px-2.5 text-12.5 transition-colors hover:bg-bg-3 disabled:opacity-30',
        lead ? 'font-medium text-c-1' : 'text-c-2 hover:text-c-1'
      )}
    >
      {children}
    </button>
  )
}

function ProposalCard({ proposal }: { proposal: AiProposal }): JSX.Element {
  const { applyEdit, applyAll, discard } = useAiProposalsStore.getState()
  const busy = proposal.status === 'applying'
  const done = proposal.status === 'applied'
  const working = proposal.status === 'streaming'
  const multi = proposal.edits.length > 1
  const allApplied =
    proposal.edits.length > 0 &&
    proposal.edits.every((e) => proposal.results?.some((r) => r.path === e.path && r.ok))

  return (
    <div className="pointer-events-auto max-h-[70vh] overflow-y-auto rounded-r1 border border-bd-2 bg-bg-2 p-3 shadow-s2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-12.5 font-medium text-c-1">{proposal.title}</div>
        </div>
        <button
          type="button"
          title="Dismiss"
          onClick={() => discard(proposal.id)}
          className="-mr-1 -mt-0.5 flex h-5 w-5 items-center justify-center rounded-r4 text-c-2 transition-colors hover:bg-bg-3 hover:text-c-1"
        >
          <Icon name="close" size={12} className="codicon-inherit" />
        </button>
      </div>

      {working ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-12.5 leading-snug text-c-2">
          <Icon name="loading" size={12} className="codicon-modifier-spin codicon-muted" />
          Asking the assistant…
        </p>
      ) : proposal.rationale ? (
        <p className="mt-1.5 whitespace-pre-wrap text-12.5 leading-snug text-c-2">
          {proposal.rationale}
        </p>
      ) : null}

      {proposal.citations.length > 0 ? <CitationStrip citations={proposal.citations} /> : null}

      {proposal.edits.length > 0 ? (
        <div className="mt-2.5 flex flex-col gap-3">
          {proposal.edits.map((edit) => (
            <EditRow
              key={edit.path}
              edit={edit}
              showPath={multi}
              result={proposal.results?.find((r) => r.path === edit.path)}
              busy={busy}
              onApply={() => void applyEdit(proposal.id, edit.path)}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-end gap-1">
        {done ? (
          <span className="flex items-center gap-1.5 text-12.5 text-c-2">
            <Icon name="check" size={13} className="codicon-blue" />
            Applied
          </span>
        ) : (
          <>
            <CardButton onClick={() => discard(proposal.id)} disabled={busy}>
              Dismiss
            </CardButton>
            {!working && (multi || proposal.edits.length === 1) ? (
              <CardButton
                lead
                onClick={() =>
                  multi
                    ? void applyAll(proposal.id)
                    : void applyEdit(proposal.id, proposal.edits[0]!.path)
                }
                disabled={busy || allApplied}
              >
                {busy ? 'Applying…' : multi ? 'Apply all' : 'Apply'}
              </CardButton>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function CitationStrip({ citations }: { citations: Citation[] }): JSX.Element {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {citations.map((c, i) => (
        <button
          key={`${c.path}-${i}`}
          type="button"
          title={c.quote}
          onClick={() => void openCitation(c)}
          className="flex max-w-full items-center gap-1 rounded-r4 border border-bd-2 px-1.5 py-0.5 text-11 text-c-2 transition-colors hover:bg-bg-3 hover:text-c-1"
        >
          <Icon name="quote" size={11} className="codicon-inherit" />
          <span className="truncate">{citationLabel(c)}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * One file's change: the passage as it stands, then as it would read.
 *
 * Stacked rather than side by side. Two columns in a card this wide give each
 * side about thirty characters, which breaks every sentence into a ladder;
 * stacked, each one gets the full width and the pair reads as a before and an
 * after, which is what it is.
 */
function EditRow({
  edit,
  showPath,
  result,
  busy,
  onApply
}: {
  edit: FileEdit
  showPath: boolean
  result?: { path: string; ok: boolean; reason?: string }
  busy: boolean
  onApply(): void
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const applied = result?.ok === true
  const conflicted = result?.ok === false && result.reason === 'conflict'
  const span = changedSpan(edit.before, edit.after)
  const long = span.removed.length + span.added.length > 600

  return (
    <div className={cn(applied && 'opacity-50')}>
      {showPath || applied || conflicted ? (
        <div className="mb-1 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-11 text-c-2">{edit.path}</span>
          {applied ? (
            <span className="flex shrink-0 items-center gap-1 text-11 text-c-2">
              <Icon name="check" size={12} className="codicon-blue" /> done
            </span>
          ) : conflicted ? (
            <span className="flex shrink-0 items-center gap-1 text-11 text-c-2">
              <Icon name="warning" size={12} className="codicon-amber" /> changed on disk
            </span>
          ) : (
            <button
              type="button"
              onClick={onApply}
              disabled={busy}
              className="shrink-0 rounded-r4 px-1.5 py-0.5 text-11 text-c-2 transition-colors hover:bg-bg-3 hover:text-c-1 disabled:opacity-30"
            >
              Apply
            </button>
          )}
        </div>
      ) : null}

      {/* No frame around this. The card is already a box; a box inside it
          holding a box of text was three edges deep for one sentence. The old
          wording and the new one are told apart by weight and a strike, which
          is what the eye reads first anyway. */}
      <div
        className={cn(
          'flex flex-col gap-1 text-12.5 leading-relaxed',
          long && !expanded && 'max-h-40 overflow-hidden'
        )}
      >
        {span.removed ? (
          <p className="select-text whitespace-pre-wrap break-words text-c-2 line-through decoration-c-2/40">
            {span.removed}
          </p>
        ) : null}
        {span.added ? (
          <p className="select-text whitespace-pre-wrap break-words text-c-1">{span.added}</p>
        ) : null}
        {!span.removed && !span.added ? <p className="text-c-2">No change.</p> : null}
      </div>

      {long ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-11 text-c-2 transition-colors hover:text-c-1"
        >
          {expanded ? 'Show less' : 'Show all'}
        </button>
      ) : null}
    </div>
  )
}
