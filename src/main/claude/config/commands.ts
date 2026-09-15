import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import type { ConfigScope, SlashCommandEntry } from '@shared/slash-commands'
import { getVault } from '@main/vault/state'
import { globalCommandsDir, projectCommandsDir } from './paths'

async function readCommandsDir(
  dir: string,
  scope: ConfigScope,
  prefix = ''
): Promise<SlashCommandEntry[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as import('node:fs').Dirent[]
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    return []
  }
  const out: SlashCommandEntry[] = []
  for (const ent of entries) {
    if (ent.isDirectory()) {
      out.push(...(await readCommandsDir(path.join(dir, ent.name), scope, `${prefix}${ent.name}:`)))
      continue
    }
    if (!ent.isFile() || !ent.name.endsWith('.md')) continue
    const base = ent.name.replace(/\.md$/, '')
    let description = ''
    try {
      const raw = await fs.readFile(path.join(dir, ent.name), 'utf8')
      const fm = (matter(raw).data ?? {}) as Record<string, unknown>
      if (typeof fm.description === 'string') description = fm.description
    } catch {}
    out.push({ name: `${prefix}${base}`, description, scope })
  }
  return out
}

export async function listSlashCommands(): Promise<SlashCommandEntry[]> {
  const v = getVault()
  const project = v ? await readCommandsDir(projectCommandsDir(v.root), 'project') : []
  const user = await readCommandsDir(globalCommandsDir(), 'global')
  const seen = new Set(project.map((c) => c.name))
  return [...project, ...user.filter((c) => !seen.has(c.name))]
}
