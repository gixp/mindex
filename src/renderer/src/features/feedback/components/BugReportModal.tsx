import { useState, type ReactNode } from 'react'
import type { BugReportCategory } from '@shared/types'
import { StandardDialog } from '@/ui/StandardDialog'
import { Icon } from '@/ui/icon'
import { Segmented } from '@/features/settings/components/primitives'
import { api } from '@/platform/api'
import { useUiStore } from '@/platform/app-settings'
import { cn } from '@/ui/cn'
import { useNotificationsStore } from '@/platform/notifications'

const CATEGORIES: { value: BugReportCategory; icon: string; label: string }[] = [
  { value: 'bug', icon: 'bug', label: 'Bug' },
  { value: 'feedback', icon: 'feedback', label: 'Feedback' },
  { value: 'feature', icon: 'lightbulb', label: 'Feature' }
]

// The same box every field in every window is now drawn with: the quiet
// border, the window radius one step down, and a border that brightens on
// focus rather than a coloured ring. It used to grow a three-pixel blue halo,
// which nothing else in the app does.
const inputCls =
  'w-full rounded-12 border border-bd-1 bg-transparent px-3 py-2 text-12.5 text-c-1 outline-none transition-colors placeholder:text-c-2/60 focus:border-bd-2'

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-12.5 text-c-1">{label}</span>
        {hint ? <span className="text-11 text-c-2">{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}

// Bug report / feedback form. User-initiated, so it is allowed to send — but it
// never includes note content (see main/feedback, which now sends these to the
// crash reporter rather than to a table of their own).
export function BugReportModal(): JSX.Element {
  const open = useUiStore((s) => s.bugReportOpen)
  const setOpen = useUiStore((s) => s.setBugReportOpen)
  const showError = useNotificationsStore((s) => s.showError)

  // Whichever door was used to get here. Help offers "Report a bug" and "Send
  // feedback" separately, and arriving on the wrong one means the first thing
  // a person does is correct the form.
  const openedAs = useUiStore((s) => s.bugReportCategory)
  const [category, setCategory] = useState<BugReportCategory>(openedAs)
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  // Same rule onSubmit already enforces — mirrored here so the button reflects
  // it before the click, not just after a rejected one.
  const canSubmit = description.trim().length > 0

  function reset(): void {
    setCategory(useUiStore.getState().bugReportCategory)
    setDescription('')
    setEmail('')
    setSent(false)
  }

  function onOpenChange(next: boolean): void {
    // Not while a report is in flight. The old header had its own close
    // button and disabled it for exactly this; the shared window's cross is
    // always live, so the refusal moves here. Closing mid-send left the
    // request running and, if it failed, produced an error about a window
    // that was no longer on screen.
    if (!next && sending) return
    setOpen(next)
    if (!next) window.setTimeout(reset, 200)
  }

  async function onSubmit(): Promise<void> {
    if (sending) return
    if (!description.trim()) {
      showError('Nothing to send', 'Please describe the issue first.')
      return
    }
    setSending(true)
    try {
      const res = await api().feedback.submit({
        category,
        // No title field any more: one box to write in, and the list on the
        // other end takes its subject from the first line of the text.
        title: '',
        description: description.trim(),
        email: email.trim() || undefined
      })
      if (!res.ok) throw new Error(res.error ?? 'Failed to send.')
      setSent(true)
    } catch (e) {
      showError('Could not send', e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <StandardDialog
      open={open}
      onOpenChange={onOpenChange}
      icon="bug"
      title={sent ? 'Report sent' : 'Report a bug'}
      subtitle={
        sent
          ? 'Thanks — every one is read.'
          : 'What went wrong, what you expected, or what you wish it did. Your notes are never attached.'
      }
      width={520}
      height="auto"
    >
      <>
        {sent ? (
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-10 bg-accent-1 px-4 py-2 text-12.5 font-medium text-white transition-colors hover:bg-accent-1/90 [&_.codicon::before]:!text-white"
          >
            Close
          </button>
        ) : (
          <div className="space-y-4">
            <Field label="Type">
              <Segmented<BugReportCategory>
                value={category}
                onChange={setCategory}
                options={CATEGORIES}
              />
            </Field>

            <Field label="Details">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="What happened? Steps to reproduce, what you expected…"
                className={`${inputCls} resize-y min-h-[96px]`}
              />
            </Field>

            <Field label="Email" hint="optional — only if you want a reply">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputCls}
              />
            </Field>

            {/* Full width, like the onboarding's own forward button — the close
                control in the header already covers "changed my mind", so
                nothing duplicates it here. */}
            <button
              type="button"
              onClick={() => void onSubmit()}
              disabled={sending || !canSubmit}
              className={cn(
                'mt-1 inline-flex w-full items-center justify-center gap-2 rounded-10 px-4 py-2 text-12.5 font-medium transition-colors disabled:cursor-default',
                canSubmit
                  ? 'bg-accent-1 text-white hover:bg-accent-1/90 [&_.codicon::before]:!text-white'
                  : 'bg-bg-2 text-c-2'
              )}
            >
              {sending ? (
                <>
                  <Icon name="sync" size={15} className="animate-spin" />
                  Sending…
                </>
              ) : (
                'Send report'
              )}
            </button>
          </div>
        )}
      </>
    </StandardDialog>
  )
}
