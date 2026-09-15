import type { ProviderId } from './types'

/**
 * The per-folder context filename each CLI actually reads, unprompted.
 *
 * Codex reads `AGENTS.md` natively. Claude Code reads only `CLAUDE.md` — it
 * has no setting to change that. Gemini CLI defaults to `GEMINI.md` unless
 * separately configured. So the file on disk tracks whichever provider is
 * currently active, rather than picking one fixed name and asking two of the
 * three CLIs to configure around it.
 */
export function contextFilename(provider: ProviderId): string {
  return { claude: 'CLAUDE.md', codex: 'AGENTS.md', gemini: 'GEMINI.md' }[provider]
}

/** Every name the context file could currently have, across all providers. */
export const ALL_CONTEXT_FILENAMES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'] as const

/**
 * Whether a basename is the per-folder context file of *any* provider.
 *
 * Matches all three names, not just the active provider's: a vault that was
 * last opened under a different CLI still has that CLI's file sitting in its
 * folders, and it is the same kind of thing — Mindex's own bookkeeping, not
 * one of the user's notes. The file tree hides every one of them for exactly
 * that reason (`buildTree`), so the test has to be provider-independent.
 */
export function isContextFilename(basename: string): boolean {
  return (ALL_CONTEXT_FILENAMES as readonly string[]).includes(basename)
}
