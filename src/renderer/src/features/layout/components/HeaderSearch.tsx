import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'
import { iconBgTint } from '@/platform/presentation/tree-display'
import { noteLook } from '@/platform/presentation'
import { usePaletteItems, type PaletteItem } from '@/features/palette/components/usePaletteItems'

function iconFor(item: PaletteItem): { name: string; color: string | null } {
  if (item.kind === 'note') {
    const basename = item.sublabel?.split('/').pop() ?? item.label
    // Was the extension default alone, which ignored an icon the person had
    // chosen for this note.
    const look = noteLook(item.path ?? '', basename)
    return { name: look.icon ?? 'file', color: look.colorClass }
  }
  if (item.kind === 'create') return { name: 'new-file', color: 'codicon-blue' }
  return { name: 'sparkle', color: 'codicon-orange' }
}

export function HeaderSearch(): JSX.Element {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const items = usePaletteItems(query)

  useEffect(() => {
    setSelected(0)
  }, [query])

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selected}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  function selectItem(item: PaletteItem): void {
    void item.action()
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
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
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const showDropdown = open && items.length > 0

  return (
    <div ref={rootRef} className="relative w-[360px] max-w-full titlebar-no-drag">
      <div
        className={cn(
          'flex h-7 items-center gap-2 rounded-[8px] bg-accent/30 px-2.5 transition-colors',
          open && 'bg-accent/50'
        )}
      >
        <Icon name="search" size={13} className="shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder="Search notes…"
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
        />
      </div>

      {showDropdown ? (
        <div
          ref={listRef}
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-dialog max-h-[60vh] overflow-auto rounded-r2 border border-bd-2 bg-bg-2 p-1 shadow-s2"
        >
          {items.map((item, idx) => {
            const icon = iconFor(item)
            return (
              <button
                key={item.id}
                data-idx={idx}
                onClick={() => selectItem(item)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left transition-colors',
                  idx === selected ? 'bg-accent' : 'hover:bg-accent/50'
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px]',
                    iconBgTint(icon.color)
                  )}
                >
                  <Icon
                    name={icon.name}
                    size={12}
                    className={icon.color ?? 'text-muted-foreground'}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-foreground">{item.label}</span>
                  {item.sublabel ? (
                    <span className="block truncate font-mono text-[10px] text-muted-foreground/70">
                      {item.sublabel}
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
