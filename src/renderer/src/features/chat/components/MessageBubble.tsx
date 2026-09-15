import { useState } from 'react'
import { Icon } from '@/ui/icon'
import type { ProviderId } from '@shared/types'
import { ProviderGlyph } from '@/ui/provider-glyph'
import type { ChatMessage, ChatToolPart, ChatTurn } from '@shared/chat'
import { markdownToHtml } from '@/platform/markdown/markdown'
import { handleWikilinkClick } from '@/platform/markdown/wikilink'
import { ToolCard } from './ToolCard'
import { PermissionRequestCard } from './PermissionRequestCard'
import { cn } from '@/ui/cn'
import { useNotificationsStore } from '@/platform/notifications'
import { useProvidersStore } from '@/platform/engines'

interface Props {
  turn: ChatTurn
  sessionId: string
  /** The engine answering this tab, for the thinking indicator's mark. */
  provider: ProviderId
}

export function MessageBubble({ turn, sessionId, provider }: Props): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <UserBubble msg={turn.user} />
      {turn.assistant || turn.status === 'streaming' || turn.status === 'pending' ? (
        <AssistantBubble turn={turn} provider={provider} />
      ) : null}
      {turn.pendingPermission ? (
        <PermissionRequestCard sessionId={sessionId} request={turn.pendingPermission} />
      ) : null}
      {turn.status === 'failed' && turn.errorMessage ? (
        isCancelledMessage(turn.errorMessage) ? (
          <CancelledDivider />
        ) : turn.errorReason === 'auth' ? (
          <SignedOutCard message={turn.errorMessage} provider={provider} />
        ) : (
          <FailedTurnChip message={turn.errorMessage} />
        )
      ) : null}
    </div>
  )
}

/**
 * When a message was sent, as a clock reads it.
 *
 * The locale's own twelve- or twenty-four-hour habit, not a format written
 * out here: a reader in one place should not be handed the other's clock. Only
 * the hour and the minute — a conversation is measured in minutes, and seconds
 * on every message is noise that never answers a question anybody asked.
 */
function clockTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** The time under a message, quiet enough to be ignored while reading. */
function SentAt({ ts, align }: { ts: number; align: 'left' | 'right' }): JSX.Element | null {
  const text = clockTime(ts)
  if (!text) return null
  return (
    <span
      className={cn(
        'select-none text-10.5 leading-none text-muted-foreground/70',
        align === 'right' ? 'self-end' : 'self-start'
      )}
    >
      {text}
    </span>
  )
}

function UserBubble({ msg }: { msg: ChatMessage }): JSX.Element {
  return (
    <div className="flex flex-col items-end ml-auto max-w-[86%] gap-1">
      <div className="bg-bg-3 px-[10px] py-[7.5px] leading-relaxed text-foreground rounded-[12px] rounded-br-[5px]">
        <div
          className="chat-bubble"
          onClick={(e) => {
            if (handleWikilinkClick(e.target)) e.preventDefault()
          }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: markdownToHtml(msg.text) }}
        />
      </div>
      <SentAt ts={msg.ts} align="right" />
    </div>
  )
}

