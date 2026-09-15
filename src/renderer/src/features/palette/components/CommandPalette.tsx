import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/ui/icon'
import { useUiStore } from '@/platform/app-settings'
import { cn } from '@/ui/cn'
import { usePaletteItems, type PaletteItem } from './usePaletteItems'
import { tryLinkSelectionInstead } from '@/features/editor/lib/active-note-editor'

export function CommandPalette(): JSX.Element | null {
  const paletteOpen = useUiStore((s) => s.paletteOpen)
  const togglePalette = useUiStore((s) => s.togglePalette)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (paletteOpen) {
      setQuery('')
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [paletteOpen])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') togglePalette()
    }
    if (paletteOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen, togglePalette])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'k') return
      // Only while the palette is closed — with it open, ⌘K is a plain
      // toggle-closed regardless of what is selected anywhere else. A
      // selection in a note editor claims the keypress first: same
      // shortcut, different meaning, matching the "context-dependent
      // shortcut" pattern found in Tolaria's own ⌘K.
      if (!paletteOpen && tryLinkSelectionInstead()) {
        e.preventDefault()
        return
      }
      e.preventDefault()
      togglePalette()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePalette, paletteOpen])

  const items = usePaletteItems(query)

  function selectItem(item: PaletteItem): void {
    void item.action()
    togglePalette()
  }

  function handleKey(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[selected]
      if (item) selectItem(item)
    }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selected}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!paletteOpen) return null

  return (
    <div className="fixed inset-0 z-dialog flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-scrim" onClick={() => togglePalette()} />

      <div className="relative w-full max-w-lg rounded-[20px] border border-border bg-background shadow-s2 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-3 py-3">
          <Icon name="search" size={16} className="text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
            onKeyDown={handleKey}
            placeholder='Search notes or type "new ..." to create'
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-auto py-1">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">No results</div>
          ) : (
            items.map((item, idx) => (
              <button
                key={item.id}
                data-idx={idx}
                onClick={() => selectItem(item)}
                className={cn(
                  'w-full text-left px-4 py-2 text-sm flex items-baseline gap-3 transition-colors',
                  idx === selected ? 'bg-accent' : 'hover:bg-accent/50'
                )}
              >
                <span className="truncate">{item.label}</span>
                {item.sublabel ? (
                  <span className="text-[11px] text-muted-foreground truncate font-mono">
                    {item.sublabel}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
