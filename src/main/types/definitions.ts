import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { NoteTypeId } from '@shared/types'
import {
  prettifyFieldName,
  RESERVED_FIELD_NAMES,
  type NoteFieldDef,
  type NoteFieldKind,
  type NoteTypeDef
} from '@shared/note-types'
import { REGISTRY, setVaultTypeIds, type InternalTypeSpec, specOrUntyped } from './registry'
import { BUILTIN_TEMPLATES } from '@main/templates/builtins'
import { parseFrontmatter, serializeFrontmatter } from '@main/notes/frontmatter'
import { atomicWriteText } from '@main/claude/config/atomic'
import { vaultMetaDir, vaultTmpDir } from '@main/util/paths'
import { getVault, requireVault } from '@main/vault/state'
import { ensureDir, readText } from '@main/util/fs-helpers'

/**
 * Built-in definitions are *derived* from the Zod schemas rather than written
 * out a second time.
 *
 * The alternative was a hand-kept list of fields next to each schema, which
 * would be two descriptions of one thing — and the one nobody remembers to
 * update is the one the interface draws. Introspection costs a little care
 * here and cannot drift by construction.
 */

export function typesDir(vaultRoot: string): string {
  return path.join(vaultMetaDir(vaultRoot), 'types')
}

/** Peels `.optional()` / `.default()` off to reach the real type. */
function unwrap(node: unknown): { inner: unknown; optional: boolean } {
  let inner = node
  let optional = false
  for (;;) {
    const name = (inner as { _def?: { typeName?: string } })?._def?.typeName
    if (name !== 'ZodOptional' && name !== 'ZodDefault' && name !== 'ZodNullable') break
    optional = true
    inner = (inner as { _def: { innerType: unknown } })._def.innerType
  }
  return { inner, optional }
}

/**
 * Date fields are declared `z.string()` — YAML would otherwise hand back a
 * `Date` object and fail validation on every ordinary `deadline: 2026-01-01`.
 * So the schema cannot tell a date from any other string, and the name has to.
 */
function looksLikeDate(name: string): boolean {
  return /^(date|deadline|quarter)$/i.test(name) || /(_at|At|_date|Date)$/.test(name)
}

function kindOf(name: string, node: unknown, relations: readonly string[]): NoteFieldKind {
  if (relations.includes(name)) return 'relation'
  const typeName = (node as { _def?: { typeName?: string } })?._def?.typeName
  if (typeName === 'ZodEnum') return 'select'
  if (typeName === 'ZodNumber') return 'number'
  if (typeName === 'ZodBoolean') return 'boolean'
  if (typeName === 'ZodArray') return 'list'
  if (looksLikeDate(name)) return 'date'
  return 'text'
}

function optionsOf(node: unknown): string[] | undefined {
  const def = (node as { _def?: { typeName?: string; values?: unknown } })?._def
  if (def?.typeName !== 'ZodEnum' || !Array.isArray(def.values)) return undefined
  return def.values.filter((v): v is string => typeof v === 'string')
}

export function fieldsFromSpec(spec: InternalTypeSpec): NoteFieldDef[] {
  const schema = spec.schema
  const shape = (schema as z.ZodObject<z.ZodRawShape>)?.shape
  if (!shape || typeof shape !== 'object') return []

  const out: NoteFieldDef[] = []
  for (const [name, node] of Object.entries(shape)) {
    if (RESERVED_FIELD_NAMES.has(name)) continue
    const { inner, optional } = unwrap(node)
    const field: NoteFieldDef = {
      name,
      label: prettifyFieldName(name),
      kind: kindOf(name, inner, spec.relations),
      required: !optional
    }
    const options = optionsOf(inner)
    if (options) field.options = options
    if (field.kind === 'relation') {
      const target = relationTargetFor(name)
      if (target) field.relationTo = target
      // `relations` in the registry wins over the Zod type, so an array of
      // links reads as one relation. The arity is not lost, just recorded
      // beside the kind instead of inside it.
      if ((inner as { _def?: { typeName?: string } })?._def?.typeName === 'ZodArray') {
        field.multiple = true
      }
    }
    out.push(field)
  }
  return out
}

/**
 * A guess, and only a guess: `company` points at an organization, `project`
 * at a project. It is a starting value the user can correct, not a rule —
 * nothing in the schemas records where a relation leads.
 */
function relationTargetFor(name: string): string | null {
  if (name === 'company' || name === 'organization') return 'organization'
  if (name === 'project') return 'project'
  if (name === 'participants') return 'person'
  if (name === 'transcript') return 'call-transcript'
  return null
}

export function builtinDef(id: NoteTypeId): NoteTypeDef {
  const spec = specOrUntyped(id)
  return {
    id,
    label: spec.label,
    icon: spec.icon,
    color: spec.color,
    defaultFolder: spec.defaultFolder,
    filenamePattern: spec.filenamePattern,
    requiredSections: [...spec.requiredSections],
    fields: fieldsFromSpec(spec),
    template: BUILTIN_TEMPLATES[id] ?? '',
    origin: 'mindex',
    overridden: false
  }
}

