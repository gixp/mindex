import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'

/**
 * Accept or cancel, at the end of the wording being offered.
 *
 * No container, and no icon standing in for a word. Two matched pills inside a
 * bordered box read as a segmented switcher whatever the spacing; a bare cross
 * on the right read as "close this panel" rather than "keep what I had". One
 * filled button and one plain word, in the order the decision is made: the way
 * out first, the thing to do last.
 *
 * The fill is the assistant's own colour, inherited from the offer this sits
 * inside rather than passed in, so the button cannot fall out of step with the
 * passage it belongs to.
 *
 * It carries no position. It is rendered into the suggestion itself, so it
 * travels with the passage: scrolling moves both together.
 */
export function InlineSuggestionBar({
  state,
  onAccept,
  onDismiss
}: {
  state: 'ready' | 'applying' | 'applied'
  onAccept(): void
  onDismiss(): void
}): JSX.Element {
  if (state === 'applied') {
    return (
      <span className="ml-2 inline-flex items-center gap-1 align-middle text-11 font-medium text-ai-done">
        <Icon name="check" size={11} className="codicon-inherit" />
        Applied
      </span>
    )
  }

  const busy = state === 'applying'
  return (
    <span className="ml-2 inline-flex items-center gap-2 align-middle">
      <button
        type="button"
        onClick={onDismiss}
        disabled={busy}
        className="text-11 text-c-2 transition-colors hover:text-c-1 disabled:opacity-30"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onAccept}
        disabled={busy}
        className={cn(
          'ai-accept inline-flex h-[22px] items-center gap-1 rounded-r4 px-2.5',
          'text-11 font-medium transition-colors disabled:opacity-30'
        )}
      >
        <Icon name="check" size={11} />
        {busy ? 'Applying…' : 'Accept'}
      </button>
    </span>
  )
}
