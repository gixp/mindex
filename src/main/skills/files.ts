import fs from 'node:fs/promises'
import path from 'node:path'
import { skillRoots } from './scan'
import { getVault } from '@main/vault/state'
import { atomicWriteText } from '@main/claude/config/atomic'
import { isPathInside } from '@main/util/paths'
import { WriteConflictError } from '@main/util/result'
import type { SkillFile } from '@shared/skill-file'

/**
 * Reading and writing the files inside a skill folder.
 *
 * These live outside the vault — `~/.claude/skills/…` for the global ones —
 * so they cannot go through `readNote`/`writeNote`, which resolve everything
 * against the vault root and reject anything that escapes it. That guard is
 * right, and this is not a hole in it: the path is checked against the skill
 * roots instead, so the channel can reach skill folders and nothing else.
 */

/** Whether this path sits under one of the skill roots. */
export function isSkillPath(absPath: string): boolean {
  const resolved = path.resolve(absPath)
  return skillRoots(getVault()?.root ?? null).some((root) => isPathInside(resolved, root))
}

function assertInsideSkills(absPath: string): void {
  if (!isSkillPath(absPath)) throw new Error(`Not a skill file: ${absPath}`)
}

const MAX_BYTES = 2 * 1024 * 1024

export async function readSkillFile(absPath: string): Promise<SkillFile> {
  assertInsideSkills(absPath)
  const stat = await fs.stat(absPath)
  if (!stat.isFile()) throw new Error('Not a file')
  if (stat.size > MAX_BYTES) {
    return { path: absPath, content: '', mtime: stat.mtimeMs, binary: true }
  }
  const buf = await fs.readFile(absPath)
  // A NUL byte is the cheap, reliable tell for "this is not text". Skill
  // folders hold scripts and the odd image, and handing an image to a text
  // editor produces a screen of replacement characters that saves back as
  // a destroyed file.
  const binary = buf.includes(0)
  return {
    path: absPath,
    content: binary ? '' : buf.toString('utf8'),
    mtime: stat.mtimeMs,
    binary
  }
}

/**
 * Write, refusing when the file changed underneath.
 *
 * Worth the check here more than anywhere else in the app: these files belong
 * to a CLI that rewrites them on its own schedule, so "changed since you
 * opened it" is an ordinary event rather than a rare one.
 */
export async function writeSkillFile(
  absPath: string,
  content: string,
  expectedMtime?: number
): Promise<{ mtime: number }> {
  assertInsideSkills(absPath)
  if (typeof expectedMtime === 'number') {
    const stat = await fs.stat(absPath).catch(() => null)
    if (stat && Math.abs(stat.mtimeMs - expectedMtime) > 1) {
      throw new WriteConflictError(expectedMtime, stat.mtimeMs)
    }
  }
  await atomicWriteText(absPath, content)
  const stat = await fs.stat(absPath)
  return { mtime: stat.mtimeMs }
}
