/** Skill folders and the files inside them. */

import type { ProviderId } from './engine'

/**
 * One skill folder found on disk (`<root>/skills/<name>/SKILL.md`) — global
 * under a provider's home config dir (`~/.claude`, `~/.codex`, `~/.gemini`),
 * or project-scoped under the vault root's own `.claude`/`.codex`/`.gemini`.
 * Raw, one row per (provider, scope, name) — the renderer merges rows that
 * share a name across providers into a single listing.
 */
/** One entry inside a skill folder. Directories carry their own children. */
export interface SkillFileNode {
  name: string
  isDir: boolean
  /** Absolute path, so a nested file can be opened without rebuilding it. */
  path: string
  /** Present on directories. Empty array means an empty folder, not unread. */
  children?: SkillFileNode[]
}

export interface SkillEntry {
  scope: 'project' | 'global'
  provider: ProviderId
  /** From SKILL.md frontmatter `name:`, falling back to the folder name. */
  name: string
  description?: string
  /** Absolute path to the skill's own folder. */
  path: string
  /**
   * The whole folder, nested. Skills routinely ship scripts and references in
   * subdirectories, and a flat list of top-level names could neither show nor
   * open them.
   */
  files: SkillFileNode[]
  /**
   * Written by Mindex rather than by the user.
   *
   * True when the SKILL.md frontmatter says `generator: mindex`. Such a skill
   * describes the vault, not a provider, so the interface shows it with a
   * neutral mark instead of a CLI's badge — and regenerating it is safe, which
   * is the same flag `skills/generate.ts` checks before overwriting.
   */
  generated?: boolean
}
