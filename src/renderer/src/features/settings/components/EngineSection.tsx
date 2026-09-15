import { useEffect, useMemo, useState } from 'react'
import { api } from '@/platform/api'
import { cn } from '@/ui/cn'
import type { ExternalMcpResult, ProviderId, ProviderInfo } from '@shared/types'
import { PROVIDERS } from '@/platform/providers'
import { Icon } from '@/ui/icon'
import { HandIcon } from '@/ui/hand-icon'
import { ProviderGlyph } from '@/ui/provider-glyph'
import { useUiStore } from '@/platform/app-settings'
import { BlockRow, Card, IconButton, Row, SectionShell } from './primitives'
import { Switch } from '@/ui/switch'
import { useProvidersStore, usableProviders } from '@/platform/engines'
import { buildModelGroups } from '@/features/chat/lib/model-choice'
import { useAdvertisedOptions } from '@/features/chat/store-agentOptions'
import { setLiveEngine } from '@/features/terminal/store-tabs'
import { ProviderRequiredNotice } from '@/ui/ProviderRequiredNotice'
import { pickerOption } from '@/ui/picker-option'

type Availability = 'checking' | 'ready' | 'signed-out' | 'missing'

function availabilityOf(info: ProviderInfo | undefined, loaded = true): Availability {
  if (!info) return loaded ? 'missing' : 'checking'
  if (!info.status.installed) return 'missing'
  if (!info.status.authenticated) return 'signed-out'
  return 'ready'
}

function statusLine(a: Availability, info: ProviderInfo | undefined): string {
  switch (a) {
    case 'checking':
      return 'Checking…'
    case 'missing':
      return 'Not installed'
    case 'signed-out':
      return 'Not signed in'
    case 'ready':
      return info?.status.version ?? 'Ready'
  }
}

// Only the states that need acting on are coloured. A version number is not
// news — painting every working provider green makes the two that need
// attention compete with three that do not.
const STATUS_TONE: Record<Availability, string> = {
  checking: 'text-muted-foreground/70',
  ready: 'text-muted-foreground',
  'signed-out': 'text-amber-400',
  missing: 'text-muted-foreground/70'
}

/**
 * Which agent CLI Mindex runs.
 *
 * Mindex drives a CLI the user has already installed and signed in to rather
 * than calling a model API, so there is no key to paste here. That makes this
 * a report on the machine with one choice attached: pick the engine, and be
 * told the single command that fixes whichever one is not ready.
 */
