import { useState } from 'react'
import type { LinkHealth } from '@shared/types'
import { api } from '@/platform/api'
import { useUiStore } from '@/platform/app-settings'
import { useVaultStore } from '@/platform/workspace'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/icon'
import { openDocument } from '@/platform/documents'

export type LinkHealthTab = 'dead' | 'orphans'

/** Same shape as every button in Context Management: fills with its own edge. */
const ROW_ACTION =
  'inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-8 border border-bd-1 px-2 text-11 font-medium text-c-2 transition-colors hover:bg-bg-3 hover:text-c-1 disabled:cursor-not-allowed disabled:opacity-30'

/**
 * The two faults in a vault's web of links, and what to do about each.
 *
 * It used to be two read-only lists. Seeing a broken link is not the useful
 * part — everyone already knows their vault has some; the useful part is
 * repairing one without leaving, and neither list offered a way. A dead link
 * has exactly one obvious repair, which is to make the note it was reaching
 * for, so that is a button on the row. An orphan's repair is to link it from
 * somewhere, which only the person can decide, so that row opens the note.
 */
export function LinkHealthSection({
  data,
  loading,
  tab
}: {
  data: LinkHealth | null
  loading: boolean
  tab: LinkHealthTab
}): JSX.Element {
  const setOpen = useUiStore((s) => s.setLinkHealthOpen)
  const openTab = openDocument
  const notes = useVaultStore((s) => s.notes)
  const [creating, setCreating] = useState<string | null>(null)

  function openRel(relPath: string): void {
    const note = notes.find((n) => n.relPath === relPath)
    if (!note) return
    void openTab(note.path)
    setOpen(false)
  }

  /**
   * Make the note the link was reaching for.
   *
   * Untyped and at the vault root, deliberately: the link says what it is
   * called and nothing about what kind of thing it is or where it belongs,
   * and guessing either would be putting words in the person's mouth. It
   * opens straight away, which is where they say both.
   */
  async function createMissing(target: string): Promise<void> {
    setCreating(target)
    try {
      const r = await api().notes.create({ type: 'untyped', title: target })
      if (r.ok && r.data) {
        await openTab(r.data.path)
        setOpen(false)
      }
    } finally {
      setCreating(null)
    }
  }

  const dead = data?.dead ?? []
  const orphans = data?.orphans ?? []

  if (loading) {
    return (
      <div className="min-h-0 flex-1 py-10 text-center text-13 text-c-2">Checking the vault…</div>
    )
  }

  if (tab === 'dead') {
    return (
      <div className="scroll-plain min-h-0 flex-1 overflow-y-auto">
        {dead.length === 0 ? (
          <EmptyState
            icon="check"
            title="No links point nowhere"
            hint="Every wikilink in the vault reaches a note that exists."
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            {dead.map((d) => (
              <div key={d.target} className="rounded-12 bg-bg-2 p-2.5">
                <div className="flex items-center gap-2">
                  <Icon name="link" size={13} className="shrink-0 codicon-amber" />
                  <span className="min-w-0 flex-1 truncate font-mono text-12.5 text-c-1">
                    [[{d.target}]]
                  </span>
                  {/* The count is the row's own weight: a name twelve notes
                      reach for is a different problem from a single typo, and
                      the list is already sorted so the heavy ones come first. */}
                  <span className="shrink-0 text-11 tabular-nums text-c-2">
                    {d.sources.length} {d.sources.length === 1 ? 'note' : 'notes'}
                  </span>
                  <button
                    type="button"
                    disabled={creating !== null}
                    onClick={() => void createMissing(d.target)}
                    title={`Create a note called “${d.target}” and open it`}
                    className={ROW_ACTION}
                  >
                    <Icon
                      name={creating === d.target ? 'sync' : 'add'}
                      size={11}
                      className="codicon-inherit"
                    />
                    Create note
                  </button>
                </div>
                {/* Who points at it — the other half of the repair, since the
                    other fix is a typo in one of these. */}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {d.sources.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => openRel(s)}
                      title={`Open ${s}`}
                      className="max-w-full truncate rounded-6 px-1.5 py-0.5 font-mono text-11 text-c-2 transition-colors hover:bg-bg-3 hover:text-c-1"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="scroll-plain min-h-0 flex-1 overflow-y-auto">
      {orphans.length === 0 ? (
        <EmptyState
          icon="check"
          title="Nothing is stranded"
          hint="Every note is reachable from somewhere else in the vault."
        />
      ) : (
        <div className="flex flex-col">
          {/* Generated context files and assets are left out on purpose —
              nothing ever links to those by design. */}
          {orphans.map((o) => (
            <div
              key={o.path}
              className="group flex items-center gap-2 rounded-8 px-2 py-1.5 transition-colors hover:bg-bg-2"
            >
              <Icon name="file" size={13} className="shrink-0 codicon-muted" />
              <span className="truncate text-12.5 text-c-1">{o.title}</span>
              <span className="ml-auto min-w-0 truncate pl-3 font-mono text-11 text-c-2">
                {o.relPath}
              </span>
              <button
                type="button"
                onClick={() => openRel(o.relPath)}
                title={`Open ${o.relPath}`}
                className={ROW_ACTION}
              >
                <Icon name="link-external" size={11} className="codicon-inherit" />
                Open
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
