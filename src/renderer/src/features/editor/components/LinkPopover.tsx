import { useEffect, useRef } from 'react'
import { PANEL_SURFACE } from '@/ui/surfaces'

export interface LinkPopoverState {
  rect: DOMRect
  /** Pre-filled when the selection already carries a link — editing, not creating. */
  initialHref: string
}

export function LinkPopover({
  state,
  onSubmit,
  onClose
}: {
  state: LinkPopoverState
  onSubmit: (href: string) => void
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <div
      style={{
        ...PANEL_SURFACE,
        position: 'fixed',
        left: state.rect.left,
        top: state.rect.bottom + 6
      }}
      className="z-workspace flex w-[300px] items-center gap-1.5 rounded-10 p-1.5"
    >
      <input
        ref={ref}
        defaultValue={state.initialHref}
        placeholder="Paste or type a URL, then press Enter"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-12.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            const href = e.currentTarget.value.trim()
            if (href) onSubmit(href)
            else onClose()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        onBlur={onClose}
      />
    </div>
  )
}