export function listBuiltinDefs(): NoteTypeDef[] {
  return (Object.keys(REGISTRY) as NoteTypeId[]).map(builtinDef)
}

// ── the vault's own copy ────────────────────────────────────────────────────

const fieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  kind: z.enum(['text', 'number', 'date', 'boolean', 'select', 'relation', 'list']).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  optionColors: z.record(z.string()).optional(),
  relationTo: z.string().optional(),
  multiple: z.boolean().optional()
})

const fileSchema = z.object({
  label: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  defaultFolder: z.string().optional(),
  filenamePattern: z.string().optional(),
  requiredSections: z.array(z.string()).optional(),
  fields: z.array(fieldSchema).optional()
})

/**
 * Read the vault's override for `id`, layered over the built-in.
 *
 * Layered rather than replacing, so a file that only sets `defaultFolder`
 * keeps every field the built-in declares. A malformed file returns `null`
 * and the caller falls back to the factory definition — a typo in one type
 * must not take the type list down with it.
 */
export async function readVaultDef(vaultRoot: string, id: NoteTypeId): Promise<NoteTypeDef | null> {
  const file = path.join(typesDir(vaultRoot), `${id}.md`)
  let raw: string
  try {
    raw = await readText(file)
  } catch {
    return null
  }
  const { data, body } = parseFrontmatter(raw)
  const parsed = fileSchema.safeParse(data)
  if (!parsed.success) return null

  const base = builtinDef(id)
  const fields = parsed.data.fields
    ? parsed.data.fields.map((f) => {
        const field: NoteFieldDef = {
          name: f.name,
          label: f.label ?? prettifyFieldName(f.name),
          kind: f.kind ?? 'text',
          required: f.required ?? false
        }
        if (f.options) field.options = f.options
        if (f.optionColors) field.optionColors = f.optionColors
        if (f.relationTo) field.relationTo = f.relationTo
        return field
      })
    : base.fields

  return {
    ...base,
    label: parsed.data.label ?? base.label,
    icon: parsed.data.icon ?? base.icon,
    color: parsed.data.color ?? base.color,
    defaultFolder: parsed.data.defaultFolder ?? base.defaultFolder,
    filenamePattern: parsed.data.filenamePattern ?? base.filenamePattern,
    requiredSections: parsed.data.requiredSections ?? base.requiredSections,
    fields,
    template: body.trim() ? body : base.template,
    overridden: true
  }
}

/**
 * No vault is not an error here.
 *
 * The built-in definitions exist without one — only the overrides need a
 * vault to live in. Throwing meant the renderer, which loads this at startup
 * before any vault has opened, latched an error it never retried and showed
 * "no vault open" over a perfectly open vault.
 */
/** Ids of every `.mindex/types/<id>.md` in the vault, shipped or not. */
export async function vaultTypeIds(vaultRoot: string): Promise<string[]> {
  try {
    const names = await fs.readdir(typesDir(vaultRoot))
    return names.filter((n) => n.endsWith('.md')).map((n) => n.replace(/\.md$/, ''))
  } catch {
    return []
  }
}

export async function listTypeDefs(): Promise<NoteTypeDef[]> {
  const root = getVault()?.root ?? null
  const out: NoteTypeDef[] = []
  for (const id of Object.keys(REGISTRY) as NoteTypeId[]) {
    out.push((root ? await readVaultDef(root, id) : null) ?? builtinDef(id))
  }
  if (root) {
    // Types the vault invented, which have no factory entry to iterate over.
    const custom = (await vaultTypeIds(root)).filter((id) => !(id in REGISTRY))
    for (const id of custom) {
      const def = await readVaultDef(root, id)
      if (def) out.push({ ...def, origin: 'user' })
    }
    // Keep the synchronous detector in step: it decides the type of every note
    // the indexer reads, and it cannot go to disk to find out.
    setVaultTypeIds(custom)
  }
  return out
}

export async function getTypeDef(id: NoteTypeId): Promise<NoteTypeDef | null> {
  const root = getVault()?.root ?? null
  const fromVault = root ? await readVaultDef(root, id) : null
  if (fromVault) return REGISTRY[id] ? fromVault : { ...fromVault, origin: 'user' }
  return REGISTRY[id] ? builtinDef(id) : null
}

/**
 * Write the vault's copy.
 *
 * Everything is written, not just what differs from the built-in: a file that
 * records only the difference would silently change meaning the day a
 * built-in changes, which is the opposite of what someone who pinned a
 * convention wants.
 */
