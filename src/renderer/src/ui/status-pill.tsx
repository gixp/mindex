import { Icon } from './icon'
import { cn } from '@/ui/cn'

export type Status =
  | 'queued'
  | 'checking-setup'
  | 'importing-media'
  | 'preparing-audio'
  | 'transcribing'
  | 'saving'
  | 'done'
  | 'error'
  | 'cancelled'

interface StatusPillProps {
  status: Status
  label?: string
  percent?: number
  className?: string
}

const META: Record<Status, { label: string; icon?: string; tone: string }> = {
  queued: { label: 'Queued', icon: 'clockface', tone: 'bg-amber-500/15 text-amber-300' },
  'checking-setup': {
    label: 'Checking setup',
    icon: 'inspect',
    tone: 'bg-accent-1/15 text-accent-1-hover'
  },
  'importing-media': {
    label: 'Importing media',
    icon: 'cloud-upload',
    tone: 'bg-accent-1/15 text-accent-1-hover'
  },
  'preparing-audio': {
    label: 'Preparing audio',
    icon: 'loading',
    tone: 'bg-accent-1/15 text-accent-1-hover [&_.codicon]:animate-spin'
  },
  transcribing: {
    label: 'Transcribing',
    icon: 'pulse',
    tone: 'bg-accent-1/15 text-accent-1-hover [&_.codicon]:animate-pulse'
  },
  saving: { label: 'Saving', icon: 'save', tone: 'bg-emerald-500/15 text-emerald-300' },
  done: { label: 'Done', icon: 'pass-filled', tone: 'bg-emerald-500/15 text-emerald-300' },
  error: { label: 'Error', icon: 'error', tone: 'bg-red-500/15 text-red-300' },
  cancelled: {
    label: 'Cancelled',
    icon: 'circle-slash',
    tone: 'bg-bg-3 text-muted-foreground'
  }
}

export function StatusPill({ status, label, percent, className }: StatusPillProps): JSX.Element {
  const meta = META[status]
  const text =
    typeof percent === 'number' && percent > 0 && percent < 100
      ? `${label ?? meta.label} ${Math.round(percent)}%`
      : (label ?? meta.label)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 h-5 px-2 rounded-full text-[11px] font-medium whitespace-nowrap',
        meta.tone,
        className
      )}
    >
      {meta.icon ? <Icon name={meta.icon} size={11} /> : null}
      <span>{text}</span>
    </span>
  )
}
