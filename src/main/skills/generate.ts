import fs from 'node:fs/promises'
import path from 'node:path'
import type { NoteFieldDef, NoteTypeDef } from '@shared/note-types'
import { isEditableType } from '@shared/note-types'
import type { ProviderId } from '@shared/types'
import { parseFrontmatter } from '@main/notes/frontmatter'
import { atomicWriteText } from '@main/claude/config/atomic'

/**
 * The vault's note types, written out as a skill the CLI can read.
 *
 * Mindex already knows what a `project` or a `payment` is — the fields, the
 * enum values, the folder, the filename pattern. The agent does not: it opens
 * a neighbouring file and copies whatever frontmatter it happens to find,
 * which is how a vault ends up with `status: active` beside `status: ACTIVE`.
 * This is that knowledge in the one place a CLI looks for conventions.
 *
 * Generated from `listTypeDefs()`, so a type the user edited in the type
 * editor is what the agent is told about — not the factory definition.
 */

export const TYPES_SKILL_NAME = 'mindex-note-types'

/** The frontmatter key that marks the file as ours to overwrite. */
const GENERATOR_KEY = 'generator'
const GENERATOR_VALUE = 'mindex'

export function typesSkillDir(vaultRoot: string, provider: ProviderId): string {
  return path.join(vaultRoot, `.${provider}`, 'skills', TYPES_SKILL_NAME)
}

export function typesSkillFile(vaultRoot: string, provider: ProviderId): string {
  return path.join(typesSkillDir(vaultRoot, provider), 'SKILL.md')
}

function fieldTypeCell(field: NoteFieldDef): string {
  switch (field.kind) {
    case 'select':
      return field.options?.length ? field.options.map((o) => `\`${o}\``).join(' \\| ') : 'choice'
    case 'relation': {
      const target = field.relationTo ? `link → \`${field.relationTo}\`` : 'link'
      return field.multiple ? `list of ${target}` : target
    }
    case 'list':
      return 'list of strings'
    default:
      return field.kind
  }
}

/**
 * A placeholder for the example block — shape, not content.
 *
 * Text fields get an empty string rather than the word `text`, which reads as
 * something to fill in instead of something to copy. That distinction matters:
 * the example is the part an agent is most likely to lift verbatim.
 */
function exampleValue(field: NoteFieldDef): string {
  switch (field.kind) {
    case 'select':
      return field.options?.[0] ?? '""'
    case 'number':
      return '0'
    case 'boolean':
      return 'false'
    case 'date':
      return '2026-01-31'
    case 'relation': {
      const one = `"[[Some ${field.relationTo ?? 'note'}]]"`
      return field.multiple ? `[${one}, ${one}]` : one
    }
    case 'list':
      return '[]'
    default:
      return '""'
  }
}

function renderType(def: NoteTypeDef): string {
  const lines: string[] = []
  lines.push(`### ${def.label} — \`${def.id}\``)
  lines.push('')
  lines.push(`- **Folder:** \`${def.defaultFolder || '(vault root)'}\``)
  lines.push(`- **Filename:** \`${def.filenamePattern}\``)
  if (def.requiredSections.length > 0) {
    lines.push(`- **Required sections:** ${def.requiredSections.map((s) => `\`${s}\``).join(', ')}`)
  }
  lines.push('')

  const fields = def.fields
  if (fields.length > 0) {
    lines.push('| Field | Value | Required |')
    lines.push('| --- | --- | --- |')
    for (const f of fields) {
      lines.push(`| \`${f.name}\` | ${fieldTypeCell(f)} | ${f.required ? 'yes' : 'no'} |`)
    }
    lines.push('')
  }

  // Required fields first, then enough of the rest to show the shape. A full
  // dump of every optional field would read as "fill all of these in".
  const shown = [...fields.filter((f) => f.required), ...fields.filter((f) => !f.required)].slice(
    0,
    8
  )
  lines.push('```yaml')
  lines.push('---')
  lines.push(`type: ${def.id}`)
  for (const f of shown) lines.push(`${f.name}: ${exampleValue(f)}`)
  lines.push('---')
  lines.push('```')
  lines.push('')
  return lines.join('\n')
}

const SEARCH_SECTION = `## Finding notes

This vault exposes an MCP server called \`mindex\`. Prefer it over \`Grep\` — it
searches a live full-text index of every note with titles and tags weighted,
and it filters on frontmatter directly, which grep cannot do at all.

- \`mcp__mindex__search\` — ranked full-text results with a snippet each.
  Use for "where did I write about X".
- \`mcp__mindex__query\` — filter on frontmatter fields. Use for
  "which notes *are* X".
- \`mcp__mindex__backlinks\` — every note linking to a given one.

Query syntax, for \`mcp__mindex__query\`:

| Expression | Meaning |
| --- | --- |
| \`type:project\` | field equals a value |
| \`status:ACTIVE,PLANNING\` | equals any of |
| \`status:!=DONE\` | equals none of |
| \`participants:&Ann,Bob\` | contains all of |
| \`company:~acm\` | contains the text |
| \`deadline:*\` / \`deadline:!*\` | has a value / has no value |
| \`budget:"12 000"\` | quotes protect spaces and commas |

Terms are combined with AND. Link fields match however the target is written —
\`company:Acme\`, \`company:[[Acme]]\` and \`company:Organizations/Acme\` all
find the same note.
`

