import os from 'node:os'
import { AcpSession } from './session'
import { buildSurface } from './surface'
import { providerSpec } from '@main/providers/registry'
import { logEngine } from '@main/agent-engine'
import { readJson, writeJson } from '@main/util/fs-helpers'
import { appConfigFile } from '@main/util/paths'
import { PROVIDER_IDS, type ProviderId } from '@main/providers/types'
import type { AcpCommand, AcpConfigOption } from '@shared/acp'

/**
 * What each assistant offers, learned once and kept.
 *
 * Until now this was only known inside an open conversation, which made it
 * useless everywhere else: the first-run screens and the settings panel had
 * nothing to show but the model list written into Mindex by hand — the very
 * list that goes stale. It also meant a chat tab had to sit with an empty menu
 * for the second or two its assistant took to start.
 *
 * So it is learned separately: one short-lived connection per assistant, asked
 * only what it can do and then closed. The answer is written to disk, so on
 * every later launch the menus are filled in instantly and the fresh copy is
 * fetched quietly behind them.
 *
 * What is stored here is the list of *choices*. Which one is currently selected
 * belongs to a conversation, not to the app, and is never taken from here.
 */

const FILE = 'agent-catalogue.json'

/**
 * How long the first launch may wait to learn what the assistant offers.
 *
 * Generous enough for a cold start that has to fetch the adapter first
 * (measured at 4–7 s), short enough that a broken assistant cannot make the app
 * look hung.
 */
const FIRST_LAUNCH_WAIT_MS = 8_000

/**
 * How long to wait for the command list after a session opens.
 *
 * It arrived immediately in every capture; this is only so a assistant that
 * never sends one cannot stall the launch.
 */
const COMMANDS_WAIT_MS = 2_000

interface CatalogueEntry {
  options: AcpConfigOption[]
  commands: AcpCommand[]
  fetchedAt: number
}

type Catalogue = Partial<Record<ProviderId, CatalogueEntry>>

let cached: Catalogue | null = null
let loading: Promise<Catalogue> | null = null
/** In-flight refreshes, so two callers never start two connections for one assistant. */
const refreshing = new Map<ProviderId, Promise<AcpConfigOption[]>>()

/** Told when an assistant's list is learned or changes, so the window can redraw. */
let onChange: ((provider: ProviderId) => void) | null = null

export function setCatalogueListener(fn: (provider: ProviderId) => void): void {
  onChange = fn
}

async function load(): Promise<Catalogue> {
  if (cached) return cached
  if (loading) return loading
  loading = (async () => {
    const data = await readJson<Catalogue>(appConfigFile(FILE))
    cached = data ?? {}
    loading = null
    return cached
  })()
  return loading
}

async function persist(): Promise<void> {
  if (!cached) return
  // Best-effort: a catalogue that fails to save costs one slow launch, not a
  // broken one.
  await writeJson(appConfigFile(FILE), cached).catch(() => undefined)
}

/**
 * What this assistant offers, as last learned. Empty when never learned.
 *
 * Deliberately synchronous and never fetches: every caller is drawing a menu,
 * and a menu opening must not be the reason a process gets started.
 */
export function catalogueFor(provider: ProviderId): AcpConfigOption[] {
  return cached?.[provider]?.options ?? []
}

/** The slash commands this assistant reported. Empty when never learned. */
export function commandsFor(provider: ProviderId): AcpCommand[] {
  return cached?.[provider]?.commands ?? []
}

/** Whether anything has ever been learned about this assistant. */
export function catalogueKnown(provider: ProviderId): boolean {
  return (cached?.[provider]?.options.length ?? 0) > 0
}

/**
 * Ask an assistant what it offers, and remember the answer.
 *
 * Opens a connection purely to read the answer and closes it again — nothing is
 * asked of the model, so this costs no tokens. Runs in a neutral directory
 * because what an assistant offers does not depend on which folder is open.
 */
