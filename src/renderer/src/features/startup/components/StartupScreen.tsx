import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'
import { BrandLoader } from '@/ui/brand-loader'
import { api } from '@/platform/api'
import { cn } from '@/ui/cn'
import { useStartupStore } from '@/features/startup/store'

/**
 * The first thing Mindex shows — and the screen an update runs behind.
 *
 * Same treatment as the onboarding and gate modals — the app behind it is
 * blurred and dimmed rather than hidden — so launching reads as the window
 * settling rather than as a separate splash screen that then disappears.
 *
 * Under the mark, one line in one place. Normally the build, in the shape the
 * welcome screen uses for it (`Mindex v0.0.0` beside the Beta pill), shown only
 * once the version is in hand so the whole line lands at once. While an update
 * installs, the same line names where it is going — `Updating to Mindex v0.0.0`
 * — with a progress bar under it, rather than a separate modal appearing over
 * the top. An update at launch is part of starting up, so it looks like it.
 *
 * That also means this screen outlives the startup sequence: an update found by
 * the five-minute poll, hours into a session, brings it back rather than
 * quitting the app out from under the user with no explanation.
 */
export function StartupScreen(): JSX.Element | null {
  const done = useStartupStore((s) => s.done)
  const [version, setVersion] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    void useStartupStore.getState().run()
  }, [])

  useEffect(() => {
    let alive = true
    const getVersion = api().app.getVersion
    if (typeof getVersion === 'function') {
      void getVersion().then((r) => {
        if (alive && r.ok && r.data) setVersion(r.data)
      })
    }
    void api()
      .update.getStatus()
      .then((r) => {
        if (alive && r.ok && r.data) setUpdate(r.data)
      })
    const off = api().on.updateStatus((s) => setUpdate(s))
    return () => {
      alive = false
      off()
    }
  }, [])

  const updating = update?.phase === 'downloading' || update?.phase === 'installing'
  if (done && !updating) return null

  // Extracting has no byte-level signal to report, so the bar is filled rather
  // than frozen at whatever the download happened to end on.
  const pct = update?.phase === 'installing' ? 100 : Math.round((update?.progress ?? 0) * 100)

  const to = update?.latestVersion
  return (
    <div className="fixed inset-0 z-boot flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
      <BrandLoader size={64} />
      {updating ? (
        <div className="mt-5 flex flex-col items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <span className="tabular-nums">Updating to Mindex v{to}</span>
          </div>
          {/* 1.2 on the spacing scale — 4.8px, between `h-1` and `h-1.5`,
              neither of which lands right: 4px reads as a hairline, 6px as a
              bar. Tailwind has no step there, hence the explicit length. */}
          <div className="h-[0.3rem] w-[140px] overflow-hidden rounded-full bg-bg-3">
            <div
              className="h-full rounded-full bg-accent-1 transition-[width] duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : (
        /* Hidden rather than unmounted until the version arrives: the row keeps
           its height either way, so the loader does not jump when it appears,
           and the name, number and badge all show up in the same frame instead
           of the text landing first and the number a beat later. */
        <div
          className={cn(
            'mt-5 flex items-center gap-1.5 text-[13px]',
            version ? 'visible' : 'invisible'
          )}
        >
          <span className="tabular-nums text-muted-foreground">Mindex v{version ?? ''}</span>
        </div>
      )}
    </div>
  )
}
