import { getAppSettings, getCachedAppSettings } from '@main/settings/app-settings'
import { defaultModelFor, toProviderId } from './registry'
import type { ProviderId } from './types'

/**
 * The engine Mindex uses for work it starts on its own — folder context and the
 * living index.
 *
 * These used to call the Claude binary unconditionally, so choosing Gemini in
 * Settings changed what answered a chat but not what maintained the vault. The
 * whole point of picking an engine is that it is the engine.
 */
export async function engineChoice(): Promise<{ provider: ProviderId; model: string }> {
  const settings = await getAppSettings().catch(() => null)
  const provider = toProviderId(settings?.engine?.provider) ?? 'claude'
  // `contextModel` is what this function is for — the cheaper model chosen for
  // background work. It falls back to `engine.model` so every install from
  // before that setting existed keeps behaving exactly as it did, and to the
  // provider's own default after that: an empty or stale model name left over
  // from a different vendor fails at the far end with an error no background
  // job can act on.
  const model = settings?.contextModel || settings?.engine?.model || defaultModelFor(provider)
  return { provider, model }
}

/** Synchronous twin of `engineChoice()`'s provider resolution, for the handful
 *  of call sites that are sync callbacks (file-watcher handlers, path
 *  builders) with no room to await — e.g. the context filename a given
 *  directory should currently be named. Reads whatever settings last loaded
 *  rather than re-fetching, so it can never itself be the reason a sync
 *  callback needs to become async. */
export function currentProvider(): ProviderId {
  return toProviderId(getCachedAppSettings().engine?.provider) ?? 'claude'
}

/**
 * The engine for work a person asked for and is waiting on — a rewrite of the
 * passage they just selected, and anything else started by a click.
 *
 * Deliberately **not** `engineChoice()`. That one answers for work Mindex
 * starts on its own, and it prefers `contextModel`: the cheap rung, chosen
 * because re-reading the whole vault on a schedule spends far more than
 * chatting does. Sending a rewrite down the same path meant the passage a
 * person was watching was rewritten by the cheapest model in the list, which
 * is the opposite of what either setting is for.
 */
export async function interactiveChoice(): Promise<{ provider: ProviderId; model: string }> {
  const settings = await getAppSettings().catch(() => null)
  const provider = toProviderId(settings?.engine?.provider) ?? 'claude'
  return {
    provider,
    model: settings?.ai?.inlineModel || settings?.engine?.model || defaultModelFor(provider)
  }
}