export function EngineSection(): JSX.Element {
  const settings = useUiStore((s) => s.settings)
  // Whatever startup already found. Opening Settings is not new evidence about
  // what is installed, so it does not re-probe — only the button below does.
  const items = useProvidersStore((s) => s.items)
  const checking = useProvidersStore((s) => s.checking)
  const loaded = useProvidersStore((s) => s.loaded)
  const refresh = useProvidersStore((s) => s.refresh)
  const installing = useProvidersStore((s) => s.installing)
  const installProgress = useProvidersStore((s) => s.installProgress)
  const installError = useProvidersStore((s) => s.installError)
  const install = useProvidersStore((s) => s.install)
  const info = useMemo(() => Object.fromEntries(items.map((p) => [p.id, p])), [items])

  const engine = settings?.engine
  // No fallback to 'claude': an unset provider means nothing has been chosen
  // yet, and the Auto Context card below only renders once one has.
  const selected = engine?.provider
  const current = selected ? info[selected] : undefined
  // Unset falls back to the provider's own default, which is what
  // `engineChoice()` in main resolves to as well.
  const contextModel = settings?.contextModel || current?.defaultModel || ''
  /**
   * The models to show, in the assistant's own words.
   *
   * The same source the sidebar's model menu reads, rather than the list
   * compiled into Mindex: that one carries aliases — "Opus", "Sonnet" — while
   * the menu and the assistant both say "Opus 5" and "Sonnet 5", so the two
   * screens named the same model differently. Falls back to the compiled rows
   * for an assistant that has never answered, which is what `buildModelGroups`
   * does for the menu too.
   */
  const live = useAdvertisedOptions()
  const groups = useMemo(() => buildModelGroups(usableProviders(items), live), [items, live])
  const models = selected ? (groups.find((g) => g.provider === selected)?.rows ?? []) : []
  /**
   * Cheapest rung this provider offers, named the way the rows name it.
   *
   * The tier is Mindex's own opinion and only the compiled list carries it, so
   * it is looked up there and matched back into the rows above.
   */
  const lightValue = current?.models.find((m) => m.tier === 'light')?.value
  const recommended = models.find((m) => m.value === lightValue)

  async function patchEngine(next: { provider: ProviderId; model?: string }): Promise<void> {
    const provider = next.provider
    const changingProvider = provider !== selected
    // A model name does not survive a change of vendor — `opus` sent to Gemini
    // fails at the far end with a message the user cannot act on. Fall to that
    // provider's own first model rather than to nothing.
    const fallback = info[provider]?.defaultModel ?? ''
    const merged = {
      provider,
      model: changingProvider ? fallback : (next.model ?? engine?.model ?? fallback)
    }
    // A model belongs to the vendor that offers it, so switching provider has
    // to move the context model too — `haiku` handed to Gemini fails inside a
    // background job, far from this screen. Rather than clearing it and leaving
    // the field blank, it lands on the new provider's cheapest tier, which is
    // what this job wants anyway and what the row below recommends.
    //
    // Only on an actual change of provider: re-clicking the current one leaves
    // whatever model was deliberately chosen for it alone.
    const nextContext =
      info[provider]?.models.find((m) => m.tier === 'light')?.value ??
      info[provider]?.defaultModel ??
      ''
    const patch = changingProvider
      ? { engine: merged, contextModel: nextContext }
      : { engine: merged }
    const r = await api().settings.setApp(patch)
    if (r.ok && r.data) {
      useUiStore.setState({ settings: r.data })
      // Without this, a new tab kept using the mirror's stale value — 'claude'
      // and 'opus' forever, since nothing else in the app ever wrote to it —
      // until a restart, which didn't help either, since `bootstrap()` never
      // read this setting from disk in the first place.
      setLiveEngine(merged.provider, merged.model)
    }
  }

  /** The model for rewrites in the editor. Its own setting — see the card. */
  async function patchInlineModel(model: string): Promise<void> {
    const r = await api().settings.setApp({ ai: { ...(settings?.ai ?? {}), inlineModel: model } })
    if (r.ok && r.data) useUiStore.setState({ settings: r.data })
  }

  async function patchContextModel(model: string): Promise<void> {
    const r = await api().settings.setApp({ contextModel: model })
    if (r.ok && r.data) useUiStore.setState({ settings: r.data })
  }

  async function patchAutoContextEnabled(next: boolean): Promise<void> {
    if (!engine) return
    const r = await api().settings.setApp({ engine: { ...engine, autoContextEnabled: next } })
    if (r.ok && r.data) useUiStore.setState({ settings: r.data })
  }

  async function patchEngineFlag(
    key: 'vaultSkillEnabled' | 'searchToolEnabled' | 'contextEngineEnabled' | 'externalMcpEnabled',
    next: boolean
  ): Promise<void> {
    if (!engine) return
    const r = await api().settings.setApp({ engine: { ...engine, [key]: next } })
    if (r.ok && r.data) useUiStore.setState({ settings: r.data })
  }

  // No master switch, unlike `contextEngineEnabled` above — a manual check is
  // always available, since it's a pure read over the index, not an AI call.
  // This only decides whether it also runs on its own.
  async function patchLinkHealthAuto(next: boolean): Promise<void> {
    const r = await api().settings.setApp({
      linkHealth: { ...settings?.linkHealth, autoEnabled: next }
    })
    if (r.ok && r.data) useUiStore.setState({ settings: r.data })
  }

  // Absent means on for all three: they arrived after these settings shipped,
  // and an existing install has nothing written for them.
  const vaultSkillOn = engine?.vaultSkillEnabled !== false
  // Not gated per-provider (unlike the vault-skill file, which only Claude's
  // CLI reads): all three can be reached now — Claude and Codex take the
  // server on the command line for one run, Gemini through a file in the
  // vault — so the toggle below applies the same way regardless of `selected`.
  const searchToolOn = engine?.searchToolEnabled !== false
  const contextEngineOn = engine?.contextEngineEnabled !== false
  // Unlike the rest of this block, off is the default — see the field's own
  // doc comment in shared/types.ts for why.
  const externalMcpOn = engine?.externalMcpEnabled === true
  // Whether the chosen provider can actually answer anything right now.
  // Installed-but-not-signed-in and not-installed both read as "not ready" —
  // both leave the CLI with nothing to run.
  const engineReady = current?.status.installed === true && current.status.authenticated === true

  return (
    <SectionShell title="AI" icon="sparkle-filled">
      <Card
        title="General"
        // The first-run step's own words, minus its closing "you can change it
        // later in Settings" — which is where the reader already is.
        action={
          <IconButton
            icon="refresh"
            label={checking ? 'Checking…' : 'Re-check'}
            busy={checking}
            onClick={() => void refresh()}
          />
        }
      >
        {/* Rendered from the static list, not from the detection result, so the
            three tiles are on screen in the first frame and only their status
            arrives late. Hiding the block until the probes return made the
            whole section appear to load twice. */}
        <BlockRow
          label="Providers"
          hint="Download one, sign in with its own command, then click it to make it the one Mindex runs."
        >
          <div className="grid grid-cols-3 gap-2">
            {PROVIDERS.map((p) => {
              const it = info[p.id]
              const a = availabilityOf(it, loaded)
              const isSelected = p.id === selected
              const usable = a === 'ready'
              const isInstalling = installing === p.id

              if (a === 'missing') {
                // Not greyed out: the fix is one click away, and muting the card
                // buried the download button under the very tile that needed it.
                return (
                  <div
                    key={p.id}
                    className="flex aspect-[10/9] flex-col items-center justify-center gap-1.5 rounded-16 border border-bd-1 px-2 py-3"
                  >
                    <ProviderGlyph id={p.id} size={24} />
                    <span className="text-14 font-medium text-foreground">
                      {isInstalling ? 'Installing…' : p.label}
                    </span>
                    {/* Fixed-height slot so swapping the button for the progress
                      bar never changes the card's total content height — the
                      icon and label above stay put instead of re-centering. */}
                    <div className="mt-0.5 flex h-[22px] items-center justify-center">
                      {/* The bar's empty half is one step up the surface ladder from
                          the panel behind it (bg-1 here), never the same value — a
                          track painted in the page's own colour is not a track. */}
                      {isInstalling ? (
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-bg-2">
                          <div
                            className="h-full rounded-full bg-accent-1 transition-[width] duration-200 ease-out"
                            style={{ width: `${Math.min(100, Math.round(installProgress))}%` }}
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void install(p.id)}
                          className="inline-flex items-center gap-1 rounded-7 bg-accent-1 px-2 py-1 text-10.5 font-medium text-white transition-colors hover:bg-accent-1/90 [&_.codicon::before]:!text-white"
                        >
                          <Icon name="download" size={11} />
                          Download
                        </button>
                      )}
                    </div>
                  </div>
                )
              }

              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={!usable}
                  onClick={() => void patchEngine({ provider: p.id })}
                  title={a === 'signed-out' ? it?.loginHint : undefined}
                  className={[
                    'flex aspect-[10/9] flex-col items-center justify-center gap-1.5 rounded-16 border px-2 py-3 transition-colors',
                    pickerOption(isSelected),
                    usable && !isSelected ? 'cursor-pointer hover:bg-bg-3' : '',
                    usable ? 'cursor-pointer' : 'opacity-50'
                  ].join(' ')}
                >
                  <ProviderGlyph id={p.id} size={24} />
                  <span className="text-14 font-medium text-foreground">{p.label}</span>
                  <span className={`text-10.5 ${STATUS_TONE[a]}`}>{statusLine(a, it)}</span>
                </button>
              )
            })}
          </div>

          {installError ? <p className="mt-2.5 text-11.5 text-amber-400">{installError}</p> : null}

          {/* The one command that fixes a provider that is installed but not
              signed in — "missing" providers now have a Download button on the
              card itself instead of a copy-paste line here. */}
          {PROVIDERS.filter((p) => availabilityOf(info[p.id], loaded) === 'signed-out').map((p) => {
            const it = info[p.id]
            if (!it?.loginHint) return null
            return (
              <div key={p.id} className="mt-2.5 flex items-baseline gap-2 text-11.5">
                <span className="text-c-2">{p.label}:</span>
                <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-c-2">
                  {it.loginHint}
                </code>
              </div>
            )
          })}
        </BlockRow>

        {/* The master switch. Off blocks the manual click too, not just the
            automatic run — deliberately not offered during onboarding, where
            only "how" (manual vs auto) is asked, never "whether at all". */}
        <Row
          label="Context engine"
          hint="Turns the whole thing off — no folder context or living index, not even from a manual click in the sidebar."
          control={
            <Switch
              checked={contextEngineOn}
              onCheckedChange={(next) => void patchEngineFlag('contextEngineEnabled', next)}
              ariaLabel="Context engine"
            />
          }
        />
      </Card>

      {/* Where a model is chosen for work Mindex does to the text itself.
          Not the chat's: a chat's model is picked in the chat, and having
          one setting stand for both meant changing it for a conversation
          silently changed what rewrote your prose. */}
      {selected && current ? (
        <Card title="Models">
          {!engineReady ? (
            <BlockRow>
              <ProviderRequiredNotice
                message={`Install ${current.label} and sign in above to choose a model.`}
              />
            </BlockRow>
          ) : (
            <>
              <BlockRow
                label="Inline editing"
                hint="Does every rewrite offered on a selection in the editor."
              >
                <div className="flex flex-wrap gap-2">
                  {models.map((m) => {
                    const isPicked =
                      m.value ===
                      (settings?.ai?.inlineModel || engine?.model || current.defaultModel)
                    return (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => void patchInlineModel(m.value)}
                        className={[
                          'flex items-center gap-1.5 rounded-12 border p-2 transition-colors',
                          pickerOption(isPicked)
                        ].join(' ')}
                      >
                        <ProviderGlyph id={selected} size={14} />
                        <span className="whitespace-nowrap text-12.5 font-medium text-foreground">
                          {m.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </BlockRow>

              {/* The cheap rung: this one re-reads the vault on a schedule. */}
              <BlockRow
                label="Context engine"
                hint={
                  recommended
                    ? `Which rung of the ladder does this reading. ${recommended.label} is enough for it and is the cheapest one offered.`
                    : 'Which rung of the ladder does this reading.'
                }
              >
                <div className="flex flex-wrap gap-2">
                  {models.map((m) => {
                    const isPicked = m.value === contextModel
                    return (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => void patchContextModel(m.value)}
                        className={[
                          'flex items-center gap-1.5 rounded-12 border p-2 transition-colors',
                          pickerOption(isPicked)
                        ].join(' ')}
                      >
                        <ProviderGlyph id={selected} size={14} />
                        <span className="whitespace-nowrap text-12.5 font-medium text-foreground">
                          {m.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </BlockRow>
            </>
          )}
        </Card>
      ) : null}

      {/* Only once a provider is actually chosen: with none picked (or the
          chosen one no longer detected) there is no model list to show, and
          an empty card here used to sit under Provider looking broken rather
          than simply not existing yet. */}
      {selected && current ? (
        <Card title="Automation">
          {/* Different content, not dimmed content, while the chosen provider
              cannot answer — a switch and a set of pills that visibly do
              nothing when clicked is the same broken promise a picker with
              nowhere to send its choice makes in the composer. This card
              names what's missing instead. No action button: the Provider
              card that fixes it is already on screen, further up. */}
          {!engineReady ? (
            <BlockRow>
              <ProviderRequiredNotice
                message={`Install ${current.label} and sign in above to turn this on.`}
              />
            </BlockRow>
          ) : (
            <>
              <div className={cn(!contextEngineOn && 'pointer-events-none opacity-40')}>
                <BlockRow
                  label="Folder context"
                  hint="Applies to every folder in the vault. Either way, a single folder can still be updated by hand from the sidebar."
                >
                  <div className="grid grid-cols-2 gap-3">
                    {(
                      [
                        {
                          id: 'manual',
                          icon: 'hand',
                          label: 'Manual',
                          description: 'Click the sync button in the sidebar to update a folder.'
                        },
                        {
                          id: 'auto',
                          icon: 'zap',
                          label: 'Auto',
                          description: 'Updates by itself, shortly after you stop editing a folder.'
                        }
                      ] as const
                    ).map((opt) => {
                      const isAuto = opt.id === 'auto'
                      const isPicked = (engine?.autoContextEnabled ?? false) === isAuto
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => void patchAutoContextEnabled(isAuto)}
                          className={[
                            'flex flex-col items-start gap-1 rounded-16 border p-3 text-left transition-colors',
                            pickerOption(isPicked)
                          ].join(' ')}
                        >
                          <span className="flex items-center gap-[5.5px] text-13 font-medium text-foreground">
                            {opt.icon === 'hand' ? (
                              <HandIcon size={13} />
                            ) : (
                              <Icon name={opt.icon} size={13} className="codicon-inherit" />
                            )}
                            {opt.label}
                          </span>
                          <span className="text-11.5 text-muted-foreground">{opt.description}</span>
                        </button>
                      )
                    })}
                  </div>
                </BlockRow>
              </div>

              <BlockRow
                label="Link health"
                hint="Applies to every note in the vault. It is a read over the index, so it costs nothing to leave on."
              >
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      {
                        id: 'manual',
                        icon: 'hand',
                        label: 'Manual',
                        description: 'Only when you open the Link health panel. Never an AI call.'
                      },
                      {
                        id: 'auto',
                        icon: 'zap',
                        label: 'Auto',
                        description: 'Rechecks by itself, shortly after a note changes.'
                      }
                    ] as const
                  ).map((opt) => {
                    const isAuto = opt.id === 'auto'
                    const isPicked = (settings?.linkHealth?.autoEnabled ?? false) === isAuto
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => void patchLinkHealthAuto(isAuto)}
                        className={[
                          'flex flex-col items-start gap-1 rounded-16 border p-3 text-left transition-colors',
                          pickerOption(isPicked)
                        ].join(' ')}
                      >
                        <span className="flex items-center gap-[5.5px] text-13 font-medium text-foreground">
                          {opt.icon === 'hand' ? (
                            <HandIcon size={13} />
                          ) : (
                            <Icon name={opt.icon} size={13} className="codicon-inherit" />
                          )}
                          {opt.label}
                        </span>
                        <span className="text-11.5 text-muted-foreground">{opt.description}</span>
                      </button>
                    )
                  })}
                </div>
              </BlockRow>
            </>
          )}
        </Card>
      ) : null}

      {selected && current ? (
        <Card title="What the agent knows">
          {!engineReady ? (
            <BlockRow>
              <ProviderRequiredNotice
                message={`Install ${current.label} and sign in above to turn these on.`}
              />
            </BlockRow>
          ) : (
            <>
              <Row
                label="Describe note types"
                hint="Writes the vault's types, fields and folders into the CLI's skills folder, so new notes come back matching the schema."
                control={
                  <Switch
                    checked={vaultSkillOn}
                    onCheckedChange={(next) => void patchEngineFlag('vaultSkillEnabled', next)}
                    ariaLabel="Describe note types"
                  />
                }
              />
              <Row
                label="Give it Mindex search"
                hint={
                  selected === 'gemini'
                    ? 'Adds search, frontmatter query, backlinks, read, create and update as tools. Gemini has no per-run option, so this is registered in .gemini/settings.json inside the vault, and removed again when you turn it off.'
                    : 'Adds search, frontmatter query, backlinks, read, create and update as tools. Fewer passes than grep, and it can filter on fields grep cannot see.'
                }
                control={
                  <Switch
                    checked={searchToolOn}
                    onCheckedChange={(next) => void patchEngineFlag('searchToolEnabled', next)}
                    ariaLabel="Give it Mindex search"
                  />
                }
              />
            </>
          )}
        </Card>
      ) : null}

      <Card title="External access">
        <Row
          label="Expose to other AI apps"
          hint="Writes the vault's MCP connection into Claude Desktop, Cursor, and the plain claude CLI's own config files. Off by default: any of them, or anything that can read those files, gets read and write access to the whole vault while this is on."
          control={
            <Switch
              checked={externalMcpOn}
              onCheckedChange={(next) => void patchEngineFlag('externalMcpEnabled', next)}
              ariaLabel="Expose to other AI apps"
            />
          }
        />
        {externalMcpOn ? (
          <BlockRow>
            <ExternalMcpStatus />
          </BlockRow>
        ) : null}
      </Card>
    </SectionShell>
  )
}

