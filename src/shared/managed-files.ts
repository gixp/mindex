import { contextFilename } from './context-filename'
import type { ProviderId } from './types'

export type ManagedScope = 'root' | 'folder' | 'both'

export interface ManagedFileSpec {
  /** Every name this file could currently have, one per provider — not just
   *  the active one. Lets `MANAGED_LOOKUP` recognize a stray file left behind
   *  by a provider switch (see the never-overwrite rule in the rename engine)
   *  even while a different provider is active. */
  filenames: Record<ProviderId, string>
  /** Stable across every provider — the file's identity in the tree doesn't
   *  flicker between "Claude"/"Codex"/"Gemini" every time the active provider
   *  changes. The icon (driven separately, from the active provider) is what
   *  actually communicates which CLI currently owns the file. */
  label: string
  icon: string
  scope: ManagedScope
  defaultContent?(vaultRoot: string, provider: ProviderId): string
}

const CONTEXT_SEED = (_vaultRoot: string, provider: ProviderId): string =>
  [
    '# Vault — Mindex',
    '',
    '_This file is read by your agent CLI at the start of every session._',
    '_Auto-generated. Edits below the `<!-- INDEX:END -->` marker survive regen._',
    '',
    '<!-- INDEX:START -->',
    '',
    '## Working with this vault',
    '',
    `Open any sub-folder and read its \`${contextFilename(provider)}\` first to understand what`,
    'lives there and how it connects to the rest of the vault.',
    '',
    '<!-- INDEX:END -->',
    ''
  ].join('\n')

/**
 * Files Mindex maintains at the vault root.
 *
 * The context file's name tracks whichever CLI is currently active — Codex
 * reads `AGENTS.md` natively, Claude Code only reads `CLAUDE.md`, Gemini CLI
 * defaults to `GEMINI.md`. A single fixed name meant two of the three CLIs
 * never saw what Mindex had written about the vault.
 */
export const MANAGED_FILES = {
  context: {
    filenames: {
      claude: contextFilename('claude'),
      codex: contextFilename('codex'),
      gemini: contextFilename('gemini')
    },
    label: 'Context',
    icon: 'lightbulb-sparkle',
    scope: 'both',
    defaultContent: CONTEXT_SEED
  }
} as const satisfies Record<string, ManagedFileSpec>

/** basename → spec, covering every provider's name for every managed file —
 *  built once at module load and correct forever, since this is the full set
 *  of names a managed file could *ever* have, not just its current one. */
const MANAGED_LOOKUP: Record<string, ManagedFileSpec> = Object.values(MANAGED_FILES).reduce<
  Record<string, ManagedFileSpec>
>((acc, spec) => {
  for (const filename of Object.values(spec.filenames)) acc[filename] = spec
  return acc
}, {})

export function isManagedFilename(basename: string): boolean {
  return basename in MANAGED_LOOKUP
}

export function isManagedOrSidecarFilename(basename: string): boolean {
  if (basename in MANAGED_LOOKUP) return true
  const sidecarMatch = basename.match(/^(.+?)\.(bak|tmp)$/)
  if (sidecarMatch && sidecarMatch[1]) {
    if (sidecarMatch[1] in MANAGED_LOOKUP) return true
  }
  return false
}

function specFor(basename: string): ManagedFileSpec | null {
  return MANAGED_LOOKUP[basename] ?? null
}

export function managedFileLabel(basename: string): string | null {
  return specFor(basename)?.label ?? null
}

export function managedFileIcon(basename: string): string | null {
  return specFor(basename)?.icon ?? null
}

export function managedFileSpec(basename: string): ManagedFileSpec | null {
  return specFor(basename)
}

/** The name `spec` should currently have on disk, for the active provider. */
export function resolvedFilename(spec: ManagedFileSpec, provider: ProviderId): string {
  return spec.filenames[provider]
}

export function listRootScopedManagedFiles(): ManagedFileSpec[] {
  return Object.values(MANAGED_FILES).filter((s) => s.scope === 'both')
}

export function isProtectedManagedFile(basename: string): boolean {
  return basename in MANAGED_LOOKUP
}
