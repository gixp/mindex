import { promises as fsp } from 'node:fs'
import { contextFilename } from '@shared/context-filename'
import { engineChoice } from '@main/providers/engine-choice'
import { isContextEngineEnabled } from '@main/folderContext/runner'
import {
  engineScheduler,
  logEngine,
  noteAuthOrMissingFailure,
  resetAuthOrMissingCounter,
  runAgentJob,
  type AgentJobErrorReason
} from '@main/agent-engine'
import { buildFolderContextPrompt } from '@main/folderContext/prompt'
import { getFolderContextSnapshot } from '@main/folderContext/aggregator'
import { contextFile } from '@main/util/paths'
import { readContextTemplate } from './template'

export const FEATURE = 'living-index'
const SCOPE_KEY = 'living-index' // singleton scope per vault

// More conservative than folder-context's own auto timings: a wave of
// several folders completing close together should collapse into one root
// rebuild, not one per folder.
const AUTO_DEBOUNCE_MS = 180_000
const AUTO_COOLDOWN_MS = 900_000

export function rescanLivingIndex(vaultRoot: string): void {
  engineScheduler.enqueue(
    {
      scope: SCOPE_KEY,
      feature: FEATURE,
      run: (signal) => runLivingIndexJob(vaultRoot, signal)
    },
    { immediate: true }
  )
}

/** Arms an automatic root-context rebuild after a folder's context updated.
 *  Re-debounces on every call, so several folders finishing in a burst still
 *  produce one rebuild — no vault-quiet wait needed here, since a folder-
 *  context job only reaches "success" after already passing its own. */
export function armAutoLivingIndexRun(vaultRoot: string): void {
  engineScheduler.enqueue(
    {
      scope: SCOPE_KEY,
      feature: FEATURE,
      run: (signal) => runLivingIndexJob(vaultRoot, signal)
    },
    { debounceMs: AUTO_DEBOUNCE_MS, cooldownMs: AUTO_COOLDOWN_MS }
  )
}

async function runLivingIndexJob(vaultRoot: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  // Same master switch as folder-context, and the same single choke point:
  // both `rescanLivingIndex` (manual) and `armAutoLivingIndexRun` (automatic)
  // funnel through this one function.
  if (!isContextEngineEnabled()) return

  // Resolved first, same reasoning as the per-folder job: the filename this
  // reads and writes follows whichever CLI is about to run it.
  const engine = await engineChoice()
  const FILENAME = contextFilename(engine.provider)
  const contextPath = contextFile(vaultRoot, engine.provider)

  let existing: string | null = null
  try {
    existing = await fsp.readFile(contextPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  const [template, entries, snapshot] = await Promise.all([
    readContextTemplate(vaultRoot),
    listTopLevel(vaultRoot, FILENAME),
    getFolderContextSnapshot(vaultRoot)
  ])

  const childPurposes = snapshot.files
    .filter((f) => !!f.folderRel)
    .map((f) => ({
      folderRel: f.folderRel,
      purpose: firstLineOfPurpose(f.purpose ?? '')
    }))

  const prompt = buildFolderContextPrompt({
    scope: 'root',
    contextFilename: FILENAME,
    folderAbs: vaultRoot,
    folderRel: '',
    existingContext: existing,
    fileList: entries,
    template,
    childPurposes
  })

  const result = await runAgentJob({
    provider: engine.provider,
    model: engine.model,
    cwd: vaultRoot,
    prompt,
    allowedTools: ['Read', 'Write', 'Glob', 'Grep'],
    outputFormat: 'stream-json',
    permissionMode: 'acceptEdits',
    signal,
    onEvent: (e) => {
      if (e.kind === 'tool_use') {
        const inputPreview =
          typeof e.input === 'object' && e.input !== null
            ? JSON.stringify(e.input).slice(0, 100)
            : ''
        logEngine('info', `${e.name}(${inputPreview})`, {
          feature: FEATURE,
          scope: SCOPE_KEY
        })
      } else if (e.kind === 'tool_result' && e.isError) {
        logEngine('warn', `tool_result error: ${e.preview ?? ''}`, {
          feature: FEATURE,
          scope: SCOPE_KEY
        })
      }
    }
  })

  if (!result.ok) {
    if (result.errorReason === 'cli_missing' || result.errorReason === 'auth') {
      noteAuthOrMissingFailure(engine.provider)
    }
    throwFromResult(result.errorReason, result.errorMessage)
    return
  }
  resetAuthOrMissingCounter(engine.provider)

  let written: string | null = null
  try {
    written = await fsp.readFile(contextPath, 'utf8')
  } catch {}
  if (written == null || written.trim() === '') {
    logEngine('warn', `the engine did not write the root ${FILENAME}`, {
      feature: FEATURE,
      scope: SCOPE_KEY
    })
    if (existing != null) {
      await fsp.writeFile(contextPath, existing, 'utf8')
    }
  }
}

async function listTopLevel(
  vaultRoot: string,
  filename: string
): Promise<Array<{ rel: string; size: number; kind: 'file' | 'dir' }>> {
  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await fsp.readdir(vaultRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const out: Array<{ rel: string; size: number; kind: 'file' | 'dir' }> = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === filename)
      continue
    if (entry.isDirectory()) {
      out.push({ rel: entry.name, size: 0, kind: 'dir' })
    }
  }
  return out
}

function firstLineOfPurpose(p: string): string {
  const trimmed = p.trim()
  if (!trimmed) return ''
  const firstLine =
    trimmed
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)[0] ?? ''
  return firstLine.length > 200 ? firstLine.slice(0, 200) + '…' : firstLine
}

function throwFromResult(
  reason: AgentJobErrorReason | undefined,
  message: string | undefined
): never {
  const tag = reason ? `[${reason}] ` : ''
  throw new Error(`${tag}${message ?? 'unknown error'}`)
}
