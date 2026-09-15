import type { AcpConfigOption } from '@shared/acp'
import type { ProviderId, ProviderInfo } from '@shared/types'
import { providerVendor } from '@/platform/providers'

/**
 * One row in the composer's model menu: an assistant and one of its models.
 *
 * The two travel together because they are one decision. They used to be two:
 * the assistant came from Settings and the model from the composer, and
 * nothing stopped them disagreeing — a model name left over from one assistant
 * sent to another as a model it had never heard of. There is a repair for that
 * on the way out, which is the tell that the pair should have been atomic.
 *
 * A menu row carries a single string, so the pair is packed into one. Packing
 * and unpacking live here rather than at the call sites: the menu that draws
 * these already packs three unrelated kinds of row by string prefix, and a
 * second scheme spread across components would be the thing that finally makes
 * one of them mean the wrong thing.
 */

export interface ModelChoice {
  provider: ProviderId
  model: string
}

/** The separator. A colon cannot appear in an assistant's id. */
const SEP = ':'

export function packChoice(choice: ModelChoice): string {
  return `${choice.provider}${SEP}${choice.model}`
}

/**
 * `null` for anything that is not one of these rows.
 *
 * A model name may itself contain a colon, so only the first one separates —
 * the rest belong to the model.
 */
export function unpackChoice(value: string): ModelChoice | null {
  const at = value.indexOf(SEP)
  if (at <= 0 || at === value.length - 1) return null
  return { provider: value.slice(0, at) as ProviderId, model: value.slice(at + 1) }
}

export interface ModelRow {
  value: string
  label: string
}

export interface ModelGroup {
  provider: ProviderId
  label: string
  rows: ModelRow[]
}

/**
 * What an assistant really offers, learned from the assistant itself.
 *
 * The list compiled into Mindex is a written-down copy of someone else's
 * catalogue, and vendors rename their models every few months — so it is the
 * one that goes stale. Where a live answer exists it wins outright; where it
 * does not, the compiled list stands in, which is the case before an assistant
 * has ever been reached.
 */
/**
 * Whether a row is "whatever the program is configured to use".
 *
 * Not a model. It is the absence of a choice wearing a model's clothes, and in
 * a menu whose whole purpose is naming which model answers, a row that names
 * none is the one row that cannot answer the question. The same call was
 * already made for personas, for the same reason.
 *
 * Matched on the whole word so a real model with "default" somewhere in its
 * name survives. Dropping it means a conversation already on it cannot return
 * to it from here — the button still says which one is in force, and picking
 * any real model moves off it.
 */
function isDefaultModel(row: { value: string; label: string }): boolean {
  return /^(default|auto)$/i.test(row.value.trim()) || /^default$/i.test(row.label.trim())
}