function AssistantBubble({
  turn,
  provider
}: {
  turn: ChatTurn
  provider: ProviderId
}): JSX.Element {
  const assistant = turn.assistant
  const parts = assistant?.parts ?? []
  const legacyTools = assistant?.toolUses ?? []
  const isPending = turn.status === 'pending'
  const isStreaming = turn.status === 'streaming'
  const hasContent = parts.length > 0 || !!assistant?.text || legacyTools.length > 0

  const onClick = (e: React.MouseEvent): void => {
    if (handleWikilinkClick(e.target)) e.preventDefault()
  }

  const partNodes: React.ReactNode[] = []
  let toolRun: ChatToolPart[] = []
  const flushTools = (): void => {
    if (toolRun.length === 0) return
    const run = toolRun
    partNodes.push(
      <div key={`tools-${partNodes.length}`} className="flex flex-wrap gap-1.5">
        {run.map((t, j) => (
          <ToolCard key={j} part={t} />
        ))}
      </div>
    )
    toolRun = []
  }
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (part.type === 'tool') {
      toolRun.push(part)
      continue
    }
    flushTools()
    if (part.text.trim()) {
      partNodes.push(
        <div
          key={i}
          className="chat-bubble"
          onClick={onClick}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: markdownToHtml(part.text) }}
        />
      )
    }
  }
  flushTools()

  return (
    <div className="w-full leading-relaxed text-foreground">
      {parts.length > 0 ? (
        <div className="flex flex-col gap-1.5">{partNodes}</div>
      ) : assistant ? (
        <>
          {legacyTools.length > 0 ? (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {legacyTools.map((tool, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                  title={tool.inputPreview}
                >
                  <Icon name="tools" size={9} />
                  {tool.name}
                </span>
              ))}
            </div>
          ) : null}
          {assistant.text ? (
            <div
              className="chat-bubble"
              onClick={onClick}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: markdownToHtml(assistant.text) }}
            />
          ) : null}
        </>
      ) : null}
      {/* Only once the answer is whole: a button that copies half a sentence
          is a button that copies the wrong thing. */}
      {assistant && !isPending && !isStreaming ? (
        <div className="mt-1 flex items-center gap-2">
          {assistant.text ? <CopyAnswer text={assistant.text} /> : null}
          <SentAt ts={assistant.ts} align="left" />
        </div>
      ) : null}
      {(isPending || isStreaming) && !hasContent ? (
        <div className="mt-1.5 inline-flex items-center gap-1.5 text-muted-foreground">
          {/* Whoever is actually answering. A fixed Claude mark here was a
              small lie in the one moment the user is watching most closely —
              waiting for a reply is exactly when "which engine is this?"
              matters. */}
          <ProviderGlyph id={provider} size={12} className="animate-pulse" />
          <span className="italic">Thinking…</span>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Copy the answer, under the answer.
 *
 * The reply is markdown that usually wants to go somewhere else — a note, a
 * message, a commit. Selecting it by hand means dragging across a rendered
 * document and getting the rendering rather than the source, which is the one
 * thing you did not want.
 *
 * What is copied is the assistant's own text, before it was turned into HTML.
 * Always on screen, and nothing but the glyph — no box, no padding, no hover
 * fill. It used to appear only once the turn was pointed at, which meant the
 * one thing you reach for after reading an answer was the one thing you had to
 * find first.
 */
function CopyAnswer({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false)

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // The clipboard is either there or it is not, and failing to copy is not
      // worth interrupting a conversation over.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={copied ? 'Copied' : 'Copy this answer'}
      aria-label={copied ? 'Copied' : 'Copy this answer'}
      className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
    >
      <Icon name={copied ? 'check' : 'copy'} size={12} className="codicon-inherit" />
    </button>
  )
}

function isCancelledMessage(message: string): boolean {
  const m = message.trim().toLowerCase()
  return m === 'cancelled' || m === 'canceled' || m === 'aborted' || m === 'interrupted'
}

function CancelledDivider(): JSX.Element {
  return (
    <div className="my-0.5 flex items-center gap-2 select-none" aria-label="Turn cancelled">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[11px] text-muted-foreground">cancelled</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

/**
 * The one failure a person can clear from where they are standing.
 *
 * A lapsed sign-in used to arrive as the adapter's own log tail — a line
 * naming a phase and a duration — leaving someone to work out for themselves
 * that the fix was a terminal and a login command. The command is the same one
 * Settings runs, reached from the conversation that just stopped.
 */
function SignedOutCard({
  message,
  provider
}: {
  message: string
  provider: ProviderId
}): JSX.Element {
  const headline = firstLineOf(message) || 'The assistant is signed out'
  const showError = useNotificationsStore((s) => s.showError)
  const signIn = useProvidersStore((s) => s.signIn)
  const refresh = useProvidersStore((s) => s.refresh)
  const signInError = useProvidersStore((s) => s.signInError)
  const info = useProvidersStore((s) => s.items.find((p) => p.id === provider))
  const [opened, setOpened] = useState(false)

  return (
    <div className="self-start max-w-[88%] flex flex-col gap-2 rounded-12 border border-red-400/45 bg-red-400/[0.12] p-3 text-left text-xs text-red-400">
      <div className="flex items-center gap-2">
        <Icon name="sign-out" size={12} className="shrink-0 codicon-red" />
        <span className="min-w-0 flex-1">{headline}</span>
      </div>
      {/* The command itself, because the terminal that opens is the CLI's own
          and it is the one thing to type there. */}
      {info?.loginHint ? (
        <div className="text-11 text-muted-foreground">{info.loginHint}</div>
      ) : null}
      {signInError ? <div className="text-11">{signInError}</div> : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setOpened(true)
            void signIn(provider)
          }}
          className="rounded-md bg-red-400/20 px-2 py-0.5 text-11 font-medium text-red-400 transition-colors hover:bg-red-400/30"
        >
          Sign in
        </button>
        {/* Signing in happens in a terminal this window does not watch, so the
            only honest way back is to ask again once it is done. */}
        {opened ? (
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-md px-2 py-0.5 text-11 text-muted-foreground transition-colors hover:text-foreground"
          >
            I&apos;ve signed in
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => showError(headline, message)}
          title="Show error details"
          className="ml-auto rounded-md px-2 py-0.5 text-10 font-medium tracking-wide uppercase text-red-400/80 transition-colors hover:text-red-400"
        >
          Details
        </button>
      </div>
      {opened ? (
        <div className="text-11 text-muted-foreground">
          Finish signing in, then send your message again.
        </div>
      ) : null}
    </div>
  )
}

function FailedTurnChip({ message }: { message: string }): JSX.Element {
  const headline = firstLineOf(message) || 'The engine returned an error'
  const showError = useNotificationsStore((s) => s.showError)
  return (
    // A container, not a button. The whole chip used to be clickable, which
    // made an error message something you could open by brushing past it while
    // reaching for the text — and gave no clue that the click did anything.
    // Only Details is pressable now, and it is the only thing that reacts.
    <div className="self-start max-w-[88%] inline-flex items-center gap-2 rounded-[12px] border border-red-400/45 bg-red-400/[0.12] p-3 text-left text-xs text-red-400">
      {/* `codicon-red`, not the container's colour: globals.css paints every
          `.codicon` grey with `!important`, so an icon inside coloured text
          stays grey unless it names a colour helper of its own. */}
      <Icon name="error" size={12} className="shrink-0 codicon-red" />
      <span className="truncate min-w-0 flex-1">{headline}</span>
      <button
        type="button"
        onClick={() => showError(headline, message)}
        title="Show error details"
        className="shrink-0 rounded-md bg-red-400/20 px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase text-red-400 transition-colors hover:bg-red-400/30"
      >
        Details
      </button>
    </div>
  )
}

function firstLineOf(text: string): string {
  const line =
    text
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  return line.length > 140 ? `${line.slice(0, 137)}…` : line
}
