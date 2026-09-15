import { flattenValues, type SessionConfigOption } from './protocol'
import type { AcpSession } from './session'
import type { AgentJobOptions } from '@main/agent-engine/engine'

/**
 * Mapping Mindex's settings onto whatever the agent says it can be configured
 * with.
 *
 * Everything here is best-effort on purpose. A model the vendor withdrew, a
 * thought level this adapter version does not have, a mode named differently by
 * a different vendor — every one of those is skipped rather than sent, because
 * a stale preference must not be able to fail a turn.
 */

/**
 * Find the option carrying an axis by `category`, never by `id`.
 *
 * Ids differ between vendors for the same concept — Claude's thought level is
 * `effort`, Codex's is `reasoning_effort` — while both carry
 * `category: 'thought_level'`. Keying on the id would silently configure
 * nothing on one of them. `category` is itself optional (Claude's `agent`
 * persona selector has none), which is why this can return undefined.
 */
export function optionByCategory(
  options: SessionConfigOption[],
  category: string
): SessionConfigOption | undefined {
  return options.find((o) => o.category === category)
}

/**
 * Is the value actually on offer? A withdrawn model is skipped, not sent.
 *
 * Reads through grouping: values may arrive as a flat list or in named groups,
 * and only checking the flat shape would reject every value of an agent that
 * groups — the stored preference would look corrupt rather than valid.
 */
export function offers(option: SessionConfigOption, value: string | boolean): boolean {
  if (typeof value === 'boolean') return option.type === 'boolean'
  if (option.type !== 'select') return false
  return flattenValues(option.options).some((v) => v.value === value)
}

/** What is already selected, so an unchanged setting costs no round-trip. */
function isCurrent(option: SessionConfigOption, value: string | boolean): boolean {
  return option.currentValue === value
}

/**
 * Apply model, thought level and mode to a live session.
 *
 * Model goes first deliberately: choosing one can rewrite which other options
 * exist and what they offer — the captured traffic shows the context window
 * changing size when the model resolves — so applying a thought level before it
 * risks setting a value against the outgoing list. OpenKnowledge sorts their
 * restore the same way, for the same reason.
 *
 * Mindex's permission vocabulary happens to match Claude's ACP mode ids exactly
 * (`default` / `acceptEdits` / `plan` / `auto`). That is luck, not design, and
 * `offers()` is what keeps it from mattering: Codex names its modes
 * `read-only` / `agent` / `agent-full-access`, none of which match, so nothing
 * is sent rather than something wrong.
 */
export async function applySessionConfig(
  session: AcpSession,
  opts: AgentJobOptions,
  remembered?: Record<string, string | boolean>
): Promise<{ rejected: string[] }> {
  // Start from the tab's own settings, mapped by axis…
  const wanted = new Map<string, string | boolean>()
  const fromTab: Array<[category: string, value: string | undefined]> = [
    ['model', opts.model],
    ['thought_level', opts.effort],
    ['mode', opts.permissionMode === 'bypassPermissions' ? 'auto' : opts.permissionMode]
  ]
  for (const [category, value] of fromTab) {
    if (!value) continue
    const option = optionByCategory(session.configOptions, category)
    if (option) wanted.set(option.id, value)
  }

  // …then let an explicit choice from the agent's own menu win over it.
  //
  // This ordering is the whole reason these are merged rather than applied one
  // after the other. Mindex's vocabulary cannot express every value an agent
  // offers, so a mode like "don't ask" has no equivalent in the tab settings;
  // applying those settings afterwards would quietly put the mode back to
  // something the user did not choose, on every single turn.
  //
  // The model is the exception, and it has to be. Every other axis is chosen
  // in the agent's own menu and lives nowhere else, so what is remembered is
  // the only record of it. The model is chosen in the composer, is written to
  // the tab, and is what the composer's chip reads back — so letting a
  // remembered one win here meant the chip said one model while every turn was
  // set to another. The remembered entry is stale by construction: it is only
  // refreshed when a pick happens to land on a live session of the same
  // assistant, which a new tab has not got and a pick that also changes
  // assistant never touches.
  const tabModelId = opts.model ? optionByCategory(session.configOptions, 'model')?.id : undefined
  for (const [id, value] of Object.entries(remembered ?? {})) {
    if (id === tabModelId) continue
    wanted.set(id, value)
  }

  // Model first: choosing one can rewrite which other options exist and what
  // they offer, so anything applied before it risks being set against a list
  // that is about to be replaced.
  const isModel = (id: string): boolean =>
    session.configOptions.find((o) => o.id === id)?.category === 'model'
  const ids = [...wanted.keys()].sort((a, b) => Number(isModel(b)) - Number(isModel(a)))

  const rejected: string[] = []
  for (const id of ids) {
    const value = wanted.get(id)
    if (value === undefined) continue
    const option = session.configOptions.find((o) => o.id === id)
    // Not offered, already selected, or a value this agent no longer has — all
    // three are ordinary and none is worth reporting. Only an agent that
    // accepted the request and then failed it is.
    if (!option) continue
    if (isCurrent(option, value)) continue
    if (!offers(option, value)) continue
    if (!(await session.setConfigOption(id, value))) rejected.push(id)
  }
  // Returned rather than logged here: this module has no logger, and reaching
  // for the engine's would close an import cycle back through the job runner.
  return { rejected }
}
