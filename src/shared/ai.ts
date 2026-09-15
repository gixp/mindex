/**
 * The shared vocabulary for Mindex's AI features.
 *
 * Every AI feature in the app — grounded chat, the knowledge linter, selection
 * transforms, capture enrichment — runs through the same two ideas defined
 * here: a *structured task* (ask the agent a question, get back validated JSON,
 * never free prose the UI has to parse) and a *proposal* (a change the person
 * reviews as a diff before it ever touches disk). Nothing here knows how the
 * agent is reached — that is `main/ai/task.ts`'s problem — so this file is safe
 * to import from the renderer.
 */

/**
 * Which feature a task or proposal came from.
 *
 * Free-form on purpose: features are added often, and a closed union would have
 * to be edited in lockstep with every new one. The value is only ever used for
 * logging, the history `authorDetail`, and grouping cards in the task tray — a
 * typo degrades a label, it does not break a code path.
 */
export type AiTaskKind = string

/**
 * A pointer from something the agent said back to the exact lines of a note it
 * came from.
 *
 * The agent returns `{ path, quote }` — a vault-relative path and a verbatim
 * span it copied out of that note. `main/ai/citations.ts` resolves the quote to
 * a line range against the file on disk (the agent cannot count lines
 * reliably, and asking it to would make every answer a place for an off-by-one
 * to hide). `lineStart` / `lineEnd` are absent when the quote could not be
 * found — a citation to a note that has since changed still opens the note,
 * just not at a line.
 */
export interface Citation {
  /** Vault-relative path of the cited note. */
  path: string
  /** The verbatim passage the agent copied out of the note. */
  quote: string
  /** 1-based, inclusive. Absent when `quote` no longer appears in the file. */
  lineStart?: number
  /** 1-based, inclusive. */
  lineEnd?: number
}

/** One file a proposal wants to change, with the text to check for a conflict. */
export interface FileEdit {
  /** Vault-relative path. A path that does not exist yet is a new note. */
  path: string
  /**
   * The note's body as the agent last saw it. Compared against disk at apply
   * time; a mismatch means the note changed under the proposal and the person
   * is asked before anything is overwritten. Empty for a new note.
   */
  before: string
  /** The full body to write. */
  after: string
  /**
   * The mtime the `before` text was read at, or `undefined` for a new note.
   * The apply path prefers this over a text compare when it is available —
   * it is what the rest of Mindex already uses for conflict detection
   * (`notes.write`'s `expectedMtime`).
   */
  expectedMtime?: number
}

export type AiProposalStatus =
  | 'streaming'
  | 'ready'
  | 'applying'
  | 'applied'
  | 'partially-applied'
  | 'discarded'
  | 'failed'

/**
 * A reviewed change. The single unit every AI mutation in Mindex is expressed
 * as — one card, one diff view, one Apply button — no matter which feature
 * produced it. Nothing in the AI layer calls `notes.write` directly; it builds
 * one of these and hands it to the person.
 */
export interface AiProposal {
  id: string
  kind: AiTaskKind
  /** One line, shown as the card's heading. */
  title: string
  /** Why the agent is proposing this. Shown under the title, above the diff. */
  rationale: string
  edits: FileEdit[]
  citations: Citation[]
  status: AiProposalStatus
  createdAt: number
  /** Set when `status` is `failed` — the reason, in plain language. */
  errorMessage?: string
  /** Per-edit apply outcome, populated once an apply has been attempted. */
  results?: Array<{ path: string; ok: boolean; reason?: string }>
}

/** What the renderer sends to apply one edit of a proposal. */
export interface ApplyEditInput {
  kind: AiTaskKind
  edit: FileEdit
}

export interface ApplyEditResult {
  path: string
  ok: boolean
  /** Why not, when `ok` is false — `'conflict'` gets its own handling upstream. */
  reason?: 'conflict' | 'write-failed' | 'no-vault'
  message?: string
}

/**
 * The failure shapes a structured task can end in, kept as a union so callers
 * can tell "the agent is not set up" (offer to configure it) from "the agent
 * answered but not in the shape asked for" (a bug to log, not a prompt).
 */
export type AiTaskErrorReason =
  | 'not-configured'
  | 'agent-error'
  | 'invalid-output'
  | 'aborted'
  | 'timeout'
  | 'no-vault'
  /**
   * The assistant answered, and its answer was the passage it was given.
   *
   * Not an error in the machinery — everything worked — so it is named apart
   * from one. For a correction that can simply mean there was nothing to
   * correct; for a rewrite it usually means the request is worth repeating.
   */
  | 'unchanged'

export interface AiTaskFailure {
  ok: false
  reason: AiTaskErrorReason
  message: string
}

export interface AiTaskSuccess<T> {
  ok: true
  data: T
  /** Notes the agent read while answering — the provenance behind `data`. */
  readPaths: string[]
}

export type AiTaskResult<T> = AiTaskSuccess<T> | AiTaskFailure

/**
 * Per-feature on/off, stored under `AppSettings`. Absent means on: a feature
 * ships enabled, and this block only exists so a person can turn one off, the
 * same default-on convention the `engine` block already uses.
 */