export async function refreshCatalogue(provider: ProviderId): Promise<AcpConfigOption[]> {
  const inFlight = refreshing.get(provider)
  if (inFlight) return inFlight

  const job = (async () => {
    const started = Date.now()
    let session: AcpSession | undefined
    try {
      // Asked before anything is started: an assistant nobody has signed in to
      // cannot answer, and this avoids spawning a process to find that out.
      //
      // Read from disk rather than from the sign-in methods the assistant
      // advertises. Those look like the obvious signal and are not one: Claude
      // reports none once signed in, but Codex and Gemini list theirs either
      // way, so treating a non-empty list as "signed out" locked both of them
      // out of this entirely.
      if (!(await providerSpec(provider).isAuthenticated())) {
        logEngine('info', `${provider}: nobody signed in — keeping the built-in menus`)
        return []
      }

      logEngine('info', `${provider}: asking what it offers`)
      session = await AcpSession.open({ provider, cwd: os.homedir() })

      const options = buildSurface(session.configOptions, session.modes)
      if (options.length === 0) {
        logEngine('warn', `${provider}: connected but advertised no settings`)
        return []
      }

      // The command list does not come back with the session — it is announced
      // a moment later, on its own. Worth a short wait here, because this is
      // the one place that learns things for the whole app; missing it would
      // leave the slash menu on the eight names written into Mindex.
      if (session.commands.length === 0) {
        const live = session
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, COMMANDS_WAIT_MS)
          live.onCommands = () => {
            clearTimeout(timer)
            resolve()
          }
        })
        session.onCommands = null
      }
      const commands = session.commands

      const store = await load()
      store[provider] = { options, commands, fetchedAt: Date.now() }
      cached = store
      await persist()
      onChange?.(provider)
      logEngine(
        'info',
        `${provider}: learned ${options.length} settings and ${commands.length} commands ` +
          `in ${Date.now() - started}ms ` +
          `(${options.map((o) => `${o.id}×${o.values.length}`).join(', ')})`
      )
      return options
    } catch (err) {
      // Not installed, not signed in, no network on a first run — all ordinary,
      // and all mean the same thing here: nothing new was learned, keep what
      // was known before.
      //
      // Logged rather than swallowed. Silence here made "why are my menus still
      // the old ones" impossible to answer without guessing, which cost far
      // more than the line it saved.
      const detail =
        session?.stderrTail.trim() || (err instanceof Error ? err.message : String(err))
      logEngine('error', `${provider}: could not read its settings — ${detail.slice(0, 300)}`)
      return catalogueFor(provider)
    } finally {
      session?.close()
      refreshing.delete(provider)
    }
  })()

  refreshing.set(provider, job)
  return job
}

/**
 * Read the saved catalogue, then quietly re-check the assistant in use.
 *
 * Called once at launch. Never awaited for its refresh: the saved copy is what
 * makes the menus instant, and the re-check is only there so a newly installed
 * model appears without anyone asking for it.
 */
export async function startCatalogue(active: ProviderId): Promise<void> {
  await load()
  logEngine(
    'info',
    `saved settings for: ${PROVIDER_IDS.filter(catalogueKnown).join(', ') || 'none yet'}`
  )

  if (catalogueKnown(active)) {
    // Already saved from a previous launch: the menus are complete before the
    // window exists, and the re-check behind them costs the user nothing.
    void refreshCatalogue(active)
  } else {
    // Nothing saved — the very first launch, or the first after switching
    // assistant. This is the only case where waiting is right: drawing the
    // built-in menus and replacing them a few seconds later changes the
    // controls under the user's hands, which is worse than a slightly longer
    // startup. Every later launch takes the branch above and waits for nothing.
    //
    // Bounded, because "the assistant never answers" must not become "the app
    // never opens". On timeout the built-in menus stand in, exactly as they do
    // when there is no assistant at all.
    await Promise.race([
      refreshCatalogue(active),
      new Promise((resolve) => setTimeout(resolve, FIRST_LAUNCH_WAIT_MS))
    ])
  }

  // The others are never waited for. The settings panel offers all three, and
  // an unknown one there is worth filling in — but not at the cost of holding
  // up a launch for assistants this user may not even have installed.
  for (const id of PROVIDER_IDS) {
    if (id !== active && !catalogueKnown(id)) void refreshCatalogue(id)
  }
}
