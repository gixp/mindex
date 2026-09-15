import { ChromeButton } from '@/ui/chrome-button'
import { useUiStore } from '@/platform/app-settings'
import { SyncBadge } from '@/features/git/components/SyncBadge'
import { WorkspaceMenu } from '@/features/vault/components/WorkspaceMenu'
import { SettingsDialog } from '@/features/settings/components/SettingsDialog'

/**
 * Bottom of the left pane: the workspace switcher, and the Settings button
 * at the right edge — Context, Source Control, Engine, Terminal and Help
 * live in GlobalHeader instead, but Settings sits here.
 *
 * `placement="top"` opens the workspace panel upward, since a downward one
 * would run off the bottom of the window from here.
 *
 * An available update used to sit above that row. It is a notice in the
 * bottom-right corner now, with a button in the header for as long as the
 * update exists — see `features/update`.
 */
export function SidebarFooter(): JSX.Element {
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)

  return (
    <div className="flex flex-col">
      <SyncBadge />
      {/* No inset on the right: the settings button is a square hit area, and
          its own box already holds the glyph off the edge. The row's padding
          was pushing it a second time, so it sat further in than every other
          control down that side. */}
      <div className="flex items-center gap-2 p-2 pr-0">
        <div className="min-w-0 flex-1 overflow-hidden">
          <WorkspaceMenu placement="top" />
        </div>
        <ChromeButton
          box={28}
          icon="settings-gear"
          iconClassName="codicon-inherit"
          onClick={() => setSettingsOpen(true)}
          title="Settings"
          aria-label="Settings"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          className="mb-1 text-c-2 hover:text-c-2-hover"
        />
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