export interface RenderOptions {
  /** Whether the search tools are actually attached for this provider. */
  search: boolean
}

export function renderTypesSkill(defs: NoteTypeDef[], opts: RenderOptions): string {
  const types = defs.filter((d) => isEditableType(d.id))
  const relationFields = new Map<string, string[]>()
  for (const def of types) {
    const names = def.fields.filter((f) => f.kind === 'relation').map((f) => f.name)
    if (names.length > 0) relationFields.set(def.id, names)
  }

  const head = [
    '---',
    `name: ${TYPES_SKILL_NAME}`,
    'description: The note types, frontmatter fields and folder conventions of this Mindex vault. Read it before creating or editing a note so the note matches the schema the app validates against.',
    `${GENERATOR_KEY}: ${GENERATOR_VALUE}`,
    '---',
    '',
    '# Note types in this vault',
    '',
    'This vault is managed by Mindex. Notes are plain markdown with YAML',
    'frontmatter, and the `type:` key selects which schema a note follows.',
    'Mindex validates frontmatter against these definitions and shows the',
    'result in the note’s Properties panel, so a value outside the list',
    'below is not merely untidy — the user sees it flagged.',
    '',
    'Remove the `generator: mindex` line from this file’s frontmatter to take',
    'ownership of it; Mindex will stop regenerating it.',
    '',
    '## Rules',
    '',
    '1. A typed note carries `type: <id>` as its first frontmatter key.',
    '2. Put a new note in that type’s folder, named by its filename pattern.',
    '   `{{title}}` is the note title, `{{date}}` is `YYYY-MM-DD`.',
    '3. Choice fields take one of the listed values **exactly**, case and all.',
    '   Most are uppercase (`ACTIVE`); a few are not (`team`). Copy the value',
    '   as written below rather than normalising it.',
    '4. Link fields point at another note. Write them as `[[Note Title]]`.',
    '   Mindex rewrites those on rename; a bare string is not rewritten.',
    '5. Reproduce the required sections as `##` headings. Leave one empty',
    '   rather than dropping it — Mindex’s own generators expect them.',
    '6. A field not listed here is kept as written and simply not validated.',
    '   Do not invent fields to stand in for ones that exist.',
    ''
  ].join('\n')

  const body = ['## Types', '', ...types.map(renderType)].join('\n')

  return opts.search ? `${head}\n${body}\n${SEARCH_SECTION}` : `${head}\n${body}`
}

/**
 * Whether this file is one Mindex may rewrite.
 *
 * Absent file — yes. Present with `generator: mindex` — yes. Present without
 * it — no: skill files became editable inside the app, and silently
 * overwriting what someone typed there would be the worst possible answer to
 * that. Dropping the line is how you take the file over.
 */
async function mayWrite(file: string): Promise<boolean> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT'
  }
  const { data } = parseFrontmatter(raw)
  return data[GENERATOR_KEY] === GENERATOR_VALUE
}

/** Remove our generated skill, leaving a user-owned file of the same name alone. */
export async function removeTypesSkill(vaultRoot: string, provider: ProviderId): Promise<boolean> {
  const file = typesSkillFile(vaultRoot, provider)
  if (!(await mayWrite(file))) return false
  await fs.rm(typesSkillDir(vaultRoot, provider), { recursive: true, force: true })
  return true
}

/**
 * Write the skill for `provider`, and clear ours out of the other providers'
 * folders — the same shape as `syncContextFilenames`, and for the same reason:
 * a stale copy under the CLI you stopped using describes a vault that may have
 * moved on, and nothing would ever correct it.
 */
export async function syncTypesSkill(
  vaultRoot: string,
  provider: ProviderId,
  defs: NoteTypeDef[],
  others: ProviderId[]
): Promise<boolean> {
  for (const other of others) {
    if (other !== provider) await removeTypesSkill(vaultRoot, other).catch(() => {})
  }

  const file = typesSkillFile(vaultRoot, provider)
  if (!(await mayWrite(file))) return false

  // Only Claude gets the search section: it is the one CLI whose MCP servers
  // can be attached per invocation (`--mcp-config`), so it is the one where
  // those tools are actually there. Telling Gemini about a tool it was never
  // given is worse than telling it nothing.
  const content = renderTypesSkill(defs, { search: provider === 'claude' })

  // Unchanged content must not be rewritten: this runs on every vault open and
  // on every type edit, and a no-op write would still bump mtime, which the
  // history feature and git both treat as an event.
  try {
    if ((await fs.readFile(file, 'utf8')) === content) return true
  } catch {}

  await atomicWriteText(file, content)
  return true
}
