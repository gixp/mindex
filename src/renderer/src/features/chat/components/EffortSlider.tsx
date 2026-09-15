import { cn } from '@/ui/cn'
import type { ChatEffort } from '@shared/chat'

export interface EffortLevel {
  value: string
  label: string
}

const LEVELS: EffortLevel[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max' }
]

export function effortLabel(value: ChatEffort): string {
  return LEVELS.find((l) => l.value === value)?.label ?? value
}

interface Props {
  value: string
  onChange(next: string): void
  /**
   * The stops, when the assistant names its own.
   *
   * The five above are Mindex's, and they are only right for one assistant on
   * one version — Claude offers six (with a "default" below "low") and Codex
   * offers six the other way (with "ultra" above "max"). Passing the real ones
   * makes the track match what can actually be chosen; leaving this out keeps
   * the original five for the path that has no assistant to ask.
   */
  levels?: EffortLevel[]
}

export function EffortSlider({ value, onChange, levels }: Props): JSX.Element {
  const LEVELS_IN_USE = levels && levels.length > 1 ? levels : LEVELS
  const idx = Math.max(
    0,
    LEVELS_IN_USE.findIndex((l) => l.value === value)
  )
  const last = LEVELS_IN_USE.length - 1
  const at = (i: number): string => `calc(0.6rem + (100% - 1.2rem) * ${i / last})`

  return (
    <div className="relative h-5 w-full">
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-4 rounded-full bg-bg-1" />
      <div
        className="absolute left-0 top-1/2 -translate-y-1/2 h-4 rounded-full bg-accent-1"
        style={{ width: `calc(1.1rem + (100% - 1.2rem) * ${idx / last})` }}
      />
      {LEVELS_IN_USE.map((lvl, i) => {
        const isCurrent = i === idx
        const passed = i < idx
        return (
          <button
            key={lvl.value}
            type="button"
            title={lvl.label}
            aria-label={`Effort: ${lvl.label}`}
            onClick={(e) => {
              e.stopPropagation()
              onChange(lvl.value)
            }}
            className="absolute top-1/2 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{ left: at(i) }}
          >
            {isCurrent ? (
              <span className="h-3.5 w-3.5 rounded-full bg-white shadow-s1" />
            ) : (
              <span
                className={cn('h-1 w-1 rounded-full', passed ? 'bg-accent-1-hover' : 'bg-c-2')}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
