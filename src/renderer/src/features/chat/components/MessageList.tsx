import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useChatConfig } from '@/features/terminal/store-tabs'
import { useChatStore } from '@/features/chat/store-chat'
import { useUiStore } from '@/platform/app-settings'
import { MessageBubble } from './MessageBubble'

interface Props {
  sessionId: string
  scrollerRef: React.RefObject<HTMLDivElement>
}

const TOP_GAP = 10
const BOTTOM_CHROME = 24

export function MessageList({ sessionId, scrollerRef }: Props): JSX.Element {
  const session = useChatStore((s) => s.sessions[sessionId])
  const provider = useChatConfig(sessionId).provider ?? 'claude'
  const chatFontSize = useUiStore((s) => s.chatFontSize)
  const lastTurnRef = useRef<HTMLDivElement>(null)
  const [spacer, setSpacer] = useState(0)
  /** The turn at the end last time this ran, by id. */
  const lastTurnId = useRef<string | null>(null)
  const pinPending = useRef(false)
  const pinActive = useRef(false)
  const didInitialBottom = useRef(false)

  // Memoised so the effect below, which watches the list itself rather than
  // its length, does not re-run on every render of a session with no turns.
  const turns = useMemo(() => session?.turns ?? [], [session])

  const recomputeSpacer = useCallback(() => {
    if (!pinActive.current) {
      setSpacer((prev) => (prev === 0 ? prev : 0))
      return
    }
    const scroller = scrollerRef.current
    const lastEl = lastTurnRef.current
    if (!scroller || !lastEl) return
    const need = scroller.clientHeight - lastEl.offsetHeight - TOP_GAP - BOTTOM_CHROME
    setSpacer((prev) => {
      const next = Math.max(0, need)
      return prev === next ? prev : next
    })
  }, [scrollerRef])

  useEffect(() => {
    const lastEl = lastTurnRef.current
    if (!lastEl) return
    const ro = new ResizeObserver(() => recomputeSpacer())
    ro.observe(lastEl)
    recomputeSpacer()
    return () => ro.disconnect()
  }, [turns.length, recomputeSpacer])

  useLayoutEffect(() => {
    if (turns.length === 0) {
      lastTurnId.current = null
      return
    }
    const last = turns[turns.length - 1]
    if (!last) return
    const prevId = lastTurnId.current
    lastTurnId.current = last.id
    // A turn that was not at the end a moment ago and has not answered yet is
    // the one just sent. Recognised by its id rather than by the list growing
    // by exactly one: the session is re-read from disk as a turn opens, and a
    // read that lands in the same frame changes the count by something other
    // than one — which used to mean the message scrolled nowhere at all.
    const isNew = last.id !== prevId
    const isWaiting = last.status === 'pending' || last.status === 'streaming'
    // `prevId === null` and one turn is the first message in a new chat, which
    // is a send as much as any other — there was simply nothing before it.
    const isSend = isNew && isWaiting && (prevId !== null || turns.length === 1)
    if (isSend) {
      // Always, not only when already at the foot of the conversation. Sending
      // is the person putting something on screen deliberately; a chat that
      // leaves them looking at old messages because they had scrolled up is a
      // chat that hid the thing they just did.
      pinActive.current = true
      pinPending.current = true
      recomputeSpacer()
      return
    }
    if (!didInitialBottom.current) {
      const scroller = scrollerRef.current
      if (scroller && scroller.clientHeight > 0) {
        didInitialBottom.current = true
        requestAnimationFrame(() => {
          const sc = scrollerRef.current
          if (sc) sc.scrollTop = sc.scrollHeight
        })
      }
    }
  }, [turns, recomputeSpacer, scrollerRef])

  useLayoutEffect(() => {
    if (!pinPending.current) return
    pinPending.current = false
    const scroller = scrollerRef.current
    const lastEl = lastTurnRef.current
    if (!scroller || !lastEl) return
    const scRect = scroller.getBoundingClientRect()
    const elRect = lastEl.getBoundingClientRect()
    scroller.scrollTop += elRect.top - scRect.top - TOP_GAP
  }, [spacer, scrollerRef])

  if (turns.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="font-heading text-[18px] font-medium tracking-tight text-c-1">
          What are we working on today?
        </span>
        <span className="text-[12px] text-muted-foreground/60">
          Ask, plan, or just start typing.
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-3" style={{ fontSize: chatFontSize }}>
      {turns.map((t, i) => (
        <div key={t.id} ref={i === turns.length - 1 ? lastTurnRef : undefined}>
          <MessageBubble turn={t} sessionId={sessionId} provider={provider} />
        </div>
      ))}
      <div style={{ height: spacer }} aria-hidden />
    </div>
  )
}