export interface AiFeatureSettings {
  /**
   * The model that does the rewrites offered on a selection in the editor.
   *
   * Its own setting, not the one under `engine`. That one seeds a new chat
   * tab, and a chat's model is chosen in the chat — so sharing a value meant
   * changing the model for a conversation silently changed what rewrote your
   * prose, and the other way round. Unset falls back to the engine's model,
   * which is what every install before this had.
   */
  inlineModel?: string
  /**
   * Who does the capture, chosen in the capture window itself.
   *
   * Its own three fields rather than the engine's, for the reason every other
   * split here had: filing a pasted link wants something quick, and the
   * assistant that reads the whole vault on a schedule is chosen for a
   * different reason entirely. Unset means whatever the engine is set to,
   * which is what every install before this had.
   */
  captureProvider?: import('./types').ProviderId
  captureModel?: string
  captureEffort?: import('./chat').ChatEffort
  /** Grounded chat cites the notes it drew on. */
  chatCitations?: boolean
  /** The knowledge linter (stale claims, contradictions, unlinked mentions). */
  linter?: boolean
  /** Selection transforms and "continue writing" in the editor. */
  authoring?: boolean
  /** Paste / drop enrichment turns pasted material into a filed note. */
  capture?: boolean
}

/**
 * The rewrites offered on a selected passage.
 *
 * One list, read by both halves: the window draws the menu from it, and the
 * app builds the request from the same entry. Splitting the label from the
 * instruction across the two would let a menu item say one thing and ask for
 * another.
 *
 * `instruction` is addressed to the assistant and says what to do with the
 * passage — never how to format the answer, which the task runner appends.
 */
export interface SelectionTransform {
  id: string
  /** Menu label. */
  label: string
  /** Codicon name for the menu row. */
  icon: string
  /** What the assistant is asked to do with the passage. */
  instruction: string
  /** Shown as the proposal's heading once an answer comes back. */
  title: string
}

export const SELECTION_TRANSFORMS: readonly SelectionTransform[] = [
  {
    id: 'rewrite',
    label: 'Rewrite',
    icon: 'edit',
    title: 'Rewritten passage',
    instruction:
      'Rewrite the passage so it reads better, keeping every fact and the author’s voice. Do not add information that is not already there.'
  },
  {
    id: 'shorten',
    label: 'Shorten',
    icon: 'fold',
    title: 'Shortened passage',
    instruction:
      'Make the passage shorter while keeping every fact it states. Cut padding, not content.'
  },
  {
    id: 'expand',
    label: 'Expand',
    icon: 'unfold',
    title: 'Expanded passage',
    instruction:
      'Draw the passage out with the detail it is missing, using only what the surrounding notes already establish. If nothing in the vault supports a detail, leave it out rather than inventing it.'
  },
  {
    id: 'grammar',
    label: 'Fix grammar',
    icon: 'check',
    title: 'Corrected passage',
    instruction:
      'Correct spelling, grammar and punctuation. Change nothing else — not the wording, not the order, not the tone.'
  },
  {
    id: 'simplify',
    label: 'Simplify',
    icon: 'lightbulb',
    title: 'Simplified passage',
    instruction:
      'Say the same thing in plainer language. Keep every fact; drop jargon that is not doing work.'
  },
  {
    id: 'list',
    label: 'Turn into a list',
    icon: 'list-unordered',
    title: 'Passage as a list',
    instruction:
      'Turn the passage into a markdown bullet list, one point per bullet, keeping every fact.'
  },
  {
    id: 'table',
    label: 'Turn into a table',
    icon: 'table',
    title: 'Passage as a table',
    instruction:
      'Turn the passage into a markdown table. Choose columns that fit the material. Keep every fact.'
  },
  {
    id: 'actions',
    label: 'Extract action items',
    icon: 'checklist',
    title: 'Action items',
    instruction:
      'Replace the passage with a markdown task list of the actions it implies, written as "- [ ] …". Include only actions the passage actually calls for.'
  }
]

/** What the window sends to rewrite a passage. */
export interface TransformSelectionInput {
  /** One of `SELECTION_TRANSFORMS`. */
  transformId: string
  /**
   * Absolute path of the note the passage is in — what the window has to hand.
   * The app converts it to the vault-relative form the proposal carries, and
   * refuses a file that is not inside the open vault.
   */
  notePath: string
  /**
   * The passage and its surroundings, as the editor captured them. The app
   * re-finds it in the file on disk rather than trusting an offset — the
   * editor's document and the markdown file do not share a coordinate system.
   */
  anchor: {
    exact: string
    prefix: string
    suffix: string
    occurrence: number
  }
}

/** A proposal built and ready to review, or why one could not be. */
export type TransformSelectionResult =
  | { ok: true; proposal: AiProposal }
  | { ok: false; reason: AiTaskErrorReason | 'passage-not-found'; message: string }

/**
 * A note the app is offering to create from something that was pasted.
 *
 * Nothing is written until a person accepts it. Every field is a *proposal*:
 * the type it looks like, the folder that type lives in, the tags the vault
 * already uses, and the notes it seems to relate to.
 */
export interface CaptureDraft {
  /** A type id already defined in this vault. */
  type: string
  title: string
  /** Vault-relative folder. */
  folder: string
  /** Frontmatter for the type's own fields, already checked against them. */
  frontmatter: Record<string, unknown>
  body: string
  /** Tags chosen from the ones the vault already uses. */
  tags: string[]
  /** Vault-relative paths of notes this one links to. Each is known to exist. */
  links: string[]
  /** Where it came from, when that is a web address. */
  source?: string
}

export type CaptureResult =
  | { ok: true; draft: CaptureDraft }
  | { ok: false; reason: AiTaskErrorReason | 'nothing-to-capture'; message: string }
