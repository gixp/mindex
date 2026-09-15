// Data model for the Context hub: what the AI currently knows about the
// vault. Kept out of types.ts on purpose — same split as chat.ts.
//
// The vault-hygiene suggestion pipeline (wiki links, duplicates, move,
// contradictions, renames) that used to live in this file has been archived
// to ../archive/app/shared/suggestions.ts — it never got past a disabled toolbar
// button and a placeholder review modal, and is not being built.

// --- Context overview (no AI involved) --------------------------------------

/**
 * 'behind' means the folder has notes newer than its CLAUDE.md, so the AI's
 * picture of it is out of date. 'missing' means it has no CLAUDE.md at all.
 */
export type ContextStaleness = 'fresh' | 'behind' | 'missing'

export interface FolderContextMetrics {
  folderRel: string
  hasContextFile: boolean
  aiDisabled: boolean
  disabledBy?: string
  contextBytes: number
  /** bytes/4 — a budget signal, not a real tokenizer. Label it "approx". */
  contextTokensApprox: number
  purpose: string
  noteCount: number
  noteBytes: number
  generatedAt?: string
  newestNoteMtime?: number
  staleness: ContextStaleness
}

export interface ContextOverview {
  root: {
    hasContextFile: boolean
    bytes: number
    tokensApprox: number
    excerpt: string
    /** The vault's own Purpose section, the same field every folder carries.
     *  The root file is built from the same template as the rest, so it has
     *  one — it is simply assembled separately here, which is why it needs
     *  spelling out rather than arriving with the folder list. */
    purpose: string
  }
  folders: FolderContextMetrics[]
  totals: {
    folders: number
    withContext: number
    contextBytes: number
    contextTokensApprox: number
    notes: number
    noteBytes: number
  }
  builtAt: number
}

export function approxTokens(bytes: number): number {
  return Math.round(bytes / 4)
}
