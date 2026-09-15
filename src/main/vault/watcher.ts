import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import path from 'node:path'
import type { FileChangeEvent } from '@shared/types'

let watcher: FSWatcher | null = null

export type FileChangeHandler = (event: FileChangeEvent) => void

export async function startWatcher(root: string, handler: FileChangeHandler): Promise<void> {
  await stopWatcher()
  watcher = chokidar.watch(root, {
    ignored: (p) => {
      const base = path.basename(p)
      if (base === '.git' || base === 'node_modules' || base === '.obsidian') return true
      if (base === '.DS_Store') return true
      if (base === '.mindex' || base === '.vault') return true
      if (p.includes(`${path.sep}.mindex${path.sep}`) || p.endsWith(`${path.sep}.mindex`))
        return true
      if (p.includes(`${path.sep}.vault${path.sep}`) || p.endsWith(`${path.sep}.vault`)) return true
      return false
    },
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 }
  })

  watcher.on('add', (p) => handler({ kind: 'add', path: p }))
  watcher.on('change', (p) => handler({ kind: 'change', path: p }))
  watcher.on('unlink', (p) => handler({ kind: 'unlink', path: p }))
  watcher.on('addDir', (p) => handler({ kind: 'addDir', path: p }))
  watcher.on('unlinkDir', (p) => handler({ kind: 'unlinkDir', path: p }))
}

export async function stopWatcher(): Promise<void> {
  if (watcher) {
    await watcher.close()
    watcher = null
  }
}
