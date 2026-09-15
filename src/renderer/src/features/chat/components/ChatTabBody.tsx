import { useEffect, useRef } from 'react'
import { useChatStore } from '@/features/chat/store-chat'
import { useAgentOptionsStore } from '@/features/chat/store-agentOptions'
import { useChatConfig } from '@/features/terminal/store-tabs'
import { useVaultStore } from '@/platform/workspace'
import { MessageList } from './MessageList'
import { MindexInputDock } from './MindexInputDock'

interface Props {
  sessionId: string
}

export function ChatTabBody({ sessionId }: Props): JSX.Element {
  const ensureLoaded = useChatStore((s) => s.ensureLoaded)
  const warm = useChatStore((s) => s.warm)
  useEffect(() => {
    void ensureLoaded(sessionId)
  }, [sessionId, ensureLoaded])

  // Start the CLI as soon as the tab is on screen. It needs about ten seconds
  // before it can answer anything, and those are seconds the user spends
  // reading or typing — which is the entire difference between a reply in one
  // second and a reply in fifteen.
  //
  // Gated on the vault, not just on mount: on a cold launch this tab renders
  // before the vault finishes opening, and main refuses to warm anything
  // without one. That silent refusal was why a restart left no dot at all.
  const vaultRoot = useVaultStore((s) => s.vault?.root)
  useEffect(() => {
    if (!vaultRoot) return
    warm(sessionId)
  }, [sessionId, warm, vaultRoot])

  // What this tab's assistant can be configured with. The list learned at
  // launch fills this immediately; once the tab's own conversation is up, that
  // answers instead and the menus are updated in place.
  const provider = useChatConfig(sessionId).provider ?? 'claude'
  const initAgentOptions = useAgentOptionsStore((s) => s.init)
  const loadAgentOptions = useAgentOptionsStore((s) => s.load)
  useEffect(() => initAgentOptions(), [initAgentOptions])
  useEffect(() => {
    void loadAgentOptions(sessionId, provider)
  }, [sessionId, provider, loadAgentOptions])

  const scrollerRef = useRef<HTMLDivElement>(null)

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto">
        <MessageList sessionId={sessionId} scrollerRef={scrollerRef} />
      </div>
      <MindexInputDock sessionId={sessionId} />
    </div>
  )
}
