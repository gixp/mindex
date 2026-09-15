import fs from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import type { ProviderId } from '@shared/types'
import { atomicWriteText } from '@main/claude/config/atomic'
import { isSkillPath } from './files'
import { skillRoots } from './scan'
import { getVault } from '@main/vault/state'

/**
 * Creating, renaming and deleting skills, and the files inside them.
 *
 * Every path is checked against `isSkillPath` before anything happens. That
 * guard is the same one `files.ts` uses for reads and writes, and it matters
 * more here: these operations delete directories, and a skill folder lives
 * outside the vault, where `resolveInVault` offers no protection at all.
 */

function assertInsideSkills(absPath: string): void {
  if (!isSkillPath(absPath)) throw new Error(`Not a skill path: ${absPath}`)
}

/** A folder name that is safe on every platform and still recognisable. */
export function slugifySkillName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'skill'
}

const TEMPLATE = (name: string, description: string): string =>
  [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    `# ${name}`,
    '',
    'Describe when this skill applies and what the agent should do.',
    '',
    '## Steps',
    '',
    '1. ',
    ''
  ].join('\n')

export interface CreateSkillInput {
  name: string
  description?: string
  scope: 'project' | 'global'
  provider: ProviderId
}

/**
 * Make a new skill folder with a starter `SKILL.md`.
 *
 * The description is not decoration: it is the line the CLI reads to decide
 * whether to load the skill at all, so a blank one is filled with a prompt to
 * write it rather than left empty.
 */
export async function createSkill(input: CreateSkillInput): Promise<{ path: string }> {
  const name = input.name.trim()
  if (!name) throw new Error('A skill needs a name')

  const home = (await import('node:os')).homedir()
  const base =
    input.scope === 'global'
      ? path.join(home, `.${input.provider}`, 'skills')
      : path.join(requireVaultRoot(), `.${input.provider}`, 'skills')

  const dir = path.join(base, slugifySkillName(name))
  assertInsideSkills(path.join(dir, 'SKILL.md'))

  // Never silently write into an existing skill — that would be an edit
  // disguised as a creation.
  if (await exists(dir)) throw new Error(`A skill folder already exists: ${dir}`)

  await fs.mkdir(dir, { recursive: true })
  await atomicWriteText(
    path.join(dir, 'SKILL.md'),
    TEMPLATE(name, input.description?.trim() || 'Say when the agent should use this skill.')
  )
  return { path: dir }
}

function requireVaultRoot(): string {
  const v = getVault()
  if (!v) throw new Error('No vault open')
  return v.root
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Delete a skill folder, or one file inside one. */
export async function deleteSkillPath(absPath: string): Promise<void> {
  assertInsideSkills(absPath)
  // A skill root itself is not a skill. Deleting `~/.claude/skills` because a
  // caller passed the wrong path is exactly the accident this prevents.
  const roots = skillRoots(getVault()?.root ?? null).map((r) => path.resolve(r))
  if (roots.includes(path.resolve(absPath))) throw new Error('Refusing to delete a skills root')
  await fs.rm(absPath, { recursive: true, force: true })
}

/** Rename a skill folder or a file inside one, keeping it in the same parent. */
export async function renameSkillPath(
  absPath: string,
  nextName: string
): Promise<{ path: string }> {
  assertInsideSkills(absPath)
  const clean = nextName.trim()
  if (!clean || clean.includes('/') || clean.includes('\\') || clean === '..') {
    throw new Error('Invalid name')
  }
  const target = path.join(path.dirname(absPath), clean)
  assertInsideSkills(target)
  if (await exists(target)) throw new Error(`Already exists: ${clean}`)
  await fs.rename(absPath, target)
  return { path: target }
}

/** Add an empty file or folder inside a skill. */
export async function createSkillEntry(
  parentDir: string,
  name: string,
  kind: 'file' | 'folder'
): Promise<{ path: string }> {
  const clean = name.trim()
  if (!clean || clean.includes('/') || clean.includes('\\')) throw new Error('Invalid name')
  const target = path.join(parentDir, clean)
  assertInsideSkills(target)
  if (await exists(target)) throw new Error(`Already exists: ${clean}`)
  if (kind === 'folder') await fs.mkdir(target, { recursive: true })
  else await atomicWriteText(target, '')
  return { path: target }
}

/** Show the folder in the OS file manager. */
export async function revealSkillPath(absPath: string): Promise<void> {
  assertInsideSkills(absPath)
  shell.showItemInFolder(absPath)
}
