import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/ui/icon'
import { DIALOG_CLOSE_BTN } from '@/ui/dialog-chrome'
import { CODICON_NAMES } from '@/platform/presentation/codicon-names'
import { ICON_COLORS, iconSwatch } from '@/platform/presentation/icon-colors'
import { cn } from '@/ui/cn'

const PAGE_SIZE = 96

interface IconPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  current?: string
  onPick: (codicon: string) => void
  currentColor?: string
  onPickColor: (color: string | null) => void
  defaultIcon?: { name: string; color: string | null }
}

export function IconPicker({
  open,
  onOpenChange,
  title,
  current,
  onPick,
  currentColor,
  onPickColor,
  defaultIcon
}: IconPickerProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setPage(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return CODICON_NAMES
    return CODICON_NAMES.filter((n) => n.includes(q))
  }, [query])

  // Search changing the result set can strand `page` past the new last
  // page — clamp it back rather than showing an empty grid.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages - 1)
  useEffect(() => {
    if (page !== clampedPage) setPage(clampedPage)
  }, [page, clampedPage])
  const pageItems = filtered.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE)

  const previewIconName = current ?? defaultIcon?.name ?? 'circle-large-outline'

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-dialog bg-scrim data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-dialog -translate-x-1/2 -translate-y-1/2 w-[640px] max-w-[92vw] h-[560px] max-h-[88vh] flex flex-col overflow-hidden rounded-[20px] border border-bd-3 bg-bg-2 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          aria-describedby={undefined}
        >
          <div className="flex items-start gap-3 px-6 pt-6 pb-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="flex items-center gap-2 truncate text-[16px] font-semibold leading-tight tracking-tight text-foreground">
                {/* Exactly what the tree row shows: the chosen colour, or
                    the one this kind of file already has. It used to fall back
                    to plain white, so a file with a type colour was drawn one
                    way here and another way three inches to the left. */}
                <Icon
                  name={previewIconName}
                  size={16}
                  className={currentColor ?? defaultIcon?.color ?? 'text-muted-foreground'}
                />
                <span className="truncate">{title}</span>
              </Dialog.Title>
              <p className="mt-0.5 text-[12px] text-muted-foreground">Choose an icon</p>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className={DIALOG_CLOSE_BTN}>
                <Icon name="close" size={14} />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-6 pb-4">
            <div className="relative mb-3">
              <Icon
                name="search"
                size={12}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
              />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${CODICON_NAMES.length} codicons`}
                spellCheck={false}
                className="h-8 w-full rounded-[10px] border border-bd-3 bg-transparent pl-[26px] pr-6 text-[12px] text-foreground outline-none transition-colors placeholder:text-c-2/60 focus:border-bd-2"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-bg-3 hover:text-foreground"
                >
                  <Icon name="close" size={10} />
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground shrink-0">Color</span>
              <div className="flex items-center gap-1.5">
                {ICON_COLORS.map((c) => {
                  const active = (currentColor ?? null) === c.cls
                  // Every swatch is now a colour, so each shows its own. There
                  // used to be one that meant "clear the override" and had to
                  // borrow the colour that clearing would produce — which put
                  // two identical blues side by side. Clearing is the reset
                  // button; a swatch is a choice.
                  const swatch = iconSwatch(c)
                  return (
                    <button
                      key={c.label}
                      type="button"
                      title={c.label}
                      // Pressing the chosen one again clears it, which is
                      // where clearing lives now that the reset button is
                      // gone — and the same toggle the first-run pickers use.
                      onClick={() => onPickColor(active ? null : c.cls)}
                      className={cn(
                        'h-5 w-5 rounded-full border transition-transform',
                        active ? 'border-foreground scale-110' : 'border-border hover:scale-110'
                      )}
                      style={{ backgroundColor: swatch }}
                    />
                  )
                })}
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto px-6">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1">
              {pageItems.map((name) => {
                const active = name === current
                return (
                  <button
                    key={name}
                    type="button"
                    title={name}
                    onClick={() => onPick(name)}
                    className={cn(
                      'group flex flex-col items-center justify-center gap-1 rounded p-2 transition-colors',
                      active ? 'bg-accent-1/15 ring-1 ring-accent-1/60' : 'hover:bg-accent/60'
                    )}
                  >
                    <Icon
                      name={name}
                      size={18}
                      className={active ? '!text-accent-1' : 'group-hover:!text-foreground'}
                    />
                    <span className="text-[9px] leading-none text-muted-foreground truncate w-full text-center">
                      {name}
                    </span>
                  </button>
                )
              })}
              {filtered.length === 0 ? (
                <div className="col-span-full px-3 py-8 text-center text-xs text-muted-foreground">
                  No codicons match &quot;{query}&quot;
                </div>
              ) : null}
            </div>
          </div>

          {totalPages > 1 ? (
            <div className="flex shrink-0 items-center justify-center gap-3 px-6 py-3">
              <button
                type="button"
                disabled={clampedPage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                aria-label="Previous page"
                className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-bg-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Icon name="chevron-left" size={13} />
              </button>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                Page {clampedPage + 1} of {totalPages}
              </span>
              <button
                type="button"
                disabled={clampedPage >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                aria-label="Next page"
                className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-bg-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Icon name="chevron-right" size={13} />
              </button>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
