import { ChatInputBar } from './ChatInputBar'
import { useTabsStore } from '@/features/terminal/store-tabs'

interface Props {
  sessionId: string
}

export function MindexInputDock({ sessionId }: Props): JSX.Element {
  const initialAttachment = useTabsStore(
    (s) => s.tabs.find((t) => t.id === sessionId)?.initialAttachment
  )
  return (
    <ChatInputBar
      sessionId={sessionId}
      initialAttachments={initialAttachment ? [initialAttachment] : undefined}
    />
  )
}
