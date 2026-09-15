import type { ProviderId } from '@shared/types'

/**
 * The three providers, known without asking main.
 *
 * Detection is a round trip; this list is not. Having the names and icons up
 * front is what lets a screen draw its whole shape on the first frame and then
 * fill in each status, instead of showing nothing and then jumping into
 * existence — a layout that appears late reads as a bug even when it is fast.
 */
export const PROVIDERS: {
  id: ProviderId
  label: string
  /**
   * Who makes it, as opposed to what it is called.
   *
   * Two different names for two different questions. Installing, signing in
   * and troubleshooting are about the program on this machine, and there the
   * program's own name is the only one that helps — it is what the install
   * command says and what the window title shows. Choosing a model is about
   * whose model it is: the names sit as headings over a list of models, and
   * the model names underneath already carry the program's vocabulary.
   */
  vendor: string
  icon: string
  /** Brand colour helper from globals.css; empty means inherit. */
  iconClass: string
}[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    vendor: 'Anthropic',
    icon: 'claude',
    iconClass: 'codicon-brand-claude'
  },
  // OpenAI's mark is monochrome by design, so it gets no brand tint — but it
  // still needs a colour helper. Left blank it inherits the global `.codicon`
  // grey, which is set with `!important` in globals.css and made it look
  // disabled next to two coloured siblings.
  {
    id: 'codex',
    label: 'Codex CLI',
    vendor: 'OpenAI',
    icon: 'openai',
    iconClass: 'codicon-white'
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    vendor: 'Google',
    icon: 'sparkle',
    iconClass: 'codicon-brand-gemini'
  }
]

export function providerLabel(id: ProviderId): string {
  return PROVIDERS.find((p) => p.id === id)?.label ?? id
}

/** Who makes it. Falls back to the program's own name rather than to an id. */
export function providerVendor(id: ProviderId): string {
  const found = PROVIDERS.find((p) => p.id === id)
  return found?.vendor ?? found?.label ?? id
}

export function providerIcon(id: ProviderId): string {
  return PROVIDERS.find((p) => p.id === id)?.icon ?? 'server-process'
}

export function providerIconClass(id: ProviderId): string {
  return PROVIDERS.find((p) => p.id === id)?.iconClass ?? ''
}
