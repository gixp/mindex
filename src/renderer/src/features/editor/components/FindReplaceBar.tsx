import { useEffect, useRef } from 'react'
import { Icon } from '@/ui/icon'
import { PANEL_SURFACE } from '@/ui/surfaces'
import { cn } from '@/ui/cn'

/**
 * What either editor's find/replace hook exposes — one bar, two controllers
 * (`useNoteSearch` for the TipTap note editor, `useSourceSearch` for the
 * CodeMirror source editor), so the UI itself never has to know which
 * editing surface it is sitting on top of.
 */
export interface FindReplaceController {
  query: string
  setQuery(q: string): void
  replaceOpen: boolean
  setReplaceOpen(open: boolean): void
  replaceText: string
  setReplaceText(t: string): void
  caseSensitive: boolean
  setCaseSensitive(v: boolean): void
  /** -1 while there are no matches. */
  currentIndex: number
  matchCount: number
  next(): void
  prev(): void
  replaceOne(): void
  replaceAll(): void
  close(): void
}

export function FindReplaceBar({
  controller,
  focusToken
}: {
  controller: FindReplaceController
  /** Bumped by the caller on every Cmd+F press, including while already open — that is what makes a second press refocus/select the query field instead of doing nothing visible. */
  focusToken: number
}): JSX.Element {
  const {
    query,
    setQuery,
    replaceOpen,
    setReplaceOpen,
    replaceText,
    setReplaceText,
    caseSensitive,
    setCaseSensitive,
    currentIndex,
    matchCount,
    next,
    prev,
    replaceOne,
    replaceAll,
    close
  } = controller

  const queryRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    queryRef.current?.focus()
    queryRef.current?.select()
  }, [focusToken])

  const counterText =
    query === '' ? '' : matchCount === 0 ? 'No results' : `${currentIndex + 1}/${matchCount}`

  return (
    <div
      style={PANEL_SURFACE}
      // `fixed`, not `absolute`: the editor's own positioned ancestor is the
      // scrolling content div (`EditorSurface`), so an absolutely-placed bar
      // would scroll away with a long note instead of staying in view.
      className="fixed right-6 top-3 z-workspace flex w-[320px] flex-col gap-1.5 rounded-10 p-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          close()
        }
      }}
    >
      <div className="flex items-center gap-1.5">
        <Icon name="search" size={12} className="shrink-0 text-muted-foreground" />
        <input
          ref={queryRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (e.shiftKey) prev()
              else next()
            }
          }}
          placeholder="Find in note"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-12.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
        <span className="shrink-0 text-11 tabular-nums text-muted-foreground">{counterText}</span>
        <button
          type="button"
          title="Match case"
          aria-label="Match case"
          aria-pressed={caseSensitive}
          onClick={() => setCaseSensitive(!caseSensitive)}
          className={cn(
            'shrink-0 rounded-6 px-1 py-0.5 font-mono text-11 font-medium transition-colors',
            caseSensitive
              ? 'bg-accent-1/[0.14] text-accent-1'
              : 'text-muted-foreground hover:bg-bg-3'
          )}
        >
          Aa
        </button>
        <IconButton
          title="Previous match (⇧↵)"
          icon="chevron-up"
          onClick={prev}
          disabled={matchCount === 0}
        />
        <IconButton
          title="Next match (↵)"
          icon="chevron-down"
          onClick={next}
          disabled={matchCount === 0}
        />
        <IconButton
          title={replaceOpen ? 'Hide replace' : 'Replace'}
          icon="replace"
          onClick={() => setReplaceOpen(!replaceOpen)}
          active={replaceOpen}
        />
        <IconButton title="Close (Esc)" icon="close" onClick={close} />
      </div>

      {replaceOpen ? (
        <div className="flex items-center gap-1.5 border-t border-border pt-1.5">
          <span className="w-[13px] shrink-0" />
          <input
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                replaceOne()
              }
            }}
            placeholder="Replace with"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-12.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
          <button
            type="button"
            onClick={replaceOne}
            disabled={matchCount === 0}
            className="shrink-0 rounded-6 px-1.5 py-0.5 text-11 font-medium text-muted-foreground transition-colors hover:bg-bg-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={replaceAll}
            disabled={matchCount === 0}
            className="shrink-0 rounded-6 px-1.5 py-0.5 text-11 font-medium text-muted-foreground transition-colors hover:bg-bg-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            All
          </button>
        </div>
      ) : null}
    </div>
  )
}

function IconButton({
  title,
  icon,
  onClick,
  disabled,
  active
}: {
  title: string
  icon: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-6 transition-colors',
        active ? 'bg-accent-1/[0.14] text-accent-1' : 'text-muted-foreground hover:bg-bg-3',
        'disabled:cursor-not-allowed disabled:opacity-40'
      )}
    >
      <Icon name={icon} size={12} />
    </button>
  )
}
