/** Notes, their frontmatter, and the shapes a search returns. */

/**
 * The types Mindex ships. Not the whole vocabulary — see `NoteTypeId`.
 */
export const BUILTIN_TYPE_IDS = [
  'project',
  'person',
  'organization',
  'goal',
  'payment',
  'expense',
  'call-transcript',
  'call-debrief',
  'knowledge',
  'claude-chat',
  'daily-note',
  'asset',
  'untyped'
] as const

export type BuiltinTypeId = (typeof BUILTIN_TYPE_IDS)[number]

/**
 * A note's type.
 *
 * A plain string rather than a union of the built-ins, because a vault may
 * define its own in `.mindex/types/<id>.md` and such a type has to be as real
 * as a shipped one — detected on a note, validated, described to the agent,
 * filterable. A closed union made every one of those a special case, which is
 * another way of saying a custom type was decoration.
 *
 * Anything reading the built-in registry must therefore treat a miss as
 * ordinary: `REGISTRY[id]` can be undefined, and that means "the vault defines
 * this one", not "corrupt".
 */
export type NoteTypeId = string

export type Frontmatter = Record<string, unknown>

export interface NoteMeta {
  path: string
  relPath: string
  title: string
  type: NoteTypeId
  id?: string
  frontmatter: Frontmatter
  tags: string[]
  outgoingLinks: string[]
  mtime: number
  createdAt?: number
  preview?: string
  size: number
  isDirectory: boolean
}

export interface Task {
  notePath: string
  line: number
  text: string
  done: boolean
  assignee?: string
  due?: string
  priority?: string
}

export interface QueryResult {
  notes: NoteMeta[]
  total: number
  ms: number
}

export interface SearchResult {
  path: string
  title: string
  type: NoteTypeId
  score: number
  excerpt?: string
  /**
   * Which part of the note the hit came from.
   *
   * A result that matched on the text of a note looks, in a list of titles,
   * exactly like a result that has no business being there. Saying where the
   * match was is what makes the row explain itself.
   */
  matchedIn: 'title' | 'text' | 'tags'
}

export interface NoteTypeSpec {
  id: NoteTypeId
  label: string
  defaultFolder: string
  filenamePattern: string
  icon: string
  color: string
  hasFrontmatter: boolean
  requiredSections: string[]
  /**
   * Frontmatter keys that hold references to other notes rather than plain
   * text — `company`, `project`, `participants`. Declaring them is what lets
   * a value written without `[[brackets]]` still be filtered on as a link.
   */
  relations: string[]
}

export interface TemplateSpec {
  id: string
  label: string
  type: NoteTypeId
  body: string
  variables: string[]
}

export interface FrontmatterQuery {
  filters: Array<{
    key: string
    op: '=' | '!=' | '>' | '<' | '>=' | '<=' | '~' | 'in' | 'has'
    value: string | number | boolean | string[] | null
  }>
  sort?: { key: string; dir: 'asc' | 'desc' }
  limit?: number
}
