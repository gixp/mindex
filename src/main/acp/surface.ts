import { flattenValues, type SessionConfigOption, type SessionModeState } from './protocol'
import type { AcpConfigOption } from '@shared/acp'

/**
 * What the agent advertises, normalised into one list the UI can draw.
 *
 * Two surfaces exist on the wire and an agent may use either. The generalised
 * one is a uniform array of options. The older one is a separate mode list,
 * changed through its own call — and it is not a legacy curiosity: Gemini has
 * *only* that, sending no options array at all. A client that read only the
 * new surface would show Gemini as having no settings whatsoever.
 *
 * So the older mode list is folded in here as one more option, marked by its
 * id, and everything downstream — the menu, the persistence, the warning about
 * unprompted modes — treats it like any other. Only the code that applies a
 * choice has to care which call to make.
 */

/**
 * Marks the mode option that came from the older surface.
 *
 * Chosen to be impossible to collide with a real option id, because acting on
 * the wrong branch means silently changing nothing.
 */
export const LEGACY_MODE_OPTION_ID = '__mindex_legacy_mode__'

/** An option with nothing to pick is not a choice; it would render as an empty menu. */
function isSelectable(option: SessionConfigOption): boolean {
  if (option.type === 'boolean') return true
  return flattenValues(option.options).length > 0
}

function toShared(option: SessionConfigOption): AcpConfigOption {
  return {
    id: option.id,
    // Agents do not always name an option; its id is a poor label but a
    // truthful one, and better than a blank row.
    label: option.name ?? option.id,
    description: option.description,
    type: option.type,
    category: option.category,
    currentValue: option.currentValue,
    values: flattenValues(option.options).map((v) => ({
      value: v.value,
      label: v.name ?? v.value,
      description: v.description
    }))
  }
}

/**
 * The list learned at launch, showing what was picked since.
 *
 * A tab with no conversation running yet draws its menus from the list the
 * assistant gave at launch, and that list carries the assistant's own
 * defaults — so a choice made in the ten seconds before the conversation comes
 * up appeared to be forgotten the moment the menu was reopened. It was not
 * forgotten; it was simply not being shown by the only list available.
 *
 * A remembered value is only shown where the assistant actually offers it. One
 * naming a value that is no longer on the menu is left alone rather than forced
 * in, because a row that cannot be chosen again is worse than the default: the
 * menu would show something no press could ever restore.
 */
export function withRemembered(
  options: AcpConfigOption[],
  remembered: Record<string, string | boolean> | undefined
): AcpConfigOption[] {
  if (!remembered) return options
  return options.map((o) => {
    const value = remembered[o.id]
    if (value === undefined) return o
    if (o.type === 'boolean') {
      return typeof value === 'boolean' ? { ...o, currentValue: value } : o
    }
    if (typeof value !== 'string') return o
    return o.values.some((v) => v.value === value) ? { ...o, currentValue: value } : o
  })
}

/**
 * Build the option list for a session.
 *
 * The older mode list is appended only when the agent did not already advertise
 * a mode among its options — never both, or the same setting would appear
 * twice and the two copies would disagree the moment one was changed.
 */
export function buildSurface(
  configOptions: SessionConfigOption[],
  modes: SessionModeState | undefined
): AcpConfigOption[] {
  const options = configOptions.filter(isSelectable).map(toShared)

  const hasMode = options.some((o) => o.category === 'mode')
  const available = modes?.availableModes ?? []
  // One mode is not a choice — offering a menu of one reads as a broken menu.
  if (!hasMode && available.length > 1) {
    options.push({
      id: LEGACY_MODE_OPTION_ID,
      label: 'Mode',
      type: 'select',
      category: 'mode',
      currentValue: modes?.currentModeId,
      values: available.map((m) => ({
        value: m.id,
        label: m.name ?? m.id,
        description: m.description
      }))
    })
  }

  return options
}
