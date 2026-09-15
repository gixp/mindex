import type { FileChangeEvent } from '@shared/types'

export type FileChangeListener = (event: FileChangeEvent) => void

const listeners = new Set<FileChangeListener>()

export function onFileChange(l: FileChangeListener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function emitFileChange(event: FileChangeEvent): void {
  for (const l of listeners) {
    try {
      l(event)
    } catch {}
  }
}

export function clearFileChangeListeners(): void {
  listeners.clear()
}
