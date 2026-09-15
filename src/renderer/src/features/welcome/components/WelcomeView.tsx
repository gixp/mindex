import { useEffect, useState } from 'react'
import { useVaultStore } from '@/platform/workspace'
import { api } from '@/platform/api'
import { useUiStore } from '@/platform/app-settings'
import { ActionButton } from '@/ui/action-button'

export function WelcomeView(): JSX.Element {
  const { pickVault, createVault, error } = useVaultStore()
  const [version, setVersion] = useState<string | null>(null)
  const setCloneOpen = useUiStore((s) => s.setCloneVaultOpen)

  useEffect(() => {
    let alive = true
    const getVersion = api().app.getVersion
    if (typeof getVersion === 'function') {
      void getVersion().then((r) => {
        if (alive && r.ok && r.data) setVersion(r.data)
      })
    }
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="h-full w-full overflow-auto">
      <div className="mx-auto max-w-2xl px-12 pt-12 pb-16">
        <div className="mb-12">
          <h1 className="text-[40px] font-bold leading-[1.1] tracking-tight">Mindex</h1>
          <div className="mt-1 flex items-center gap-1.5 text-sm">
            <span className="tabular-nums text-muted-foreground">
              {version ? `v${version}` : '—'}
            </span>
          </div>
        </div>

        <Section title="Start">
          <div className="flex items-center gap-3">
            <StartCard
              icon="folder-opened"
              label="Open Vault"
              onClick={() => void pickVault()}
              primary
            />
            <StartCard icon="new-folder" label="Create Vault" onClick={() => void createVault()} />
            <StartCard
              icon="repo-clone"
              label="Clone Git Vault"
              onClick={() => setCloneOpen(true)}
            />
          </div>
        </Section>

        {error ? <div className="mt-8 text-xs text-destructive">{error}</div> : null}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="mb-10 last:mb-0">
      {/* Regola Pro at 500 — the app's heading font, matching Settings'
          section titles. The old `font-light` fell back to Inter at 300,
          a weight nothing else here uses and which Regola Pro doesn't even
          ship, so it read as a different typeface entirely. */}
      <h2 className="mb-3 font-heading text-[18px] font-medium tracking-tight text-foreground">
        {title}
      </h2>
      <div className="flex flex-col">{children}</div>
    </section>
  )
}

/** Same button design as the onboarding's last step (its "Create
 *  vault" / "Open a vault" pair) — fit-content, side by side, icon left of a
 *  centered label, not a full-width list row. Onboarding gives its "Open a
 *  vault" button the blue primary treatment and leaves "Create vault"
 *  outline; `primary` reproduces that same split here. */
function StartCard({
  icon,
  label,
  onClick,
  disabled,
  primary
}: {
  icon: string
  label: string
  onClick?: () => void
  disabled?: boolean
  primary?: boolean
}): JSX.Element {
  return (
    // `flex-1` here rather than on the button: this row wants its two choices
    // to carry equal weight across the page, which is this screen's decision
    // and not something every button in the app should be born with.
    <ActionButton
      size="lg"
      tone={primary ? 'primary' : 'quiet'}
      icon={icon}
      onClick={onClick}
      disabled={disabled}
      className="flex-1"
    >
      {label}
    </ActionButton>
  )
}
