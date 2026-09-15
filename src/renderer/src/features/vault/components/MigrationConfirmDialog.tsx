import { useVaultStore } from '@/platform/workspace'
import { useUiStore } from '@/platform/app-settings'
import { api } from '@/platform/api'
import { StandardDialog } from '@/ui/StandardDialog'
import { ActionButton } from '@/ui/action-button'
import { Switch } from '@/ui/switch'
import { Icon } from '@/ui/icon'

function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~')
}

/**
 * Shown when the picked folder isn't a Mindex vault yet.
 *
 * An ordinary window, drawn the way every other window in the app is drawn:
 * the standard header carries the icon, the title, the folder and the way out,
 * and the body is three blocks in the panel's own column.
 *
 * It used to opt out of that header and draw its own, then put a second inset
 * inside the panel's — which is what made it read as another app's dialog. The
 * only thing it still keeps for itself is the confirm button, because that one
 * has a working state.
 */
export function MigrationConfirmDialog(): JSX.Element | null {
  const plan = useVaultStore((s) => s.pendingMigration)
  const loading = useVaultStore((s) => s.loading)
  const confirm = useVaultStore((s) => s.confirmMigration)
  const cancel = useVaultStore((s) => s.cancelMigration)
  const settings = useUiStore((s) => s.settings)
  // Both absent mean on, which is what every vault opened before these
  // existed already did.
  const seedRoot = settings?.vaultSetup?.seedRootContext !== false
  // The engine block carries a provider and a model together, so this switch
  // can only be written once an assistant has been chosen — which first-run
  // setup does before any vault is opened.
  const engine = settings?.engine
  const autoContext = engine?.autoContextEnabled === true
  if (!plan) return null

  /**
   * Answered here, remembered everywhere.
   *
   * Written the moment the switch moves rather than on confirm: these are
   * app-wide preferences about how you like a vault set up, so the next folder
   * you open should already carry them — including when you close this window
   * without going ahead.
   */
  async function patch(
    next: Parameters<ReturnType<typeof api>['settings']['setApp']>[0]
  ): Promise<void> {
    const r = await api().settings.setApp(next)
    if (r.ok && r.data) useUiStore.setState({ settings: r.data })
  }

  // The background job is described by the plan as something that will happen.
  // With the switch off it will not, so the line comes out rather than lying.
  const actions = plan.actions.filter((a) => a.kind !== 'enable-folder-context' || autoContext)

  return (
    <StandardDialog
      open
      onOpenChange={(o) => {
        if (!o && !loading) cancel()
      }}
      icon="folder-library"
      title="Set up vault"
      subtitle={<span className="font-mono">{shortPath(plan.vaultRoot)}</span>}
      width={520}
      height="auto"
    >
      <p className="text-12.5 leading-relaxed text-c-2">
        No <span className="font-mono text-c-1">.mindex/</span> here. Setup is purely additive — it
        writes the files below and touches none of the {plan.backupFileCount} already in the tree.
      </p>

      <div>
        <div className="text-12 font-medium text-c-1">What gets added</div>
        <ol className="mt-2.5 space-y-2.5">
          {actions.map((a, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-1/10 text-10.5 font-semibold tabular-nums text-accent-1">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-12.5 text-c-1">{a.title}</div>
                {a.details && a.details.length > 0 ? (
                  <div className="mt-0.5 text-11.5 leading-snug text-c-2">
                    {a.details.join(', ')}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div>
        <div className="text-12 font-medium text-c-1">Options</div>
        <div className="mt-2.5 space-y-2.5">
          <SetupOption
            label="Write a context file at the root"
            hint="A short description of the vault, in the file your assistant reads first."
            checked={seedRoot}
            disabled={loading}
            onChange={(v) => void patch({ vaultSetup: { seedRootContext: v } })}
          />
          <SetupOption
            label="Keep folder context up to date"
            hint="A background job re-reads what changed and maintains one context file per folder."
            checked={autoContext}
            disabled={loading || !engine}
            onChange={(v) => void patch({ engine: { ...engine!, autoContextEnabled: v } })}
          />
        </div>
      </div>

      {/* The row every small window closes with: two answers of equal weight,
          split evenly, the way out on the left. Written out rather than taken
          from `DialogActions` because the confirm here has a working state,
          which that row's buttons do not — the classes are copied exactly so
          the two cannot drift. */}
      <div className="flex items-center gap-2 [&>button]:flex-1">
        <ActionButton disabled={loading} onClick={cancel}>
          Cancel
        </ActionButton>
        <ActionButton tone="primary" disabled={loading} onClick={() => void confirm()}>
          {loading ? (
            <>
              <Icon name="sync" size={13} className="animate-spin codicon-inherit" />
              Setting up…
            </>
          ) : (
            <>
              Set up vault
              <Icon name="arrow-right" size={13} className="codicon-inherit" />
            </>
          )}
        </ActionButton>
      </div>
    </StandardDialog>
  )
}

/** One switch with its name and a line saying what it does. */
function SetupOption({
  label,
  hint,
  checked,
  disabled,
  onChange
}: {
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onChange(next: boolean): void
}): JSX.Element {
  return (
    <div className="flex items-start gap-2.5">
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        ariaLabel={label}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="text-12.5 text-c-1">{label}</div>
        <div className="mt-0.5 text-11.5 leading-snug text-c-2">{hint}</div>
      </div>
    </div>
  )
}
