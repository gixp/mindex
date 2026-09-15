import { useUiStore } from '@/platform/app-settings'
import { isVirtualPath, useActiveDocumentPath } from '@/platform/documents'
import { requestChatAttachment } from '@/features/chat/lib/chat-attach'
import { isExcalidrawPath } from '@shared/excalidraw'
import { ProviderGlyph } from '@/ui/provider-glyph'
import { useHasProvider } from '@/platform/engines'
import { useActiveChatProvider } from '@/features/terminal/store-tabs'

/**
 * Reveals the right sidebar when it is collapsed — a shortcut back to whatever
 * chat is already there, not a new one. Only reachable in that one state; once
 * the sidebar is open, it is right there.
 *
 * Shown whenever the sidebar is hidden, not only with a file open: the chat is
 * worth reaching from anywhere, and a button that comes and goes with the tab
 * you happen to be on is one you cannot rely on finding.
 *
 * Except when there is nothing behind it to reach — with no assistant
 * installed and signed in, revealing the sidebar only lands on its own empty
 * state (`AgentTabsPanel`'s "no assistant configured" screen), which already
 * has its own way in from Settings. A shortcut whose destination is another
 * "go set this up" screen is not a shortcut.
 */
export function QuickAskCorner(): JSX.Element | null {
  const rightPanelHidden = useUiStore((s) => s.rightPanelHidden)
  const activePath = useActiveDocumentPath()
  const setRightPanelHidden = useUiStore((s) => s.setRightPanelHidden)
  const provider = useActiveChatProvider()
  const hasProvider = useHasProvider()

  if (!rightPanelHidden || !hasProvider) return null

  // A folder view or a home screen is not a file, and an Excalidraw drawing is
  // not something the agent can read as text — same rule the new-chat seeding
  // already applies.
  const file =
    activePath && !isVirtualPath(activePath) && !isExcalidrawPath(activePath) ? activePath : null

  return (
    <button
      type="button"
      title={file ? 'Ask about this file' : 'Open the chat panel'}
      aria-label={file ? 'Ask about this file' : 'Open the chat panel'}
      onClick={() => {
        // Attached before the panel opens: the request waits until a composer
        // is on screen to take it, so the order costs nothing and this way the
        // file is never missed if the panel was already mid-reveal.
        if (file) requestChatAttachment(file)
        setRightPanelHidden(false)
      }}
      className="fixed bottom-5 right-5 z-docked flex h-11 w-11 items-center justify-center rounded-full border border-border-strong bg-accent shadow-s2 transition-transform hover:scale-105 active:scale-95"
    >
      <ProviderGlyph id={provider} size={20} />
    </button>
  )
}