export async function saveTypeDef(def: NoteTypeDef): Promise<NoteTypeDef> {
  const vault = requireVault()
  const dir = typesDir(vault.root)
  await ensureDir(dir)

  const frontmatter: Record<string, unknown> = {
    label: def.label,
    icon: def.icon,
    color: def.color,
    defaultFolder: def.defaultFolder,
    filenamePattern: def.filenamePattern,
    requiredSections: def.requiredSections,
    fields: def.fields.map((f) => {
      const row: Record<string, unknown> = {
        name: f.name,
        label: f.label,
        kind: f.kind,
        required: f.required
      }
      if (f.options && f.options.length > 0) row.options = f.options
      if (f.optionColors && Object.keys(f.optionColors).length > 0) {
        row.optionColors = f.optionColors
      }
      if (f.relationTo) row.relationTo = f.relationTo
      return row
    })
  }

  const text = serializeFrontmatter(frontmatter, def.template)
  await atomicWriteText(path.join(dir, `${def.id}.md`), text, {
    tmpDir: vaultTmpDir(vault.root)
  })
  return { ...def, overridden: true }
}

/** Delete the vault's copy, so the built-in shows through again. */
/** A file-safe, stable id from whatever the user typed. */
export function slugifyTypeId(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'type'
}

/**
 * Define a new type in the vault.
 *
 * It gets a real id of its own rather than a copy of a shipped one, which is
 * what makes it detectable on a note and filterable afterwards. The starting
 * shape is deliberately almost empty — one `status` field would be a guess
 * about what this type is for, and the editor is right there.
 */
export async function createTypeDef(label: string): Promise<NoteTypeDef> {
  const root = getVault()?.root
  if (!root) throw new Error('No vault open')

  const id = slugifyTypeId(label)
  if (id in REGISTRY) throw new Error(`\u201c${id}\u201d is a built-in type`)
  if (await readVaultDef(root, id))
    throw new Error(`A type called \u201c${id}\u201d already exists`)

  const def: NoteTypeDef = {
    id,
    label: label.trim() || id,
    icon: 'symbol-parameter',
    color: 'slate',
    defaultFolder: '',
    filenamePattern: '{{title}}.md',
    requiredSections: [],
    fields: [],
    template: '',
    origin: 'user',
    overridden: true
  }
  await saveTypeDef(def)
  return def
}

/**
 * Delete a type the vault defined.
 *
 * Only a vault type: a shipped one has no file to remove, and "delete" for
 * those already exists under its truthful name, Restore default. Notes that
 * carry the id keep it — the file on disk is the user's, and silently
 * rewriting their frontmatter is not what deleting a definition means.
 */
export async function deleteTypeDef(id: NoteTypeId): Promise<void> {
  const root = getVault()?.root
  if (!root) throw new Error('No vault open')
  if (id in REGISTRY) throw new Error('Built-in types cannot be deleted, only reset')
  await fs.rm(path.join(typesDir(root), `${id}.md`), { force: true })
  setVaultTypeIds((await vaultTypeIds(root)).filter((x) => !(x in REGISTRY)))
}

export async function resetTypeDef(id: NoteTypeId): Promise<NoteTypeDef> {
  const vault = requireVault()
  await fs.rm(path.join(typesDir(vault.root), `${id}.md`), { force: true })
  return builtinDef(id)
}

/**
 * Validate a note against the vault's own definition of its type.
 *
 * Kept separate from `validateFrontmatter`, which checks the Zod schema: that
 * one is the factory rule and cannot know about a field somebody added this
 * afternoon. When a vault definition exists it is the one the user is looking
 * at in the editor, so it is the one that has to be enforced — otherwise the
 * Fields tab is decoration.
 *
 * Same contract as the Zod path, deliberately: issues are warnings the
 * frontmatter panel shows. Nothing here ever refuses a save.
 */
export function validateAgainstDef(
  def: NoteTypeDef,
  frontmatter: Record<string, unknown>
): { ok: boolean; issues: string[] } {
  const issues: string[] = []

  for (const field of def.fields) {
    const value = frontmatter[field.name]
    const missing = value === undefined || value === null || value === ''

    if (missing) {
      if (field.required) issues.push(`${field.name}: required`)
      continue
    }

    switch (field.kind) {
      case 'number':
        if (typeof value !== 'number') issues.push(`${field.name}: expected a number`)
        break
      case 'boolean':
        if (typeof value !== 'boolean') issues.push(`${field.name}: expected true or false`)
        break
      case 'list':
        if (!Array.isArray(value)) issues.push(`${field.name}: expected a list`)
        break
      case 'select': {
        const allowed = field.options ?? []
        // No declared values means the field is a free choice, not a broken
        // one — a half-configured type must not light up every note.
        if (allowed.length === 0) break
        const values = Array.isArray(value) ? value : [value]
        for (const v of values) {
          if (!allowed.includes(String(v))) {
            issues.push(`${field.name}: ${String(v)} is not one of ${allowed.join(', ')}`)
          }
        }
        break
      }
      case 'relation':
        // A single-valued relation given a list is the mistake worth catching;
        // a multi-valued one given a single link is ordinary YAML and fine.
        if (!field.multiple && Array.isArray(value)) {
          issues.push(`${field.name}: expected one link, not a list`)
        }
        break
      // `date` and `text` both arrive as strings, and a date that YAML has
      // already turned into a Date is normal rather than wrong.
      default:
        break
    }
  }

  return { ok: issues.length === 0, issues }
}
