import { useUiStore } from '@/platform/app-settings'
import { useVaultStore } from '@/platform/workspace'
import { useMemo, useState } from 'react'
import type { ProviderId } from '@shared/types'
import { api } from '@/platform/api'
import { PROVIDERS } from '@/platform/providers'
import { useProvidersStore, usableProviders } from '@/platform/engines'
import { buildModelGroups } from '@/features/chat/lib/model-choice'
import { useAdvertisedOptions } from '@/features/chat/store-agentOptions'
import { setDefaultView, setLiveEngine } from '@/features/terminal/store-tabs'
import { ProviderGlyph } from '@/ui/provider-glyph'
import { Icon } from '@/ui/icon'
import { pickerOption } from '@/ui/picker-option'
// The same two miniatures Settings → Right sidebar shows; see view-picker.tsx.
import { ViewPicker } from '@/ui/view-picker'
import appIcon from '@/assets/app-icon.png'

type Step = 'welcome' | 'engine' | 'model' | 'view' | 'vault'

const STEP_ORDER: Step[] = ['welcome', 'engine', 'model', 'view', 'vault']

const STEP_COPY: Record<Step, { title: string; subtitle: string }> = {
  welcome: {
    title: 'Welcome to Mindex',
    subtitle: 'A quick setup — pick an engine, then open or create your vault.'
  },
  engine: {
    title: 'Which CLI do you use?',
    subtitle:
      'Pick the one installed on your machine, or install a new one. You can change it later in Settings.'
  },
  model: {
    title: 'Which model should maintain your context?',
    subtitle:
      'Runs on a schedule, re-reading your notes each time. A light model handles this well and keeps token usage low.'
  },
  view: {
    title: 'How should the right panel look?',
    subtitle: 'Pick the surface you prefer, both run the same CLI.'
  },
  vault: {
    title: 'Choose your workspace',
    subtitle: 'Open a folder you already use, or create a new one to start.'
  }
}

const FEATURES: { icon: string; iconClass?: string; title: string; body: string }[] = [
  {
    icon: 'markdown',
    iconClass: 'codicon-blue',
    title: 'Local-first Markdown files',
    body: 'Plain .md files on disk. No database, no proprietary format.'
  },
  {
    icon: 'lightbulb-sparkle',
    // Kept white, unlike the header button, the AGENTS.md row and the
    // Auto Context modal — all of which went default grey. The welcome
    // screen is the one place this mark is meant to stand out.
    iconClass: 'codicon-white',
    title: 'Self-updated AI context',
    body: 'A background job keeps context in sync as your files change.'
  },
  {
    icon: 'claude',
    iconClass: 'codicon-orange',
    title: 'Works on your AI subscription',
    body: 'Powered by the agent CLI you already use. No separate API key required.'
  }
]

