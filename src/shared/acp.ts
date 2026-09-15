/**
 * The settings an agent advertises about itself, as the renderer needs them.
 *
 * Mindex used to hold this knowledge itself: a hardcoded model list per
 * provider, a five-stop effort scale, a four-item permission menu, and a
 * hand-written table translating each into that CLI's flags. All of it went
 * stale silently — the agents on this machine turned out to offer six modes,
 * six effort rungs, a persona selector and a fast-mode switch that Mindex had
 * no way to show.
 *
 * These types carry whatever the agent actually said instead. Nothing here
 * names a model, an effort level or a mode: the renderer draws an option from
 * its `type` without knowing what it means, which is the whole reason a new
 * model needs no Mindex release to appear.
 */

export interface AcpOptionValue {
  value: string
  label: string
  description?: string
}

/**
 * One setting: a choice between values, or a switch.
 *
 * `category` is the axis — `model`, `mode`, `thought_level` — and is what
 * anything looking for a particular setting must key on. Never the `id`: the
 * same concept is called `effort` by one agent and `reasoning_effort` by
 * another. It is also genuinely optional, and an option without one still
 * renders; it simply gets no special treatment.
 */
export interface AcpConfigOption {
  id: string
  label: string
  description?: string
  type: 'select' | 'boolean'
  category?: string
  currentValue?: string | boolean
  /** Already flattened — grouped values are ungrouped before they reach here. */
  values: AcpOptionValue[]
}

/**
 * A slash command the assistant says it has.
 *
 * Mindex carried a written-out list of eight. The assistant on this machine
 * reports forty-nine — its own commands plus every skill the user has
 * installed, which Mindex could not have known about at all.
 */
export interface AcpCommand {
  name: string
  description?: string
}

/** What one chat tab's agent currently offers. */
export interface AcpTabConfig {
  sessionId: string
  provider: string
  options: AcpConfigOption[]
}

/**
 * Modes that let the agent act without stopping to ask.
 *
 * The protocol hands over an opaque list of ids and names with no "this
 * disables approval" flag, so this cannot be known — only recognised. The
 * vocabulary below is what the agents on this machine actually advertise,
 * read off real connections rather than from their documentation.
 *
 * Every mode now carries a colour of its own, so this no longer decides whether
 * there is one. It decides the colour for modes Mindex has no entry for — the
 * ones Codex and Gemini name differently — so that a mode which asks nothing
 * and allows anything still stands out for them.
 *
 * It drives colour and nothing else: it never blocks a mode, changes one, or
 * refuses to run. So being wrong is cheap in both directions.
 *
 * What is marked is one specific thing: a mode that asks nothing **and allows
 * anything**. Two modes that sound the same are deliberately not marked, and
 * both were caught only by reading the assistants' own descriptions:
 *
 *  - **"Don't Ask"** stops prompting and then *denies* whatever was not
 *    approved in advance. It removes questions by narrowing what can happen —
 *    it is stricter than the ordinary mode, not looser. Flagging it would be
 *    plainly wrong.
 *  - **"Accept Edits"** is Mindex's own default, and a warning that is on for
 *    everybody by default is not a warning but decoration people learn to stop
 *    seeing. It also only covers file edits and still stops before running a
 *    command. (OpenKnowledge does flag this one; this is a considered
 *    departure, not an oversight.)
 */
const UNPROMPTED = [
  'bypass', // Claude: bypassPermissions
  'fullaccess', // Codex: agent-full-access
  'yolo', // Gemini
  'danger',
  'fullauto',
  'autoapprove',
  'autorun',
  'skippermission',
  'noconfirm',
  'noprompt',
  'unrestricted',
  'allowall'
]

/**
 * Whole-word matches. `auto` alone means "no approvals" in some agents, but
 * inside a longer word it means nothing at all — an "autocomplete" mode is not
 * a permission grant, so this must never be a substring test.
 *
 * `agent` must never be added here: Codex calls its *ordinary* mode that.
 */
const UNPROMPTED_EXACT = new Set(['auto'])

/** Letters only — separators and casing differ between agents. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '')
}

/** Does this mode read as "act without asking"? A hint, never a guarantee. */
export function isUnpromptedMode(mode: { id: string; label?: string }): boolean {
  const id = normalize(mode.id)
  const label = normalize(mode.label ?? '')
  if (UNPROMPTED_EXACT.has(id) || UNPROMPTED_EXACT.has(label)) return true
  return UNPROMPTED.some((word) => id.includes(word) || label.includes(word))
}

/** The option carrying an axis, by category. Undefined when not advertised. */
export function optionFor(
  options: AcpConfigOption[],
  category: string
): AcpConfigOption | undefined {
  return options.find((o) => o.category === category)
}

/** The label for the selected value, for a compact summary on a trigger. */
export function currentLabel(option: AcpConfigOption): string {
  const current = option.values.find((v) => v.value === option.currentValue)
  if (current) return current.label
  if (typeof option.currentValue === 'string' && option.currentValue) return option.currentValue
  return ''
}
