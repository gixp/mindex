import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { ProviderId, SkillEntry, SkillFileNode } from '@shared/types'
import { parseFrontmatter } from '@main/notes/frontmatter'

// A provider's config dir name matches its ProviderId exactly (`.claude`,
// `.codex`, `.gemini`), both under the home directory and — mirroring that
// same shape — at the vault root for project-scoped skills.
const PROVIDERS: ProviderId[] = ['claude', 'codex', 'gemini']

/**
 * How deep a skill folder is read.
 *
 * Skills keep scripts and references in subdirectories, so one level was never
 * enough to show — let alone open — what is actually in them. Bounded because
 * this runs on every scan and a symlink loop or a stray `node_modules` inside
 * a skill should cost a few directory reads, not a hang.
 */
const MAX_DEPTH = 6
const SKIP_DIRS = new Set(['node_modules', '__pycache__', '.git'])

async function listTree(dir: string, depth = 0): Promise<SkillFileNode[]> {
  if (depth >= MAX_DEPTH) return []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: SkillFileNode[] = []
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
    const abs = path.join(dir, e.name)
    const isDir = e.isDirectory()
    out.push({
      name: e.name,
      isDir,
      path: abs,
      ...(isDir ? { children: await listTree(abs, depth + 1) } : {})
    })
  }
  // Folders first, then files, each alphabetical — the order the file tree
  // uses, so the two panes read the same way.
  return out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
}

async function scanSkillsDir(
  dir: string,
  scope: 'project' | 'global',
  provider: ProviderId
): Promise<SkillEntry[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: SkillEntry[] = []
  for (const entry of entries) {
    // Dot-prefixed folders (e.g. Codex's `.system`) are the CLI's own
    // bundled skills, not the user's — not what "your skills" means here.
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const skillDir = path.join(dir, entry.name)
    let raw: string
    try {
      raw = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf8')
    } catch {
      continue
    }
    const { data } = parseFrontmatter(raw)
    const name =
      typeof data.name === 'string' && data.name.trim().length > 0 ? data.name.trim() : entry.name
    const description = typeof data.description === 'string' ? data.description : undefined
    const files = await listTree(skillDir)
    // The same marker `skills/generate.ts` writes and checks before it
    // overwrites: this skill is Mindex's, not the user's.
    const generated = data.generator === 'mindex'
    out.push({ scope, provider, name, description, path: skillDir, files, generated })
  }
  return out
}

/**
 * Every directory a skill can legitimately live in.
 *
 * Exported because it is also the write boundary: editing a skill file means
 * writing outside the vault, and "outside the vault" is not a permission
 * anything should have. A path is allowed only if it sits under one of these,
 * which is the same shape of guard `resolveInVault` applies to notes.
 */
export function skillRoots(vaultRoot: string | null): string[] {
  const home = os.homedir()
  const roots: string[] = []
  for (const provider of PROVIDERS) {
    roots.push(path.join(home, `.${provider}`, 'skills'))
    if (vaultRoot) roots.push(path.join(vaultRoot, `.${provider}`, 'skills'))
  }
  return roots
}

/** Scans every provider's global (`~/.<provider>/skills`) and, if a vault is
 *  open, project-scoped (`<vaultRoot>/.<provider>/skills`) skill folders. */
export async function listSkills(vaultRoot: string | null): Promise<SkillEntry[]> {
  const home = os.homedir()
  const jobs = PROVIDERS.flatMap((provider) => {
    const list = [scanSkillsDir(path.join(home, `.${provider}`, 'skills'), 'global', provider)]
    if (vaultRoot) {
      list.push(scanSkillsDir(path.join(vaultRoot, `.${provider}`, 'skills'), 'project', provider))
    }
    return list
  })
  const results = await Promise.all(jobs)
  return results.flat()
}
