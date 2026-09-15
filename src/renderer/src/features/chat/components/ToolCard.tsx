import { useState } from 'react'
import { Icon } from '@/ui/icon'
import { ChromeButton } from '@/ui/chrome-button'
import { cn } from '@/ui/cn'
import { StandardDialog } from '@/ui/StandardDialog'
import type { ChatToolPart } from '@shared/chat'

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
}

export function formatToolCommand(name: string, input: unknown): string {
  const r = asRecord(input)
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  switch (name) {
    case 'Bash':
      return str(r.command)
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return str(r.file_path)
    case 'Grep':
      return `${str(r.pattern)}${r.path ? ` ${str(r.path)}` : ''}`.trim()
    case 'Glob':
      return str(r.pattern)
    case 'WebFetch':
      return str(r.url)
    case 'WebSearch':
      return str(r.query)
    default: {
      try {
        const s = JSON.stringify(input)
        return s && s !== '{}' ? s : ''
      } catch {
        return ''
      }
    }
  }
}

const TOOL_ICON: Record<string, string> = {
  Bash: 'terminal',
  Read: 'file',
  Write: 'edit',
  Edit: 'edit',
  NotebookEdit: 'notebook',
  Grep: 'search',
  Glob: 'search',
  WebFetch: 'globe',
  WebSearch: 'search'
}

export function ToolCard({ part }: { part: ChatToolPart }): JSX.Element {
  const [open, setOpen] = useState(false)
  const icon = TOOL_ICON[part.name] ?? 'tools'
  const statusIconClass =
    part.status === 'error'
      ? 'codicon-red'
      : part.status === 'running'
        ? 'codicon-amber'
        : 'codicon-emerald'
  return (
    <>
      <ChromeButton
        icon={icon}
        iconSize={11}
        tone="card"
        onClick={() => setOpen(true)}
        title="Show tool details"
        className="w-fit max-w-full gap-2 px-2 py-1 font-mono text-[11px]"
      >
        <span className="truncate font-medium text-foreground">{part.name}</span>
        {part.status === 'running' ? (
          <Icon name="loading" size={11} className={cn('shrink-0 animate-spin', statusIconClass)} />
        ) : (
          <Icon
            name={part.status === 'error' ? 'error' : 'check'}
            size={11}
            className={cn('shrink-0', statusIconClass)}
          />
        )}
      </ChromeButton>
      <ToolDetailModal part={part} open={open} onOpenChange={setOpen} />
    </>
  )
}

function linkify(text: string): React.ReactNode[] {
  return text.split(/(https?:\/\/[^\s"'<>)]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <span key={i} className="text-accent-1">
        {part}
      </span>
    ) : (
      part
    )
  )
}

function ToolDetailModal({
  part,
  open,
  onOpenChange
}: {
  part: ChatToolPart
  open: boolean
  onOpenChange: (open: boolean) => void
}): JSX.Element {
  const inputStr = (() => {
    try {
      return JSON.stringify(part.input, null, 2)
    } catch {
      return String(part.input)
    }
  })()
  const badgeClass =
    part.status === 'error'
      ? 'bg-red-500/15 text-red-400'
      : part.status === 'running'
        ? 'bg-amber-500/15 text-amber-400'
        : 'bg-emerald-500/15 text-emerald-400'
  const statusBadge = (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize',
        badgeClass
      )}
    >
      {part.status}
    </span>
  )
  const panel = 'rounded-md bg-bg-1 p-3 font-mono text-[12px] whitespace-pre-wrap break-words'
  return (
    <StandardDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={TOOL_ICON[part.name] ?? 'tools'}
      title={part.name}
      subtitle={statusBadge}
      width={680}
      height={560}
    >
      <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4 text-xs">
        <section>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            Input
          </div>
          <pre className={panel}>{linkify(inputStr)}</pre>
        </section>
        <section>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            Output
          </div>
          {part.result ? (
            <pre className={panel}>{linkify(part.result)}</pre>
          ) : part.status === 'running' ? (
            <div className="italic text-muted-foreground">Running…</div>
          ) : (
            <div className="italic text-muted-foreground/60">No output captured.</div>
          )}
        </section>
      </div>
    </StandardDialog>
  )
}
