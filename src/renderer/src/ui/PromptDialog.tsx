import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  DialogActions,
  DialogHeading,
  SMALL_DIALOG_BODY,
  SMALL_DIALOG_CONTENT,
  SMALL_DIALOG_OVERLAY
} from './dialog-chrome'
import { usePromptStore } from '@/ui/prompt'

/**
 * The app's stand-in for `window.prompt`, which Electron does not implement —
 * it throws instead of returning, so the slash commands that used it produced
 * nothing at all.
 *
 * Mounted once at app level and driven by `promptText()`. Shaped like
 * `ConfirmDialog` so a prompt reads as the same kind of moment as every other
 * small modal in the app.
 */
export function PromptDialog(): JSX.Element | null {
  const request = usePromptStore((s) => s.request)
  const resolve = usePromptStore((s) => s.resolve)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  // Re-seed per request rather than per open: two prompts in a row (different
  // commands) must not inherit each other's text.
  useEffect(() => {
    if (!request) return
    setValue(request.initialValue ?? '')
    const t = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => clearTimeout(t)
  }, [request?.id])

  if (!request) return null

  const submit = (): void => resolve(value.trim() === '' ? null : value)

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) resolve(null)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay style={{ zIndex: 60 }} className={SMALL_DIALOG_OVERLAY} />
        <Dialog.Content
          style={{ zIndex: 60 }}
          className={SMALL_DIALOG_CONTENT}
          aria-describedby={undefined}
        >
          <div className={SMALL_DIALOG_BODY}>
            <DialogHeading
              title={request.title}
              {...(request.message ? { message: request.message } : {})}
              onClose={() => resolve(null)}
            />

            <div className="mt-4">
              {request.multiline ? (
                <textarea
                  ref={(el) => (inputRef.current = el)}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter inserts a newline here; the block types that use a
                    // textarea (HTML, SVG, JSON) are all multi-line by nature.
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      submit()
                    }
                  }}
                  rows={6}
                  placeholder={request.placeholder}
                  spellCheck={false}
                  className="w-full resize-y rounded-md border border-input bg-transparent px-2.5 py-2 font-mono text-[13px] leading-snug shadow-none transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none"
                />
              ) : (
                <input
                  ref={(el) => (inputRef.current = el)}
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      submit()
                    }
                  }}
                  placeholder={request.placeholder}
                  spellCheck={false}
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-2.5 py-1 text-sm shadow-none transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none"
                />
              )}
            </div>

            <DialogActions
              confirmLabel={request.confirmLabel ?? 'Insert'}
              onCancel={() => resolve(null)}
              onConfirm={submit}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
