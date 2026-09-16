import os from 'node:os'
import { contextFilename } from '@shared/context-filename'
import type { ProviderId } from '@shared/types'
import path from 'node:path'
import crypto from 'node:crypto'
import { app } from 'electron'

export function appConfigDir(): string {
  return path.join(app.getPath('userData'), 'mindex')
}

export function appConfigFile(name: string): string {
  return path.join(appConfigDir(), name)
}

/**
 * Whether `child` sits somewhere under `parent`.
 *
 * The segment check matters and used to be a plain `startsWith('..')`, which
 * is subtly wrong: after `path.relative`, a leading `..` means "climb out",
 * but a *name* that merely begins with two dots does not. So a note called
 * `..draft.md`, or a folder called `..archive`, sitting perfectly legally at
 * the top of the vault, was reported as outside it — and every read, write,
 * rename and delete of it was refused with "path escapes vault". Nested ones
 * escaped the bug by accident, because their relative path starts with the
 * containing folder's name instead.
 *
 * The old form erred toward refusing, so this was a correctness bug rather
 * than a hole; the containment guarantee itself is unchanged, since
 * `path.relative` only ever emits `..` as a whole segment.
 */
export function isPathInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child)
  if (rel === '' || path.isAbsolute(rel)) return false
  return rel.split(path.sep)[0] !== '..'
}

export function vaultMetaDir(vaultRoot: string): string {
  return path.join(vaultRoot, '.mindex')
}

/**
 * Staging area for atomic writes into the vault.
 *
 * Lives under `.mindex/` on purpose: that path is already excluded by the
 * file watcher (`vault/watcher.ts`) and by the vault walkers
 * (`fs-ops.IGNORED_DIRS`), so a temp file here is invisible to the indexer,
 * the folder-context engine and the history feature. It is also inside the
 * vault root, so renaming out of it stays on one filesystem.
 */
export function vaultTmpDir(vaultRoot: string): string {
  return path.join(vaultMetaDir(vaultRoot), 'tmp')
}

export function vaultCacheFile(vaultRoot: string): string {
  return path.join(vaultMetaDir(vaultRoot), 'cache.json')
}

export function vaultSettingsFile(vaultRoot: string): string {
  return path.join(vaultMetaDir(vaultRoot), 'settings.json')
}

export function vaultPolicyFile(vaultRoot: string): string {
  return path.join(vaultMetaDir(vaultRoot), 'policy.json')
}

export function vaultTemplatesDir(vaultRoot: string): string {
  return path.join(vaultMetaDir(vaultRoot), 'templates')
}

/**
 * The user-editable template Mindex's own folder-context generator reads —
 * never seen by a CLI, so unlike the real context file its name has no
 * compatibility reason to track the active provider. `.mindex/templates/` is
 * also in the rename walk's skip list (it's Mindex's own metadata, not a CLI
 * config dir, but skipped all the same), so a provider-dependent name here
 * would silently orphan a customized template on every provider switch —
 * `readContextTemplate` would look under the new name, find nothing, and fall
 * back to the built-in default without any signal that the user's version
 * still exists on disk under the old one.
 */
export function contextTemplateFile(vaultRoot: string): string {
  return path.join(vaultTemplatesDir(vaultRoot), 'context-template.md')
}

/**
 * The real per-folder context file, named for whichever provider is active.
 *
 * `provider` is a required argument, not read here from settings: this module
 * is imported from `settings/app-settings.ts` for its own path builders
 * (`appConfigDir`/`appConfigFile`), so reading settings back from here would
 * create an import cycle. Callers resolve the provider themselves — most
 * already have it in hand from `engineChoice()`; the few sync callbacks that
 * don't can import `currentProvider()` from `providers/engine-choice.ts`
 * directly, which is not part of this cycle.
 */
export function contextFile(vaultRoot: string, provider: ProviderId): string {
  return path.join(vaultRoot, contextFilename(provider))
}

export function chatDir(vaultRoot: string): string {
  return path.join(vaultMetaDir(vaultRoot), 'chat')
}

/**
 * Where chat sessions used to live, before the module stopped being called
 * "voice". Existing vaults have real conversations in here, so the directory
 * is migrated on open rather than abandoned — see `migrateChatDir`.
 */
export function legacyVoiceDir(vaultRoot: string): string {
  return path.join(vaultMetaDir(vaultRoot), 'voice')
}

export function chatSessionFile(vaultRoot: string, sessionId: string): string {
  return path.join(chatDir(vaultRoot), `${sessionId}.json`)
}

export function suggestionsDir(vaultRoot: string): string {
  return path.join(vaultMetaDir(vaultRoot), 'suggestions')
}

export function suggestionsFile(vaultRoot: string): string {
  return path.join(suggestionsDir(vaultRoot), 'suggestions.json')
}

// Dismissals are kept apart from the suggestions themselves: suggestion
// objects get pruned, but "the user said no to this" has to outlive them or
// every scan re-proposes what was already rejected.
export function suggestionsDismissedFile(vaultRoot: string): string {
  return path.join(suggestionsDir(vaultRoot), 'dismissed.json')
}

export function suggestionsRunsFile(vaultRoot: string): string {
  return path.join(suggestionsDir(vaultRoot), 'runs.json')
}

export function claudeProjectsRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects')
}

export function flattenedProjectDir(absPath: string): string {
  return absPath.split(path.sep).join('-')
}

export function commentsDir(vaultRoot: string): string {
  return path.join(vaultMetaDir(vaultRoot), 'comments')
}

/**
 * One file per note, named by a hash of its relative path — the same scheme
 * `historyLogFile` uses, and for the same reason: a note's path can contain
 * anything a filesystem allows, including separators.
 */
export function commentsFile(vaultRoot: string, relPath: string): string {
  const key = crypto.createHash('sha1').update(relPath).digest('hex')
  return path.join(commentsDir(vaultRoot), `${key}.json`)
}

/**
 * Undecided rewrites for one note, keyed the same way comments are.
 *
 * Named `rewrites` and not `suggestions`: that directory already belongs to
 * the context engine's own suggestions, which are a different thing entirely
 * and vault-wide rather than per note.
 */
export function rewritesDir(vaultRoot: string): string {
  return path.join(vaultMetaDir(vaultRoot), 'rewrites')
}

export function rewritesFile(vaultRoot: string, relPath: string): string {
  const key = crypto.createHash('sha1').update(relPath).digest('hex')
  return path.join(rewritesDir(vaultRoot), `${key}.json`)
}

export function historyDir(vaultRoot: string): string {
  return path.join(vaultMetaDir(vaultRoot), 'history')
}

export function historyBlobsDir(vaultRoot: string): string {
  return path.join(historyDir(vaultRoot), 'blobs')
}

export function historyFilesDir(vaultRoot: string): string {
  return path.join(historyDir(vaultRoot), 'files')
}

export function historyLogFile(vaultRoot: string, relPath: string): string {
  const key = crypto.createHash('sha1').update(relPath).digest('hex')
  return path.join(historyFilesDir(vaultRoot), `${key}.jsonl`)
}

export function historyBlobFile(vaultRoot: string, sha256: string): string {
  return path.join(historyBlobsDir(vaultRoot), `${sha256}.gz`)
}

export function toRelative(absPath: string, vaultRoot: string): string {
  return path.relative(vaultRoot, absPath).split(path.sep).join('/')
}

export function fromRelative(relPath: string, vaultRoot: string): string {
  return path.join(vaultRoot, relPath.split('/').join(path.sep))
}
