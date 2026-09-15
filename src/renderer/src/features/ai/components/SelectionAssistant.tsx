import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SELECTION_TRANSFORMS, type TransformSelectionInput } from '@shared/ai'
import type { ProviderId } from '@shared/types'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'
import { MenuItem } from '@/ui/menu'
import { providerIcon, providerIconClass, providerLabel } from '@/platform/providers'
import { useUiStore } from '@/platform/app-settings'
import { useAiProposalsStore } from '@/features/ai/store'

type Anchor = TransformSelectionInput['anchor']

/**
 * The assistant's entry point in the selection toolbar.
 *
 * It knows nothing about the editor: the toolbar owns the selection and hands
 * over a way to read it. That reading happens **when the menu opens**, not
 * when a rewrite is picked. Opening the menu is the last moment the highlight
 * is certainly still there — the trigger cancels the mouse press that would
 * otherwise move focus out of the note, while a click on a menu row cannot,
 * because the row is in a different part of the page altogether.
 *
 * The menu is drawn into the page body rather than inside the toolbar: the
 * toolbar is positioned by the editor and clips what overflows it, which cut
 * the list off after its second row.
 */
export function SelectionAssistant({
  getAnchor,
  onRun
}: {
  /** The highlighted passage and the words around it, or null if there is none. */
  getAnchor(): Anchor | null
  onRun(transformId: string, anchor: Anchor, provider: ProviderId): void
}): JSX.Element {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const pending = useAiProposalsStore((s) => s.pendingTransform)
  const open = anchor !== null && at !== null

  // Whose assistant this is, drawn as its own mark in its own colour. A
  // generic wand said "some AI"; the point of naming the provider here is
  // that the rewrite is going to be spent against that subscription, and
  // which one is a thing worth seeing before pressing rather than after.
  const provider = (useUiStore((s) => s.settings?.engine?.provider) ?? 'claude') as ProviderId

  function close(): void {
    setAnchor(null)
    setAt(null)
  }

  useEffect(() => {
    if (!open) return
    function onAway(e: MouseEvent): void {
      const target = e.target as HTMLElement
      if (buttonRef.current?.contains(target)) return
      if (target.closest('[data-assistant-menu]')) return
      close()
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onAway)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onAway)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        title={`Edit the selection with ${providerLabel(provider)}`}
        // Not `disabled` while working. Disabled is drawn at 30% opacity
        // everywhere in the app, which greyed out both the assistant's mark
        // and the word beside it at the one moment they are worth looking at.
        // The press is refused in the handler instead, which is the actual
        // requirement — one rewrite at a time.
        aria-busy={pending !== null}
        // Cancels the press rather than the click: letting the press through
        // moves focus out of the note and collapses the very highlight this
        // feature acts on.
        onMouseDown={(e) => {
          e.preventDefault()
          if (pending !== null) return
          if (open) {
            close()
            return
          }
          const captured = getAnchor()
          if (!captured || !captured.exact.trim()) return
          const rect = buttonRef.current?.getBoundingClientRect()
          if (!rect) return
          setAnchor(captured)
          setAt({ left: rect.left, top: rect.bottom + 6 })
        }}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-r3 px-2 text-12.5 transition-colors hover:bg-bg-3',
          pending ? 'text-c-1' : 'text-c-2 hover:text-c-1'
        )}
      >
        <span className={cn(pending && 'ai-working-mark')}>
          <Icon
            name={providerIcon(provider)}
            size={13}
            // The brand colour holds on hover and while working: an icon that
            // is the product's own mark is not decoration that should follow
            // the label's state.
            className={providerIconClass(provider)}
          />
        </span>
        <span>{pending ? 'Working…' : 'Edit'}</span>
      </button>

      {open
        ? createPortal(
            <div
              data-assistant-menu=""
              style={{ left: at.left, top: at.top }}
              className="fixed z-dialog w-56 rounded-r2 border border-bd-2 bg-bg-2 p-1 shadow-s2"
            >
              {SELECTION_TRANSFORMS.map((t) => (
                <MenuItem
                  key={t.id}
                  icon={t.icon}
                  label={t.label}
                  onClick={() => {
                    onRun(t.id, anchor, provider)
                    close()
                  }}
                />
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
