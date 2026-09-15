/**
 * What a note type *is*, as data rather than code.
 *
 * The built-in types live in `main/types/registry.ts` as Zod schemas — that
 * is what validates a note, and it stays the source of truth. This model is
 * the same information in a shape the interface can draw and the user can
 * edit: field names, what kind of value each holds, and what a new note of
 * that type starts from.
 *
 * A vault may override any of it by dropping `.mindex/types/<id>.md`. The
 * built-in definition is then the factory setting the file is diffed against,
 * exactly the way `.mindex/templates/` already overrides a template.
 */

/**
 * The kinds a frontmatter field can have.
 *
 * Deliberately few. Each one has to earn an editor in the frontmatter panel
 * and an operator set in the filter language, and a kind nobody can draw is
 * just a string with extra ceremony.
 */
export type NoteFieldKind = 'text' | 'number' | 'date' | 'boolean' | 'select' | 'relation' | 'list'

export const FIELD_KINDS: NoteFieldKind[] = [
  'text',
  'number',
  'date',
  'boolean',
  'select',
  'relation',
  'list'
]

export const FIELD_KIND_LABELS: Record<NoteFieldKind, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Toggle',
  select: 'Choice',
  relation: 'Link',
  list: 'List'
}

export interface NoteFieldDef {
  /** The frontmatter key, exactly as it appears on disk. */
  name: string
  /** What the frontmatter panel calls it. Defaults to a prettified `name`. */
  label: string
  kind: NoteFieldKind
  required: boolean
  /** `select` only — the values the field is allowed to take. */
  options?: string[]
  /**
   * `select` only — a colour per value, by name from `OPTION_COLORS`.
   *
   * Kept beside `options` rather than replacing it with objects, because
   * `options` is what validation compares a note against: a colour is
   * presentation, and a note is never wrong because of one.
   */
  optionColors?: Record<string, string>
  /** `relation` only — the note type it points at, when it points at one. */
  relationTo?: string
  /**
   * Whether the field holds several values rather than one.
   *
   * Only meaningful on `relation`: `list` says it in its own name, and the
   * scalar kinds cannot. `participants` on a call is a relation *and* an
   * array, and without this the two facts could not both be recorded — which
   * showed up first in the generated skill file, where it taught the agent to
   * write a single wikilink into a field the schema declares as a list.
   */
  multiple?: boolean
}

export interface NoteTypeDef {
  id: string
  label: string
  icon: string
  color: string
  defaultFolder: string
  filenamePattern: string
  requiredSections: string[]
  fields: NoteFieldDef[]
  /** The body a new note of this type starts from, `{{variables}}` and all. */
  template: string
  /**
   * Who the type belongs to.
   *
   * `mindex` — one of the types the app ships. `user` — one you created.
   * This does not change when you edit a built-in type: a Mindex type with
   * your fields on it is still a Mindex type.
   */
  origin: 'mindex' | 'user'
  /**
   * Whether `.mindex/types/<id>.md` exists — that is, whether what you see is
   * your copy or the factory definition. Separate from `origin` on purpose:
   * a shipped type can be overridden, and a type you made is always your own
   * whether you have touched it since or not.
   */
  overridden: boolean
}

/** `estimated_cost` → `Estimated cost`, `jobTitle` → `Job title`. */
export function prettifyFieldName(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
  if (!spaced) return name
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

/**
 * Fields Mindex owns rather than the user: `type` is the discriminator the
 * whole registry keys off, `id` is generated, `tags` has its own editor
 * everywhere already. Showing them in the field list would invite edits that
 * cannot be honoured.
 */
export const RESERVED_FIELD_NAMES = new Set(['type', 'id', 'tags'])

/**
 * Whether a definition can be edited at all.
 *
 * `asset` and `untyped` are not conventions the user chose — one describes
 * binary files Mindex indexes itself, the other is the absence of a type.
 * Neither has a template or a schema worth editing.
 */
export function isEditableType(id: string): boolean {
  return id !== 'asset' && id !== 'untyped'
}

/**
 * The palette a choice value can wear, by name.
 *
 * Names rather than CSS classes because these are written to a file in the
 * vault: `blue` still means something if the styling changes, `text-blue-400`
 * does not. The renderer maps them.
 */
export const OPTION_COLORS = [
  'blue',
  'emerald',
  'amber',
  'purple',
  'cyan',
  'pink',
  'orange',
  'red'
] as const

export type OptionColor = (typeof OPTION_COLORS)[number]

/** The extension a note is written with when nothing else decides. */
export const NOTE_EXTENSION = '.md'

/**
 * The last dotted suffix of a filename, or `''` when it has none.
 *
 * Its own function rather than `path.extname` because this is shared code and
 * runs in the renderer too, where `node:path` is not available.
 */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot) : ''
}

/**
 * A note's path, guaranteed to carry an extension.
 *
 * A type's `filenamePattern` is free text — the built-in `asset` type ends in
 * `{{title}}` on purpose, and the Placement tab lets any type be edited into
 * the same shape. Nothing checked, so a note filed under such a type was
 * written with **no extension at all**: not markdown to the editor, not a note
 * to the indexer, and invisible in Finder as anything in particular.
 *
 * A name that already carries one is left alone, which is what keeps `asset`
 * working — an asset's extension comes from its title (`diagram.png`), not
 * from its pattern.
 *
 * The backstop, not the only guard: capture also refuses to file under a type
 * that does not produce markdown, and the type editor rejects a pattern with
 * no extension. This is here so that neither of those being missed can put a
 * file with no extension in somebody's vault.
 */
export function withNoteExtension(relPath: string): string {
  const name = relPath.slice(relPath.lastIndexOf('/') + 1)
  return extensionOf(name) ? relPath : relPath + NOTE_EXTENSION
}

/**
 * Whether a type's filename pattern always produces a markdown file.
 *
 * Asked of the *pattern*, not of a resolved name: a pattern ending in a
 * placeholder (`{{title}}`) leaves the extension to whatever the title happens
 * to carry, which is right for an imported asset and wrong for anything being
 * written as a note.
 */
export function producesMarkdown(filenamePattern: string): boolean {
  return extensionOf(filenamePattern).toLowerCase() === NOTE_EXTENSION
}
