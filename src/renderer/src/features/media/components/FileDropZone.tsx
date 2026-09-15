import { useState } from 'react'
import { ActionButton } from '@/ui/action-button'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'

interface Props {
  onPick(): void
  onDropFiles(paths: string[]): void
  compact?: boolean
  hero?: boolean
  ctaPrimary?: boolean
}

export function FileDropZone({
  onPick,
  onDropFiles,
  compact,
  hero,
  ctaPrimary
}: Props): JSX.Element {
  const [hovered, setHovered] = useState(false)

  function pathsFromEvent(e: React.DragEvent): string[] {
    const out: string[] = []
    const items = e.dataTransfer.files
    for (let i = 0; i < items.length; i++) {
      const f = items[i]
      const p = (f as unknown as { path?: string }).path
      if (p) out.push(p)
    }
    return out
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={onPick}
        onDragEnter={(e) => {
          e.preventDefault()
          setHovered(true)
        }}
        onDragLeave={() => setHovered(false)}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          e.preventDefault()
          setHovered(false)
          const paths = pathsFromEvent(e)
          if (paths.length) onDropFiles(paths)
        }}
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-dashed text-xs transition-colors',
          hovered
            ? 'border-accent-1/60 bg-accent-1/10 text-foreground'
            : 'border-input bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40'
        )}
      >
        <Icon name="add" size={12} />
        Add files
      </button>
    )
  }

  if (hero) {
    return (
      <div
        onDragEnter={(e) => {
          e.preventDefault()
          setHovered(true)
        }}
        onDragLeave={() => setHovered(false)}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          e.preventDefault()
          setHovered(false)
          const paths = pathsFromEvent(e)
          if (paths.length) onDropFiles(paths)
        }}
        className={cn(
          'group w-full rounded-lg border border-dashed transition-colors cursor-pointer',
          ctaPrimary
            ? 'flex flex-col items-center justify-center gap-3 px-6 py-12'
            : 'flex items-center gap-3 px-4 py-3',
          hovered ? 'border-accent-1/60 bg-card/30' : 'border-[rgba(255,255,255,0.08)] bg-card/30'
        )}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          onPick()
        }}
      >
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-md shrink-0',
            ctaPrimary ? 'h-12 w-12' : 'h-9 w-9',
            hovered ? 'bg-accent-1/20 text-accent-1-hover' : 'bg-bg-3 text-muted-foreground'
          )}
        >
          <Icon name="cloud-upload" size={ctaPrimary ? 22 : 16} />
        </span>
        <div className={cn('min-w-0', ctaPrimary ? 'text-center' : 'flex-1')}>
          <div
            className={cn(
              'font-semibold leading-tight',
              ctaPrimary ? 'text-[16px]' : 'text-[13px]'
            )}
          >
            Drop audio or video here
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            MP3, WAV, M4A, MP4, MOV, and more.
          </div>
        </div>
        <ActionButton size="sm" tone={ctaPrimary ? 'primary' : 'quiet'} onClick={onPick}>
          Choose file
        </ActionButton>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onPick}
      onDragEnter={(e) => {
        e.preventDefault()
        setHovered(true)
      }}
      onDragLeave={() => setHovered(false)}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        e.preventDefault()
        setHovered(false)
        const paths = pathsFromEvent(e)
        if (paths.length) onDropFiles(paths)
      }}
      className={cn(
        'group w-full flex flex-col items-center justify-center gap-2 px-6 py-7 rounded-lg border border-dashed transition-colors',
        hovered
          ? 'border-accent-1/60 bg-accent-1/5'
          : 'border-input bg-transparent hover:bg-accent/30'
      )}
    >
      <div
        className={cn(
          'inline-flex items-center justify-center h-10 w-10 rounded-full',
          hovered ? 'bg-accent-1/15' : 'bg-bg-3 group-hover:bg-bg-4'
        )}
      >
        <Icon name="files" size={18} />
      </div>
      <div className="text-sm font-medium">Drop files here</div>
      <div className="text-[11px] text-muted-foreground">or click to browse audio &amp; video</div>
    </button>
  )
}
