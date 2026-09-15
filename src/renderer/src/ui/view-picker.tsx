import type { ProviderId } from '@shared/types'
import { ProviderGlyph } from './provider-glyph'
import { Icon } from './icon'
import { cn } from '@/ui/cn'
import { PICKER_SELECTED } from './picker-option'

/**
 * Chat UI or the provider's terminal, as two drawn miniatures.
 *
 * Lives here rather than inside the first-run dialog because the same question
 * is asked twice: once during setup, and again in Settings → Right sidebar. One
 * copy means the two cannot drift into two different answers to one question.
 */
export type PanelView = 'chat' | 'cli'

/**
 * Miniature of the chat UI: two bubbles, the reply carrying the provider's mark.
 *
 * Drawn rather than screenshotted so it stays sharp at any zoom, follows the
 * theme, and cannot go stale when the real panel is restyled.
 */
export function ChatPreview({ provider }: { provider: ProviderId }): JSX.Element {
  return (
    <div className="flex h-[112px] w-full flex-col gap-1.5 rounded-[10px] border border-bd-2 bg-bg-1 p-2">
      {/* Real words rather than grey bars: a row of blank rectangles reads as
          a loading skeleton, which is the opposite of showing what the view
          looks like when it is working. */}
      {/* MessageBubble.tsx:37 — the user's turn is a faint neutral fill, not a
          tinted one, with the corner nearest the edge tightened. */}
      <div className="flex justify-end">
        <span className="rounded-[4px] rounded-br-[2px] bg-bg-3 px-[5px] py-[4px] text-[6.5px] leading-none text-foreground">
          Summarise this week
        </span>
      </div>
      {/* MessageBubble.tsx:140 — the working state, and the one place the
          provider's mark appears in the real transcript. */}
      <div className="flex items-center gap-1">
        <ProviderGlyph id={provider} size={7} className="shrink-0" />
        <span className="text-[5.5px] leading-none text-foreground">Thinking...</span>
      </div>
      {/* A tool card — the thing the chat view has and the terminal does not. */}
      {/* Still lighter than the ground it sits on, so the card reads as raised
          — but only just. `border-border` is darker than this preview's fill
          and disappeared into it entirely. */}
      {/* Half a pixel rather than one: the window runs at a 1.1 zoom factor,
          so a 1px stroke lands on ~2 physical pixels and reads heavy at this
          scale. */}
      <div className="flex w-fit items-center gap-1 rounded-[3px] border-[0.5px] border-bd-2 px-1 py-[2px]">
        {/* `codicon-emerald`, not `codicon-green` — the latter is not defined
            in globals.css, and an unknown helper loses silently to the base
            `.codicon` rule's `!important` grey. */}
        <Icon name="check" size={5} className="shrink-0 codicon-emerald" />
        <span className="font-mono text-[5px] leading-none text-muted-foreground">
          Read 3 files
        </span>
      </div>
      {/* The message box, pinned to the bottom like the real panel — an
          outline only, matching the tool card above it. Tighter on the right
          than the left because that side holds the send button, which sits
          closer to the edge than text would. */}
      <div className="mt-auto flex items-center gap-1 rounded-[4px] border-[0.5px] border-bd-2 py-[2px] pl-[4px] pr-[2px]">
        <span className="text-[6.5px] leading-none text-muted-foreground/80">
          Type your message...
        </span>
        {/* ChatInputBar.tsx:463-476 — a filled blue square with a white
            arrow-up, not a bare send glyph. */}
        <span className="ml-auto flex h-[10px] w-[10px] shrink-0 items-center justify-center rounded-[3px] bg-accent-1/45">
          {/* `codicon-muted`, not a plain `text-*` class: the base `.codicon`
              rule in globals.css sets colour with `!important`, so an ordinary
              utility loses to it silently and the arrow would stay grey by
              accident rather than by choice. */}
          <Icon name="arrow-up" size={7} className="codicon-muted" />
        </span>
      </div>
    </div>
  )
}

/**
 * Miniature of the terminal.
 *
 * Takes no provider: the prompt now carries the user's request rather than the
 * binary's name, so nothing in this pane differs between the three CLIs.
 */
export function CliPreview(): JSX.Element {
  return (
    /* `text-left` because the option card sets `text-center`, which the output
       rows below inherit — they are block-level inside a flex column, so the
       centring actually applies and pulled every line off the prompt. */
    <div className="flex h-[112px] w-full flex-col gap-[5px] rounded-[10px] border border-bd-2 bg-bg-1 p-2 text-left font-mono">
      {/* The same request the chat preview shows, so the two panes are the one
          task seen two ways rather than two unrelated scenes. Sized to match
          the prompt line at the bottom. */}
      <div className="flex items-center gap-1">
        <span className="text-[9px] leading-none text-accent-1">❯</span>
        <span className="whitespace-nowrap text-[6.5px] leading-none text-c-1">
          Summarize this week
        </span>
      </div>
      {/* Streamed output: full-width lines, no bubbles, no avatars. */}
      <div className="flex flex-col gap-[2px] overflow-hidden">
        <span className="whitespace-nowrap text-[6.5px] leading-none text-c-2">
          ● Reading vault…
        </span>
        {/* A diff, the shape terminal output takes when it edits files. */}
        <span className="whitespace-nowrap text-[6.5px] leading-none text-emerald-500/80">
          + weekly summary
        </span>
        <span className="whitespace-nowrap text-[6.5px] leading-none text-red-500/70">
          - stale index
        </span>
        <span className="whitespace-nowrap text-[6.5px] leading-none text-c-2">Done in 4.2s</span>
      </div>
      {/* Live prompt, mid-typing: the cursor sits after a partial command so
          the pane reads as something being used rather than sitting idle. */}
      <div className="mt-auto flex items-center gap-[3px]">
        <span className="text-[9px] leading-none text-accent-1">❯</span>
        <span className="whitespace-nowrap text-[6.5px] leading-none text-c-1">index my not</span>
        <span className="inline-block h-[9px] w-[4px] bg-c-2" />
      </div>
    </div>
  )
}

/**
 * The two miniatures side by side, one of them chosen.
 *
 * `onSelect` reports the card that was clicked, including when it is the one
 * already chosen — first-run treats that as clearing the answer, Settings
 * ignores it, and neither behaviour belongs in here.
 */
export function ViewPicker({
  provider,
  value,
  onSelect
}: {
  /** Whose mark the chat miniature carries. */
  provider: ProviderId
  value: PanelView | null
  onSelect(next: PanelView): void
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3">
      {(
        [
          { id: 'chat' as const, label: 'Chat UI' },
          { id: 'cli' as const, label: 'CLI' }
        ] satisfies { id: PanelView; label: string }[]
      ).map((opt) => {
        const isPicked = opt.id === value
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onSelect(opt.id)}
            className={cn(
              'group flex flex-col items-center gap-3 rounded-[16px] border p-2.5 text-center transition-colors',
              // The chosen look is the app's shared one. The unchosen card
              // gets a ground of its own rather than the shared transparent:
              // the miniature inside is drawn at the deepest rung, because it
              // is a picture of the app, and a transparent card put a
              // panel-coloured margin around it — two surfaces where there
              // should be one screenshot in a card.
              isPicked ? PICKER_SELECTED : 'border-bd-2 bg-bg-1 hover:bg-bg-2'
            )}
          >
            {/* The preview carries the chosen provider, so the two options are
                shown as this setup rather than a generic one. */}
            {opt.id === 'chat' ? <ChatPreview provider={provider} /> : <CliPreview />}
            <span className="text-[13px] font-medium text-foreground">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
