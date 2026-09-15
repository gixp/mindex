import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'
import { MenuGroup, MenuItem, MenuSeparator } from '@/ui/menu'
import { useUiStore } from '@/platform/app-settings'

const PANEL_WIDTH = 220
const VIEWPORT_MARGIN = 8

interface HelpMenuItem {
  icon: string
  label: string
  trailing?: string
  onClick(): void
}

/**
 * The product's own pages, and the repository the app-level menu already
 * opens (`main/menu.ts`). Kept in step with that menu deliberately: the two
 * were different lists claiming to be the same thing, and this one was the
 * poorer of the two.
 */
const WEBSITE = 'https://mindex.live'
const REPOSITORY = 'https://github.com/gixp/mindex'

/**
 * Opens in the OS browser, not in a window of the app's own.
 *
 * `setWindowOpenHandler` in the main process routes every `_blank` to
 * `shell.openExternal`, which is the same path the About screen's links take.
 */
function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function HelpMenu(): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null)
  // The panel's height depends on its content, so the "does it fit below"
  // check can't happen until it's actually rendered once at a guessed
  // position — this flag gates the follow-up correction to run just once
  // per open, before paint, so there's no visible flicker.
  const [measured, setMeasured] = useState(false)
  const setBugReportOpen = useUiStore((s) => s.setBugReportOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const setSettingsSection = useUiStore((s) => s.setSettingsSection)

  useLayoutEffect(() => {
    if (!open) {
      setMeasured(false)
      return
    }
    const btn = triggerRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const left = Math.min(r.left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN)
    setCoords({ left, top: r.bottom + 4 })
  }, [open])

  // Second pass: now that the panel exists (rendered below the trigger, per
  // the guess above), measure its real height and flip it to open upward
  // instead when it would otherwise run off the bottom of the window — the
  // trigger can sit anywhere in its container, including near the bottom.
  useLayoutEffect(() => {
    if (!open || !coords || measured) return
    const panel = panelRef.current
    const btn = triggerRef.current
    if (!panel || !btn) return
    const panelHeight = panel.getBoundingClientRect().height
    const r = btn.getBoundingClientRect()
    if (r.bottom + 4 + panelHeight > window.innerHeight - VIEWPORT_MARGIN) {
      const top = Math.max(VIEWPORT_MARGIN, r.top - panelHeight - 4)
      setCoords((c) => (c ? { ...c, top } : c))
    }
    setMeasured(true)
  }, [open, coords, measured])

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

  /**
   * Only things that happen when clicked.
   *
   * Eight of the nine entries here were wired to an empty function — docs, a
   * game, three community links and two announcement links, none of which had
   * anywhere to go. Help is where someone goes when they are already stuck,
   * and it was the one menu in the app guaranteed not to respond. What had a
   * destination stays, what did not is gone until it has one.
   */
  const groups: { label: string; items: HelpMenuItem[] }[] = [
    {
      label: 'Get help',
      items: [
        {
          icon: 'keyboard',
          label: 'Keyboard shortcuts',
          onClick: () => {
            setSettingsSection('hotkeys')
            setSettingsOpen(true)
          }
        },
        { icon: 'bug', label: 'Report a bug', onClick: () => setBugReportOpen(true, 'bug') },
        {
          icon: 'feedback',
          label: 'Send feedback',
          onClick: () => setBugReportOpen(true, 'feedback')
        }
      ]
    },
    {
      label: 'Mindex',
      items: [
        { icon: 'globe', label: 'mindex.live', onClick: () => openExternal(WEBSITE) },
        { icon: 'github', label: 'GitHub', onClick: () => openExternal(REPOSITORY) }
      ]
    }
  ]

  return (
    <div ref={ref} className="relative titlebar-no-drag">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Help"
        aria-label="Help"
        aria-haspopup="menu"
        aria-expanded={open}
        // The same flat shape as every other control in this row: no fill, no
        // rounding, no width of its own — only the colour moves, and the open
        // state is a colour too. A fill here made it the one mark in the
        // titlebar with a box around it.
        className={cn(
          'flex h-7 items-center justify-center text-c-2 transition-colors hover:text-c-1',
          open && 'text-c-1'
        )}
      >
        <Icon name="question" size={15} className="codicon-inherit" />
      </button>

      {open && coords
        ? createPortal(
            <div
              ref={panelRef}
              style={{ left: coords.left, top: coords.top, width: PANEL_WIDTH }}
              className="fixed z-dialog overflow-hidden rounded-r2 border border-bd-2 bg-bg-2 p-1 shadow-s2"
            >
              {groups.map((group, i) => (
                <div key={group.label}>
                  {i > 0 ? <MenuSeparator /> : null}
                  <MenuGroup label={group.label}>
                    {group.items.map((item) => (
                      <MenuItem
                        key={item.label}
                        icon={item.icon}
                        label={item.label}
                        trailing={item.trailing}
                        onClick={() => {
                          setOpen(false)
                          item.onClick()
                        }}
                      />
                    ))}
                  </MenuGroup>
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