/** Hyphens read as breaks in a name; a name is written with spaces. */
function spaced(label: string): string {
  return label.replace(/-+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The word this assistant's models all carry in front of their own name.
 *
 * "GPT" for OpenAI, "Gemini" for Google, nothing for Anthropic — whose models
 * are named rather than numbered, so there is no shared word to find. Read off
 * the list compiled into Mindex rather than declared anywhere: that list is
 * written by hand with the names as a person would write them, which is
 * exactly the question being asked.
 */
function familyWord(info: ProviderInfo): string | null {
  if (info.models.length < 2) return null
  // Every name must be the same word followed by more of a name. A run of
  // one-word names that happen to agree is not a family, it is one model —
  // and prefixing anything with it would put a model's own name in front of
  // another model's.
  const words = info.models.map((m) => spaced(m.label).split(' '))
  const first = words[0]?.[0]
  if (!first) return null
  return words.every((w) => w.length > 1 && w[0] === first) ? first : null
}

/**
 * What to write on screen for a model.
 *
 * Two things are wrong with the names as they arrive. They are hyphenated
 * ("GPT-5.6-Sol"), which reads as a slug rather than a name. And an assistant
 * talking about itself often drops the family word, because inside its own
 * conversation there is nothing else it could mean — Codex advertises "5.5"
 * and "6 Astra". That is fine in a list under an "OpenAI" heading and useless
 * on the button beside the composer, which shows this name with no heading
 * above it and nothing else to say what it is.
 *
 * So: spaces for hyphens, and the family word in front of anything that does
 * not already carry it. Nothing else is touched — the number and whatever
 * follows it are the vendor's to write.
 */
function modelName(label: string, family: string | null): string {
  const name = spaced(label)
  if (!family) return name
  const lower = name.toLowerCase()
  const head = family.toLowerCase()
  return lower === head || lower.startsWith(`${head} `) ? name : `${family} ${name}`
}

function modelsFor(info: ProviderInfo, live: AcpConfigOption[] | undefined): ModelRow[] {
  const advertised = live?.find((o) => o.category === 'model')
  const rows = (
    advertised?.values.length
      ? advertised.values.map((v) => ({ value: v.value, label: v.label }))
      : info.models.map((m) => ({ value: m.value, label: m.label }))
  ).filter((r) => !isDefaultModel(r))
  const family = familyWord(info)
  return rows.map((r) => ({
    value: packChoice({ provider: info.id, model: r.value }),
    label: modelName(r.label, family)
  }))
}

/**
 * The whole menu: every usable assistant, each with its own models under it.
 *
 * Assistants with nothing to offer are dropped rather than shown empty — a
 * heading over no rows reads as something broken rather than as something not
 * yet known.
 */
export function buildModelGroups(
  usable: ProviderInfo[],
  live: Partial<Record<ProviderId, AcpConfigOption[]>>
): ModelGroup[] {
  const groups: ModelGroup[] = []
  for (const info of usable) {
    const rows = modelsFor(info, live[info.id])
    if (rows.length === 0) continue
    groups.push({ provider: info.id, label: providerVendor(info.id), rows })
  }
  return groups
}

/**
 * The row to draw as selected.
 *
 * Falls back to the packed pair even when no group contains it, so a model an
 * assistant has stopped advertising still shows as the one in force instead of
 * leaving the button blank.
 */
export function currentChoiceValue(provider: ProviderId | undefined, model: string): string {
  return packChoice({ provider: provider ?? 'claude', model })
}

/**
 * The name a model goes by, wherever that name can be found.
 *
 * The button under the composer names the model answering, and it used to fall
 * back to the model's own id whenever that model was not one of the rows on
 * offer: `opus` under a menu that says "Opus 5", `pro` under one that says
 * "Gemini Pro". An id is what the assistant is sent, not what the model is
 * called, and a button that switches between the two reads as a different
 * model each time.
 *
 * Being absent from the rows says nothing about the name being unknown. The
 * assistant a model belongs to may not be signed in, in which case its whole
 * group is dropped from the menu; a conversation may be on a model its
 * assistant has since stopped advertising; and the rows for an assistant that
 * has never answered are the list compiled into Mindex rather than its own.
 * The name is written down in all three cases, just not in the rows — so look
 * past them, in the order of how current each source is. Only a model that no
 * source has ever heard of is named by its id, which is all there is left.
 */
export function modelLabel(
  choice: ModelChoice,
  sources: {
    groups: ModelGroup[]
    /** Every assistant, not only the usable ones — see above. */
    providers: ProviderInfo[]
    live?: Partial<Record<ProviderId, AcpConfigOption[]>>
  }
): string {
  const packed = packChoice(choice)
  for (const g of sources.groups) {
    const row = g.rows.find((r) => r.value === packed)
    if (row) return row.label
  }
  const info = sources.providers.find((p) => p.id === choice.provider)
  const family = info ? familyWord(info) : null
  const advertised = sources.live?.[choice.provider]?.find((o) => o.category === 'model')
  const heard = advertised?.values.find((v) => v.value === choice.model)
  if (heard) return modelName(heard.label, family)
  const compiled = info?.models.find((m) => m.value === choice.model)
  if (compiled) return modelName(compiled.label, family)
  return choice.model
}
