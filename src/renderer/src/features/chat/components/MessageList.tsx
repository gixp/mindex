import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  const prevCount = useRef<number | null>(null)
  const pinPending = useRef(false)
  const pinActive = useRef(false)
  const didInitialBottom = useRef(false)
  const atBottomRef = useRef(true)

  const turns = session?.turns ?? []

  useEffect(() => {
    const sc = scrollerRef.current
    if (!sc) return
    const onScroll = (): void => {
      atBottomRef.current = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 80
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => sc.removeEventListener('scroll', onScroll)
  }, [scrollerRef])

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
    const prev = prevCount.current
    prevCount.current = turns.length
    if (turns.length === 0) return
    const last = turns[turns.length - 1]
    const isSend =
      prev != null &&
      turns.length === prev + 1 &&
      (last?.status === 'pending' || last?.status === 'streaming')
    if (isSend) {
      if (atBottomRef.current) {
        pinActive.current = true
        pinPending.current = true
      } else {
        pinActive.current = false
      }
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
  }, [turns.length, recomputeSpacer, scrollerRef])

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
