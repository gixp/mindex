import { useMemo } from 'react'
import type { AcpConfigOption } from '@shared/acp'
import type { ProviderId } from '@shared/types'
import { ProviderGlyph } from '@/ui/provider-glyph'
import { Select, type SelectGroup, type SelectOption } from '@/ui/select'
import { usableProviders, useProvidersStore } from '@/platform/engines'
import { useAdvertisedOptions } from '@/features/chat/store-agentOptions'
import {
  buildModelGroups,
  currentChoiceValue,
  modelLabel,
  unpackChoice,
  type ModelChoice
} from '@/features/chat/lib/model-choice'

/**
 * Every usable assistant with its models under it, as one menu.
 *
 * Lives apart from the composer because a second window wants the same thing:
 * the capture window picks who writes the note, and picking that from a copy of
 * this menu would be two menus that agree today and drift by the next change.
 *
 * What it does *not* carry is where the choice is kept. The composer stores it
 * on the tab; the capture window stores it in settings. That is the only part
 * that genuinely differs, so it is the part the caller keeps.
 */
export function ModelMenu({
  provider,
  model,
  live,
  onChoose,
  footer,
  triggerClassName,
  align = 'left'
}: {
  provider: ProviderId
  model: string
  /** What an assistant has said about itself, where anything has been heard. */
  live?: Partial<Record<ProviderId, AcpConfigOption[]>>
  onChoose(choice: ModelChoice): void
  /** Pinned under the rows — the thinking track, in the windows that have one. */
  footer?: React.ReactNode
  triggerClassName?: string
  align?: 'left' | 'center' | 'right'
}): JSX.Element | null {
  const items = useProvidersStore((s) => s.items)
  // Every assistant names its own models. Without this the window listed them
  // by the compiled-in names — "Opus" where the assistant calls it "Opus 5" —
  // and a caller that happened to pass a live list for one assistant left the
  // menu naming that one differently from the rest.
  const advertised = useAdvertisedOptions()
  const known = useMemo(() => ({ ...advertised, ...(live ?? {}) }), [advertised, live])
  const groups = useMemo(() => buildModelGroups(usableProviders(items), known), [items, known])
  if (groups.length === 0) return null

  const selectGroups: SelectGroup<string>[] = groups.map((g) => ({
    label: g.label,
    options: g.rows.map((row) => ({
      value: row.value,
      label: (
        <span className="flex items-center gap-1">
          <ProviderGlyph id={g.provider} size={12} />
          <span>{row.label}</span>
        </span>
      )
    }))
  }))
  // Every row, flat: the button finds the selected one by searching this list,
  // not the groups.
  const options: SelectOption<string>[] = selectGroups.flatMap((g) => g.options)
  const current = currentChoiceValue(provider, model)

  return (
    <Select<string>
      value={current}
      onChange={(next) => {
        const choice = unpackChoice(next)
        if (choice) onChoose(choice)
      }}
      options={options}
      groups={selectGroups}
      title="Choose an assistant and model"
      size="sm"
      placement="top"
      align={align}
      minDropdownWidth={160}
      optionClassName="px-1.5 py-1.5"
      optionsGapClassName="space-y-0.5"
      dropdownClassName="max-h-[280px]"
      footer={footer ?? null}
      footerClassName="pt-0.5"
      // Named the way the rows name it, not by the id the assistant is sent —
      // see `modelLabel`. The composer's own menu had the same fallback and the
      // same fault, which is the drift this component exists to prevent.
      placeholder={
        <span className="flex items-center gap-1">
          <ProviderGlyph id={provider} size={12} />
          <span>{modelLabel({ provider, model }, { groups, providers: items, live: known })}</span>
        </span>
      }
      triggerClassName={
        triggerClassName ??
        'rounded-none border-0 pl-0 pr-0 bg-transparent hover:bg-transparent text-muted-foreground'
      }
    />
  )
}
