import { useState, useRef, useEffect } from 'react'
import { ActionButton } from '@/ui/action-button'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export function ChatSidebar(): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSend(): void {
    const trimmed = input.trim()
    if (!trimmed) return
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmed },
      {
        role: 'assistant',
        content: '(AI integration coming soon — connect your Claude API key in Settings.)'
      }
    ])
    setInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <Icon name="sparkle" size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium">AI Assistant</span>
      </div>

      <div className="flex-1 overflow-auto px-3 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Icon
                name="sparkle"
                size={24}
                className="block mx-auto mb-2 text-muted-foreground/40"
              />
              <p className="text-xs text-muted-foreground">Ask anything about your vault</p>
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                'text-xs rounded-lg px-3 py-2 max-w-[90%]',
                msg.role === 'user'
                  ? 'ml-auto bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              )}
            >
              {msg.content}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-2">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your notes…"
            rows={2}
            className={cn(
              'flex-1 resize-none rounded-md bg-background/60 px-3 py-2',
              'text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
            )}
          />
          <ActionButton
            tone="ghost"
            aria-label="Send"
            className="w-8 px-0"
            onClick={handleSend}
            disabled={!input.trim()}
          >
            <Icon name="send" size={14} className="codicon-inherit" />
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
