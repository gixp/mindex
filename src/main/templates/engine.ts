import path from 'node:path'
import type { NoteTypeId, TemplateSpec } from '@shared/types'
import { fileExists, readText } from '@main/util/fs-helpers'
import { vaultTemplatesDir } from '@main/util/paths'
import { requireVault } from '@main/vault/state'
import { BUILTIN_TEMPLATES } from './builtins'
import { readVaultDef } from '@main/types/definitions'

const TYPE_FROM_TEMPLATE: Record<string, NoteTypeId> = {
  'project.md': 'project',
  'person.md': 'person',
  'organization.md': 'organization',
  'goal.md': 'goal',
  'payment.md': 'payment',
  'expense.md': 'expense',
  'call-transcript.md': 'call-transcript',
  'call-debrief.md': 'call-debrief',
  'knowledge.md': 'knowledge',
  'daily-note.md': 'daily-note',
  'claude-chat.md': 'claude-chat',
  'untyped.md': 'untyped'
}

export function listBuiltinTemplates(): TemplateSpec[] {
  return Object.entries(BUILTIN_TEMPLATES)
    .filter(([_, body]) => body.length > 0)
    .map(([type, body]) => ({
      id: `builtin:${type}`,
      label: type,
      type: type as NoteTypeId,
      body,
      variables: extractVars(body)
    }))
}

export async function listVaultTemplates(): Promise<TemplateSpec[]> {
  const vault = requireVault()
  const dir = vaultTemplatesDir(vault.root)
  const out: TemplateSpec[] = []
  try {
    const fs = await import('node:fs/promises')
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      // Mindex's own folder-context template, not a user-selectable one.
      if (entry.name === 'context-template.md') continue
      const body = await readText(path.join(dir, entry.name))
      const type = TYPE_FROM_TEMPLATE[entry.name] ?? 'untyped'
      out.push({
        id: `vault:${entry.name}`,
        label: entry.name.replace(/\.md$/, ''),
        type,
        body,
        variables: extractVars(body)
      })
    }
  } catch {}
  return out
}

export async function listAllTemplates(): Promise<TemplateSpec[]> {
  const builtin = listBuiltinTemplates()
  const vault = await listVaultTemplates()
  const seenTypes = new Set(vault.map((t) => t.type))
  return [...vault, ...builtin.filter((b) => !seenTypes.has(b.type))]
}

const VAR_RE = /\{\{(\w+)\}\}/g

function extractVars(body: string): string[] {
  const found = new Set<string>()
  for (const m of body.matchAll(VAR_RE)) {
    if (m[1]) found.add(m[1])
  }
  return [...found]
}

export function instantiate(template: string, vars: Record<string, string>): string {
  return template.replace(VAR_RE, (_full, name: string) => {
    return vars[name] ?? ''
  })
}

export async function getTemplateForType(type: NoteTypeId): Promise<string> {
  const vault = requireVault()
  // The type definition wins: the Template tab of the type editor writes
  // there, and a template you can edit but that never reaches a new note
  // would be worse than no editor at all.
  const def = await readVaultDef(vault.root, type)
  if (def && def.template.trim()) return def.template

  // Still honoured, and deliberately: `.mindex/templates/<type>.md` is what
  // existing vaults already use, and nothing migrates it for them.
  const userPath = path.join(vaultTemplatesDir(vault.root), `${type}.md`)
  if (await fileExists(userPath)) {
    return await readText(userPath)
  }
  return BUILTIN_TEMPLATES[type] ?? BUILTIN_TEMPLATES.untyped ?? ''
}
