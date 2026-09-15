import type { FolderContextMetrics } from '@shared/suggestions'
import type { FolderStatusEntry } from '@shared/types'

export type ContextHealth = 'current' | 'stale' | 'disabled' | 'missing'

export const CONTEXT_HEALTH_META: Record<
  ContextHealth,
  { label: string; dot: string; text: string; order: number }
> = {
  // `order` drives grouping in the navigator: what needs attention first,
  // what is fine last.
  stale: { label: 'Needs update', dot: 'bg-amber-400', text: 'text-amber-300', order: 0 },
  disabled: { label: 'AI disabled', dot: 'bg-red-400', text: 'text-red-300', order: 1 },
  missing: {
    label: 'No context',
    dot: 'bg-muted-foreground/40',
    text: 'text-muted-foreground',
    order: 2
  },
  current: { label: 'Ready', dot: 'bg-emerald-400', text: 'text-emerald-300', order: 3 }
}

export const HEALTH_ORDER: ContextHealth[] = ['stale', 'disabled', 'missing', 'current']

export function contextHealth(
  folder: FolderContextMetrics,
  status?: FolderStatusEntry
): ContextHealth {
  if (folder.aiDisabled) return 'disabled'
  if (!folder.hasContextFile) return 'missing'
  if (
    folder.staleness === 'behind' ||
    status?.status === 'pending' ||
    status?.status === 'running' ||
    status?.status === 'failed'
  ) {
    return 'stale'
  }
  return 'current'
}
