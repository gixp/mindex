import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useVaultStore } from '@/platform/workspace'
import { useUiStore } from '@/platform/app-settings'
import { api } from '@/platform/api'
import { Icon } from '@/ui/icon'
import { useFolderLook } from '@/platform/presentation'
import { MenuGroup, MenuItem, MenuSeparator } from '@/ui/menu'
import { ChromeButton } from '@/ui/chrome-button'
import { cn } from '@/ui/cn'

const PANEL_WIDTH = 250
const VIEWPORT_MARGIN = 8

function shortPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~')
}

export function WorkspaceMenu({
  placement = 'bottom'
}: {
  /** 'top' opens the panel upward — needed when the button sits at the
   *  bottom of the sidebar, where a downward panel would run off-screen. */
  placement?: 'bottom' | 'top'
} = {}): JSX.Element {
  const rootLook = useFolderLook('', '')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // The trigger lives inside the narrow, `overflow-hidden` left sidebar, so
  // an absolutely-positioned panel gets clipped at the sidebar's edge.
  // Rendered into a portal and positioned `fixed` from the trigger's
  // measured rect instead, it escapes that clipping.
  const [coords, setCoords] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const vault = useVaultStore((s) => s.vault)
  const openWorkspaces = useVaultStore((s) => s.openWorkspaces)
  const removeOpenWorkspace = useVaultStore((s) => s.removeOpenWorkspace)
  const openVault = useVaultStore((s) => s.openVault)
  const pickVault = useVaultStore((s) => s.pickVault)
  const createVault = useVaultStore((s) => s.createVault)
  const setCloneVaultOpen = useUiStore((s) => s.setCloneVaultOpen)

  useLayoutEffect(() => {
    if (!open) return
    const btn = triggerRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const left = Math.min(r.left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN)
    setCoords(
      placement === 'top'
        ? { left, bottom: window.innerHeight - r.top + 4 }
        : { left, top: r.bottom + 4 }
    )
  }, [open, placement])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent): void {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const otherOpen = openWorkspaces.filter((item) => item.root !== vault?.root)

  return (
    <div ref={ref} className="relative titlebar-no-drag">
      <ChromeButton
        ref={triggerRef}
        icon="folder-library"
        iconClassName="codicon-inherit"
        label={vault?.name ?? 'Vault'}
        truncateLabel
        tone="subtle"
        active={open}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          'max-w-[200px] text-c-2 hover:text-c-2-hover hover:bg-bg-2',
          open && 'bg-bg-2'
        )}
      >
        <Icon name="unfold" size={12} className="codicon-inherit shrink-0" />
      </ChromeButton>

      {open && coords
        ? createPortal(
            <div
              ref={panelRef}
              style={{
                left: coords.left,
                top: coords.top,
                bottom: coords.bottom,
                width: PANEL_WIDTH
              }}
              className="fixed z-dialog overflow-hidden rounded-r2 border border-bd-2 bg-bg-2 p-1 shadow-s2"
            >
              {vault ? (
                <MenuGroup label="Current vault">
                  {/* The same mark the whole app gives the workspace root, and
                      the same "this is the chosen one" fill every picker uses
                      — rather than a card with its own border, radius and tint
                      written here. The path is the row's second line, not a
                      div underneath it guessing at the icon's width. */}
                  <MenuItem
                    icon={rootLook.icon ?? 'folder-library'}
                    label={vault.name}
                    hint={shortPath(vault.root)}
                    selected
                  />
                </MenuGroup>
              ) : null}

              {otherOpen.length > 0 ? (
                <>
                  <MenuSeparator />
                  <MenuGroup label="Other vaults">
                    {otherOpen.map((item) => (
                      <MenuItem
                        key={item.root}
                        icon="folder"
                        label={item.name}
                        hint={shortPath(item.root)}
                        onClick={() => {
                          setOpen(false)
                          void openVault(item.root)
                        }}
                        action={
                          // Trash, not an X — the same icon the Vaults
                          // settings screen uses for the identical action, and
                          // the same red under the pointer.
                          <button
                            type="button"
                            title="Remove from list"
                            aria-label="Remove from list"
                            onClick={() => void removeOpenWorkspace(item.root)}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-6 text-c-2 opacity-0 transition-opacity hover:text-red-400 group-hover/row:opacity-100 [&:hover_.codicon]:!text-red-400 [&:hover_.codicon::before]:!text-red-400"
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        }
                      />
                    ))}
                  </MenuGroup>
                </>
              ) : null}

              <MenuSeparator />

              <MenuItem
                icon="folder-opened"
                label="Open vault"
                trailing={<kbd className="font-mono">⌘O</kbd>}
                onClick={() => {
                  setOpen(false)
                  void pickVault()
                }}
              />
              <MenuItem
                icon="new-folder"
                label="New vault"
                onClick={() => {
                  setOpen(false)
                  void createVault()
                }}
              />
              <MenuItem
                icon="repo-clone"
                label="Clone Git Vault"
                onClick={() => {
                  setOpen(false)
                  setCloneVaultOpen(true)
                }}
              />

              {vault ? (
                <>
                  <MenuItem
                    icon="folder-opened"
                    label="Reveal in Finder"
                    onClick={() => {
                      setOpen(false)
                      void api().files.reveal(vault.root)
                    }}
                  />
                </>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
