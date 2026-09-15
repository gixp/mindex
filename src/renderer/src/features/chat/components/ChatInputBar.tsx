import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/ui/icon'
import { ChromeButton } from '@/ui/chrome-button'
import { cn } from '@/ui/cn'
import { useChatStore } from '@/features/chat/store-chat'
import { useUiStore } from '@/platform/app-settings'
import { useVaultStore } from '@/platform/workspace'
import { consumeChatAttachment, onChatAttachmentRequest } from '@/features/chat/lib/chat-attach'
import { useChatConfig, useTabsStore } from '@/features/terminal/store-tabs'
import { api } from '@/platform/api'
import { MentionPopover, type MentionItem } from './MentionPopover'
import { ComposerEditor, type ComposerHandle } from './ComposerEditor'
import type { SlashCommandEntry } from '@shared/slash-commands'
import { AgentSettings } from './AgentSettings'
import {
  useAgentCommands,
  useAgentOptions,
  useAgentOptionsStore
} from '@/features/chat/store-agentOptions'
import { providerColor } from '@/features/chat/lib/mode-colors'
import type { ModelChoice } from '@/features/chat/lib/model-choice'
import { useEditorStore } from '@/features/editor/store'
import { isVirtualPath } from '@/platform/documents'
import { isExcalidrawPath } from '@shared/excalidraw'
import { noteLook } from '@/platform/presentation'

interface Props {
  sessionId: string
  /** Seeds the attachment chips on mount — e.g. the file that was open in
   *  the editor when this chat was created. Still fully detachable like any
   *  other attachment; this only sets the starting state. */
  initialAttachments?: string[]
}

const BUILTIN_SLASH_COMMANDS: { name: string; description: string }[] = [
  { name: 'clear', description: 'Clear conversation history' },
  { name: 'compact', description: 'Summarize and compact the conversation' },
  { name: 'review', description: 'Review the current changes' },
  { name: 'init', description: 'Initialize project guidance (CLAUDE.md)' },
  { name: 'cost', description: 'Show token usage and cost' },
  { name: 'model', description: 'Change the active model' },
  { name: 'agents', description: 'Manage subagents' },
  { name: 'help', description: 'List available commands' }
]

interface MentionTrigger {
  kind: '@' | '/'
  query: string
  start: number
}

/**
 * Everything hanging above the message box wears this.
 *
 * A short row of facts about the message being written: each named by a mark
 * and dropped with one press. It carried the chosen persona as well until that
 * selector was removed, and the shape is what kept the two from drifting into
 * unrelated strips of interface stacked on each other.
 *
 * A shade larger than the size it drifted to. At eleven pixels with a
 * half-pixel of padding these were the smallest text in the app, and they
 * carry the thing it is worst to misread: which file is going.
 */
const CHIP =
  'inline-flex max-w-[220px] items-center gap-1.5 rounded-r4 bg-bg-3 py-1 pl-2 pr-1 text-12 text-foreground'

/** The cross on one of them. Quiet until pointed at, and always present. */
const CHIP_CLEAR =
  'shrink-0 inline-flex items-center self-center pr-0.5 text-muted-foreground transition-colors hover:text-foreground'

