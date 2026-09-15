import { api } from '@/platform/api'
import { relativeFromNote } from '@/platform/markdown/asset-url'

export function imageFilesFrom(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const out: File[] = []
  for (const f of Array.from(dt.files)) {
    if (f.type.startsWith('image/')) out.push(f)
  }
  if (out.length === 0 && dt.items) {
    for (const it of Array.from(dt.items)) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) out.push(f)
      }
    }
  }
  return out
}

/**
 * Copies `file` into the vault's asset store and returns the path the note
 * should reference — relative to the note when possible, since that's what
 * survives the vault being moved or opened on another machine.
 */
export async function saveVaultAsset(
  file: File,
  noteAbsPath: string | null
): Promise<{ rel: string; name: string } | null> {
  const bytes = await file.arrayBuffer()
  const r = await api().notes.saveAsset({
    sourceName: file.name || 'file',
    bytes
  })
  if (!r.ok || !r.data) return null
  const rel = noteAbsPath ? relativeFromNote(noteAbsPath, r.data.absPath) : r.data.relPath
  return { rel, name: file.name || 'file' }
}

export async function fileToImageMarkdown(
  file: File,
  noteAbsPath: string | null
): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null
  const saved = await saveVaultAsset(file, noteAbsPath)
  if (!saved) return null
  const alt = saved.name.replace(/\.[^.]+$/, '')
  return `![${alt}](${saved.rel})`
}

export async function fileToVideoMarkdown(
  file: File,
  noteAbsPath: string | null
): Promise<string | null> {
  if (!file.type.startsWith('video/')) return null
  const saved = await saveVaultAsset(file, noteAbsPath)
  if (!saved) return null
  return `<video controls src="${saved.rel}"></video>`
}

export async function fileToAudioMarkdown(
  file: File,
  noteAbsPath: string | null
): Promise<string | null> {
  if (!file.type.startsWith('audio/')) return null
  const saved = await saveVaultAsset(file, noteAbsPath)
  if (!saved) return null
  return `<audio controls src="${saved.rel}"></audio>`
}