// One-time first-run welcome shown after the initial Google sign-in. Dismissing it
// records `onboardedAt` so it never appears again.
export function OnboardingDialog(): JSX.Element | null {
  const settings = useUiStore((s) => s.settings)
  const providers = useProvidersStore((s) => s.items)
  const installing = useProvidersStore((s) => s.installing)
  const installProgress = useProvidersStore((s) => s.installProgress)
  const installError = useProvidersStore((s) => s.installError)
  const install = useProvidersStore((s) => s.install)
  const signIn = useProvidersStore((s) => s.signIn)
  const signInError = useProvidersStore((s) => s.signInError)
  const nodeRuntimeStatus = useProvidersStore((s) => s.nodeRuntimeStatus)
  const [step, setStep] = useState<Step>('welcome')
  /**
   * Deliberately starts empty, even though settings already hold a provider.
   *
   * Pre-selecting one turns the question into a form somebody clicks past —
   * and the pre-selection would be whatever the defaults happen to say, not
   * something the user decided. Nothing is chosen until they choose it.
   */
  const [picked, setPicked] = useState<ProviderId | null>(null)
  /** Same rule as `picked`: no model is chosen until the user chooses one. */
  const [pickedModel, setPickedModel] = useState<string | null>(null)
  /** Chat UI or the provider's terminal. Again, nothing chosen by default. */
  const [pickedView, setPickedView] = useState<'chat' | 'cli' | null>(null)
  /**
   * "Set this up later." Available whether or not a provider is already
   * usable — deciding to configure an assistant now is the user's call, not
   * something Continue should block on just because Mindex found one ready.
   * The rest of the app already treats "no assistant" as a real, supported
   * state: the composer, the right panel and the AI settings section all
   * have their own honest version of "nothing set up yet" instead of
   * standing in fake choices.
   */
  const [skipCli, setSkipCli] = useState(false)
  /**
   * True while `pickVault`/`createVault` is in flight.
   *
   * `onboardedAt` used to be written before either of those ran, so this
   * dialog unmounted the instant the button was clicked — dropping the dim
   * backdrop and exposing the still-empty WelcomeView behind it, with
   * nothing telling the user their click did anything. Staying mounted with
   * a spinner until the vault is actually ready keeps the (unblurred) dim
   * backdrop up for that whole gap instead.
   */
  const [finishing, setFinishing] = useState<'open' | 'create' | null>(null)

  /**
   * Every assistant's own model list, asked for the way the sidebar's menu
   * asks. Above the early return below, because a hook has to run on every
   * render whether or not this screen draws anything.
   */
  const live = useAdvertisedOptions()
  const groups = useMemo(
    () => buildModelGroups(usableProviders(providers), live),
    [providers, live]
  )

  // Was also gated on being signed in; there is no account any more, so the
  // locally stored completion mark is the whole answer.
  if (!settings || settings.onboardedAt) return null

  const usable = providers.filter((p) => p.status.installed && p.status.authenticated)
  // A real CLI is required to move past this step — Mindex needs one to do
  // anything. `skipCli` is the deliberate, explicit exception: a small,
  // secondary escape hatch (not the default) for a machine where none can
  // ever be made to work.
  const canContinue = picked !== null || skipCli
  /**
   * Models of whichever provider they just chose; empty until they choose one.
   *
   * The assistant's own list, not the one compiled into Mindex. The compiled
   * one carries aliases — "Opus", "Sonnet" — while the menu in the sidebar and
   * the assistant itself both say "Opus 5" and "Sonnet 5", so the first screen
   * a person ever sees was naming these differently from every screen after
   * it. Same source as that menu, asked for the same way.
   */
  const models = picked ? (groups.find((g) => g.provider === picked)?.rows ?? []) : []
  /**
   * Cheapest rung the provider offers, named in the assistant's own words.
   *
   * The tier is Mindex's own opinion and lives only in the compiled list, so
   * it is looked up there and then matched back into the live rows. Absent
   * when the assistant no longer advertises that model, which is right: a
   * recommendation for something not on offer is worse than none.
   */
  const compiledModels = picked ? (providers.find((p) => p.id === picked)?.models ?? []) : []
  const lightValue = compiledModels.find((m) => m.tier === 'light')?.value
  const recommended = models.find((m) => m.value === lightValue)

  /**
   * Records the provider only.
   *
   * It used to write `model: info.defaultModel` at the same time, which
   * silently made the choice the next step exists to ask about. Left unset,
   * so nothing is decided on the user's behalf.
   */
  async function chooseEngine(id: ProviderId): Promise<void> {
    const r = await api().settings.setApp({ engine: { provider: id, model: '' } })
    if (r.ok && r.data) useUiStore.setState({ settings: r.data })
    // Same reasoning as `chooseView`'s `setDefaultView` below: the tab store's
    // copy is otherwise only ever read at bootstrap, which on first run
    // already happened before this step — starting a chat right after
    // onboarding would use the mirror's hardcoded default instead of what was
    // just picked here.
    setLiveEngine(id, '')
  }

  /** The cheap model for background context work — not for chat. */
  async function chooseContextModel(model: string): Promise<void> {
    const r = await api().settings.setApp({ contextModel: model })
    if (r.ok && r.data) useUiStore.setState({ settings: r.data })
  }

  async function chooseView(view: 'chat' | 'cli'): Promise<void> {
    const r = await api().settings.setApp({ defaultView: view })
    if (r.ok && r.data) useUiStore.setState({ settings: r.data })
    // The tab store keeps its own copy, read once at vault load — which on
    // first run happens after this step.
    setDefaultView(view)
  }

  async function finish(action: 'open' | 'create'): Promise<void> {
    setFinishing(action)
    if (action === 'open') await useVaultStore.getState().pickVault()
    else await useVaultStore.getState().createVault()
    setFinishing(null)
    // Cancelling the native Finder/Explorer dialog resolves pickVault/createVault
    // normally rather than throwing — it just leaves `vault` unset. Marking
    // onboarded here regardless was closing the onboarding on a cancelled pick
    // as if the user had finished it. Only a real vault counts as done.
    if (!useVaultStore.getState().vault) return
    const r = await api().settings.setApp({ onboardedAt: Date.now() })
    if (r.ok && r.data) useUiStore.setState({ settings: r.data })
  }

  return (
    <div className="fixed inset-0 z-gate flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="relative w-[460px] max-w-[92vw] rounded-[20px] border border-bd-3 bg-bg-2 p-7 shadow-s2">
        {step !== 'welcome' ? (
          <button
            type="button"
            disabled={finishing !== null}
            onClick={() => {
              const prev = STEP_ORDER[Math.max(0, STEP_ORDER.indexOf(step) - 1)]!
              // Going forward skips the model step when no CLI is installed;
              // coming back has to skip it too, or the back arrow lands on an
              // empty list with a Continue that can never enable.
              setStep(prev === 'model' && models.length === 0 ? 'engine' : prev)
            }}
            title="Back"
            aria-label="Back"
            className="absolute left-4 top-4 z-pane inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-bg-3 hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Icon name="arrow-left" size={16} />
          </button>
        ) : null}
        <img src={appIcon} alt="Mindex" className="mx-auto mb-5 h-14 w-14" />
        <h1 className="text-center text-[19px] font-semibold tracking-tight text-foreground">
          {STEP_COPY[step].title}
        </h1>
        <p className="mt-1 text-center text-[13px] text-muted-foreground">
          {STEP_COPY[step].subtitle}
        </p>

        {step === 'welcome' ? (
          <>
            <div className="mt-9 space-y-4">
              {FEATURES.map((f) => (
                <div key={f.title} className="flex gap-3">
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-bg-3 text-foreground">
                    <Icon name={f.icon} size={20} className={f.iconClass} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-foreground">{f.title}</div>
                    <div className="text-[12px] leading-snug text-muted-foreground">{f.body}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-9">
              <button
                type="button"
                onClick={() => setStep('engine')}
                className="inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-accent-1 px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-1/90 [&_.codicon::before]:!text-white"
              >
                Continue
                <Icon name="arrow-right" size={16} />
              </button>
            </div>
          </>
        ) : step === 'engine' ? (
          <>
            <div className="mt-9 grid grid-cols-3 gap-2">
              {PROVIDERS.map((p) => {
                const info = providers.find((x) => x.id === p.id)
                const ready = info?.status.installed === true && info.status.authenticated
                // Known-missing, not just "still checking" — that only reads
                // once the first probe has actually returned an answer.
                const notInstalled = info !== undefined && !info.status.installed
                const needsAuth = info !== undefined && info.status.installed && !ready
                const isInstalling = installing === p.id
                // An install silently sets up Mindex's own private Node.js
                // runtime first if it isn't ready yet — while that's
                // happening, the card says so instead of "Installing…" for
                // a CLI that hasn't actually started downloading.
                const settingUpNode =
                  isInstalling && !!nodeRuntimeStatus && nodeRuntimeStatus.phase !== 'ready'
                const installLabel = settingUpNode ? 'Setting up Node.js…' : 'Installing…'
                const installFillPct = settingUpNode
                  ? nodeRuntimeStatus.phase === 'downloading'
                    ? (nodeRuntimeStatus.progress ?? 0) * 100
                    : nodeRuntimeStatus.phase === 'extracting'
                      ? 95
                      : 5
                  : installProgress

                if (notInstalled) {
                  // A card that can't be picked yet has nothing to be muted
                  // against — greying it out just buried the one thing to do
                  // next. So instead of a disabled tile, this is the tile with
                  // an action on it.
                  return (
                    <div
                      key={p.id}
                      className="flex aspect-[10/9] flex-col items-center justify-center gap-1.5 rounded-[16px] border border-bd-2 px-2 py-3"
                    >
                      <ProviderGlyph id={p.id} size={24} />
                      <span className="text-[14px] font-medium text-foreground">
                        {isInstalling ? installLabel : p.label}
                      </span>
                      {/* Fixed-height slot so swapping the button for the progress
                          bar never changes the card's total content height — the
                          icon and label above stay put instead of re-centering. */}
                      <div className="mt-0.5 flex h-[22px] items-center justify-center">
                        {isInstalling ? (
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-bg-3">
                            <div
                              className="h-full rounded-full bg-accent-1 transition-[width] duration-200 ease-out"
                              style={{ width: `${Math.min(100, Math.round(installFillPct))}%` }}
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void install(p.id)}
                            className="inline-flex items-center gap-1 rounded-[7px] bg-accent-1 px-2 py-1 text-[10.5px] font-medium text-white transition-colors hover:bg-accent-1/90 [&_.codicon::before]:!text-white"
                          >
                            <Icon name="download" size={11} />
                            Download
                          </button>
                        )}
                      </div>
                    </div>
                  )
                }

                if (needsAuth) {
                  // Same card shape as the Download tile above — the CLI is
                  // there, it just has nothing to be picked yet either, so
                  // this gets an action of its own instead of dead text.
                  return (
                    <div
                      key={p.id}
                      className="flex aspect-[10/9] flex-col items-center justify-center gap-1.5 rounded-[16px] border border-bd-2 px-2 py-3"
                    >
                      <ProviderGlyph id={p.id} size={24} />
                      <span className="text-[14px] font-medium text-foreground">{p.label}</span>
                      <div className="mt-0.5 flex h-[22px] items-center justify-center">
                        <button
                          type="button"
                          onClick={() => void signIn(p.id)}
                          className="inline-flex items-center gap-1 rounded-[7px] bg-accent-1 px-2 py-1 text-[10.5px] font-medium text-white transition-colors hover:bg-accent-1/90 [&_.codicon::before]:!text-white"
                        >
                          <Icon name="sign-in" size={11} />
                          Sign in
                        </button>
                      </div>
                    </div>
                  )
                }

                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!ready}
                    onClick={() => {
                      // Clicking the chosen one again clears it, so a
                      // mis-click is undoable without picking something else
                      // instead. Continue goes back to disabled, which is the
                      // same state the step opened in.
                      if (p.id === picked) {
                        setPicked(null)
                        setPickedModel(null)
                        return
                      }
                      setPicked(p.id)
                      // The model list belongs to the provider, so a model
                      // chosen under the previous one is not in the new list —
                      // keeping it would leave Continue enabled on a model this
                      // provider cannot run.
                      setPickedModel(null)
                      void chooseEngine(p.id)
                    }}
                    className={[
                      'flex aspect-[10/9] flex-col items-center justify-center gap-1.5 rounded-[16px] border px-2 py-3 transition-colors',
                      pickerOption(p.id === picked),
                      ready && p.id !== picked ? 'cursor-pointer hover:bg-bg-3' : '',
                      ready ? 'cursor-pointer' : 'opacity-50'
                    ].join(' ')}
                  >
                    <ProviderGlyph id={p.id} size={24} />
                    <span className="text-[14px] font-medium text-foreground">{p.label}</span>
                    <span className="text-[10.5px] text-muted-foreground">
                      {/* Only ever reached when `!info` (still checking) or
                          `ready` — `notInstalled`/`needsAuth` above already
                          cover every other case. */}
                      {!info ? 'Checking…' : (info.status.version ?? '')}
                    </span>
                  </button>
                )
              })}
            </div>

            {installError ? (
              <p className="mt-3 text-center text-[11.5px] text-amber-400">{installError}</p>
            ) : null}
            {signInError ? (
              <p className="mt-3 text-center text-[11.5px] text-amber-400">{signInError}</p>
            ) : null}

            {/* Always offered, not only when nothing is installed — setting up
                an assistant now is a choice to make, not a box Continue can
                force. Not shown once already used, so it doesn't linger as a
                second button once the point is moot. */}
            {!skipCli ? (
              <p className="mt-3 text-center text-[11.5px] text-muted-foreground">
                {usable.length === 0 ? (
                  <>
                    None found yet. Install or sign in above, or{' '}
                    <button
                      type="button"
                      onClick={() => setSkipCli(true)}
                      className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                    >
                      skip for now
                    </button>
                    .
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSkipCli(true)}
                    className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                  >
                    Skip — set this up later
                  </button>
                )}{' '}
                Settings → Engine has this whenever you&rsquo;re ready.
              </p>
            ) : null}

            <div className="mt-9">
              {/* One decision per screen. Choosing an engine and choosing a
                  vault are unrelated questions, and putting them together made
                  the vault buttons look like the way to confirm the engine. */}
              {/* Disabled rather than hidden: a button that appears on click
                  makes the layout jump and hides where the step is going.
                  Exception — when nothing is installed there is nothing to
                  choose, and refusing to continue would be a dead end. */}
              <button
                type="button"
                disabled={!canContinue}
                // No provider picked — whether because none is usable yet or
                // because the user chose to skip one that was — means no
                // model list to show, so that step is skipped entirely. The
                // chat/CLI choice on the next step still applies either way.
                onClick={() => setStep(picked === null ? 'view' : 'model')}
                className="inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-accent-1 px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-1/90 disabled:cursor-default disabled:bg-bg-3 disabled:text-muted-foreground disabled:hover:bg-bg-3"
              >
                Continue
                {/* The colour is named in both states rather than left to the
                    button's `[&_.codicon::before]` rule: that selector and the
                    helper have identical specificity, so which one won would
                    have depended on stylesheet order. */}
                <Icon
                  name="arrow-right"
                  size={16}
                  className={canContinue ? 'codicon-on-fill' : 'codicon-muted'}
                />
              </button>
            </div>
          </>
        ) : step === 'model' ? (
          <>
            {/* A grid rather than a list, and nothing but the name in each
                cell. Everything worth saying on the right — price, context,
                what an alias resolves to — is either unavailable for some
                provider or true only on some CLI builds, and a column that is
                right for Codex and wrong for Claude is worse than an empty
                one. The audience can tell these models apart. */}
            {/* Wrapping flex rather than a fixed grid: each card is only as
                wide as its own name, and rows centre themselves — which also
                means an odd count needs no special case, the last card simply
                centres on its own row. */}
            <div className="mt-9 flex flex-wrap justify-center gap-2">
              {models.map((m) => {
                const isPicked = m.value === pickedModel
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => {
                      if (m.value === pickedModel) {
                        setPickedModel(null)
                        return
                      }
                      setPickedModel(m.value)
                      void chooseContextModel(m.value)
                    }}
                    className={[
                      'flex items-center gap-1.5 rounded-[12px] border p-2 transition-colors',
                      pickerOption(isPicked)
                    ].join(' ')}
                  >
                    {picked ? <ProviderGlyph id={picked} size={14} /> : null}
                    <span className="whitespace-nowrap text-[12.5px] font-medium text-foreground">
                      {m.label}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* The cheapest tier the provider offers. Named rather than
                pre-selected: the step exists to be answered, and a highlighted
                card would be answering it. Hidden entirely when no model
                carries a tier — Codex's list comes from the CLI at runtime, so
                a shape change there must not invent a recommendation. */}
            {recommended ? (
              <div className="mt-5 border-t border-border pt-4 text-center text-[12px] text-muted-foreground">
                Recommended:{' '}
                <span className="font-medium text-foreground">{recommended.label}</span>
              </div>
            ) : null}

            <div className="mt-7">
              <button
                type="button"
                disabled={pickedModel === null}
                onClick={() => setStep('view')}
                className="inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-accent-1 px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-1/90 disabled:cursor-default disabled:bg-bg-3 disabled:text-muted-foreground disabled:hover:bg-bg-3"
              >
                Continue
                <Icon
                  name="arrow-right"
                  size={16}
                  className={pickedModel !== null ? 'codicon-on-fill' : 'codicon-muted'}
                />
              </button>
            </div>
          </>
        ) : step === 'view' ? (
          <>
            <div className="mt-8">
              <ViewPicker
                provider={picked ?? 'claude'}
                value={pickedView}
                onSelect={(id) => {
                  // Clicking the chosen card clears it, the same toggle the
                  // provider and model steps use — nothing is decided until
                  // the user decides it.
                  if (id === pickedView) {
                    setPickedView(null)
                    return
                  }
                  setPickedView(id)
                  void chooseView(id)
                }}
              />
            </div>

            <div className="mt-7">
              <button
                type="button"
                disabled={pickedView === null}
                onClick={() => setStep('vault')}
                className="inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-accent-1 px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-1/90 disabled:cursor-default disabled:bg-bg-3 disabled:text-muted-foreground disabled:hover:bg-bg-3"
              >
                Continue
                <Icon
                  name="arrow-right"
                  size={16}
                  className={pickedView !== null ? 'codicon-on-fill' : 'codicon-muted'}
                />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-9 flex items-center gap-3">
              <button
                type="button"
                disabled={finishing !== null}
                onClick={() => void finish('create')}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-[12px] border border-border bg-transparent px-4 py-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-bg-3 disabled:cursor-default disabled:opacity-60 [&_.codicon::before]:!text-foreground"
              >
                {finishing === 'create' ? (
                  <Icon name="loading" size={16} className="animate-spin" />
                ) : (
                  <Icon name="new-folder" size={16} />
                )}
                Create vault
              </button>
              <button
                type="button"
                disabled={finishing !== null}
                onClick={() => void finish('open')}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-[12px] bg-accent-1 px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-1/90 disabled:cursor-default disabled:opacity-70 [&_.codicon::before]:!text-white"
              >
                {finishing === 'open' ? (
                  <Icon name="loading" size={16} className="animate-spin" />
                ) : (
                  <Icon name="folder-opened" size={16} />
                )}
                Open a vault
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