function detectTrigger(text: string, caret: number): MentionTrigger | null {
  const before = text.slice(0, caret)
  const slash = before.match(/^\/([^\s]*)$/)
  if (slash) return { kind: '/', query: slash[1] ?? '', start: 0 }
  const at = before.match(/(?:^|[\s([{])@([^\s@]*)$/)
  if (at) {
    const query = at[1] ?? ''
    return { kind: '@', query, start: caret - query.length - 1 }
  }
  return null
}

export function ChatInputBar({ sessionId, initialAttachments }: Props): JSX.Element {
  const config = useChatConfig(sessionId)
  const setChatConfig = useTabsStore((s) => s.setChatConfig)
  const agentOptions = useAgentOptions(sessionId)
  const chooseAgentOption = useAgentOptionsStore((s) => s.choose)
  const agentCommands = useAgentCommands(sessionId)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)

  // Empty means the assistant has never been reached at all — not installed,
  // never signed in, or (on the very first launch only) still within the few
  // seconds the catalogue takes to answer. There used to be a second, made-up
  // list standing in for this case: Mindex's own guess at models and modes,
  // offered as if they were real choices. They were not — a tab in this state
  // cannot send a message to anything, so picking a model from that list did
  // nothing at all. A picker that cannot do anything is worse than admitting
  // there is nothing to pick yet.
  const composerOptions = agentOptions

  const chooseComposerOption = useCallback(
    (optionId: string, value: string | boolean): void => {
      void chooseAgentOption(sessionId, optionId, value)
    },
    [chooseAgentOption, sessionId]
  )

  /**
   * A pick from the model menu, which now spans every assistant.
   *
   * Written to the tab either way, because the tab is what the next message is
   * built from. When the assistant is unchanged it is also handed to the
   * running conversation, so the model changes without a restart — that path
   * only exists while there is a session to change, and a session belonging to
   * another assistant is ended rather than talked to.
   */
  // What to ask for beyond the words typed. Lives on the tab, like the model.
  const shape = config.request ?? {}

  /**
   * The note open in the editor, vault-relative.
   *
   * Reach and "into this note" name a file, and this is the file they mean.
   * Absent for a folder view or a drawing — the same rule the attachment
   * seeding already applies — and the lines that would name it are dropped
   * rather than guessed at.
   */
  const openNote = useEditorStore((s) => s.activePath)
  const vaultRoot = useVaultStore((s) => s.vault?.root)
  const shapeNote = useMemo(() => {
    if (!openNote || isVirtualPath(openNote) || isExcalidrawPath(openNote)) return null
    if (!vaultRoot) return openNote
    return openNote.startsWith(vaultRoot + '/') ? openNote.slice(vaultRoot.length + 1) : openNote
  }, [openNote, vaultRoot])

  const chooseModel = useCallback(
    (choice: ModelChoice): void => {
      setChatConfig(sessionId, { provider: choice.provider, model: choice.model })
      if (choice.provider !== config.provider) return
      const option = composerOptions.find((o) => o.category === 'model')
      if (option) void chooseAgentOption(sessionId, option.id, choice.model)
    },
    [setChatConfig, sessionId, config.provider, composerOptions, chooseAgentOption]
  )

  // Send, stop and the box's own edge carry the colour of the *assistant* the
  // message will reach. That is the fact most worth seeing before pressing
  // send, and nothing on the composer said it — the button used to carry the
  // permission mode instead, which is now said by the mode's own icon in the
  // menu where the mode is chosen (see AgentSettings).
  const accent = providerColor(config.provider)
  const showFileIcons = useUiStore((s) => s.showFileIcons)
  const send = useChatStore((s) => s.send)

  const cancel = useChatStore((s) => s.cancel)
  const [composerEmpty, setComposerEmpty] = useState(true)
  const composerRef = useRef<ComposerHandle>(null)
  const [sending, setSending] = useState(false)
  const [attachments, setAttachments] = useState<string[]>(initialAttachments ?? [])
  const activeTabId = useTabsStore((s) => s.activeId)

  // A file handed over from outside the chat — the corner button, with a note
  // open. Only the composer of the tab actually on screen takes it, and taking
  // it clears the request, so it lands in one chat rather than in every one
  // that happens to be mounted.
  useEffect(() => {
    const take = (): void => {
      if (activeTabId !== sessionId) return
      const path = consumeChatAttachment()
      if (!path) return
      setAttachments((prev) => (prev.includes(path) ? prev : [...prev, path]))
    }
    take()
    return onChatAttachmentRequest(take)
  }, [activeTabId, sessionId])

  const notes = useVaultStore((s) => s.notes)
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [customCommands, setCustomCommands] = useState<SlashCommandEntry[]>([])

  useEffect(() => {
    let alive = true
    void api()
      .claude.listCommands()
      .then((r) => {
        if (alive && r.ok && r.data) setCustomCommands(r.data)
      })
    return () => {
      alive = false
    }
  }, [sessionId])

  const mentionItems: MentionItem[] = useMemo(() => {
    if (!trigger) return []
    const q = trigger.query.toLowerCase()
    if (trigger.kind === '@') {
      return notes
        .filter((n) => !n.isDirectory)
        .filter(
          (n) => !q || n.relPath.toLowerCase().includes(q) || n.title.toLowerCase().includes(q)
        )
        .sort((a, b) => {
          const ap = (a.relPath.split('/').pop() ?? '').toLowerCase().startsWith(q) ? 0 : 1
          const bp = (b.relPath.split('/').pop() ?? '').toLowerCase().startsWith(q) ? 0 : 1
          return ap - bp || a.relPath.length - b.relPath.length
        })
        .slice(0, 8)
        .map((n) => {
          const base = n.relPath.split('/').pop() ?? n.relPath
          return {
            value: `@${n.relPath}`,
            label: base,
            sub: n.relPath,
            // Was the extension default alone, which silently ignored an
            // icon the person had chosen for this note. Read now rather than
            // subscribed: the list is rebuilt every time the popover opens.
            icon: noteLook(n.path, base).icon ?? 'file',
            iconKind: 'file' as const
          }
        })
    }
    const seen = new Set<string>()
    const rows: MentionItem[] = []
    for (const c of customCommands) {
      seen.add(c.name)
      rows.push({
        value: `/${c.name}`,
        label: `/${c.name}`,
        sub: c.description || c.scope,
        icon: 'sparkle'
      })
    }
    // What the assistant says it accepts — its own commands plus every skill
    // the user has installed. Mindex's own list is eight names; the assistant
    // here reports forty-nine, and none of the extra ones could have been known
    // in advance. Kept as a fallback for when the assistant was never reached.
    for (const c of agentCommands) {
      if (seen.has(c.name)) continue
      seen.add(c.name)
      rows.push({
        value: `/${c.name}`,
        label: `/${c.name}`,
        sub: c.description,
        icon: 'terminal'
      })
    }
    if (agentCommands.length === 0) {
      for (const c of BUILTIN_SLASH_COMMANDS) {
        if (seen.has(c.name)) continue
        rows.push({
          value: `/${c.name}`,
          label: `/${c.name}`,
          sub: c.description,
          icon: 'terminal'
        })
      }
    }
    return rows.filter((it) => !q || it.label.toLowerCase().includes(q)).slice(0, 10)
  }, [trigger, notes, customCommands, agentCommands])

  const mentionOpen = trigger !== null && mentionItems.length > 0
  const clampedMentionIndex = mentionItems.length
    ? ((mentionIndex % mentionItems.length) + mentionItems.length) % mentionItems.length
    : 0

  const handleComposerChange = useCallback((beforeCaret: string, isEmpty: boolean): void => {
    setTrigger(detectTrigger(beforeCaret, beforeCaret.length))
    setMentionIndex(0)
    setComposerEmpty(isEmpty)
  }, [])

  const acceptMention = useCallback(
    (index: number): void => {
      const item = mentionItems[index]
      if (!item || !trigger) return
      composerRef.current?.acceptMention(item, trigger.query)
      setTrigger(null)
    },
    [mentionItems, trigger]
  )

  const awaitingReply = useChatStore((s) => {
    const session = s.sessions[sessionId]
    if (!session || session.turns.length === 0) return false
    const last = session.turns[session.turns.length - 1]!
    return last.status === 'pending' || last.status === 'streaming'
  })

  const canSend = !composerEmpty || attachments.length > 0

  const doSend = useCallback(
    async (body: string): Promise<void> => {
      setSending(true)
      try {
        await send({
          sessionId,
          text: body,
          provider: config.provider ?? 'claude',
          model: config.model,
          effort: config.effort,
          permissionMode: config.permissionMode,
          attachments,
          // The choice, as data. The app half turns it into words and fences
          // the vault's tools with it — both in one place, so the sentence the
          // assistant reads and the rule its tools obey cannot drift apart.
          shape: {
            ...shape,
            scope: { kind: shape.scope ?? 'vault', note: shapeNote ?? '' }
          }
        })
      } finally {
        setSending(false)
      }
    },
    [
      send,
      sessionId,
      config.provider,
      config.model,
      config.effort,
      config.permissionMode,
      attachments,
      shape,
      shapeNote
    ]
  )

  const addAttachmentPaths = useCallback((paths: string[]): void => {
    if (paths.length === 0) return
    setAttachments((prev) => {
      const seen = new Set(prev)
      const next = [...prev]
      for (const p of paths) {
        if (seen.has(p)) continue
        next.push(p)
        seen.add(p)
      }
      return next
    })
  }, [])

  const pickAttachments = useCallback(async (): Promise<void> => {
    const r = await api().chat.pickAttachments()
    if (!r.ok || !r.data || r.data.length === 0) return
    addAttachmentPaths(r.data)
  }, [addAttachmentPaths])

  const onPasteFiles = useCallback(
    (e: ClipboardEvent): boolean => {
      const items = e.clipboardData?.items
      if (!items || items.length === 0) return false
      const fileItems = Array.from(items).filter((it) => it.kind === 'file')
      if (fileItems.length === 0) return false // pure text paste — leave it
      void (async () => {
        const paths: string[] = []
        for (const item of fileItems) {
          const file = item.getAsFile()
          if (!file) continue
          const osPath = (file as File & { path?: string }).path
          if (osPath) {
            paths.push(osPath)
            continue
          }
          try {
            const bytes = await file.arrayBuffer()
            const r = await api().chat.writeAttachmentBlob({
              bytes,
              extension: extFromMime(file.type)
            })
            if (r.ok && r.data) paths.push(r.data.path)
          } catch {}
        }
        addAttachmentPaths(paths)
      })()
      return true
    },
    [addAttachmentPaths]
  )

  const removeAttachment = useCallback((path: string): void => {
    setAttachments((prev) => prev.filter((p) => p !== path))
  }, [])

  const submit = useCallback(async (): Promise<void> => {
    const value = composerRef.current?.serialize().trim() ?? ''
    if (!value && attachments.length === 0) return
    // Nothing is pasted on here any more. The attachments travel as links and
    // the three rows travel as a choice; the app half turns both into what the
    // protocol carries. A path written into the text was a convention the
    // assistant had to recognise, and only one of the three did.
    const body = value
    composerRef.current?.clear()
    // Sending hands the turn over to the agent, so the caret should not stay
    // sitting in a box the user is done with — and Escape, which stops the
    // running turn, only reaches the window once the editor has let go of it.
    composerRef.current?.blur()
    setComposerEmpty(true)
    setTrigger(null)
    setAttachments([])
    // Straight out, even while the assistant is mid-answer. The app half
    // stops the running turn before this one starts — see `chat/runner.ts`.
    // It used to be held in a queue here and sent once the answer finished,
    // which got the usual case backwards: someone types during an answer
    // because the answer is going the wrong way.
    await doSend(body)
  }, [attachments, doSend])

  const stopCurrentTurn = useCallback((): void => {
    void cancel(sessionId)
  }, [cancel, sessionId])

  const onEditorKeyDown = useCallback(
    (e: KeyboardEvent): boolean => {
      if (mentionOpen) {
        if (e.key === 'ArrowDown') {
          setMentionIndex((i) => i + 1)
          return true
        }
        if (e.key === 'ArrowUp') {
          setMentionIndex((i) => i - 1)
          return true
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          acceptMention(clampedMentionIndex)
          return true
        }
        if (e.key === 'Escape') {
          setTrigger(null)
          return true
        }
      }
      if (e.key === 'Escape' && (awaitingReply || sending)) {
        stopCurrentTurn()
        return true
      }
      return false
    },
    [mentionOpen, clampedMentionIndex, acceptMention, awaitingReply, sending, stopCurrentTurn]
  )

  const busy = awaitingReply || sending
  /**
   * Stop, or send.
   *
   * While the assistant is working the button stops it — unless something has
   * been typed, in which case sending is what stopping would be for anyway:
   * the new message interrupts the answer and replaces it. Escape still stops
   * without sending.
   */
  const showStop = busy && !canSend

  return (
    <div className="shrink-0 flex flex-col gap-1.5 p-1.5">
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((p) => {
            const base = p.split('/').pop() || p
            const fi = noteLook(p, base)
            return (
              <span key={p} title={p} className={CHIP}>
                {showFileIcons ? (
                  <Icon
                    name={fi.icon ?? 'file'}
                    size={13}
                    className={cn('shrink-0', fi.colorClass || 'text-muted-foreground')}
                  />
                ) : null}
                <span className="truncate">{base}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(p)}
                  title="Remove attachment"
                  aria-label="Remove attachment"
                  className={CHIP_CLEAR}
                >
                  <Icon name="close" size={10} className="codicon-inherit" />
                </button>
              </span>
            )
          })}
        </div>
      ) : null}
      {/* The focus ring belongs to the whole block, not to the textarea inside
          it. What you are typing into is this card — the model picker and the
          send button are part of the same object — so a ring drawn around the
          text area alone described the wrong thing. `focus-within` is what
          lets a container answer for its children. */}
      {/* No colour on the edge. It carried the assistant's, on the reasoning
          that the box being written in and the button about to be pressed
          should say the same thing — but the send button already says it, in a
          filled shape that cannot be missed, and a tinted rectangle the size of
          the whole composer says it far louder than a detail of that size
          deserves. The edge is plain now, and only the weight changes on
          focus. */}
      <div
        className={cn(
          // The resting edge is the box's own fill, so there is no line until
          // there is something to say. It used to name a border level, which
          // happens to equal this fill on a dark ground and stopped doing so
          // when the light theme's borders were turned to face the other way —
          // leaving a grey rectangle drawn around the thing being typed in.
          // Only the weight changes on focus, which is the ring below.
          'relative flex flex-col gap-3 rounded-r2 border border-bg-3 bg-bg-3 px-3 pb-2.5 pt-3.5',
          'ring-1 ring-transparent transition-shadow focus-within:ring-bd-2'
        )}
      >
        {mentionOpen ? (
          <MentionPopover
            items={mentionItems}
            activeIndex={clampedMentionIndex}
            onPick={(i) => acceptMention(i)}
            onHover={(i) => setMentionIndex(i)}
          />
        ) : null}
        <div className="relative flex items-start gap-2">
          <ComposerEditor
            ref={composerRef}
            placeholder="Type your message..."
            onChange={handleComposerChange}
            onSubmit={() => void submit()}
            onKeyDownExtra={onEditorKeyDown}
            onPasteFiles={(e) => onPasteFiles(e)}
          />
        </div>

        <div className="flex items-center gap-1.5 pr-9">
          <div className="flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex items-center gap-3 w-max">
              <ChromeButton
                icon="attach"
                iconSize={16}
                title="Attach files"
                aria-label="Attach files"
                className="pl-1"
                onClick={() => void pickAttachments()}
              />
              {composerOptions.length > 0 ? (
                <AgentSettings
                  provider={config.provider ?? 'claude'}
                  options={composerOptions}
                  model={config.model}
                  shape={shape}
                  onChoose={chooseComposerOption}
                  onChooseModel={chooseModel}
                  onShape={(next) => setChatConfig(sessionId, { request: next })}
                />
              ) : (
                // Honest about why there is nothing to pick, rather than a
                // picker offering choices that go nowhere. A tab in this state
                // cannot send anything either — this is the same fact stated
                // once instead of a control that would fail silently.
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  title="Open Settings to install or sign in to an assistant"
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  <Icon name="warning" size={12} className="shrink-0" />
                  <span className="text-xs">No assistant set up</span>
                </button>
              )}
            </div>
          </div>
          <div className="absolute bottom-2.5 right-2.5 z-pane">
            {showStop ? (
              <button
                type="button"
                onClick={() => stopCurrentTurn()}
                title="Stop (Esc)"
                aria-label="Stop"
                className={cn(
                  'shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-[7px]',
                  'transition-[colors,transform] duration-100 ease-out',
                  // The same colour as the ready-to-send state: this is one
                  // button that changes what it does, not two buttons that
                  // swap places, and a colour change on top of the icon
                  // change made it read as the latter.
                  accent.button,
                  accent.buttonText,
                  'active:scale-[0.94]'
                )}
              >
                {/* Drawn rather than taken from the icon set: the set's stop is
                    an outlined square and a font glyph cannot be filled. Takes
                    the button's own colour the way the send arrow does — the
                    two are one control that changes what it does, so they must
                    not be coloured by different rules. */}
                <svg
                  width={14}
                  height={14}
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="shrink-0"
                  aria-hidden="true"
                >
                  <rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.6" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                disabled={!canSend}
                title="Send (Enter)"
                aria-label="Send"
                onClick={() => void submit()}
                className={cn(
                  'shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-[7px]',
                  'transition-[colors,transform] duration-100 ease-out active:scale-[0.94]',
                  canSend
                    ? cn(accent.button, accent.buttonText)
                    : cn(accent.buttonDisabled, 'cursor-default')
                )}
              >
                <Icon
                  name="arrow-up"
                  size={13}
                  // Inherits the button's own colour in both states, which is
                  // what lets the arrow go dark on the one light background —
                  // and go faint when there is nothing to send — without a
                  // second rule about which mode is in force.
                  className="-translate-x-px codicon-inherit"
                />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'image/svg+xml':
      return 'svg'
    default: {
      const sub = mime.split('/')[1] ?? ''
      return /^[a-z0-9]{1,8}$/.test(sub) ? sub : 'png'
    }
  }
}