/**
 * What actually happened the last time the vault was registered with other
 * apps — fetched fresh on mount rather than trusted from the toggle's own
 * response, since main re-registers on every launch too (the bridge's
 * socket/token rotate each time) and this card should agree with whichever
 * run is most recent either way.
 */
function ExternalMcpStatus(): JSX.Element {
  const [results, setResults] = useState<ExternalMcpResult[] | null>(null)
  const [checking, setChecking] = useState(false)

  async function refresh(): Promise<void> {
    setChecking(true)
    const r = await api().mcp.registerExternal()
    setResults(r.ok ? (r.data ?? null) : null)
    setChecking(false)
  }

  useEffect(() => {
    void refresh()
    // Only on mount / when the card first appears — the toggle firing this
    // itself in main is enough for it to actually take effect; this is only
    // the display, and re-running it on every render would spam the disk.
  }, [])

  return (
    <div className="mt-4 flex flex-col gap-1.5">
      {results === null ? (
        <p className="text-11.5 text-muted-foreground">
          {checking ? 'Checking…' : 'Could not check — try again from Settings.'}
        </p>
      ) : (
        results.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-12">
            <Icon
              name={r.ok ? 'check' : 'warning'}
              size={11}
              className={cn('shrink-0', r.ok ? 'codicon-emerald' : 'codicon-amber')}
            />
            <span className="min-w-0 flex-1 truncate text-foreground">{r.label}</span>
            {!r.ok && r.reason ? (
              <span className="truncate text-11 text-muted-foreground">{r.reason}</span>
            ) : null}
          </div>
        ))
      )}
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={checking}
        className="mt-1 self-start text-11 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        {checking ? 'Checking…' : 'Re-check'}
      </button>
    </div>
  )
}
