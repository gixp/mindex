import { useCallback, useEffect, useState } from 'react'
import type { LinkHealth } from '@shared/types'
import { useUiStore } from '@/platform/app-settings'
import { api } from '@/platform/api'
import { StandardDialog } from '@/ui/StandardDialog'
import { Switcher } from '@/ui/switcher'
import { LinkHealthSection, type LinkHealthTab } from './LinkHealthSection'

/**
 * What the vault's links reach, and what nothing reaches.
 *
 * Owns the fetch, the live-update subscription (which only fires while
 * Settings → Link health is set to Auto), the tab, the filter and the manual
 * re-check; `LinkHealthSection` renders the two lists and their repairs.
 *
 * Re-check is here because of that Auto setting: on Manual — the default —
 * the report is taken once when the window opens and then never moves, so
 * fixing something and wanting to see it gone meant closing and reopening.
 */
export function LinkHealthModal(): JSX.Element | null {
  const open = useUiStore((s) => s.linkHealthOpen)
  const setOpen = useUiStore((s) => s.setLinkHealthOpen)

  const [data, setData] = useState<LinkHealth | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<LinkHealthTab>('dead')

  const check = useCallback(async () => {
    setLoading(true)
    const r = await api().index.linkHealth()
    setData(r.ok && r.data ? r.data : null)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!open) return
    void check()
    const off = api().on.linkHealthUpdated((health) => setData(health))
    return off
  }, [open, check])

  if (!open) return null

  const dead = data?.dead ?? []
  const orphans = data?.orphans ?? []

  return (
    <StandardDialog
      open={open}
      onOpenChange={setOpen}
      icon="link"
      title="Connections"
      // What the window is for, in the shape Context Management's line uses:
      // the subject, then what is being kept true about it. The old line said
      // "N notes checked", which is a measurement, not a purpose — and it was
      // the only thing telling anyone what they were looking at.
      subtitle="Where the web of links is broken — links reaching for notes that do not exist, and notes nothing reaches."
      width={720}
      height={600}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <Switcher<LinkHealthTab>
          options={[
            // Amber for the fault and the app's own blue for the finding —
            // the same two meanings the Context window's dots carry. A note
            // nothing reaches is not broken; it is just not connected yet,
            // and colouring it like a fault would be a lie about the vault.
            { key: 'dead', label: 'Points nowhere', count: dead.length, dot: 'bg-amber-400' },
            {
              key: 'orphans',
              label: 'Nothing points here',
              count: orphans.length,
              dot: 'bg-accent-1'
            }
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      <LinkHealthSection data={data} loading={loading} tab={tab} />
    </StandardDialog>
  )
}
